import type { APIRoute } from 'astro';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const normalizeText = (value: unknown) => String(value ?? '').trim();

const readTargetUrl = (value: string) => {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null;
    }
    return url;
  } catch {
    return null;
  }
};

const isBlockedProxyHostname = (hostname: string) => {
  const normalized = normalizeText(hostname).toLowerCase();
  if (!normalized) return true;
  if (normalized === 'localhost' || normalized === '[::1]' || normalized.endsWith('.local')) {
    return true;
  }
  if (normalized.startsWith('127.') || normalized.startsWith('10.') || normalized.startsWith('192.168.')) {
    return true;
  }
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(normalized)) {
    return true;
  }
  return false;
};

export const GET: APIRoute = async ({ locals, url }) => {
  const session = (locals as App.Locals).session;
  if (!session?.user?.email) {
    return new Response('Not authenticated.', { status: 401 });
  }

  const rawTarget = normalizeText(url.searchParams.get('url'));
  const targetUrl = readTargetUrl(rawTarget);
  if (!targetUrl) {
    return new Response('Invalid image URL.', { status: 400 });
  }
  if (isBlockedProxyHostname(targetUrl.hostname)) {
    return new Response('Blocked image host.', { status: 403 });
  }

  try {
    const response = await fetch(targetUrl, {
      headers: {
        Accept: 'image/*',
      },
    });

    if (!response.ok) {
      return new Response('Could not fetch background image.', { status: 502 });
    }

    const contentType = normalizeText(response.headers.get('content-type'));
    if (!contentType.startsWith('image/')) {
      return new Response('Remote URL did not return an image.', { status: 415 });
    }

    const contentLength = Number.parseInt(normalizeText(response.headers.get('content-length')), 10);
    if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_BYTES) {
      return new Response('Background image is too large.', { status: 413 });
    }

    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_IMAGE_BYTES) {
      return new Response('Background image is too large.', { status: 413 });
    }

    return new Response(buffer, {
      status: 200,
      headers: {
        'Cache-Control': 'private, max-age=3600',
        'Content-Type': contentType,
        Vary: 'Cookie',
      },
    });
  } catch {
    return new Response('Could not fetch background image.', { status: 500 });
  }
};
