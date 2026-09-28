import type { APIRoute } from 'astro';
import { query } from '../../../../../lib/db/pool';
import {
  BibliographyError, MAX_QUERY, MAX_RESULTS, createRateLimiter, loadForumBibliography, searchForumCitations,
} from '../../../../../lib/mm/bibliography';

export const prerender = false;

const allow = createRateLimiter(30, 60_000);

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'Cache-Control': status === 200 ? 'public, max-age=15' : 'no-store' } });

// Public-readable citation metadata for a forum's linked Seshat library.
export const GET: APIRoute = async ({ params, url, locals, clientAddress }) => {
  if ((locals as any).tenant?.id !== 'mm') return json({ error: 'Not found' }, 404);
  const ip = (() => { try { return clientAddress || 'unknown'; } catch { return 'unknown'; } })();
  if (!allow(ip)) return json({ error: 'Too many requests' }, 429);

  const term = String(url.searchParams.get('q') || '').trim().slice(0, MAX_QUERY);
  const limit = Math.max(1, Math.min(MAX_RESULTS, Number(url.searchParams.get('limit')) || MAX_RESULTS));
  try {
    const settings = await loadForumBibliography((text, p) => query(text, p as any[]), String(params.slug || ''));
    if (!settings) return json({ error: 'Not found' }, 404);
    const items = await searchForumCitations(settings, term, { limit });
    return json({ items });
  } catch (error) {
    console.error('[mm:bibliography:citations]', error instanceof BibliographyError ? error.status : error);
    return json({ error: 'Bibliography is unavailable.' }, 500);
  }
};
