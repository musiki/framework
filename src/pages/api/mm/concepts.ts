import { mmRoute, json, readJsonObject, MmApiError } from '../../../lib/mm/api';
import { createConcept, listConcepts } from '../../../lib/mm/concepts';
import { getForum } from '../../../lib/mm/forum';

export const prerender = false;

// Public: ?forum=<slug>&status=<status>.
export const GET = mmRoute({ tag: 'mm:concepts' }, async ({ url }, { space }) => {
  const forumSlug = url.searchParams.get('forum');
  let forumId: string | null = null;
  if (forumSlug) {
    const forum = await getForum({ spaceId: space.id, slug: forumSlug });
    if (!forum) return json({ concepts: [] });
    forumId = forum.id;
  }
  const concepts = await listConcepts({ spaceId: space.id, forumId, status: url.searchParams.get('status') || null });
  return json({ concepts });
});

// Members+: { forum: <slug>, label, labelNb?, definition, definitionNb?, sources? }.
export const POST = mmRoute({ mutation: true, tag: 'mm:concepts' }, async ({ request }, { space, userId }) => {
  const body = await readJsonObject(request);
  const forum = typeof body.forum === 'string' ? await getForum({ spaceId: space.id, slug: body.forum }) : null;
  if (!forum) throw new MmApiError(404, 'forum not found');
  const created = await createConcept({
    spaceId: space.id, forumId: forum.id, actorUserId: userId, label: body.label, labelNb: body.labelNb,
    definition: body.definition, definitionNb: body.definitionNb, sources: body.sources,
  });
  return json(created, 201);
});
