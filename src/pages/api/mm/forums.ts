import { mmRoute, json, readJsonObject } from '../../../lib/mm/api';
import { createForum, listForums } from '../../../lib/mm/forum';

export const prerender = false;

export const GET = mmRoute({ tag: 'mm:forums' }, async (_ctx, { space }) =>
  json({ forums: await listForums({ spaceId: space.id }) }));

// Curators/admins (policy enforced in the core).
export const POST = mmRoute({ mutation: true, tag: 'mm:forums' }, async ({ request }, { space, userId }) => {
  const body = await readJsonObject(request);
  const forum = await createForum({
    spaceId: space.id, actorUserId: userId, title: body.title, slug: body.slug,
    description: body.description, settings: body.settings,
  });
  return json({ forum }, 201);
});
