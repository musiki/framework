import { mmRoute, json, readJsonObject } from '../../../../../lib/mm/api';
import { findForumId } from '../../../../../lib/mm/api-core';
import { createForum, getForum } from '../../../../../lib/mm/forum';

export const prerender = false;

// Public: the active channels of a group (by group slug).
export const GET = mmRoute({ tag: 'mm:channels' }, async ({ params }, { space }) => {
  const group = await getForum({ spaceId: space.id, slug: String(params.slug || '') });
  if (!group) return json({ error: 'Not found' }, 404);
  return json({ channels: group.channels });
});

// Curators/admins: a new channel in the group (slug, title, description,
// optional bibliography override in `settings`). One level only; "t" reserved.
export const POST = mmRoute({ mutation: true, tag: 'mm:channels' }, async ({ request, params }, { space, userId, q }) => {
  const body = await readJsonObject(request);
  const parentId = await findForumId(q, space.id, params.slug);
  const forum = await createForum({
    spaceId: space.id, actorUserId: userId, title: body.title, slug: body.slug,
    description: body.description, settings: body.settings, parentId,
  });
  return json({ forum }, 201);
});
