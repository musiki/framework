import type { TenantId } from './tenants.ts';
import { DEFAULT_TENANT_ID } from './tenants.ts';

/**
 * Checks whether a content/course entry or frontmatter object belongs to the
 * active tenant (`musiki` or `hem`). Entries without an explicit `tenant`
 * field default to `DEFAULT_TENANT_ID` ('musiki').
 */
export function matchesTenant(
  entryOrData: unknown,
  tenantId: TenantId | string = DEFAULT_TENANT_ID,
): boolean {
  const activeTenant = String(tenantId || DEFAULT_TENANT_ID).trim().toLowerCase() || DEFAULT_TENANT_ID;
  const raw = entryOrData as Record<string, any> | null | undefined;
  const data = raw && typeof raw === 'object' && 'data' in raw && raw.data && typeof raw.data === 'object'
    ? raw.data
    : raw;
  const rawTenant = data?.tenant;
  if (Array.isArray(rawTenant)) {
    const normalized = rawTenant.map((v) => String(v || '').trim().toLowerCase()).filter(Boolean);
    if (normalized.length === 0) return activeTenant === DEFAULT_TENANT_ID;
    return normalized.includes('*') || normalized.includes('all') || normalized.includes(activeTenant);
  }
  const entryTenant = String(rawTenant || DEFAULT_TENANT_ID).trim().toLowerCase() || DEFAULT_TENANT_ID;
  if (entryTenant === '*' || entryTenant === 'all') return true;
  return entryTenant === activeTenant;
}

