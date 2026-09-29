import { mmRoute, json, readJsonObject } from '../../../../lib/mm/api';
import { listMembers, removeMember, requireAdmin, setMemberRole } from '../../../../lib/mm/admin-core';
import { onClient } from '../../../../lib/mm/concepts';

export const prerender = false;

// Admin only: members (with emails — admin view), role change, removal.
export const GET = mmRoute({ auth: true, tag: 'mm:admin:members' }, async (_ctx, { space, userId, q }) => {
  await requireAdmin(q, space.id, userId);
  return json({ members: await listMembers(q, space.id) });
});

// { userId, role } — any commons role; never your own membership; never zero admins.
export const PATCH = mmRoute({ mutation: true, tag: 'mm:admin:members' }, async ({ request }, { space, userId, q }) => {
  await requireAdmin(q, space.id, userId);
  const body = await readJsonObject(request);
  return json(await onClient((tq) =>
    setMemberRole(tq, { spaceId: space.id, actorUserId: userId as string, targetUserId: body.userId, role: body.role })));
});

// ?userId=<id> — removes the member and blocks open-join re-entry (SpaceMemberBlock).
export const DELETE = mmRoute({ mutation: true, requireJson: false, tag: 'mm:admin:members' }, async ({ url }, { space, userId, q }) => {
  await requireAdmin(q, space.id, userId);
  const targetUserId = url.searchParams.get('userId');
  return json(await onClient((tq) => removeMember(tq, { spaceId: space.id, actorUserId: userId as string, targetUserId })));
});
