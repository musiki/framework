import type { Tenant } from './tenants.ts';
import { isAuthProviderAllowed } from './resolve.ts';

export type AuthRouteDecision =
  | { kind: 'pass' }
  | { kind: 'not-found' }
  | { kind: 'redirect'; location: string }
  | { kind: 'filter-providers' };

const STUDIO_LOGIN = '/studio/login';

export function sanitizeAuthErrorCode(raw: string | null | undefined): string {
  const code = String(raw ?? '').replace(/[^A-Za-z]/g, '').slice(0, 64);
  return code || 'Default';
}

/**
 * Decides how /api/auth/<action>/<providerId> is handled for a tenant.
 * Foreign providers are hidden everywhere; tenants without the full route set
 * never see Auth.js's built-in pages (which would list every provider).
 */
export function decideAuthRoute(
  tenant: Tenant,
  action: string,
  providerId?: string,
  errorCode?: string | null,
): AuthRouteDecision {
  if ((action === 'signin' || action === 'callback') && providerId && !isAuthProviderAllowed(tenant, providerId)) {
    return { kind: 'not-found' };
  }
  if (tenant.routes === 'all') return { kind: 'pass' };
  if (action === 'providers') return { kind: 'filter-providers' };
  if (action === 'signin' && !providerId) return { kind: 'redirect', location: STUDIO_LOGIN };
  if (action === 'error') {
    return { kind: 'redirect', location: `${STUDIO_LOGIN}?error=${sanitizeAuthErrorCode(errorCode)}` };
  }
  return { kind: 'pass' };
}

export function filterProvidersPayload(tenant: Tenant, payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object') return {};
  return Object.fromEntries(
    Object.entries(payload as Record<string, unknown>).filter(([id]) => isAuthProviderAllowed(tenant, id)),
  );
}

export function studioLoginErrorKey(
  code: string | null | undefined,
): 'studio.errors.accessDenied' | 'studio.errors.generic' | null {
  if (!code) return null;
  return code === 'AccessDenied' ? 'studio.errors.accessDenied' : 'studio.errors.generic';
}
