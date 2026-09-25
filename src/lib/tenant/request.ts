import type { Tenant } from './tenants.ts';
import { resolveTenant } from './resolve.ts';
import { isRouteAllowed } from './routes.ts';

export type TenantDecision = { tenant: Tenant; action: 'next' | 'not-found' };

export function decideTenantRequest(input: {
  host: string | null;
  pathname: string;
  envTenant?: string;
}): TenantDecision {
  const tenant = resolveTenant(input.host, input.envTenant);
  if (tenant.routes === 'all') return { tenant, action: 'next' };
  if (input.pathname.startsWith('/_astro/')) return { tenant, action: 'next' };
  return { tenant, action: isRouteAllowed(tenant, input.pathname) ? 'next' : 'not-found' };
}
