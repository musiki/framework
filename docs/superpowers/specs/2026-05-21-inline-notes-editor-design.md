# Inline Notes Editor — Design Spec

**Date:** 2026-05-21  
**Status:** Approved  

## Goal

Replace the current server-side GitHub-based textarea editor (triggered by `?mode=edit/create` URL params) with the new CodeMirror + filesystem notes-editor, embedded inline in the slug content area when the teacher presses C or E.

## Architecture

```
[...slug].astro  (buttons as <button data-notes-action>)
  └── boot script (inline <script> in slug)
        └── src/scripts/course/notes/inline-editor.ts  [new]
              ├── notes-editor/tree.ts
              ├── notes-editor/editor.ts
              ├── notes-editor/api.ts
              ├── notes-editor/yaml-strip.ts
              └── notes-editor/toolbar.ts
```

## New Module: `src/scripts/course/notes/inline-editor.ts`

Single exported function:

```ts
mountInlineNotesEditor({
  mountEl: HTMLElement,    // #notes-editor-mount
  contentEl: HTMLElement,  // [data-class-content]
  courseId: string,
  slug: string | null,     // null = create mode
  mode: 'edit' | 'create'
}): void
```

**Behavior:**
- Hides `contentEl`, shows `mountEl`
- Renders two-column layout: tree (220px left) + CodeMirror (flex right)
- Header bar with course/slug info and ✕ close button
- Close restores `contentEl`, hides `mountEl`, clears editor state
- Edit mode: loads note by slug immediately
- Create mode: prompts for title → derives slug → calls `createNote` → loads
- Reuses tree, editor, api, yaml-strip, toolbar from `notes-editor/` unchanged
- Idempotent: calling twice does not double-mount

## Slug Changes (`[...slug].astro`)

### Remove
- Lines ~3913-3956: `{isEditorActive && <section class="integrated-editor-shell">}` block (old textarea form)
- Lines ~4346-4354: `{isEditorActive && <script>mountIntegratedCourseNotesEditor()</script>}` block
- Server-side variables: `isEditorActive`, `isEditing`, `isCreating`, `editorMode`, `editorInitialContent`, `editorInitialSha`, `editorTargetPath`, `editorError`, `teacherCreateHref`, `teacherEditHref`, `cleanEditorHref`, `cleanEditorSearchParams`
- Imports no longer needed: `mountIntegratedCourseNotesEditor`

### Change
Lines ~3577-3581 — teacher action buttons:

```astro
<!-- Before -->
<a href={teacherEditHref} class="teacher-action-btn">E</a>
<a href={teacherCreateHref} class="teacher-action-btn teacher-action-btn--create">C</a>

<!-- After -->
<button class="teacher-action-btn" data-notes-action="edit"
  data-course-id={canonicalCourseId} data-slug={lessonSlug}>E</button>
<button class="teacher-action-btn teacher-action-btn--create" data-notes-action="create"
  data-course-id={canonicalCourseId}>C</button>
```

### Add
After the `<div class="class-content" data-class-content>` div:

```astro
<div id="notes-editor-mount" hidden style="flex:1;display:flex;flex-direction:column;overflow:hidden;"></div>
```

Boot script (replaces removed isEditorActive script block):

```astro
{canManageLiveInteractions && (
  <script>
    import { mountInlineNotesEditor } from '../scripts/course/notes/inline-editor.ts';

    function boot() {
      const mountEl = document.getElementById('notes-editor-mount');
      const contentEl = document.querySelector('[data-class-content]');
      if (!mountEl || !contentEl) return;

      document.querySelectorAll('[data-notes-action]').forEach(btn => {
        if (btn.dataset.notesBound) return;
        btn.dataset.notesBound = 'true';
        btn.addEventListener('click', () => {
          const mode = btn.dataset.notesAction;
          const courseId = btn.dataset.courseId || '';
          const slug = btn.dataset.slug || null;
          mountInlineNotesEditor({ mountEl, contentEl, courseId, slug, mode });
        });
      });
    }

    boot();
    document.addEventListener('astro:page-load', boot);
  </script>
)}
```

## API Endpoints

The `/api/notes/*` endpoints (`list`, `get`, `save`, `create`, `delete`, `move`) save directly to the local filesystem via `notes-fs.ts`. Session auth required — teacher role checked via `resolveLiveManageAccess`.

503 errors in dev are likely caused by missing session or DB connection. Fix: add graceful error handling in the mount function (show error state instead of crashing).

## Out of Scope

- Obsidian ↔ Musiki sync (separate future task)
- The standalone `/notas-editor` page (kept as-is, separate entrypoint)
- `isStudentEnrolled`, forum, and other slug sections (untouched)
