import type { APIRoute } from 'astro';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { json } from '../../../lib/forum-server';
import { getR2BucketName, getR2Client, getR2PublicObjectUrl } from '../../../lib/r2';

const MAX_BYTES = 24 * 1024 * 1024;

const BLOCKED_EXTS = new Set(['exe', 'sh', 'bat', 'cmd', 'msi', 'ps1', 'vbs', 'js', 'php']);

function guessExt(file: File): string {
  const m = String(file.name || '').match(/\.([a-z0-9]+)$/i);
  return m ? m[1].toLowerCase() : 'bin';
}

function guessType(ext: string): string {
  if (['pdf'].includes(ext)) return 'application/pdf';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) return 'image/' + (ext === 'jpg' ? 'jpeg' : ext);
  if (['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'].includes(ext)) return 'audio/' + ext;
  if (['md', 'tex', 'ly', 'txt'].includes(ext)) return 'text/plain';
  return 'application/octet-stream';
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
    if (file.size > MAX_BYTES) return json({ error: 'File exceeds 24 MB limit.' }, 413);

    const ext = guessExt(file);
    if (BLOCKED_EXTS.has(ext)) return json({ error: 'File type not allowed.' }, 415);

    const key = buildKey(file, email);
    const contentType = guessType(ext);

    await getR2Client().send(new PutObjectCommand({
      Bucket: getR2BucketName(),
      Key: key,
      Body: new Uint8Array(await file.arrayBuffer()),
      ContentType: contentType,
      CacheControl: 'public, max-age=31536000, immutable',
    }));

    return json({ success: true, url: getR2PublicObjectUrl(key), key, ext });
  } catch (e: any) {
    console.error('[recursos-upload]', e);
    if (String(e?.message || '').includes('R2_NOT_CONFIGURED'))
      return json({ error: 'R2 not configured.' }, 503);
    return json({ error: e?.message || 'Upload failed.' }, 500);
  }
};
