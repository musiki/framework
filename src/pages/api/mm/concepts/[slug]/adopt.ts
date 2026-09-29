import { mmRoute, json, readJsonObject, requireUuidParam } from '../../../../../lib/mm/api';
import { apiLang, findConceptId } from '../../../../../lib/mm/api-core';
import { adoptPost } from '../../../../../lib/mm/concepts';

export const prerender = false;

// Curators/admins: { postId, lang?='en', definition?, sources? } → new version credited to the post author.
export const POST = mmRoute({ mutation: true, tag: 'mm:adopt' }, async ({ request, params }, { space, userId, q }) => {
  const body = await readJsonObject(request);
  const conceptId = await findConceptId(q, space.id, params.slug);
  const result = await adoptPost({
    conceptId, postId: requireUuidParam(body.postId, 'postId'), actorUserId: userId, lang: apiLang(body.lang),
    definition: body.definition, sources: body.sources,
  });
  return json(result, 201);
});
