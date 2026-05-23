# NOTAS Workspace + QA Pod — Design Spec
**Date:** 2026-05-23
**Status:** Approved

---

## Overview

Replace the standalone `/notas` page with a pod-based personal notes system integrated across three surfaces: a course sidebar section, a full personal notes overlay (ribbon), and the live room workspace. Add a QA Analyzer pod as the first tool in a qualitative data analysis pipeline.

The notes DB tree is the shared data contract. Each surface implements its own workspace UI but reads from the same `LiveClassNote` + `LiveClassNoteFolder` tables.

---

## 1. Data Layer

### New table: `LiveClassNoteFolder`

```sql
CREATE TABLE "LiveClassNoteFolder" (
  "id"        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name"      varchar(200) NOT NULL,
  "parentId"  uuid REFERENCES "LiveClassNoteFolder"("id") ON DELETE CASCADE,
  "userId"    integer NOT NULL,
  "courseId"  varchar(200),   -- null = global; non-null = scoped to this course
  "createdAt" timestamptz DEFAULT now()
);
```

### Migration: `LiveClassNote`

```sql
ALTER TABLE "LiveClassNote"
  ADD COLUMN "folderId" uuid REFERENCES "LiveClassNoteFolder"("id") ON DELETE SET NULL;
```

### Scoping rules

- Notes created in a course page are tagged with that `courseId` by default.
- The course is the **invisible root** — never shown as a label in the UI, just a filter.
- Notes can be moved between courses (or to `courseId = null` = global) by changing `courseId`.
- Folders are also course-scoped. A folder in Course A does not appear in Course B.

### API surface

**`/api/live/notes`** — extended:
- `GET ?courseId=X` — list notes for course (used by sidebar section)
- `GET ?folderId=X` — notes in a specific folder
- `GET ?id=X` — single note (unchanged)
- `POST` / `PATCH` / `DELETE` — unchanged, add optional `folderId` field

**`/api/live/note-folders`** — new:
- `GET ?courseId=X` — full folder tree (recursive) for course
- `POST { name, parentId?, courseId? }` — create folder
- `PATCH { id, name? | parentId? }` — rename or move folder
- `DELETE ?id=X` — delete folder; notes inside move to parent (or root if top-level)

---

## 2. Files

### New files

```
src/scripts/course/dockview-shell.ts              — extracted buildShell (shared by all consumers)
src/scripts/notas/personal-notes-workspace.ts     — workspace module (no courseId)
src/components/notas/PersonalNotesOverlay.astro   — ribbon overlay container
src/components/notas/NotesBrowserPanel.ts         — dockview panel: tree + search + create
src/pages/api/note-folders.ts                     — folder CRUD API endpoint
```

### Modified files

```
src/scripts/course/dockview-workspace.ts          — extract buildShell; add db-note + qa-analyzer panel kinds; DnD
src/pages/[...slug].astro                         — add NOTAS sidebar section
src/components/Ribbon.astro                       — musiki:open-notas → PersonalNotesOverlay
src/scripts/room/workspace/RoomWorkspaceManager.ts — register db-note pod type
src/pages/notas.astro                             — delete; add redirect → /dashboard
```

> **Note on `buildShell`:** Currently private to `dockview-workspace.ts`. Must be extracted to `dockview-shell.ts` and re-exported before `personal-notes-workspace.ts` and the room pod can share it. This is the first task in implementation.

---

## 3. Three Consumers of `db-note`

| Consumer | Module | How `db-note` opens |
|----------|--------|---------------------|
| Personal notes overlay | `personal-notes-workspace.ts` | Click note in NotesBrowserPanel |
| Course dockview | `dockview-workspace.ts` | Drag from NOTAS sidebar section |
| Live room | `RoomWorkspaceManager` | Drag from sidebar or pod palette |

The `db-note` panel implementation (load from API, edit/preview toggle, HUD) is written once and reused across all three consumers via shared helpers.

---

## 4. NOTAS Sidebar Section (Course Pages)

Rendered below RECURSOS in the course sidebar. Course is the implicit root — never labeled.

```
▼ NOTAS                         [+ nota]
  ├─ 📁 fragmentos              [+ ···]
  │   └─ 🗒 Apuntes             [···]
  └─ 🗒 Ideas sueltas            [···]
```

### Behaviour

- Loads folders + notes for `courseId` via `/api/live/note-folders?courseId=X` + `/api/live/notes?courseId=X`
- Folders first (alphabetical), then loose notes (sorted by `updatedAt` desc)
- Inline actions on hover: `[+ nota]` creates note at root; `[+]` next to folder creates inside it; `[···]` opens context menu (rename, move, delete)
- **Drag:** any note item sets `dataTransfer.setData('text/x-musiki-note', noteId)` — drops onto course dockview → opens `db-note` pod; drops onto QA pod → activates analysis
- Folder DnD: drag note into folder to move it (reorder within sidebar)

---

## 5. Personal Notes Overlay (Ribbon)

Full-screen overlay (same slide-up pattern as `CoursePodWorkspace`). `musiki:open-notas` toggles open/closed. State preserved on close (panels stay, unsaved edits safe).

```
┌─────────────────┬──────────────────────────────┐
│  🔍 Buscar      │  [note pod]  │  [note pod]   │
│  ─────────────  │              │               │
│  📁 fragmentos  │              │               │
│    🗒 Apuntes   │              │               │
│  🗒 Ideas       │              │               │
│  ─────────────  │              │               │
│  [+ nueva nota] │              │               │
└─────────────────┴──────────────────────────────┘
```

### `PersonalNotesOverlay.astro`

- Mounts `PersonalNotesWorkspace` inside a fixed overlay div
- Wire `musiki:open-notas` → toggle `.is-open` class (same pattern as `CoursePodWorkspace`)

### `personal-notes-workspace.ts`

```ts
export function initPersonalNotesWorkspace(
  container: HTMLElement,
  userId: number,
): PersonalNotesWorkspace
```

- No `courseId` — user-global scope
- Initialises dockview with `NotesBrowserPanel` on the left (~220px)
- `NotesBrowserPanel` fetches all courses' notes; groups by course with a minimal faint divider (no prominent course label — cognitive economy)
- Clicking a note opens it as `db-note` pod to the right
- Search: client-side filter on loaded note list (title + body prefix)

---

## 6. `db-note` Panel Kind

### Panel params

```ts
type DbNoteParams = {
  kind: 'db-note';
  noteId: string;
  title: string;
  courseId?: string;
};
```

### Behaviour

- Shell: reuses `buildShell` — same drag handle, pencil toggle, status dot
- On init: fetches `/api/live/notes?id=X` for full content
- **Preview mode:** renders `renderedHtml` (or raw body fallback)
- **Edit mode:** mounts CodeMirror via `enhanceMarkdownTextarea`; auto-saves on blur + Cmd/Ctrl+S; status dot shows saved/dirty state
- Save: PATCH `/api/live/notes` with `{ id, title, body }`

### Writing Analytics HUD

Single bottom line, no border, no background:

```
247 palabras · 1 432 caracteres · 12 oraciones          [QA ↗]
```

- `font-size: 0.62rem`, `opacity: 0.4`
- Updates debounced 300ms on editor input
- Word count: whitespace split, filter empties
- Sentence count: split on `/[.!?]+/`
- `[QA ↗]` dispatches `musiki:send-to-qa` with `{ noteId, content, title }`
  - If a `qa-analyzer` panel is open → update its active note
  - If none open → add `qa-analyzer` panel to the right of the current note pod

---

## 7. QA Analyzer Pod (`qa-analyzer`)

### Panel params

```ts
type QaAnalyzerParams = {
  kind: 'qa-analyzer';
  noteId?: string;
  title?: string;
};
```

Starts empty. Receives a note via:
1. `musiki:send-to-qa` event
2. Drag `text/x-musiki-note` onto the QA pod
3. Drag from NOTAS sidebar directly onto QA pod

### Layout

```
┌──────────────────────────────────────────────────────┐
│  QA  ·  Apuntes intro                    [× limpiar] │
├─────────────────┬────────────────────────────────────┤
│  FRECUENCIA     │  CONCORDANCIA                      │
│  ─────────────  │  ──────────────────────────────    │
│  música    ███  │  [buscar palabra...]               │
│  ritmo     ██   │                                    │
│  tiempo    ██   │  …escuchar la  música  en vivo…   │
│  escuchar  █    │  …estructura  musical  del tema…  │
│  armonía   █    │  …los elementos de la  música…    │
└─────────────────┴────────────────────────────────────┘
```

### Frequency panel (left)

- Top 20 words after stripping stopwords (hardcoded ~200-word list: Spanish + English common words)
- Bar width = `count / maxCount * 100%`, CSS only (no chart library)
- Click a word → populates concordance search and shows KWIC immediately

### Concordance panel (right, KWIC)

- Search box: type or click frequency list item
- Shows every sentence containing the word; target word highlighted with `<mark>`
- ~30-char context each side, scrollable list
- Pure client-side regex, `<1ms` on 5000-word notes

### Event wiring

The QA pod registers `window.addEventListener('musiki:send-to-qa', handler, { signal })` on init, using the dockview abort signal so it cleans up when the panel is closed. The handler receives `{ noteId, content, title }` and updates the pod's active note.

When multiple QA pods are open, only the most-recently-activated one responds (last `setActive` wins — tracked via a module-level `activeQaPanelId`).

### State

One active note at a time. Receiving a new note replaces the analysis. Pod title updates to note title. `[× limpiar]` clears the pod back to empty state.

---

## 8. `musiki:open-notas` Resolution

The current dead-end handler in `dockview-workspace.ts:783` is replaced:

- `musiki:open-notas` is now handled by `PersonalNotesOverlay.astro` (toggles overlay)
- The handler in `dockview-workspace.ts` is removed — the course dockview no longer owns the Notas ribbon button
- This resolves Task 6 from the handoff as a side-effect of the architecture

---

## 9. `/notas` Page Removal

`src/pages/notas.astro` is deleted. A redirect is added:

```ts
// In a new src/pages/notas.ts (or as a redirect in astro.config)
export const GET = () => new Response(null, {
  status: 302,
  headers: { Location: '/dashboard' },
});
```

---

## 10. Deferred (Documented for Future Phases)

The following QA tools are architecturally positioned by the `qa-analyzer` pod but NOT implemented in this phase:

| Tool | Description |
|------|-------------|
| **Coding margin** | Select text → assign code label → stored in `LiveClassNoteCode` table |
| **Codebook versionado** | Version-controlled code dictionary per course |
| **Cluster extraction** | Group coded segments by code across notes |
| **QDPX export** | Standard QDA interchange format (Atlas.ti / NVivo compatible) |
| **AI retrieval** | Embed notes via pgvector, proximity search |
| **Code similarity** | Detect near-duplicate codes across codebooks |
| **Date/location extraction** | NLP extraction of temporal and spatial references |

The `qa-analyzer` pod's right panel (concordance) will become the host for these tools — each tool becomes a tab or mode in that panel.

### Share with Teacher (`Compartir con docente`)

Deferred to a future phase:
- "Compartir" status on a note (boolean field + timestamp on `LiveClassNote`)
- Teacher view: NOTAS section in teacher's course sidebar, subfolders named by student last name
- Shared notes appear read-only in teacher's view; teacher can annotate
- Foundation for bulk correction pipeline

---

## Success Criteria

- [ ] `/notas` page removed; redirect to `/dashboard` works
- [ ] NOTAS sidebar section appears on course pages with folder tree CRUD
- [ ] Drag note from sidebar → opens `db-note` pod in course dockview
- [ ] `musiki:open-notas` (ribbon) → opens personal notes overlay
- [ ] Personal notes overlay: NotesBrowserPanel shows all notes, search works, clicking opens pod
- [ ] `db-note` pod: load, preview, edit, save, all three consumers work
- [ ] Writing analytics HUD updates live; "Send to QA" opens/updates QA pod
- [ ] QA pod: frequency list renders correctly; clicking word shows concordance
- [ ] QA pod: drag note onto it activates analysis
- [ ] Room workspace: `db-note` pod type registered and openable
