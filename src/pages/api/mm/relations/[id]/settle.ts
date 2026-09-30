import { mmRoute } from '../../../../../lib/mm/api';
import { RELATION_ROUTES, relationHandlers } from '../../../../../lib/mm/relation-api';

export const prerender = false;

// Curators/admins: settle the relation (final) — its stances are revealed to members.
export const POST = mmRoute(RELATION_ROUTES.settle, relationHandlers.settle);
