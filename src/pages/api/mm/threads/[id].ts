import { mmRoute, json, requireUuidParam } from '../../../../lib/mm/api';
import { listPosts } from '../../../../lib/mm/forum';

export const prerender = false;

// Public: thread + posts. `bodyHtml` is rendered and sanitized by the core;
// `body` is the markdown source (JSON text, null when hidden/deleted).
export const GET = mmRoute({ tag: 'mm:thread' }, async ({ params }, { space, userId }) => {
  const threadId = requireUuidParam(params.id, 'thread id');
  const view = await listPosts({ spaceId: space.id, threadId, viewerUserId: userId });
  if (!view) return json({ error: 'Not found' }, 404);
  return json(view);
});
