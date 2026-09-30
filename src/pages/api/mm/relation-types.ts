import { mmRoute } from '../../../lib/mm/api';
import { RELATION_ROUTES, relationHandlers } from '../../../lib/mm/relation-api';

export const prerender = false;

// Public: { relationTypes } in legend order (?archived=1 includes archived types).
export const GET = mmRoute(RELATION_ROUTES.listTypes, relationHandlers.listTypes);
// Curators/admins: create a type with its definition concept, thread and v1 definition.
export const POST = mmRoute(RELATION_ROUTES.createType, relationHandlers.createType);
// Curators/admins: { slugs } — legend order.
export const PUT = mmRoute(RELATION_ROUTES.reorderTypes, relationHandlers.reorderTypes);
