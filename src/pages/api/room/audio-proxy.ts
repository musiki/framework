import type { APIRoute } from 'astro';
import { json } from '../../../lib/forum-server';
import { getR2PublicBaseUrl } from '../../../lib/r2';

export const GET: APIRoute = async ({ url, locals }) => {
  const session = (locals as any).session;
  if (!session?.user?.email) return json({ error: 'Not authenticated' }, 401);

  const targetUrl = url.searchParams.get('url');
  if (!targetUrl) return json({ error: 'Missing url parameter' }, 400);

  const publicBase = getR2PublicBaseUrl();
  if (!publicBase || !targetUrl.startsWith(publicBase + '/')) {
    return json({ error: 'URL not allowed' }, 403);
  }

  try {
    const resp = await fetch(targetUrl);
    if (!resp.ok) return json({ error: `Upstream ${resp.status}` }, resp.status);
    const contentType = resp.headers.get('Content-Type') || 'audio/mpeg';
    return new Response(resp.body, {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (e: any) {
    console.error('[audio-proxy]', e);
    return json({ error: e?.message || 'Proxy failed' }, 500);
  }
};
