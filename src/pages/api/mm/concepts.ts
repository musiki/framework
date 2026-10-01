import { mmRoute, json, readJsonObject, MmApiError } from '../../../lib/mm/api';
import { createConcept, listConcepts } from '../../../lib/mm/concepts';
import { getForumRef } from '../../../lib/mm/forum';
import { conceptPath } from '../../../lib/mm/view';

export const prerender = false;

// Public: ?forum=<group slug | forum id>&status=<status>. A group includes its channels' concepts.
export const GET = mmRoute({ tag: 'mm:concepts' }, async ({ url }, { space }) => {
  const forumSlug = url.searchParams.get('forum');
  let forumId: string | null = null;
  if (forumSlug) {
    const forum = await getForumRef({ spaceId: space.id, ref: forumSlug });
    if (!forum) return json({ concepts: [] });
    forumId = forum.id;
  }
  const concepts = await listConcepts({ spaceId: space.id, forumId, status: url.searchParams.get('status') || null });
  return json({ concepts });
});

// Members+: { forum: <group slug | forum id (channel)>, label, labelNb?, definition, definitionNb?, sources?, slug? }.
// slug: optional permalink typed by the proposer (400 invalid/reserved, 409 taken); omitted → from the label.
// Answers { id, slug, threadId, versionId, path } (path: the concept's permalink).
export const POST = mmRoute({ mutation: true, tag: 'mm:concepts' }, async ({ request }, { space, userId }) => {
  const body = await readJsonObject(request);
  const forum = typeof body.forum === 'string' ? await getForumRef({ spaceId: space.id, ref: body.forum }) : null;
  if (!forum) throw new MmApiError(404, 'forum not found');
  const created = await createConcept({
    spaceId: space.id, forumId: forum.id, actorUserId: userId, label: body.label, labelNb: body.labelNb,
    definition: body.definition, definitionNb: body.definitionNb, sources: body.sources, slug: body.slug,
  });
  return json({ ...created, path: conceptPath(created.slug) }, 201);
});
