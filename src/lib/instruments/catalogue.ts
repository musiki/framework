// File-backed instrument catalogue behind `GET /api/public/instruments`.
//
// Source: the `soog-instruments` content source (repo zzigo/soog-instruments,
// pulled by scripts/pull-sources.mjs into `.content-sources/soog-instruments`,
// overridable with env `INSTRUMENTS_DIR`). One `.md` per instrument, YAML
// frontmatter per the SOOG templates; subfolders allowed.
//
// Public = `publish: true` (YAML boolean, nothing else) AND
// `type: instrument`. Everything else stays private and leaves no trace in
// the output (ids are de-duplicated among published notes only). Note
// bodies (including `<!--lang:xx-->` blocks) are never part of the payload:
// only the whitelisted frontmatter fields of `projectInstrumentData`.
//
// Language: the request tenant's locale picks `<key>_<lang>` text fields
// (`title_es`, `family_es`, `sachs-hornbostel_es`, `moaie.M_es`, …) with
// fallback to the plain key and then the other language.
//
// No astro/db imports — usable from plain `node --test` runs.

import fs from 'node:fs';
import path from 'node:path';
import { TENANTS } from '../tenant/tenants.ts';
import { parseFrontmatterRobust, projectInstrumentData, type PublicInstrument } from './projection.ts';

export type InstrumentsLang = 'en' | 'es';

export const INSTRUMENTS_SOURCE_ID = 'soog-instruments';

/** Notes larger than this are skipped (defensive bound, real notes are < 50 KB). */
const MAX_FILE_BYTES = 1024 * 1024;

const IGNORED_DIRS = new Set(['scripts', 'node_modules']);
const IGNORED_FILES = new Set(['readme.md', 'schema.md']);

/** Top-level string keys that may carry `<key>_<lang>` variants. */
const LOCALIZED_KEYS = ['title', 'family', 'sachs-hornbostel'] as const;
const MOAIE_AXES = ['M', 'O', 'A', 'I', 'E'] as const;

export type CatalogueRecord = {
  /** Path relative to the catalogue root, `/`-separated. */
  rel: string;
  data: Record<string, unknown>;
};

/** Catalogue directory: `INSTRUMENTS_DIR` or `<cwd>/.content-sources/soog-instruments`. */
export function instrumentsDir(env: Record<string, string | undefined> = process.env, cwd: string = process.cwd()): string {
  const override = String(env.INSTRUMENTS_DIR ?? '').trim();
  return override ? path.resolve(cwd, override) : path.join(cwd, '.content-sources', INSTRUMENTS_SOURCE_ID);
}

/** Which request-tenant hosts may reach the public instruments endpoint. */
export function isInstrumentsHostAllowed(tenantId: string): boolean {
  return tenantId === 'so' || tenantId === 'musiki';
}

/** Payload language for a request tenant: `es` for Spanish-locale tenants (musiki), else `en` (so). */
export function instrumentsLangForTenant(tenantId: string): InstrumentsLang {
  const tenant = (TENANTS as Record<string, { locale: string } | undefined>)[tenantId];
  return tenant?.locale === 'es' ? 'es' : 'en';
}

/** Every catalogue `.md` file (absolute paths, sorted by relative path),
 * skipping dot-entries, `scripts/`, `node_modules/`, README.md, SCHEMA.md
 * and symlinks. */
export function listCatalogueFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        walk(abs);
      } else if (entry.isFile()) {
        const lower = entry.name.toLowerCase();
        if (!lower.endsWith('.md')) continue;
        if (IGNORED_FILES.has(lower)) continue;
        out.push(abs);
      }
    }
  };
  walk(dir);
  return out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

type CacheEntry = { signature: string; records: CatalogueRecord[] };
const cache = new Map<string, CacheEntry>();

/**
 * Parses every catalogue note's frontmatter. Returns `null` when `dir`
 * doesn't exist (source not pulled). Cached per directory and invalidated
 * when any file's path, mtime or size changes. Files that can't be read or
 * parsed are skipped, never thrown.
 */
export function loadCatalogue(dir: string): CatalogueRecord[] | null {
  let st: fs.Stats;
  try {
    st = fs.statSync(dir);
  } catch {
    return null;
  }
  if (!st.isDirectory()) return null;

  const files = listCatalogueFiles(dir);
  const stats = files.map((abs) => {
    try {
      const s = fs.statSync(abs);
      return { abs, mtimeMs: s.mtimeMs, size: s.size };
    } catch {
      return null;
    }
  }).filter((s): s is { abs: string; mtimeMs: number; size: number } => s !== null);
  const signature = stats.map((s) => `${s.abs}\u0000${s.mtimeMs}\u0000${s.size}`).join('\n');

  const cached = cache.get(dir);
  if (cached && cached.signature === signature) return cached.records;

  const records: CatalogueRecord[] = [];
  for (const s of stats) {
    if (s.size > MAX_FILE_BYTES) continue;
    let markdown: string;
    try {
      markdown = fs.readFileSync(s.abs, 'utf8');
    } catch {
      continue;
    }
    const data = parseFrontmatterRobust(markdown);
    if (!data) continue;
    records.push({ rel: path.relative(dir, s.abs).split(path.sep).join('/'), data });
  }
  cache.set(dir, { signature, records });
  return records;
}

/** Test hook: drops the per-directory cache. */
export function clearCatalogueCache(): void {
  cache.clear();
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function pick(source: Record<string, unknown>, key: string, lang: InstrumentsLang): string | undefined {
  const other: InstrumentsLang = lang === 'es' ? 'en' : 'es';
  return (
    nonEmptyString(source[`${key}_${lang}`]) ??
    nonEmptyString(source[key]) ??
    nonEmptyString(source[`${key}_${other}`])
  );
}

/** Copy of `data` with the localizable text fields resolved for `lang`. */
export function localizeData(data: Record<string, unknown>, lang: InstrumentsLang): Record<string, unknown> {
  const out: Record<string, unknown> = { ...data };
  for (const key of LOCALIZED_KEYS) {
    const value = pick(data, key, lang);
    if (value !== undefined) out[key] = value;
  }
  if (data.moaie != null && typeof data.moaie === 'object' && !Array.isArray(data.moaie)) {
    const moaie = { ...(data.moaie as Record<string, unknown>) };
    for (const axis of MOAIE_AXES) {
      const value = pick(data.moaie as Record<string, unknown>, axis, lang);
      if (value !== undefined) moaie[axis] = value;
    }
    out.moaie = moaie;
  }
  return out;
}

/** Stable slug from a file name: diacritics stripped, lowercase, `-`-joined. */
export function slugifyFileName(name: string): string {
  const slug = name
    .replace(/\.md$/i, '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'instrument';
}

function yamlId(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed.slice(0, 200);
}

export function isPublished(data: Record<string, unknown>): boolean {
  return data.publish === true && data.type === 'instrument';
}

export function isFictional(data: Record<string, unknown>): boolean {
  return typeof data.layer === 'string' && data.layer.trim().toLowerCase() === 'fictional';
}

/** Published instruments of `records`, localized for `lang`, sorted by title. */
export function publicInstrumentsFromRecords(records: CatalogueRecord[], lang: InstrumentsLang): PublicInstrument[] {
  const seen = new Set<string>();
  const instruments: PublicInstrument[] = [];
  for (const record of records) {
    if (!isPublished(record.data)) continue;
    const fileName = record.rel.split('/').pop() ?? record.rel;
    const baseId = yamlId(record.data.id) ?? slugifyFileName(fileName);
    let id = baseId;
    for (let n = 2; seen.has(id); n += 1) id = `${baseId}-${n}`;
    const projected = projectInstrumentData(localizeData(record.data, lang), {
      id,
      title: fileName.replace(/\.md$/i, ''),
      fictional: isFictional(record.data),
    });
    if (!projected) continue;
    seen.add(id);
    instruments.push(projected);
  }
  instruments.sort((a, b) => a.title.localeCompare(b.title, lang) || a.id.localeCompare(b.id));
  return instruments;
}

/** Published instruments from `dir` for `lang`; `null` when the directory is missing. */
export function loadPublicInstruments({ dir, lang }: { dir: string; lang: InstrumentsLang }): PublicInstrument[] | null {
  const records = loadCatalogue(dir);
  return records === null ? null : publicInstrumentsFromRecords(records, lang);
}

export type PublicInstrumentsResponse =
  | { status: 200; body: { generatedAt: string; instruments: PublicInstrument[] } }
  | { status: 404 | 500; body: { error: string } };

let warnedMissingDir = '';

/**
 * Pure core of `GET /api/public/instruments`: 404 unless the request
 * tenant is `so` or `musiki`; otherwise the published catalogue in the
 * tenant's language. A missing catalogue directory is not an error (200
 * with an empty list, warned once per directory) — there is no DB
 * fallback.
 */
export function handlePublicInstrumentsRequest(
  requestTenantId: string,
  opts: { dir?: string; now?: () => Date } = {},
): PublicInstrumentsResponse {
  if (!isInstrumentsHostAllowed(requestTenantId)) {
    return { status: 404, body: { error: 'Not found' } };
  }
  const dir = opts.dir ?? instrumentsDir();
  const now = opts.now ?? (() => new Date());
  try {
    const instruments = loadPublicInstruments({ dir, lang: instrumentsLangForTenant(requestTenantId) });
    if (instruments === null && warnedMissingDir !== dir) {
      warnedMissingDir = dir;
      console.warn(`[api/public/instruments] catalogue directory not found: ${dir}`);
    }
    return { status: 200, body: { generatedAt: now().toISOString(), instruments: instruments ?? [] } };
  } catch (err) {
    console.error('[api/public/instruments] failed to load instruments:', err);
    return { status: 500, body: { error: 'Internal error' } };
  }
}
