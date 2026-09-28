import type { APIRoute } from 'astro';

// Catch-all for any unknown path or method under this mm API prefix. Without
// it, musiki's root catch-all (src/pages/[...slug].astro) would handle an
// unmatched request here. Explicit mm API routes still win over this rest
// route per Astro's route-priority rules. Always a JSON 404, on every tenant
// (non-mm tenants never own this prefix).
export const prerender = false;

export const ALL: APIRoute = () =>
  new Response(JSON.stringify({ error: 'Not found' }), {
    status: 404,
    headers: { 'content-type': 'application/json' },
  });
