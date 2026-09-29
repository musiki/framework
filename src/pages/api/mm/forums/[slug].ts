import { mmRoute, json, readJsonObject } from '../../../../lib/mm/api';
import { findForumId } from '../../../../lib/mm/api-core';
import { getForum, listThreads, updateForum } from '../../../../lib/mm/forum';
import { listConcepts } from '../../../../lib/mm/concepts';

export const prerender = false;

// Public: forum (public settings only), its threads and the concepts born in it.
export const GET = mmRoute({ tag: 'mm:forum' }, async ({ params }, { space, userId }) => {
  const forum = await getForum({ spaceId: space.id, slug: String(params.slug || '') });
  if (!forum) return json({ error: 'Not found' }, 404);
  const [threads, concepts] = await Promise.all([
    listThreads({ spaceId: space.id, forumId: forum.id, viewerUserId: userId }),
    listConcepts({ spaceId: space.id, forumId: forum.id }),
  ]);
  return json({ forum, threads, concepts });
});

// Curators/admins: title, description, isArchived, settings patch (archived forums included).
export const PATCH = mmRoute({ mutation: true, tag: 'mm:forum' }, async ({ request, params }, { space, userId, q }) => {
  const body = await readJsonObject(request);
  const forumId = await findForumId(q, space.id, params.slug);
  const forum = await updateForum({
    spaceId: space.id, forumId, actorUserId: userId, title: body.title, description: body.description,
    settings: body.settings, isArchived: body.isArchived,
  });
  return json({ forum });
});
