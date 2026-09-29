import { mmRoute, json, readJsonObject, requireUuidParam } from '../../../../../lib/mm/api';
import { createPost } from '../../../../../lib/mm/forum';

export const prerender = false;

// Members+: post or reply with an optional rhetorical move.
export const POST = mmRoute({ mutation: true, tag: 'mm:posts' }, async ({ request, params }, { space, userId }) => {
  const threadId = requireUuidParam(params.id, 'thread id');
  const body = await readJsonObject(request);
  const post = await createPost({
    spaceId: space.id, threadId, actorUserId: userId, body: body.body, move: body.move, parentPostId: body.parentPostId,
  });
  return json({ post }, 201);
});
