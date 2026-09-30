import { mmRoute, json, readJsonObject } from '../../../lib/mm/api';
import { findConceptId } from '../../../lib/mm/api-core';
import { createRelation } from '../../../lib/mm/concepts';

export const prerender = false;

// Members+: { source: <slug>, target: <slug>, type }.
export const POST = mmRoute({ mutation: true, tag: 'mm:relations' }, async ({ request }, { space, userId, q }) => {
  const body = await readJsonObject(request);
  const sourceId = await findConceptId(q, space.id, body.source);
  const targetId = await findConceptId(q, space.id, body.target);
  return json(await createRelation({ spaceId: space.id, sourceId, targetId, typeSlug: body.typeSlug ?? body.type, fromPostId: body.fromPostId, actorUserId: userId }), 201);
});
