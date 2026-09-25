# Tenant Layer ("caras") — Design

**Date:** 2026-09-25
**Status:** Approved design, pending implementation plan
**Scope:** Sub-project 1 of the so.zztt.org initiative. Designed for three tenants (musiki, hem, so); implements only `so` plus `musiki` as the unchanged default.

---

## 1. Context and goal

The framework is currently one product (musiki, Spanish, Argentina) and has already been forked once (hem, French, Geneva — `HEM-Multimedia-Master/framework`, ~99 files diverged in `src/`, three extra pm2 processes). The next consumer is **so.zztt.org**: a public dissertation portal (English) whose private writing studio must be served by this engine.

Requirements that shape the design:

- **One engine, many faces.** No code duplication; updating the engine updates every face.
- **Total invisibility.** so users (e.g. Norwegian supervisor/coordinator, English only) must never see, reach, or learn about musiki: no branding, Spanish text, musiki URLs, content, or users.
- **Logto is the only identity provider** for new faces (shared ecosystem SSO). Authorization stays in the engine's Postgres.
- **Locale split:** interface locale per face; content language per space/document.

### Sub-project map

| # | Sub-project | Status |
|---|---|---|
| 1 | Tenant layer in the engine (this spec) | designing |
| 2 | so studio: dissertation space, permission matrix, transparency levels, dashboard, CTX, TOC, agent provenance | next |
| 3 | so public surface: graph, published chapters, practices, outputs in static so-web | later |
| 4 | Re-merge hem as a `hem` face (retire fork + its pm2 processes) | later |
| 5 | Lift `src/lib/writing/` into `packages/editor` and `packages/tracer` | later |

---

## 2. Tenant model and resolution

Configuration is **code, not DB** (`src/lib/tenant/tenants.ts`), versioned and deployed with the engine. Secrets (Logto client ids/secrets) come from env vars per tenant.

```ts
type TenantId = 'musiki' | 'hem' | 'so';
type RouteFamily = 'studio' | 'auth' | 'api:studio' | /* … */ string;

type Tenant = {
  id: TenantId;
  hosts: string[];                  // exact hostnames, lowercase, no port
  locale: 'es' | 'fr' | 'en';       // interface locale
  brand: { name: string; theme: SiteTheme; logo: string; mailFrom: string };
  spaceKinds: SpaceKind[];          // musiki/hem: ['course']; so: ['dissertation']
  routes: 'all' | RouteFamily[];    // musiki: 'all'; so: ['studio', 'auth', 'api:studio']
  authProviders: string[];          // so: ['logto-so']
};
```

- `SiteTheme` (`src/lib/site-theme.ts`) gains `'so'`.
- **Resolution:** middleware normalizes `x-forwarded-host` (lowercase, strip port), looks up the tenant, sets `locals.tenant`. Unknown host → `musiki` (musiki behavior unchanged). In dev, env `TENANT=<id>` overrides.
- **Single source:** nothing else reads the host header. Pages, APIs, mail, auth, and tracer read `locals.tenant`.
- **Route allowlist (default-deny):** non-`all` tenants reach only declared route families. Anything else returns a 404 rendered in the tenant's locale and brand.

## 3. Spaces, memberships, and data scoping

Existing tables reused unchanged in behavior: `LiveClassNote`, `LiveClassNoteTrace`, `LiveClassNoteAnnotation`, `LiveClassNoteComment`, `LiveClassNoteVersion`, `LiveClassNoteShare`.

Additive migration (`postgres-patches/migrations/`):

```sql
CREATE TABLE "Space" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenantId" text NOT NULL,
  kind text NOT NULL,                 -- 'dissertation'
  slug text NOT NULL,
  title text NOT NULL,
  lang text NOT NULL,                 -- content language, e.g. 'en'
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("tenantId", slug)
);

CREATE TABLE "SpaceMember" (
  "spaceId" uuid NOT NULL REFERENCES "Space"(id) ON DELETE CASCADE,
  "userId" uuid NOT NULL,
  role text NOT NULL,                 -- dissertation: author | supervisor | coordinator | reviewer | guest
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("spaceId", "userId")
);

ALTER TABLE "Course"        ADD COLUMN "tenantId" text NOT NULL DEFAULT 'musiki';
ALTER TABLE "LiveClassNote" ADD COLUMN "spaceId" uuid NULL REFERENCES "Space"(id);
ALTER TABLE "LiveClassNote" ADD COLUMN "lang" text NULL;   -- per-note override of Space.lang
```

Scoping rules:

1. **Tenant membership is derived from space membership.** No `User.tenant` column (one person may belong to several faces).
2. **`User.role` grants nothing outside musiki.** Studio authorization uses only `SpaceMember.role`. A musiki `admin`/`teacher` who is not a member of a so space has no access in so.
3. **Studio APIs are tenant-scoped by construction:** they receive `locals.tenant` and query only spaces with that `tenantId` where the user is a member. Existing musiki APIs are not modified; they are unreachable from so via the allowlist.
4. `Course` and `Space` are **not unified** now. `Course.tenantId` is enough for hem later.

The detailed dissertation permission matrix and transparency levels belong to sub-project 2.

## 4. Locale

Two independent axes:

| Axis | Source | Governs |
|---|---|---|
| `uiLocale` | `locals.tenant.locale` | interface strings, emails, 404/errors, date formats |
| `contentLang` | `note.lang ?? Space.lang` | stopwords, connectives, rhetorical cues, AI output language |

### UI dictionary (no library)

```
src/lib/i18n/en.ts     // source of truth, `as const`
src/lib/i18n/es.ts     // typed as Dict<typeof en> → missing key = type error
src/lib/i18n/fr.ts     // filled when hem joins
src/lib/i18n/index.ts  // t(locale, key, vars?) ; fallback → en
```

Only the namespaces the studio uses are translated: `studio.*`, `trace.*`, `editor.*`, `errors.*`. The rest of musiki keeps its hard-coded Spanish. Components shared with musiki (trace margin, editor toolbar) read their strings from the dictionary with `es` as their musiki locale, so musiki renders identically.

### Tracer language packs

```
src/lib/writing/lang/{es,en}.ts   // future packages/tracer
type LangPack = { stopwords: Set<string>; connectives: Record<RelationKind, string[]>; roleCues: … };
getLangPack(contentLang)
```

Replaces the duplicated lists currently in `src/scripts/course/notes/trace-utils.mjs` (STOPWORDS, connectives at ~L123), `trace-margin.ts` (connectives at ~L368), and `src/scripts/notas/qa-analyzer-logic.ts` (STOPWORDS).

Stored trace keys stay as they are (`rhetorical_role = 'sintesis'`, `analysis_mode = 'tesis'`, enforced by CHECK constraints). They are internal identifiers; display labels come from `t('trace.role.<key>')`. No data migration.

### AI

`src/pages/api/ai/run.ts` receives `contentLang` and uses per-language prompt templates. Missing template → `en`, never silently Spanish. Comments addressed to a viewer may use `uiLocale`.

### `src/lib/writing/` as a package boundary

Studio code imports editor and tracer only through `src/lib/writing/index.ts`. That entry point is the future public API of `packages/editor` / `packages/tracer` (sub-project 5), so lifting them later is a folder move.

## 5. Auth, invitations, access rules, and Caddy

### Caddy (`/etc/caddy/Caddyfile` on hetzner)

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
	# same shape as so.zztt.org; engine → 127.0.0.1:4325 (musiki-framework-dev),
	# static → /opt/so/dist (same so-web build)
}
```

- **Asset collision:** both apps emit `/_astro/*`. so-web sets `build: { assets: '_so' }`; `/_astro/*` belongs to the engine.
- Studio pages load so-web's fonts/CSS from the same origin, so the studio matches so visually without copying assets.
- No new pm2 process: the existing `musiki-framework` process serves both hosts.
- Back up the Caddyfile (`Caddyfile.bak-so-<timestamp>`) before editing, following the existing convention; `caddy validate` before reload.

### Auth.js (auth.config.ts, src/lib/auth-origin.ts)

- **One Logto application per tenant.** Create app "so" in logto-admin; redirect URI `https://so.zztt.org/api/auth/callback/logto-so` (plus the `so-dev` equivalent). Provider id `logto-so`, env `LOGTO_SO_CLIENT_ID` / `LOGTO_SO_CLIENT_SECRET`. On so hosts only `tenant.authProviders` are offered (no Google, Authentik, or musiki-branded login).
- **Per-request origin.** Today `AUTH_URL=https://musiki.org.ar` forces every callback to musiki. The auth origin must come from `locals.tenant` (host validated against `tenant.hosts`), never from a raw header. If the host is not in config, there is no login. `resolveAuthBaseOrigin` / `resolveRequestAuthOrigin` are adapted accordingly; musiki keeps resolving to `https://musiki.org.ar`.
- **Cookies** are host-only, so so and musiki sessions are independent. The cookie name `__Secure-musiki.session-token` stays for now (renaming would log out all musiki users once); revisit in sub-project 4.
- **Logto branding:** verify whether the running Logto version supports per-application branding; otherwise the neutral logto.zztt.org branding is used.
- **Email verification:** the so Logto app must require email verification at sign-up (needed for domain rules).

### Invitations and access rules

```sql
CREATE TABLE "SpaceInvite" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "spaceId" uuid NOT NULL REFERENCES "Space"(id) ON DELETE CASCADE,
  email text NOT NULL,                  -- lowercased
  role text NOT NULL,
  token text UNIQUE NOT NULL,
  "expiresAt" timestamptz NOT NULL,
  "acceptedAt" timestamptz,
  "createdBy" uuid NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE "SpaceAccessRule" (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "spaceId" uuid NOT NULL REFERENCES "Space"(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('email', 'domain')),
  value text NOT NULL,                  -- lowercased: 'someone@uio.no' | 'nmh.no'
  role text NOT NULL,
  "createdBy" uuid NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("spaceId", kind, value)
);
```

- **Invitation flow:** author invites from the studio (email + role) → so-branded English email with `/studio/invite/<token>` → Logto sign-in/sign-up → on sign-in, the invite is matched by email, `User` is created if absent, `SpaceMember` is created, the invite is marked accepted.
- **Manual access rules** (`/studio/settings/access`, author only): the author adds specific emails or whole domains (e.g. `nmh.no`).
  - `email` rules may grant any role.
  - `domain` rules are intended for `guest` (sees TOC and institution-visible material only; promotion is manual). The UI defaults domain rules to `guest` and warns when a higher role is chosen.
  - Domain match is **exact** on the part after `@` (`nmh.no` does not match `x.nmh.no` or `nmh.no.evil.com`), and **requires `email_verified: true`** from the Logto token.
- **`signIn` rule for tenant `so`:** allow iff the (verified, lowercased) email has a valid unexpired invite, OR matches an `email` rule, OR its domain matches a `domain` rule (verified email required), OR the user is already a `SpaceMember` of a so space. On first entry via a rule, create `SpaceMember` with the rule's role. For tenant `musiki` the current rule (registered in `UserEmail`/`User`) is unchanged.

## 6. Testing

Follows the existing `node --test` + `*.test.mjs` convention; new files are added to `npm test`.

### Unit

- **Tenant resolution:** known hosts → tenant; unknown → `musiki`; port and case normalization; `TENANT` override in dev.
- **Route allowlist:** for `so`, `/studio/*` and `/api/studio/*` allowed; `/cursos`, `/foro`, `/dashboard`, `/api/enroll`, `/api/graph-data` → 404.
- **Route sweep:** enumerate every route under `src/pages/` and assert none is reachable from `so` unless its family is allowlisted. (Catches future routes added to musiki.)
- **signIn rule:** valid invite; expired invite; email rule; domain rule with verified email; domain rule with unverified email (rejected); look-alike domain `nmh.no.evil.com` and subdomain `x.nmh.no` (rejected); musiki `admin` who is not a member (rejected in `so`).
- **i18n:** completeness is enforced by `tsc`/`astro check`; test asserts no empty studio strings.
- **Language packs:** tracer with `lang: 'en'` uses English stopwords/connectives, never Spanish.

### Integration (against `so-dev` with a test DB)

- A so space member querying studio APIs gets zero rows of musiki data.
- A musiki user with `User.role = 'admin'` gets 403 on `/api/studio/*` under the so host.
- Login started on `so-dev.zztt.org` returns to `so-dev.zztt.org`.

### Manual pre-production check

Walk the studio as `guest` and as `supervisor`; grep rendered HTML, emails, and error pages for `musiki`, Spanish strings, and `musiki.org.ar` URLs. Any hit is a release blocker.

## 7. Rollout order

1. Tenant config + middleware resolution + allowlist (musiki unchanged; verify with existing tests).
2. Migrations (`Space`, `SpaceMember`, `SpaceInvite`, `SpaceAccessRule`, `Course.tenantId`, `LiveClassNote.spaceId/lang`).
3. i18n dictionary + language packs (dedupe tracer lists; musiki output identical).
4. Auth: per-request origin, `logto-so` provider, tenant-aware `signIn`, invitations and access rules.
5. Minimal `/studio` shell (English, so theme) to exercise the layer end to end. Actual studio features belong to sub-project 2.
6. so-web `build.assets: '_so'`; Caddy `so-dev` → test → `so.zztt.org`.

## 8. Out of scope

- Dissertation permission matrix, transparency levels, dashboard, CTX, TOC, agent provenance UX (sub-project 2).
- so-web public additions, including the graph (sub-project 3).
- hem migration, cookie rename (sub-project 4).
- Extracting `packages/editor` and `packages/tracer` (sub-project 5).
- Unifying `Course` and `Space`.
