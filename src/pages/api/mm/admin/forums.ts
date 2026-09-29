import { mmRoute, json } from '../../../../lib/mm/api';
import { listForumsAdmin } from '../../../../lib/mm/forum';

export const prerender = false;

// Curators/admins: all forums incl. archived, with full settings (ownerEmail).
export const GET = mmRoute({ auth: true, tag: 'mm:admin:forums' }, async (_ctx, { space, userId }) =>
  json({ forums: await listForumsAdmin({ spaceId: space.id, actorUserId: userId }) }));
