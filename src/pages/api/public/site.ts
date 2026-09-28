import type { APIRoute } from 'astro';
import { query } from '../../../lib/db/pool';
import { json } from '../../../lib/forum-server';
import { loadPublicSite } from '../../../lib/site/site-db.ts';

export const prerender = false;

// GET /api/public/site -> { generatedAt, pages, menu }
//
// Public, unauthenticated, never cached (`no-store`: the so-web rebuild
// fetches it right after a save and must see that save); only reachable
// on the so tenant (route family `api:public` is only in so's `routes`, and
// this handler double-checks the tenant itself so it 404s even if it were
// ever reached from another tenant's `routes: 'all'`).
export const GET: APIRoute = async ({ locals }) => {
  if (locals.tenant.id !== 'so') return json({ error: 'Not found' }, 404);

  let model;
  try {
    model = await loadPublicSite(query, { tenantId: locals.tenant.id });
  } catch (err) {
    console.error('[api/public/site] failed to load the public site:', err);
    return json({ error: 'Internal error' }, 500);
  }

  if (!model) return json({ error: 'Not found' }, 404);

  return new Response(
    JSON.stringify({ generatedAt: new Date().toISOString(), pages: model.pages, menu: model.menu }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    },
  );
};
