// DB-bound wrapper for the mm concepts core. Reads use the pool's retrying
// `query`; mutations check out one pooled client and bind `q` to it for the
// whole core call, so their BEGIN/…/COMMIT run on the same connection (same
// pattern as `writing/notes/space-notes.ts` reorderSpaceItem).
// createConcept, editDefinition, adoptPost and setLabels are transactional.

import { query, getClient } from '../db/pool';
import * as core from './concepts-core.ts';
import type { QueryFn } from './concepts-core.ts';

export { ConceptError, CONCEPT_LANGS, CONCEPT_STATUSES, RELATION_TYPES } from './concepts-core.ts';
export type {
  ConceptView, ConceptVersionView, ConceptRelationView, ConceptListItem, GraphNode, GraphEdge, ConceptLang,
  ConceptStatus, RelationType,
} from './concepts-core.ts';

const poolQ: QueryFn = (text, params) => query(text, params as any[]);

async function onClient<T>(fn: (q: QueryFn) => Promise<T>): Promise<T> {
  const client = await getClient();
  // Set when a ROLLBACK itself failed: the connection's transaction state is
  // then unknown and it must not go back to the pool.
  let rollbackFailed = false;
  const q: QueryFn = async (text, params = []) => {
    try {
      const res = await client.query(text, params as any[]);
      return { data: res.rows, error: null };
    } catch (error) {
      if (text === 'ROLLBACK') rollbackFailed = true;
      return { data: null, error };
    }
  };
  try {
    const result = await fn(q);
    client.release();
    return result;
  } catch (err) {
    // Expected domain errors (400/401/403/404/409) leave a clean connection —
    // before BEGIN, or after a successful ROLLBACK — so it is reused. Database
    // / unknown errors, or a failed ROLLBACK, destroy the connection.
    if (core.shouldDestroyClient(err, rollbackFailed)) client.release(err instanceof Error ? err : new Error(String(err)));
    else client.release();
    throw err;
  }
}

export const getCommonsRole = (spaceId: string, userId: string | null) => core.getCommonsRole(poolQ, spaceId, userId);
export const getConcept = (args: Parameters<typeof core.getConcept>[1]) => core.getConcept(poolQ, args);
export const listConcepts = (args: Parameters<typeof core.listConcepts>[1]) => core.listConcepts(poolQ, args);
export const graph = (args: Parameters<typeof core.graph>[1]) => core.graph(poolQ, args);

export const createConcept = (args: Parameters<typeof core.createConcept>[1]) =>
  onClient((q) => core.createConcept(q, args));
export const editDefinition = (args: Parameters<typeof core.editDefinition>[1]) =>
  onClient((q) => core.editDefinition(q, args));
export const adoptPost = (args: Parameters<typeof core.adoptPost>[1]) => onClient((q) => core.adoptPost(q, args));
export const setStatus = (args: Parameters<typeof core.setStatus>[1]) => core.setStatus(poolQ, args);
export const setLabels = (args: Parameters<typeof core.setLabels>[1]) => onClient((q) => core.setLabels(q, args));
export const createRelation = (args: Parameters<typeof core.createRelation>[1]) => core.createRelation(poolQ, args);
export const deleteRelation = (args: Parameters<typeof core.deleteRelation>[1]) => core.deleteRelation(poolQ, args);
