// Concept slugs of the mm tenant (pure: no astro/db imports; shared by the
// router, the concepts core, the pages and the client scripts).
//
// A concept's permalink is the ROOT of the mm host: mm.zztt.org/<slug>
// (concepts are space-wide). A single path segment is a concept slug when it
// has the slug format and is not a reserved word. RESERVED_SLUGS is the one
// list both the router (src/lib/tenant/routes.ts) and slug validation use, so
// a concept can never be given a slug that the router sends elsewhere.

/** Lowercase ASCII words joined by single hyphens. */
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Bounds for a slug a person types (and for automatic slugs, which are cut to the max). */
export const SLUG_MIN = 2;
export const SLUG_MAX = 80;
/** Longest single segment the router treats as a concept slug (legacy automatic slugs were not cut). */
export const ROUTE_SLUG_MAX = 200;

/**
 * Words a concept slug can never be: every top-level mm path and route
 * family, the internal mount, the files a crawler asks for, a few kept free
 * for future pages, and every top-level entry of src/pages and public/
 * (slugs.test.mjs scans both, so a new page or static folder fails the tests
 * until it is listed here). Lowercase; entries that cannot match SLUG_RE
 * (favicon.ico, _astro, …) are listed for completeness.
 */
export const RESERVED_SLUGS: readonly string[] = Object.freeze([
  // mm page families and pages
  'f', 'c', 'r', 't', 'graph', 'about', 'join', 'admin', 'concepts', 'concept',
  // other families served on the mm host
  'api', 'auth', 'mm', 'lily', 'mm-app', '_astro',
  // crawler / platform files
  'favicon.ico', 'robots.txt', 'sitemap.xml', 'healthz',
  // internal and future pages
  'not-found', '404', '500', 'index', 'search', 'export', 'new', 'edit', 'settings', 'help',
  'login', 'logout', 'signin', 'signout', 'sign-in', 'sign-out', 'account', 'me', 'u', 'users',
  'feed', 'rss', 'atom', 'static', 'assets', 'public', 'studio', 'www',
  // musiki pages of the engine (top-level src/pages entries) — kept out of
  // the concept namespace so an mm URL never looks like one of them
  'dashboard', 'slides', 'cursos', 'foro', 'live', 'editor', 'privacy', 'terms', 'centauro', 'content-media',
  'debug', 'demo', 'notas', 'notas-editor', 'room', 'sse', 'test-table', 'public-search', 'search-index',
  // top-level entries of public/ (static files served before any page)
  'favicon', 'fonts', 'inc', 'lib', 'logos', 'scripts', 'vendor', 'wasm', 'graph-data', 'logo-musiki', 'hem-logo',
  'msk-diagnostico', 'musiki-background', 'og-image', 'universidad-publica',
]);

const RESERVED = new Set(RESERVED_SLUGS);

export const isReservedSlug = (slug: unknown): boolean => typeof slug === 'string' && RESERVED.has(slug.toLowerCase());

/** The slug format alone (no length rule, no reserved check). */
export const hasSlugFormat = (slug: unknown): slug is string => typeof slug === 'string' && SLUG_RE.test(slug);

/**
 * Whether `slug` can live at the root (/<slug>): the slug format, at most
 * ROUTE_SLUG_MAX characters, not reserved. Concepts whose (older) slug fails
 * this keep their page at /c/<slug> (see view.ts conceptPath).
 */
export const isRootSlug = (slug: unknown): slug is string =>
  hasSlugFormat(slug) && slug.length <= ROUTE_SLUG_MAX && !RESERVED.has(slug);

/**
 * Whether a raw request pathname is exactly one root concept slug segment
 * ('/pharmakon'). Raw = still percent-encoded: any escape, uppercase letter,
 * dot or trailing slash fails the format, so only the canonical spelling routes.
 */
export function isRootSlugPath(pathname: unknown): boolean {
  if (typeof pathname !== 'string' || !pathname.startsWith('/')) return false;
  return isRootSlug(pathname.slice(1));
}

/**
 * Channel slugs a channel can never have: /<group>/t/<thread id> is a thread
 * of the group itself (forum-core re-exports this list).
 */
export const RESERVED_CHANNEL_SLUGS = ['t'] as const;

/** Whether `slug` can be the second segment of a root board path (/<group>/<channel>). */
export const isRootChannelSlug = (slug: unknown): slug is string =>
  hasSlugFormat(slug) && slug.length <= ROUTE_SLUG_MAX && !(RESERVED_CHANNEL_SLUGS as readonly string[]).includes(slug);

/** A thread id in a root path: a canonical (lowercase) uuid. */
const ROUTE_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * What a root path of the mm host names, by shape only (no database):
 *   /<x>                         'slug'   a concept permalink or a forum group
 *   /<group>/<channel>           'board'  a channel of a group
 *   /<group>/t/<thread id>       'thread' a thread of the group itself
 *   /<group>/<channel>/t/<id>    'thread' a thread of a channel
 * The first segment is a root slug (isRootSlug: format, not reserved), the
 * channel a root channel slug (not "t"), the thread id a lowercase uuid.
 * Raw = still percent-encoded: any escape, uppercase letter, dot, empty
 * segment ('//') or trailing slash fails, so only the canonical spelling routes.
 */
export type RootPath =
  | { kind: 'slug'; slug: string }
  | { kind: 'board'; group: string; channel: string }
  | { kind: 'thread'; group: string; channel: string | null; thread: string };

export function parseRootPath(pathname: unknown): RootPath | null {
  if (typeof pathname !== 'string' || !pathname.startsWith('/') || pathname.length > 600) return null;
  const parts = pathname.slice(1).split('/');
  if (parts.length > 4 || parts.some((p) => p === '')) return null;
  const [group, ...rest] = parts;
  if (!isRootSlug(group)) return null;
  if (rest.length === 0) return { kind: 'slug', slug: group };
  if (rest.length === 1) return isRootChannelSlug(rest[0]) ? { kind: 'board', group, channel: rest[0] } : null;
  if (rest.length === 2) {
    return rest[0] === 't' && ROUTE_UUID_RE.test(rest[1]) ? { kind: 'thread', group, channel: null, thread: rest[1] } : null;
  }
  const [channel, t, thread] = rest;
  return isRootChannelSlug(channel) && t === 't' && ROUTE_UUID_RE.test(thread) ? { kind: 'thread', group, channel, thread } : null;
}

/** Whether a raw request pathname has one of the root shapes (parseRootPath). */
export const isRootPath = (pathname: unknown): boolean => parseRootPath(pathname) !== null;

/**
 * What a one-segment root path /<x> shows, given what the space holds under
 * that slug: a live concept first (existing permalinks keep their meaning),
 * else a forum group, else a concept's rename alias (301 to the concept),
 * else nothing (404). Concept and group slugs share the namespace and are
 * kept apart on write (concepts-core, forum-core); this order only decides
 * for data that predates that rule.
 */
export function resolveRootSlug(held: { concept: boolean; group: boolean; alias: boolean }): 'concept' | 'group' | 'alias' | 'none' {
  if (held.concept) return 'concept';
  if (held.group) return 'group';
  if (held.alias) return 'alias';
  return 'none';
}

export type SlugProblem = 'required' | 'format' | 'length' | 'reserved';

/**
 * Checks a slug a person typed. Leading/trailing whitespace is ignored;
 * everything else must already be canonical (the form prefills and
 * normalizes it with slugifyLabel). Returns the slug or the problem.
 */
export function checkCustomSlug(raw: unknown): { slug: string; problem: null } | { slug: null; problem: SlugProblem } {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s) return { slug: null, problem: 'required' };
  if (s.length < SLUG_MIN || s.length > SLUG_MAX) return { slug: null, problem: 'length' };
  if (!SLUG_RE.test(s)) return { slug: null, problem: 'format' };
  if (RESERVED.has(s)) return { slug: null, problem: 'reserved' };
  return { slug: s, problem: null };
}

/** English message for a slug problem (API errors are short English strings). */
export function slugProblemMessage(problem: SlugProblem, slug = ''): string {
  switch (problem) {
    case 'required':
      return 'slug required';
    case 'length':
      return `slug must be ${SLUG_MIN}–${SLUG_MAX} characters`;
    case 'format':
      return 'slug may only use lowercase letters a–z, digits and single hyphens between them';
    case 'reserved':
      return `"${slug.slice(0, 40)}" is a reserved word and cannot be a concept slug`;
  }
}

/**
 * Slug for a label: diacritics stripped, lowercase, runs of anything else
 * become one hyphen, cut to SLUG_MAX at a hyphen when possible. Empty when the
 * label has no letters or digits. Same rule as the site's slugify, without its
 * 'page' fallback (the client prefill uses this too).
 */
export function slugifyLabel(label: unknown): string {
  const s = String(label ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (s.length <= SLUG_MAX) return s;
  const cut = s.slice(0, SLUG_MAX);
  const hyphen = cut.lastIndexOf('-');
  return (hyphen >= SLUG_MIN ? cut.slice(0, hyphen) : cut).replace(/-+$/, '');
}
