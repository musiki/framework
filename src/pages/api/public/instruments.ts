import type { APIRoute } from 'astro';
import { handlePublicInstrumentsRequest } from '../../../lib/instruments/catalogue.ts';

export const prerender = false;

// GET /api/public/instruments -> { generatedAt, instruments }
//
// Public, unauthenticated, never cached (`no-store`); reachable on the so
// tenant (route family `api:public`) and on the musiki default tenant
// (`routes: 'all'`), 404 on any other tenant — the handler double-checks
// the tenant itself.
//
// Data: the file-backed SOOG catalogue (content source `soog-instruments`,
// `.content-sources/soog-instruments` or env INSTRUMENTS_DIR), only notes
// with `publish: true` and `type: instrument`, text fields in the request
// tenant's language (so → en, musiki → es). See catalogue.ts.
export const GET: APIRoute = async ({ locals }) => {
  const { status, body } = handlePublicInstrumentsRequest(locals.tenant.id);

  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...(status === 200 ? { 'Cache-Control': 'no-store' } : {}),
    },
  });
};
