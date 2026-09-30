// Public concept export (spec §8): the shape of the MishMash Lab's
// `site/_data/concept_machine.json` plus `forum`. Pure, q-injected.
// Relation types (relation modeler): `relation_types` / `relation_types_nb`
// stay slug → label maps (the Lab reads them as strings), now taken from the
// space's RelationType rows, custom types included; the full vocabulary —
// inverse labels, logical properties, encoding, SKOS/Wikidata mappings and
// the definition (markdown source, en/nb) — is in `relation_vocabulary`.
// Relations are exported by type slug. Nothing about stances is exported
// (no names, no totals): agreement is a live discussion, not a snapshot.
// Privacy (plan Global Constraints): display names only — no emails, no user
// ids; credited users that were deleted (creditedUserId NULL) or have no
// usable display name (empty, or containing '@') are omitted from `authors`.

import type { QueryFn } from './concepts-core.ts';
import { CONCEPT_STATUSES, RELATION_TYPES } from './concepts-core.ts';
import { publicName } from './view.ts';

export const EXPORT_STATUSES = {
  neologism: 'Neologism: a new word or sense proposed in the discussion',
  discussion: 'In discussion: being defined, contested or combined',
  assimilated: 'Assimilated: used with a shared meaning across the network',
} as const;
export const EXPORT_STATUSES_NB = {
  neologism: 'Neologisme: et nytt ord eller en ny betydning foreslått i diskusjonen',
  discussion: 'Under diskusjon: blir definert, bestridt eller kombinert',
  assimilated: 'Innarbeidet: brukes med en felles betydning i nettverket',
} as const;
export const EXPORT_RELATION_TYPES = {
  derives: 'derives from',
  combines: 'combines with',
  contrasts: 'contrasts with',
  reformulates: 'reformulates',
  exemplifies: 'exemplifies',
} as const;
export const EXPORT_RELATION_TYPES_NB = {
  derives: 'er avledet av',
  combines: 'kombineres med',
  contrasts: 'står i kontrast til',
  reformulates: 'omformulerer',
  exemplifies: 'eksemplifiserer',
} as const;
export const EXPORT_NOTE = 'Snapshot exported from the MishMash Concept Machine (mm.zztt.org). Credits list display names only.';
export const EXPORT_NOTE_NB = 'Øyeblikksbilde eksportert fra MishMash-begrepsmaskinen (mm.zztt.org). Krediteringer viser bare visningsnavn.';

export type ExportConcept = {
  id: string; // slug
  label: string;
  label_nb?: string;
  status: string;
  definition: string;
  definition_nb?: string;
  authors: string[];
  forum: { id: string; title: string } | null;
};
export type ExportRelation = { source: string; target: string; type: string };
export type ExportRelationType = {
  id: string; // slug
  label: string;
  label_nb?: string;
  inverse?: string;
  inverse_nb?: string;
  properties: { symmetric: boolean; transitive: boolean; hierarchical: boolean };
  encoding: { render: string; stroke: string; arrow: boolean; color: string };
  mappings: { skos?: string; wikidata?: string };
  /** Current English definition (markdown source). */
  definition?: string;
  definition_nb?: string;
  builtin: boolean;
  /** Present (true) only for an archived type still used by an exported relation. */
  archived?: true;
};
export type ConceptExport = {
  snapshot: string;
  note: string;
  note_nb: string;
  statuses: Record<string, string>;
  statuses_nb: Record<string, string>;
  relation_types: Record<string, string>;
  relation_types_nb: Record<string, string>;
  relation_vocabulary: ExportRelationType[];
  concepts: ExportConcept[];
  relations: ExportRelation[];
};

export type ExportConceptRow = {
  id: string;
  slug: string;
  label: string;
  labelNb: string | null;
  status: string;
  forumSlug: string | null;
  forumTitle: string | null;
};
export type ExportVersionRow = {
  conceptId: string;
  lang: string;
  definition: string;
  createdAt: string | Date;
  creditedName: string | null;
  creditedDeleted: boolean;
};
export type ExportRelationRow = { sourceId: string; targetId: string; type: string };
export type ExportRelationTypeRow = {
  conceptId: string | null;
  slug: string;
  label: string;
  labelNb: string | null;
  inverseLabel: string | null;
  inverseLabelNb: string | null;
  render: string;
  stroke: string;
  arrow: boolean;
  color: string;
  symmetric: boolean;
  transitive: boolean;
  hierarchical: boolean;
  skos: string | null;
  wikidata: string | null;
  isBuiltin: boolean;
  isArchived: boolean;
};
/** A definition version of a relation type's concept: no credit columns at all. */
export type ExportTypeVersionRow = { conceptId: string; lang: string; definition: string; createdAt: string | Date };

const nonEmpty = (s: unknown): s is string => typeof s === 'string' && s.trim() !== '';
const time = (v: string | Date) => new Date(v).getTime();

/**
 * Builds the export from plain rows. Current definition per language = latest
 * version; concepts without an English definition are skipped. `authors` =
 * distinct display names of credited users over all versions, in order of
 * their first credit.
 */
export function buildExport(
  input: {
    concepts: ExportConceptRow[];
    versions: ExportVersionRow[];
    relations: ExportRelationRow[];
    /** The space's relation types in legend order; absent/empty → the five built-in labels. */
    relationTypes?: ExportRelationTypeRow[];
    typeVersions?: ExportTypeVersionRow[];
  },
  now: Date = new Date(),
): ConceptExport {
  const byConcept = new Map<string, ExportVersionRow[]>();
  for (const v of input.versions) {
    const list = byConcept.get(v.conceptId) ?? [];
    list.push(v);
    byConcept.set(v.conceptId, list);
  }

  const slugById = new Map<string, string>();
  const concepts: ExportConcept[] = [];
  for (const c of input.concepts) {
    if (!(CONCEPT_STATUSES as readonly string[]).includes(c.status)) continue;
    const versions = (byConcept.get(c.id) ?? []).slice().sort((a, b) => time(a.createdAt) - time(b.createdAt));
    const latest = (lang: string) => {
      let cur: ExportVersionRow | undefined;
      for (const v of versions) if (v.lang === lang) cur = v;
      return cur;
    };
    const en = latest('en');
    if (!en || !nonEmpty(en.definition)) continue;
    const nb = latest('nb');

    const authors: string[] = [];
    for (const v of versions) {
      const name = v.creditedDeleted ? null : publicName(v.creditedName);
      if (!name) continue;
      if (!authors.includes(name)) authors.push(name);
    }

    const out: ExportConcept = {
      id: c.slug,
      label: c.label,
      status: c.status,
      definition: en.definition,
      authors,
      forum: c.forumSlug ? { id: c.forumSlug, title: c.forumTitle ?? c.forumSlug } : null,
    };
    if (nonEmpty(c.labelNb)) out.label_nb = c.labelNb;
    if (nb && nonEmpty(nb.definition)) out.definition_nb = nb.definition;
    concepts.push(out);
    slugById.set(c.id, c.slug);
  }

  const typeRows = input.relationTypes ?? [];
  const knownTypes = new Set<string>(typeRows.length ? typeRows.map((t) => t.slug) : RELATION_TYPES);
  const relations: ExportRelation[] = [];
  for (const r of input.relations) {
    const source = slugById.get(r.sourceId);
    const target = slugById.get(r.targetId);
    if (source && target && knownTypes.has(r.type)) relations.push({ source, target, type: r.type });
  }
  const used = new Set(relations.map((r) => r.type));
  const vocabulary = buildVocabulary(typeRows.filter((t) => !t.isArchived || used.has(t.slug)), input.typeVersions ?? []);
  const typeLabels = typeRows.length ? Object.fromEntries(vocabulary.map((t) => [t.id, t.label])) : { ...EXPORT_RELATION_TYPES };
  const typeLabelsNb = typeRows.length
    ? Object.fromEntries(vocabulary.map((t) => [t.id, t.label_nb ?? t.label]))
    : { ...EXPORT_RELATION_TYPES_NB };

  return {
    snapshot: now.toISOString().slice(0, 10),
    note: EXPORT_NOTE,
    note_nb: EXPORT_NOTE_NB,
    statuses: { ...EXPORT_STATUSES },
    statuses_nb: { ...EXPORT_STATUSES_NB },
    relation_types: typeLabels,
    relation_types_nb: typeLabelsNb,
    relation_vocabulary: vocabulary,
    concepts,
    relations,
  };
}

/** Relation types with their current en/nb definition (latest version per language). */
function buildVocabulary(types: ExportRelationTypeRow[], versions: ExportTypeVersionRow[]): ExportRelationType[] {
  const latest = new Map<string, ExportTypeVersionRow>();
  for (const v of versions.slice().sort((a, b) => time(a.createdAt) - time(b.createdAt))) latest.set(`${v.conceptId}|${v.lang}`, v);
  return types.map((t) => {
    const out: ExportRelationType = {
      id: t.slug,
      label: t.label,
      properties: { symmetric: t.symmetric === true, transitive: t.transitive === true, hierarchical: t.hierarchical === true },
      encoding: { render: t.render, stroke: t.stroke, arrow: t.arrow === true, color: t.color },
      mappings: {},
      builtin: t.isBuiltin === true,
    };
    if (nonEmpty(t.labelNb)) out.label_nb = t.labelNb;
    if (nonEmpty(t.inverseLabel)) out.inverse = t.inverseLabel;
    if (nonEmpty(t.inverseLabelNb)) out.inverse_nb = t.inverseLabelNb;
    if (nonEmpty(t.skos)) out.mappings.skos = t.skos;
    if (nonEmpty(t.wikidata)) out.mappings.wikidata = t.wikidata;
    const en = t.conceptId ? latest.get(`${t.conceptId}|en`) : undefined;
    const nb = t.conceptId ? latest.get(`${t.conceptId}|nb`) : undefined;
    if (en && nonEmpty(en.definition)) out.definition = en.definition;
    if (nb && nonEmpty(nb.definition)) out.definition_nb = nb.definition;
    if (t.isArchived) out.archived = true;
    return out;
  });
}

async function run(q: QueryFn, text: string, params: unknown[]): Promise<any[]> {
  const { data, error } = await q(text, params);
  if (error) throw error instanceof Error ? error : new Error(String(error?.message || error));
  return data ?? [];
}

/** Loads the space's concepts, versions and relations and builds the export. */
export async function loadExport(q: QueryFn, spaceId: string, now: Date = new Date()): Promise<ConceptExport> {
  const concepts = await run(
    q,
    `SELECT c.id, c.slug, c.label, c."labelNb", c.status, f.slug AS "forumSlug", f.title AS "forumTitle"
       FROM "Concept" c LEFT JOIN "ForumBoard" f ON f.id = c."forumId"
      WHERE c."spaceId" = $1::uuid AND c.kind = 'concept'
      ORDER BY lower(c.label) ASC, c.id ASC`,
    [spaceId],
  );
  // Only the credited user's display name and a deleted flag leave the DB.
  const versions = await run(
    q,
    `SELECT v."conceptId", v.lang, v.definition, v."createdAt",
            u.name AS "creditedName", (v."creditedUserId" IS NULL OR u.id IS NULL) AS "creditedDeleted"
       FROM "ConceptVersion" v
       JOIN "Concept" c ON c.id = v."conceptId" AND c."spaceId" = $1::uuid AND c.kind = 'concept'
       LEFT JOIN "User" u ON u.id = v."creditedUserId"
      ORDER BY v."createdAt" ASC, v.id ASC`,
    [spaceId],
  );
  // By type slug (custom types included); nothing about stances or who proposed.
  const relations = await run(
    q,
    `SELECT r."sourceId", r."targetId", t.slug AS type
       FROM "ConceptRelation" r JOIN "RelationType" t ON t.id = r."typeId" AND t."spaceId" = r."spaceId"
      WHERE r."spaceId" = $1::uuid
      ORDER BY r."createdAt" ASC, r.id ASC`,
    [spaceId],
  );
  const relationTypes = await run(
    q,
    `SELECT t."conceptId", t.slug, t.label, t."labelNb", t."inverseLabel", t."inverseLabelNb", t.render, t.stroke, t.arrow,
            t.color, t."symmetric", t.transitive, t.hierarchical, t.skos, t.wikidata, t."isBuiltin", t."isArchived"
       FROM "RelationType" t
      WHERE t."spaceId" = $1::uuid
      ORDER BY t."position" ASC, t."createdAt" ASC, t.id ASC`,
    [spaceId],
  );
  // Definitions of the types' concepts: text and language only — no credits.
  const typeVersions = await run(
    q,
    `SELECT v."conceptId", v.lang, v.definition, v."createdAt"
       FROM "ConceptVersion" v
       JOIN "Concept" c ON c.id = v."conceptId" AND c."spaceId" = $1::uuid AND c.kind = 'relation-type'
      ORDER BY v."createdAt" ASC, v.id ASC`,
    [spaceId],
  );
  return buildExport(
    {
      concepts: concepts.map((c) => ({
        id: c.id, slug: c.slug, label: c.label, labelNb: c.labelNb ?? null, status: c.status,
        forumSlug: c.forumSlug ?? null, forumTitle: c.forumTitle ?? null,
      })),
      versions: versions.map((v) => ({
        conceptId: v.conceptId, lang: v.lang, definition: v.definition, createdAt: v.createdAt,
        creditedName: v.creditedName ?? null, creditedDeleted: v.creditedDeleted === true,
      })),
      relations: relations.map((r) => ({ sourceId: r.sourceId, targetId: r.targetId, type: String(r.type) })),
      relationTypes: relationTypes.map((t) => ({
        conceptId: t.conceptId ?? null, slug: String(t.slug), label: String(t.label), labelNb: t.labelNb ?? null,
        inverseLabel: t.inverseLabel ?? null, inverseLabelNb: t.inverseLabelNb ?? null, render: String(t.render),
        stroke: String(t.stroke), arrow: t.arrow === true, color: String(t.color), symmetric: t.symmetric === true,
        transitive: t.transitive === true, hierarchical: t.hierarchical === true, skos: t.skos ?? null,
        wikidata: t.wikidata ?? null, isBuiltin: t.isBuiltin === true, isArchived: t.isArchived === true,
      })),
      typeVersions: typeVersions.map((v) => ({ conceptId: v.conceptId, lang: v.lang, definition: v.definition, createdAt: v.createdAt })),
    },
    now,
  );
}
