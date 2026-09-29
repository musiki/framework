import { mmRoute, json, readJsonObject } from '../../../../lib/mm/api';
import { openJoinOf, requireAdmin, setOpenJoin } from '../../../../lib/mm/admin-core';

export const prerender = false;

// Admin only: the open-join switch (Space.settings.openJoin, JSON boolean; off by default).
export const GET = mmRoute({ auth: true, tag: 'mm:admin:settings' }, async (_ctx, { space, userId, q }) => {
  await requireAdmin(q, space.id, userId);
  return json({ openJoin: openJoinOf(space.settings) });
});

export const PATCH = mmRoute({ mutation: true, tag: 'mm:admin:settings' }, async ({ request }, { space, userId, q }) => {
  await requireAdmin(q, space.id, userId);
  const body = await readJsonObject(request);
  return json(await setOpenJoin(q, space.id, body.openJoin));
});
