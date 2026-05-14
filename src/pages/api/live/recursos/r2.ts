import type { APIRoute } from 'astro';
import { DeleteObjectCommand, ListObjectsV2Command, PutObjectCommand } from '@aws-sdk/client-s3';
import { cleanString, ensureDbUserFromSession, json } from '../../../../lib/forum-server';
import { getR2BucketName, getR2Client, getR2PublicObjectUrl } from '../../../../lib/r2';
import { resolveLiveManageAccess } from '../../../../lib/live/access';

const normalizeText = (value: unknown) => String(value || '').trim();
const VIRTUAL_TREE_DEPTH = 3;
const MAX_UPLOAD_BYTES = 256 * 1024 * 1024;
const ALLOWED_UPLOAD_EXTS = new Set([
  'pdf', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg',
  'pptx',
  'md', 'tex', 'ly', 'txt',
  'mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac',
  'mov', 'mp4', 'webm',
  'zip', 'tar', 'gz',
]);

function normalizePrefix(value: unknown): string {
  const normalized = normalizeText(value)
    .replace(/\\/g, '/')
    .replace(/^\/+/g, '')
    .split('/')
    .filter((segment) => segment && segment !== '.' && segment !== '..')
    .join('/');
  if (!normalized) return '';
  return String(value || '').trim().endsWith('/') ? `${normalized}/` : normalized;
}

function normalizeObjectKey(value: unknown): string {
  return normalizeText(value)
    .replace(/\\/g, '/')
    .replace(/^\/+/g, '')
    .split('/')
    .filter((segment) => segment && segment !== '.' && segment !== '..')
    .join('/');
}

function prefixParts(prefix: string): string[] {
  return normalizePrefix(prefix).split('/').filter(Boolean);
}

function capPrefixDepth(prefix: string, maxDepth = VIRTUAL_TREE_DEPTH): string {
  const parts = prefixParts(prefix);
  if (!parts.length) return 'room/';
  const visibleParts = parts.slice(0, maxDepth);
  return `${visibleParts.join('/')}/`;
}

function guessFileExt(file: File): string {
  const match = String(file.name || '').match(/\.([a-z0-9]+)$/i);
  return match ? match[1].toLowerCase() : 'bin';
}

function guessContentType(ext: string): string {
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'pptx') return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) return `image/${ext === 'jpg' ? 'jpeg' : ext}`;
  if (ext === 'svg') return 'image/svg+xml';
  const audioTypes: Record<string, string> = {
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    m4a: 'audio/mp4',
    aac: 'audio/aac',
    flac: 'audio/flac',
  };
  if (ext in audioTypes) return audioTypes[ext];
  if (ext === 'mov') return 'video/quicktime';
  if (ext === 'mp4') return 'video/mp4';
  if (ext === 'webm') return 'video/webm';
  if (['md', 'tex', 'ly', 'txt'].includes(ext)) return 'text/plain; charset=utf-8';
  return 'application/octet-stream';
}

function safeKeySegment(value: unknown, fallback = 'file'): string {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 72)
    || fallback;
}

function normalizeFolderName(value: unknown): string {
  return normalizeText(value)
    .replace(/\\/g, '/')
    .split('/')
    .map((segment) => safeKeySegment(segment, ''))
    .filter(Boolean)
    .join('/');
}

function buildUploadKey(prefix: string, file: File, identity: string): string {
  const ext = guessFileExt(file);
  const originalName = String(file.name || '').replace(/\.[a-z0-9]+$/i, '');
  const safeIdentity = safeKeySegment(identity, 'user');
  const safeName = safeKeySegment(originalName, 'file');
  return `${capPrefixDepth(prefix || 'room/')}${safeIdentity}-${safeName}-${crypto.randomUUID()}.${ext}`;
}

function isClassWorkspaceUploadPrefix(prefix: string, courseId: string): boolean {
  const parts = prefixParts(prefix);
  const coursePart = safeKeySegment(courseId, 'course');
  return parts[0] === 'class-workspace' && safeKeySegment(parts[1], 'course') === coursePart;
}

export const GET: APIRoute = async ({ locals, url }) => {
  const session = (locals as any).session;
  const user = await ensureDbUserFromSession(session);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  const courseId = cleanString(url.searchParams.get('courseId') ?? '', 120);
  const access = await resolveLiveManageAccess(session, courseId);
  if (!access.canManage) return json({ error: 'Forbidden' }, 403);

  const requestedPrefix = normalizePrefix(url.searchParams.get('prefix') ?? 'room/');
  const prefix = capPrefixDepth(requestedPrefix || 'room/');
  const virtualFlat = prefixParts(prefix).length >= VIRTUAL_TREE_DEPTH;
  const delimiter = url.searchParams.get('flat') === '1' || virtualFlat ? undefined : '/';
  const defaultMaxKeys = virtualFlat ? 500 : 80;
  const maxKeys = Math.max(1, Math.min(500, Number(url.searchParams.get('maxKeys') || defaultMaxKeys) || defaultMaxKeys));

  try {
    const result = await getR2Client().send(new ListObjectsV2Command({
      Bucket: getR2BucketName(),
      Prefix: prefix,
      Delimiter: delimiter,
      MaxKeys: maxKeys,
    }));

    return json({
      prefix,
      folders: (result.CommonPrefixes || [])
        .map((entry) => normalizeText(entry.Prefix))
        .filter(Boolean),
      objects: (result.Contents || [])
        .filter((entry) => normalizeText(entry.Key) && normalizeText(entry.Key) !== prefix)
        .filter((entry) => !normalizeText(entry.Key).endsWith('/.keep'))
        .map((entry) => {
          const key = normalizeText(entry.Key);
          return {
            key,
            name: key.split('/').filter(Boolean).pop() || key,
            relativePath: key.startsWith(prefix) ? key.slice(prefix.length) : key,
            url: getR2PublicObjectUrl(key),
            size: entry.Size || 0,
            lastModified: entry.LastModified?.toISOString() || '',
          };
        }),
      truncated: Boolean(result.IsTruncated),
      virtualFlat,
      virtualTreeDepth: VIRTUAL_TREE_DEPTH,
    });
  } catch (error: any) {
    console.error('[recursos-r2] list failed', error);
    if (String(error?.message || '').includes('R2_NOT_CONFIGURED')) {
      return json({ error: 'R2 not configured.' }, 503);
    }
    return json({ error: error?.message || 'Could not list R2 objects.' }, 500);
  }
};

export const POST: APIRoute = async ({ locals, request }) => {
  const session = (locals as any).session;
  const user = await ensureDbUserFromSession(session);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const body = await request.json().catch(() => ({}));
    const courseId = cleanString(body?.courseId ?? '', 120);
    const access = await resolveLiveManageAccess(session, courseId);
    if (!access.canManage) return json({ error: 'Forbidden' }, 403);

    if (normalizeText(body?.action) !== 'create-folder') {
      return json({ error: 'Unsupported R2 action.' }, 400);
    }

    const prefix = capPrefixDepth(normalizePrefix(body?.prefix ?? 'room/') || 'room/');
    const folderName = normalizeFolderName(body?.folderName);
    if (!folderName) return json({ error: 'Folder name required.' }, 400);

    const key = `${prefix}${folderName}/.keep`;
    try {
      await getR2Client().send(new PutObjectCommand({
        Bucket: getR2BucketName(),
        Key: key,
        Body: new Uint8Array(),
        ContentType: 'application/octet-stream',
        CacheControl: 'no-cache',
      }));
      return json({ ok: true, prefix, folder: `${prefix}${folderName}/`, key });
    } catch (error: any) {
      console.error('[recursos-r2] create folder failed', error);
      if (String(error?.message || '').includes('R2_NOT_CONFIGURED')) {
        return json({ error: 'R2 not configured.' }, 503);
      }
      return json({ error: error?.message || 'Could not create R2 folder.' }, 500);
    }
  }

  const form = await request.formData().catch(() => null);
  if (!form) return json({ error: 'Invalid upload payload.' }, 400);

  const courseId = cleanString(form.get('courseId') ?? '', 120);
  const access = await resolveLiveManageAccess(session, courseId);
  const prefix = capPrefixDepth(normalizePrefix(form.get('prefix') ?? 'room/') || 'room/');
  const canContribute = Boolean(access.canManage || access.enrollmentRole);
  if (!access.canManage && !(canContribute && isClassWorkspaceUploadPrefix(prefix, courseId))) {
    return json({ error: 'Forbidden' }, 403);
  }

  const files = form.getAll('file').filter((entry): entry is File => entry instanceof File);
  if (!files.length) return json({ error: 'No file provided.' }, 400);

  const email = normalizeText(session?.user?.email) || normalizeText(user.email) || 'user';
  const uploaded: Array<{ key: string; name: string; url: string; size: number; ext: string }> = [];

  try {
    const client = getR2Client();
    const bucket = getR2BucketName();

    for (const file of files) {
      if (file.size <= 0) return json({ error: `${file.name || 'File'} is empty.` }, 400);
      if (file.size > MAX_UPLOAD_BYTES) return json({ error: `${file.name || 'File'} exceeds 256 MB limit.` }, 413);

      const ext = guessFileExt(file);
      if (!ALLOWED_UPLOAD_EXTS.has(ext)) return json({ error: `${file.name || 'File'} type not allowed.` }, 415);

      const key = buildUploadKey(prefix, file, email);
      await client.send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: new Uint8Array(await file.arrayBuffer()),
        ContentType: guessContentType(ext),
        CacheControl: 'public, max-age=31536000, immutable',
      }));

      uploaded.push({
        key,
        name: key.split('/').filter(Boolean).pop() || key,
        url: getR2PublicObjectUrl(key),
        size: file.size,
        ext,
      });
    }

    return json({ ok: true, prefix, uploaded });
  } catch (error: any) {
    console.error('[recursos-r2] upload failed', error);
    if (String(error?.message || '').includes('R2_NOT_CONFIGURED')) {
      return json({ error: 'R2 not configured.' }, 503);
    }
    return json({ error: error?.message || 'Could not upload R2 object.' }, 500);
  }
};

export const DELETE: APIRoute = async ({ locals, request, url }) => {
  const session = (locals as any).session;
  const user = await ensureDbUserFromSession(session);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  const body = await request.json().catch(() => ({}));
  const courseId = cleanString((body?.courseId ?? url.searchParams.get('courseId')) ?? '', 120);
  const access = await resolveLiveManageAccess(session, courseId);
  if (!access.canManage) return json({ error: 'Forbidden' }, 403);

  const rawKeys: unknown[] = Array.isArray(body?.keys) ? body.keys : [body?.key ?? url.searchParams.get('key')];
  const keys = Array.from(new Set(rawKeys
    .map((entry: unknown) => normalizeObjectKey(entry))
    .filter((entry: string): entry is string => Boolean(entry && !entry.endsWith('/')))));
  if (!keys.length) return json({ error: 'Missing R2 object key.' }, 400);

  try {
    const client = getR2Client();
    const bucket = getR2BucketName();
    for (const key of keys) {
      await client.send(new DeleteObjectCommand({
        Bucket: bucket,
        Key: key,
      }));
    }
    return json({ ok: true, keys, deleted: keys.length });
  } catch (error: any) {
    console.error('[recursos-r2] delete failed', error);
    if (String(error?.message || '').includes('R2_NOT_CONFIGURED')) {
      return json({ error: 'R2 not configured.' }, 503);
    }
    return json({ error: error?.message || 'Could not delete R2 object.' }, 500);
  }
};
