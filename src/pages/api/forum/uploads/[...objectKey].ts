import type { APIRoute } from 'astro';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { json } from '../../../../lib/forum-server';
import { getR2BucketName, getR2Client, normalizeForumUploadKey } from '../../../../lib/r2';

export const GET: APIRoute = async ({ params }) => {
  const objectKey = normalizeForumUploadKey(params.objectKey || '');
  if (!objectKey) {
    return json({ error: 'Object key is required.' }, 400);
  }

  try {
    const response = await getR2Client().send(
      new GetObjectCommand({
        Bucket: getR2BucketName(),
        Key: objectKey,
      }),
    );

    if (!response.Body || typeof response.Body.transformToByteArray !== 'function') {
      return json({ error: 'Stored object body is not readable.' }, 502);
    }

    const body = await response.Body.transformToByteArray();
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': response.ContentType || 'application/octet-stream',
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Content-Disposition': 'inline',
        ...(response.ETag ? { ETag: response.ETag } : {}),
      },
    });
  } catch (error: any) {
    const message = String(error?.name || error?.message || '');
    if (message.includes('NoSuchKey') || message.includes('NotFound')) {
      return json({ error: 'File not found.' }, 404);
    }
    console.error('Forum upload fetch error:', error);
    return json({ error: 'Could not fetch stored upload.' }, 500);
  }
};
