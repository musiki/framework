# SOOG / MOAIE dashboard plugin (sub-project E) — design

Status: approved by the user on 2026-09-28 (scope, data source and access decisions below).

## Goal

Port the MOAIE part of the Obsidian `soog-dashboard.md` (block 1: instrument registry, MOAIE radar, interface-profile radar, instrument details) into a reusable plugin package that runs in **so.zztt.org** (as a `plugin soog-dashboard` block in Site pages) and in **musiki** (left sidebar of the i1 and i2 course pages, above or below the contents list). Blocks 2–3 of the Obsidian dashboard (grammar/productions, onto-lab) are out of scope.

## Decisions

- **Source of truth = studio notes.** The 71 case instruments (`03-thesis/cases/case instruments`) and 19 fictional ones (`case instruments fictional`) are imported once into the so studio under a root folder `Cases`, subfolders `Instruments` and `Instruments (fictional)`. Notes keep their Obsidian frontmatter verbatim (Templater leftovers like `<% tp.date.now(...) %>` are replaced by the import date). From then on they are edited online.
- **Everything public for now.** Radars and numbers are visible to anonymous visitors. The endpoint is designed so a later "numbers only for signed-in users" tier is a small change (one flag in the projection).
- **Visibility switch.** An instrument appears only if its effective visibility (existing `effectiveVisibility`) is `public`. `Cases` is created with explicit visibility `public`; hiding a note or subfolder removes it from the dashboard.
- **Bodies never leave the studio.** The endpoint returns a fixed whitelist of frontmatter fields only.
- **Live data, no rebuild.** The component fetches the endpoint in the browser, so studio edits show immediately on so and musiki.
- **Room pod later.** In the live class room the dashboard will become a pod; not now.

## Components

### 1. Import script (engine) `scripts/import-case-instruments.mjs`
Same shape as `scripts/migrate-site-pages.mjs`: own `pg.Pool`, `--vault <dir>`, `--author-email`, `--dry-run`, idempotent by (folder, title), uses the space-notes core (`ensureOkaFolders`, `createSpaceFolder`, `createSpaceNote`) with an injected q. Pure planning in `src/lib/instruments/import-plan.ts` (tested). Only files whose frontmatter has `type: instrument` are imported; others are listed as skipped.

### 2. Pure projection `src/lib/instruments/projection.ts`
`projectInstrument(note: { id, title, body }): PublicInstrument | null` — parses frontmatter with gray-matter; returns null unless `type === 'instrument'`. Output:
```
{ id, title, year?, family?, layer?, sachsHornbostel?, authors: string[], person?, url?, img?,
  fictional: boolean,
  moaie: { vector: [M,O,A,I,E] | null, text: { M?,O?,A?,I?,E? }, recursive: boolean },
  profile: Record<'affordance'|'liveness'|'playability'|'learnability'|'situatedness'|'mediality'|'mapping'|'sensorimotor_scheme'|'ergonomics'|'expressivity', number> | null,
  connect: string[], hyper: string[] }
```
Wikilinks `[[X]]` / `[[X|Y]]` reduced to names (`nm()` of the Obsidian script). Vector kept only when exactly 5 finite numbers; all-zero vectors are kept but flagged (`moaie.empty = true`) so the UI can list them as "not yet scored". `img`/`url` kept only when `https:`. Nothing else from the note leaves.

### 3. Endpoint `GET /api/public/instruments` (engine)
Loads notes under the so space's `Cases` root folder (tenant `so`, space slug `dissertation`), filters by effective visibility `public`, maps through `projectInstrument`, sorts by title (locale `en`). Response `{ generatedAt, instruments }`, `Cache-Control: no-store`. Reachable on **so and musiki** hosts (musiki: default tenant; so: add to the `api:public` family already present). Not reachable on mm. q-injected core `loadPublicInstruments(q)` tested with fakeQuery.

### 4. Package `/Users/zztt/projects/packages/soog-dashboard` (`@zztt/soog-dashboard`, repo `zzigo/soog-dashboard`, private)
- `manifest.json`: `name: soog-dashboard`, `targets: ["so", "musiki"]`, options `src` (default `/api/public/instruments`, same-origin path only), `title` (default "MOAIE dashboard"), `initial` (number of preselected instruments, default 4), `mode` (`full` | `compact`, default `full`).
- Core = framework-free custom element `<soog-dashboard>` in `soog-dashboard.js` (ESM, no build step, attributes `src`, `title`, `initial`, `mode`). `Component.astro` is a thin wrapper for Astro hosts (renders the element + `<noscript>` + the module script). The element fetches `src` and renders:
  - `full`: stat cards (instruments, scored, fictional), toggle chips per instrument (keyboard accessible, `aria-pressed`), MOAIE radar + interface-profile radar (Chart.js pinned `chart.js@4.4.4` from jsdelivr, loaded once per page), details panel for the last selected instrument (image, year, family, authors, MOAIE texts), and an accessible `<table>` view of the selected vectors (toggle "Table").
  - `compact` (sidebar): small MOAIE radar of the preselected instruments + instrument count + button "Open dashboard" that opens the `full` view in a `<dialog>`.
- Theming via CSS custom properties with fallbacks that read the host tokens (`--so-fg/--so-bg/--so-border` on so, `--c-text/--c-border` on musiki). Palette from the Obsidian script. Per-instance scoping (multiple instances per page), like zotero-graph.
- Errors: fetch failure → visible message in the component, never breaks the page.

### 5. Hosts
- **so-web:** add `soog-dashboard` to the plugin map (`src/plugins.ts`/`plugins.json`) and to `link-plugins`. The author embeds it in a Site page, e.g. a new note under Research: ```` ```plugin soog-dashboard ```` .
- **musiki:** the engine is built on the CI runner, where `/opt/packages` is not available, so it **vendors** the element: `scripts/vendor-soog-dashboard.mjs` copies `soog-dashboard.js` (+ its version) from `PLUGINS_DIR` into `public/vendor/soog-dashboard/`, and the copy is committed (a test checks the vendored file carries a version header). The course page (`src/pages/[...slug].astro`) renders `<soog-dashboard mode="compact">` + `<script type="module" src="/vendor/soog-dashboard/soog-dashboard.js">` in the **left sidebar** for courses whose canonical id is `i1` or `i2` (config list `SOOG_DASHBOARD_COURSES = ['i1','i2']` in a small module), placed below the course contents list. Hidden in public-reader mode only if the sidebar itself is hidden.

## Testing
- Unit: projection (wikilinks, invalid vectors, https filter, fictional flag, whitelist — body text never present), import plan (idempotency, type filter, Templater cleanup), `loadPublicInstruments` (visibility filter, non-Cases notes excluded).
- Browser: so page with the block (desktop/mobile, light/dark); musiki i1 course page sidebar compact + dialog; i3/other course has no widget.

## Out of scope / later
Signed-in numeric tier; room pod; blocks 2–3; editing instruments through a structured form; shared musical-instrument dataset with musiki.
