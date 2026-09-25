import type { APIRoute } from 'astro';
import { json } from '../../../lib/forum-server';

// Catch-all for any unknown /api/studio/* path or method. Without this,
// musiki's root catch-all (src/pages/[...slug].astro) would handle an
// unmatched /api/studio/* request and could redirect to a musiki URL
// (e.g. /cursos). Explicit studio API routes (me, invites, access-rules)
// still win over this route per Astro's route-priority rules.
export const prerender = false;

export const ALL: APIRoute = () => json({ error: 'Not found' }, 404);
