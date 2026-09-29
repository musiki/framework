import { mmRoute, json, readJsonObject } from '../../../../../lib/mm/api';
import { createThread, getForum, listThreads } from '../../../../../lib/mm/forum';

export const prerender = false;

export const GET = mmRoute({ tag: 'mm:threads' }, async ({ params }, { space, userId }) => {
  const forum = await getForum({ spaceId: space.id, slug: String(params.slug || '') });
  if (!forum) return json({ error: 'Not found' }, 404);
  return json({ threads: await listThreads({ spaceId: space.id, forumId: forum.id, viewerUserId: userId }) });
});

// Members+: new thread with its first post (optional move).
export const POST = mmRoute({ mutation: true, tag: 'mm:threads' }, async ({ request, params }, { space, userId }) => {
  const body = await readJsonObject(request);
  const forum = await getForum({ spaceId: space.id, slug: String(params.slug || '') });
  if (!forum) return json({ error: 'Not found' }, 404);
  const created = await createThread({
    spaceId: space.id, forumId: forum.id, actorUserId: userId, title: body.title, body: body.body, move: body.move,
  });
  return json(created, 201);
});
