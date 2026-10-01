// DB-bound wrapper for the mm concepts core. Reads use the pool's retrying
// `query`; mutations check out one pooled client and bind `q` to it for the
// whole core call, so their BEGIN/…/COMMIT run on the same connection (same
// pattern as `writing/notes/space-notes.ts` reorderSpaceItem).
// createConcept, editDefinition, adoptPost, setLabels, renameConceptSlug and
// createRelation are transactional. Stances, settling and the relation view: relations.ts.

import { query, getClient } from '../db/pool';
import * as core from './concepts-core.ts';
import * as relations from './relations-core.ts';
import { mmDefinitionRenderCache, mmRendererFor } from './render.ts';
import type { MmLang } from './ui-lang.ts';
import type { QueryFn } from './concepts-core.ts';

export { ConceptError, CONCEPT_LANGS, CONCEPT_STATUSES, RELATION_TYPES } from './concepts-core.ts';
export type {
  ConceptView, ConceptVersionView, ConceptRelationView, ConceptListItem, ConceptLang, ConceptStatus, RelationType,
} from './concepts-core.ts';
export type { GraphNode, GraphEdge, GraphPayload } from './relations-core.ts';

const poolQ: QueryFn = (text, params) => query(text, params as any[]);

/** Runs `fn` with `q` bound to one pooled client (for core transactions). */
export async function onClient<T>(fn: (q: QueryFn) => Promise<T>): Promise<T> {
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
/**
 * Definitions render like forum posts (sanitized mm renderer: KaTeX, LilyPond
 * as same-origin /lily/<hash>.svg, citations against the concept's forum),
 * cached per version + lang + forum bibliography. `lang` picks the citation
 * locale (default en).
 */
export const getConcept = ({ lang = 'en', ...args }: Omit<Parameters<typeof core.getConcept>[1], 'render'> & { lang?: MmLang }) =>
  core.getConcept(poolQ, { ...args, render: mmRendererFor(mmDefinitionRenderCache, lang) });
export const listConcepts = (args: Parameters<typeof core.listConcepts>[1]) => core.listConcepts(poolQ, args);
export const graph = (args: Parameters<typeof relations.graph>[1]) => relations.graph(poolQ, args);

export const createConcept = (args: Parameters<typeof core.createConcept>[1]) =>
  onClient((q) => core.createConcept(q, args));
export const editDefinition = (args: Parameters<typeof core.editDefinition>[1]) =>
  onClient((q) => core.editDefinition(q, args));
export const adoptPost = (args: Parameters<typeof core.adoptPost>[1]) => onClient((q) => core.adoptPost(q, args));
export const setStatus = (args: Parameters<typeof core.setStatus>[1]) => core.setStatus(poolQ, args);
export const setLabels = (args: Parameters<typeof core.setLabels>[1]) => onClient((q) => core.setLabels(q, args));
/** Curators/admins: new slug, old one kept as a redirecting alias (transactional). */
export const renameConceptSlug = (args: Parameters<typeof core.renameConceptSlug>[1]) =>
  onClient((q) => core.renameConceptSlug(q, args));
/** Live slug → itself; rename alias → the concept's current slug; else null. */
export const resolveConceptSlug = (args: Parameters<typeof core.resolveConceptSlug>[1]) => core.resolveConceptSlug(poolQ, args);
// Transactional: the duplicate / hierarchy-cycle checks and the insert share one client.
export const createRelation = (args: Parameters<typeof relations.createRelation>[1]) =>
  onClient((q) => relations.createRelation(q, args));
export const deleteRelation = (args: Parameters<typeof relations.deleteRelation>[1]) => relations.deleteRelation(poolQ, args);
