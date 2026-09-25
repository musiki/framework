export type TenantId = 'musiki' | 'hem' | 'so';
export type Locale = 'es' | 'fr' | 'en';
export type SpaceKind = 'course' | 'dissertation';
export type RouteFamily = 'studio' | 'api:studio' | 'auth';
export type TenantTheme = 'default' | 'invulne' | 'so';

export type Tenant = {
  id: TenantId;
  hosts: string[];            // exact, lowercase, no port
  locale: Locale;             // interface locale
  brand: { name: string; theme: TenantTheme };
  spaceKinds: SpaceKind[];
  routes: 'all' | RouteFamily[];
  authProviders: string[];    // Auth.js provider ids, unique across tenants
  homePath: string;           // post-login landing path
};

export const DEFAULT_TENANT_ID: TenantId = 'musiki';

export const TENANTS: Record<TenantId, Tenant> = {
  musiki: {
    id: 'musiki',
    hosts: ['musiki.org.ar', 'www.musiki.org.ar', 'dev.musiki.org.ar'],
    locale: 'es',
    brand: { name: 'Musiki', theme: 'default' },
    spaceKinds: ['course'],
    routes: 'all',
    authProviders: ['logto', 'google', 'authentik'],
    homePath: '/dashboard',
  },
  // hem.zztt.org is still served by the fork; hosts are added in sub-project 4.
  hem: {
    id: 'hem',
    hosts: [],
    locale: 'fr',
    brand: { name: 'HEM', theme: 'default' },
    spaceKinds: ['course'],
    routes: 'all',
    authProviders: ['logto-hem'],
    homePath: '/dashboard',
  },
  so: {
    id: 'so',
    hosts: ['so.zztt.org', 'so-dev.zztt.org'],
    locale: 'en',
    brand: { name: 'so', theme: 'so' },
    spaceKinds: ['dissertation'],
    routes: ['studio', 'api:studio', 'auth'],
    authProviders: ['logto-so'],
    homePath: '/studio',
  },
};
