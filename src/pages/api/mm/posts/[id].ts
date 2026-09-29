import { mmRoute, json, readJsonObject, requireUuidParam } from '../../../../lib/mm/api';
import { moderatePost } from '../../../../lib/mm/forum';

export const prerender = false;

// Curators/admins: { action: 'hide' | 'unhide' | 'delete' }.
export const PATCH = mmRoute({ mutation: true, tag: 'mm:moderate' }, async ({ request, params }, { space, userId }) => {
  const postId = requireUuidParam(params.id, 'post id');
  const body = await readJsonObject(request);
  return json(await moderatePost({ spaceId: space.id, postId, actorUserId: userId, action: body.action }));
});
