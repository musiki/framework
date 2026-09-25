# Studio Workspace & Editor (so sub-project 2, A+B) — Design

**Date:** 2026-09-25
**Status:** Approved design, pending implementation plan
**Depends on:** Tenant layer (`2026-09-25-tenant-layer-design.md`, deployed)

---

## 1. Goal

Give the so.zztt.org studio a real writing workspace — the author's OKA method (GTX working texts, Output, private area) — using musiki's existing notes editor, comments/annotations, versions and tracer, **without duplicating code**. The same notes engine must serve musiki (courses, Spanish) and so (spaces, English). This is the first concrete step toward shared `packages/editor` and `packages/tracer`.

## 2. Decisions

| Topic | Decision |
|---|---|
| Server architecture | One shared notes service with a **scope**; musiki and so keep separate thin route families (option 1). |
| Sharing | `LiveClassNoteShare` remains a **musiki-only** feature. In so, access derives from **role × visibility**. |
| Visibility levels | `private` → `supervision` → `committee` → `public`, set per folder (inherited) with per-note override. |
| OKA defaults | `GTX` = `supervision`, `Output` = `committee`, root = `private`. |
| Tree placement | The note tree lives **inside the studio sidebar**; `/studio/structure` becomes an overview with visibility management. |
| Editor | Reuse `mountDbNoteEditor`, extracted into `src/lib/writing/editor/`, configured by `apiBase`, `labels`, `contentLang`. |
| Tree | One **shared, scope-aware tree** in `src/lib/writing/tree/` replaces both musiki tree implementations and serves so. First improvement: **manual ordering** (persisted). |
| Dockview in so | Later, as its own sub-project. |

Out of scope: tree phase 2 (§6.1: move folders, remember state + search, keyboard + multi-select — next plan, in that order), dockview in the studio, longform assembly to a single `.tex`/`.pdf` (C), editing static so-web pages (D), agent UI, dashboard metrics, MOAIE dashboard (E), extracting `packages/*` physically (F).

## 3. Role × visibility matrix

Per-note access for a user in a so space. `—` = not visible.

| Role \ effective visibility | private | supervision | committee | public |
|---|---|---|---|---|
| **author** | edit | edit | edit | edit |
| **supervisor** | — | comment | view | view |
| **coordinator** | — | — | view | view |
| **reviewer** | — | — | view (versions only) | view |
| **guest** | — | — | — | view |

Operation mapping:
- `edit`: body edit, rename, move, delete, visibility change (author only), create versions, trace write (manual codes), `.tex` export.
- `comment`: read-only render + create annotations/comments on the note; read trace.
- `view`: read-only render; read trace. Reviewer on `committee` notes: version list/content only, not the live body.
- Folder operations (create, rename, move, delete, set visibility): **author only**.
- Tree listing returns only items whose effective visibility grants the user at least `view` (for reviewer: `committee` items appear as version-only).

## 4. Architecture

```
src/lib/writing/                     (future packages/{editor,tracer})
  notes/
    scope.ts            type NoteScope =
                          | { kind: 'course'; courseId: string | null; roomName?: string | null }
                          | { kind: 'space'; spaceId: string; tenantId: TenantId }
    visibility.ts       VISIBILITIES, effectiveVisibility(note, folderChain) — pure
    access.ts           resolveSpaceAccess(role, visibility) — pure matrix (§3)
                        resolveNoteAccess(noteRow, user, scope) — course branch = today's getNoteAccess;
                                                                   space branch = membership role × effective visibility
    notes-service.ts    listNotes, getNote, createNote, updateNote, deleteNote (scope-aware SQL)
    folders-service.ts  listFolders, createFolder, renameFolder, moveFolder, deleteFolder, setVisibility, ensureOkaFolders
    annotations-service.ts, versions-service.ts, trace-service.ts
  editor/
    mount.ts            mountDbNoteEditor(els, noteId, { apiBase, labels, contentLang })
    labels.ts           EditorLabels type; buildEditorLabels(locale) using t()

src/pages/api/live/notes.ts, notes/{annotations,versions,trace}.ts, api/note-folders.ts
                        musiki: thin; build { kind:'course' } scope; call services; identical I/O to today
src/pages/api/studio/notes.ts, notes/{annotations,versions,trace,folders}.ts
                        so: thin; build { kind:'space' } scope from a spaceId validated against
                        locals.tenant + SpaceMember; call services
```

Rules:
1. **The route builds the scope; the client never chooses it.** Studio routes accept only `spaceId`s of spaces in `locals.tenant` where the caller is a member; `courseId` is rejected. Musiki routes never read `spaceId`.
2. **Share endpoints are not exposed under `/api/studio`.** `resolveNoteAccess` ignores `LiveClassNoteShare` for space-scoped notes.
3. **The editor holds no URLs or strings of its own**: `apiBase` (`/api/live/notes` | `/api/studio/notes`), `labels` from `t()` (so: `en`; musiki: `es`, byte-identical to today's text), `contentLang` (`note.lang ?? space.lang` for so; `'es'` for musiki) passed to the tracer (`getLangPack`, `traceStopwords`).
4. Existing large files (`personal-notes-workspace.ts` 1701 lines, `trace-margin.ts` ~2300) are **not reorganized**: only `mountDbNoteEditor` (+ its private helpers it needs) moves to `src/lib/writing/editor/mount.ts`, and hard-coded Spanish UI strings in the editor and trace margin are replaced by `labels`. `personal-notes-workspace.ts` re-imports it.

## 5. Data

Additive migration (`postgres-patches/migrations/<ts>_space_notes_visibility.sql`):

```sql
ALTER TABLE "LiveClassNoteFolder" ADD COLUMN IF NOT EXISTS "spaceId" uuid NULL REFERENCES "Space"("id") ON DELETE CASCADE;
ALTER TABLE "LiveClassNoteFolder" ADD COLUMN IF NOT EXISTS "visibility" text NULL
  CHECK ("visibility" IN ('private','supervision','committee','public'));
ALTER TABLE "LiveClassNote" ADD COLUMN IF NOT EXISTS "visibility" text NULL
  CHECK ("visibility" IN ('private','supervision','committee','public'));
-- manual ordering among siblings (fractional; NULL = legacy rows, sorted after positioned ones)
ALTER TABLE "LiveClassNote"       ADD COLUMN IF NOT EXISTS "position" double precision NULL;
ALTER TABLE "LiveClassNoteFolder" ADD COLUMN IF NOT EXISTS "position" double precision NULL;
-- a note/folder belongs to a course OR a space, never both
ALTER TABLE "LiveClassNote"       ADD CONSTRAINT "LiveClassNote_course_xor_space"       CHECK ("courseId" IS NULL OR "spaceId" IS NULL);
ALTER TABLE "LiveClassNoteFolder" ADD CONSTRAINT "LiveClassNoteFolder_course_xor_space" CHECK ("courseId" IS NULL OR "spaceId" IS NULL);
CREATE INDEX IF NOT EXISTS "LiveClassNoteFolder_spaceId_idx" ON "LiveClassNoteFolder" ("spaceId") WHERE "spaceId" IS NOT NULL;
```
(Constraints added guarded by `DO $$ … IF NOT EXISTS (pg_constraint) … $$` for idempotency, following `20260525110000_live_class_note_folder_integrity.sql`.) `LiveClassNote.spaceId` and `.lang` already exist.

- **Effective visibility** = `note.visibility ?? nearest ancestor folder.visibility ?? 'private'`.
- **Ownership in so:** `LiveClassNote.userId` and `LiveClassNoteFolder.userId` are the author's user id; contributions by others live in `LiveClassNoteAnnotation`/`LiveClassNoteComment` with their own `authorId` (attributable).
- **OKA bootstrap:** `ensureOkaFolders(spaceId, authorId)` creates `GTX` (`supervision`) and `Output` (`committee`) at root if absent; called when the author opens the studio. Idempotent (lookup by `spaceId` + `parentId IS NULL` + `name`).

## 6. Shared tree (musiki + so)

Today musiki has two overlapping tree implementations (`src/scripts/course/notes-sidebar.ts`, 994 lines, and `src/scripts/course/sidebar/notes-sidebar.ts`), alphabetical-only, course-coupled, with inline styles and Spanish strings. Replace both with one tree:

```
src/lib/writing/tree/
  model.ts      pure: buildTree(folders, notes) → nested nodes; sortSiblings (position ASC NULLS LAST, then name/title,
                locale-aware); positionBetween(prev, next) (fractional midpoint); needsRenormalize(siblings)
  render.ts     DOM rendering + drag & drop + context menu, driven by { apiBase, scope params, labels, canEdit(node) }
  tree.css      styles via CSS variables (works with musiki's var(--c-*) and so's theme)
```

- **Manual ordering (this plan):** dragging a note or folder between siblings sets `position = positionBetween(prev, next)` via the service (`PATCH` with `position`, and `folderId` when moving across folders). When the gap between neighbours falls below 1e-9, the service renormalizes that sibling list to 1024-spaced integers in one transaction. Rows with `position IS NULL` (all existing musiki rows) keep today's alphabetical order after positioned siblings, so musiki looks unchanged until someone reorders.
- The same order is what the longform assembly (C) will follow.
- Musiki's sidebar(s) and the so studio sidebar both mount `render.ts`; musiki passes Spanish labels and its course scope, so passes English labels and the space scope. Existing musiki tree tests (`src/scripts/course/sidebar/notes-sidebar.test.mjs`) keep passing or are ported to `model.ts`.

### 6.1 Tree phase 2 (next plan, in this order)
1. Move folders (drag folders into folders; cycle prevention).
2. Remember expanded/collapsed state per scope; title filter/search.
3. Keyboard navigation (arrows, F2 rename, Delete) and multi-select move; accessibility (tree/treeitem roles, aria-expanded).

## 7. Studio UI

- **Sidebar tree** (in `StudioLayout` sidebar, per space): the shared tree (§6) showing `GTX`, `Output`, `Private` (author only) with nested folders/notes, manual order, a visibility badge per item, `+ New note` / `+ New folder` (author only), and an author context menu: rename, delete, visibility.
- **`/studio/editor?note=<id>`**: mounts `mountDbNoteEditor` with `apiBase: '/api/studio/notes'`, English labels, `contentLang`. Access comes from the server (`accessLevel`).
- **`/studio/structure`**: overview of the tree with per-item visibility controls (author) and counts per visibility.
- Everything user-visible via `t()`; nothing mentions musiki.

## 8. Testing

- **Characterization first:** before moving any musiki route, record its current behavior (response shape; access for owner, course teacher, share target, stranger) in tests; the refactor must keep them green.
- **Tree model:** `buildTree`, `sortSiblings` (positioned before NULL, locale-aware ties), `positionBetween` (ends, middle, tiny gaps), renormalization trigger; musiki tree behaves identically when all positions are NULL.
- **Pure units:** `access.ts` full matrix (5 roles × 4 visibilities × read/comment/edit/versions/trace/folder-ops); `visibility.ts` inheritance (note override, nearest folder, default private, deep chains).
- **Scope isolation:** studio routes reject foreign-tenant `spaceId`, non-member, and any `courseId`; musiki routes never return space notes.
- **i18n:** new keys in `en` and `es`; musiki editor/tracer Spanish strings unchanged (snapshot of labels for `es`).
- **Route sweep** still passes with `/api/studio/notes*`.
- **Staging (musiki_staging):** migration twice (idempotent); XOR constraint rejects a row with both ids.

## 9. Rollout

1. Migration → `musiki_staging`, then prod (with backup).
2. Merge + deploy; verify musiki NOTES: open note, comment, trace, versions, tree unchanged (alphabetical) until reordered; reorder works.
3. so: author opens studio → GTX/Output created; write a GTX note; invite a test supervisor → can comment, cannot edit, does not see Private; coordinator sees only Output.
