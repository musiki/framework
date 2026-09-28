import type { APIRoute } from 'astro';
import { query } from '../../../lib/db/pool';
import { json } from '../../../lib/forum-server';
import { loadPublicInstruments } from '../../../lib/instruments/instruments-db.ts';

export const prerender = false;

// GET /api/public/instruments -> { generatedAt, instruments }
//
// Public, unauthenticated, never cached (`no-store`); reachable on the so
// tenant (route family `api:public`) and on the musiki default tenant
// (`routes: 'all'`), 404 on any other tenant (e.g. mm, not configured yet)
// — this handler double-checks the tenant itself so it 404s even if it were
// ever reached from a tenant whose `routes` happens to allow the path.
export const GET: APIRoute = async ({ locals }) => {
  if (locals.tenant.id !== 'so' && locals.tenant.id !== 'musiki') return json({ error: 'Not found' }, 404);

  let instruments;
  try {
    instruments = await loadPublicInstruments(query, { tenantId: locals.tenant.id });
  } catch (err) {
    console.error('[api/public/instruments] failed to load public instruments:', err);
    return json({ error: 'Internal error' }, 500);
  }

  return new Response(JSON.stringify({ generatedAt: new Date().toISOString(), instruments }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
};
