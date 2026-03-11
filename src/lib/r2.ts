import { S3Client } from '@aws-sdk/client-s3';

const META_ENV = typeof import.meta !== 'undefined' ? import.meta.env : undefined;

const R2_ENDPOINT = META_ENV?.R2_ENDPOINT || process.env.R2_ENDPOINT || '';
const R2_ACCESS_KEY_ID = META_ENV?.R2_ACCESS_KEY_ID || process.env.R2_ACCESS_KEY_ID || '';
const R2_SECRET_ACCESS_KEY = META_ENV?.R2_SECRET_ACCESS_KEY || process.env.R2_SECRET_ACCESS_KEY || '';
const R2_BUCKET = META_ENV?.R2_BUCKET || process.env.R2_BUCKET || '';
const R2_PUBLIC_URL =
  META_ENV?.R2_PUBLIC_URL ||
  process.env.R2_PUBLIC_URL ||
  META_ENV?.R2_PUBLIC_DEV_URL ||
  process.env.R2_PUBLIC_DEV_URL ||
  '';

let r2Client: S3Client | null = null;

export function getR2BucketName(): string {
  return String(R2_BUCKET || '').trim();
}

export function getR2PublicBaseUrl(): string {
  return String(R2_PUBLIC_URL || '').trim().replace(/\/+$/g, '');
}

export function assertR2Configured(): void {
  if (!R2_ENDPOINT || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET) {
    throw new Error('R2_NOT_CONFIGURED');
  }
}

export function getR2Client(): S3Client {
  assertR2Configured();
  if (r2Client) return r2Client;

  r2Client = new S3Client({
    region: 'auto',
    endpoint: R2_ENDPOINT,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
  });

  return r2Client;
}

export function normalizeForumUploadKey(rawKey: string): string {
  return String(rawKey || '')
    .replaceAll('\\', '/')
    .split('/')
    .filter(Boolean)
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join('/');
}

export function getR2PublicObjectUrl(rawKey: string): string {
  const objectKey = normalizeForumUploadKey(rawKey);
  const publicBaseUrl = getR2PublicBaseUrl();
  if (!objectKey || !publicBaseUrl) return '';
  return `${publicBaseUrl}/${objectKey
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')}`;
}
