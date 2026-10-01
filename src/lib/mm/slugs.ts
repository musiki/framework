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
  'favicon', 'fonts', 'inc', 'lib', 'logos', 'scripts', 'vendor', 'wasm', 'graph-data', 'logo-musiki',
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
