import type { RouteFamily, Tenant } from './tenants.ts';

export const ROUTE_FAMILY_PREFIXES: Record<RouteFamily, string[]> = {
  studio: ['/studio'],
  'api:studio': ['/api/studio'],
  'api:public': ['/api/public'],
  auth: ['/api/auth'],
  mm: ['/f', '/c', '/graph', '/about', '/join', '/admin'],
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

const familyMatches = (family: RouteFamily, pathname: string) =>
  (ROUTE_FAMILY_EXACT[family] ?? []).includes(pathname) ||
  (ROUTE_FAMILY_PREFIXES[family].some((prefix) => matchesPrefix(pathname, prefix)) &&
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
 * Maps a public mm path to its internal page path, or null when the path is
 * not an mm page (APIs, auth, anything else). Takes the raw (still
 * percent-encoded) pathname and never decodes it: the router decodes params
 * exactly once, so '/f/%2561' keeps the param '%61'.
 *   '/' → '/mm-app/', '/f/stiegler' → '/mm-app/f/stiegler', '/cursos' → null
 */
export function mapMmPath(pathname: string): string | null {
  if (!isMmPagePath(pathname)) return null;
  const target = pathname === '/' ? `${MM_INTERNAL_PREFIX}/` : `${MM_INTERNAL_PREFIX}${pathname}`;
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

/** True when the path belongs to the public mm page family (`/` exactly, /f, /c, …). */
export function isMmPagePath(pathname: string): boolean {
  return familyMatches('mm', pathname);
}
