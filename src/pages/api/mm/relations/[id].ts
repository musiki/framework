import { mmRoute } from '../../../../lib/mm/api';
import { RELATION_ROUTES, relationHandlers } from '../../../../lib/mm/relation-api';

export const prerender = false;

// Public: totals, own stance, reveal date; names only once revealed and only to members (SQL-enforced).
export const GET = mmRoute(RELATION_ROUTES.getRelation, relationHandlers.getRelation);
// Curators/admins delete any relation; members their own while it is unsettled and nobody else took a stance.
export const DELETE = mmRoute(RELATION_ROUTES.deleteRelation, relationHandlers.deleteRelation);
