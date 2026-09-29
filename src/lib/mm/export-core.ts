// Public concept export (spec §8): the shape of the MishMash Lab's
// `site/_data/concept_machine.json` plus `forum`. Pure, q-injected.
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
export type ConceptExport = {
  snapshot: string;
  note: string;
  note_nb: string;
  statuses: Record<string, string>;
  statuses_nb: Record<string, string>;
  relation_types: Record<string, string>;
  relation_types_nb: Record<string, string>;
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

const nonEmpty = (s: unknown): s is string => typeof s === 'string' && s.trim() !== '';
const time = (v: string | Date) => new Date(v).getTime();

/**
 * Builds the export from plain rows. Current definition per language = latest
 * version; concepts without an English definition are skipped. `authors` =
 * distinct display names of credited users over all versions, in order of
 * their first credit.
 */
export function buildExport(
  input: { concepts: ExportConceptRow[]; versions: ExportVersionRow[]; relations: ExportRelationRow[] },
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

  const relations: ExportRelation[] = [];
  for (const r of input.relations) {
    const source = slugById.get(r.sourceId);
    const target = slugById.get(r.targetId);
    if (source && target && (RELATION_TYPES as readonly string[]).includes(r.type)) relations.push({ source, target, type: r.type });
  }

  return {
    snapshot: now.toISOString().slice(0, 10),
    note: EXPORT_NOTE,
    note_nb: EXPORT_NOTE_NB,
    statuses: { ...EXPORT_STATUSES },
    statuses_nb: { ...EXPORT_STATUSES_NB },
    relation_types: { ...EXPORT_RELATION_TYPES },
    relation_types_nb: { ...EXPORT_RELATION_TYPES_NB },
    concepts,
    relations,
  };
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
      WHERE c."spaceId" = $1::uuid
      ORDER BY lower(c.label) ASC, c.id ASC`,
    [spaceId],
  );
  // Only the credited user's display name and a deleted flag leave the DB.
  const versions = await run(
    q,
    `SELECT v."conceptId", v.lang, v.definition, v."createdAt",
            u.name AS "creditedName", (v."creditedUserId" IS NULL OR u.id IS NULL) AS "creditedDeleted"
       FROM "ConceptVersion" v
       JOIN "Concept" c ON c.id = v."conceptId" AND c."spaceId" = $1::uuid
       LEFT JOIN "User" u ON u.id = v."creditedUserId"
      ORDER BY v."createdAt" ASC, v.id ASC`,
    [spaceId],
  );
  const relations = await run(
    q,
    `SELECT "sourceId", "targetId", type FROM "ConceptRelation" WHERE "spaceId" = $1::uuid
      ORDER BY "createdAt" ASC, id ASC`,
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
      relations,
    },
    now,
  );
}
