import { mmRoute, json } from '../../../lib/mm/api';
import { getCommonsRole } from '../../../lib/mm/concepts';
import { can, MM_ACTIONS } from '../../../lib/mm/policy';

export const prerender = false;

// The viewer's role in the mm commons space and what it allows (for the UI).
export const GET = mmRoute({ tag: 'mm:me' }, async ({ locals }, { space, userId }) => {
  const role = userId ? await getCommonsRole(space.id, userId) : null;
  const allowed = Object.fromEntries(MM_ACTIONS.map((a) => [a, can(role, a)]));
  const name = userId ? String(locals.session?.user?.name || '').trim() || null : null;
  return json({ signedIn: !!userId, name, role, can: allowed });
});
