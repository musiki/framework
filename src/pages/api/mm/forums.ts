import { mmRoute, json, readJsonObject } from '../../../lib/mm/api';
import { findForumId } from '../../../lib/mm/api-core';
import { createForum, listForums } from '../../../lib/mm/forum';

export const prerender = false;

// Public: active groups (top-level forums), each with its active `channels`.
export const GET = mmRoute({ tag: 'mm:forums' }, async (_ctx, { space }) =>
  json({ forums: await listForums({ spaceId: space.id }) }));

// Curators/admins (policy enforced in the core). A channel: `parentId` (group
// id) or `parent` (group slug or id); one level only.
export const POST = mmRoute({ mutation: true, tag: 'mm:forums' }, async ({ request }, { space, userId, q }) => {
  const body = await readJsonObject(request);
  let parentId = body.parentId;
  if ((parentId === undefined || parentId === null || parentId === '') && typeof body.parent === 'string' && body.parent) {
    parentId = await findForumId(q, space.id, body.parent);
  }
  const forum = await createForum({
    spaceId: space.id, actorUserId: userId, title: body.title, slug: body.slug,
    description: body.description, settings: body.settings, parentId,
  });
  return json({ forum }, 201);
});
