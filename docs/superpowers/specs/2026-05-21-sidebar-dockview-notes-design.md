# Course Notes — Dynamic Sidebar + Dockview Workspace

**Date:** 2026-05-21  
**Scope:** Course page (`[...slug].astro`) — left sidebar notes tree + main content area  
**Author:** design session with luciano

---

## Overview

Two systems built sequentially:

1. **Dynamic Notes Sidebar** — replaces static Astro chapter/lesson rendering for teachers with a JS-rendered tree that supports right-click context menus and drag-and-drop reordering, mirroring the Recursos Editor pattern.
2. **Dockview Content Area** — replaces the single `content-area` div with a dockview workspace. Default layout is 1 panel (identical to today). Additional panels open on `Cmd/Ctrl+click`. All editing is auto-saving (local-first, no save button).

Non-teacher users are unaffected — they keep the static Astro rendering.

---

## System 1 — Dynamic Notes Sidebar

### Astro change

When `canManageLiveInteractions` is true, replace the static chapter `<details>` list with:

```html
<div data-notes-sidebar data-course-id="s123"></div>
```

Non-teachers keep the static Astro rendering as-is.

The E and C buttons at the top of the sidebar are removed. Context menu is the management entry point.

### New module

`src/scripts/course/sidebar/notes-sidebar.ts`

Owns all dynamic behavior for the sidebar notes section. Public API:

```ts
initNotesSidebar(container: HTMLElement, courseId: string, activeSlug: string | null): void
```

On init: fetches `/api/notes/list?courseId=...`, renders the tree, wires up DnD and context menus.

Listens for `window` event `notes-sidebar-refresh` (custom event dispatched by the editor after any mutation) and re-fetches + re-renders.

### Rendering

`renderNotesSidebar(container, notes, activeSlug, callbacks)` uses the sidebar's existing CSS classes:
- Chapter groups: `chapter`, `chapter-details` (`<details>`), `chapter-title` (`<summary>`)
- Note rows: `lesson-list`, `lesson-link` (preserving existing hover/active styles)

Mirrors `filetree.ts` / `tree.ts` pattern: pure function, callbacks object, no internal state.

### Context menu — note row (right-click)

| Label | Action |
|---|---|
| Editar | `callbacks.onOpen(slug)` → opens in focused dockview panel |
| Renombrar slug | prompt → `POST /api/notes/move` |
| Eliminar | confirm → `POST /api/notes/delete` |
| — | separator |
| Nueva nota aquí | prompt for title → `POST /api/notes/create` with same chapter |

### Context menu — chapter header (right-click on `<summary>`)

| Label | Action |
|---|---|
| Nueva nota en este capítulo | prompt → `POST /api/notes/create` |
| Renombrar capítulo | prompt → bulk `chapter` field update via `/api/notes/save` on all notes in chapter |
| Nuevo subcapítulo | prompt for name → `POST /api/notes/create` with new chapter name |

### Drag and drop

- Every note row: `draggable=true`. `dragstart` stores slug in `dataTransfer`.
- Chapter `<summary>` elements: `dragover` + `drop` → change `chapter` YAML field via `/api/notes/save`.
- Between-note insertion indicators: 2px ghost lines rendered between rows during `dragover`. On `drop` → update `order` on dragged note and renumber siblings.
- Sequence on drop:
  1. Optimistic DOM update (move element immediately)
  2. API call(s) to persist new order/chapter
  3. `refreshSidebar()` (re-fetch + re-render to confirm server state)

### Sync

After any successful mutation, dispatch `new CustomEvent('notes-sidebar-refresh')` on `window`. The sidebar listener re-fetches and re-renders. The dockview workspace also listens to update open panel titles if a rename occurred.

---

## System 2 — Dockview Content Area

### Layout change

The `.content-area` div becomes the dockview root. Everything outside it is untouched: breadcrumb nav, prev/next links, page-info panel, right sidebar.

Default state on page load: 1 panel showing the current note — visually identical to today.

### New module

`src/scripts/course/dockview-workspace.ts`

Public API:

```ts
initDockviewWorkspace(container: HTMLElement, courseId: string): DockviewWorkspace

interface DockviewWorkspace {
  openNote(slug: string, mode: 'preview' | 'edit', split?: boolean): void
}
```

`split: true` opens a new panel to the right instead of navigating the focused panel.

No layout state persistence for now (every page load starts with default 1-panel layout). Persistence is a future add.

### Panel anatomy

Each panel is a dockview panel with a custom header renderer and a body.

**Custom header (transparent tab):**
- Full-width drag zone (dockview's native drag works through it)
- Zero background, zero border, zero box-shadow
- Only visible element: a small flat pencil icon (`⌐` or SVG wireframe) at the panel's top-right corner, `color: var(--c-fg-dim)`, opacity `0` at rest → `0.6` on panel hover
- Note title: invisible at rest, appears as a subtle muted string (`var(--c-fg-subtle)`, opacity `0.45`) on header hover
- Theme-responsive: uses only CSS custom properties (`--c-bg`, `--c-fg`, `--c-fg-dim`, `--c-border`)

**Panel body — preview mode:**
- Renders the note's HTML (same as current content area)
- Clicking the pencil icon transitions to edit mode

**Panel body — edit mode:**
- Calls `mountInlineNotesEditor` (existing module) inside the panel body element
- No save button rendered (auto-save handles persistence)
- Clicking pencil icon (now an eye icon) transitions back to preview (destroys editor, re-renders HTML)

**Panel ID:** `${slug}::preview` or `${slug}::edit` — a note can be open in both modes simultaneously (like Obsidian).

### Navigation

- **Sidebar click** → `workspace.openNote(slug, 'preview', false)` — navigates focused panel
- **Sidebar `Cmd/Ctrl+click`** → `workspace.openNote(slug, 'preview', true)` — splits right
- **Pencil icon** → toggles mode within same panel

### Auto-save (local-first)

No save button. No explicit save action.

**`NotesPersistence` class** (new, in `src/scripts/course/notes-persistence.ts`):

```ts
class NotesPersistence {
  constructor(courseId: string, slug: string)
  onChange(content: string): void   // call on every editor doc change
  flush(): Promise<void>            // call on panel close — awaits pending write
  recover(): { content: string; timestamp: number } | null  // check localStorage draft
  destroy(): void                  // cancel pending debounce
}
```

Behavior:
- `onChange`: starts/resets 1500ms debounce. Writes to `localStorage` key `notes-draft::${courseId}::${slug}` immediately (crash-safe local buffer).
- On debounce fire: `POST /api/notes/save`. On success: clears localStorage draft.
- On error: retains localStorage draft, shows error indicator, retries on next change.
- Status indicator: a single 8px dot in the panel header area. States: `●` (unsaved, `var(--c-fg-dim)`) → spinning (writing) → fades out (saved) → `✗` red (error).

**Recovery on panel open:**
- Compare `localStorage` draft timestamp vs server content `updatedAt`.
- If local draft is newer: load draft content, show inline banner "Borrador recuperado — ¿usar este?" with Accept/Discard buttons.
- If no draft or server is newer: load server content normally.

**Panel close guard:**
- If `NotesPersistence` has a pending debounce: call `flush()` before closing. Panel removal waits for `flush()` to resolve.
- No confirm dialog needed (auto-save means no "unsaved changes" state).

---

## Architecture summary

```
[...slug].astro
  ├── sidebar--left
  │     └── [data-notes-sidebar]  ← JS: notes-sidebar.ts
  │           ├── chapter <details> (JS-rendered, same CSS classes)
  │           │     ├── <summary> (right-click → chapter context menu, dragover drop zone)
  │           │     └── lesson rows (right-click → note context menu, draggable)
  │           └── listens: window 'notes-sidebar-refresh'
  │
  └── content-area  ← dockview root: dockview-workspace.ts
        └── DockviewPanel (note-panel)
              ├── CustomHeader (transparent, draggable, pencil icon)
              └── PanelBody
                    ├── preview: rendered HTML
                    └── edit: mountInlineNotesEditor() + NotesPersistence
```

---

## New files

| File | Purpose |
|---|---|
| `src/scripts/course/sidebar/notes-sidebar.ts` | Dynamic sidebar tree: render, context menu, DnD |
| `src/scripts/course/dockview-workspace.ts` | Dockview init, panel management, openNote() |
| `src/scripts/course/notes-persistence.ts` | Auto-save debounce, localStorage buffer, recovery |

## Modified files

| File | Change |
|---|---|
| `src/pages/[...slug].astro` | Replace teacher chapter list with `[data-notes-sidebar]` placeholder; remove E/C buttons; wrap `.content-area` in dockview root |
| `src/scripts/course/notes/inline-editor.ts` | Remove save button; dispatch `notes-sidebar-refresh` after mutations; integrate `NotesPersistence` |
| `src/scripts/notes-editor/api.ts` | No change (reused as-is) |

## Out of scope (future)

- Dockview layout persistence across page loads
- Right sidebar (forum) as a dockview panel
- Note preview/edit side-by-side as a preset layout
- Keyboard shortcut for split panel
