# SOOG / MOAIE Dashboard Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `soog-dashboard` plugin (MOAIE radar + interface profile + instrument registry) fed live from case-instrument notes in the so studio, embeddable in so Site pages and in the left sidebar of musiki's i1/i2 course pages.

**Architecture:** Instruments are studio notes under the so space's `Cases` folder (Obsidian frontmatter kept verbatim). A pure projection whitelists frontmatter fields; `GET /api/public/instruments` (so + musiki hosts) serves them. The package's core is a framework-free custom element `<soog-dashboard>`; so-web embeds it through an Astro wrapper, musiki through a committed vendored copy.

**Tech Stack:** Astro 6 SSR engine, Astro 5 static so-web, Node 24 `node --test`, gray-matter, Chart.js 4.4.4 (jsdelivr), pg.

**Spec:** `docs/superpowers/specs/2026-09-28-soog-dashboard-design.md`

**Repos:** engine `/Users/zztt/projects/26-musiki/framework` (branch `feat/soog-dashboard`, worktree recommended), so-web `/Users/zztt/projects/25-soweb/so-web` (branch `feat/soog-dashboard`), package `/Users/zztt/projects/packages/soog-dashboard` (new repo `zzigo/soog-dashboard`, private). Vault (read-only): `<vault>/03-thesis/cases/case instruments` and `.../case instruments fictional`; original dashboard `.../03-thesis/03-soog/soog-dashboard.md` (first dataviewjs block).

## Global Constraints

- Endpoint output = whitelist only (spec §2 shape). Note bodies, ids of users, emails never leave the studio.
- Instrument appears only when effective visibility is `public` and frontmatter `type: instrument`.
- Endpoint reachable on so and musiki hosts, 404 on mm; `Cache-Control: no-store`.
- `src` option/attribute: same-origin absolute path only (starts with `/`, not `//`); otherwise refuse and show an error.
- Chart.js pinned `https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js`, loaded once per page.
- Accessible: chips are `<button aria-pressed>`, a table view exists for the radar data, dialog uses `<dialog>` with focus return.
- musiki courses with the widget: exactly `['i1','i2']` (module constant).
- Pure modules: no astro/db imports; `.ts` imports; tests `*.test.mjs` registered in package.json globs.
- Never `git add -A`, never `git stash`, never read `.env`. Remote shells fish → upload scripts. Commits end with blank line + `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

### Task 1: Projection + import plan (engine, pure)
**Files:** `src/lib/instruments/projection.ts`, `src/lib/instruments/import-plan.ts`, tests `src/lib/instruments/*.test.mjs`; package.json test glob `"src/lib/instruments/*.test.mjs"`.
- `projectInstrument(note: {id,title,body}, opts?: {fictional?: boolean}): PublicInstrument | null` per spec §2 (wikilink reduction `[[X]]`, `[[X|Y]]`→`Y`? use target name `X`; vector exactly 5 finite numbers else null; `moaie.empty` when all zeros; https-only `img`/`url`; `title` from frontmatter `title` if non-empty string else note title).
- `cleanTemplater(markdown): string` replaces `<% ... %>` in frontmatter values with today's ISO date (injected `today`).
- `planInstrumentImport(files: {folder:'Instruments'|'Instruments (fictional)'; name; markdown}[], existing: {folder,title}[]): Step[]` — skip non-instrument (`type` ≠ `instrument`), skip existing (folder,title), note title = file name without `.md`.
- [ ] TDD incl. a test that a body sentence never appears in `JSON.stringify(projectInstrument(...))`; commit `feat(instruments): projection and import plan`.

### Task 2: Endpoint (engine)
**Files:** `src/lib/instruments/instruments-db.ts` (q-injected `loadPublicInstruments(q)`: so space slug `dissertation`, root folder `Cases`, descendants, `effectiveVisibility` from `src/lib/writing/notes/visibility.ts`, fictional = inside a folder whose name contains `fictional` (case-insensitive)), route `src/pages/api/public/instruments.ts`; tenant routing: so already has `api:public`; musiki default tenant must reach it; mm must not (check `src/lib/tenant/routes.ts`/`tenants.ts` and add tests in `routes.test.mjs`).
- [ ] fakeQuery tests (private note excluded, note outside Cases excluded, non-instrument excluded, fictional flag); route sweep tests; commit `feat(instruments): public instruments endpoint`.

### Task 3: Import script (engine)
**Files:** `scripts/import-case-instruments.mjs` (pattern of `scripts/migrate-site-pages.mjs`: own pg Pool, lazy .env only when DATABASE_URL missing, `--vault <cases dir>`, `--author-email`, `--dry-run`, `--help`; creates `Cases` root folder with explicit visibility `public` and the two subfolders with inherited visibility; uses the space-notes core with injected q; author must be `author` member of the so space). No rebuild trigger.
- [ ] `--help` and a dry-run against the local vault path printing the plan (no DB: dry-run must be able to run with `--vault` only when `--offline` is passed, printing the file-level plan); commit `feat(instruments): case-instruments import script`.

### Task 4: Package `soog-dashboard`
**Files (new repo):** `package.json` (`@zztt/soog-dashboard`, `type: module`, exports `.`→`./Component.astro`, `./element`→`./soog-dashboard.js`, `./manifest.json`; peer astro optional), `manifest.json` (spec §4 options + `targets: ["so","musiki"]`), `soog-dashboard.js` (custom element, version constant `SOOG_DASHBOARD_VERSION = '0.1.0'` in a header comment + export), `Component.astro` (wrapper), `README.md`, `test/*.test.mjs` (jsdom: renders chips from a fake fetch, same-origin guard, compact mode renders dialog trigger, error state). Port visuals/logic from the Obsidian first dataviewjs block (palette, axis labels, profile labels, radar options, DEFAULT_N) — no Obsidian APIs.
- [ ] Tests green; `git init`, commit `feat: soog-dashboard plugin`; create private GitHub repo `zzigo/soog-dashboard` and push.

### Task 5: so-web integration
**Files (so-web):** register `soog-dashboard` in `src/plugins.json`/`src/plugins.ts` like `zotero-graph`; package.json `"@zztt/soog-dashboard": "file:plugins/soog-dashboard"` (same mechanism as zotero-graph via `scripts/link-plugins.mjs`); tests for the plugin-block mapping.
- [ ] `npm run build` with a fixture site.json containing a ```` ```plugin soog-dashboard ```` block; browser-check with a fake `/api/public/instruments` JSON (desktop/mobile, both themes); commit `feat(site): soog-dashboard plugin`.

### Task 6: musiki integration
**Files (engine):** `scripts/vendor-soog-dashboard.mjs` (copy from `PLUGINS_DIR`/`../packages`), `public/vendor/soog-dashboard/soog-dashboard.js` (committed), `src/lib/instruments/courses.ts` (`SOOG_DASHBOARD_COURSES = ['i1','i2']`, `showsSoogDashboard(courseId)`), course page `src/pages/[...slug].astro` left sidebar (below the course contents list) renders `<soog-dashboard mode="compact" src="/api/public/instruments">` + module script, only when `showsSoogDashboard(canonicalCourseId || courseSlug)`; test for `showsSoogDashboard` and that the vendored file has the version header.
- [ ] Browser-check i1 course page (compact + dialog) and a non-i1/i2 course (absent); commit `feat(musiki): soog dashboard in i1/i2 course sidebar`.

### Task 7: Rollout (ops — confirm with the user before remote writes)
- [ ] Merge + deploy engine; clone `zzigo/soog-dashboard` into `/opt/packages/soog-dashboard`.
- [ ] Import: dry-run + run on staging (seed author `author@example.org`), then prod (user runs the uploaded script; backup first).
- [ ] so-web merge/push, touch rebuild trigger; the user adds a Site page (e.g. Research → "MOAIE dashboard") with the block.
- [ ] Verify endpoint on so and musiki (and 404 on mm), dashboard on so page, compact widget on i1/i2.
