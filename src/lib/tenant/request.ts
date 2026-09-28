import type { Tenant } from './tenants.ts';
import { resolveTenant } from './resolve.ts';
import { isInternalMmPath, isMmPagePath, isRouteAllowed, mapMmPath } from './routes.ts';

/**
 * `rewrite`: internal path the request must be served from (mm tenant only);
 * the middleware applies it with `next(rewrite)` so middleware does not re-run
 * on the internal path.
 */
export type TenantDecision = { tenant: Tenant; action: 'next' | 'not-found'; rewrite?: string };

export function decideTenantRequest(input: {
  host: string | null;
  pathname: string;
  envTenant?: string;
}): TenantDecision {
  const tenant = resolveTenant(input.host, input.envTenant);
  // The mm page mount is internal on every host, musiki included.
  if (isInternalMmPath(input.pathname)) return { tenant, action: 'not-found' };
  if (tenant.routes === 'all') return { tenant, action: 'next' };
  if (input.pathname.startsWith('/_astro/')) return { tenant, action: 'next' };
  if (!isRouteAllowed(tenant, input.pathname)) return { tenant, action: 'not-found' };
  // mm page paths coincide with musiki pages (/, /about, /admin): they are
  // served only through the rewrite, never falling through to musiki.
  if (tenant.id === 'mm' && isMmPagePath(input.pathname)) {
    const rewrite = mapMmPath(input.pathname);
    return rewrite ? { tenant, action: 'next', rewrite } : { tenant, action: 'not-found' };
  }
  return { tenant, action: 'next' };
}
