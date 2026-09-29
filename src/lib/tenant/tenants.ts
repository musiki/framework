export type TenantId = 'musiki' | 'hem' | 'so' | 'mm';
// 'nb' (Norsk bokmål) is a UI language of the mm tenant only (dictionary src/lib/i18n/nb.ts).
export type Locale = 'es' | 'fr' | 'en' | 'nb';
export type SpaceKind = 'course' | 'dissertation' | 'commons';
export type RouteFamily = 'studio' | 'api:studio' | 'api:public' | 'auth' | 'mm' | 'api:mm' | 'api:public-mm';
export type TenantTheme = 'default' | 'invulne' | 'so' | 'mm';

export type Tenant = {
  id: TenantId;
  hosts: string[];            // exact, lowercase, no port
  locale: Locale;             // interface locale
  brand: { name: string; theme: TenantTheme };
  spaceKinds: SpaceKind[];
  routes: 'all' | RouteFamily[];
  authProviders: string[];    // Auth.js provider ids, unique across tenants
  homePath: string;           // post-login landing path
  loginPath?: string;         // tenant sign-in page for non-'all' tenants (default '/studio/login')
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
    routes: ['studio', 'api:studio', 'api:public', 'auth'],
    authProviders: ['logto-so'],
    homePath: '/studio',
  },
  // MishMash Concept Machine. Public URLs (/, /f, /c, /graph, /about, /join,
  // /admin) are rewritten by middleware to internal /mm-app/* pages
  // (see mapMmPath in routes.ts). Never shows musiki branding.
  mm: {
    id: 'mm',
    hosts: ['mm.zztt.org'],
    locale: 'en',
    brand: { name: 'MishMash Concept Machine', theme: 'mm' },
    spaceKinds: ['commons'],
    routes: ['mm', 'api:mm', 'api:public-mm', 'auth'],
    authProviders: ['logto-mm'],
    homePath: '/',
    loginPath: '/join',
  },
};
