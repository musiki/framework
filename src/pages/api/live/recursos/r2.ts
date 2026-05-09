import type { APIRoute } from 'astro';
import { ListObjectsV2Command } from '@aws-sdk/client-s3';
import { cleanString, ensureDbUserFromSession, json } from '../../../../lib/forum-server';
import { getR2BucketName, getR2Client, getR2PublicObjectUrl } from '../../../../lib/r2';
import { resolveLiveManageAccess } from '../../../../lib/live/access';

const normalizeText = (value: unknown) => String(value || '').trim();

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

export const GET: APIRoute = async ({ locals, url }) => {
  const session = (locals as any).session;
  const user = await ensureDbUserFromSession(session);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  const courseId = cleanString(url.searchParams.get('courseId') ?? '', 120);
  const access = await resolveLiveManageAccess(session, courseId);
  if (!access.canManage) return json({ error: 'Forbidden' }, 403);

  const requestedPrefix = normalizePrefix(url.searchParams.get('prefix') ?? 'room/');
  const prefix = requestedPrefix || 'room/';
  const delimiter = url.searchParams.get('flat') === '1' ? undefined : '/';
  const maxKeys = Math.max(1, Math.min(200, Number(url.searchParams.get('maxKeys') || 80) || 80));

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
        .map((entry) => {
          const key = normalizeText(entry.Key);
          return {
            key,
            name: key.split('/').filter(Boolean).pop() || key,
            url: getR2PublicObjectUrl(key),
            size: entry.Size || 0,
            lastModified: entry.LastModified?.toISOString() || '',
          };
        }),
      truncated: Boolean(result.IsTruncated),
    });
  } catch (error: any) {
    console.error('[recursos-r2] list failed', error);
    if (String(error?.message || '').includes('R2_NOT_CONFIGURED')) {
      return json({ error: 'R2 not configured.' }, 503);
    }
    return json({ error: error?.message || 'Could not list R2 objects.' }, 500);
  }
};
