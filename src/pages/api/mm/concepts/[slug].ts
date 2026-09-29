import { mmRoute, json, readJsonObject } from '../../../../lib/mm/api';
import { conceptPatchKind, findConceptId } from '../../../../lib/mm/api-core';
import { editDefinition, getConcept, setLabels, setStatus } from '../../../../lib/mm/concepts';

export const prerender = false;

// Public: current definition per language, history, relations (display names only).
export const GET = mmRoute({ tag: 'mm:concept' }, async ({ params }, { space, userId }) => {
  const concept = await getConcept({ spaceId: space.id, slug: String(params.slug || ''), viewerUserId: userId });
  if (!concept) return json({ error: 'Not found' }, 404);
  return json({ concept });
});

// One change per request: { definition, lang?='en', sources? } (author/curator),
// { status } (curator) or { label?, labelNb? } (author/curator).
export const PATCH = mmRoute({ mutation: true, tag: 'mm:concept' }, async ({ request, params }, { space, userId, q }) => {
  const body = await readJsonObject(request);
  const kind = conceptPatchKind(body);
  const conceptId = await findConceptId(q, space.id, params.slug);
  if (kind === 'definition') {
    return json(await editDefinition({
      conceptId, actorUserId: userId, lang: body.lang ?? 'en', definition: body.definition, sources: body.sources,
    }));
  }
  if (kind === 'status') return json(await setStatus({ conceptId, actorUserId: userId, status: body.status }));
  return json(await setLabels({ conceptId, actorUserId: userId, label: body.label, labelNb: body.labelNb }));
});
