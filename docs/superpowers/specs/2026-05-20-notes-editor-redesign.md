# Notes Editor — Direct Write Redesign

Date: 2026-05-20  
Status: Spec — ready for implementation plan  
Branch: `feature/notes-editor-direct-write`

## Problem

The current teacher workflow to edit course notes is:
1. Edit markdown in Obsidian locally
2. Commit + push to GitHub
3. Wait for deploy / build

This is too slow. Teachers need to edit notes directly in the browser and save immediately to the VPS filesystem.

## Solution

A dedicated web editor at `/notas-editor?course=[id]` (teacher-only) that reads and writes course note markdown files directly via a REST API backed by the VPS filesystem.

No GitHub write path. No Postgres migration in this branch. Filesystem stays as source of truth for now, aligned with the long-term Postgres direction from `docs/architecture/class-workspace-refactor.md`.

## Scope

**In scope:**
- Fase 1: REST API (`/api/notes/*`)
- Fase 2: Editor page (`/notas-editor.astro`)

**Out of scope (future):**
- Postgres migration
- EVAL field definitions (`class-reveal`, `patch-ai` — deferred to eval work)
- Obsidian sync
- Student-facing note visibility toggles
- Real-time multi-teacher collaborative editing

## Storage

Source of truth: VPS filesystem via `content-admin.ts` helpers.

Uses existing functions:
- `resolveCourseSource(courseId)` — finds local path for course
- `getEditableLocalRepoFile(source, relPath)` — reads file
- `writeEditableLocalRepoFile(source, relPath, content)` — writes file
- `isLocalContentAdminEnabled()` — guard for filesystem mode

Course roots resolved from `config/sources.manifest.json`. Only courses with a `localPath` are editable.

## Phase 1 — REST API

All endpoints require an active teacher session (`resolveLiveManageAccess`).

### `GET /api/notes/list`

Query: `?courseId=X`

Returns all `.md` files in the course root (excluding `_index.md`), with frontmatter parsed.

```ts
type NoteListItem = {
  slug: string;          // filename without .md
  title: string;         // frontmatter title or filename
  type: string;          // lesson | assignment | eval | info | public-note | ...
  chapter: string;       // frontmatter chapter field
  status: string;        // draft | published | private | ...
  order: number;
  theme?: string;
  filePath: string;      // relative path within course dir
};
```

Response: `{ notes: NoteListItem[] }`

### `GET /api/notes/get`

Query: `?courseId=X&slug=Y`

Returns full file content (raw markdown including frontmatter).

Response: `{ slug, content: string, filePath: string }`

### `POST /api/notes/save`

Body: `{ courseId, slug, content }` (full markdown including frontmatter)

Overwrites file. Returns `{ ok: true, slug }`.

### `POST /api/notes/create`

Body: `{ courseId, slug, title, type, chapter, status, order }`

Creates new file with minimal frontmatter scaffold. Errors if slug already exists.

Response: `{ ok: true, slug, content: string }`

### `POST /api/notes/delete`

Body: `{ courseId, slug }`

Deletes file. Teacher-only. Non-reversible.

Response: `{ ok: true }`

### `POST /api/notes/move`

Body: `{ courseId, slug, newSlug }`

Renames file. Errors if target already exists.

Response: `{ ok: true, slug: newSlug }`

## Phase 2 — Editor Page

### Route

`/notas-editor.astro` — SSR page, redirects non-teachers.

URL: `/notas-editor?course=i1`

### Layout

Split horizontal:
- **Left panel** (220px fixed): note tree
- **Right panel** (flex-1): editor

### Left Panel — Tree

Groups notes by `chapter:` frontmatter field. Chapters sorted by lowest `order` note within chapter.

Within each chapter: notes sorted by `order`, then alphabetically.

Interactions:
- Click note → load into editor
- Drag note → reorder within chapter (updates `order` frontmatter on drop)
- Drag to different chapter header → moves note to that chapter (updates `chapter` + `order` frontmatter)
- Right-click → context menu: **Edit** / **Duplicate** / **Rename** / **Delete**
- `+ nota` button per chapter → creates new note in that chapter

Special section at bottom: **EVALS** (teacher-only folder, teacher-only notes)

Implementation: Vanilla TS, adapted from `src/scripts/room/recursos/filetree.ts` patterns (drag events, context menu). Not a direct import — adapted for chapter-based structure.

### Right Panel — Editor

Three fixed rows above CodeMirror:

#### Row 1 — YAML Strip

Single horizontal row, always visible:

```
FM  [type: eval ▾] [chapter: 03 Organología ▾] [status: published ▾] [order: 2] [theme ▾]   [↩ Descartar] [💾 Guardar]
```

- Dropdowns suggest values extracted from existing notes in the same course
- `type` options from `notes-types.md`: `lesson`, `assignment`, `eval`, `info`, `public-note`
- `chapter` dropdown: chapters found in current course
- `status` options: `draft`, `published`, `private`
- `theme` optional — suggests themes seen in other notes
- **Guardar**: calls `POST /api/notes/save` with full markdown (frontmatter reconstructed from strip + raw body)
- **Descartar**: reloads original content from API

#### Row 2 — EVAL Contextual Row (conditional)

Only visible when CodeMirror cursor is inside a ` ```eval ``` ` block.

Orange left border, amber color scheme.

```
▌ EVAL  [cursor en bloque eval]  [evalType: class-reveal ▾] [dueDate: 2026-06-15] [maxScore: 10] [questions: 3 ▸]
```

- Edits the proto-YAML inside the eval block in real time (bidirectional sync with editor)
- Fields deferred — will be fully defined when implementing eval work
- Placeholder implementation: shows row with `evalType` only, editable textarea for YAML

**Cursor detection**: CodeMirror `.on('cursorActivity')` → check if cursor position is inside a fenced code block with language `eval`. Parse using syntaxTree or manual line scan.

#### Row 3 — Snippet Toolbar

Always visible:

```
INSERT  [🎴 COVER] [🎵 LILY] [📊 MERMAID] [🖼️ IFRAME] [🖼️ EVAL] | [📷 IMG  S3]   drop link / drop image
```

Each button inserts a snippet at cursor position:

| Button | Inserted snippet |
|--------|-----------------|
| COVER | `%%cover%%\n<grid drag="60 55" drop="5 10">\n# título\n</grid>` |
| LILY | ` ```lily\n\\relative c' {\n  c d e f\n}\n``` ` |
| MERMAID | ` ```mermaid\ngraph TD\n  A --> B\n``` ` |
| IFRAME | `<iframe src="URL" width="100%" height="400"></iframe>` |
| EVAL | ` ```eval\nevalType: class-reveal\n``` ` |
| IMG S3 | Triggers S3 upload picker → inserts `![](url)` |

#### Row 4 — Title input

Plain text input, edits `title:` frontmatter field. Below toolbar, above CodeMirror.

#### CodeMirror Editor

- Language: `@codemirror/lang-markdown`
- Theme: dark (matching musiki dark palette)
- Extensions: history, closeBrackets, syntaxHighlighting
- Line wrapping enabled
- Autosave: none — explicit save only

**Drop behaviors (on editor container):**
- Image file drop/paste → upload to S3 (same endpoint as Foro) → insert `![](url)`
- YouTube URL drop → insert `<iframe src="https://www.youtube.com/embed/ID" ...>`
- Vimeo URL drop → insert `<iframe src="https://player.vimeo.com/video/ID" ...>`
- Any other URL drop → fetch `<title>` if accessible → insert `[title](url)`

## File Map

```
src/pages/
  notas-editor.astro                    ← new page

src/pages/api/notes/
  list.ts                               ← GET list
  get.ts                                ← GET single note
  save.ts                               ← POST save
  create.ts                             ← POST create
  delete.ts                             ← POST delete
  move.ts                               ← POST move

src/scripts/notes-editor/
  index.ts                              ← entry, mounts everything
  tree.ts                               ← chapter tree UI + drag/context menu
  editor.ts                             ← CodeMirror setup, eval cursor detection
  yaml-strip.ts                         ← YAML strip row UI, bidirectional frontmatter sync
  toolbar.ts                            ← snippet toolbar + drop handlers
  api.ts                                ← typed fetch wrappers for /api/notes/*
  types.ts                              ← shared types (NoteListItem, etc.)
```

## Auth

All API endpoints: `resolveLiveManageAccess(session, courseId)` — must return `canManage: true`.

Page: redirect to `/` if not teacher.

## Constraints

- Only courses with `localPath` in `sources.manifest.json` are editable (local filesystem mode)
- `isLocalContentAdminEnabled()` must be true (env var `LOCAL_CONTENT_ADMIN=true`)
- VPS: content path is `/opt/musiki/framework/src/content/cursos/[courseId]/`
- No GitHub App write path in this branch
- No Postgres writes in this branch

## Open Questions (resolved)

| Question | Answer |
|----------|--------|
| EVAL field definitions | Deferred — implement placeholder row only |
| Editor engine | CodeMirror (`@codemirror/lang-markdown`) |
| Storage | VPS filesystem, no Postgres |
| Image upload | Same S3 flow as Foro |
| Obsidian write path | Dropped — editor writes direct to VPS |
