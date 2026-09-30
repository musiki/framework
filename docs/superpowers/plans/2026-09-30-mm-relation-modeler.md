# mm Relation Modeler Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Relation types become first-class, space-wide vocabulary in mm: definable and discussable like concepts, visually encoded as lines or areas from the MishMash palette, logically characterised (symmetric / transitive / hierarchical) with inferred relations, agreement by blind-then-revealed stances, and a timeline that replays emergence.

**Architecture:** New `RelationType` rows (each linked 1:1 to a `Concept` of kind `relation-type` for definition/thread/versions), `ConceptRelation.typeId` + provenance + settle state, `ConceptRelationStance`. Pure q-injected cores under `src/lib/mm/`, thin `mmRoute` APIs, graph page with a modeler table (legend + filter + curator forms), D3 rendering of lines/areas/inferred/agreement, timeline slider.

**Tech Stack:** Astro 6 SSR engine, Postgres, Node 24 `node --test`, d3-force/selection/drag/zoom (+ `d3-polygon` for hulls, bundled), brand tokens in `src/styles/mm-brand.css`.

**Spec:** `docs/superpowers/specs/2026-09-30-mm-relation-modeler-design.md`

## Global Constraints

- Design golden rule: flat (no gradients, shadows, rounded corners); colours ONLY palette slots `green|purple|blue|pink|yellow|red|ink` mapped to `--mm-*` tokens and their tints; every type distinguishable without colour (colour + stroke/area pattern); text on tints is ink.
- Relation types: space-wide; create/edit/archive/reorder = curator or admin (`manageRelationTypes`); built-ins (derives, combines, contrasts, reformulates, exemplifies) editable but never deletable; archive instead of delete when in use.
- Stances: blind then revealed. Before reveal NO role and NO API path returns who voted what (only totals + the caller's own stance); reveal at `settledAt` or `createdAt + stanceRevealDays` (space setting, default 14); after reveal names go to members only, public sees totals; withdrawn-before-reveal leaves no trace; enforcement in SQL.
- Inference is computed, never stored, never votable; bounded depth (≤ 6) and cycle-safe. `hierarchical` types reject relations that close a cycle (409).
- No emails or user ids in public payloads/exports (display names only, `publicName` rules). All HTML via the sanitized mm renderer; client DOM via textContent.
- Every route through `mmRoute` (tenant mm, CSRF, rate limits, isUuid). musiki/so unaffected.
- Pure modules: no astro/db imports; `.ts` imports; tests `*.test.mjs` under `src/lib/mm/` (glob already registered).
- Never `git add -A`, never `git stash`, never read `.env`; commits end with blank line + `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

Branch: `feat/mm-relation-modeler` (worktree `/Users/zztt/projects/26-musiki/framework-mm-rel`).

---

### Task 1: Migration
**Files:** `postgres-patches/migrations/20260930120000_mm_relation_modeler.sql` (idempotent, BEGIN/COMMIT, owner→app guards like `20260929090100_mm_followup.sql`).
Contents per spec "Data model": `Concept.kind` text NOT NULL DEFAULT 'concept' CHECK; `RelationType` table (+ unique (spaceId, slug), enum CHECKs for render/stroke/color); `ConceptRelation` adds `typeId` uuid FK RelationType, `fromPostId` FK ForumPost ON DELETE SET NULL, `settledAt`, `settledBy` FK User ON DELETE SET NULL; `ConceptRelationStance`; seed built-in types for every existing commons space (each with its `Concept` row of kind relation-type + v1 English definition) and backfill `typeId` from the existing `type` strings; keep `type` column (synced by the app) for one release. Read the current `ConceptRelation` DDL in `20260929090000_mm_concepts_forum_spaces.sql` first (existing `type` CHECK and unique (sourceId,targetId,type) — replace uniqueness with (sourceId,targetId,typeId)).
- [ ] Write; commit `feat(db): mm relation modeler schema`. (Controller applies to staging twice, then prod.)

### Task 2: Relation types core + policy
**Files:** `src/lib/mm/policy.ts` (+ action `manageRelationTypes` curator/admin; `stance` member+; `settleRelation` curator/admin; tests), `src/lib/mm/relation-types-core.ts` + test, `src/lib/mm/relation-types.ts` (db-bound).
Functions: `listRelationTypes(spaceId, {includeArchived})`, `getRelationType(spaceId, slug)` (with definition versions via concepts-core reuse), `createRelationType` (creates the kind=relation-type Concept + thread + v1 en definition in one transaction; slug unique; validates palette/stroke/render; `area` requires `hierarchical`), `updateRelationType`, `archiveRelationType` (built-ins: archive refused), `reorderRelationTypes`. Concept lists/graph nodes must exclude kind=relation-type (update concepts-core queries + tests).
- [ ] TDD; commit `feat(mm): relation types core`.

### Task 3: Relations core — types, provenance, inference, stances
**Files:** `src/lib/mm/relations-core.ts` + test (move/extend relation logic out of concepts-core where sensible; keep concepts-core exports working), `src/lib/mm/inference.ts` + test (pure: `inferRelations(relations, types, {maxDepth: 6})`, `wouldCloseCycle`), `src/lib/mm/stances-core.ts` + test.
Relations: create by `typeSlug` (+ optional `fromPostId` in the same space), hierarchical cycle rejection (409), symmetric dedupe (A–B == B–A), delete rules as today. Stances: `setStance(relationId, userId, stance|null)`, `settleRelation`, `getRelationView(relationId, viewer)` → totals, own stance, revealAt, revealed, names only if revealed and viewer is a member (SQL-enforced), `afterReveal` flag. `graph()` payload gains relationTypes, per-edge type/inferred/agree/disagree/createdAt/settled, per-node createdAt.
- [ ] TDD incl. "admin cannot see names before reveal", "withdrawn stance leaves no row", auto-reveal by date; commit `feat(mm): typed relations, inference and blind-then-revealed stances`.

### Task 4: APIs + export
**Files:** `src/pages/api/mm/relation-types.ts` (GET public, POST curator, PUT order), `relation-types/[slug].ts` (GET, PATCH), `relations.ts` (POST with typeSlug/fromPostId), `relations/[id].ts` (GET view, DELETE), `relations/[id]/stance.ts`, `relations/[id]/settle.ts`, `graph.ts` (extended), `src/lib/mm/export-core.ts` (+ `relation_types`), admin settings `stanceRevealDays` (1–90) in `admin/settings.ts`. Tests for wrappers/export shape (no ids/emails; no stance names).
- [ ] Commit `feat(mm): relation modeler APIs and export`.

### Task 5: Modeler table, forms, relation-type page
**Files:** `src/pages/mm-app/graph.astro` (modeler table as legend/filter; "Add relation +" for curators), `src/components/mm/MmRelationTypeForm.astro`, `src/pages/mm-app/r/[slug].astro` (definition via sanitized renderer, versions, thread link, usage count, visual sample), `src/scripts/mm/relation-types.ts`, tenant URL mapping for `/r` (`src/lib/tenant/routes.ts` mapMmPath + tests + Caddy note for rollout), i18n en + nb (draft), styles. SVG samples of each encoding in the table. Accessible forms; palette as radio swatches with names.
- [ ] Browser check (harness); commit `feat(mm): relation modeler table, forms and type pages`.

### Task 6: Graph rendering
**Files:** `src/scripts/mm/graph.ts`, `src/lib/mm/graph-layout.ts` (+ tests: hull with padding/straight edges, stroke pattern map, agreement→width, contested rule), styles. Lines by type (colour + dash + arrow + double), areas as hulls with tint fill and members attracted, inferred edges faint, agreement width / contested pattern + square marker, relation card (sentence, proposer, origin post link, totals, own stance, agree/disagree buttons, reveal date text, names after reveal), filter by type from the table, add `d3-polygon` dependency.
- [ ] Browser check desktop + 375px; commit `feat(mm): typed relation rendering, areas, inference and agreement`.

### Task 7: Timeline
**Files:** `src/scripts/mm/graph.ts` + `src/lib/mm/graph-layout.ts` (`visibleAt(items, date)` + test), graph page controls (range slider, play/pause, date label; keyboard operable; reduced motion → no autoplay animation), i18n.
- [ ] Commit `feat(mm): emergence timeline on the graph`.

### Task 8: Rollout (ops — controller)
- [ ] Migration → staging twice → prod (backup first).
- [ ] Merge + deploy; Caddy `mm.zztt.org` allowlist: add `/r /r/*`.
- [ ] Verify built-in types, add `contains` (area), relation + stance + settle flow, graph, export.
