import { mmRoute } from '../../../lib/mm/api';
import { RELATION_ROUTES, relationHandlers } from '../../../lib/mm/relation-api';

export const prerender = false;

// Public: { nodes, edges, relationTypes } keyed by concept slug; ?forum=<group slug | forum id>&status=<status>&lang=en|nb|nn
// (language of each node's plain-text `excerpt`, default en). Edges carry type, inferred, agree/disagree totals,
// createdAt and settled — never who took a stance.
export const GET = mmRoute(RELATION_ROUTES.graph, relationHandlers.graph);
