import type { APIRoute } from 'astro';
import { json } from '../../../lib/forum-server';
import { getStudioUserId, listMemberships, studioEnabled } from '../../../lib/tenant/studio-db';
import { listPlugins, pluginsDir } from '../../../lib/site/plugins';

export const prerender = false;

// GET /api/studio/plugins -> the plugin manifests installed for the `so`
// target (spec 3.3). Read-only: viewable by any studio member (author and
// supervisor at least); no mutations in this route.
export const GET: APIRoute = async ({ locals }) => {
  if (!studioEnabled(locals.tenant)) return json({ error: 'Not found' }, 404);
  const userId = await getStudioUserId(locals);
  if (!userId) return json({ error: 'Not authenticated' }, 401);

  const memberships = await listMemberships(locals.tenant.id, userId);
  if (memberships.length === 0) return json({ error: 'Forbidden' }, 403);

  const plugins = await listPlugins(pluginsDir());
  return json({ plugins });
};
