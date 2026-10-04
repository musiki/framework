# hem instance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** hem.zztt.org becomes a second build of the musiki engine (same repo and commit), with its own courses (`internetmusic`), French UI, HEM brand, `logto-hem` and the `musiki_hem` database; the fork is retired.

**Architecture:** `MUSIKI_INSTANCE` (`musiki` | `hem`) chooses build-time inputs (content manifest); per-request behaviour (locale, brand, auth providers) comes from the tenant resolved by host (`hem.zztt.org` → tenant `hem`). The deploy workflow builds the same checkout twice: `/opt/musiki/framework` and `/opt/hem/engine`.

**Tech Stack:** Astro 6 SSR engine, Node 24 `node --test`, Auth.js providers (`auth.config.ts`), pm2, GitHub self-hosted runner, Postgres container `authentik-postgresql`.

**Spec:** `docs/superpowers/specs/2026-10-04-hem-instance-design.md`

## Global Constraints

- One code folder: everything lands in `musiki/framework`; nothing is copied from the fork except the HEM logo, the French strings, and the content-language feature (+ the useful parts of the fork's uncommitted files).
- musiki.org.ar must render and behave exactly as before (same Spanish strings, brand, routes, deploy timing aside); so and mm unaffected.
- Instance values: `MUSIKI_INSTANCE` ∈ {`musiki` (default when unset), `hem`}; any other value fails the build with a clear error.
- hem manifest file: `config/sources.hem.json`; musiki manifest stays `config/sources.manifest.json`; an explicit `--manifest` argument always wins.
- hem runtime: dir `/opt/hem/engine`, pm2 `hem-engine` on port **4333**, `hem-engine-content-bus` on port **4334**, deploy lock `/tmp/hem-engine-deploy.lock`, LilyPond store `/opt/hem/data/lily`.
- Auth provider id `logto-hem`, env `LOGTO_HEM_CLIENT_ID` / `LOGTO_HEM_CLIENT_SECRET` (issuer `LOGTO_ISSUER_URL` shared); provider absent when the id is unset.
- i18n: `t(locale, key, vars)` from `src/lib/i18n`; `fr` falls back to `en`; Spanish text of musiki screens moves verbatim into `es.ts`.
- Fork (read-only reference): `/Users/zztt/projects/hem/framework` (committed fork + 13 uncommitted files). Never edit it; never read any `.env`.
- Never `git add -A`, never `git stash`; commits end with a blank line + `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Worktree `/Users/zztt/projects/26-musiki/framework-hem` (branch `feat/hem-instance`, `node_modules` symlinked).

---

### Task 1: Instance selection and the hem content manifest

**Files:**
- Create: `src/lib/instance.mjs` (pure, importable from `.mjs` scripts and `.ts`), `src/lib/instance.test.mjs`, `config/sources.hem.json`
- Modify: `scripts/pull-sources.mjs`, `scripts/assemble-content.mjs`, `scripts/watch-content.mjs`, `src/lib/notes-fs.ts`, `src/lib/content-admin.ts` (every reader of `config/sources.manifest.json`), `package.json` (`test` glob already covers `src/lib/*.test.mjs`? — add the file explicitly if not)

**Interfaces — Produces:**
- `INSTANCES = ['musiki', 'hem']`
- `currentInstance(env = process.env): 'musiki' | 'hem'` — unset/empty → `'musiki'`; unknown → throws `Error('Unknown MUSIKI_INSTANCE "<v>" (expected musiki or hem)')`.
- `contentManifestPath(instance): string` → `'config/sources.manifest.json'` | `'config/sources.hem.json'` (relative to repo root).

- [ ] Write tests: default, `hem`, unknown throws, both manifest paths; the manifest file `config/sources.hem.json` parses and has one enabled source `internetmusic` (repo `HEM-Multimedia-Master/internetmusic`, branch `main`, `contentRoot: "."`, `localPath: "../../hem/internetmusic"`) and the assembly block copied from the fork's `config/sources.manifest.json`.
- [ ] Implement; make each script's `--manifest` default `contentManifestPath(currentInstance())`.
- [ ] `node --test src/lib/instance.test.mjs` passes; `npm test` green; `MUSIKI_INSTANCE=hem node scripts/assemble-content.mjs` (dry) lists the internetmusic source.
- [ ] Commit `feat(instance): MUSIKI_INSTANCE selects the content manifest; hem manifest`.

### Task 2: Tenant hem and brand by tenant

**Files:**
- Modify: `src/lib/tenant/tenants.ts` (+ its test), `src/components/Header.astro`, `src/components/Ribbon.astro`, any other hard-coded musiki brand point found by `grep -rn "logo-musiki\|Ayuda Musiki\|doc.musiki.org.ar\|alt=\"musiki26\"" src`
- Create: `public/hem-logo.png` (copy of the fork's `public/logo/hem-logo.png`)

**Interfaces — Produces:** `Tenant.brand` gains `{ logo: string; logoAlt: string; helpLabel: string; docsUrl: string }`. musiki: `logo: '/logo-musiki.png'`, `logoAlt: 'musiki26'`, `helpLabel: 'Ayuda Musiki'`, `docsUrl: import.meta.env.PUBLIC_DOCS_URL || 'https://doc.musiki.org.ar'` (keep the env override where it is read today). hem: `hosts: ['hem.zztt.org']`, `logo: '/hem-logo.png'`, `logoAlt: 'HEM'`, `helpLabel: 'Aide'`, `docsUrl` same as musiki. so/mm get values too (unused).

- [ ] Tests: `tenantForHost('hem.zztt.org').id === 'hem'`, routes `'all'`, locale `fr`, `authProviders ['logto-hem']`; musiki brand values exactly as listed; hosts unique across tenants.
- [ ] Header/Ribbon read `Astro.locals.tenant.brand` (fallback to the musiki tenant when `locals.tenant` is missing). Check the fork's diff (`git -C /Users/zztt/projects/hem/framework show 4c87981 b9f79ca -- src/components/Header.astro src/components/Ribbon.astro`) for any other brand-only change worth taking.
- [ ] Build passes; the musiki home and a course page render the same logo/labels as before (harness or `npm run build:local` + preview).
- [ ] Commit `feat(tenant): hem host and brand fields; header and ribbon use the tenant brand`.

### Task 3: French dictionary and parity report

**Files:**
- Create: `src/lib/i18n/fr.ts`
- Modify: `src/lib/i18n/index.ts` (register `fr`, remove the "fr is added when hem joins" comment), `src/lib/i18n/i18n.test.mjs`

- [ ] Map every string of the fork's `src/locales/fr.ts` (and `es.ts` for the key meaning) onto the engine's `Dict` keys. Where the engine has no key yet for a fork string, leave it for Task 4 (which adds keys to `en`/`es` and their `fr`). `fr` is `Partial<Dict>`-typed like `nb`.
- [ ] Test: every key present in `fr` exists in `en` (fails otherwise); a second test prints (does not fail) the count and list of `en` keys missing in `fr`; `t('fr', <known key>)` returns French; an unknown `fr` key falls back to `en`.
- [ ] Commit `feat(i18n): French dictionary from the hem fork`.

### Task 4: Localize the screens the fork translated

**Files (modify only the strings the fork changed):** `src/components/Header.astro`, `src/components/Ribbon.astro`, `src/pages/cursos.astro`, `src/pages/dashboard.astro`, `src/pages/foro.astro`, `src/pages/index.astro`, `src/pages/login.astro`, `src/components/course/RecursosEditor.astro`, `src/components/course/ClassWorkspacePanel.astro`, `src/components/course/CourseProgressPod.astro`, `src/components/room/workspace/PodTemplates.astro`, `src/components/room/generators/centauro/CentauroPanel.astro`; dictionaries `en.ts`, `es.ts`, `fr.ts`.

- [ ] For each file: diff the fork against its July base (`git -C /Users/zztt/projects/hem/framework diff d2143a2 HEAD -- <file>`) to find the strings it localized; in the engine version replace each literal with `t(locale, '<ns>.<key>')` where `locale = Astro.locals.tenant?.locale ?? 'es'`; add the key to `es.ts` with the exact current Spanish text, to `en.ts` with English, and to `fr.ts` with the fork's French. Client-side scripts that build text get the strings through a `data-*` attribute or a JSON strings blob (follow `src/lib/mm/page-strings.ts` pattern), never by importing the dictionaries in the browser bundle.
- [ ] Skip fork changes that removed UNTREF-specific content from shared pages (e.g. `public/universidad-publica.md`) — musiki keeps it; if a page shows UNTREF content, gate it on `tenant.id === 'musiki'`.
- [ ] Test: musiki strings unchanged — for each touched key, `t('es', key)` equals the literal that was removed (a table test listing key → previous literal).
- [ ] Build; spot-check `/`, `/cursos`, `/foro`, `/login`, `/dashboard` with Host `hem.zztt.org` (French) and `musiki.org.ar` (Spanish, identical to before) in the harness or a local preview with `tenantForHost`.
- [ ] Commit per screen group (`feat(i18n): header and ribbon by tenant locale`, `… course pages`, `… dashboard and forum`, …).

### Task 5: Content-language blocks (fr/en inside notes)

**Files:**
- Create (from the fork, adapted): `src/plugins/remark-language-blocks.mjs`, `src/lib/content-language-blocks.test.mjs`, `src/components/ContentLanguageSwitcher.astro`
- Modify: `astro.config.mjs` (register the remark plugin), `src/pages/[...slug].astro` (switcher + hook), `src/lib/i18n/*` (switcher labels: `CONTENT_TRANSLATION_LANGS = ['fr','en']`, labels `FR`/`EN` → put in a small `src/lib/content-language.ts` rather than the UI dictionaries)

- [ ] Start from the fork's committed versions (`d8bb905`) then apply the relevant parts of its uncommitted working-tree changes (`git -C /Users/zztt/projects/hem/framework diff -- src/components/ContentLanguageSwitcher.astro src/plugins/remark-language-blocks.mjs src/lib/content-language-blocks.test.mjs src/pages/[...slug].astro`).
- [ ] The feature is inert for notes without language blocks (test: a note with no blocks produces identical HTML with and without the plugin); the switcher renders only when the page has blocks.
- [ ] Review the remaining uncommitted fork files (`home-gallery.ts/.test`, `runtime-content.ts`, `build-graph-data.mjs`, `graph-data.test.mjs`, `ribbon.css`, `auth.config.ts`, `login.astro`, `index.astro`, `MEMORY.md`): take a change only if it fixes something the engine also has (note it in the report); otherwise drop. List each file with "taken / dropped + why" in the report.
- [ ] `npm test` green; build; a course note with `:::lang fr` / `:::lang en` blocks (or the fork's syntax) switches.
- [ ] Commit `feat(content): language blocks and switcher (from hem)`.

### Task 6: logto-hem provider

**Files:** `auth.config.ts` (+ its tests if present; otherwise a small pure helper test), `src/pages/login.astro` only if it lists providers per tenant.

- [ ] Add `logtoHemProvider` exactly like `logtoSoProvider` (id `logto-hem`, `LOGTO_HEM_CLIENT_ID` / `LOGTO_HEM_CLIENT_SECRET`, issuer `LOGTO_ISSUER_URL`), included only when the id is set; tenant hem's login page offers it (the tenant's `authProviders` already says `logto-hem`; check the login page filters by tenant and that musiki's login shows no hem button).
- [ ] Commit `feat(auth): logto-hem provider for the hem tenant`.

### Task 7: Runtime and deploy for the hem instance

**Files:** `ecosystem.config.cjs`, `scripts/vps/content-bus.mjs` (if it hard-codes names/paths), `scripts/vps/deploy-framework-local.sh` (only if needed: it already reads `VPS_FRAMEWORK_DIR`, `VPS_DEPLOY_LOCK_FILE`, `LILYPOND_ASSET_DIR`, `VPS_RELOAD_COMMAND`), `.github/workflows/sync-content-sources.yml`, new `scripts/vps/env-keys-check.mjs` (+ test)

- [ ] `ecosystem.config.cjs`: app names and ports from env with today's defaults (`PM2_APP_NAME` → `musiki-framework`, `PORT` 4321; `PM2_DEV_APP_NAME`; `PM2_BUS_APP_NAME` → `musiki-content-bus`, `CONTENT_BUS_PORT` 4322). With `MUSIKI_INSTANCE=hem` in `.env` the defaults become `hem-engine` / 4333, no dev app, `hem-engine-content-bus` / 4334. Keep the existing `.env` parsing. Test with a tiny node script that requires the config under both envs and asserts names/ports (add to `scripts/ecosystem-config.test.mjs`, which already exists). *Revised in the final fix wave:* names and ports are fixed per instance and not read from `.env` (musiki output byte-identical to main; hem's `PORT`, `CONTENT_BUS_PORT`, `VPS_FRAMEWORK_DIR`, lock, LilyPond dir, reload command and pm2 names are spread after `...dotEnv` so the copied fork `.env` cannot override them).
- [ ] Workflow: after "Reload Content Bus Sidecar", add a job step group for hem: rsync the same `$GITHUB_WORKSPACE` to `/opt/hem/engine` with the same excludes; `cd /opt/hem/engine && MUSIKI_INSTANCE=hem VPS_FRAMEWORK_DIR=/opt/hem/engine VPS_DEPLOY_LOCK_FILE=/tmp/hem-engine-deploy.lock LILYPOND_ASSET_DIR=/opt/hem/data/lily VPS_RELOAD_COMMAND="pm2 reload ecosystem.config.cjs --only hem-engine --update-env || pm2 start ecosystem.config.cjs --only hem-engine --update-env" bash scripts/vps/deploy-framework-local.sh`; then reload `hem-engine-content-bus`. Skip the hem steps when `/opt/hem/engine/.env` is missing (prints a notice) so the first merge cannot break musiki. Dispatches: if `CONTENT_SOURCE_TARGET_REPO` is `HEM-Multimedia-Master/internetmusic`, run only the hem steps; if it is a musiki source, only the musiki steps; pushes run both. Mark the hem steps `continue-on-error: false` but after the musiki steps, so a hem failure never undoes musiki.
- [ ] `scripts/vps/env-keys-check.mjs <reference.env> <target.env>`: prints key **names** present in reference and missing in target (never values; parse `KEY=` prefixes only). Test with temp files.
- [ ] Commit `feat(ops): hem instance runtime and deploy steps`.

### Task 8: Rollout (controller, with the user)

- [ ] **DB catch-up:** list migrations applied to `musiki26` but not `musiki_hem` (compare `postgres-patches/migrations/*.sql` against objects present; or apply all idempotent migrations in order). Backup `musiki_hem` → restore into `musiki_hem_check` → apply all migrations twice there → if clean, apply twice to `musiki_hem` → owner checks → drop `musiki_hem_check`. All via uploaded bash scripts.
- [ ] **Checkout:** `/opt/hem/engine` must be a git clone, not an empty dir: `deploy-framework-local.sh` runs `git fetch origin && git reset --hard origin/main` there. As zz: `sudo install -d -o zz -g zz /opt/hem /opt/hem/data/lily` (if not already zz-owned) then `git clone https://github.com/musiki/framework.git /opt/hem/engine` (owner zz; verify `stat -c %U /opt/hem/engine` = zz and `git -C /opt/hem/engine remote get-url origin`).
- [ ] **Env:** `cp /opt/hem/framework/.env /opt/hem/engine/.env` (no printing; `chmod 600`).
- [ ] **Strip fork instance keys:** the fork's `.env` carries values that would point the engine at the fork. List the names present (names only, never values) and remove them:
  ```bash
  ENV=/opt/hem/engine/.env
  KEYS='CONTENT_BUS_PORT|VPS_FRAMEWORK_DIR|VPS_RELOAD_COMMAND|VPS_DEPLOY_LOCK_FILE|LILYPOND_ASSET_DIR|PORT|PM2_APP_NAME|PM2_DEV_APP_NAME|PM2_BUS_APP_NAME'
  grep -oE "^(${KEYS})=" "$ENV" | tr -d '='; grep -qE "^(${KEYS})=" "$ENV" || echo '(none present)'
  cp -p "$ENV" "$ENV.bak-$(date +%Y%m%d%H%M%S)"   # backup stays on the VPS, chmod 600
  sed -i -E "/^(${KEYS})=/d" "$ENV"
  grep -cE "^(${KEYS})=" "$ENV"   # expect 0
  ```
  (`ecosystem.config.cjs` pins these for hem anyway; removing them keeps `.env` honest for scripts that read it directly.)
- [ ] **Missing keys:** run `env-keys-check.mjs /opt/musiki/framework/.env /opt/hem/engine/.env` and give the user the missing key names; the user adds `MUSIKI_INSTANCE=hem`, `LOGTO_HEM_CLIENT_ID/SECRET` (from the fork's Logto app), `LILYPOND_SOCKET`, `PLUGINS_DIR`, `AUTH_URL=https://hem.zztt.org` (no `PORT`: hem is pinned to 4333/4334 by `ecosystem.config.cjs`); the user updates the Logto app redirect URI to `https://hem.zztt.org/api/auth/callback/logto-hem`.
- [ ] **Content token check:** confirm `CONTENT_SOURCE_READ_TOKEN` from `/opt/hem/engine/.env` can read `HEM-Multimedia-Master/internetmusic`, printing only the status code:
  ```bash
  TOKEN="$(grep -E '^CONTENT_SOURCE_READ_TOKEN=' /opt/hem/engine/.env | tail -n 1 | cut -d= -f2- | tr -d "\"' \r")"
  [ -n "$TOKEN" ] || echo 'CONTENT_SOURCE_READ_TOKEN missing'
  curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $TOKEN" https://api.github.com/repos/HEM-Multimedia-Master/internetmusic
  unset TOKEN
  ```
  Expect `200`; on `404`/`401` the user grants the token read access to the repo (fine-grained token or org approval) before the first deploy.
- [ ] **Deploy:** merge `feat/hem-instance` → main, push, verify `origin/main`, watch the run; musiki verified unchanged (musiki.org.ar home, a course, login 200).
- [ ] **Known workflow behaviour:** the hem steps run after the musiki steps in the same job, and a musiki-only `repository_dispatch` shares the musiki concurrency group with pushes. If such a dispatch arrives while a push run is in its hem steps, it can cancel that run: musiki is already deployed, hem is left on its previous build and is only updated by the next push (or a manual `workflow_dispatch`). Check the hem step status of the run before assuming hem is current.
- [ ] **Smoke:** `curl -H 'Host: hem.zztt.org' http://127.0.0.1:4333/` (+ a course page, `/login`, `/foro`) on the VPS: 200, French, HEM logo.
- [ ] **Caddy:** `hem.zztt.org` → `reverse_proxy 127.0.0.1:4333` (backup, validate, reload); verify https://hem.zztt.org live; sign in via Logto.
- [ ] **Retire (user OK):** `pm2 delete hem-framework hem-framework-dev hem-content-bus && pm2 save`; tarball `/opt/hem/framework` without `.env` into `/home/zz/backups/`; delete `/opt/hem/framework`; delete `/Users/zztt/projects/hem/framework`; the user archives `HEM-Multimedia-Master/framework` on GitHub and points `internetmusic`'s dispatch at `musiki/framework`.
- [ ] Update `packages/packages.md`, `packages/packages-log.md`, memory `hem-to-tenant`, and remove the worktree + branch automatically.
