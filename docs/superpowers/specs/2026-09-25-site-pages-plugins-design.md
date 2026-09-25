# Site Pages, Menu & Plugins (so sub-project D) — Design

**Date:** 2026-09-25
**Status:** Approved design, pending implementation plan
**Depends on:** Tenant layer, Studio workspace & editor (deployed: space notes, visibility, shared tree, manual ordering, editor)

---

## 1. Goal

Edit so.zztt.org's public pages (Home, Research, Blog, Tools, CV, About, Tags, …) from the studio. Every page of the **Site** tree appears in the header menu; nesting creates submenus. Custom components (Zotero graph, MOAIE/soog dashboard, Seshat connector, …) become **plugins** implemented as shared `packages/*` and embedded in pages with an Obsidian-compatible block. so-web stays a static site.

## 2. Decisions

| Topic | Decision |
|---|---|
| Storage | Pages are notes in a root **`Site`** folder of the author's space (created by `ensureOkaFolders` alongside GTX/Output), visibility `public`. |
| Menu | Menu = `buildTree(Site)` in manual order; child pages/folders = submenus. First page of the tree = Home (`/`). |
| URLs | Path from the tree: `/<parent-slug>/<slug>`; `slug` from frontmatter or slugified title. |
| Page frontmatter | `slug?`, `menu?: boolean` (default true), `layout?: 'page' \| 'home' \| 'blog' \| 'tags'` (default `page`), `draft?: boolean` (default false), `description?`. |
| Plugins (UX) | Studio section **Plugins** lists installed plugins (manifest: name, description, options, examples, targets). |
| Plugins (code) | `packages/<name>/` with `manifest.json` + `Component.astro`; importable by so-web (and later musiki). First: `zotero-graph`. |
| Embedding | Fenced block ```` ```plugin <name> ```` with YAML options inside; editor preview shows a placeholder card; so-web renders the component at build. |
| Publishing | Save of a Site page → rebuild trigger; watcher debounces 30 s, builds to `dist-next`, atomic swap, keeps previous `dist`. |
| Build input | so-web fetches `GET /api/public/site` at build; on failure uses the last good `src/generated/site.json` (build never breaks). |

Out of scope: MOAIE dashboard and Seshat connector packages (next, using the same plugin contract), musiki consuming plugins, public (unauthenticated) editing, per-page SEO beyond `description`.

## 3. Architecture

```
engine (musiki framework, tenant so)             so-web (static)                      packages/
GET /api/public/site  ───────────── build ───▶  scripts/fetch-site.mjs          ───▶ zotero-graph/{manifest.json, Component.astro, data?}
  (no auth; Site folder, effective                → src/generated/site.json
   visibility public, draft excluded)            src/pages/[...slug].astro (page + layout)
save Site page → touch /opt/so/.rebuild-requested src/components/SiteMenu.astro (tree → menu/submenus)
                                                  remark-plugin-blocks (```plugin name``` → component)
so-rebuild watcher (pm2): debounce 30s → git pull → npm run build (out: dist-next) → mv dist dist-prev; mv dist-next dist
```

### 3.1 Engine
- **Site folder**: `ensureOkaFolders` also ensures root folder `Site` (visibility `public`, position after Output).
- **Public endpoint** `GET /api/public/site` (route family `api:public` = prefix `/api/public`, added to the so tenant allowlist; musiki unaffected):
  - Resolves the so tenant's dissertation space (single space for now: the one with `slug = 'dissertation'`; configurable later).
  - Returns `{ generatedAt, pages: [{ id, parentId, title, slug, path, menu, layout, description, position, markdown }], menu: <nested tree of pages with menu !== false> }`, including only notes/folders under `Site` whose **effective visibility is `public`** and `draft !== true`. Folders under Site act as menu groups (their own page if a note with the same title/slug exists? — no: a folder is a pure group; a page with children is a note whose children are notes inside a same-named folder is NOT used; nesting = folders). Rule: **a folder = menu group (label only, first child page is its landing)**; **a note = page**.
  - Cache-Control: `public, max-age=60`. No session, no user data (no author ids/emails).
- **Rebuild trigger**: on create/update/delete/reorder/visibility change of any item under Site, the space-notes service calls `requestSiteRebuild()` which touches `SO_REBUILD_TRIGGER` (env, default `/opt/so/.rebuild-requested`); errors are logged, never fail the save.
- **Publish status**: `GET /api/studio/site/status` (author) reads `/opt/so/.last-build.json` written by the watcher (`{ ok, finishedAt, commit, error? }`).
- **Plugins section**: `GET /api/studio/plugins` reads `PLUGINS_DIR` (default `/opt/packages`, locally `../packages`), returns manifests of packages whose `targets` include `so`; page `/studio/plugins` lists them with copyable block examples.

### 3.2 so-web
- `scripts/fetch-site.mjs` (run by `prebuild`): fetch `SITE_API_URL` (default `https://so.zztt.org/api/public/site`) with timeout 10 s; validate shape; write `src/generated/site.json`; on any failure keep the existing file and warn (non-zero only if no file exists at all).
- `src/pages/[...slug].astro`: static paths from `site.json`; renders markdown with the site's existing typography and the page `layout`.
- `SiteMenu.astro`: header menu from `site.json.menu` with accessible submenus (disclosure buttons, keyboard, mobile), replacing the hard-coded `navItems` in `Navigation.astro`.
- `remark-plugin-blocks`: code blocks with lang `plugin` and meta `<name>` → MDX/Astro component from the package, options parsed as YAML; unknown plugin → visible notice in dev, silent `<!-- -->` in prod.
- Existing hand-written pages keep working until migrated; route precedence: explicit files win over `[...slug]` until removed after migration.

### 3.3 packages
- `packages/zotero-graph/`: extracted from so-web `src/components/zotero-graph.astro` (+ data `public/research/zoterob.json` passed via option `src`), `manifest.json`:
  ```json
  { "name": "zotero-graph", "description": "Interactive graph of a Zotero collection",
    "targets": ["so"], "options": { "src": { "type": "string", "example": "/research/zoterob.json" },
    "height": { "type": "number", "default": 600 } } }
  ```
- Consumed by so-web via `"@zztt/zotero-graph": "file:../packages/zotero-graph"` (VPS: `/opt/packages/zotero-graph`, repo path `projects/packages/zotero-graph`).

### 3.4 Watcher (VPS)
- `scripts/vps/so-rebuild-watcher.sh` in so-web (pm2 app `so-rebuild`): loop every 5 s; if trigger exists and is older than 30 s since last touch → remove trigger, `git pull --ff-only`, `npm ci` if lockfile changed, `npm run build -- --outDir dist-next`, then atomic swap (`dist` → `dist-prev`, `dist-next` → `dist`), write `.last-build.json`. On failure keep `dist`, write error.

### 3.5 Migration (one-time)
- Script `scripts/migrate-site-pages.mjs` (engine, run on staging then prod with approval): creates Site pages from so-web content: `index.mdx` → Home (`layout: home`), `about`, `cv`, `tools`, research overview/project pages from `src/content/*` markdown, blog stays `layout: blog` (lists existing posts), tags `layout: tags`. `.astro`-only content is migrated by hand; the Zotero component becomes a ```` ```plugin zotero-graph ```` block.

## 4. Testing
- Pure: site tree → pages/paths/menu (`buildSiteModel(folders, notes)`): slugs, nesting → paths, Home first, `menu:false`, drafts and non-public excluded, duplicate slug handling (suffix `-2`).
- Pure: frontmatter parse/validation; plugin block parser (name + YAML options, errors).
- Engine: `/api/public/site` returns only public Site items, no user fields; route sweep includes `api:public`; rebuild trigger called on Site mutations only.
- so-web: `fetch-site` fallback (network error keeps last file); build with a fixture `site.json` renders nested menu and a plugin block.
- Watcher: dry-run mode test (no swap on failed build).

## 5. Rollout
1. Engine changes → staging → prod (no migration needed beyond folder creation by `ensureOkaFolders`).
2. packages/zotero-graph + so-web changes; build locally with fixture; deploy so-web; start `so-rebuild` watcher.
3. Run migration script on staging, review pages in studio, then prod; verify menu/submenus desktop+mobile, both themes, plugin renders.
