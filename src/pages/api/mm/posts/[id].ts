import { mmRoute, json, readJsonObject, requireUuidParam } from '../../../../lib/mm/api';
import { patchPost } from '../../../../lib/mm/forum';

export const prerender = false;

// Authors (own post, open thread): { action: 'edit', body, move? } | { action: 'delete' }.
// Curators/admins: { action: 'hide' | 'unhide' | 'delete' } (moderation).
// A write like any other: tenant + CSRF + the per-user write rate limit (mmRoute).
export const PATCH = mmRoute({ mutation: true, tag: 'mm:post-patch' }, async ({ request, params }, { space, userId }) => {
  const postId = requireUuidParam(params.id, 'post id');
  const patch = await readJsonObject(request);
  return json(await patchPost({ spaceId: space.id, postId, actorUserId: userId, patch }));
});
