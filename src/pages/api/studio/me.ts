import type { APIRoute } from 'astro';
import { json } from '../../../lib/forum-server';
import { getStudioUserId, listMemberships, studioEnabled } from '../../../lib/tenant/studio-db';

export const prerender = false;

export const GET: APIRoute = async ({ locals }) => {
  if (!studioEnabled(locals.tenant)) return json({ error: 'Not found' }, 404);
  const userId = await getStudioUserId(locals);
  if (!userId) return json({ error: 'Not authenticated' }, 401);
  return json({ email: locals.session?.user?.email, spaces: await listMemberships(locals.tenant.id, userId) });
};
