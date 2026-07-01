import type { APIRoute } from 'astro';

export const prerender = false;

const json = (body: unknown, status = 200) => Response.json(body, {
  status,
  headers: { 'Cache-Control': 'private, max-age=15' },
});

export const GET: APIRoute = async ({ request, locals, url }) => {
  const email = String((locals as any).session?.user?.email || '').trim().toLowerCase();
  if (!email) return json({ error: 'Not authenticated' }, 401);

  const baseUrl = String(process.env.SESHAT_API_URL || 'https://seshat.zztt.org').trim().replace(/\/$/, '');
  const token = String(process.env.SESHAT_INTEGRATION_TOKEN || '').trim();
  if (!token) return json({ error: 'Seshat integration is not configured.' }, 503);

  const upstream = new URL('/api/integrations/citations/search', baseUrl);
  upstream.searchParams.set('q', String(url.searchParams.get('q') || '').slice(0, 200));
  upstream.searchParams.set('limit', String(Math.max(1, Math.min(50, Number(url.searchParams.get('limit')) || 20))));
  const libraryId = String(url.searchParams.get('libraryId') || '').trim();
  if (libraryId) upstream.searchParams.set('libraryId', libraryId.slice(0, 200));

  try {
    const response = await fetch(upstream, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        'X-Seshat-Owner': email,
      },
      signal: AbortSignal.timeout(5_000),
    });
    const payload = await response.json().catch(() => ({ error: 'Invalid response from Seshat.' }));
    if (!response.ok) {
      console.error('[musiki:seshat:citations]', response.status, payload);
      return json({ error: 'Seshat citation search is unavailable.' }, response.status === 401 ? 502 : response.status);
    }
    return json(payload);
  } catch (error) {
    console.error('[musiki:seshat:citations]', error);
    return json({ error: 'Seshat citation search is unavailable.' }, 502);
  }
};
