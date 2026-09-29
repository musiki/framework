import { mmRoute, json, readJsonObject, requireUuidParam } from '../../../../../lib/mm/api';
import { vote } from '../../../../../lib/mm/forum';

export const prerender = false;

// Guests+: { value: 0 | 1 | 2 | 3 } (0 removes the vote).
export const POST = mmRoute({ mutation: true, rateBucket: 'vote', tag: 'mm:vote' }, async ({ request, params }, { space, userId }) => {
  const postId = requireUuidParam(params.id, 'post id');
  const body = await readJsonObject(request);
  return json(await vote({ spaceId: space.id, postId, actorUserId: userId, value: body.value }));
});
