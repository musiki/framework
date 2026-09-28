import type { APIRoute } from 'astro';
import { query } from '../../../lib/db/pool';
import { handlePublicInstrumentsRequest } from '../../../lib/instruments/instruments-db.ts';

export const prerender = false;

// GET /api/public/instruments -> { generatedAt, instruments }
//
// Public, unauthenticated, never cached (`no-store`); reachable on the so
// tenant (route family `api:public`) and on the musiki default tenant
// (`routes: 'all'`), 404 on any other tenant (e.g. mm, not configured yet)
// — this handler double-checks the tenant itself so it 404s even if it were
// ever reached from a tenant whose `routes` happens to allow the path.
//
// The dissertation data itself always lives in the `so` tenant's space
// (see INSTRUMENTS_SOURCE_TENANT in instruments-db.ts) regardless of which
// of the two allowed hosts served the request — all of the gating and
// data-sourcing logic lives in the testable, q-injected
// `handlePublicInstrumentsRequest`; this route is just Astro plumbing
// around it.
export const GET: APIRoute = async ({ locals }) => {
  const { status, body } = await handlePublicInstrumentsRequest(query, locals.tenant.id);

  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...(status === 200 ? { 'Cache-Control': 'no-store' } : {}),
    },
  });
};
