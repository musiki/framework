import { mmRoute, json, readJsonObject } from '../../../../lib/mm/api';
import { openJoinOf, requireAdmin, setOpenJoin, setStanceRevealDays, settingsPatch } from '../../../../lib/mm/admin-core';
import { stanceRevealDays } from '../../../../lib/mm/stances-core';

export const prerender = false;

// Admin only: the open-join switch (Space.settings.openJoin, JSON boolean; off by default) and
// the stance reveal delay (Space.settings.stanceRevealDays, JSON integer 1–90; default 14).
// The delay only applies to relations proposed after the change: each relation's reveal date is frozen at creation.
export const GET = mmRoute({ auth: true, tag: 'mm:admin:settings' }, async (_ctx, { space, userId, q }) => {
  await requireAdmin(q, space.id, userId);
  return json({ openJoin: openJoinOf(space.settings), stanceRevealDays: stanceRevealDays(space.settings) });
});

// { openJoin?: boolean, stanceRevealDays?: number } — at least one; both validated before any write.
export const PATCH = mmRoute({ mutation: true, tag: 'mm:admin:settings' }, async ({ request }, { space, userId, q }) => {
  await requireAdmin(q, space.id, userId);
  const patch = settingsPatch(await readJsonObject(request));
  const out: { openJoin?: boolean; stanceRevealDays?: number } = {};
  if ('openJoin' in patch) Object.assign(out, await setOpenJoin(q, space.id, patch.openJoin));
  if ('stanceRevealDays' in patch) Object.assign(out, await setStanceRevealDays(q, space.id, patch.stanceRevealDays));
  return json(out);
});
