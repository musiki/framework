# hem as a musiki instance — design

Status: approved by the user on 2026-10-04 ("todo ok, adelante").

## Goal

hem.zztt.org (the musiki of the Haute École de Musique de Genève) stops being a separate fork (`HEM-Multimedia-Master/framework`, `/opt/hem/framework`) and becomes **the musiki engine built a second time** from the same repo and commit, with its own courses, French interface, HEM brand, Logto app and database. Every push to `musiki/framework` main updates musiki.org.ar and hem.zztt.org together. There is one code folder (`26-musiki/framework`); the fork is retired.

Kept from the fork: the HEM logo, the French interface strings, and the content-language feature (fr/en blocks inside notes + switcher). Everything else in the fork is discarded. Content: the Obsidian vault `HEM-Multimedia-Master/internetmusic` (local `/Users/zztt/projects/hem/internetmusic`). Data: the existing database `musiki_hem` is kept.

## Decisions

- **Two builds, one code** (user choice over a single runtime-partitioned process): course content is assembled at build time (`content:assemble` → Astro collections, search index, graph data), so each instance is a separate build and pm2 process.
- An instance is selected by `MUSIKI_INSTANCE` (`musiki` default, `hem`). It only chooses build-time inputs (content manifest) and defaults; per-request behaviour still comes from the tenant resolved by host.
- Interface locale comes from the tenant (`hem` → `fr`, already declared in `src/lib/tenant/tenants.ts`). Missing `fr` keys fall back to `en`.

## Components

### 1. Instance configuration
- `config/sources.hem.json`: the hem content manifest (source `internetmusic`, repo `HEM-Multimedia-Master/internetmusic`, `localPath: ../../hem/internetmusic`; assembly block as in the fork).
- `src/lib/instance.ts` (pure): `currentInstance(env)` → `'musiki' | 'hem'` (unknown values → error at build), `contentManifestPath(instance)` → `config/sources.manifest.json` | `config/sources.hem.json`.
- `scripts/pull-sources.mjs` and `scripts/assemble-content.mjs` default their `--manifest` from `MUSIKI_INSTANCE` (explicit `--manifest` still wins). Any other script that reads the manifest (graph build, eval sync, content-bus, webhook) follows the same rule — grep for `sources.manifest`.
- Tenant `hem`: hosts `['hem.zztt.org']`, `routes: 'all'`, `locale: 'fr'`, `brand: { name: 'HEM', theme: 'default', logo: '/hem-logo.png', docsUrl?, helpLabel? }`, `authProviders: ['logto-hem']`. musiki keeps its current brand values; brand gains the fields the UI needs (logo path, alt, help label, docs URL).

### 2. Brand by tenant
- `Header.astro`, `Ribbon.astro` (logo, "Ayuda Musiki", docs URL) and any other hard-coded musiki brand point read the tenant brand (`Astro.locals.tenant`). musiki.org.ar renders exactly as today (snapshot/assert tests on the musiki values).
- `public/hem-logo.png` copied from the fork (`public/logo/hem-logo.png`).

### 3. French interface
- `src/lib/i18n/fr.ts`: the fork's ~120 strings (`src/locales/fr.ts`) mapped onto the engine's keys; new keys added to `en.ts`/`es.ts` where the fork translated screens the engine still hard-codes.
- Screens the fork localized move to `t()` with the tenant locale, keeping today's Spanish text as `es` values: Header, Ribbon, `cursos`, `dashboard`, `foro`, `index`, `login`, `RecursosEditor`, `ClassWorkspacePanel`, `CourseProgressPod`, `PodTemplates`, `CentauroPanel` (only the strings the fork changed).
- Content-language feature: `ContentLanguageSwitcher.astro`, `src/plugins/remark-language-blocks.mjs` (+ test), the related i18n helpers (`CONTENT_TRANSLATION_LANGS`, labels) and the `[...slug].astro` hook, as a general engine feature (off unless a note has language blocks).
- Before deleting the fork, harvest its 13 uncommitted files in `/Users/zztt/projects/hem/framework` (language switcher, home gallery, login, ribbon, graph data) — take what belongs to the features above; drop the rest.
- Test: `fr` keys ⊆ `en` keys and a report of `en` keys missing in `fr` (non-failing list printed by the test, failing only on keys that exist in `fr` but not in `en`).

### 4. Data and login
- Database `musiki_hem` (same Postgres container). Apply every engine migration in `postgres-patches/migrations/` that it lacks (compare with `musiki26`; the fork forked on 2026-07-10): backup → staging-style dry run on a copy (`musiki_hem_check` restored from the backup) → apply twice → owner `app` checks. mm-only and so-only tables may be created too (harmless) — the migrations are idempotent and shared.
- Logto: provider `logto-hem` reads `LOGTO_HEM_CLIENT_ID` / `LOGTO_HEM_CLIENT_SECRET` (issuer shared). The Logto app the fork used is reused; its redirect URI becomes `https://hem.zztt.org/api/auth/callback/logto-hem` (the user updates it in the Logto console). Secrets are entered by the user.

### 5. Deploy
- Workflow `.github/workflows/sync-content-sources.yml`: after the musiki deploy, rsync the same checkout to `/opt/hem/engine` (excluding `.env`, `node_modules`, `dist`, content dirs) and run `scripts/vps/deploy-framework-local.sh` with `VPS_FRAMEWORK_DIR=/opt/hem/engine`, `MUSIKI_INSTANCE=hem`, `VPS_DEPLOY_LOCK_FILE=/tmp/hem-engine-deploy.lock`, `LILYPOND_ASSET_DIR=/opt/hem/data/lily`, and a reload command limited to the hem apps. A failure of the hem step must not mark the musiki deploy failed retroactively (separate step, reported on its own).
- `ecosystem.config.cjs` takes app names and port from env so the hem checkout runs `hem-engine` (port **4333**) and `hem-engine-content-bus`; musiki's names/ports unchanged. Content-bus for hem triggers redeploys of the hem instance only when `internetmusic` changes.
- `/opt/hem/engine/.env`: created from `/opt/hem/framework/.env` (copied on the server without printing), then `MUSIKI_INSTANCE=hem`, `PORT=4333`, `LOGTO_HEM_*`, `LILYPOND_SOCKET`, `LILYPOND_ASSET_DIR=/opt/hem/data/lily`, `PLUGINS_DIR` set by the user. The engine's required env list (compare with `/opt/musiki/framework/.env` key names only) is checked by a script that prints missing key **names**, never values.

### 6. Cut-over
1. Deploy `hem-engine` on 4333 alongside the fork (fork keeps serving hem.zztt.org on 4328).
2. Smoke test through `curl -H 'Host: hem.zztt.org' http://127.0.0.1:4333/…` and a temporary host if needed.
3. Caddy `hem.zztt.org` → `reverse_proxy 127.0.0.1:4333` (backup, validate, reload).
4. With the user's OK: stop and delete pm2 `hem-framework`, `hem-framework-dev`, `hem-content-bus`; archive `/opt/hem/framework` (tarball without `.env` in `/home/zz/backups`) and delete it; delete the local `/Users/zztt/projects/hem/framework`; the user archives the GitHub repo.

## Testing
- Unit: `instance.ts`, manifest selection in the content scripts, tenant brand values (musiki unchanged, hem values), i18n `fr` parity report, `remark-language-blocks`.
- Build both instances locally (`MUSIKI_INSTANCE=hem npm run build:local` with the local vault) and render the home, a course page, the forum and login in French.
- Live: hem.zztt.org home/course/login 200 in French with the HEM logo; musiki.org.ar unchanged; so and mm unaffected.

## Out of scope
- Full French translation of the remaining engine UI (pods, editor, teacher dashboard, evals) — follow-up, screen by screen.
- A hem staging instance / dev process.
- Runtime multi-content in one process.
