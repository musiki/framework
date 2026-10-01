// Concepts index page (/concepts) — pure helpers (no astro/db imports;
// tested in concepts-index.test.mjs): the GET query (sort, direction,
// grouping, filters) so the page works without JS, filtering, sorting,
// grouping (by relation type a concept appears under every type it takes
// part in) and the links of the sortable column headers.

import { CONCEPT_STATUSES, type ConceptIndexRow, type ConceptStatus } from './concepts-core.ts';
import { conceptLabel, type ViewLang } from './view.ts';

export const INDEX_SORTS = ['label', 'date', 'status', 'forum', 'relations', 'activity'] as const;
export type IndexSort = (typeof INDEX_SORTS)[number];
export const INDEX_GROUPS = ['none', 'status', 'forum', 'type'] as const;
export type IndexGroup = (typeof INDEX_GROUPS)[number];
export type SortDir = 'asc' | 'desc';

/** Natural direction of each sort: newest / busiest / most related first; text and status ascending. */
export const DEFAULT_DIR: Readonly<Record<IndexSort, SortDir>> = Object.freeze({
  label: 'asc', date: 'desc', status: 'asc', forum: 'asc', relations: 'desc', activity: 'desc',
});

export type IndexQuery = {
  sort: IndexSort;
  dir: SortDir;
  group: IndexGroup;
  /** Filters ('' = all). */
  status: ConceptStatus | '';
  forum: string;
  type: string;
};

const SLUGISH = /^[a-z0-9][a-z0-9:-]{0,199}$/;
const pick = <T extends string>(raw: string | null, allowed: readonly T[]): T | null =>
  raw !== null && (allowed as readonly string[]).includes(raw) ? (raw as T) : null;

/** Reads the page's GET parameters; anything unknown falls back to the defaults (never an error). */
export function parseIndexQuery(params: URLSearchParams): IndexQuery {
  const sort = pick(params.get('sort'), INDEX_SORTS) ?? 'label';
  const dir = pick(params.get('dir'), ['asc', 'desc'] as const) ?? DEFAULT_DIR[sort];
  const group = pick(params.get('group'), INDEX_GROUPS) ?? 'none';
  const status = pick(params.get('status'), CONCEPT_STATUSES) ?? '';
  const forum = params.get('forum') ?? '';
  const type = params.get('type') ?? '';
  return { sort, dir, group, status, forum: SLUGISH.test(forum) ? forum : '', type: SLUGISH.test(type) ? type : '' };
}

/** Query string for `q` with `over` applied, leaving defaults out ('' when everything is default). */
export function indexSearch(q: IndexQuery, over: Partial<IndexQuery> = {}): string {
  const next = { ...q, ...over };
  const params = new URLSearchParams();
  if (next.sort !== 'label') params.set('sort', next.sort);
  if (next.dir !== DEFAULT_DIR[next.sort]) params.set('dir', next.dir);
  if (next.group !== 'none') params.set('group', next.group);
  if (next.status) params.set('status', next.status);
  if (next.forum) params.set('forum', next.forum);
  if (next.type) params.set('type', next.type);
  const s = params.toString();
  return s ? `?${s}` : '';
}

/** Header link of a sortable column: the column's natural direction first, toggled when it is already the sort. */
export function sortLink(q: IndexQuery, sort: IndexSort): string {
  const dir: SortDir = q.sort === sort ? (q.dir === 'asc' ? 'desc' : 'asc') : DEFAULT_DIR[sort];
  return `/concepts${indexSearch(q, { sort, dir })}`;
}

/** aria-sort value of a column header. */
export const ariaSort = (q: IndexQuery, sort: IndexSort): 'ascending' | 'descending' | 'none' =>
  q.sort !== sort ? 'none' : q.dir === 'asc' ? 'ascending' : 'descending';

export function filterIndex(rows: ConceptIndexRow[], q: Pick<IndexQuery, 'status' | 'forum' | 'type'>): ConceptIndexRow[] {
  return rows.filter((r) =>
    (!q.status || r.status === q.status)
    && (!q.forum || r.forum?.slug === q.forum)
    && (!q.type || r.relationTypes.some((t) => t.type === q.type)));
}

const time = (iso: string) => {
  const n = new Date(iso).getTime();
  return Number.isNaN(n) ? 0 : n;
};

/** Sorts a copy; ties fall back to the label (reader's language), then the slug, so the order is stable. */
export function sortIndex(rows: ConceptIndexRow[], sort: IndexSort, dir: SortDir, lang: ViewLang): ConceptIndexRow[] {
  const collator = new Intl.Collator(lang === 'en' ? 'en' : 'nb', { sensitivity: 'base', numeric: true });
  const name = (r: ConceptIndexRow) => conceptLabel(r, lang).text;
  const byLabel = (a: ConceptIndexRow, b: ConceptIndexRow) => collator.compare(name(a), name(b)) || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0);
  const statusRank = (s: string) => (CONCEPT_STATUSES as readonly string[]).indexOf(s);
  const key: Record<IndexSort, (a: ConceptIndexRow, b: ConceptIndexRow) => number> = {
    label: byLabel,
    date: (a, b) => time(a.createdAt) - time(b.createdAt),
    activity: (a, b) => time(a.lastActivityAt) - time(b.lastActivityAt),
    status: (a, b) => statusRank(a.status) - statusRank(b.status),
    relations: (a, b) => a.relationCount - b.relationCount,
    forum: (a, b) => collator.compare(a.forum?.title ?? '', b.forum?.title ?? '') || collator.compare(a.channel?.title ?? '', b.channel?.title ?? ''),
  };
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => sign * key[sort](a, b) || byLabel(a, b));
}

export type IndexGroupOf = {
  /** Status, forum slug or relation type slug; '' for "no forum" / "no relations". */
  key: string;
  rows: ConceptIndexRow[];
  /** Relation type groups: how many relations of that type the listed concepts take part in. */
  relations?: number;
};

/**
 * Groups already filtered + sorted rows (each group keeps that order).
 * status: in status order; forum: by forum title, "no forum" last; type: by
 * `typeOrder` (the space's type order), each concept under every type it
 * takes part in, concepts without relations last ('' group).
 */
export function groupIndex(
  rows: ConceptIndexRow[],
  group: IndexGroup,
  { typeOrder = [], lang = 'en' }: { typeOrder?: string[]; lang?: ViewLang } = {},
): IndexGroupOf[] {
  if (group === 'none') return [{ key: '', rows }];
  if (group === 'status') {
    return CONCEPT_STATUSES.map((s) => ({ key: s as string, rows: rows.filter((r) => r.status === s) })).filter((g) => g.rows.length);
  }
  if (group === 'forum') {
    const collator = new Intl.Collator(lang === 'en' ? 'en' : 'nb', { sensitivity: 'base' });
    const map = new Map<string, { title: string; rows: ConceptIndexRow[] }>();
    for (const r of rows) {
      const k = r.forum?.slug ?? '';
      if (!map.has(k)) map.set(k, { title: r.forum?.title ?? '', rows: [] });
      map.get(k)!.rows.push(r);
    }
    return [...map.entries()]
      .sort(([ka, a], [kb, b]) => (ka === '' ? 1 : kb === '' ? -1 : collator.compare(a.title, b.title) || (ka < kb ? -1 : 1)))
      .map(([key, g]) => ({ key, rows: g.rows }));
  }
  const map = new Map<string, IndexGroupOf>();
  const none: ConceptIndexRow[] = [];
  for (const r of rows) {
    if (!r.relationTypes.length) none.push(r);
    for (const t of r.relationTypes) {
      if (!map.has(t.type)) map.set(t.type, { key: t.type, rows: [], relations: 0 });
      const g = map.get(t.type)!;
      g.rows.push(r);
      g.relations! += t.n;
    }
  }
  const rank = (k: string) => {
    const i = typeOrder.indexOf(k);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  const out = [...map.values()].sort((a, b) => rank(a.key) - rank(b.key) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  if (none.length) out.push({ key: '', rows: none, relations: 0 });
  return out;
}

/** The forums (groups) the rows belong to, for the filter: slug + title, alphabetical. */
export function indexForums(rows: ConceptIndexRow[], lang: ViewLang = 'en'): Array<{ slug: string; title: string }> {
  const collator = new Intl.Collator(lang === 'en' ? 'en' : 'nb', { sensitivity: 'base' });
  const map = new Map<string, string>();
  for (const r of rows) if (r.forum) map.set(r.forum.slug, r.forum.title);
  return [...map.entries()].map(([slug, title]) => ({ slug, title })).sort((a, b) => collator.compare(a.title, b.title));
}
