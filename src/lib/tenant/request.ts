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
  if (!isRouteAllowed(tenant, input.pathname)) return { tenant, action: 'not-found' };
  // mm page paths coincide with musiki pages (/, /about, /admin): they are
  // served only through the rewrite, never falling through to musiki.
  if (tenant.id === 'mm' && isMmPagePath(input.pathname)) {
    const rewrite = mapMmPath(input.pathname);
    return rewrite ? { tenant, action: 'next', rewrite } : { tenant, action: 'not-found' };
  }
  return { tenant, action: 'next' };
}
