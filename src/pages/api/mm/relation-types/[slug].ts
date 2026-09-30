import { mmRoute } from '../../../../lib/mm/api';
import { RELATION_ROUTES, relationHandlers } from '../../../../lib/mm/relation-api';

export const prerender = false;

// Public: the type with its definition concept (versions, thread), archived types too.
export const GET = mmRoute(RELATION_ROUTES.getType, relationHandlers.getType);
// Curators/admins: one change per request — a definition version, { archived }, or type fields.
export const PATCH = mmRoute(RELATION_ROUTES.patchType, relationHandlers.patchType);
