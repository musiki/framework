// mm forum bibliography via Seshat (spec §7). Public-readable citation search
// scoped to a forum's linked Seshat library, performed on behalf of the forum's
// `settings.ownerEmail` with the shared SESHAT_INTEGRATION_TOKEN (same upstream
// contract as src/pages/api/seshat/citations.ts). Only citation metadata leaves
// this module: citekey, title, authors, year, url/doi. Never notes, tags,
// attachments, library ids or the owner email.
//
// Pure module: no astro/db imports; `q` and `fetch` are injected for tests.
// Seshat exposes no integration-token import endpoint, so there is no .bib
// forwarding here (its /api/bibliography/import is session-authenticated).

export type QueryFn = (text: string, params?: unknown[]) => Promise<{ data: any[] | null; error: any }>;
export type FetchFn = (input: URL | string, init?: RequestInit) => Promise<Response>;

export interface ForumBibliographySettings {
  forumId: string;
  seshatLibraryId: string | null;
  zoteroCollection: string | null;
  /** Server-side only. Never serialize. */
  ownerEmail: string | null;
}

export interface Citation {
  citekey: string;
  title: string;
  authors: string[];
  year: number | null;
  url: string | null;
  doi: string | null;
}

export class BibliographyError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'BibliographyError';
    this.status = status;
  }
}

export const MAX_RESULTS = 20;
export const MAX_QUERY = 200;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,99}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const str = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s || null;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toSettings(row: any): ForumBibliographySettings {
  const settings = row.settings && typeof row.settings === 'object' ? row.settings : {};
  const email = str(settings.ownerEmail)?.toLowerCase() ?? null;
  return {
    forumId: String(row.id),
    seshatLibraryId: str(settings.seshatLibraryId),
    zoteroCollection: str(settings.zoteroCollection),
    ownerEmail: email && email.length <= 320 && EMAIL_RE.test(email) ? email : null,
  };
}

/** Loads a forum's bibliography settings. Assumes mm has a single commons space; ORDER BY keeps the pick deterministic if that ever changes. */
export async function loadForumBibliography(q: QueryFn, slug: string): Promise<ForumBibliographySettings | null> {
  if (!SLUG_RE.test(slug)) return null;
  const { data, error } = await q(
    `SELECT b."id", b."settings"
       FROM "ForumBoard" b
       JOIN "Space" s ON s."id" = b."spaceId" AND s."tenantId" = 'mm' AND s."kind" = 'commons'
      WHERE b."slug" = $1 AND b."isArchived" IS NOT TRUE
      ORDER BY s."createdAt" ASC, b."id" ASC
      LIMIT 1`,
    [slug],
  );
  if (error) throw new BibliographyError(500, 'database error');
  const row = data?.[0];
  return row ? toSettings(row) : null;
}

/** Same as loadForumBibliography, by forum id (post rendering knows the thread's forum id). */
export async function loadForumBibliographyById(q: QueryFn, forumId: string): Promise<ForumBibliographySettings | null> {
  if (typeof forumId !== 'string' || !UUID_RE.test(forumId)) return null;
  const { data, error } = await q(
    `SELECT b."id", b."settings"
       FROM "ForumBoard" b
       JOIN "Space" s ON s."id" = b."spaceId" AND s."tenantId" = 'mm' AND s."kind" = 'commons'
      WHERE b."id" = $1::uuid
      LIMIT 1`,
    [forumId],
  );
  if (error) throw new BibliographyError(500, 'database error');
  const row = data?.[0];
  return row ? toSettings(row) : null;
}

const firstOf = (v: unknown): string | null => (Array.isArray(v) ? str(v[0]) : str(v));

/** Whitelist mapping of one Seshat search item to public citation metadata. */
export function toCitation(item: any): Citation | null {
  const citekey = str(item?.citeKey);
  if (!citekey) return null;
  const ids = item?.identifiers && typeof item.identifiers === 'object' ? item.identifiers : {};
  const doi = firstOf(ids.doi);
  const url = firstOf(ids.url) ?? (doi ? `https://doi.org/${doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '')}` : null);
  const year = Number(item?.year);
  return {
    citekey,
    title: str(item?.title) ?? '',
    authors: Array.isArray(item?.authors) ? item.authors.map(str).filter((a: string | null): a is string => !!a).slice(0, 20) : [],
    year: Number.isFinite(year) && year > 0 ? Math.trunc(year) : null,
    url: url && /^https?:\/\//i.test(url) ? url : null,
    doi,
  };
}

export interface SearchOptions {
  env?: { SESHAT_API_URL?: string; SESHAT_INTEGRATION_TOKEN?: string };
  fetch?: FetchFn;
  limit?: number;
}

/** Searches the forum's Seshat library. Returns [] when the forum has no library/owner linked. */
export async function searchForumCitations(
  settings: ForumBibliographySettings,
  term: string,
  opts: SearchOptions = {},
): Promise<Citation[]> {
  if (!settings.seshatLibraryId || !settings.ownerEmail) return [];
  const env = opts.env ?? (process.env as Record<string, string | undefined>);
  const token = String(env.SESHAT_INTEGRATION_TOKEN || '').trim();
  if (!token) throw new BibliographyError(503, 'bibliography unavailable');
  const base = String(env.SESHAT_API_URL || 'https://seshat.zztt.org').trim().replace(/\/$/, '');
  const limit = Math.max(1, Math.min(MAX_RESULTS, Math.trunc(opts.limit ?? MAX_RESULTS) || MAX_RESULTS));

  const upstream = new URL('/api/integrations/citations/search', base);
  upstream.searchParams.set('q', term.trim().slice(0, MAX_QUERY));
  upstream.searchParams.set('limit', String(limit));
  upstream.searchParams.set('libraryId', settings.seshatLibraryId.slice(0, 200));

  const doFetch = opts.fetch ?? fetch;
  let response: Response;
  try {
    response = await doFetch(upstream, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, 'X-Seshat-Owner': settings.ownerEmail },
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    throw new BibliographyError(502, 'bibliography unavailable');
  }
  if (!response.ok) throw new BibliographyError(502, 'bibliography unavailable');
  const payload: any = await response.json().catch(() => null);
  const items = Array.isArray(payload?.items) ? payload.items : [];
  return items.map(toCitation).filter((c: Citation | null): c is Citation => !!c).slice(0, limit);
}

const CITEKEY_RE = /^[A-Za-z0-9:_-]{1,160}$/;
export const MAX_RESOLVE_KEYS = 100;

/**
 * Resolves `[@key]` citekeys to CSL-JSON items (for remark-seshat-citations'
 * `resolve` option) on behalf of the FORUM's owner (never musiki's global
 * SESHAT_CITATION_OWNER_EMAIL). Returns an empty map, without any request,
 * when the forum has no library/owner linked. The upstream resolve endpoint
 * resolves across the owner's catalog; libraryId is sent for when it scopes.
 * Throws BibliographyError when Seshat is unreachable/misconfigured.
 */
export async function resolveForumCitations(
  settings: ForumBibliographySettings | null,
  keys: string[],
  opts: SearchOptions = {},
): Promise<Map<string, Record<string, unknown>>> {
  const out = new Map<string, Record<string, unknown>>();
  if (!settings?.seshatLibraryId || !settings.ownerEmail) return out;
  const wanted = [...new Set(keys.filter((k) => typeof k === 'string' && CITEKEY_RE.test(k)))].slice(0, MAX_RESOLVE_KEYS);
  if (!wanted.length) return out;
  const env = opts.env ?? (process.env as Record<string, string | undefined>);
  const token = String(env.SESHAT_INTEGRATION_TOKEN || '').trim();
  if (!token) throw new BibliographyError(503, 'bibliography unavailable');
  const base = String(env.SESHAT_API_URL || 'https://seshat.zztt.org').trim().replace(/\/$/, '');
  const upstream = new URL('/api/integrations/citations/resolve', base);
  for (const key of wanted) upstream.searchParams.append('key', key);
  upstream.searchParams.set('libraryId', settings.seshatLibraryId.slice(0, 200));

  const doFetch = opts.fetch ?? fetch;
  let response: Response;
  try {
    response = await doFetch(upstream, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, 'X-Seshat-Owner': settings.ownerEmail },
      signal: AbortSignal.timeout(5_000),
    });
  } catch {
    throw new BibliographyError(502, 'bibliography unavailable');
  }
  if (!response.ok) throw new BibliographyError(502, 'bibliography unavailable');
  const payload: any = await response.json().catch(() => null);
  const wantedSet = new Set(wanted);
  for (const item of Array.isArray(payload?.items) ? payload.items : []) {
    const id = typeof item?.id === 'string' ? item.id : '';
    if (wantedSet.has(id) && item && typeof item === 'object') out.set(id, item);
  }
  return out;
}

/** Small in-memory fixed-window limiter (per key). Returns true when allowed. */
export function createRateLimiter(max: number, windowMs: number, now: () => number = Date.now) {
  const hits = new Map<string, { count: number; reset: number }>();
  return (key: string): boolean => {
    const t = now();
    if (hits.size > 5000) for (const [k, v] of hits) if (v.reset <= t) hits.delete(k);
    const cur = hits.get(key);
    if (!cur || cur.reset <= t) {
      hits.set(key, { count: 1, reset: t + windowMs });
      return true;
    }
    cur.count += 1;
    return cur.count <= max;
  };
}
