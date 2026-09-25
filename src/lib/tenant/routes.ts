import type { RouteFamily, Tenant } from './tenants.ts';

export const ROUTE_FAMILY_PREFIXES: Record<RouteFamily, string[]> = {
  studio: ['/studio'],
  'api:studio': ['/api/studio'],
  auth: ['/api/auth'],
};

const matchesPrefix = (pathname: string, prefix: string) =>
  pathname === prefix || pathname.startsWith(`${prefix}/`);

export function isRouteAllowed(tenant: Tenant, pathname: string): boolean {
  if (tenant.routes === 'all') return true;
  return tenant.routes.some((family) =>
    ROUTE_FAMILY_PREFIXES[family].some((prefix) => matchesPrefix(pathname, prefix)),
  );
}
