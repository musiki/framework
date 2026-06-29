import type { APIRoute } from 'astro';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { cleanString, json } from '../../../lib/forum-server';
import { query } from '../../../lib/db/pool';
import { getR2BucketName, getR2Client, getR2PublicObjectUrl } from '../../../lib/r2';
import { normalizeDbResourceType } from '../../../lib/live/resource-db-enums';

const MAX_BYTES = 256 * 1024 * 1024;

const ALLOWED_EXTS = new Set([
  'pdf', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg',
  'pptx',
  'md', 'tex', 'ly', 'txt',
  'mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac',
  'mov', 'mp4', 'webm',
  'zip', 'tar', 'gz', 'other',
]);

function guessExt(file: File): string {
  const m = String(file.name || '').match(/\.([a-z0-9]+)$/i);
  return m ? m[1].toLowerCase() : 'bin';
}

function guessType(ext: string): string {
  if (['pdf'].includes(ext)) return 'application/pdf';
  if (ext === 'pptx') return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) return 'image/' + (ext === 'jpg' ? 'jpeg' : ext);
  if (ext === 'svg') return 'image/svg+xml';
  const AUDIO_TYPES: Record<string, string> = {
    mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg',
    m4a: 'audio/mp4', aac: 'audio/aac', flac: 'audio/flac',
  };
  if (ext in AUDIO_TYPES) return AUDIO_TYPES[ext];
  if (ext === 'mov') return 'video/quicktime';
  if (ext === 'mp4') return 'video/mp4';
  if (ext === 'webm') return 'video/webm';
  if (['md', 'tex', 'ly', 'txt'].includes(ext)) return 'text/plain';
  return 'application/octet-stream';
}

function resourceTypeFromExt(ext: string): string {
  if (ext === 'pdf') return 'pdf';
  if (ext === 'pptx') return 'pptx';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) return 'img';
  if (ext === 'md' || ext === 'txt') return 'md';
  if (ext === 'tex') return 'tex';
  if (ext === 'ly') return 'ly';
  if (['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'].includes(ext)) return 'audio';
  if (['mov', 'mp4', 'webm'].includes(ext)) return 'video';
  return 'other';
}

function optionalUuid(value: FormDataEntryValue | null): string | null {
  const normalized = cleanString(String(value ?? ''), 40);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)
    ? normalized
    : null;
}

function buildKey(file: File, identity: string): string {
  const now = new Date();
  const y = String(now.getUTCFullYear());
  const mo = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  const ext = guessExt(file);
  const safe = String(identity || 'anon')
    .toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'anon';
  return `room/recursos/${y}/${mo}/${d}/${safe}-${crypto.randomUUID()}.${ext}`;
}

export const POST: APIRoute = async ({ request, locals }) => {
  const session = (locals as any).session;
  const email = typeof session?.user?.email === 'string' ? session.user.email.trim() : '';
  if (!email) return json({ error: 'Not authenticated' }, 401);

  try {
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return json({ error: 'No file provided.' }, 400);
    if (file.size <= 0) return json({ error: 'File is empty.' }, 400);
    if (file.size > MAX_BYTES) return json({ error: 'File exceeds 256 MB limit.' }, 413);

    const ext = guessExt(file);
    if (!ALLOWED_EXTS.has(ext)) return json({ error: 'File type not allowed.' }, 415);

    const key = buildKey(file, email);
    const contentType = guessType(ext);

    await getR2Client().send(new PutObjectCommand({
      Bucket: getR2BucketName(),
      Key: key,
      Body: new Uint8Array(await file.arrayBuffer()),
      ContentType: contentType,
      CacheControl: 'public, max-age=31536000, immutable',
    }));

    const url = getR2PublicObjectUrl(key);
    const scope = cleanString(String(form.get('scope') ?? ''), 20);
    const roomName = cleanString(String(form.get('roomName') ?? ''), 120);
    let item: Record<string, unknown> | null = null;

    // Recursos uploads are append-only at the server. This lets students add a
    // file without granting them the full-list replace/delete permission.
    if (scope === 'recursos' && roomName) {
      const id = crypto.randomUUID();
      const claseId = cleanString(String(form.get('claseId') ?? ''), 240) || null;
      const sessionId = optionalUuid(form.get('sessionId'));
      const folder = cleanString(String(form.get('folder') ?? ''), 120);
      const resourceType = await normalizeDbResourceType(resourceTypeFromExt(ext));
      const name = cleanString(String(file.name || ''), 500) || 'recurso';
      const insert = await query(
        `INSERT INTO "LiveClassResource"
           (id, "claseId", "sessionId", "roomName", url, name, type, folder, source, "createdBy", "sortOrder", "createdAt")
         VALUES
           ($1, $2, $3, $4, $5, $6, $7, $8, 'upload', $9,
            COALESCE((SELECT MAX("sortOrder") + 1 FROM "LiveClassResource" WHERE "roomName" = $4 AND "claseId" IS NOT DISTINCT FROM $2), 0),
            now())
         RETURNING id, "claseId", "sessionId", "roomName", url, name, type, folder, source, "createdBy", "sortOrder", "createdAt"`,
        [id, claseId, sessionId, roomName, url, name, resourceType, folder, email],
      );
      if (insert.error) {
        console.error('[recursos-upload] metadata insert failed', insert.error);
        return json({ error: 'File uploaded, but the resource could not be registered.' }, 500);
      }
      item = insert.data?.[0] ?? null;
    }

    return json({ success: true, url, key, ext, item });
  } catch (e: any) {
    console.error('[recursos-upload]', e);
    if (String(e?.message || '').includes('R2_NOT_CONFIGURED'))
      return json({ error: 'R2 not configured.' }, 503);
    return json({ error: e?.message || 'Upload failed.' }, 500);
  }
};
