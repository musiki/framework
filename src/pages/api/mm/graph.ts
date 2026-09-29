import { mmRoute, json } from '../../../lib/mm/api';
import { graph } from '../../../lib/mm/concepts';
import { getForumRef } from '../../../lib/mm/forum';

export const prerender = false;

// Public: { nodes, edges } keyed by concept slug; ?forum=<group slug | forum id>&status=<status>.
export const GET = mmRoute({ tag: 'mm:graph' }, async ({ url }, { space }) => {
  const forumSlug = url.searchParams.get('forum');
  let forumId: string | null = null;
  if (forumSlug) {
    const forum = await getForumRef({ spaceId: space.id, ref: forumSlug });
    if (!forum) return json({ nodes: [], edges: [] });
    forumId = forum.id;
  }
  return json(await graph({ spaceId: space.id, forumId, status: url.searchParams.get('status') || null }));
});
