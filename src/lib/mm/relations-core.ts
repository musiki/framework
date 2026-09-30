// mm relations core: typed relations between concepts, their provenance, the
// concept graph with inferred relations and agreement totals (spec
// docs/superpowers/specs/2026-09-30-mm-relation-modeler-design.md, "Relation
// (instance)", "Inference", "Timeline").
//
// Pure module: no astro/db imports; `q` first. concepts-core re-exports
// createRelation / deleteRelation / graph from here (the import cycle is safe
// as long as nothing in this file uses a concepts-core binding at load time).
//
// Relations are written with "typeId" (FK RelationType) and the type's slug in
// the legacy "type" column; a DB trigger keeps the two in step and rejects a
// type of another space.
//
// Privacy: the graph carries no user fields at all. Agreement appears as
// totals only — who voted what is stances-core's business (blind, then
// revealed) and never part of the graph.

import {
  ConceptError, authorize, run, withTransaction, requireUuid, loadConceptById, isUniqueViolation, listConcepts,
  isConceptLang, RELATION_TYPE_KIND,
  type QueryFn, type ConceptLang, type ConceptStatus,
} from './concepts-core.ts';
import { listRelationTypes, type RelationTypeView, type RelationTypeFields } from './relation-types-core.ts';
import { inferRelations, wouldCloseCycle, hasCycle, MAX_INFERENCE_DEPTH } from './inference.ts';
import { definitionExcerpt, pickDefinition, type ViewLang } from './view.ts';

const TYPE_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// ---------------------------------------------------------------------------
// createRelation / deleteRelation
// ---------------------------------------------------------------------------

/**
 * A member relates two concepts of one space with a relation type of that
 * space, named by slug (`typeSlug`; `type` is the older name of the same
 * field). Optional provenance: `fromPostId`, a published post of the same
 * space where the relation was argued.
 *
 *  - archived type → 409; unknown type → 400;
 *  - duplicate → 409; for a symmetric type A–B and B–A are the same relation;
 *  - hierarchical types stay acyclic: a relation that closes a cycle → 409.
 *
 * One transaction (`q` must be one client): an advisory lock per type makes
 * the duplicate and cycle checks hold under concurrent writes.
 */
export async function createRelation(
  q: QueryFn,
  input: {
    sourceId: string;
    targetId: string;
    typeSlug?: unknown;
    /** Legacy name of `typeSlug`. */
    type?: unknown;
    fromPostId?: unknown;
    actorUserId: string | null;
  },
): Promise<{ id: string }> {
  const source = await loadConceptById(q, input.sourceId);
  if (source.kind === RELATION_TYPE_KIND) throw new ConceptError(404, 'concept not found');
  await authorize(q, source.spaceId, input.actorUserId, 'createRelation');
  const slug = input.typeSlug ?? input.type;
  if (typeof slug !== 'string' || slug.length > 48 || !TYPE_SLUG_RE.test(slug)) throw new ConceptError(400, 'invalid relation type');
  const targetId = requireUuid(input.targetId, 'target concept');
  if (targetId === source.id) throw new ConceptError(400, 'a concept cannot relate to itself');
  const target = await loadConceptById(q, targetId);
  if (target.kind === RELATION_TYPE_KIND) throw new ConceptError(404, 'target concept not found');
  if (target.spaceId !== source.spaceId) throw new ConceptError(400, 'concepts belong to different spaces');
  const spaceId = source.spaceId;

  const types = await run(
    q,
    `SELECT t.id, t.slug, t."symmetric", t.hierarchical, t."isArchived"
     FROM "RelationType" t WHERE t."spaceId" = $1::uuid AND t.slug = $2 LIMIT 1`,
    [spaceId, slug],
  );
  const type = types[0];
  if (!type) throw new ConceptError(400, 'invalid relation type');
  if (type.isArchived === true) throw new ConceptError(409, 'relation type is archived');

  let fromPostId: string | null = null;
  if (input.fromPostId !== undefined && input.fromPostId !== null && input.fromPostId !== '') {
    fromPostId = requireUuid(input.fromPostId, 'post');
    const posts = await run(
      q,
      `SELECT p.id FROM "ForumPost" p JOIN "ForumThread" t ON t.id = p."threadId"
       WHERE p.id = $1::uuid AND t."spaceId" = $2::uuid AND p.status = 'published' LIMIT 1`,
      [fromPostId, spaceId],
    );
    if (!posts.length) throw new ConceptError(404, 'post not found');
  }

  try {
    return await withTransaction(q, async () => {
      await run(q, 'SELECT pg_advisory_xact_lock(hashtext($1))', [`mm-relations:${type.id}`]);
      const existing = await run(
        q,
        `SELECT id FROM "ConceptRelation"
         WHERE "typeId" = $1::uuid
           AND (("sourceId" = $2::uuid AND "targetId" = $3::uuid)
             OR ($4::boolean AND "sourceId" = $3::uuid AND "targetId" = $2::uuid))
         LIMIT 1`,
        [type.id, source.id, target.id, type.symmetric === true],
      );
      if (existing.length) throw new ConceptError(409, 'relation already exists');
      if (type.hierarchical === true) {
        const same = await run(q, `SELECT "sourceId", "targetId" FROM "ConceptRelation" WHERE "typeId" = $1::uuid`, [type.id]);
        const edges = same.map((r: any) => ({ source: String(r.sourceId), target: String(r.targetId) }));
        if (wouldCloseCycle(edges, { source: source.id, target: target.id })) {
          throw new ConceptError(409, 'this relation would close a cycle in a hierarchical relation type');
        }
      }
      const rows = await run(
        q,
        `INSERT INTO "ConceptRelation" ("spaceId", "sourceId", "targetId", "typeId", type, "fromPostId", "createdBy")
         VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6::uuid, $7::uuid) RETURNING id`,
        [spaceId, source.id, target.id, type.id, type.slug, fromPostId, input.actorUserId],
      );
      if (!rows.length) throw new ConceptError(500, 'relation insert returned nothing');
      return { id: rows[0].id };
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new ConceptError(409, 'relation already exists');
    throw err;
  }
}

/** Members delete their own relations; curators/admins any. Its stances go with it (FK cascade). */
export async function deleteRelation(
  q: QueryFn,
  input: { relationId: string; actorUserId: string | null },
): Promise<{ deleted: true }> {
  const id = requireUuid(input.relationId, 'relation');
  const rows = await run(
    q,
    `SELECT id, "spaceId", "createdBy" FROM "ConceptRelation" WHERE id = $1::uuid LIMIT 1`,
    [id],
  );
  const rel = rows[0];
  if (!rel) throw new ConceptError(404, 'relation not found');
  await authorize(q, rel.spaceId, input.actorUserId, 'deleteRelation', () => ({
    isOwnRelation: !!rel.createdBy && rel.createdBy === input.actorUserId,
  }));
  await run(q, `DELETE FROM "ConceptRelation" WHERE id = $1::uuid`, [id]);
  return { deleted: true };
}

/**
 * `checkProperties` for relation-types-core.updateRelationType: the relations
 * that already use a type veto property changes they contradict — a type
 * cannot become hierarchical while its relations contain a cycle, nor
 * symmetric while a pair is related in both directions (they would become
 * duplicates). 409.
 */
export const relationTypePropertyCheck =
  (q: QueryFn) =>
  async (type: { id: string }, next: RelationTypeFields, prev: RelationTypeFields): Promise<void> => {
    const becomesHierarchical = next.hierarchical && !prev.hierarchical;
    const becomesSymmetric = next.symmetric && !prev.symmetric;
    if (!becomesHierarchical && !becomesSymmetric) return;
    const rows = await run(q, `SELECT "sourceId", "targetId" FROM "ConceptRelation" WHERE "typeId" = $1::uuid`, [type.id]);
    const edges = rows.map((r: any) => ({ source: String(r.sourceId), target: String(r.targetId) }));
    if (becomesHierarchical && hasCycle(edges)) {
      throw new ConceptError(409, 'relations of this type contain a cycle: it cannot become hierarchical');
    }
    if (becomesSymmetric) {
      const seen = new Set(edges.map((e) => `${e.source}>${e.target}`));
      if (edges.some((e) => seen.has(`${e.target}>${e.source}`))) {
        throw new ConceptError(409, 'some concepts are related in both directions: the type cannot become symmetric');
      }
    }
  };

// ---------------------------------------------------------------------------
// Graph (public read; no user fields)
// ---------------------------------------------------------------------------

export type GraphNode = {
  id: string; // slug
  label: string;
  labelNb: string | null;
  status: ConceptStatus;
  forum: string | null; // forum slug
  /** Plain-text excerpt of the current definition in the reader's language ('' when there is none). */
  excerpt: string;
  /** Language of the excerpt (the reader's, or the fallback); null when there is none. */
  excerptLang: ConceptLang | null;
  /** When the concept was proposed (timeline). */
  createdAt: string;
};

export type GraphEdge = {
  /** Relation id (for the stance/settle/delete APIs); null for an inferred relation. */
  id: string | null;
  source: string; // concept slug
  target: string; // concept slug
  /** Relation type slug (see `relationTypes`). */
  type: string;
  /** Computed by transitivity: never stored, never votable. */
  inferred: boolean;
  agree: number;
  disagree: number;
  /**
   * Asserted: when it was created. Inferred: the latest creation time along its
   * shortest supporting path, i.e. from when that path exists (timeline).
   */
  createdAt: string | null;
  /** A curator closed its discussion. */
  settled: boolean;
};

export type GraphPayload = { nodes: GraphNode[]; edges: GraphEdge[]; relationTypes: RelationTypeView[] };

export const GRAPH_EXCERPT_CHARS = 240;

const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : v ? String(v) : null);

/**
 * Concept graph for a space (optionally one forum). Nodes are concepts only
 * (relation types' definition concepts are never nodes) with a plain-text
 * excerpt of their current definition in `lang`. Edges: the asserted relations
 * between included nodes, with agreement totals, then the relations inferred
 * from the space's asserted ones (transitive types; depth ≤ 6) whose two ends
 * are included. `relationTypes`: the legend — the space's types, archived
 * ones only while relations still use them.
 */
export async function graph(
  q: QueryFn,
  { spaceId, forumId, status, lang }: { spaceId: string; forumId?: string | null; status?: string | null; lang?: ViewLang },
): Promise<GraphPayload> {
  const concepts = await listConcepts(q, { spaceId, forumId, status });
  const allTypes = await listRelationTypes(q, { spaceId, includeArchived: true });
  const relationTypes = allTypes.filter((t) => !t.isArchived || t.relationCount > 0);
  if (!concepts.length) return { nodes: [], edges: [], relationTypes };
  const slugById = new Map(concepts.map((c) => [c.id, c.slug]));
  // Totals only: no statement of the graph reads who holds a stance.
  const rels = await run(
    q,
    `SELECT r.id, r."sourceId", r."targetId", t.slug AS type, r."createdAt", (r."settledAt" IS NOT NULL) AS settled,
            (SELECT count(*) FROM "ConceptRelationStance" s WHERE s."relationId" = r.id AND s.stance = 'agree')::int AS agree,
            (SELECT count(*) FROM "ConceptRelationStance" s WHERE s."relationId" = r.id AND s.stance = 'disagree')::int AS disagree
     FROM "ConceptRelation" r
     JOIN "RelationType" t ON t.id = r."typeId"
     WHERE r."spaceId" = $1::uuid
     ORDER BY r."createdAt" ASC, r.id ASC`,
    [spaceId],
  );
  // Latest definition per concept and language (bounded: only the head of a long text is needed).
  const defRows = await run(
    q,
    `SELECT DISTINCT ON (v."conceptId", v.lang) v."conceptId", v.lang, left(v.definition, 4000) AS definition
     FROM "ConceptVersion" v
     WHERE v."conceptId" = ANY($1::uuid[])
     ORDER BY v."conceptId", v.lang, v."createdAt" DESC, v.id DESC`,
    [concepts.map((c) => c.id)],
  );
  const defs = new Map<string, Partial<Record<string, { lang: string; definition: string }>>>();
  for (const r of defRows) {
    if (!isConceptLang(r.lang)) continue;
    const byLang = defs.get(r.conceptId) ?? {};
    byLang[r.lang] = { lang: r.lang, definition: String(r.definition ?? '') };
    defs.set(r.conceptId, byLang);
  }
  const nodes: GraphNode[] = concepts.map((c) => {
    const pick = pickDefinition(defs.get(c.id) ?? {}, lang ?? 'en');
    const excerpt = pick.version ? definitionExcerpt(pick.version.definition, GRAPH_EXCERPT_CHARS) : '';
    return {
      id: c.slug,
      label: c.label,
      labelNb: c.labelNb,
      status: c.status,
      forum: c.forum?.slug ?? null,
      excerpt,
      excerptLang: excerpt && pick.lang && isConceptLang(pick.lang) ? pick.lang : null,
      createdAt: iso(c.createdAt) ?? '',
    };
  });

  const edges: GraphEdge[] = [];
  for (const r of rels) {
    const source = slugById.get(r.sourceId);
    const target = slugById.get(r.targetId);
    if (!source || !target) continue;
    edges.push({
      id: r.id, source, target, type: r.type, inferred: false,
      agree: Number(r.agree) || 0, disagree: Number(r.disagree) || 0, createdAt: iso(r.createdAt), settled: r.settled === true,
    });
  }

  // Inference runs over ALL asserted relations of the space (a path may pass
  // through a concept the forum/status filter leaves out); an inferred relation
  // is shown when both its ends are.
  const properties = new Map(allTypes.map((t) => [t.slug, t]));
  const asserted = rels.map((r: any) => ({ source: String(r.sourceId), target: String(r.targetId), type: String(r.type) }));
  for (const inf of inferRelations(asserted, properties, { maxDepth: MAX_INFERENCE_DEPTH })) {
    const source = slugById.get(inf.source);
    const target = slugById.get(inf.target);
    if (!source || !target) continue;
    let createdAt: string | null = null;
    for (const i of inf.via) {
      const at = iso(rels[i].createdAt);
      if (at && (!createdAt || new Date(at).getTime() > new Date(createdAt).getTime())) createdAt = at;
    }
    edges.push({ id: null, source, target, type: inf.type, inferred: true, agree: 0, disagree: 0, createdAt, settled: false });
  }
  return { nodes, edges, relationTypes };
}
