import type { RouteFamily, Tenant } from './tenants.ts';
import { parseRootPath } from '../mm/slugs.ts';

export const ROUTE_FAMILY_PREFIXES: Record<RouteFamily, string[]> = {
  studio: ['/studio'],
  'api:studio': ['/api/studio'],
  'api:public': ['/api/public'],
  auth: ['/api/auth'],
  mm: ['/f', '/c', '/r', '/graph', '/about', '/join', '/admin', '/concepts'],
  'api:mm': ['/api/mm'],
  'api:public-mm': ['/api/public/mm'],
  // Rendered LilyPond assets (src/pages/lily/[file].ts: content-hash names only).
  lily: ['/lily'],
};

// Paths a family allows only verbatim (never as a prefix): `/` must not
// open up the whole site.
export const ROUTE_FAMILY_EXACT: Partial<Record<RouteFamily, string[]>> = {
  mm: ['/'],
};

const matchesPrefix = (pathname: string, prefix: string) =>
  pathname === prefix || pathname.startsWith(`${prefix}/`);

// Sub-trees carved out of a family's prefixes because another tenant owns
// them: so's `api:public` must never reach mm's public API.
export const ROUTE_FAMILY_EXCLUDED: Partial<Record<RouteFamily, string[]>> = {
  'api:public': ['/api/public/mm'],
};

// Paths a family owns by shape: on mm, the root namespace shared by concepts
// and forums — /<slug> (a concept permalink or a forum group), /<group>/<channel>,
// /<group>/t/<thread id>, /<group>/<channel>/t/<thread id> (slug format, first
// segment not a reserved word — src/lib/mm/slugs.ts parseRootPath). The raw
// path must already be canonical: escapes, uppercase, dots, empty segments or
// a trailing slash never match.
export const ROUTE_FAMILY_SHAPES: Partial<Record<RouteFamily, (pathname: string) => boolean>> = {
  mm: (pathname) => parseRootPath(pathname) !== null,
};

// Families whose prefix is only a mount for one level of files: the exact
// prefix ('/lily') and deeper paths ('/lily/a/b') are not theirs — no page
// serves them, so they would fall through to musiki's root catch-all.
export const ROUTE_FAMILY_ONE_LEVEL: Partial<Record<RouteFamily, true>> = { lily: true };

const prefixMatches = (family: RouteFamily, pathname: string, prefix: string) =>
  ROUTE_FAMILY_ONE_LEVEL[family]
    ? pathname.startsWith(`${prefix}/`) && pathname.length > prefix.length + 1 && !pathname.slice(prefix.length + 1).includes('/')
    : matchesPrefix(pathname, prefix);

const familyMatches = (family: RouteFamily, pathname: string) =>
  (ROUTE_FAMILY_EXACT[family] ?? []).includes(pathname) ||
  (ROUTE_FAMILY_SHAPES[family]?.(pathname) ?? false) ||
  (ROUTE_FAMILY_PREFIXES[family].some((prefix) => prefixMatches(family, pathname, prefix)) &&
    !(ROUTE_FAMILY_EXCLUDED[family] ?? []).some((prefix) => matchesPrefix(pathname, prefix)));

export function isRouteAllowed(tenant: Tenant, pathname: string): boolean {
  if (tenant.routes === 'all') return true;
  return tenant.routes.some((family) => familyMatches(family, pathname));
}

/**
 * Internal mount point of the mm pages (src/pages/mm-app/*). Public mm URLs
 * are rewritten here by middleware; the prefix itself is never reachable by
 * URL on any host. Pages under it must not call Astro.rewrite() to another
 * /mm-app path (that re-runs middleware, which would 404 it).
 */
export const MM_INTERNAL_PREFIX = '/mm-app';

/** True for any spelling of /mm-app or /mm-app/* (case, %-escapes, duplicate slashes). */
export function isInternalMmPath(pathname: string): boolean {
  let p = String(pathname ?? '');
  try {
    p = decodeURIComponent(p);
  } catch {
    /* keep raw */
  }
  p = p.replace(/\/{2,}/g, '/').toLowerCase();
  return matchesPrefix(p, MM_INTERNAL_PREFIX);
}

/**
 * Internal page of a one-segment root path: /<slug> → /mm-app/root/<slug>
 * (a concept permalink or a forum group; the page resolves which).
 */
export const MM_ROOT_MOUNT = `${MM_INTERNAL_PREFIX}/root`;
/**
 * Internal pages of the root board paths: /<group>/<channel>[/t/<id>] and
 * /<group>/t/<id> → /mm-app/b/… (the same segments).
 */
export const MM_BOARD_MOUNT = `${MM_INTERNAL_PREFIX}/b`;

/**
 * Maps a public mm path to its internal page path, or null when the path is
 * not an mm page (APIs, auth, anything else). Purely syntactic (no database):
 * a one-segment root slug ('/pharmakon', '/stiegler') maps to the root page
 * ('/mm-app/root/pharmakon'), which resolves concept or group; the deeper root
 * board shapes map under '/mm-app/b'. Takes the raw (still percent-encoded)
 * pathname and never decodes it: the router decodes params exactly once, so
 * '/f/%2561' keeps the param '%61'.
 *   '/' → '/mm-app/', '/stiegler/tt1' → '/mm-app/b/stiegler/tt1',
 *   '/f/stiegler' → '/mm-app/f/stiegler' (a 301 to /stiegler), '/cursos' → null
 */
export function mapMmPath(pathname: string): string | null {
  if (!isMmPagePath(pathname)) return null;
  const root = parseRootPath(pathname);
  const target = pathname === '/'
    ? `${MM_INTERNAL_PREFIX}/`
    : root?.kind === 'slug'
      ? `${MM_ROOT_MOUNT}${pathname}`
      : root
        ? `${MM_BOARD_MOUNT}${pathname}`
        : `${MM_INTERNAL_PREFIX}${pathname}`;
  // Defence in depth: the target must stay under the mount after URL
  // normalisation (dot segments, including %2e forms).
  let normalized: string;
  try {
    normalized = new URL(target, 'http://mm.invalid').pathname;
  } catch {
    return null;
  }
  return matchesPrefix(normalized, MM_INTERNAL_PREFIX) ? target : null;
}

/** True when the path belongs to the public mm page family (`/` exactly, /f, /c, …, or a root shape: concept, group, board, thread). */
export function isMmPagePath(pathname: string): boolean {
  return familyMatches('mm', pathname);
}
