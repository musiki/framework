import { TENANTS, DEFAULT_TENANT_ID, type Tenant, type TenantId } from './tenants.ts';

export function normalizeHost(raw: string | null | undefined): string {
  const first = String(raw ?? '').split(',')[0].trim().toLowerCase();
  return first.replace(/:\d+$/, '').replace(/\.$/, '');
}

export function findTenantByHost(raw: string | null | undefined): Tenant | null {
  const host = normalizeHost(raw);
  if (!host) return null;
  for (const tenant of Object.values(TENANTS)) {
    if (tenant.hosts.includes(host)) return tenant;
  }
  return null;
}

export function isTenantId(value: unknown): value is TenantId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(TENANTS, value);
}

export function resolveTenant(rawHost: string | null | undefined, envOverride?: string): Tenant {
  if (isTenantId(envOverride)) return TENANTS[envOverride];
  return findTenantByHost(rawHost) ?? TENANTS[DEFAULT_TENANT_ID];
}

export function tenantForAuthProvider(providerId: string | undefined): Tenant | null {
  if (!providerId) return null;
  return Object.values(TENANTS).find((t) => t.authProviders.includes(providerId)) ?? null;
}

export function isAuthProviderAllowed(tenant: Tenant, providerId: string): boolean {
  return tenant.authProviders.includes(providerId);
}

/**
 * Which sign-in authorization a provider goes through. Full-route tenants
 * (musiki, hem: routes === "all") use the account path (UserEmail/User
 * lookup); limited tenants (so, mm) use space/invite authorization. Unknown
 * providers fall back to the account path, as before.
 */
export function signInTenantFor(providerId: string | undefined): Tenant | null {
  const tenant = tenantForAuthProvider(providerId);
  if (!tenant || tenant.routes === 'all') return null;
  return tenant;
}
