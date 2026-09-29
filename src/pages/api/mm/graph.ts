import { mmRoute, json } from '../../../lib/mm/api';
import { graph } from '../../../lib/mm/concepts';
import { getForum } from '../../../lib/mm/forum';

export const prerender = false;

// Public: { nodes, edges } keyed by concept slug; ?forum=<slug>&status=<status>.
export const GET = mmRoute({ tag: 'mm:graph' }, async ({ url }, { space }) => {
  const forumSlug = url.searchParams.get('forum');
  let forumId: string | null = null;
  if (forumSlug) {
    const forum = await getForum({ spaceId: space.id, slug: forumSlug });
    if (!forum) return json({ nodes: [], edges: [] });
    forumId = forum.id;
  }
  return json(await graph({ spaceId: space.id, forumId, status: url.searchParams.get('status') || null }));
});
