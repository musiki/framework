import { mmRoute, json, readJsonObject } from '../../../../lib/mm/api';
import { apiLang, conceptPatchKind, findConceptId } from '../../../../lib/mm/api-core';
import { editDefinition, getConcept, renameConceptSlug, setLabels, setStatus } from '../../../../lib/mm/concepts';
import { conceptPath } from '../../../../lib/mm/view';

export const prerender = false;

// Public: current definition per language, history, relations (display names only).
export const GET = mmRoute({ tag: 'mm:concept' }, async ({ params }, { space, userId }) => {
  const concept = await getConcept({ spaceId: space.id, slug: String(params.slug || ''), viewerUserId: userId });
  if (!concept) return json({ error: 'Not found' }, 404);
  const { spaceId: _spaceId, ...publicConcept } = concept;
  return json({ concept: publicConcept });
});

// One change per request: { definition, lang?: 'en'|'nb' (default en), sources? } (author/curator),
// { status } (curator), { label?, labelNb? } (author/curator) or { slug } (curator: rename; the
// old slug keeps redirecting). A rename answers { slug, previous, changed, path } (path: the new permalink).
export const PATCH = mmRoute({ mutation: true, tag: 'mm:concept' }, async ({ request, params }, { space, userId, q }) => {
  const body = await readJsonObject(request);
  const kind = conceptPatchKind(body);
  const conceptId = await findConceptId(q, space.id, params.slug);
  if (kind === 'definition') {
    return json(await editDefinition({
      conceptId, actorUserId: userId, lang: apiLang(body.lang), definition: body.definition, sources: body.sources,
    }));
  }
  if (kind === 'status') return json(await setStatus({ conceptId, actorUserId: userId, status: body.status }));
  if (kind === 'slug') {
    const renamed = await renameConceptSlug({ conceptId, actorUserId: userId, slug: body.slug });
    return json({ ...renamed, path: conceptPath(renamed.slug) });
  }
  return json(await setLabels({ conceptId, actorUserId: userId, label: body.label, labelNb: body.labelNb }));
});
