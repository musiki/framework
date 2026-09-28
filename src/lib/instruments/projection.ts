// Pure projection: Obsidian case-instrument notes (frontmatter kept
// verbatim from the vault, per the soog-dashboard design's "source of
// truth = studio notes" decision) -> a public, whitelisted shape safe to
// serve from `GET /api/public/instruments`.
//
// No astro/db imports — usable from plain `node --test` runs and from the
// engine endpoint alike. Note bodies never appear in the output: only the
// frontmatter fields listed in spec §2 are read.

import matter from 'gray-matter';

export type MoaieAxis = 'M' | 'O' | 'A' | 'I' | 'E';

export type PublicInstrument = {
  id: string;
  title: string;
  year?: number;
  family?: string;
  layer?: string;
  sachsHornbostel?: string;
  authors: string[];
  person?: string;
  url?: string;
  img?: string;
  fictional: boolean;
  moaie: {
    vector: [number, number, number, number, number] | null;
    /** All-zero vectors are kept (not treated as invalid) but flagged so
     * the UI can list the instrument as "not yet scored" instead of
     * silently plotting a zero radar. */
    empty: boolean;
    text: Partial<Record<MoaieAxis, string>>;
    recursive: boolean;
  };
  profile: Record<
    | 'affordance'
    | 'liveness'
    | 'playability'
    | 'learnability'
    | 'situatedness'
    | 'mediality'
    | 'mapping'
    | 'sensorimotor_scheme'
    | 'ergonomics'
    | 'expressivity',
    number
  > | null;
  connect: string[];
  hyper: string[];
};

const PROFILE_KEYS = [
  'affordance',
  'liveness',
  'playability',
  'learnability',
  'situatedness',
  'mediality',
  'mapping',
  'sensorimotor_scheme',
  'ergonomics',
  'expressivity',
] as const;

const MOAIE_AXES: MoaieAxis[] = ['M', 'O', 'A', 'I', 'E'];

/** Bounds on whitelisted strings — vault notes are free-form prose fields
 * (e.g. `sachs-hornbostel` or `moaie.M` commentary can run to paragraph
 * length); truncating keeps the public endpoint's payload predictable
 * without rejecting the whole field. */
const MAX_STRING_LEN = 2000;
const MAX_ARRAY_ITEMS = 50;
const MAX_ARRAY_ITEM_LEN = 200;

/**
 * Replaces Templater expressions (`<% tp.date.now("YYYY-MM-DD") %>` and
 * similar) inside the frontmatter block only, with `today` (an injected
 * ISO date so callers/tests stay deterministic — defaults to the real
 * date). The body is left untouched. Markdown with no frontmatter block
 * is returned unchanged.
 */
export function cleanTemplater(
  markdown: string,
  today: string = new Date().toISOString().slice(0, 10),
): string {
  const match = markdown.match(/^(---\r?\n)([\s\S]*?)(\r?\n---)/);
  if (!match || match.index === undefined) return markdown;
  const [whole, open, frontmatter, close] = match;
  const cleaned = frontmatter.replace(/<%[\s\S]*?%>/g, today);
  return (
    markdown.slice(0, match.index) +
    open +
    cleaned +
    close +
    markdown.slice(match.index + whole.length)
  );
}

/** Parses frontmatter with gray-matter, retrying once with Templater
 * expressions cleaned out if the raw markdown doesn't parse as YAML.
 * Returns `null` (never throws) if both attempts fail. */
function parseFrontmatterRobust(markdown: string): Record<string, unknown> | null {
  // `{}` (any options object, even empty) opts both calls out of
  // gray-matter's own content-keyed cache. Without it, a first call that
  // throws still poisons the cache with the pre-parse (dataless) file
  // object under that content string, so an identical-content retry
  // (e.g. cleanTemplater is a no-op because there's no Templater tag)
  // would silently return `{}` instead of re-throwing.
  try {
    return matter(markdown, {}).data ?? {};
  } catch {
    // fall through
  }
  try {
    return matter(cleanTemplater(markdown), {}).data ?? {};
  } catch {
    return null;
  }
}

/** Reduces every `[[Target]]` / `[[Target|Alias]]` wikilink inside `s` to
 * its target name (the decision for this task's open point: `[[X|Y]]` ->
 * `X`, never the alias `Y`). Plain text without wikilinks passes through
 * unchanged. */
function reduceWikilinks(s: string): string {
  return s
    .replace(/\[\[([^\]]*)\]\]/g, (_m, inner: string) => {
      const pipeIdx = inner.indexOf('|');
      return (pipeIdx === -1 ? inner : inner.slice(0, pipeIdx)).trim();
    })
    .trim();
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s;
}

/** A non-empty, wikilink-reduced string bounded to `MAX_STRING_LEN`, or
 * `undefined`. */
function str(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const reduced = reduceWikilinks(value);
  return reduced === '' ? undefined : truncate(reduced, MAX_STRING_LEN);
}

/** At most `MAX_ARRAY_ITEMS` entries, each bounded to `MAX_ARRAY_ITEM_LEN`
 * chars (independent of `str`'s own, longer bound, since these are meant
 * to be short names, not prose). */
function strArray(value: unknown): string[] {
  const arr = Array.isArray(value) ? value : value == null ? [] : [value];
  const out: string[] = [];
  for (const item of arr) {
    if (out.length >= MAX_ARRAY_ITEMS) break;
    const s = str(item);
    if (s !== undefined) out.push(truncate(s, MAX_ARRAY_ITEM_LEN));
  }
  return out;
}

function httpsUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.startsWith('https://') ? trimmed : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/** The vector is kept only when it is exactly 5 finite numbers; otherwise
 * the whole vector is `null` (no partial/coerced vectors). */
function readVector(value: unknown): [number, number, number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 5) return null;
  const nums = value.map((v) => finiteNumber(v));
  if (nums.some((n) => n === undefined)) return null;
  return nums as [number, number, number, number, number];
}

/** `null` both when `interface_profile` is absent and when every one of
 * the ten dimensions is 0 or missing — an "unscored" profile is
 * indistinguishable from an absent one, so the UI can treat both the same
 * way instead of plotting a real-looking all-zero radar. Individual
 * missing/invalid keys still default to 0 as long as at least one
 * dimension is actually scored. */
function readProfile(value: unknown): PublicInstrument['profile'] {
  if (value == null || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  const profile = {} as NonNullable<PublicInstrument['profile']>;
  let allZero = true;
  for (const key of PROFILE_KEYS) {
    const n = finiteNumber(source[key]) ?? 0;
    profile[key] = n;
    if (n !== 0) allZero = false;
  }
  return allZero ? null : profile;
}

function readMoaieText(value: unknown): Partial<Record<MoaieAxis, string>> {
  const text: Partial<Record<MoaieAxis, string>> = {};
  if (value == null || typeof value !== 'object') return text;
  const source = value as Record<string, unknown>;
  for (const axis of MOAIE_AXES) {
    const s = str(source[axis]);
    if (s !== undefined) text[axis] = s;
  }
  return text;
}

/**
 * Projects a studio note's frontmatter into the public whitelist (spec
 * §2). Returns `null` when the note isn't an instrument note (frontmatter
 * `type` !== `'instrument'`) or when the frontmatter can't be parsed at
 * all, even after Templater cleanup.
 *
 * `note.body` is the full markdown (frontmatter + body); the body text
 * itself never appears in the returned object.
 */
export function projectInstrument(
  note: { id: string; title: string; body: string },
  opts?: { fictional?: boolean },
): PublicInstrument | null {
  const data = parseFrontmatterRobust(note.body);
  if (!data) return null;
  if (data.type !== 'instrument') return null;

  const title = str(data.title) ?? note.title;

  const moaieData = data.moaie != null && typeof data.moaie === 'object'
    ? (data.moaie as Record<string, unknown>)
    : {};
  const vector = readVector(moaieData.vector);
  const empty = vector !== null && vector.every((n) => n === 0);

  const result: PublicInstrument = {
    id: note.id,
    title,
    authors: strArray(data.authors),
    fictional: !!opts?.fictional,
    moaie: {
      vector,
      empty,
      text: readMoaieText(moaieData),
      recursive: moaieData.recursive === true,
    },
    profile: readProfile(data.interface_profile),
    connect: strArray(data.connect),
    hyper: strArray(data.hyper),
  };

  const year = finiteNumber(data.year);
  if (year !== undefined) result.year = year;
  const family = str(data.family);
  if (family !== undefined) result.family = family;
  const layer = str(data.layer);
  if (layer !== undefined) result.layer = layer;
  const sh = str((data as Record<string, unknown>)['sachs-hornbostel']);
  if (sh !== undefined) result.sachsHornbostel = sh;
  const person = str(data.person);
  if (person !== undefined) result.person = person;
  const url = httpsUrl(data.url);
  if (url !== undefined) result.url = url;
  const img = httpsUrl(data.img);
  if (img !== undefined) result.img = img;

  return result;
}
