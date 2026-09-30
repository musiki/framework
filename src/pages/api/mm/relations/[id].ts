import { mmRoute, json, requireUuidParam } from '../../../../lib/mm/api';
import { assertRelationInSpace } from '../../../../lib/mm/api-core';
import { deleteRelation } from '../../../../lib/mm/concepts';

export const prerender = false;

// Curators/admins delete any relation; members their own while it is unsettled and nobody else took a stance.
export const DELETE = mmRoute({ mutation: true, requireJson: false, tag: 'mm:relation' }, async ({ params }, { space, userId, q }) => {
  const relationId = requireUuidParam(params.id, 'relation id');
  await assertRelationInSpace(q, space.id, relationId);
  return json(await deleteRelation({ relationId, spaceId: space.id, actorUserId: userId }));
});
