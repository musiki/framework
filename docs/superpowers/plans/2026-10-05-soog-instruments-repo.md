# SOOG instruments catalogue as a repo-backed content source — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

**Goal:** the instrument catalogue (Obsidian notes with YAML) becomes its own GitHub repo, edited in the vault, pulled by the musiki engine as a content source, and served by `/api/public/instruments` to so.zztt.org (en), musiki i1/i2 (es) and later soog.zztt.org.

**Decisions (user-approved 2026-10-05):**
- Files, not DB. One `.md` per instrument with YAML, human-editable in Obsidian, history on GitHub.
- The repo IS the vault folder `03-thesis/cases/case instruments/` (nested git repo inside the vault's own git repo; the vault repo ignores that folder). GitHub repo: `zzigo/soog-instruments` (private).
- Canonical YAML = the SOOG templates `03-thesis/03-soog/soog-templates/t-moaie.md` (full) and `t-dssi.md` (stub). New key `publish: true|false` decides public visibility; `status` keeps its editorial meaning (stub | draft | validated | deprecated).
- `z-instruments` (`08-output/z-instruments/`, the user's own instruments) get the SAME YAML schema but stay in the vault, not in the repo, `publish: false` (they may appear later in the so studio GTX, out of scope now).
- Case instruments currently shown keep showing: normalized case notes get `publish: true`; notes the dashboard didn't treat as instruments keep their type (box, concept) and are not exposed.
- Languages: one file per instrument; body text in `<!--lang:en-->…<!--/lang-->` / `<!--lang:es-->…<!--/lang-->` blocks where translations exist; YAML may carry `title_es` (and other `<key>_es` text fields); the API picks by tenant locale (so → en, musiki → es), falling back to the other language.
- Spectral Parrot moves from `i1/public/instrumentos/` into the repo (its Spanish text as an `es` block). Removing it from i1 is left to the user.

## Global constraints
- The vault lives on Google Drive and is itself a git repo: never `git add -A` in the vault repo; never commit unrelated vault changes; every bulk edit goes through a dry-run report first; the YAML normalizer never changes note bodies and preserves unknown keys and YAML comments.
- Never read `.env`; never `git stash`; commit messages end with a blank line + `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Engine worktree `/Users/zztt/projects/26-musiki/framework-ins` (branch `feat/instruments-source`), node_modules symlinked.

### Task A (vault + new repo): schema, normalizer, repo
**Files (new repo at `<vault>/03-thesis/cases/case instruments/`):** `SCHEMA.md` (fields, types, meaning, examples; derived from the templates), `README.md`, `package.json` (dev: `yaml`), `scripts/normalize.mjs` + `scripts/normalize.test.mjs`, `.gitignore`.
- [ ] Normalizer (pure core + CLI): input a folder (+ defaults: `--publish true|false`), for each `.md`: parse YAML with the `yaml` Document API (keeps comments/order); map legacy keys (`image`→`img`, `link`→`url`, `creator`→`person` if person empty, `Created`/`created`→`created`, `timelines`→`timeline`, `yearurl` → report only); add `type: instrument` to untyped notes that look like instruments (have ≥2 of family, sachs-hornbostel, abrev, person, performers, year) — report the decision per file; add `id` (snake_case from filename) and `title` (filename) when missing; add `publish` when missing; files without frontmatter get a minimal stub block (id, title, type: instrument, status: stub, publish) only if they look like instrument notes by folder, else reported and skipped. Dry-run prints a per-file table; `--apply` writes. Tests with fixtures.
- [ ] Run dry-run on `case instruments` (`--publish true`) and `08-output/z-instruments` incl. subfolders (`--publish false`); save the reports; apply; verify with `git -C <vault> diff --stat` that only frontmatter changed (script: compare bodies before/after = identical).
- [ ] Spectral Parrot: create `spectral parrot.md` in the repo folder with normalized YAML (`type: instrument`, `publish: true`, `lang: es`) and its body wrapped in `<!--lang:es-->…<!--/lang-->`.
- [ ] Repo: `git init` in the folder, add `03-thesis/cases/case instruments/` to the vault repo's `.gitignore` (commit only that line in the vault repo), initial commit in the new repo, `gh repo create zzigo/soog-instruments --private --source . --push`.

### Task B (engine): instruments from the content source
**Files:** `config/sources.manifest.json` (source `soog-instruments`, repo `zzigo/soog-instruments`, branch main, `localPath: ../../../Library/...`? → use the vault path relative to the repo root, check how `localPath` is resolved and that `prefer-local` works on the Mac), the content assembly (exclude this source from course assembly — it is not a course; check how `assemble-content.mjs` treats sources and add a `kind: "data"`/`assemble: false` flag), `src/lib/instruments/*` (new file loader reading `.content-sources/soog-instruments/**/*.md`, env `INSTRUMENTS_DIR` override, cached by mtime), `src/pages/api/public/instruments.ts`, tests.
- [ ] Loader: list `.md` files (skip `scripts/`, `node_modules`, dotfiles, README/SCHEMA), project each with `projectInstrument` but filter `publish === true` (and `type === 'instrument'`); stable `id` = YAML `id` or slug of filename; language: pick `title_<lang>` when the tenant locale is `es`; body text is not part of the public payload today (keep it that way).
- [ ] API serves the file-backed catalogue for every allowed host; the old so-studio-notes path is removed (or kept only as an explicit fallback when the directory is missing — decide and document); `fictional` = `layer: fictional`.
- [ ] Deploy: the hem instance must not pull this source (separate manifest already) — verify; musiki deploy pulls it (remote-only with the job token — the token must read `zzigo/soog-instruments`; if it can't, the controller adds access or makes the repo readable).
- [ ] Tests + build.

### Task C (controller): rollout
- [ ] Token access to `zzigo/soog-instruments` for the deploy; merge + push engine; verify `/api/public/instruments` on so and musiki returns the published instruments; the so page with the plugin and the musiki i1 sidebar show them.
- [ ] Repository dispatch from `zzigo/soog-instruments` pushes → `musiki/framework` (workflow file in the new repo) so edits redeploy.
