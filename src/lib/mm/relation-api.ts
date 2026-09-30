// DB-bound relation modeler API handlers (see relation-api-core.ts). Routes do:
//   export const GET = mmRoute(RELATION_ROUTES.listTypes, relationHandlers.listTypes);

import { relationApi } from './relation-api-core.ts';
import {
  listRelationTypes, getRelationType, createRelationType, updateRelationType, archiveRelationType, reorderRelationTypes,
} from './relation-types';
import { getRelationView, setStance, settleRelation } from './relations';
import { deleteRelation, editDefinition, graph } from './concepts';
import { getForumRef } from './forum';

export { RELATION_ROUTES } from './relation-api-core.ts';

export const relationHandlers = relationApi({
  listRelationTypes, getRelationType, createRelationType, updateRelationType, archiveRelationType, reorderRelationTypes,
  editDefinition, getForumRef, getRelationView, setStance, settleRelation, deleteRelation, graph,
});
