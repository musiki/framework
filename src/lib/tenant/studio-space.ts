import { query } from '../db/pool';
import { json } from '../forum-server';
import { getMemberRole } from '../writing/notes/space-notes.ts';
import { isUuid, type SpaceRole } from './space-roles';
import { studioEnabled, getStudioUserId } from './studio-db';

/**
 * Shared guard for every `/api/studio/notes*` route: confirms the studio is
 * enabled for this tenant, the space belongs to this tenant, the caller is
 * authenticated, and the caller is a member of that space.
 *
 * Returns the resolved `{ spaceId, userId, role, space }` on success, or a
 * `Response` to return immediately:
 *  - 404 when studio is disabled for this tenant, `spaceId` isn't a UUID, or
 *    the space doesn't belong to this tenant (a non-member must not be able
 *    to distinguish "wrong tenant" from "doesn't exist").
 *  - 401 when there's no authenticated studio user.
 *  - 403 when the user is authenticated but not a member of the space.
 */
export async function resolveStudioSpace(
  locals: App.Locals,
  spaceId: string,
): Promise<{ spaceId: string; userId: string; role: SpaceRole; space: { lang: string; tenantId: string } } | Response> {
  if (!studioEnabled(locals.tenant)) return json({ error: 'Not found' }, 404);
  if (!isUuid(spaceId)) return json({ error: 'Not found' }, 404);

  const { data, error } = await query(
    `SELECT "id", "lang", "tenantId" FROM "Space" WHERE "id" = $1 AND "tenantId" = $2 LIMIT 1`,
    [spaceId, locals.tenant.id],
  );
  if (error) return json({ error: error.message }, 500);
  if (!data?.length) return json({ error: 'Not found' }, 404);
  const space = data[0] as { id: string; lang: string; tenantId: string };

  const userId = await getStudioUserId(locals);
  if (!userId) return json({ error: 'Not authenticated' }, 401);

  const role = await getMemberRole(spaceId, userId);
  if (!role) return json({ error: 'Forbidden' }, 403);

  return { spaceId, userId, role, space: { lang: space.lang, tenantId: space.tenantId } };
}
