# Studio UX + so publishing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** fix seven issues the user reported on so.zztt.org (2026-10-05): studio tree hierarchy/search/fold-all, YAML frontmatter styling, trace panel overlap, blog from the studio Site tree, and publishing that never fires while editing.

**Design (approved by the user in chat, 2026-10-05):**
1. Tree: live search/filter input on top of the sidebar tree (matches shown with their ancestor folders expanded, match highlighted, Esc clears); a fold-all / unfold-all toggle button with the `<>` glyph rotated 90° (`aria-label` + title, state reflected with `aria-pressed`).
2. Tree hierarchy: indentation per depth (≈14px per level) with a faint vertical guide line; items inside folders at 0.9em font size (top-level unchanged).
3. (search = item 1)
4. YAML frontmatter in the editor: monospace, same size as body text, YAML syntax highlighting (keys, values, strings, numbers/dates, comments); `---` delimiters dim, never bold or a different size.
5. Trace panel: one block per paragraph, vertical scrolling, nothing overlaps; the analysis-level header of a block is sticky at the top while that block scrolls.
6. so-web Blog: posts are the Site notes inside the Blog section (folder); listed newest first by frontmatter `date` (else note creation date); post pages rendered by the Site page route; Tags built from those notes' frontmatter `tags`; remove the repo's explicit `src/pages/blog/[slug].astro` and the three placeholder posts (`first-post`, `second-post`, `third-post` — user: delete).
7. Publishing: the so-rebuild watcher builds at most **120 s** after the first unprocessed save even if saves continue (still coalescing bursts with the existing 30 s quiet period otherwise); it writes a status file; the studio editor toolbar shows "Publishing…" / "Published HH:MM" (or "Publish failed").

## Global Constraints
- The editor (`src/scripts/notas/personal-notes-workspace*`) and tree (`src/lib/writing/tree/*`) are shared with musiki's notes editor/sidebar: changes must work for both; musiki's behaviour may improve but nothing may break (existing tests green).
- Studio UI strings via `t(locale, key)` with en/es/fr keys (so is English); client scripts get strings through data-* or existing label blobs, never by importing dictionaries.
- so-web public site stays static; no new runtime dependencies on the public side.
- Status file path: `/opt/so/.rebuild-status.json` (engine env `SO_REBUILD_STATUS`, watcher writes it atomically: temp file + rename). Shape: `{ "state": "idle"|"pending"|"building"|"published"|"failed", "requestedAt": ISO|null, "startedAt": ISO|null, "publishedAt": ISO|null, "commit": string|null, "release": string|null }`.
- Never read `.env`; never `git add -A`; never `git stash`; don't stage `.superpowers/`; commits end with a blank line + `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Engine worktree `/Users/zztt/projects/26-musiki/framework-sux` (branch `feat/studio-ux`); so-web worktree `/Users/zztt/projects/25-soweb/so-web-blog` (branch `feat/blog-from-site`). node_modules symlinked in both.

---

### Task 1 (engine): tree search, fold-all, hierarchy
**Files:** `src/lib/writing/tree/{model.ts,render.ts,tree.css}` (+ tests), `src/scripts/studio/workspace.ts`, `src/layouts/StudioLayout.astro`, i18n en/es/fr keys (`studio.tree.search`, `studio.tree.foldAll`, `studio.tree.unfoldAll`, `studio.tree.noMatches`).
- [ ] Pure filter helper in model.ts: `filterTree(nodes, query)` → visible node ids + ids of ancestors to expand; case- and accent-insensitive substring on titles; empty query → all. Tests.
- [ ] Render: search input + fold-all toggle above the tree; depth indentation + guide line + 0.9em for depth ≥ 1; highlight matches with `<mark>`; keyboard: `/` focuses search when the tree has focus, Esc clears.
- [ ] Wire in the studio sidebar; check musiki's notes sidebar/editor tree still renders (they import the same render) — add the controls there only if trivial, otherwise leave them studio-only behind an option.
- [ ] `npm test`, `npm run build`; commit.

### Task 2 (engine): YAML frontmatter styling
**Files:** the CodeMirror setup in `src/scripts/notas/personal-notes-workspace*` (find where the markdown language/extensions are configured) and its CSS.
- [ ] Frontmatter block rendered with a YAML highlighter: use `@codemirror/lang-yaml` if installed (check package.json / node_modules), nested via the markdown language's frontmatter support or a decoration plugin that applies YAML token classes inside the leading `---` block; otherwise a small regex-based decoration (key, string, number/date, boolean, comment). Monospace font, body font size, delimiters dim/normal weight. Tests for any pure tokenizer.
- [ ] `npm test`, `npm run build`; commit.

### Task 3 (engine): trace panel layout
**Files:** the trace view in the notes editor (grep `trace` in `src/scripts/notas/` and related CSS).
- [ ] Each paragraph's trace in its own block; the panel scrolls vertically; long content wraps (no absolute positioning collisions); the block's analysis-level header `position: sticky; top: 0` within its block. Check at desktop and 375px.
- [ ] `npm test`, `npm run build`; commit.

### Task 4 (engine): publish status + Site API fields
**Files:** `src/lib/site/rebuild.ts` (+ status reader), new `src/pages/api/studio/site/publish-status.ts` (studio auth, tenant so, GET, returns the status JSON or `{state:"idle"}` when missing/unreadable), `src/pages/api/public/site.ts` / `src/lib/site/site-model.ts` (add per-page `date` (frontmatter `date` or note createdAt, ISO), `tags` (frontmatter array of strings, else []), `createdAt`, `updatedAt`), studio editor toolbar status text (poll every 5 s while state is pending/building, else every 30 s; stop when hidden).
- [ ] Tests for the status reader (missing file, bad JSON, valid) and the site-model fields.
- [ ] `npm test`, `npm run build`; commit.

### Task 5 (so-web): watcher max wait + status file
**Files:** `scripts/vps/so-rebuild-watcher.sh`, `scripts/vps/so-rebuild-watcher.test.sh`, `scripts/vps/README.md`.
- [ ] Track the first time a trigger was seen while pending (`pendingSince`); build when the trigger is ≥30 s old OR `now - pendingSince ≥ 120 s`. Write the status file atomically at pending / building / published / failed (with commit + release). Env overrides for the 30/120 values and the status path. Extend the bash test (`--once`, `--dry-run` style) for the max-wait path and the status file.
- [ ] Commit.

### Task 6 (so-web): blog from the Site tree
**Files:** `src/pages/[...slug].astro`, `src/lib/site.ts` / `src/lib/site-data.ts`, `src/pages/tags/[tag].astro`, delete `src/pages/blog/[slug].astro` and `src/content/blog/{first,second,third}-post.md` (and the `blog` collection in `src/content/config.ts` if nothing else uses it), RSS/sitemap if they read the blog collection.
- [ ] Blog layout: list Site pages whose path is under the blog section page's path (e.g. `/blog/*`), newest first by `date` (Task 4 field; fall back to API order), showing title, date, description, tags.
- [ ] Tags layout and `/tags/[tag]` from Site pages' `tags`.
- [ ] The studio post `/blog/we-launched-the-soog-dashboard` builds and renders; tests (`node --test` files in scripts/ and src/lib) updated; `npm run build` with the current site.json (fetch-site falls back to the committed fallback when offline — use the live API: `SITE_API_URL=https://so.zztt.org/api/public/site`).
- [ ] Commit.

### Task 7 (controller): rollout
- [ ] Engine: merge + push (deploys musiki + hem + so studio); set `SO_REBUILD_STATUS` only if not the default path.
- [ ] so-web: merge + push; on the VPS `git -C /opt/so pull` happens in the watcher; restart `so-rebuild` (pm2 restart so-rebuild) so the new watcher script runs.
- [ ] Verify: edit a note in the studio continuously for >2 min → site rebuilds within ~2 min; toolbar shows Publishing…/Published; `/blog` lists the studio post and `/blog/we-launched-the-soog-dashboard` 200; old placeholder posts 404; tree search/fold-all, YAML, trace look right.
