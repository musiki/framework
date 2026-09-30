import { mmRoute } from '../../../../../lib/mm/api';
import { RELATION_ROUTES, relationHandlers } from '../../../../../lib/mm/relation-api';

export const prerender = false;

// { stance: 'agree' | 'disagree' | null } — members+ set; anyone signed in withdraws their own (null). Vote rate bucket.
export const POST = mmRoute(RELATION_ROUTES.stance, relationHandlers.stance);
