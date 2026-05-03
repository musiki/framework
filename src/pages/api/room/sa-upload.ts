import type { APIRoute } from 'astro';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { json } from '../../../lib/forum-server';
import { getR2BucketName, getR2Client, getR2PublicObjectUrl } from '../../../lib/r2';

const AUDIO_MIME: Record<string, string> = {
  'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav',
  'audio/wave': 'wav', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a',
  'audio/aac': 'aac', 'audio/flac': 'flac', 'audio/x-flac': 'flac',
};
const AUDIO_EXTS = new Set(['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac']);
const MAX_BYTES = 24 * 1024 * 1024;

function guessExt(file: File): string {
  const mime = String(file.type || '').toLowerCase();
  if (AUDIO_MIME[mime]) return AUDIO_MIME[mime];
  const m = String(file.name || '').match(/\.([a-z0-9]+)$/i);
  return m ? m[1].toLowerCase() : 'bin';
}

function buildKey(file: File, owner: string): string {
  const now = new Date();
  const y = String(now.getUTCFullYear());
  const mo = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  const ext = guessExt(file);
  const safe = String(owner || 'anon')
    .toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'anon';
  return `room/sa/${y}/${mo}/${d}/${safe}-${crypto.randomUUID()}.${ext}`;
}

export const POST: APIRoute = async ({ request, locals }) => {
  const session = (locals as any).session;
  const email = typeof session?.user?.email === 'string' ? session.user.email.trim() : '';
  if (!email) return json({ error: 'Not authenticated' }, 401);

  try {
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return json({ error: 'No audio file provided.' }, 400);

    const mime = String(file.type || '').toLowerCase();
    const ext = guessExt(file);
    if (!mime.startsWith('audio/') && !AUDIO_EXTS.has(ext))
      return json({ error: 'Only audio files are accepted.' }, 415);
    if (file.size <= 0) return json({ error: 'File is empty.' }, 400);
    if (file.size > MAX_BYTES) return json({ error: 'Audio exceeds 24 MB limit.' }, 413);

    const key = buildKey(file, email);
    await getR2Client().send(new PutObjectCommand({
      Bucket: getR2BucketName(),
      Key: key,
      Body: new Uint8Array(await file.arrayBuffer()),
      ContentType: file.type || 'audio/octet-stream',
      CacheControl: 'public, max-age=31536000, immutable',
    }));

    return json({ success: true, url: getR2PublicObjectUrl(key), key });
  } catch (e: any) {
    console.error('[sa-upload]', e);
    if (String(e?.message || '').includes('R2_NOT_CONFIGURED'))
      return json({ error: 'R2 not configured.' }, 503);
    return json({ error: e?.message || 'Upload failed.' }, 500);
  }
};
