import { mmRoute, json, readJsonObject } from '../../../../../../lib/mm/api';
import { findForumId } from '../../../../../../lib/mm/api-core';
import { getForumByPath, listThreads, updateForum } from '../../../../../../lib/mm/forum';
import { listConcepts } from '../../../../../../lib/mm/concepts';

export const prerender = false;

// Public: a channel by path (/<group>/<channel>): the channel (effective
// public settings, `parent` = its group), its threads and concepts born there.
export const GET = mmRoute({ tag: 'mm:channel' }, async ({ params }, { space, userId }) => {
  const found = await getForumByPath({ spaceId: space.id, group: String(params.slug || ''), channel: String(params.channel || '') });
  if (!found?.channel) return json({ error: 'Not found' }, 404);
  const forum = found.channel;
  const [threads, concepts] = await Promise.all([
    listThreads({ spaceId: space.id, forumId: forum.id, viewerUserId: userId }),
    listConcepts({ spaceId: space.id, forumId: forum.id }),
  ]);
  return json({ forum, threads, concepts });
});

// Curators/admins: edit/archive a channel (archived channels included).
export const PATCH = mmRoute({ mutation: true, tag: 'mm:channel' }, async ({ request, params }, { space, userId, q }) => {
  const body = await readJsonObject(request);
  const forumId = await findForumId(q, space.id, `${String(params.slug || '')}/${String(params.channel || '')}`);
  const forum = await updateForum({
    spaceId: space.id, forumId, actorUserId: userId, title: body.title, description: body.description,
    settings: body.settings, isArchived: body.isArchived,
  });
  return json({ forum });
});
