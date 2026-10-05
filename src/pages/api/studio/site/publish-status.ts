import type { APIRoute } from 'astro';
import { json } from '../../../../lib/forum-server';
import { readPublishStatus } from '../../../../lib/site/rebuild.ts';
import { getStudioUserId, studioEnabled } from '../../../../lib/tenant/studio-db';

export const prerender = false;

// GET /api/studio/site/publish-status -> { state, requestedAt, startedAt,
// publishedAt, commit, release } from the so-web rebuild watcher (state
// "idle" when there is no status yet). so tenant, signed-in studio users only.
export const GET: APIRoute = async ({ locals }) => {
  if (locals.tenant.id !== 'so' || !studioEnabled(locals.tenant)) return json({ error: 'Not found' }, 404);
  const userId = await getStudioUserId(locals);
  if (!userId) return json({ error: 'Not authenticated' }, 401);
  const res = json(await readPublishStatus());
  res.headers.set('Cache-Control', 'no-store');
  return res;
};
