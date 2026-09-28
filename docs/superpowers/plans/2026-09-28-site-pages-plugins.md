# Site Pages, Menu & Plugins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Edit so.zztt.org's public pages from the studio's `Site` folder; the Site tree becomes the header menu (folders = groups/submenus, `slug: index` = landing); plugins (`packages/*`) are embedded with ```` ```plugin name ```` blocks; saves trigger a debounced, atomic so-web rebuild.

**Architecture:** Engine (musiki framework, tenant so) exposes `GET /api/public/site` built by a pure `buildSiteModel`; so-web fetches it at `prebuild` (with last-good fallback), renders pages via `[...slug].astro`, menu via `SiteMenu.astro`, plugin blocks via a remark plugin that maps names to package components; a pm2 watcher rebuilds so-web when the engine touches a trigger file.

**Tech Stack:** Astro 6 (engine, SSR), Astro 5 static (so-web), Node 24 `node --test`, remark/unified, pm2, Caddy.

**Spec:** `docs/superpowers/specs/2026-09-25-site-pages-plugins-design.md`

**Repos:** engine `/Users/zztt/projects/26-musiki/framework` (branch `feat/site-pages`), so-web `/Users/zztt/projects/25-soweb/so-web` (branch `feat/site-pages`), plugin `/Users/zztt/projects/packages/zotero-graph` (new repo `zzigo/zotero-graph`).

## Global Constraints

- Site items are notes/folders under the root `Site` folder of the so space (`tenantId='so'`, `slug='dissertation'`). Only **effective visibility `public`** and frontmatter `draft !== true` are published.
- Nesting rule: a folder = menu group; its landing = note with `slug: index` inside (else its first page in tree order), path = folder path; other notes = submenu entries. First Site item = Home at `/`.
- Frontmatter keys: `slug?`, `menu?` (default true), `layout?` ∈ `page|home|blog|tags` (default `page`), `draft?` (default false), `description?`. Unknown keys ignored.
- Plugin block syntax: fenced code, info string `plugin <name>`, body = YAML options.
- The public endpoint never returns user ids, emails or non-public items. It is only reachable on the so tenant.
- A failed so-web build never replaces the live `dist`; a failed fetch keeps the last good `src/generated/site.json`.
- so-web's user has uncommitted changes in `src/components/zotero-graph.astro` and `public/research/zoterob.json`: **extract from the working copy; never discard or overwrite those changes; ask the user before committing them.**
- Pure modules: no astro/db imports; `.ts` relative imports; tests `node:test` + `node:assert/strict` `*.test.mjs`.
- Never `git add -A`, never `git stash`, never read `.env`. Remote shells are fish: upload scripts. Commits end with a blank line + `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

### Task 1: Pure site model (engine)

**Files:** Create `src/lib/site/site-model.ts`, `src/lib/site/frontmatter.ts`, tests `src/lib/site/site-model.test.mjs`; `package.json` test glob `"src/lib/site/*.test.mjs"`.

**Interfaces — Produces:**
- `parseFrontmatter(markdown: string): { data: SiteFrontmatter; body: string }` — YAML between leading `---` lines; `SiteFrontmatter = { slug?: string; menu?: boolean; layout?: 'page'|'home'|'blog'|'tags'; draft?: boolean; description?: string }`; invalid values dropped (e.g. unknown layout → undefined).
- `slugify(title: string): string` — lowercase, NFKD, strip diacritics, non-alnum → `-`, trim `-`, fallback `page`.
- `buildSiteModel(input: { siteFolderId: string; folders: SiteFolder[]; notes: SiteNote[] }): SiteModel` where items are already filtered to Site descendants with effective visibility `public` by the caller; `SiteNote = { id, folderId, title, body, position }`, `SiteFolder = { id, parentId, name, position }`.
- `SiteModel = { pages: SitePage[]; menu: MenuItem[] }`, `SitePage = { id, title, path, layout, description?, markdown }` (markdown = body without frontmatter), `MenuItem = { title, path, children: MenuItem[] }`.
Rules: ordering via the engine's tree model (`displayOrderFolders/displayOrderNotes` from `src/lib/writing/tree/model.ts`, locale 'en'); first item of Site root (folder or note) is Home: its path is `/` (if a folder, its landing gets `/`); drafts excluded; `menu:false` pages get a path but no menu entry; duplicate paths get `-2`, `-3` suffixes deterministically; empty folders (no publishable pages) omitted.

- [ ] Step 1: failing tests: slugify accents/punctuation; frontmatter parse (valid/invalid/absent); Home first (note and folder cases); folder landing by `slug: index` and by first page; nested paths `/research/m5live`; `menu:false`; draft excluded; duplicate slug suffixes; empty folder omitted; deterministic order with null positions.
- [ ] Step 2: implement; Step 3: tests green; Step 4: commit `feat(site): pure site model (pages, paths, menu) from the Site tree`.

### Task 2: Site folder bootstrap + public endpoint + rebuild trigger (engine)

**Files:** Modify `src/lib/writing/notes/space-notes-core.ts` (`ensureOkaFolders` also ensures root `Site`, visibility `public`, position after Output); create `src/lib/site/site-db.ts` (q-injected core `loadPublicSite(q, { tenantId })` that finds the so space, loads Site descendants, computes effective visibility with `effectiveVisibility`, calls `buildSiteModel`), `src/lib/site/rebuild.ts` (`requestSiteRebuild(): Promise<void>` touches `process.env.SO_REBUILD_TRIGGER ?? '/opt/so/.rebuild-requested'`, logs errors, never throws), route `src/pages/api/public/site.ts`, route `src/pages/api/studio/site/status.ts`; tenant config: add route family `'api:public'` (prefix `/api/public`) to so in `src/lib/tenant/tenants.ts` + `routes.ts`; call `requestSiteRebuild()` from space-notes mutations when the affected item is (or was) under Site (helper `isUnderSite(q, spaceId, folderId)`).

- `GET /api/public/site` → `{ generatedAt, pages, menu }`, `Cache-Control: public, max-age=60`; 404 on non-so tenants.
- `GET /api/studio/site/status` (author) → contents of `SO_BUILD_STATUS ?? '/opt/so/.last-build.json'` or `{ ok: null }`.
- [ ] Steps: fakeQuery tests for `loadPublicSite` (private/supervision/committee items excluded; draft excluded; no user fields in output) and for Site bootstrap idempotency; route sweep still green (musiki unaffected, `/api/public` only for so); commit `feat(site): Site folder, public site endpoint and rebuild trigger`.

### Task 3: Plugins registry (engine)

**Files:** Create `src/lib/site/plugins.ts` (`listPlugins(dir): Promise<PluginManifest[]>` reads `<dir>/*/manifest.json`, validates `{ name, description, targets: string[], options: Record<string,{type,default?,example?}> }`, keeps `targets` including `'so'`), route `src/pages/api/studio/plugins.ts` (author/supervisor: list), page `src/pages/studio/plugins.astro` (list with copyable block example built from option examples), i18n keys `studio.plugins.*` (en/es), sidebar link "Plugins".
- `PLUGINS_DIR` env, default `/opt/packages` (local dev: `../../packages` relative to repo, documented in `.env.example`).
- [ ] Steps: tests for manifest validation (bad JSON skipped with warning, targets filter); page renders without DB; commit `feat(studio): plugins registry and page`.

### Task 4: `zotero-graph` plugin package

**Files:** New repo `/Users/zztt/projects/packages/zotero-graph`: `package.json` (`"name": "@zztt/zotero-graph"`, `"type": "module"`, `"exports": { ".": "./Component.astro", "./manifest.json": "./manifest.json" }`, peerDependency `astro`), `manifest.json` (spec §3.3), `Component.astro` (extracted from so-web **working copy** `src/components/zotero-graph.astro`, props `src` (data URL, default `/research/zoterob.json`) and `height` (default 600); any hard-coded data path becomes the `src` prop), `README.md`.
- [ ] Steps: copy the working-copy component, parametrize; `git init`, commit; create GitHub repo `zzigo/zotero-graph` (private unless the user says otherwise) and push; do NOT modify so-web in this task; commit `feat: zotero-graph plugin`.

### Task 5: so-web consumes the site (pages, menu, plugins)

**Files (so-web):** `scripts/fetch-site.mjs` (+ `"prebuild": "node scripts/fetch-site.mjs"` in package.json), `src/generated/site.json` (committed fallback: current pages exported as fixture until migration), `src/lib/site.ts` (typed loader), `src/pages/[...slug].astro` (static paths from site.json excluding paths owned by explicit files; layouts page/home/blog/tags), `src/components/SiteMenu.astro` (menu with disclosure submenus, keyboard + mobile, same look as current `Navigation.astro`), modify `src/components/Navigation.astro` to render `SiteMenu` when site.json has a menu else current `navItems` (safe fallback), `src/lib/remark-plugin-blocks.mjs` (code nodes `lang=plugin` → MDX/Astro component via a name→component map `src/plugins.ts` importing `@zztt/zotero-graph`; unknown plugin → dev notice / prod comment), `package.json` dependency `"@zztt/zotero-graph": "file:../../packages/zotero-graph"` (VPS path documented: `/opt/packages/zotero-graph`), tests via `node --test` for fetch fallback and block parsing (`scripts/*.test.mjs`).
- [ ] Steps: fetch with 10 s timeout and shape validation; on failure keep file and warn (exit 1 only if no file); build locally with a fixture site.json containing nested menu + a plugin block; browser-check desktop/mobile, both themes; commit `feat(site): pages, menu and plugin blocks from the studio`.

### Task 6: Rebuild watcher (so-web, VPS)

**Files (so-web):** `scripts/vps/so-rebuild-watcher.sh`, `ecosystem.config.cjs` (pm2 app `so-rebuild`), `scripts/vps/README.md`.
Behavior: loop every 5 s; when `.rebuild-requested` exists and its mtime is ≥30 s old → remove it; `git pull --ff-only`; `npm ci` if lockfile changed; build into `dist-next` (`astro build --outDir dist-next`); on success `mv dist dist-prev` (replace old dist-prev) and `mv dist-next dist`; write `.last-build.json` `{ ok, finishedAt, commit, error? }`; on failure keep `dist`, write error. `--dry-run` flag prints actions without swapping.
- [ ] Steps: shellcheck-clean script; dry-run locally with a temp dir; commit `ops: so-web rebuild watcher`.

### Task 7: One-time migration of current pages (engine script)

**Files:** `scripts/migrate-site-pages.mjs` (engine): reads a JSON manifest prepared from so-web (`scripts/site-migration.json`: `[{ title, parent?, frontmatter, markdownFile }]`), creates Site folders/notes in order via the space-notes core (author identity from `--author-email`), idempotent (skips existing by slug path), `--dry-run`.
- Prepare `site-migration.json` in so-web from `src/pages/index.astro`, `about.astro`, `cv.astro`, `tools.astro`, `research.astro` + `src/content/research/*`, blog (layout blog), tags (layout tags); `.astro`-only content transcribed by hand; zotero graph → ```` ```plugin zotero-graph ```` block.
- [ ] Steps: dry-run on staging → run on staging → user reviews in studio → run on prod (Task 8).

### Task 8: Rollout (ops — confirm with user before remote writes)

- [ ] Engine: merge `feat/site-pages`, deploy; verify `/api/public/site` on so (and 404 on musiki).
- [ ] VPS: clone `zzigo/zotero-graph` into `/opt/packages/zotero-graph`; set `PLUGINS_DIR=/opt/packages` in engine env; so-web: merge, pull on VPS, `npm ci`, build; start pm2 `so-rebuild`; `SO_REBUILD_TRIGGER` path writable by the engine user (zz).
- [ ] Migration (Task 7) on prod after staging review.
- [ ] Verify: edit a Site page in the studio → within ~1 min the live page changes; menu/submenus desktop+mobile; plugin renders; failed build leaves site up.
