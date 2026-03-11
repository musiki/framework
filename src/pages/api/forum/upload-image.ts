import type { APIRoute } from 'astro';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { json } from '../../../lib/forum-server';
import { getR2BucketName, getR2Client, getR2PublicObjectUrl } from '../../../lib/r2';

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'avif']);
const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'm4v', 'mov', 'webm', 'ogv']);
const IMAGE_MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const AUDIO_MAX_UPLOAD_BYTES = 24 * 1024 * 1024;
const VIDEO_MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

function guessForumUploadExtension(file: File): string {
  const mime = String(file.type || '').toLowerCase();
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/png') return 'png';
  if (mime === 'image/gif') return 'gif';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/svg+xml') return 'svg';
  if (mime === 'image/avif') return 'avif';
  if (mime === 'audio/mpeg') return 'mp3';
  if (mime === 'audio/wav' || mime === 'audio/x-wav') return 'wav';
  if (mime === 'audio/ogg') return 'ogg';
  if (mime === 'audio/mp4') return 'm4a';
  if (mime === 'audio/aac') return 'aac';
  if (mime === 'audio/flac' || mime === 'audio/x-flac') return 'flac';
  if (mime === 'video/mp4') return 'mp4';
  if (mime === 'video/quicktime') return 'mov';
  if (mime === 'video/webm') return 'webm';
  if (mime === 'video/ogg') return 'ogv';

  const fileName = String(file.name || '');
  const match = fileName.match(/\.([a-z0-9]+)$/i);
  return match ? match[1].toLowerCase() : 'bin';
}

function detectForumUploadKind(file: File): 'image' | 'audio' | 'video' | '' {
  const mime = String(file.type || '').toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';

  const extension = guessForumUploadExtension(file);
  if (IMAGE_EXTENSIONS.has(extension)) return 'image';
  if (AUDIO_EXTENSIONS.has(extension)) return 'audio';
  if (VIDEO_EXTENSIONS.has(extension)) return 'video';
  return '';
}

function buildForumUploadKey(file: File, sessionEmail: string, kind: 'image' | 'audio' | 'video'): string {
  const now = new Date();
  const year = String(now.getUTCFullYear());
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  const extension = guessForumUploadExtension(file);
  const owner = String(sessionEmail || 'anonymous')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'anonymous';

  return `forum/${kind}/${year}/${month}/${day}/${owner}-${crypto.randomUUID()}.${extension}`;
}

function getForumUploadByteLimit(kind: 'image' | 'audio' | 'video'): number {
  if (kind === 'audio') return AUDIO_MAX_UPLOAD_BYTES;
  if (kind === 'video') return VIDEO_MAX_UPLOAD_BYTES;
  return IMAGE_MAX_UPLOAD_BYTES;
}

export const POST: APIRoute = async ({ request, locals }) => {
  const session = (locals as any).session;
  const sessionEmail = typeof session?.user?.email === 'string' ? session.user.email.trim() : '';
  if (!sessionEmail) {
    return json({ error: 'Not authenticated' }, 401);
  }

  try {
    const incoming = await request.formData();
    const file = incoming.get('file') ?? incoming.get('image');
    if (!(file instanceof File)) {
      return json({ error: 'No media file was provided.' }, 400);
    }

    const kind = detectForumUploadKind(file);
    if (!kind) {
      return json({ error: 'Only image, audio and MP4 video uploads are supported.' }, 415);
    }

    if (file.size <= 0) {
      return json({ error: 'The uploaded file is empty.' }, 400);
    }

    const byteLimit = getForumUploadByteLimit(kind);
    const limitLabel = kind === 'audio' ? '24 MB' : '10 MB';
    if (file.size > byteLimit) {
      return json({ error: `The uploaded ${kind} exceeds the ${limitLabel} limit.` }, 413);
    }

    const objectKey = buildForumUploadKey(file, sessionEmail, kind);
    const body = new Uint8Array(await file.arrayBuffer());

    await getR2Client().send(
      new PutObjectCommand({
        Bucket: getR2BucketName(),
        Key: objectKey,
        Body: body,
        ContentType: file.type || 'application/octet-stream',
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );

    const publicUrl = getR2PublicObjectUrl(objectKey);
    const fallbackUrl = `/api/forum/uploads/${objectKey
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/')}`;

    return json({
      success: true,
      kind,
      key: objectKey,
      url: publicUrl || fallbackUrl,
    });
  } catch (error: any) {
    console.error('Forum media upload error:', error);
    if (String(error?.message || '').includes('R2_NOT_CONFIGURED')) {
      return json({ error: 'R2 credentials are not configured on the server.' }, 503);
    }
    return json({ error: error?.message || 'Could not upload media to R2.' }, 500);
  }
};
