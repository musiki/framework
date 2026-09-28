import type { APIRoute } from 'astro';

// Catch-all for any unknown path or method under /api/public. Without it,
// musiki's root catch-all (src/pages/[...slug].astro) would handle an
// unmatched /api/public/* request (e.g. on so). Explicit public routes
// (instruments, site) and the more specific /api/public/mm/[...rest] win
// over this route per Astro's route-priority rules. Always a JSON 404.
export const prerender = false;

export const ALL: APIRoute = () =>
  new Response(JSON.stringify({ error: 'Not found' }), {
    status: 404,
    headers: { 'content-type': 'application/json' },
  });
