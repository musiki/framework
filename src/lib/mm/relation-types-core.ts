// mm relation types core: the space-wide vocabulary of relations (spec
// docs/superpowers/specs/2026-09-30-mm-relation-modeler-design.md, "RelationType").
//
// A relation type is a RelationType row (label/inverse, visual encoding from the
// MishMash palette, logical properties) linked 1:1 to a Concept of kind
// 'relation-type' with slug `rel:<type slug>`: its definition versions, credits
// and discussion thread reuse the concept machinery (getConcept / editDefinition
// / adoptPost in concepts-core). Such concepts are never concept-list rows or
// graph nodes.
//
// Pure module: no astro/db imports; `q` first (relation-types.ts binds it).
// Reads are public and expose no user fields (the definition concept's credits
// are display names, as for any concept). Writes need `manageRelationTypes`
// (curator, admin). Built-in types are editable but can be neither archived nor
// deleted; nothing here deletes a type — a type in use is archived.
//
// SQL note: "symmetric" is a reserved word in Postgres and is always quoted.

import {
  ConceptError, authorize, run, withTransaction, requireUuid, insertVersion, cleanDefinition, cleanSources,
  cleanLabel, cleanOptionalLabel, isUniqueViolation, getConcept,
  type QueryFn, type ConceptView, type DefinitionRender,
} from './concepts-core.ts';
import { isUuid } from '../tenant/space-roles.ts';
import { slugify } from '../site/frontmatter.ts';
import { hasCycle } from './inference.ts';

/** Palette slots (brand tokens --mm-<slot>); never a free colour. */
export const RELATION_COLORS = ['green', 'purple', 'blue', 'pink', 'yellow', 'red', 'ink'] as const;
export type RelationColor = (typeof RELATION_COLORS)[number];
export const RELATION_STROKES = ['solid', 'dashed', 'dotted', 'double'] as const;
export type RelationStroke = (typeof RELATION_STROKES)[number];
export const RELATION_RENDERS = ['line', 'area'] as const;
export type RelationRender = (typeof RELATION_RENDERS)[number];

/**
 * Advisory lock key (pg_advisory_xact_lock(hashtext(key))) that serializes
 * everything that depends on the set of relations of one type: creating a
 * relation (duplicate / hierarchy-cycle checks) and changing the type's logical
 * properties (which are checked against those relations).
 */
export const relationsLockKey = (typeId: string) => `mm-relations:${typeId}`;

/** Slug of the definition Concept of relation type `slug` (the colon cannot come out of slugify). */
export const relationTypeConceptSlug = (slug: string) => `rel:${slug}`;

const TYPE_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TYPE_SLUG_MAX = 48;
const SKOS_RE = /^[A-Za-z][A-Za-z0-9]*:[A-Za-z][A-Za-z0-9_-]*$/;
const WIKIDATA_RE = /^[PQ][1-9][0-9]{0,11}$/;
const MAPPING_MAX = 100;

export type RelationTypeFields = {
  label: string;
  labelNb: string | null;
  inverseLabel: string | null;
  inverseLabelNb: string | null;
  render: RelationRender;
  stroke: RelationStroke;
  arrow: boolean;
  color: RelationColor;
  symmetric: boolean;
  transitive: boolean;
  hierarchical: boolean;
  skos: string | null;
  wikidata: string | null;
};

export type RelationTypeView = RelationTypeFields & {
  slug: string;
  position: number;
  isBuiltin: boolean;
  isArchived: boolean;
  createdAt: string;
  /** Asserted relations of this type in the space. */
  relationCount: number;
};

const FIELD_KEYS = [
  'label', 'labelNb', 'inverseLabel', 'inverseLabelNb', 'render', 'stroke', 'arrow', 'color',
  'symmetric', 'transitive', 'hierarchical', 'skos', 'wikidata',
] as const;
/** The editable fields of a type (what a create/update body may carry besides slug/definition). */
export const RELATION_TYPE_FIELD_KEYS: readonly string[] = FIELD_KEYS;

const DEFAULTS: Omit<RelationTypeFields, 'label'> = {
  labelNb: null, inverseLabel: null, inverseLabelNb: null, render: 'line', stroke: 'solid', arrow: true, color: 'ink',
  symmetric: false, transitive: false, hierarchical: false, skos: null, wikidata: null,
};

function oneOf<T extends string>(raw: unknown, allowed: readonly T[], field: string): T {
  if (typeof raw !== 'string' || !(allowed as readonly string[]).includes(raw)) throw new ConceptError(400, `invalid ${field}`);
  return raw as T;
}

function bool(raw: unknown, field: string): boolean {
  if (typeof raw !== 'boolean') throw new ConceptError(400, `${field} must be true or false`);
  return raw;
}

function mapping(raw: unknown, re: RegExp, field: string): string | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string') throw new ConceptError(400, `invalid ${field}`);
  const s = raw.trim();
  if (!s) return null;
  if (s.length > MAPPING_MAX || !re.test(s)) throw new ConceptError(400, `invalid ${field}`);
  return s;
}

/**
 * Validates relation type fields. `base` is the current state for an update
 * (absent keys keep their value) or the defaults for a create. Throws 400.
 * Rules beyond the enums: `area` needs `hierarchical`; a type cannot be both
 * symmetric and hierarchical (hierarchical implies directed).
 */
export function cleanRelationTypeFields(raw: unknown, base?: RelationTypeFields): RelationTypeFields {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ConceptError(400, 'relation type must be an object');
  const r = raw as Record<string, unknown>;
  const has = (k: string) => r[k] !== undefined;
  const b = base ?? ({ label: '', ...DEFAULTS } as RelationTypeFields);
  const out: RelationTypeFields = {
    label: has('label') || !base ? cleanLabel(r.label) : b.label,
    labelNb: has('labelNb') ? cleanOptionalLabel(r.labelNb, 'labelNb') : b.labelNb,
    inverseLabel: has('inverseLabel') ? cleanOptionalLabel(r.inverseLabel, 'inverseLabel') : b.inverseLabel,
    inverseLabelNb: has('inverseLabelNb') ? cleanOptionalLabel(r.inverseLabelNb, 'inverseLabelNb') : b.inverseLabelNb,
    render: has('render') ? oneOf(r.render, RELATION_RENDERS, 'render') : b.render,
    stroke: has('stroke') ? oneOf(r.stroke, RELATION_STROKES, 'stroke') : b.stroke,
    arrow: has('arrow') ? bool(r.arrow, 'arrow') : b.arrow,
    color: has('color') ? oneOf(r.color, RELATION_COLORS, 'color') : b.color,
    symmetric: has('symmetric') ? bool(r.symmetric, 'symmetric') : b.symmetric,
    transitive: has('transitive') ? bool(r.transitive, 'transitive') : b.transitive,
    hierarchical: has('hierarchical') ? bool(r.hierarchical, 'hierarchical') : b.hierarchical,
    skos: has('skos') ? mapping(r.skos, SKOS_RE, 'skos') : b.skos,
    wikidata: has('wikidata') ? mapping(r.wikidata, WIKIDATA_RE, 'wikidata') : b.wikidata,
  };
  if (out.render === 'area' && !out.hierarchical) throw new ConceptError(400, 'an area relation type must be hierarchical');
  if (out.symmetric && out.hierarchical) throw new ConceptError(400, 'a relation type cannot be both symmetric and hierarchical');
  return out;
}

/** Slug of a new type: the given one (validated) or derived from the English label. */
export function relationTypeSlug(rawSlug: unknown, label: string): string {
  if (rawSlug !== undefined && rawSlug !== null && rawSlug !== '') {
    if (typeof rawSlug !== 'string' || rawSlug.length > TYPE_SLUG_MAX || !TYPE_SLUG_RE.test(rawSlug)) {
      throw new ConceptError(400, 'invalid slug');
    }
    return rawSlug;
  }
  const s = slugify(label).slice(0, TYPE_SLUG_MAX).replace(/-+$/, '');
  // slugify falls back to 'page' for labels without any usable character.
  if (!s || !TYPE_SLUG_RE.test(s) || (s === 'page' && !/page/i.test(label))) throw new ConceptError(400, 'invalid slug');
  return s;
}

// ---------------------------------------------------------------------------
// Reads (public)
// ---------------------------------------------------------------------------

const TYPE_COLUMNS = `t.slug, t.label, t."labelNb", t."inverseLabel", t."inverseLabelNb", t.render, t.stroke, t.arrow, t.color,
            t."symmetric", t.transitive, t.hierarchical, t.skos, t.wikidata, t."position", t."isBuiltin", t."isArchived", t."createdAt",
            (SELECT count(*) FROM "ConceptRelation" r WHERE r."typeId" = t.id)::int AS "relationCount"`;

const toView = (r: any): RelationTypeView => ({
  slug: r.slug,
  label: r.label,
  labelNb: r.labelNb ?? null,
  inverseLabel: r.inverseLabel ?? null,
  inverseLabelNb: r.inverseLabelNb ?? null,
  render: r.render,
  stroke: r.stroke,
  arrow: r.arrow === true,
  color: r.color,
  symmetric: r.symmetric === true,
  transitive: r.transitive === true,
  hierarchical: r.hierarchical === true,
  skos: r.skos ?? null,
  wikidata: r.wikidata ?? null,
  position: Number(r.position) || 0,
  isBuiltin: r.isBuiltin === true,
  isArchived: r.isArchived === true,
  createdAt: r.createdAt,
  relationCount: Number(r.relationCount) || 0,
});

/**
 * Seeds the five built-in types in a commons space that has no relation type
 * at all (spaces created after the migration). Idempotent (the SQL function
 * never overwrites rows); returns whether it ran.
 */
export async function ensureBuiltinRelationTypes(q: QueryFn, spaceId: string): Promise<boolean> {
  const rows = await run(
    q,
    `SELECT mm_seed_relation_types(s.id) AS created FROM "Space" s
     WHERE s.id = $1::uuid AND s.kind = 'commons'
       AND NOT EXISTS (SELECT 1 FROM "RelationType" t WHERE t."spaceId" = s.id)`,
    [spaceId],
  );
  return rows.length > 0;
}

/** The space's relation types in legend order; archived ones only on request. No user fields. */
export async function listRelationTypes(
  q: QueryFn,
  { spaceId, includeArchived = false }: { spaceId: string; includeArchived?: boolean },
): Promise<RelationTypeView[]> {
  if (typeof spaceId !== 'string' || !isUuid(spaceId)) return [];
  const load = () =>
    run(
      q,
      `SELECT ${TYPE_COLUMNS}
     FROM "RelationType" t
     WHERE t."spaceId" = $1::uuid AND ($2::boolean OR t."isArchived" = false)
     ORDER BY t."position" ASC, t."createdAt" ASC, t.id ASC`,
      [spaceId, includeArchived === true],
    );
  let rows = await load();
  if (!rows.length && (await ensureBuiltinRelationTypes(q, spaceId))) rows = await load();
  return rows.map(toView);
}

export type RelationTypeDetail = RelationTypeView & {
  /** The definition concept (versions, credits, thread): same view as a concept page. */
  concept: ConceptView | null;
};

/** One type (archived ones too: their page stays) with its definition concept; null when unknown. */
export async function getRelationType(
  q: QueryFn,
  { spaceId, slug, viewerUserId = null, render }: { spaceId: string; slug: string; viewerUserId?: string | null; render?: DefinitionRender },
): Promise<RelationTypeDetail | null> {
  if (typeof spaceId !== 'string' || !isUuid(spaceId) || typeof slug !== 'string' || !TYPE_SLUG_RE.test(slug)) return null;
  const rows = await run(
    q,
    `SELECT ${TYPE_COLUMNS}, c.slug AS "conceptSlug"
     FROM "RelationType" t
     JOIN "Concept" c ON c.id = t."conceptId"
     WHERE t."spaceId" = $1::uuid AND t.slug = $2
     LIMIT 1`,
    [spaceId, slug],
  );
  const row = rows[0];
  if (!row) return null;
  const concept = await getConcept(q, { spaceId, slug: row.conceptSlug, viewerUserId, render, kind: 'relation-type' });
  return { ...toView(row), concept };
}

export type TypeRelationItem = {
  id: string;
  source: { slug: string; label: string; labelNb: string | null };
  target: { slug: string; label: string; labelNb: string | null };
  createdAt: string;
  agree: number;
  disagree: number;
  settled: boolean;
};

export const TYPE_RELATIONS_LIMIT = 500;

/**
 * The asserted relations of one type (its page lists them), oldest first,
 * at most `limit`. Public: concept slugs/labels, agreement totals, settled
 * flag — no user fields, no stance rows. Unknown type → [].
 */
export async function listRelationsOfType(
  q: QueryFn,
  { spaceId, slug, limit = TYPE_RELATIONS_LIMIT }: { spaceId: string; slug: string; limit?: number },
): Promise<TypeRelationItem[]> {
  if (typeof spaceId !== 'string' || !isUuid(spaceId) || typeof slug !== 'string' || !TYPE_SLUG_RE.test(slug)) return [];
  const n = Math.max(1, Math.min(TYPE_RELATIONS_LIMIT, Math.floor(Number(limit)) || TYPE_RELATIONS_LIMIT));
  const rows = await run(
    q,
    `SELECT r.id, r."createdAt", (r."settledAt" IS NOT NULL) AS settled,
            s.slug AS "sourceSlug", s.label AS "sourceLabel", s."labelNb" AS "sourceLabelNb",
            o.slug AS "targetSlug", o.label AS "targetLabel", o."labelNb" AS "targetLabelNb",
            (SELECT count(*) FROM "ConceptRelationStance" x WHERE x."relationId" = r.id AND x.stance = 'agree')::int AS agree,
            (SELECT count(*) FROM "ConceptRelationStance" x WHERE x."relationId" = r.id AND x.stance = 'disagree')::int AS disagree
     FROM "ConceptRelation" r
     JOIN "RelationType" t ON t.id = r."typeId"
     JOIN "Concept" s ON s.id = r."sourceId"
     JOIN "Concept" o ON o.id = r."targetId"
     WHERE t."spaceId" = $1::uuid AND t.slug = $2 AND r."spaceId" = $1::uuid
     ORDER BY r."createdAt" ASC, r.id ASC
     LIMIT $3`,
    [spaceId, slug, n],
  );
  return rows.map((r: any) => ({
    id: String(r.id),
    source: { slug: r.sourceSlug, label: r.sourceLabel, labelNb: r.sourceLabelNb ?? null },
    target: { slug: r.targetSlug, label: r.targetLabel, labelNb: r.targetLabelNb ?? null },
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt ?? ''),
    agree: Number(r.agree) || 0,
    disagree: Number(r.disagree) || 0,
    settled: r.settled === true,
  }));
}

// ---------------------------------------------------------------------------
// Writes (curator, admin)
// ---------------------------------------------------------------------------

type TypeRow = RelationTypeFields & { id: string; slug: string; conceptId: string; isBuiltin: boolean; isArchived: boolean; threadId: string | null };

async function loadTypeRow(q: QueryFn, spaceId: string, slug: unknown, forUpdate = false): Promise<TypeRow> {
  if (typeof slug !== 'string' || !TYPE_SLUG_RE.test(slug)) throw new ConceptError(404, 'relation type not found');
  const rows = await run(
    q,
    `SELECT t.id, t.slug, t."conceptId", t.label, t."labelNb", t."inverseLabel", t."inverseLabelNb", t.render, t.stroke, t.arrow,
            t.color, t."symmetric", t.transitive, t.hierarchical, t.skos, t.wikidata, t."isBuiltin", t."isArchived",
            (SELECT c."threadId" FROM "Concept" c WHERE c.id = t."conceptId") AS "threadId"
     FROM "RelationType" t
     WHERE t."spaceId" = $1::uuid AND t.slug = $2
     LIMIT 1${forUpdate ? ' FOR UPDATE OF t' : ''}`,
    [spaceId, slug],
  );
  if (!rows.length) throw new ConceptError(404, 'relation type not found');
  return rows[0];
}

/**
 * Creates a relation type: its definition Concept (kind 'relation-type', slug
 * `rel:<slug>`), the discussion thread and v1 of the English definition
 * (credited to the actor; optional hand-written Bokmål v1), then the
 * RelationType row at the end of the legend. The thread goes to `forumId` or,
 * when none is given, to the space's first group; a space without forums gets
 * a type without a thread. One transaction; `q` must be one client.
 */
export async function createRelationType(
  q: QueryFn,
  input: {
    spaceId: string;
    actorUserId: string | null;
    type: unknown;
    slug?: unknown;
    definition: unknown;
    definitionNb?: unknown;
    sources?: unknown;
    forumId?: string | null;
  },
): Promise<{ slug: string; conceptSlug: string; threadId: string | null; versionId: string }> {
  const spaceId = requireUuid(input.spaceId, 'space');
  await authorize(q, spaceId, input.actorUserId, 'manageRelationTypes');
  const actor = input.actorUserId as string;
  const fields = cleanRelationTypeFields(input.type);
  const slug = relationTypeSlug(input.slug, fields.label);
  const definition = cleanDefinition(input.definition);
  const definitionNb =
    input.definitionNb === undefined || input.definitionNb === null || String(input.definitionNb).trim() === ''
      ? null
      : cleanDefinition(input.definitionNb);
  const sources = cleanSources(input.sources);

  // The board of the discussion thread: the given forum/channel, else the first group.
  let board: { id: string; parentId: string | null } | null = null;
  if (input.forumId) {
    const forumId = requireUuid(input.forumId, 'forum');
    const rows = await run(
      q,
      `SELECT b.id, b."parentId" FROM "ForumBoard" b LEFT JOIN "ForumBoard" pb ON pb.id = b."parentId"
       WHERE b.id = $1::uuid AND b."spaceId" = $2::uuid AND b."isArchived" = false AND pb."isArchived" IS NOT TRUE LIMIT 1`,
      [forumId, spaceId],
    );
    if (!rows.length) throw new ConceptError(404, 'forum not found');
    board = rows[0];
  } else {
    const rows = await run(
      q,
      `SELECT b.id, b."parentId" FROM "ForumBoard" b
       WHERE b."spaceId" = $1::uuid AND b."parentId" IS NULL AND b."isArchived" = false
       ORDER BY b."position" ASC NULLS LAST, b."createdAt" ASC, b.id ASC LIMIT 1`,
      [spaceId],
    );
    board = rows[0] ?? null;
  }
  const conceptSlug = relationTypeConceptSlug(slug);

  try {
    return await withTransaction(q, async () => {
      await run(q, 'SELECT pg_advisory_xact_lock(hashtext($1))', [`mm-relation-type:${spaceId}`]);
      const existing = await run(
        q,
        `SELECT slug, "position" FROM "RelationType" WHERE "spaceId" = $1::uuid ORDER BY "position" DESC`,
        [spaceId],
      );
      if (existing.some((r: any) => r.slug === slug)) throw new ConceptError(409, 'relation type already exists');
      const position = existing.reduce((max: number, r: any) => Math.max(max, Number(r.position) || 0), 0) + 1;

      let threadId: string | null = null;
      if (board) {
        const thread = await run(
          q,
          `INSERT INTO "ForumThread" ("spaceId", "boardId", title, "createdByUserId")
           VALUES ($1::uuid, $2::uuid, $3, $4::uuid) RETURNING id`,
          [spaceId, board.id, fields.label, actor],
        );
        threadId = thread[0]?.id ?? null;
        if (!threadId) throw new ConceptError(500, 'thread insert returned nothing');
      }

      const concept = await run(
        q,
        `INSERT INTO "Concept" ("spaceId", "forumId", slug, label, "labelNb", kind, "threadId", "createdBy")
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, 'relation-type', $6::uuid, $7::uuid) RETURNING id`,
        [spaceId, board ? (board.parentId ?? board.id) : null, conceptSlug, fields.label, fields.labelNb, threadId, actor],
      );
      const conceptId = concept[0]?.id;
      if (!conceptId) throw new ConceptError(500, 'concept insert returned nothing');

      const v1 = await insertVersion(q, { conceptId, lang: 'en', definition, sources, editedBy: actor, creditedUserId: actor });
      if (definitionNb) {
        await insertVersion(q, { conceptId, lang: 'nb', definition: definitionNb, sources, editedBy: actor, creditedUserId: actor });
      }

      const created = await run(
        q,
        `INSERT INTO "RelationType" (
           "spaceId", "conceptId", slug, label, "labelNb", "inverseLabel", "inverseLabelNb", render, stroke, arrow, color,
           "symmetric", transitive, hierarchical, skos, wikidata, "position", "isBuiltin", "createdBy")
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, false, $18::uuid)
         RETURNING id`,
        [
          spaceId, conceptId, slug, fields.label, fields.labelNb, fields.inverseLabel, fields.inverseLabelNb, fields.render,
          fields.stroke, fields.arrow, fields.color, fields.symmetric, fields.transitive, fields.hierarchical, fields.skos,
          fields.wikidata, position, actor,
        ],
      );
      if (!created.length) throw new ConceptError(500, 'relation type insert returned nothing');
      return { slug, conceptSlug, threadId, versionId: v1.id };
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new ConceptError(409, 'relation type already exists');
    throw err;
  }
}

/**
 * Edits a type's labels, encoding, properties and mappings (the slug never
 * changes; built-ins are editable). The definition concept's labels and its
 * thread title follow the English label. One transaction; `q` one client.
 *
 * The relations that already use the type veto property changes they
 * contradict (409): a type cannot become hierarchical while its relations
 * contain a cycle, nor symmetric while two concepts are related in both
 * directions (they would become duplicates). The check runs under the type's
 * relations lock (the one createRelation takes), acquired BEFORE the row lock,
 * so no relation can slip in between the check and the commit.
 */
export async function updateRelationType(
  q: QueryFn,
  input: {
    spaceId: string;
    slug: string;
    actorUserId: string | null;
    patch: unknown;
  },
): Promise<RelationTypeFields & { slug: string }> {
  const spaceId = requireUuid(input.spaceId, 'space');
  await authorize(q, spaceId, input.actorUserId, 'manageRelationTypes');
  const patch = input.patch as Record<string, unknown> | null;
  if (patch && typeof patch === 'object' && 'slug' in patch && patch.slug !== undefined && patch.slug !== input.slug) {
    throw new ConceptError(400, 'a relation type slug cannot change');
  }
  const { id: typeId } = await loadTypeRow(q, spaceId, input.slug);
  return withTransaction(q, async () => {
    // Advisory lock first, row lock second — the order createRelation implies
    // (its INSERT key-share-locks the type row while holding the advisory lock).
    await run(q, 'SELECT pg_advisory_xact_lock(hashtext($1))', [relationsLockKey(typeId)]);
    const row = await loadTypeRow(q, spaceId, input.slug, true);
    const prev = Object.fromEntries(FIELD_KEYS.map((k) => [k, (row as any)[k] ?? null])) as unknown as RelationTypeFields;
    const next = cleanRelationTypeFields(input.patch, prev);
    const becomesHierarchical = next.hierarchical && !prev.hierarchical;
    const becomesSymmetric = next.symmetric && !prev.symmetric;
    if (becomesHierarchical || becomesSymmetric) {
      const rels = await run(q, `SELECT "sourceId", "targetId" FROM "ConceptRelation" WHERE "typeId" = $1::uuid`, [row.id]);
      const edges = rels.map((r: any) => ({ source: String(r.sourceId), target: String(r.targetId) }));
      if (becomesHierarchical && hasCycle(edges)) {
        throw new ConceptError(409, 'relations of this type contain a cycle: it cannot become hierarchical');
      }
      if (becomesSymmetric) {
        const seen = new Set(edges.map((e) => `${e.source}>${e.target}`));
        if (edges.some((e) => seen.has(`${e.target}>${e.source}`))) {
          throw new ConceptError(409, 'some concepts are related in both directions: the type cannot become symmetric');
        }
      }
    }
    const updated = await run(
      q,
      `UPDATE "RelationType" SET label = $3, "labelNb" = $4, "inverseLabel" = $5, "inverseLabelNb" = $6, render = $7,
              stroke = $8, arrow = $9, color = $10, "symmetric" = $11, transitive = $12, hierarchical = $13, skos = $14, wikidata = $15
       WHERE id = $1::uuid AND "spaceId" = $2::uuid RETURNING id`,
      [
        row.id, spaceId, next.label, next.labelNb, next.inverseLabel, next.inverseLabelNb, next.render, next.stroke, next.arrow,
        next.color, next.symmetric, next.transitive, next.hierarchical, next.skos, next.wikidata,
      ],
    );
    if (!updated.length) throw new ConceptError(404, 'relation type not found');
    if (next.label !== row.label || next.labelNb !== (row.labelNb ?? null)) {
      await run(q, `UPDATE "Concept" SET label = $1, "labelNb" = $2 WHERE id = $3::uuid AND "spaceId" = $4::uuid`, [
        next.label, next.labelNb, row.conceptId, spaceId,
      ]);
      if (next.label !== row.label && row.threadId) {
        await run(q, `UPDATE "ForumThread" SET title = $1 WHERE id = $2::uuid AND "spaceId" = $3::uuid`, [
          next.label, row.threadId, spaceId,
        ]);
      }
    }
    return { slug: row.slug, ...next };
  });
}

/**
 * Archives (or restores) a type: archived types leave the legend and cannot be
 * used for new relations; existing relations keep them. Built-ins cannot be
 * archived (409). Nothing deletes a type.
 */
export async function archiveRelationType(
  q: QueryFn,
  input: { spaceId: string; slug: string; actorUserId: string | null; archived?: boolean },
): Promise<{ slug: string; isArchived: boolean }> {
  const spaceId = requireUuid(input.spaceId, 'space');
  await authorize(q, spaceId, input.actorUserId, 'manageRelationTypes');
  const archived = input.archived !== false;
  const row = await loadTypeRow(q, spaceId, input.slug);
  if (archived && row.isBuiltin) throw new ConceptError(409, 'built-in relation types cannot be archived');
  const rows = await run(
    q,
    // The built-in guard is repeated in SQL so a race cannot archive one.
    `UPDATE "RelationType" SET "isArchived" = $3
     WHERE id = $1::uuid AND "spaceId" = $2::uuid AND ($3 = false OR "isBuiltin" = false)
     RETURNING "isArchived"`,
    [row.id, spaceId, archived],
  );
  if (!rows.length) throw new ConceptError(409, 'built-in relation types cannot be archived');
  return { slug: row.slug, isArchived: rows[0].isArchived === true };
}

/**
 * Legend order: the given slugs first, in that order; types not named keep
 * their relative order after them. Unknown or repeated slugs are a 400.
 * One transaction; `q` one client.
 */
export async function reorderRelationTypes(
  q: QueryFn,
  input: { spaceId: string; actorUserId: string | null; slugs: unknown },
): Promise<{ order: string[] }> {
  const spaceId = requireUuid(input.spaceId, 'space');
  await authorize(q, spaceId, input.actorUserId, 'manageRelationTypes');
  if (!Array.isArray(input.slugs) || !input.slugs.length || input.slugs.some((s) => typeof s !== 'string')) {
    throw new ConceptError(400, 'slugs must be a list of relation type slugs');
  }
  const slugs = input.slugs as string[];
  if (new Set(slugs).size !== slugs.length) throw new ConceptError(400, 'a relation type is listed twice');
  return withTransaction(q, async () => {
    await run(q, 'SELECT pg_advisory_xact_lock(hashtext($1))', [`mm-relation-type:${spaceId}`]);
    const rows = await run(
      q,
      `SELECT slug FROM "RelationType" WHERE "spaceId" = $1::uuid ORDER BY "position" ASC, "createdAt" ASC, id ASC`,
      [spaceId],
    );
    const known = rows.map((r: any) => String(r.slug));
    for (const s of slugs) if (!known.includes(s)) throw new ConceptError(400, `unknown relation type: ${s.slice(0, TYPE_SLUG_MAX)}`);
    const order = [...slugs, ...known.filter((s) => !slugs.includes(s))];
    await run(
      q,
      `UPDATE "RelationType" t SET "position" = o.ord::int
       FROM unnest($2::text[]) WITH ORDINALITY AS o(slug, ord)
       WHERE t."spaceId" = $1::uuid AND t.slug = o.slug`,
      [spaceId, order],
    );
    return { order };
  });
}
