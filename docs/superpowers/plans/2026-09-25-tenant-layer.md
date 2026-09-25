# Tenant Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the musiki engine serve a second, fully isolated face (`so`, English) on so.zztt.org/studio, with Logto login, per-space roles, invitations and email/domain access rules, without changing anything visible on musiki.org.ar.

**Architecture:** A pure tenant resolver (host → tenant config in code) feeds middleware (`locals.tenant`), a default-deny route allowlist, tenant-aware auth origin/provider checks, and tenant-scoped studio APIs backed by new `Space*` tables. Pure logic lives in small `.ts` modules tested with `node --test` (Node 24 strips types); DB wrappers and Astro pages stay thin.

**Tech Stack:** Astro 6 (SSR, `@astrojs/node`), auth-astro 4.2 / `@auth/core` 0.37, Postgres via `src/lib/db/pool.ts` `query()`, Node 24 `node:test`, Caddy, pm2, self-hosted Logto.

**Spec:** `docs/superpowers/specs/2026-09-25-tenant-layer-design.md`

**Execution order:** 0 → 1 → 2 → 4 → 3 → 5 → 6 → 7 → 8 → 9 → 10 → 11.

**Deviations from the spec (intentional):** `brand.theme` uses a tenant-local `TenantTheme` instead of extending the global `SITE_THEMES` (which is musiki's admin-selectable theme); `brand.logo`/`mailFrom` are omitted until something uses them; `Tenant.homePath` is added for the post-login fallback.

## Global Constraints

- musiki.org.ar behavior must not change. Unknown hosts resolve to tenant `musiki`.
- Tenant config is code (`src/lib/tenant/tenants.ts`), not DB. Secrets only via env.
- Non-`musiki` tenants are default-deny: only `/studio`, `/api/studio/*`, `/api/auth/*` (and `/_astro/*` assets) are reachable.
- `User.role` grants nothing in the studio; only `SpaceMember.role` does.
- Space roles: `author | supervisor | coordinator | reviewer | guest`. `author` is never granted by invites or rules.
- so sign-in requires Logto `email_verified: true` on every path.
- Domain rules match the exact domain after `@` (no subdomains, no suffix tricks).
- Interface locale comes from the tenant; content language from `note.lang ?? Space.lang`.
- Stored trace keys (`'sintesis'`, `'tesis'`, …) are never renamed; only labels are translated.
- Pure modules (`src/lib/tenant/*.ts` except `*-db.ts`, `src/lib/i18n/*`, `src/lib/writing/lang/*`) must not import `astro:*`, `auth-astro`, or `src/lib/db/*`; relative imports between them use the `.ts` extension so `node --test` can load them.
- Tests: `node:test` + `node:assert/strict`, files named `*.test.mjs` next to the code, registered in `package.json` `test` script.
- Log each merged task in `MEMORY.md` (date, commit, one-line impact), per AGENTS.md.
- Remote shell on `hetzner` is fish: always wrap remote commands in `bash -c '…'`. Never source or print `.env`.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/tenant/tenants.ts` | Tenant type + `TENANTS` config |
| `src/lib/tenant/resolve.ts` | host normalization, tenant lookup, provider lookup |
| `src/lib/tenant/routes.ts` | route allowlist |
| `src/lib/tenant/request.ts` | middleware decision (pure) |
| `src/lib/tenant/space-roles.ts` | role list, grantable roles, input validation |
| `src/lib/tenant/access.ts` | sign-in access decision (pure) |
| `src/lib/tenant/access-db.ts` | DB wrapper: `authorizeTenantSignIn` (loads rows, provisions user/member) |
| `src/lib/tenant/studio-db.ts` | DB helpers for studio pages/APIs (memberships, invites, rules) |
| `src/lib/i18n/{en,es,index}.ts` | UI dictionary + `t()` |
| `src/lib/writing/lang/{es,en,index}.ts` | tracer language packs |
| `src/lib/writing/index.ts` | package boundary for editor/tracer (future `packages/*`) |
| `src/layouts/StudioLayout.astro` | English, so-branded shell |
| `src/pages/studio/*` | studio pages |
| `src/pages/api/studio/*` | studio APIs |
| `postgres-patches/migrations/20260925120000_tenant_spaces.sql` | new tables/columns |
| `postgres-patches/seeds/so-dissertation-space.sql` | seed your space + author |

---

### Task 0: Isolated staging database for `musiki-framework-dev`

Ops task on `hetzner`. **Ask the user for confirmation before each remote write step.**

**Files:**
- Modify: `ecosystem.config.cjs` (env of app `musiki-framework-dev`, ~L38-52)

**Interfaces:**
- Produces: staging DB `musiki_staging`; env var `DATABASE_URL` on `musiki-framework-dev` pointing at it. Later tasks apply migrations there first.

- [ ] **Step 1: Identify the Postgres container and DB user (read-only)**

```bash
ssh hetzner "bash -c 'docker ps --format \"{{.Names}} {{.Ports}}\" | grep 5432'"
```
Expected: one container publishing `127.0.0.1:5432` (at last check: `authentik-postgresql`; `docs/db/database-management.md` still says `devmusiki-db`). Export its name **in your local shell** so the commands below expand it before sending: `export PGC=<container-name>` (fish: `set -x PGC <container-name>`). DB user per docs: `app`; verify with:
```bash
ssh hetzner "bash -c 'docker exec $PGC psql -U app -d musiki26 -Atc \"select current_user, current_database()\"'"
```
Expected: `app|musiki26`

- [ ] **Step 2: Create `musiki_staging` with production schema, no data**

```bash
ssh hetzner "bash -c 'docker exec $PGC createdb -U app musiki_staging && docker exec $PGC pg_dump -U app --schema-only --no-owner musiki26 | docker exec -i $PGC psql -U app -d musiki_staging -q'"
ssh hetzner "bash -c 'docker exec $PGC psql -U app -d musiki_staging -Atc \"select count(*) from information_schema.tables where table_schema=\x27public\x27\"'"
```
Expected: same table count as `musiki26` (compare with the same query on `musiki26`).

- [ ] **Step 3: Point the dev process at staging**

In `ecosystem.config.cjs`, inside the `env` block of `name: 'musiki-framework-dev'`, add a `DATABASE_URL` built from the prod one with the DB name swapped. The file already reads `.env` into a variable near L4 (`envPath`); reuse it:

```js
// near the top, after envPath is defined
const prodDatabaseUrl = (() => {
  try {
    const line = require('fs').readFileSync(envPath, 'utf8').split('\n').find((l) => l.startsWith('DATABASE_URL='));
    return line ? line.slice('DATABASE_URL='.length).replace(/^"|"$/g, '') : '';
  } catch { return ''; }
})();
const stagingDatabaseUrl = prodDatabaseUrl.replace(/\/musiki26(\?|$)/, '/musiki_staging$1');
```
```js
// in musiki-framework-dev env:
DATABASE_URL: stagingDatabaseUrl,
```
If `ecosystem.config.cjs` already parses `.env` differently, reuse that parsed object instead of re-reading the file.

- [ ] **Step 4: Deploy the config and restart only the dev process**

Commit + push, pull on VPS (per `scripts/vps-update.sh` convention), then:
```bash
ssh hetzner 'bash -c "cd /opt/musiki/framework && pm2 startOrReload ecosystem.config.cjs --only musiki-framework-dev && pm2 env \$(pm2 id musiki-framework-dev | tr -dc 0-9) | grep -c musiki_staging"'
```
Expected: `1`. Open https://dev.musiki.org.ar — it loads (empty data is expected).

- [ ] **Step 5: Document and commit**

Add to `docs/db/database-management.md` a "Staging" section: DB name, container, how to apply a migration to staging first:
```bash
ssh hetzner "bash -c 'docker exec -i $PGC psql -U app -d musiki_staging'" < postgres-patches/migrations/<file>.sql
```
Also fix the container name in that doc if Step 1 showed it changed.
```bash
git add ecosystem.config.cjs docs/db/database-management.md MEMORY.md
git commit -m "ops: isolated musiki_staging DB for dev process"
```

---

### Task 1: Tenant config and host resolution

**Files:**
- Create: `src/lib/tenant/tenants.ts`, `src/lib/tenant/resolve.ts`
- Test: `src/lib/tenant/resolve.test.mjs`
- Modify: `package.json` (`test` script)

**Interfaces:**
- Produces:
  - `type TenantId = 'musiki' | 'hem' | 'so'`, `type Locale = 'es' | 'fr' | 'en'`, `type SpaceKind = 'course' | 'dissertation'`, `type RouteFamily = 'studio' | 'api:studio' | 'auth'`, `type Tenant`
  - `TENANTS: Record<TenantId, Tenant>`, `DEFAULT_TENANT_ID: TenantId`
  - `normalizeHost(raw: string | null | undefined): string`
  - `findTenantByHost(raw: string | null | undefined): Tenant | null`
  - `isTenantId(v: unknown): v is TenantId`
  - `resolveTenant(rawHost: string | null | undefined, envOverride?: string): Tenant`
  - `tenantForAuthProvider(providerId: string | undefined): Tenant | null`
  - `isAuthProviderAllowed(tenant: Tenant, providerId: string): boolean`

- [ ] **Step 1: Write the failing test**

`src/lib/tenant/resolve.test.mjs`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { TENANTS } from './tenants.ts';
import {
  normalizeHost, findTenantByHost, resolveTenant, tenantForAuthProvider, isAuthProviderAllowed,
} from './resolve.ts';

test('normalizeHost lowercases, strips port, trailing dot and forwarded lists', () => {
  assert.equal(normalizeHost('SO.zztt.org:443'), 'so.zztt.org');
  assert.equal(normalizeHost('so.zztt.org.'), 'so.zztt.org');
  assert.equal(normalizeHost('so.zztt.org, 10.0.0.1'), 'so.zztt.org');
  assert.equal(normalizeHost(null), '');
});

test('known hosts resolve to their tenant', () => {
  assert.equal(resolveTenant('so.zztt.org').id, 'so');
  assert.equal(resolveTenant('so-dev.zztt.org').id, 'so');
  assert.equal(resolveTenant('musiki.org.ar').id, 'musiki');
});

test('unknown host falls back to musiki', () => {
  assert.equal(resolveTenant('evil.example.com').id, 'musiki');
  assert.equal(resolveTenant('localhost:4321').id, 'musiki');
  assert.equal(findTenantByHost('evil.example.com'), null);
});

test('env override wins only with a valid tenant id', () => {
  assert.equal(resolveTenant('localhost', 'so').id, 'so');
  assert.equal(resolveTenant('localhost', 'nope').id, 'musiki');
});

test('hosts and auth providers are unique across tenants', () => {
  const hosts = Object.values(TENANTS).flatMap((t) => t.hosts);
  assert.equal(new Set(hosts).size, hosts.length);
  const providers = Object.values(TENANTS).flatMap((t) => t.authProviders);
  assert.equal(new Set(providers).size, providers.length);
});

test('providers map to tenants and are only allowed on their tenant', () => {
  assert.equal(tenantForAuthProvider('logto-so')?.id, 'so');
  assert.equal(tenantForAuthProvider('google')?.id, 'musiki');
  assert.equal(tenantForAuthProvider('unknown'), null);
  assert.equal(isAuthProviderAllowed(TENANTS.so, 'google'), false);
  assert.equal(isAuthProviderAllowed(TENANTS.so, 'logto-so'), true);
  assert.equal(isAuthProviderAllowed(TENANTS.musiki, 'logto-so'), false);
});
```

- [ ] **Step 2: Register tests and run to see failure**

In `package.json` `scripts.test`, append `"src/lib/tenant/*.test.mjs"` inside the existing `node --test …` argument list (keep the other globs). Run:
```bash
node --test src/lib/tenant/resolve.test.mjs
```
Expected: FAIL, `Cannot find module …/tenants.ts`.

- [ ] **Step 3: Implement**

`src/lib/tenant/tenants.ts`:
```ts
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
```

`src/lib/tenant/resolve.ts`:
```ts
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
```

- [ ] **Step 4: Run tests**

```bash
node --test src/lib/tenant/resolve.test.mjs && npm test
```
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tenant/tenants.ts src/lib/tenant/resolve.ts src/lib/tenant/resolve.test.mjs package.json
git commit -m "feat(tenant): tenant config and host resolution"
```

---

### Task 2: Route allowlist and route sweep

**Files:**
- Create: `src/lib/tenant/routes.ts`
- Test: `src/lib/tenant/routes.test.mjs`

**Interfaces:**
- Consumes: `Tenant`, `RouteFamily`, `TENANTS` (Task 1)
- Produces:
  - `ROUTE_FAMILY_PREFIXES: Record<RouteFamily, string[]>`
  - `isRouteAllowed(tenant: Tenant, pathname: string): boolean`

- [ ] **Step 1: Write the failing test**

`src/lib/tenant/routes.test.mjs`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { TENANTS } from './tenants.ts';
import { isRouteAllowed } from './routes.ts';

const so = TENANTS.so;

test('musiki allows everything', () => {
  for (const p of ['/', '/cursos', '/foro', '/api/enroll', '/studio']) {
    assert.equal(isRouteAllowed(TENANTS.musiki, p), true, p);
  }
});

test('so allows only studio, studio api and auth', () => {
  for (const p of ['/studio', '/studio/', '/studio/settings/access', '/api/studio/me', '/api/auth/session']) {
    assert.equal(isRouteAllowed(so, p), true, p);
  }
  for (const p of ['/', '/cursos', '/foro', '/dashboard', '/login', '/api/enroll', '/api/graph-data',
    '/studiox', '/api/studiox', '/api/authz', '/api/notes/list']) {
    assert.equal(isRouteAllowed(so, p), false, p);
  }
});

// Sweep: every page file must be unreachable from `so` unless it lives under an allowed prefix.
const PAGES = path.resolve('src/pages');
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return walk(full);
    return /\.(astro|ts|js|mjs|md|mdx)$/.test(e.name) && !e.name.endsWith('.test.mjs') ? [full] : [];
  });
}
function sampleRoute(file) {
  let rel = '/' + path.relative(PAGES, file).replace(/\\/g, '/').replace(/\.(astro|ts|js|mjs|md|mdx)$/, '');
  rel = rel.replace(/\/index$/, '') || '/';
  return rel.replace(/\[\.\.\.[^\]]+\]/g, 'x/y').replace(/\[[^\]]+\]/g, 'x');
}
const ALLOWED_PREFIXES = ['/studio', '/api/studio', '/api/auth'];
const underAllowed = (r) => ALLOWED_PREFIXES.some((p) => r === p || r.startsWith(p + '/'));

test('route sweep: no musiki route is reachable from so', () => {
  const routes = walk(PAGES).map(sampleRoute);
  assert.ok(routes.length > 20, 'expected to find the musiki page tree');
  for (const r of routes) {
    if (underAllowed(r)) continue;
    assert.equal(isRouteAllowed(so, r), false, `leak: ${r} reachable from so`);
  }
});
```

- [ ] **Step 2: Run to see failure**

```bash
node --test src/lib/tenant/routes.test.mjs
```
Expected: FAIL, cannot find `routes.ts`.

- [ ] **Step 3: Implement**

`src/lib/tenant/routes.ts`:
```ts
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
```

- [ ] **Step 4: Run tests**

```bash
node --test src/lib/tenant/routes.test.mjs
```
Expected: PASS. (Run from the repo root: the sweep uses `path.resolve('src/pages')`.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/tenant/routes.ts src/lib/tenant/routes.test.mjs
git commit -m "feat(tenant): default-deny route allowlist with page-tree sweep"
```

---

### Task 3: Middleware wiring, `locals.tenant`, studio 404

**Files:**
- Create: `src/lib/tenant/request.ts`, `src/layouts/StudioLayout.astro`, `src/pages/studio/not-found.astro`
- Test: `src/lib/tenant/request.test.mjs`
- Modify: `src/middleware.ts`, `src/env.d.ts`

**Interfaces:**
- Consumes: `resolveTenant` (Task 1), `isRouteAllowed` (Task 2)
- Produces:
  - `decideTenantRequest(input: { host: string | null; pathname: string; envTenant?: string }): { tenant: Tenant; action: 'next' | 'not-found' }`
  - `App.Locals.tenant: Tenant`
  - `StudioLayout` props: `{ title: string; locale: Locale }`
  - route `/studio/not-found` (status 404)

- [ ] **Step 1: Write the failing test**

`src/lib/tenant/request.test.mjs`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { decideTenantRequest } from './request.ts';

test('musiki host passes through untouched', () => {
  const d = decideTenantRequest({ host: 'musiki.org.ar', pathname: '/foro' });
  assert.equal(d.tenant.id, 'musiki');
  assert.equal(d.action, 'next');
});

test('so host: allowed routes pass, others are not-found', () => {
  assert.equal(decideTenantRequest({ host: 'so.zztt.org', pathname: '/studio' }).action, 'next');
  assert.equal(decideTenantRequest({ host: 'so.zztt.org', pathname: '/foro' }).action, 'not-found');
  assert.equal(decideTenantRequest({ host: 'so.zztt.org', pathname: '/search.json' }).action, 'not-found');
});

test('so host: built assets pass', () => {
  assert.equal(decideTenantRequest({ host: 'so.zztt.org', pathname: '/_astro/app.123.js' }).action, 'next');
});

test('dev override applies', () => {
  assert.equal(decideTenantRequest({ host: 'localhost:4321', pathname: '/cursos', envTenant: 'so' }).action, 'not-found');
});
```

- [ ] **Step 2: Run to see failure**

```bash
node --test src/lib/tenant/request.test.mjs
```
Expected: FAIL, cannot find `request.ts`.

- [ ] **Step 3: Implement `request.ts`**

```ts
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
```

- [ ] **Step 4: Run test**

```bash
node --test src/lib/tenant/request.test.mjs
```
Expected: PASS.

- [ ] **Step 5: Wire middleware**

In `src/middleware.ts`, add the import and make the tenant decision the **first** thing in `onRequest` (before the `isStaticLike` early return, so static-looking paths such as `/search.json` cannot bypass the allowlist on so):

```ts
import { decideTenantRequest } from "./lib/tenant/request";
```
```ts
export const onRequest = defineMiddleware(async (context, next) => {
  const url = context.url;
  const pathname = url.pathname;

  const decision = decideTenantRequest({
    host: context.request.headers.get("x-forwarded-host") || context.request.headers.get("host") || url.hostname,
    pathname,
    envTenant: import.meta.env.DEV ? process.env.TENANT : undefined,
  });
  context.locals.tenant = decision.tenant;
  if (decision.action === "not-found") {
    return context.rewrite("/studio/not-found");
  }

  // …existing code continues unchanged (isStaticLike, www redirect, session, eval sync, dashboard guard)
```

In `src/env.d.ts`, extend `Locals`:
```ts
import type { Tenant } from "./lib/tenant/tenants";
// …
    interface Locals {
      session: Session | null;
      tenant: Tenant;
    }
```

- [ ] **Step 6: Studio layout and 404 page**

`src/layouts/StudioLayout.astro`:
```astro
---
import type { Locale } from '../lib/tenant/tenants';
interface Props { title: string; locale: Locale }
const { title, locale } = Astro.props;
---
<!doctype html>
<html lang={locale}>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>{title} · so</title>
    <style is:global>
      :root { --so-bg: #fff; --so-fg: #111; --so-muted: #666; --so-border: #e5e5e5; --so-accent: #111; }
      @media (prefers-color-scheme: dark) {
        :root { --so-bg: #111; --so-fg: #eee; --so-muted: #999; --so-border: #2a2a2a; --so-accent: #eee; }
      }
      body { margin: 0; background: var(--so-bg); color: var(--so-fg);
        font: 16px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
      .so-wrap { max-width: 760px; margin: 0 auto; padding: 2rem 1rem; }
      .so-top { display: flex; justify-content: space-between; align-items: baseline;
        border-bottom: 1px solid var(--so-border); padding-bottom: .75rem; margin-bottom: 2rem; }
      .so-top a { color: var(--so-fg); text-decoration: none; font-weight: 600; }
      .so-muted { color: var(--so-muted); }
      button, input, select { font: inherit; }
    </style>
  </head>
  <body>
    <div class="so-wrap">
      <header class="so-top"><a href="/studio">so / studio</a><slot name="nav" /></header>
      <main><slot /></main>
    </div>
  </body>
</html>
```

`src/pages/studio/not-found.astro`:
```astro
---
import StudioLayout from '../../layouts/StudioLayout.astro';
import { t } from '../../lib/i18n';
export const prerender = false;
const locale = Astro.locals.tenant.locale;
Astro.response.status = 404;
---
<StudioLayout title={t(locale, 'errors.notFound')} locale={locale}>
  <h1>{t(locale, 'errors.notFound')}</h1>
  <p class="so-muted">{t(locale, 'errors.notFoundLead')}</p>
  <p><a href="/studio">{t(locale, 'errors.backHome')}</a></p>
</StudioLayout>
```
Note: this page depends on `t()` from Task 4. **Execute Task 4 before Task 3** (Task 4 depends only on Task 1).

- [ ] **Step 7: Verify locally**

```bash
TENANT=so npm run dev
```
In another shell:
```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:4321/foro
curl -s http://localhost:4321/foro | grep -ci musiki
```
Expected: `404`, then `0`. Stop, run `npm run dev` without `TENANT` and confirm `http://localhost:4321/` renders musiki as before.

- [ ] **Step 8: Commit**

```bash
git add src/lib/tenant/request.ts src/lib/tenant/request.test.mjs src/middleware.ts src/env.d.ts src/layouts/StudioLayout.astro src/pages/studio/not-found.astro
git commit -m "feat(tenant): resolve tenant in middleware and deny non-allowlisted routes"
```

---

### Task 4: UI dictionary and `t()`

**Files:**
- Create: `src/lib/i18n/en.ts`, `src/lib/i18n/es.ts`, `src/lib/i18n/index.ts`
- Test: `src/lib/i18n/i18n.test.mjs`
- Modify: `package.json` (`test` script: add `"src/lib/i18n/*.test.mjs"`)

**Interfaces:**
- Consumes: `Locale` (Task 1)
- Produces: `t(locale: Locale, key: MessageKey, vars?: Record<string, string | number>): string`, `type MessageKey`, `type Dict`

- [ ] **Step 1: Write the failing test**

`src/lib/i18n/i18n.test.mjs`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { t } from './index.ts';
import { en } from './en.ts';
import { es } from './es.ts';

test('translates by locale', () => {
  assert.equal(t('en', 'roles.supervisor'), 'Supervisor');
  assert.equal(t('es', 'roles.supervisor'), 'Director/a');
});

test('fr falls back to en until hem joins', () => {
  assert.equal(t('fr', 'roles.author'), 'Author');
});

test('interpolates variables', () => {
  assert.equal(t('en', 'studio.invite.expires', { days: 14 }), 'Expires in 14 days.');
});

test('stored trace keys map to English labels', () => {
  assert.equal(t('en', 'trace.role.sintesis'), 'Synthesis');
});

function leaves(obj, prefix = '') {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === 'string' ? [[prefix + k, v]] : leaves(v, `${prefix}${k}.`));
}

test('no empty strings in any dictionary, and es has every en key', () => {
  const esKeys = new Set(leaves(es).map(([k]) => k));
  for (const [k, v] of leaves(en)) {
    assert.ok(v.trim(), `empty en: ${k}`);
    assert.ok(esKeys.has(k), `missing es: ${k}`);
  }
  for (const [k, v] of leaves(es)) assert.ok(v.trim(), `empty es: ${k}`);
});
```

- [ ] **Step 2: Register + run to see failure**

Append `"src/lib/i18n/*.test.mjs"` to `scripts.test`. Run `node --test src/lib/i18n/i18n.test.mjs`. Expected: FAIL (missing module).

- [ ] **Step 3: Implement**

`src/lib/i18n/en.ts`:
```ts
export const en = {
  studio: {
    title: 'Studio',
    signIn: 'Sign in',
    signInLead: 'Sign in to access the writing studio.',
    signOut: 'Sign out',
    mySpaces: 'Your spaces',
    noSpaces: 'You are not a member of any space yet.',
    role: 'Role',
    settings: 'Access settings',
    invite: {
      title: 'Invitation',
      lead: 'You have been invited to a writing space. Sign in with the invited email address to continue.',
      accept: 'Continue with sign-in',
      invalid: 'This invitation is invalid or has expired.',
      create: 'Create invitation',
      email: 'Email',
      created: 'Invitation link (share it with the invitee):',
      expires: 'Expires in {days} days.',
    },
    access: {
      title: 'Access rules',
      lead: 'People whose verified email matches one of these rules can sign in with the given role.',
      kind: 'Type',
      kindEmail: 'Email',
      kindDomain: 'Domain',
      value: 'Email or domain',
      add: 'Add rule',
      remove: 'Remove',
      empty: 'No rules yet.',
      domainWarning: 'Domain rules grant access to everyone at that domain. Prefer the guest role.',
      invalid: 'Invalid rule.',
    },
  },
  roles: {
    author: 'Author',
    supervisor: 'Supervisor',
    coordinator: 'Coordinator',
    reviewer: 'Reviewer',
    guest: 'Guest',
  },
  errors: {
    notFound: 'Page not found',
    notFoundLead: 'This page does not exist.',
    forbidden: 'You do not have access to this page.',
    backHome: 'Back to studio',
  },
  trace: {
    role: {
      afirmacion: 'Claim',
      definicion: 'Definition',
      contexto: 'Context',
      literatura: 'Literature',
      ejemplo: 'Example',
      analisis: 'Analysis',
      contraste: 'Contrast',
      transicion: 'Transition',
      sintesis: 'Synthesis',
      metodo: 'Method',
      reflexion: 'Reflection',
      conclusion: 'Conclusion',
      excluir: 'Excluded',
    },
  },
} as const;

type Shape<T> = { readonly [K in keyof T]: T[K] extends string ? string : Shape<T[K]> };
export type Dict = Shape<typeof en>;
```

`src/lib/i18n/es.ts`:
```ts
import type { Dict } from './en.ts';

export const es: Dict = {
  studio: {
    title: 'Estudio',
    signIn: 'Iniciar sesión',
    signInLead: 'Iniciá sesión para acceder al estudio de escritura.',
    signOut: 'Cerrar sesión',
    mySpaces: 'Tus espacios',
    noSpaces: 'Todavía no sos miembro de ningún espacio.',
    role: 'Rol',
    settings: 'Configuración de acceso',
    invite: {
      title: 'Invitación',
      lead: 'Te invitaron a un espacio de escritura. Iniciá sesión con el email invitado para continuar.',
      accept: 'Continuar con el inicio de sesión',
      invalid: 'Esta invitación no es válida o venció.',
      create: 'Crear invitación',
      email: 'Email',
      created: 'Link de invitación (compartilo con la persona invitada):',
      expires: 'Vence en {days} días.',
    },
    access: {
      title: 'Reglas de acceso',
      lead: 'Las personas cuyo email verificado coincide con alguna regla pueden entrar con el rol indicado.',
      kind: 'Tipo',
      kindEmail: 'Email',
      kindDomain: 'Dominio',
      value: 'Email o dominio',
      add: 'Agregar regla',
      remove: 'Quitar',
      empty: 'Todavía no hay reglas.',
      domainWarning: 'Las reglas de dominio dan acceso a todas las personas de ese dominio. Preferí el rol invitado.',
      invalid: 'Regla inválida.',
    },
  },
  roles: {
    author: 'Autor/a',
    supervisor: 'Director/a',
    coordinator: 'Coordinador/a',
    reviewer: 'Revisor/a',
    guest: 'Invitado/a',
  },
  errors: {
    notFound: 'Página no encontrada',
    notFoundLead: 'Esta página no existe.',
    forbidden: 'No tenés acceso a esta página.',
    backHome: 'Volver al estudio',
  },
  trace: {
    role: {
      afirmacion: 'Afirmación',
      definicion: 'Definición',
      contexto: 'Contexto',
      literatura: 'Literatura',
      ejemplo: 'Ejemplo',
      analisis: 'Análisis',
      contraste: 'Contraste',
      transicion: 'Transición',
      sintesis: 'Síntesis',
      metodo: 'Método',
      reflexion: 'Reflexión',
      conclusion: 'Conclusión',
      excluir: 'Excluido',
    },
  },
};
```

`src/lib/i18n/index.ts`:
```ts
import type { Locale } from '../tenant/tenants.ts';
import { en, type Dict } from './en.ts';
import { es } from './es.ts';

type Paths<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Paths<T[K], `${P}${K}.`>;
}[keyof T & string];

export type MessageKey = Paths<Dict>;
export type { Dict };

// fr is added when hem joins (sub-project 4); until then it falls back to en.
const DICTS: Partial<Record<Locale, Dict>> = { en, es };

function lookup(dict: unknown, key: string): string | undefined {
  const value = key.split('.').reduce<unknown>(
    (node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined),
    dict,
  );
  return typeof value === 'string' ? value : undefined;
}

export function t(locale: Locale, key: MessageKey, vars?: Record<string, string | number>): string {
  const raw = lookup(DICTS[locale], key) ?? lookup(en, key) ?? key;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (match, name: string) => (name in vars ? String(vars[name]) : match));
}
```

- [ ] **Step 4: Run tests and type check**

```bash
node --test src/lib/i18n/i18n.test.mjs && npx astro check 2>&1 | tail -5
```
Expected: tests PASS; `astro check` reports no new errors in `src/lib/i18n`, `src/lib/tenant`, `src/pages/studio`. (Removing a key from `es.ts` must produce a type error; try it once, then revert.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/i18n package.json
git commit -m "feat(i18n): typed UI dictionary with en/es and t()"
```

---

### Task 5: Tracer language packs (dedupe, add English)

**Files:**
- Create: `src/lib/writing/lang/es.ts`, `src/lib/writing/lang/en.ts`, `src/lib/writing/lang/index.ts`, `src/lib/writing/index.ts`
- Test: `src/lib/writing/lang/lang.test.mjs`
- Modify: `src/scripts/course/notes/trace-utils.mjs` (L5-30 STOPWORDS, ~L122-131 CONNECTORS/startsWithConnector), `src/scripts/course/notes/trace-margin.ts` (~L367-376 CONNECTORS/startsWithConnector, ~L484-507 STOPWORDS), `package.json` (add `"src/lib/writing/lang/*.test.mjs"`)

**Interfaces:**
- Produces:
  - `type ContentLang = 'es' | 'en'`, `type LangPack = { lang: ContentLang; stopwords: ReadonlySet<string>; connectors: readonly string[] }`
  - `normalizeContentLang(value: unknown): ContentLang` (unknown → `'es'`)
  - `getLangPack(lang: ContentLang): LangPack`
  - `traceStopwords(lang: ContentLang): ReadonlySet<string>` (`'es'` → es ∪ en, preserving musiki; `'en'` → en only)
  - `startsWithConnector(text, lang = 'es')` in both tracer files (signature gains optional `lang`)

- [ ] **Step 1: Write the failing test**

`src/lib/writing/lang/lang.test.mjs`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { getLangPack, traceStopwords, normalizeContentLang } from './index.ts';
import { STOPWORDS, startsWithConnector } from '../../../scripts/course/notes/trace-utils.mjs';

test('packs are language-pure', () => {
  assert.ok(getLangPack('es').stopwords.has('para'));
  assert.ok(!getLangPack('es').stopwords.has('that'));
  assert.ok(getLangPack('en').stopwords.has('that'));
  assert.ok(!getLangPack('en').stopwords.has('para'));
});

test('es tracer set equals the previous 187-word mixed list (musiki unchanged)', () => {
  const es = traceStopwords('es');
  assert.equal(es.size, 187);
  assert.ok(es.has('para') && es.has('through'));
  assert.equal(STOPWORDS.size, 187);
});

test('en tracer set never contains Spanish stopwords', () => {
  const en = traceStopwords('en');
  for (const w of ['para', 'como', 'también', 'través']) assert.ok(!en.has(w), w);
});

test('connectors by language', () => {
  assert.equal(startsWithConnector('Sin embargo, el ritmo'), true);
  assert.equal(startsWithConnector('However, rhythm', 'en'), true);
  assert.equal(startsWithConnector('However, rhythm', 'es'), false);
  assert.equal(startsWithConnector('For example, a fugue', 'en'), true);
});

test('normalizeContentLang', () => {
  assert.equal(normalizeContentLang('en'), 'en');
  assert.equal(normalizeContentLang('fr'), 'es');
  assert.equal(normalizeContentLang(undefined), 'es');
});
```

- [ ] **Step 2: Register + run to see failure**

Append `"src/lib/writing/lang/*.test.mjs"` to `scripts.test`. Run `node --test src/lib/writing/lang/lang.test.mjs`. Expected: FAIL (missing module).

- [ ] **Step 3: Create packs**

`src/lib/writing/lang/es.ts` — the Spanish block is moved verbatim from `trace-utils.mjs` L7-20:
```ts
import type { LangPack } from './index.ts';

export const es: LangPack = {
  lang: 'es',
  stopwords: new Set([
    'para', 'como', 'pero', 'más', 'con', 'que', 'una', 'uno', 'los', 'las',
    'del', 'este', 'esta', 'esto', 'desde', 'hasta', 'sobre', 'entre', 'cuando',
    'donde', 'puede', 'tiene', 'también', 'además', 'porque', 'aunque', 'según',
    'todos', 'todas', 'todo', 'bien', 'hacer', 'tener', 'haber', 'siendo', 'están',
    'estar', 'había', 'será', 'mismo', 'misma', 'mismos', 'mismas', 'ante', 'bajo',
    'cada', 'casi', 'cierto', 'contra', 'cual', 'cuya', 'dado', 'debe', 'deben',
    'ella', 'ellas', 'ellos', 'embargo', 'esas', 'esos', 'gran', 'hacia', 'incluso',
    'junto', 'lado', 'largo', 'lugar', 'manera', 'mayor', 'mediante', 'mejor',
    'menor', 'menos', 'mientras', 'modo', 'ninguna', 'ninguno', 'otras', 'otros',
    'otra', 'otro', 'pues', 'parte', 'poco', 'primer', 'primera', 'propio', 'propia',
    'sino', 'solo', 'sola', 'tanto', 'tipo', 'toda', 'tras', 'unos', 'unas',
    'varios', 'veces', 'forma', 'nivel', 'dicho', 'dicha', 'aquí', 'allí', 'ahora',
    'antes', 'después', 'siempre', 'nunca', 'algo', 'algún', 'alguna', 'algunos',
    'algunas', 'nada', 'nadie', 'mucho', 'bastante', 'demasiado', 'través',
  ]),
  connectors: [
    'sin embargo', 'pero', 'por lo tanto', 'en consecuencia', 'por ejemplo',
    'así', 'entonces', 'además', 'no obstante', 'por ende', 'en cambio',
    'cuando', 'al final', 'mientras', 'luego', 'después',
  ],
};
```

`src/lib/writing/lang/en.ts` — English block moved verbatim from `trace-utils.mjs` L22-29, plus new connectors:
```ts
import type { LangPack } from './index.ts';

export const en: LangPack = {
  lang: 'en',
  stopwords: new Set([
    'that', 'with', 'this', 'have', 'from', 'they', 'will', 'been', 'were',
    'said', 'each', 'which', 'their', 'there', 'when', 'what', 'make', 'like',
    'time', 'just', 'know', 'take', 'into', 'year', 'your', 'good', 'some',
    'could', 'them', 'then', 'than', 'more', 'only', 'come', 'over', 'also',
    'back', 'after', 'first', 'well', 'most', 'about', 'would', 'very', 'these',
    'those', 'such', 'other', 'being', 'both', 'here', 'many', 'does', 'where',
    'through', 'because', 'between', 'without', 'during', 'before', 'should',
    'might', 'while', 'since', 'until', 'whether',
  ]),
  connectors: [
    'however', 'but', 'therefore', 'consequently', 'for example', 'for instance',
    'thus', 'then', 'moreover', 'furthermore', 'nevertheless', 'hence',
    'in contrast', 'on the other hand', 'when', 'finally', 'meanwhile',
    'later', 'afterwards', 'in addition',
  ],
};
```

`src/lib/writing/lang/index.ts`:
```ts
import { es } from './es.ts';
import { en } from './en.ts';

export type ContentLang = 'es' | 'en';
export type LangPack = { lang: ContentLang; stopwords: ReadonlySet<string>; connectors: readonly string[] };

export function normalizeContentLang(value: unknown): ContentLang {
  return value === 'en' ? 'en' : 'es';
}

export function getLangPack(lang: ContentLang): LangPack {
  return lang === 'en' ? en : es;
}

// Spanish writing routinely quotes English, so the es tracer set keeps both
// (this is exactly the list musiki used before). English text uses English only.
const ES_TRACE_STOPWORDS: ReadonlySet<string> = new Set([...es.stopwords, ...en.stopwords]);

export function traceStopwords(lang: ContentLang): ReadonlySet<string> {
  return lang === 'en' ? en.stopwords : ES_TRACE_STOPWORDS;
}
```

`src/lib/writing/index.ts` (package boundary for the future `packages/tracer`/`packages/editor`):
```ts
export {
  getLangPack, traceStopwords, normalizeContentLang,
  type ContentLang, type LangPack,
} from './lang/index.ts';
```

- [ ] **Step 4: Point `trace-utils.mjs` at the packs**

Replace L5-30 (the whole `export const STOPWORDS = new Set([ … ]);`) with:
```js
import { getLangPack, traceStopwords } from '../../../lib/writing/lang/index.ts';

export const STOPWORDS = traceStopwords('es');
```
(Move the `import` to the top of the file with the other imports if any exist.)
Replace the `CONNECTORS` array and `startsWithConnector` (~L122-131) with:
```js
export function startsWithConnector(text, lang = 'es') {
  const lower = (text || '').toLowerCase().trim();
  return getLangPack(lang).connectors.some(c => lower.startsWith(c));
}
```

- [ ] **Step 5: Point `trace-margin.ts` at the packs**

Add at the top with the other imports:
```ts
import { getLangPack, traceStopwords, type ContentLang } from '../../../lib/writing/lang/index.ts';
```
Replace the `CONNECTORS` array and `startsWithConnector` (~L367-376) with:
```ts
export function startsWithConnector(text: string, lang: ContentLang = 'es'): boolean {
  const lower = text.toLowerCase().trim();
  return getLangPack(lang).connectors.some(c => lower.startsWith(c));
}
```
Replace the local `const STOPWORDS = new Set([ … ]);` (~L484-507) with:
```ts
const STOPWORDS = traceStopwords('es');
```
(Sub-project 2 passes the note's `contentLang` instead of the `'es'` default.)

- [ ] **Step 6: Run all tests and a build**

```bash
npm test && npx astro check 2>&1 | tail -5
```
Expected: all PASS, including the existing `trace-utils.test.mjs` (musiki behavior unchanged). Then `npm run dev`, open a course note with the trace margin in musiki and confirm the margin renders as before.

- [ ] **Step 7: Commit**

```bash
git add src/lib/writing src/scripts/course/notes/trace-utils.mjs src/scripts/course/notes/trace-margin.ts package.json
git commit -m "refactor(tracer): shared es/en language packs, dedupe stopwords and connectors"
```

---

### Task 6: Migration for spaces, members, invites, access rules

**Files:**
- Create: `postgres-patches/migrations/20260925120000_tenant_spaces.sql`, `postgres-patches/seeds/so-dissertation-space.sql`

**Interfaces:**
- Produces tables `Space`, `SpaceMember`, `SpaceInvite`, `SpaceAccessRule`; columns `LiveClassNote.spaceId`, `LiveClassNote.lang`. Column names exactly as below (camelCase, quoted), used by Tasks 7-10.

- [ ] **Step 1: Write the migration**

`postgres-patches/migrations/20260925120000_tenant_spaces.sql`:
```sql
-- Tenant layer: spaces that are not content-driven courses (so dissertation first).
-- 'course' is reserved for the future migration of courses into Postgres (spec §3.1).

BEGIN;

CREATE TABLE IF NOT EXISTS "Space" (
  "id"        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenantId"  text        NOT NULL,
  "kind"      text        NOT NULL CHECK ("kind" IN ('dissertation', 'course')),
  "slug"      text        NOT NULL,
  "title"     text        NOT NULL,
  "lang"      text        NOT NULL DEFAULT 'en',
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("tenantId", "slug")
);

CREATE TABLE IF NOT EXISTS "SpaceMember" (
  "spaceId"   uuid        NOT NULL REFERENCES "Space"("id") ON DELETE CASCADE,
  "userId"    uuid        NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "role"      text        NOT NULL CHECK ("role" IN ('author', 'supervisor', 'coordinator', 'reviewer', 'guest')),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("spaceId", "userId")
);
CREATE INDEX IF NOT EXISTS "SpaceMember_userId_idx" ON "SpaceMember" ("userId");

CREATE TABLE IF NOT EXISTS "SpaceInvite" (
  "id"         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "spaceId"    uuid        NOT NULL REFERENCES "Space"("id") ON DELETE CASCADE,
  "email"      text        NOT NULL CHECK ("email" = lower("email")),
  "role"       text        NOT NULL CHECK ("role" IN ('supervisor', 'coordinator', 'reviewer', 'guest')),
  "token"      text        NOT NULL UNIQUE,
  "expiresAt"  timestamptz NOT NULL,
  "acceptedAt" timestamptz,
  "createdBy"  uuid        NOT NULL,
  "createdAt"  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "SpaceInvite_email_idx" ON "SpaceInvite" ("email");

CREATE TABLE IF NOT EXISTS "SpaceAccessRule" (
  "id"        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  "spaceId"   uuid        NOT NULL REFERENCES "Space"("id") ON DELETE CASCADE,
  "kind"      text        NOT NULL CHECK ("kind" IN ('email', 'domain')),
  "value"     text        NOT NULL CHECK ("value" = lower("value")),
  "role"      text        NOT NULL CHECK ("role" IN ('supervisor', 'coordinator', 'reviewer', 'guest')),
  "createdBy" uuid        NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("spaceId", "kind", "value")
);
CREATE INDEX IF NOT EXISTS "SpaceAccessRule_value_idx" ON "SpaceAccessRule" ("kind", "value");

ALTER TABLE "LiveClassNote" ADD COLUMN IF NOT EXISTS "spaceId" uuid REFERENCES "Space"("id") ON DELETE SET NULL;
ALTER TABLE "LiveClassNote" ADD COLUMN IF NOT EXISTS "lang" text;
CREATE INDEX IF NOT EXISTS "LiveClassNote_spaceId_idx" ON "LiveClassNote" ("spaceId") WHERE "spaceId" IS NOT NULL;

COMMIT;
```

- [ ] **Step 2: Write the seed**

`postgres-patches/seeds/so-dissertation-space.sql` (psql variables: `author_email`, `title`, `slug`):
```sql
-- Usage:
-- psql -v author_email=you@example.org -v title='Dissertation title' -v slug=dissertation -f so-dissertation-space.sql
BEGIN;
INSERT INTO "Space" ("tenantId", "kind", "slug", "title", "lang")
VALUES ('so', 'dissertation', :'slug', :'title', 'en')
ON CONFLICT ("tenantId", "slug") DO UPDATE SET "title" = EXCLUDED."title";

INSERT INTO "SpaceMember" ("spaceId", "userId", "role")
SELECT s."id", ue."userId", 'author'
FROM "Space" s
JOIN "UserEmail" ue ON ue."email" = lower(:'author_email')
WHERE s."tenantId" = 'so' AND s."slug" = :'slug'
ON CONFLICT ("spaceId", "userId") DO UPDATE SET "role" = 'author';

SELECT s."slug", m."role", ue."email"
FROM "SpaceMember" m JOIN "Space" s ON s."id" = m."spaceId"
JOIN "UserEmail" ue ON ue."userId" = m."userId"
WHERE s."tenantId" = 'so';
COMMIT;
```

- [ ] **Step 3: Apply to staging and verify (twice, to prove idempotency)**

```bash
ssh hetzner "bash -c 'docker exec -i $PGC psql -U app -d musiki_staging -v ON_ERROR_STOP=1'" < postgres-patches/migrations/20260925120000_tenant_spaces.sql
ssh hetzner "bash -c 'docker exec -i $PGC psql -U app -d musiki_staging -v ON_ERROR_STOP=1'" < postgres-patches/migrations/20260925120000_tenant_spaces.sql
ssh hetzner "bash -c 'docker exec $PGC psql -U app -d musiki_staging -c \"\\d \\\"SpaceAccessRule\\\"\"'"
```
Expected: both runs end in `COMMIT`; `\d` shows the table with the CHECK constraints. Production is migrated only in Task 11.

- [ ] **Step 4: Commit**

```bash
git add postgres-patches/migrations/20260925120000_tenant_spaces.sql postgres-patches/seeds/so-dissertation-space.sql
git commit -m "feat(db): Space, SpaceMember, SpaceInvite, SpaceAccessRule; note spaceId/lang"
```

---

### Task 7: Space roles, input validation and the pure access decision

**Files:**
- Create: `src/lib/tenant/space-roles.ts`, `src/lib/tenant/access.ts`
- Test: `src/lib/tenant/access.test.mjs`

**Interfaces:**
- Produces (`space-roles.ts`):
  - `SPACE_ROLES = ['author','supervisor','coordinator','reviewer','guest'] as const`, `type SpaceRole`
  - `GRANTABLE_ROLES` (all except `author`), `isSpaceRole(v)`, `isGrantableRole(v)`
  - `normalizeEmail(raw: unknown): string`, `emailDomain(email: string): string`
  - `isValidEmail(email: string): boolean`, `isValidDomain(domain: string): boolean`
  - `validateAccessRuleInput(input: { kind: unknown; value: unknown; role: unknown }): { ok: true; kind: 'email' | 'domain'; value: string; role: SpaceRole } | { ok: false; error: string }`
  - `validateInviteInput(input: { email: unknown; role: unknown }): { ok: true; email: string; role: SpaceRole } | { ok: false; error: string }`
- Produces (`access.ts`):
  - `type InviteRow = { id: string; spaceId: string; email: string; role: string; expiresAt: string | Date; acceptedAt: string | Date | null }`
  - `type AccessRuleRow = { spaceId: string; kind: 'email' | 'domain'; value: string; role: string }`
  - `type AccessGrant = { spaceId: string; role: SpaceRole; via: 'invite' | 'email-rule' | 'domain-rule'; inviteId?: string }`
  - `type AccessDecision = { allowed: false; reason: 'no-email' | 'unverified' | 'no-grant' } | { allowed: true; grants: AccessGrant[] }`
  - `decideSpaceAccess(input: { email: string; emailVerified: boolean; now: Date; isMember: boolean; invites: InviteRow[]; rules: AccessRuleRow[] }): AccessDecision`

- [ ] **Step 1: Write the failing test**

`src/lib/tenant/access.test.mjs`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { decideSpaceAccess } from './access.ts';
import { validateAccessRuleInput, validateInviteInput, emailDomain } from './space-roles.ts';

const NOW = new Date('2026-10-01T00:00:00Z');
const base = { email: 'ana@nmh.no', emailVerified: true, now: NOW, isMember: false, invites: [], rules: [] };
const invite = (o = {}) => ({ id: 'i1', spaceId: 's1', email: 'ana@nmh.no', role: 'supervisor',
  expiresAt: '2026-10-10T00:00:00Z', acceptedAt: null, ...o });

test('unverified email is always rejected', () => {
  const d = decideSpaceAccess({ ...base, emailVerified: false, invites: [invite()] });
  assert.deepEqual(d, { allowed: false, reason: 'unverified' });
});

test('valid invite grants its role', () => {
  const d = decideSpaceAccess({ ...base, invites: [invite()] });
  assert.equal(d.allowed, true);
  assert.deepEqual(d.grants, [{ spaceId: 's1', role: 'supervisor', via: 'invite', inviteId: 'i1' }]);
});

test('expired or accepted invites grant nothing', () => {
  assert.equal(decideSpaceAccess({ ...base, invites: [invite({ expiresAt: '2026-09-01T00:00:00Z' })] }).allowed, false);
  assert.equal(decideSpaceAccess({ ...base, invites: [invite({ acceptedAt: '2026-09-20T00:00:00Z' })] }).allowed, false);
});

test('invite for another email grants nothing', () => {
  assert.equal(decideSpaceAccess({ ...base, invites: [invite({ email: 'bob@nmh.no' })] }).allowed, false);
});

test('email rule and exact domain rule', () => {
  const email = decideSpaceAccess({ ...base, rules: [{ spaceId: 's1', kind: 'email', value: 'ana@nmh.no', role: 'reviewer' }] });
  assert.equal(email.grants[0].via, 'email-rule');
  const domain = decideSpaceAccess({ ...base, rules: [{ spaceId: 's1', kind: 'domain', value: 'nmh.no', role: 'guest' }] });
  assert.equal(domain.grants[0].via, 'domain-rule');
});

test('look-alike domains and subdomains do not match', () => {
  const rules = [{ spaceId: 's1', kind: 'domain', value: 'nmh.no', role: 'guest' }];
  for (const email of ['x@nmh.no.evil.com', 'x@a.nmh.no', 'x@evilnmh.no']) {
    assert.equal(decideSpaceAccess({ ...base, email, rules }).allowed, false, email);
  }
});

test('invite beats rules for the same space; one grant per space', () => {
  const d = decideSpaceAccess({ ...base, invites: [invite()],
    rules: [{ spaceId: 's1', kind: 'domain', value: 'nmh.no', role: 'guest' }] });
  assert.equal(d.grants.length, 1);
  assert.equal(d.grants[0].role, 'supervisor');
});

test('existing member is allowed without new grants', () => {
  assert.deepEqual(decideSpaceAccess({ ...base, isMember: true }), { allowed: true, grants: [] });
});

test('author is never granted by rows', () => {
  const d = decideSpaceAccess({ ...base, rules: [{ spaceId: 's1', kind: 'email', value: 'ana@nmh.no', role: 'author' }] });
  assert.equal(d.allowed, false);
});

test('rule and invite input validation', () => {
  assert.deepEqual(validateAccessRuleInput({ kind: 'domain', value: ' NMH.no ', role: 'guest' }),
    { ok: true, kind: 'domain', value: 'nmh.no', role: 'guest' });
  assert.equal(validateAccessRuleInput({ kind: 'domain', value: '@nmh.no', role: 'guest' }).ok, false);
  assert.equal(validateAccessRuleInput({ kind: 'email', value: 'not-an-email', role: 'guest' }).ok, false);
  assert.equal(validateAccessRuleInput({ kind: 'email', value: 'a@b.no', role: 'author' }).ok, false);
  assert.equal(validateInviteInput({ email: 'A@B.no', role: 'supervisor' }).email, 'a@b.no');
  assert.equal(emailDomain('a@b.no'), 'b.no');
});
```

- [ ] **Step 2: Run to see failure**

```bash
node --test src/lib/tenant/access.test.mjs
```
Expected: FAIL (missing modules).

- [ ] **Step 3: Implement `space-roles.ts`**

```ts
export const SPACE_ROLES = ['author', 'supervisor', 'coordinator', 'reviewer', 'guest'] as const;
export type SpaceRole = (typeof SPACE_ROLES)[number];
export const GRANTABLE_ROLES: readonly SpaceRole[] = SPACE_ROLES.filter((r) => r !== 'author');

export const isSpaceRole = (v: unknown): v is SpaceRole =>
  typeof v === 'string' && (SPACE_ROLES as readonly string[]).includes(v);
export const isGrantableRole = (v: unknown): v is SpaceRole =>
  isSpaceRole(v) && v !== 'author';

export const normalizeEmail = (raw: unknown): string => String(raw ?? '').trim().toLowerCase();

export function emailDomain(email: string): string {
  const at = email.lastIndexOf('@');
  return at > 0 ? email.slice(at + 1) : '';
}

const DOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;
export const isValidDomain = (domain: string): boolean => DOMAIN_RE.test(domain);
export function isValidEmail(email: string): boolean {
  const parts = email.split('@');
  return parts.length === 2 && parts[0].length > 0 && isValidDomain(parts[1]);
}

export function validateAccessRuleInput(input: { kind: unknown; value: unknown; role: unknown }):
  | { ok: true; kind: 'email' | 'domain'; value: string; role: SpaceRole }
  | { ok: false; error: string } {
  const value = normalizeEmail(input.value);
  if (!isGrantableRole(input.role)) return { ok: false, error: 'invalid-role' };
  if (input.kind === 'email') {
    return isValidEmail(value) ? { ok: true, kind: 'email', value, role: input.role } : { ok: false, error: 'invalid-email' };
  }
  if (input.kind === 'domain') {
    return isValidDomain(value) ? { ok: true, kind: 'domain', value, role: input.role } : { ok: false, error: 'invalid-domain' };
  }
  return { ok: false, error: 'invalid-kind' };
}

export function validateInviteInput(input: { email: unknown; role: unknown }):
  | { ok: true; email: string; role: SpaceRole }
  | { ok: false; error: string } {
  const email = normalizeEmail(input.email);
  if (!isValidEmail(email)) return { ok: false, error: 'invalid-email' };
  if (!isGrantableRole(input.role)) return { ok: false, error: 'invalid-role' };
  return { ok: true, email, role: input.role };
}
```

- [ ] **Step 4: Implement `access.ts`**

```ts
import { emailDomain, isGrantableRole, normalizeEmail, type SpaceRole } from './space-roles.ts';

export type InviteRow = {
  id: string; spaceId: string; email: string; role: string;
  expiresAt: string | Date; acceptedAt: string | Date | null;
};
export type AccessRuleRow = { spaceId: string; kind: 'email' | 'domain'; value: string; role: string };
export type AccessGrant = {
  spaceId: string; role: SpaceRole; via: 'invite' | 'email-rule' | 'domain-rule'; inviteId?: string;
};
export type AccessDecision =
  | { allowed: false; reason: 'no-email' | 'unverified' | 'no-grant' }
  | { allowed: true; grants: AccessGrant[] };

export function decideSpaceAccess(input: {
  email: string; emailVerified: boolean; now: Date; isMember: boolean;
  invites: InviteRow[]; rules: AccessRuleRow[];
}): AccessDecision {
  const email = normalizeEmail(input.email);
  if (!email) return { allowed: false, reason: 'no-email' };
  if (!input.emailVerified) return { allowed: false, reason: 'unverified' };
  const domain = emailDomain(email);

  const bySpace = new Map<string, AccessGrant>();
  const add = (g: AccessGrant) => { if (!bySpace.has(g.spaceId)) bySpace.set(g.spaceId, g); };

  for (const inv of input.invites) {
    if (normalizeEmail(inv.email) !== email || inv.acceptedAt) continue;
    if (new Date(inv.expiresAt).getTime() <= input.now.getTime()) continue;
    if (!isGrantableRole(inv.role)) continue;
    add({ spaceId: inv.spaceId, role: inv.role, via: 'invite', inviteId: inv.id });
  }
  for (const rule of input.rules) {
    if (rule.kind === 'email' && rule.value === email && isGrantableRole(rule.role)) {
      add({ spaceId: rule.spaceId, role: rule.role, via: 'email-rule' });
    }
  }
  for (const rule of input.rules) {
    if (rule.kind === 'domain' && domain && rule.value === domain && isGrantableRole(rule.role)) {
      add({ spaceId: rule.spaceId, role: rule.role, via: 'domain-rule' });
    }
  }

  const grants = [...bySpace.values()];
  if (grants.length > 0 || input.isMember) return { allowed: true, grants };
  return { allowed: false, reason: 'no-grant' };
}
```

- [ ] **Step 5: Run tests**

```bash
node --test src/lib/tenant/access.test.mjs && npm test
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/tenant/space-roles.ts src/lib/tenant/access.ts src/lib/tenant/access.test.mjs
git commit -m "feat(tenant): space roles, input validation and pure sign-in access decision"
```

---

### Task 8: Tenant-aware auth origin and provider gating

**Files:**
- Modify: `src/lib/auth-origin.ts` (`resolveAuthBaseOrigin`, `resolveRequestAuthOrigin`), `src/pages/api/auth/[...auth].ts`
- Test: `src/lib/auth-origin.test.mjs`
- Modify: `package.json` (add `"src/lib/auth-origin.test.mjs"`)

**Interfaces:**
- Consumes: `findTenantByHost`, `normalizeHost`, `isAuthProviderAllowed` (Task 1), `DEFAULT_TENANT_ID`
- Produces: unchanged signatures of `resolveAuthBaseOrigin`, `resolveRequestAuthOrigin`, `resolveAuthRedirectUrl`; behavior: an origin whose host belongs to a non-default tenant wins over `AUTH_URL`.

- [ ] **Step 1: Write the failing test**

`src/lib/auth-origin.test.mjs`:
```js
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.AUTH_URL = 'https://musiki.org.ar';
const { resolveAuthRedirectUrl, resolveRequestAuthOrigin, resolveAuthBaseOrigin } = await import('./auth-origin.ts');

const req = (host) => new Request('http://127.0.0.1:4321/api/auth/session', {
  headers: { 'x-forwarded-host': host, 'x-forwarded-proto': 'https' },
});

test('so host keeps its own origin despite AUTH_URL', () => {
  assert.equal(resolveRequestAuthOrigin(req('so.zztt.org')), 'https://so.zztt.org');
  assert.equal(resolveAuthBaseOrigin('https://so-dev.zztt.org'), 'https://so-dev.zztt.org');
  assert.equal(resolveAuthRedirectUrl({ baseUrl: 'https://so.zztt.org', url: '/studio' }), 'https://so.zztt.org/studio');
});

test('musiki behavior unchanged', () => {
  assert.equal(resolveRequestAuthOrigin(req('musiki.org.ar')), 'https://musiki.org.ar');
  assert.equal(resolveAuthRedirectUrl({ baseUrl: 'https://musiki.org.ar', url: '/dashboard' }), 'https://musiki.org.ar/dashboard');
});

test('unknown hosts cannot hijack the origin', () => {
  assert.equal(resolveRequestAuthOrigin(req('evil.example.com')), 'https://musiki.org.ar');
});

test('redirects to foreign origins fall back to the tenant origin', () => {
  assert.equal(
    resolveAuthRedirectUrl({ baseUrl: 'https://so.zztt.org', url: 'https://evil.example.com/x', fallbackPath: '/studio' }),
    'https://so.zztt.org/studio',
  );
});
```

- [ ] **Step 2: Run to see failure**

```bash
node --test src/lib/auth-origin.test.mjs
```
Expected: FAIL on the so assertions (currently resolves to `https://musiki.org.ar`).

- [ ] **Step 3: Implement**

At the top of `src/lib/auth-origin.ts`:
```ts
import { findTenantByHost } from './tenant/resolve.ts';
import { DEFAULT_TENANT_ID } from './tenant/tenants.ts';

// An origin whose host is registered to a non-default tenant is authoritative:
// it must never be replaced by AUTH_URL (which points at musiki).
const tenantOwnedOrigin = (origin: string): string => {
  if (!origin) return '';
  try {
    const tenant = findTenantByHost(new URL(origin).hostname);
    return tenant && tenant.id !== DEFAULT_TENANT_ID ? origin : '';
  } catch {
    return '';
  }
};
```
In `resolveAuthBaseOrigin`, right after `const detectedBaseOrigin = normalizeOriginCandidate(baseUrl);` add:
```ts
  const tenantOrigin = tenantOwnedOrigin(detectedBaseOrigin);
  if (tenantOrigin) return tenantOrigin.replace(/^http:/, 'https:');
```
`resolveRequestAuthOrigin` already passes the forwarded origin into `resolveAuthBaseOrigin`, so no change is needed there. Unknown hosts fall through to the existing logic (configured `AUTH_URL` wins).

- [ ] **Step 4: Gate providers per tenant in `[...auth].ts`**

After computing `action` (after `const action = …`), add:
```ts
  const tenant = context.locals.tenant;
  if (tenant && (action === "signin" || action === "callback")) {
    const providerId = targetUrl.pathname.slice(prefix.length + 1).split("/")[1];
    if (providerId && !isAuthProviderAllowed(tenant, providerId)) {
      return new Response("Not found", { status: 404 });
    }
  }
```
and import:
```ts
import { isAuthProviderAllowed } from "../../../lib/tenant/resolve";
```
Also in the same file, the production "safety check" that forces `musiki.org.ar` only applies to loopback/4321 origins; leave it as is (so origins are never loopback in production).

- [ ] **Step 5: Run tests**

```bash
node --test src/lib/auth-origin.test.mjs && npm test
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/auth-origin.ts src/lib/auth-origin.test.mjs "src/pages/api/auth/[...auth].ts" package.json
git commit -m "feat(auth): tenant-owned auth origins and per-tenant provider gating"
```

---

### Task 9: `logto-so` provider and tenant-aware `signIn`

**Files:**
- Create: `src/lib/tenant/access-db.ts`
- Modify: `auth.config.ts` (providers array, `signIn` and `redirect` callbacks)

**Interfaces:**
- Consumes: `decideSpaceAccess`, `InviteRow`, `AccessRuleRow` (Task 7); `normalizeEmail`, `emailDomain` (Task 7); `tenantForAuthProvider`, `findTenantByHost` (Task 1); `query` (`src/lib/db/pool.ts`, returns `{ data, error }`); `resolveUserIdByEmail`, `registerEmailForUser` (`src/lib/user-email.ts`)
- Produces: `authorizeTenantSignIn(tenantId: TenantId, input: { email: string; emailVerified: boolean; name?: string | null }): Promise<boolean>`

- [ ] **Step 1: Implement `access-db.ts`**

```ts
import { query } from '../db/pool';
import { resolveUserIdByEmail, registerEmailForUser } from '../user-email';
import { decideSpaceAccess, type AccessRuleRow, type InviteRow } from './access';
import { emailDomain, normalizeEmail } from './space-roles';
import type { TenantId } from './tenants';

const must = <T>(res: { data: T[] | null; error: any }): T[] => {
  if (res.error) throw new Error(res.error.message || 'Database error');
  return res.data ?? [];
};

export async function authorizeTenantSignIn(
  tenantId: TenantId,
  input: { email: string; emailVerified: boolean; name?: string | null },
): Promise<boolean> {
  const email = normalizeEmail(input.email);
  if (!email) return false;

  const invites = must<InviteRow>(await query(
    `SELECT i."id", i."spaceId", i."email", i."role", i."expiresAt", i."acceptedAt"
       FROM "SpaceInvite" i JOIN "Space" s ON s."id" = i."spaceId"
      WHERE s."tenantId" = $1 AND i."email" = $2 AND i."acceptedAt" IS NULL`,
    [tenantId, email],
  ));
  const rules = must<AccessRuleRow>(await query(
    `SELECT r."spaceId", r."kind", r."value", r."role"
       FROM "SpaceAccessRule" r JOIN "Space" s ON s."id" = r."spaceId"
      WHERE s."tenantId" = $1
        AND ((r."kind" = 'email' AND r."value" = $2) OR (r."kind" = 'domain' AND r."value" = $3))`,
    [tenantId, email, emailDomain(email)],
  ));

  let userId = await resolveUserIdByEmail(email);
  const isMember = userId
    ? must(await query(
        `SELECT 1 FROM "SpaceMember" m JOIN "Space" s ON s."id" = m."spaceId"
          WHERE s."tenantId" = $1 AND m."userId" = $2 LIMIT 1`,
        [tenantId, userId],
      )).length > 0
    : false;

  const decision = decideSpaceAccess({
    email, emailVerified: input.emailVerified, now: new Date(), isMember, invites, rules,
  });
  if (!decision.allowed) {
    console.warn(`[TENANT-SIGNIN] ${tenantId} rejected ${email}: ${decision.reason}`);
    return false;
  }

  if (decision.grants.length > 0) {
    if (!userId) {
      // New person: provision a minimal User. User.role grants nothing outside musiki.
      const created = must<{ id: string }>(await query(
        `INSERT INTO "User" ("id", "email", "name", "role", "emailVerified", "createdAt", "updatedAt")
         VALUES (gen_random_uuid(), $1, $2, 'student', true, now(), now()) RETURNING "id"`,
        [email, input.name ?? null],
      ));
      userId = created[0].id;
      await registerEmailForUser(userId, email, true);
    }
    for (const grant of decision.grants) {
      must(await query(
        `INSERT INTO "SpaceMember" ("spaceId", "userId", "role") VALUES ($1, $2, $3)
         ON CONFLICT ("spaceId", "userId") DO NOTHING`,
        [grant.spaceId, userId, grant.role],
      ));
      if (grant.inviteId) {
        must(await query(`UPDATE "SpaceInvite" SET "acceptedAt" = now() WHERE "id" = $1`, [grant.inviteId]));
      }
    }
  }
  console.log(`[TENANT-SIGNIN] ${tenantId} allowed ${email} (${decision.grants.length} new grants)`);
  return true;
}
```
`ON CONFLICT DO NOTHING` means a rule never downgrades an existing member's role.

- [ ] **Step 2: Add the `logto-so` provider**

In `auth.config.ts`, next to `logtoProvider`:
```ts
const LOGTO_SO_CLIENT_ID = getEnv('LOGTO_SO_CLIENT_ID');
const logtoSoProvider = LOGTO_ISSUER && LOGTO_SO_CLIENT_ID
  ? [{
      id: "logto-so",
      name: "so",
      type: "oidc" as const,
      issuer: LOGTO_ISSUER,
      clientId: LOGTO_SO_CLIENT_ID,
      clientSecret: getEnv('LOGTO_SO_CLIENT_SECRET'),
      authorization: { params: { scope: "openid profile email" } },
      checks: ["pkce", "state"] as ("pkce" | "state")[],
      onProfile(profile: Record<string, unknown>) {
        return {
          id: profile.sub,
          name: (profile.name as string) ?? (profile.username as string),
          email: profile.email,
          image: profile.picture,
        };
      },
    }]
  : [];
```
and in `providers: [ ...logtoProvider, ...logtoSoProvider, Google(…), … ]`.
Note: unlike the musiki providers, `logto-so` has **no** `allowDangerousEmailAccountLinking`; identity is gated by `authorizeTenantSignIn` and verified email.

- [ ] **Step 3: Branch `signIn` by tenant**

At the start of `async signIn({ user })`, change the signature and add the branch:
```ts
    async signIn({ user, account, profile }) {
      const email = String(user?.email || '').trim().toLowerCase();
      if (!email) {
        console.warn("[AUTH-SIGNIN] Rejecting sign-in attempt: no email provided.");
        return false;
      }

      const providerTenant = tenantForAuthProvider(account?.provider);
      if (providerTenant && providerTenant.id !== DEFAULT_TENANT_ID) {
        try {
          return await authorizeTenantSignIn(providerTenant.id, {
            email,
            emailVerified: (profile as Record<string, unknown> | undefined)?.email_verified === true,
            name: user?.name ?? null,
          });
        } catch (err) {
          console.error("[AUTH-SIGNIN] Tenant authorization error:", err);
          return false;
        }
      }

      // …existing musiki logic unchanged below
```
Imports at the top of `auth.config.ts`:
```ts
import { tenantForAuthProvider, findTenantByHost } from "./src/lib/tenant/resolve";
import { DEFAULT_TENANT_ID } from "./src/lib/tenant/tenants";
import { authorizeTenantSignIn } from "./src/lib/tenant/access-db";
```

- [ ] **Step 4: Tenant-aware post-login fallback**

Replace the `redirect` callback body:
```ts
    async redirect({ url, baseUrl }) {
      let fallbackPath = '/dashboard';
      try {
        const tenant = findTenantByHost(new URL(baseUrl).hostname);
        if (tenant) fallbackPath = tenant.homePath;
      } catch { /* keep default */ }
      return resolveAuthRedirectUrl({ url, baseUrl, fallbackPath });
    },
```

- [ ] **Step 5: Verify**

```bash
npm test && npx astro check 2>&1 | tail -5
```
Expected: PASS, no new type errors. Runtime verification of this task happens in Task 11 (needs the Logto app and staging DB).

- [ ] **Step 6: Commit**

```bash
git add src/lib/tenant/access-db.ts auth.config.ts
git commit -m "feat(auth): logto-so provider and tenant-aware sign-in with space provisioning"
```

---

### Task 10: Studio shell, invitations and access-rules UI

**Files:**
- Create: `src/lib/tenant/studio-db.ts`, `src/pages/studio/index.astro`, `src/pages/studio/login.astro`, `src/pages/studio/invite/[token].astro`, `src/pages/studio/settings/access.astro`, `src/pages/api/studio/me.ts`, `src/pages/api/studio/invites.ts`, `src/pages/api/studio/access-rules.ts`

**Interfaces:**
- Consumes: `locals.tenant` (Task 3), `t()` (Task 4), `validateInviteInput`, `validateAccessRuleInput` (Task 7), `resolveRequestAuthOrigin` (Task 8), `resolveUserIdByEmail`, `json` from `src/lib/forum-server`
- Produces (`studio-db.ts`):
  - `studioEnabled(tenant: Tenant): boolean` (tenant has `'dissertation'` in `spaceKinds`)
  - `type Membership = { spaceId: string; slug: string; title: string; lang: string; role: SpaceRole }`
  - `getStudioUserId(locals: App.Locals): Promise<string | null>`
  - `listMemberships(tenantId: TenantId, userId: string): Promise<Membership[]>`
  - `getMembership(tenantId: TenantId, userId: string, spaceId: string): Promise<Membership | null>`
  - `createInvite(input: { spaceId: string; email: string; role: SpaceRole; createdBy: string }): Promise<{ token: string; expiresAt: Date }>`
  - `findValidInvite(tenantId: TenantId, token: string): Promise<{ spaceTitle: string; email: string } | null>`
  - `listRules(spaceId: string)`, `addRule(input)`, `removeRule(spaceId: string, ruleId: string)`
  - `INVITE_TTL_DAYS = 14`

- [ ] **Step 1: Implement `studio-db.ts`**

```ts
import crypto from 'node:crypto';
import { query } from '../db/pool';
import { resolveUserIdByEmail } from '../user-email';
import type { SpaceRole } from './space-roles';
import type { Tenant, TenantId } from './tenants';

export const INVITE_TTL_DAYS = 14;

export type Membership = { spaceId: string; slug: string; title: string; lang: string; role: SpaceRole };
export type RuleRow = { id: string; kind: 'email' | 'domain'; value: string; role: SpaceRole; createdAt: string };

const must = <T>(res: { data: T[] | null; error: any }): T[] => {
  if (res.error) throw new Error(res.error.message || 'Database error');
  return res.data ?? [];
};

export const studioEnabled = (tenant: Tenant): boolean => tenant.spaceKinds.includes('dissertation');

export async function getStudioUserId(locals: App.Locals): Promise<string | null> {
  const email = locals.session?.user?.email;
  return email ? resolveUserIdByEmail(email) : null;
}

const MEMBERSHIP_SQL = `
  SELECT s."id" AS "spaceId", s."slug", s."title", s."lang", m."role"
    FROM "SpaceMember" m JOIN "Space" s ON s."id" = m."spaceId"
   WHERE s."tenantId" = $1 AND m."userId" = $2`;

export async function listMemberships(tenantId: TenantId, userId: string): Promise<Membership[]> {
  return must<Membership>(await query(`${MEMBERSHIP_SQL} ORDER BY s."title"`, [tenantId, userId]));
}

export async function getMembership(tenantId: TenantId, userId: string, spaceId: string): Promise<Membership | null> {
  return must<Membership>(await query(`${MEMBERSHIP_SQL} AND s."id" = $3`, [tenantId, userId, spaceId]))[0] ?? null;
}

export async function createInvite(input: { spaceId: string; email: string; role: SpaceRole; createdBy: string }) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
  must(await query(
    `INSERT INTO "SpaceInvite" ("spaceId", "email", "role", "token", "expiresAt", "createdBy")
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [input.spaceId, input.email, input.role, token, expiresAt.toISOString(), input.createdBy],
  ));
  return { token, expiresAt };
}

export async function findValidInvite(tenantId: TenantId, token: string) {
  return must<{ spaceTitle: string; email: string }>(await query(
    `SELECT s."title" AS "spaceTitle", i."email"
       FROM "SpaceInvite" i JOIN "Space" s ON s."id" = i."spaceId"
      WHERE s."tenantId" = $1 AND i."token" = $2 AND i."acceptedAt" IS NULL AND i."expiresAt" > now()`,
    [tenantId, token],
  ))[0] ?? null;
}

export async function listRules(spaceId: string): Promise<RuleRow[]> {
  return must<RuleRow>(await query(
    `SELECT "id", "kind", "value", "role", "createdAt" FROM "SpaceAccessRule"
      WHERE "spaceId" = $1 ORDER BY "kind", "value"`,
    [spaceId],
  ));
}

export async function addRule(input: { spaceId: string; kind: 'email' | 'domain'; value: string; role: SpaceRole; createdBy: string }) {
  must(await query(
    `INSERT INTO "SpaceAccessRule" ("spaceId", "kind", "value", "role", "createdBy")
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT ("spaceId", "kind", "value") DO UPDATE SET "role" = EXCLUDED."role"`,
    [input.spaceId, input.kind, input.value, input.role, input.createdBy],
  ));
}

export async function removeRule(spaceId: string, ruleId: string) {
  must(await query(`DELETE FROM "SpaceAccessRule" WHERE "spaceId" = $1 AND "id" = $2`, [spaceId, ruleId]));
}
```

- [ ] **Step 2: APIs**

Every studio API starts with the same guard: 404 if the tenant has no studio, 401 without session/user, and for author actions 403 unless `getMembership(...).role === 'author'`.

`src/pages/api/studio/me.ts`:
```ts
import type { APIRoute } from 'astro';
import { json } from '../../../lib/forum-server';
import { getStudioUserId, listMemberships, studioEnabled } from '../../../lib/tenant/studio-db';

export const prerender = false;

export const GET: APIRoute = async ({ locals }) => {
  if (!studioEnabled(locals.tenant)) return json({ error: 'Not found' }, 404);
  const userId = await getStudioUserId(locals);
  if (!userId) return json({ error: 'Not authenticated' }, 401);
  return json({ email: locals.session?.user?.email, spaces: await listMemberships(locals.tenant.id, userId) });
};
```

`src/pages/api/studio/invites.ts`:
```ts
import type { APIRoute } from 'astro';
import { json } from '../../../lib/forum-server';
import { resolveRequestAuthOrigin } from '../../../lib/auth-origin';
import { validateInviteInput } from '../../../lib/tenant/space-roles';
import { createInvite, getMembership, getStudioUserId, INVITE_TTL_DAYS, studioEnabled } from '../../../lib/tenant/studio-db';

export const prerender = false;

export const POST: APIRoute = async ({ locals, request }) => {
  if (!studioEnabled(locals.tenant)) return json({ error: 'Not found' }, 404);
  const userId = await getStudioUserId(locals);
  if (!userId) return json({ error: 'Not authenticated' }, 401);

  const body = await request.json().catch(() => ({}));
  const spaceId = String(body.spaceId || '');
  const membership = await getMembership(locals.tenant.id, userId, spaceId);
  if (membership?.role !== 'author') return json({ error: 'Forbidden' }, 403);

  const input = validateInviteInput({ email: body.email, role: body.role });
  if (!input.ok) return json({ error: input.error }, 400);

  const { token } = await createInvite({ spaceId, email: input.email, role: input.role, createdBy: userId });
  const url = `${resolveRequestAuthOrigin(request)}/studio/invite/${token}`;
  return json({ url, expiresInDays: INVITE_TTL_DAYS });
};
```

`src/pages/api/studio/access-rules.ts`:
```ts
import type { APIRoute, APIContext } from 'astro';
import { json } from '../../../lib/forum-server';
import { validateAccessRuleInput } from '../../../lib/tenant/space-roles';
import { addRule, getMembership, getStudioUserId, listRules, removeRule, studioEnabled } from '../../../lib/tenant/studio-db';

export const prerender = false;

async function requireAuthor(ctx: APIContext, spaceId: string) {
  if (!studioEnabled(ctx.locals.tenant)) return { error: json({ error: 'Not found' }, 404) };
  const userId = await getStudioUserId(ctx.locals);
  if (!userId) return { error: json({ error: 'Not authenticated' }, 401) };
  const membership = await getMembership(ctx.locals.tenant.id, userId, spaceId);
  if (membership?.role !== 'author') return { error: json({ error: 'Forbidden' }, 403) };
  return { userId };
}

export const GET: APIRoute = async (ctx) => {
  const spaceId = ctx.url.searchParams.get('spaceId') || '';
  const guard = await requireAuthor(ctx, spaceId);
  if ('error' in guard) return guard.error;
  return json({ rules: await listRules(spaceId) });
};

export const POST: APIRoute = async (ctx) => {
  const body = await ctx.request.json().catch(() => ({}));
  const spaceId = String(body.spaceId || '');
  const guard = await requireAuthor(ctx, spaceId);
  if ('error' in guard) return guard.error;
  const input = validateAccessRuleInput({ kind: body.kind, value: body.value, role: body.role });
  if (!input.ok) return json({ error: input.error }, 400);
  await addRule({ spaceId, kind: input.kind, value: input.value, role: input.role, createdBy: guard.userId });
  return json({ ok: true });
};

export const DELETE: APIRoute = async (ctx) => {
  const spaceId = ctx.url.searchParams.get('spaceId') || '';
  const ruleId = ctx.url.searchParams.get('ruleId') || '';
  const guard = await requireAuthor(ctx, spaceId);
  if ('error' in guard) return guard.error;
  await removeRule(spaceId, ruleId);
  return json({ ok: true });
};
```

- [ ] **Step 3: Pages**

`src/pages/studio/login.astro`:
```astro
---
import StudioLayout from '../../layouts/StudioLayout.astro';
import { SignIn } from 'auth-astro/components';
import { t } from '../../lib/i18n';
import { resolveRequestAuthOrigin } from '../../lib/auth-origin';
import { studioEnabled } from '../../lib/tenant/studio-db';
export const prerender = false;

const tenant = Astro.locals.tenant;
if (!studioEnabled(tenant)) return Astro.rewrite('/studio/not-found');
if (Astro.locals.session?.user?.email) return Astro.redirect('/studio');
const locale = tenant.locale;
const callbackUrl = `${resolveRequestAuthOrigin(Astro.request)}/studio`;
const provider = tenant.authProviders[0];
---
<StudioLayout title={t(locale, 'studio.signIn')} locale={locale}>
  <h1>{t(locale, 'studio.signIn')}</h1>
  <p class="so-muted">{t(locale, 'studio.signInLead')}</p>
  <SignIn provider={provider} options={{ callbackUrl }}><span>{t(locale, 'studio.signIn')}</span></SignIn>
</StudioLayout>
```

`src/pages/studio/index.astro`:
```astro
---
import StudioLayout from '../../layouts/StudioLayout.astro';
import { SignOut } from 'auth-astro/components';
import { t } from '../../lib/i18n';
import { getStudioUserId, listMemberships, studioEnabled } from '../../lib/tenant/studio-db';
export const prerender = false;

const tenant = Astro.locals.tenant;
if (!studioEnabled(tenant)) return Astro.rewrite('/studio/not-found');
const locale = tenant.locale;
const userId = await getStudioUserId(Astro.locals);
if (!userId) return Astro.redirect('/studio/login');
const spaces = await listMemberships(tenant.id, userId);
---
<StudioLayout title={t(locale, 'studio.title')} locale={locale}>
  <SignOut slot="nav"><span>{t(locale, 'studio.signOut')}</span></SignOut>
  <h1>{t(locale, 'studio.mySpaces')}</h1>
  {spaces.length === 0 && <p class="so-muted">{t(locale, 'studio.noSpaces')}</p>}
  <ul>
    {spaces.map((s) => (
      <li>
        <strong>{s.title}</strong> · <span class="so-muted">{t(locale, `roles.${s.role}`)}</span>
        {s.role === 'author' && <> · <a href={`/studio/settings/access?space=${s.spaceId}`}>{t(locale, 'studio.settings')}</a></>}
      </li>
    ))}
  </ul>
</StudioLayout>
```

`src/pages/studio/invite/[token].astro`:
```astro
---
import StudioLayout from '../../../layouts/StudioLayout.astro';
import { SignIn } from 'auth-astro/components';
import { t } from '../../../lib/i18n';
import { resolveRequestAuthOrigin } from '../../../lib/auth-origin';
import { findValidInvite, studioEnabled } from '../../../lib/tenant/studio-db';
export const prerender = false;

const tenant = Astro.locals.tenant;
if (!studioEnabled(tenant)) return Astro.rewrite('/studio/not-found');
const locale = tenant.locale;
const invite = await findValidInvite(tenant.id, Astro.params.token ?? '');
const callbackUrl = `${resolveRequestAuthOrigin(Astro.request)}/studio`;
if (!invite) Astro.response.status = 404;
---
<StudioLayout title={t(locale, 'studio.invite.title')} locale={locale}>
  <h1>{t(locale, 'studio.invite.title')}</h1>
  {invite ? (
    <>
      <p><strong>{invite.spaceTitle}</strong></p>
      <p class="so-muted">{t(locale, 'studio.invite.lead')} ({invite.email})</p>
      <SignIn provider={tenant.authProviders[0]} options={{ callbackUrl }}><span>{t(locale, 'studio.invite.accept')}</span></SignIn>
    </>
  ) : (
    <p class="so-muted">{t(locale, 'studio.invite.invalid')}</p>
  )}
</StudioLayout>
```

`src/pages/studio/settings/access.astro`:
```astro
---
import StudioLayout from '../../../layouts/StudioLayout.astro';
import { t } from '../../../lib/i18n';
import { GRANTABLE_ROLES } from '../../../lib/tenant/space-roles';
import { getMembership, getStudioUserId, listRules, studioEnabled } from '../../../lib/tenant/studio-db';
export const prerender = false;

const tenant = Astro.locals.tenant;
if (!studioEnabled(tenant)) return Astro.rewrite('/studio/not-found');
const locale = tenant.locale;
const userId = await getStudioUserId(Astro.locals);
if (!userId) return Astro.redirect('/studio/login');
const spaceId = Astro.url.searchParams.get('space') ?? '';
const membership = await getMembership(tenant.id, userId, spaceId);
if (membership?.role !== 'author') {
  Astro.response.status = 403;
}
const rules = membership?.role === 'author' ? await listRules(spaceId) : [];
const labels = {
  domainWarning: t(locale, 'studio.access.domainWarning'),
  invalid: t(locale, 'studio.access.invalid'),
  created: t(locale, 'studio.invite.created'),
};
---
<StudioLayout title={t(locale, 'studio.access.title')} locale={locale}>
  {membership?.role !== 'author' ? (
    <p>{t(locale, 'errors.forbidden')}</p>
  ) : (
    <>
      <h1>{t(locale, 'studio.access.title')} · {membership.title}</h1>
      <p class="so-muted">{t(locale, 'studio.access.lead')}</p>

      <table>
        <tbody>
          {rules.length === 0 && <tr><td class="so-muted">{t(locale, 'studio.access.empty')}</td></tr>}
          {rules.map((r) => (
            <tr>
              <td>{r.kind === 'email' ? t(locale, 'studio.access.kindEmail') : t(locale, 'studio.access.kindDomain')}</td>
              <td>{r.value}</td>
              <td>{t(locale, `roles.${r.role}`)}</td>
              <td><button type="button" data-remove={r.id}>{t(locale, 'studio.access.remove')}</button></td>
            </tr>
          ))}
        </tbody>
      </table>

      <form id="rule-form">
        <select name="kind">
          <option value="email">{t(locale, 'studio.access.kindEmail')}</option>
          <option value="domain">{t(locale, 'studio.access.kindDomain')}</option>
        </select>
        <input name="value" required placeholder={t(locale, 'studio.access.value')} />
        <select name="role">
          {GRANTABLE_ROLES.map((role) => <option value={role} selected={role === 'guest'}>{t(locale, `roles.${role}`)}</option>)}
        </select>
        <button type="submit">{t(locale, 'studio.access.add')}</button>
      </form>
      <p id="rule-warning" class="so-muted" hidden>{labels.domainWarning}</p>

      <h2>{t(locale, 'studio.invite.create')}</h2>
      <form id="invite-form">
        <input name="email" type="email" required placeholder={t(locale, 'studio.invite.email')} />
        <select name="role">
          {GRANTABLE_ROLES.map((role) => <option value={role}>{t(locale, `roles.${role}`)}</option>)}
        </select>
        <button type="submit">{t(locale, 'studio.invite.create')}</button>
      </form>
      <p id="invite-result" hidden></p>
    </>
  )}
  <script is:inline define:vars={{ spaceId, labels }}>
    const post = (url, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const ruleForm = document.getElementById('rule-form');
    const warning = document.getElementById('rule-warning');
    ruleForm?.addEventListener('change', () => {
      const f = new FormData(ruleForm);
      warning.hidden = !(f.get('kind') === 'domain' && f.get('role') !== 'guest');
    });
    ruleForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(ruleForm);
      const res = await post('/api/studio/access-rules', { spaceId, kind: f.get('kind'), value: f.get('value'), role: f.get('role') });
      if (res.ok) location.reload(); else alert(labels.invalid);
    });
    document.querySelectorAll('[data-remove]').forEach((btn) => btn.addEventListener('click', async () => {
      const q = new URLSearchParams({ spaceId, ruleId: btn.dataset.remove });
      const res = await fetch(`/api/studio/access-rules?${q}`, { method: 'DELETE' });
      if (res.ok) location.reload();
    }));
    const inviteForm = document.getElementById('invite-form');
    inviteForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = new FormData(inviteForm);
      const res = await post('/api/studio/invites', { spaceId, email: f.get('email'), role: f.get('role') });
      const data = await res.json();
      const out = document.getElementById('invite-result');
      out.hidden = false;
      out.textContent = res.ok ? `${labels.created} ${data.url}` : labels.invalid;
    });
  </script>
</StudioLayout>
```
`t(locale, \`roles.${…}\`)` needs a cast if `astro check` complains about template-literal keys: use `t(locale, \`roles.${s.role}\` as MessageKey)` with `import type { MessageKey } from '../../lib/i18n'`.

- [ ] **Step 4: Local smoke test against staging**

Run dev with the staging DB through the existing tunnel script (`scripts/db-tunnel.fish`, pointing at `musiki_staging`) and `TENANT=so npm run dev`. Seed a space for your user in staging (Task 6 seed, `-d musiki_staging`). Verify:
- `/studio` without session → redirects to `/studio/login`
- `/studio/login` shows only the "so" sign-in button, English, no "musiki"
- `curl -s -o /dev/null -w '%{http_code}' localhost:4321/api/studio/me` → `401`
- run the same pages with `npm run dev` (no `TENANT`): `/studio` → 404 page (musiki has no studio)

- [ ] **Step 5: Commit**

```bash
git add src/lib/tenant/studio-db.ts src/pages/studio src/pages/api/studio
git commit -m "feat(studio): English studio shell, invitations and access-rules management"
```

---

### Task 11: so-web assets, Logto app, Caddy, staging verification, production rollout

Ops + two small code changes. **Ask the user before each remote write** (Logto admin, Caddyfile, production migration, pm2 reload).

**Files:**
- Modify (so-web repo `/Users/zztt/projects/25-soweb/so-web`): `astro.config.mjs`
- Modify (VPS): `/etc/caddy/Caddyfile`, `/opt/musiki/framework/.env` (add `LOGTO_SO_CLIENT_ID`, `LOGTO_SO_CLIENT_SECRET` — the user edits secrets; never echo them)
- Modify: `MEMORY.md`, `AGENTS.md` (add the tenant layer to the map of content)

- [ ] **Step 1: so-web publishes assets under `/_so`**

In so-web `astro.config.mjs`:
```js
export default defineConfig({
  site: "https://so.zztt.org",
  base: "/",
  build: { assets: "_so" },
  // …rest unchanged
});
```
```bash
cd /Users/zztt/projects/25-soweb/so-web && npm run build && ls dist | grep -E '^_so$' && ! ls dist | grep -q '^_astro$'
```
Expected: `_so` listed, no `_astro`. Commit in so-web and deploy it (existing so-web deploy flow into `/opt/so/dist`).

- [ ] **Step 2: Logto application "so" (user performs in logto-admin.zztt.org)**

Checklist for the user:
- Create a "Traditional web" application named `so`.
- Redirect URIs: `https://so.zztt.org/api/auth/callback/logto-so`, `https://so-dev.zztt.org/api/auth/callback/logto-so`, `http://localhost:4321/api/auth/callback/logto-so`.
- Post sign-out redirect URIs: `https://so.zztt.org/studio`, `https://so-dev.zztt.org/studio`.
- Sign-in experience: email sign-up **requires verification** (verification code).
- If this Logto version offers per-application branding, set name "so" and the so logo; otherwise leave the neutral default.
- Put `LOGTO_SO_CLIENT_ID` and `LOGTO_SO_CLIENT_SECRET` in `/opt/musiki/framework/.env` (and in local `.env` for dev).

- [ ] **Step 3: DNS + Caddy for so-dev and so**

Confirm `so-dev.zztt.org` resolves to `46.225.154.68` (add the DNS record if missing). Back up and edit the Caddyfile:
```bash
ssh hetzner 'bash -c "sudo cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak-so-\$(date +%Y%m%d%H%M%S)"'
```
Replace the existing `so.zztt.org { … }` block and add `so-dev.zztt.org`:
```caddy
so.zztt.org {
	encode zstd gzip
	header {
		Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
		X-Content-Type-Options "nosniff"
		Referrer-Policy "strict-origin-when-cross-origin"
	}
	@engine path /studio /studio/* /api/* /_astro/*
	handle @engine {
		reverse_proxy 127.0.0.1:4321
	}
	handle {
		root * /opt/so/dist
		file_server
	}
}

so-dev.zztt.org {
	encode zstd gzip
	# Everything goes to the dev engine (musiki-framework-dev, 127.0.0.1:4325):
	# the Vite dev server needs /@vite, /@id, /@fs, /src, /node_modules and the
	# HMR websocket. The engine's tenant allowlist still 404s musiki routes, and
	# so-web static pages are not served on this host.
	reverse_proxy 127.0.0.1:4325
}
```
For the first rollout, add only `so-dev.zztt.org` and leave `so.zztt.org` unchanged until Step 5 passes.
```bash
ssh hetzner "bash -c 'sudo caddy validate --config /etc/caddy/Caddyfile && sudo systemctl reload caddy'"
```
Expected: `Valid configuration`.

- [ ] **Step 4: Deploy the engine to the dev process and seed staging**

Push `main`, update the VPS checkout (existing `scripts/vps-update.sh` flow), restart only `musiki-framework-dev`. Seed staging:
```bash
ssh hetzner "bash -c 'docker exec -i $PGC psql -U app -d musiki_staging -v author_email=lucianoazzigotti@gmail.com -v title=\"Dissertation\" -v slug=dissertation'" < postgres-patches/seeds/so-dissertation-space.sql
```
(Staging has no users; first create yours by signing in once at dev.musiki.org.ar, or insert a `User` + `UserEmail` row for your email in staging, then re-run the seed.)

- [ ] **Step 5: Integration checks on so-dev**

- `curl -s -o /dev/null -w '%{http_code}\n' https://so-dev.zztt.org/foro` → `404` (served by so-web static)
- `curl -s -o /dev/null -w '%{http_code}\n' https://so-dev.zztt.org/api/enroll` → `404` (engine allowlist)
- `curl -s -o /dev/null -w '%{http_code}\n' https://so-dev.zztt.org/api/auth/signin/google` → `404` (provider gating)
- `curl -s https://so-dev.zztt.org/studio/login | grep -ci -e musiki -e 'iniciar'` → `0`
- Browser: sign in at `https://so-dev.zztt.org/studio/login` as author → lands on `https://so-dev.zztt.org/studio` (not musiki), sees the space as Author.
- In access settings: add rule `domain nmh.no → guest`; create an invite for a second email you control as `supervisor`; open the invite link in a private window, sign up in Logto with that email (verify it) → lands in studio as Supervisor. Sign up with an unlisted email → rejected.
- In staging DB, make a user with `User.role='admin'` who is not a member and sign in on so-dev → rejected; with a musiki session cookie, `GET https://so-dev.zztt.org/api/studio/me` returns `{ spaces: [] }` or 401, never musiki data.
- Grep rendered HTML of `/studio`, `/studio/login`, `/studio/settings/access`, `/studio/not-found` and the invite page for `musiki`, `musiki.org.ar`, and Spanish words (`iniciar`, `sesión`, `curso`) → no hits. Any hit is a release blocker.

- [ ] **Step 6: Production rollout**

1. Back up prod DB (`npm run db:backup` flow in `docs/db/database-management.md`).
2. Apply the migration to `musiki26`:
   ```bash
   ssh hetzner "bash -c 'docker exec -i $PGC psql -U app -d musiki26 -v ON_ERROR_STOP=1'" < postgres-patches/migrations/20260925120000_tenant_spaces.sql
   ```
3. Build and reload `musiki-framework` (normal deploy).
4. Seed the real space (Task 6 seed against `musiki26`, with the real title).
5. Switch the `so.zztt.org` Caddy block to the version in Step 3, validate, reload.
6. Repeat the Step 5 checks against `https://so.zztt.org`, and confirm https://musiki.org.ar login and dashboard still work.

- [ ] **Step 7: Document and commit**

Add to `AGENTS.md` under Architecture & Core: `- [Tenant layer](docs/superpowers/specs/2026-09-25-tenant-layer-design.md) — host → tenant (musiki/hem/so), route allowlist, spaces & roles.` Add MEMORY.md entries for the rollout.
```bash
git add AGENTS.md MEMORY.md
git commit -m "docs: tenant layer rollout notes"
```

---

## Known limitations (accepted, tracked for later sub-projects)

- Users provisioned via so get `User.role = 'student'` and could sign in to musiki.org.ar with the same email through Google; they are never told musiki exists.
- Auth.js default error page (`/api/auth/error`) is shown on rejected sign-in; it is generic English, not so-branded (sub-project 2).
- Invitations are shared as links; email delivery needs a mailer.
- Session cookie is still named `__Secure-musiki.session-token`.
