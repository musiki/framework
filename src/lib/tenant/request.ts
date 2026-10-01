import type { Tenant } from './tenants.ts';
import { resolveTenant } from './resolve.ts';
import { isInternalMmPath, isMmPagePath, isRouteAllowed, mapMmPath } from './routes.ts';

/**
 * `rewrite`: internal path the request must be served from (mm tenant only);
 * the middleware applies it with `next(rewrite)` so middleware does not re-run
 * on the internal path.
 */
export type TenantDecision = { tenant: Tenant; action: 'next' | 'not-found'; rewrite?: string };

/**
 * `pathname` must be the raw request pathname (`new URL(request.url).pathname`:
 * percent-encoding kept, duplicate slashes kept) — the same string the router
 * matches, so the allowlist cannot be bypassed by a spelling the router
 * resolves differently.
 */
export function decideTenantRequest(input: {
  host: string | null;
  pathname: string;
  envTenant?: string;
}): TenantDecision {
  const tenant = resolveTenant(input.host, input.envTenant);
  // The mm page mount is internal on every host, musiki included.
  if (isInternalMmPath(input.pathname)) return { tenant, action: 'not-found' };
  if (tenant.routes === 'all') return { tenant, action: 'next' };
  // Scoped tenants: '//' makes the middleware and the router disagree
  // (e.g. /api//auth/x falls to musiki's root catch-all) — refuse it.
  if (input.pathname.includes('//')) return { tenant, action: 'not-found' };
  // Real build assets (/_astro/*) are served by the static handler before SSR;
  // any /_* request reaching middleware would fall to musiki's catch-all.
  if (input.pathname.startsWith('/_')) return { tenant, action: 'not-found' };
  // Astro's router matches decodeURI(pathname): the allowlist must hold for
  // the raw path AND its decoded form (e.g. /api/public/%6Dm → /api/public/mm).
  let decoded: string;
  try {
    decoded = decodeURI(input.pathname);
  } catch {
    return { tenant, action: 'not-found' };
  }
  if (!isRouteAllowed(tenant, input.pathname) || !isRouteAllowed(tenant, decoded)) {
    return { tenant, action: 'not-found' };
  }
  // mm page paths coincide with musiki pages (/, /about, /admin): they are
  // served only through the rewrite, never falling through to musiki.
  if (tenant.id === 'mm' && isMmPagePath(input.pathname)) {
    const rewrite = mapMmPath(input.pathname);
    return rewrite ? { tenant, action: 'next', rewrite } : { tenant, action: 'not-found' };
  }
  return { tenant, action: 'next' };
}

/**
 * Whether the request must carry a session for musiki's /dashboard (else a
 * redirect to /login). Only full-route tenants have that page, and only the
 * path itself or below it: on mm a root concept slug such as /dashboards (or
 * /dashboard, a concept page) is never guarded — mm has no /login.
 */
export function needsDashboardSession(tenant: Tenant, pathname: string): boolean {
  if (tenant.routes !== 'all') return false;
  return pathname === '/dashboard' || pathname.startsWith('/dashboard/');
}
