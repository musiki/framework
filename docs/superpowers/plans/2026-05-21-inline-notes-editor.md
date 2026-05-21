# Inline Notes Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the GitHub-based textarea editor (triggered by `?mode=edit/create` URL params) with the CodeMirror + filesystem notes-editor embedded inline in the slug content area when the teacher presses C or E.

**Architecture:** A new `mountInlineNotesEditor()` function in `src/scripts/course/notes/inline-editor.ts` imports from the existing `notes-editor/` modules (tree, editor, api, yaml-strip, toolbar) and renders a two-column panel inline. The slug replaces `<a href>` buttons with `<button data-notes-action>` and a boot script wires everything client-side. The old server-side textarea form and `isEditorActive` logic are removed entirely.

**Tech Stack:** Astro (SSR), TypeScript, CodeMirror 6 (via existing `notes-editor/editor.ts`), local filesystem API (`/api/notes/*`), gray-matter (via existing yaml-strip).

---

## File Map

| Action | File | Purpose |
|--------|------|---------|
| Create | `src/scripts/course/notes/inline-editor.ts` | Mount function — two-column layout, open/close, delegates to notes-editor modules |
| Modify | `src/pages/[...slug].astro` | Remove old editor form + isEditorActive logic; add mount div + boot script; change buttons |
| Modify | `.env` | Add `CONTENT_ADMIN_LOCAL_WRITE=true` to unblock the API |

Existing files **not touched**: all `src/scripts/notes-editor/*.ts`, `src/pages/api/notes/*.ts`, `src/lib/notes-fs.ts`.

---

## Task 1: Unblock the API (503 fix)

**Files:**
- Modify: `.env`

- [ ] **Step 1: Add env var**

Open `.env` and add at the end:
```
CONTENT_ADMIN_LOCAL_WRITE=true
```

- [ ] **Step 2: Verify the API responds**

In a terminal with dev server running (`npm run dev`), test while logged in:
```bash
curl -s "http://localhost:4321/api/notes/list?courseId=s123" \
  -H "Cookie: <paste session cookie from browser devtools>"
```
Expected: JSON with `{ notes: [...] }` or `{ notes: [] }` — NOT 503.

If still 503, check `src/lib/content-admin.ts:180` — `isLocalContentAdminEnabled()` reads `process.env.CONTENT_ADMIN_LOCAL_WRITE`. Restart dev server after editing `.env`.

- [ ] **Step 3: Commit**

```bash
git add .env
git commit -m "fix: enable local content admin write for notes API"
```

---

## Task 2: Create `inline-editor.ts` module

**Files:**
- Create: `src/scripts/course/notes/inline-editor.ts`

`★ Insight ─────────────────────────────────────`
The existing `notes-editor/` modules (tree, editor, api, yaml-strip, toolbar) were designed for the standalone `/notas-editor` page. This module adapts them for inline use — same logic, different container.
`─────────────────────────────────────────────────`

- [ ] **Step 1: Create the file**

Create `src/scripts/course/notes/inline-editor.ts`:

```typescript
import { listNotes, getNote, saveNote, createNote } from '../../notes-editor/api';
import { renderTree } from '../../notes-editor/tree';
import { createEditor, getEditorContent, setEditorContent } from '../../notes-editor/editor';
import { parseFrontmatter, serializeFrontmatter, populateYamlStrip, readYamlStrip } from '../../notes-editor/yaml-strip';
import { initToolbar } from '../../notes-editor/toolbar';
import type { NoteListItem } from '../../notes-editor/types';

export type InlineEditorOptions = {
  mountEl: HTMLElement;
  contentEl: HTMLElement;
  courseId: string;
  slug: string | null;
  mode: 'edit' | 'create';
};

let mounted = false;
let editorMounted = false;
let allNotes: NoteListItem[] = [];
let activeSlug: string | null = null;

function setStatus(msg: string, type?: 'ok' | 'error') {
  const bar = document.getElementById('nie-status')!;
  if (!bar) return;
  bar.textContent = msg;
  bar.className = type ?? '';
  if (type === 'ok') setTimeout(() => { bar.textContent = 'listo'; bar.className = ''; }, 2500);
}

function refreshTree(mountEl: HTMLElement, courseId: string, onSelect: (slug: string) => void) {
  const treeEl = mountEl.querySelector<HTMLElement>('#nie-tree-scroll');
  if (!treeEl) return;
  renderTree(treeEl, allNotes, activeSlug, {
    onSelect,
    onCreate: async chapter => {
      const title = prompt('Título de la nueva nota:');
      if (!title) return;
      const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      const maxOrder = Math.max(0, ...allNotes.filter(n => n.chapter === chapter).map(n => n.order));
      try {
        const result = await createNote(courseId, { slug, title, type: 'lesson', chapter, status: 'draft', order: maxOrder + 1 });
        const d = await listNotes(courseId);
        allNotes = d.notes;
        onSelect(result.slug);
      } catch (e: any) { setStatus(e.message, 'error'); }
    },
    onDelete: async () => { /* tree-level delete out of scope for inline */ },
    onRename: async () => { /* out of scope for inline */ },
    onOrderChange: async () => {},
  });
}

async function loadNote(mountEl: HTMLElement, courseId: string, slug: string) {
  setStatus('Cargando...');
  try {
    const data = await getNote(courseId, slug);
    activeSlug = slug;
    const { data: fm } = parseFrontmatter(data.content);
    const titleInput = mountEl.querySelector<HTMLInputElement>('#nie-title');
    if (titleInput) titleInput.value = fm.title || '';
    populateYamlStrip(allNotes, fm);

    const editorWrap = mountEl.querySelector<HTMLElement>('#nie-editor-wrap')!;
    if (!editorMounted) {
      createEditor(editorWrap, data.content, () => {});
      editorMounted = true;
    } else {
      setEditorContent(data.content);
    }

    initToolbar(courseId, setStatus);
    refreshTree(mountEl, courseId, s => loadNote(mountEl, courseId, s));
    setStatus('listo');
  } catch (e: any) { setStatus(e.message, 'error'); }
}

async function saveCurrentNote(courseId: string) {
  if (!activeSlug) return;
  setStatus('Guardando...');
  try {
    const raw = getEditorContent();
    const { data: fm, body } = parseFrontmatter(raw);
    const strip = readYamlStrip();
    const merged = { ...fm, ...strip } as any;
    const titleInput = document.getElementById('nie-title') as HTMLInputElement | null;
    if (titleInput?.value.trim()) merged.title = titleInput.value.trim();
    const content = serializeFrontmatter(merged, body);
    await saveNote(courseId, activeSlug, content);
    const d = await listNotes(courseId);
    allNotes = d.notes;
    setStatus('Guardado', 'ok');
  } catch (e: any) { setStatus(e.message, 'error'); }
}

export function mountInlineNotesEditor({ mountEl, contentEl, courseId, slug, mode }: InlineEditorOptions): void {
  // Reset state for re-mount
  mounted = false;
  editorMounted = false;
  allNotes = [];
  activeSlug = null;

  // Build layout
  mountEl.innerHTML = `
    <div id="nie-header" style="display:flex;align-items:center;gap:.6rem;padding:.4rem .8rem;background:#111;border-bottom:1px solid #222;font-size:11px;color:#555;flex-shrink:0;">
      <strong style="color:#888;">Editor — ${courseId}</strong>
      <span id="nie-status" style="margin-left:auto;font-size:10px;color:#666;"></span>
      <button id="nie-save" type="button" style="background:#1a2a1a;border:1px solid #3a5a3a;color:#7ec87e;border-radius:3px;padding:2px 8px;font-size:10px;cursor:pointer;">Guardar</button>
      <button id="nie-close" type="button" style="background:none;border:none;color:#555;cursor:pointer;font-size:14px;line-height:1;" title="Cerrar editor">✕</button>
    </div>
    <div style="display:flex;flex:1;overflow:hidden;">
      <div id="nie-tree-panel" style="width:220px;background:#111;border-right:1px solid #2a2a2a;display:flex;flex-direction:column;overflow:hidden;flex-shrink:0;">
        <div id="nie-tree-scroll" style="flex:1;overflow-y:auto;padding:.4rem 0;"></div>
      </div>
      <div style="flex:1;display:flex;flex-direction:column;overflow:hidden;">
        <div style="padding:.3rem .6rem;border-bottom:1px solid #1a1a1a;display:flex;gap:.4rem;align-items:center;">
          <input id="nie-title" type="text" placeholder="Título" style="flex:1;background:#0e0e0e;border:1px solid #2a2a2a;border-radius:3px;padding:3px 6px;font-size:11px;color:#ccc;"/>
        </div>
        <div id="nie-yaml-strip" style="display:none;"></div>
        <div id="nie-snippet-toolbar" style="display:none;"></div>
        <div id="nie-editor-wrap" style="flex:1;overflow:auto;"></div>
      </div>
    </div>
  `;
  mountEl.style.display = 'flex';
  mountEl.style.flexDirection = 'column';
  mountEl.style.overflow = 'hidden';
  mountEl.hidden = false;
  contentEl.hidden = true;
  mounted = true;

  // Wire close
  mountEl.querySelector('#nie-close')?.addEventListener('click', () => {
    mountEl.hidden = true;
    mountEl.innerHTML = '';
    contentEl.hidden = false;
    mounted = false;
    editorMounted = false;
  });

  // Wire save + Cmd/Ctrl+S
  mountEl.querySelector('#nie-save')?.addEventListener('click', () => saveCurrentNote(courseId));
  document.addEventListener('keydown', function onKey(e) {
    if (!mounted) { document.removeEventListener('keydown', onKey); return; }
    if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); saveCurrentNote(courseId); }
  });

  // Boot: load notes list then open
  listNotes(courseId)
    .then(async d => {
      allNotes = d.notes;
      if (mode === 'create') {
        const title = prompt('Título de la nueva nota:');
        if (!title) return;
        const newSlug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
        const maxOrder = Math.max(0, ...allNotes.map(n => n.order));
        const result = await createNote(courseId, { slug: newSlug, title, type: 'lesson', chapter: '', status: 'draft', order: maxOrder + 1 });
        const d2 = await listNotes(courseId);
        allNotes = d2.notes;
        await loadNote(mountEl, courseId, result.slug);
      } else if (slug) {
        await loadNote(mountEl, courseId, slug);
      } else {
        refreshTree(mountEl, courseId, s => loadNote(mountEl, courseId, s));
        setStatus('Seleccioná una nota del árbol');
      }
    })
    .catch(e => setStatus(e.message, 'error'));
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit --project tsconfig.json 2>&1 | head -20
```
Expected: no errors from `inline-editor.ts`. (Other pre-existing errors in the project are OK to ignore.)

- [ ] **Step 3: Commit**

```bash
git add src/scripts/course/notes/inline-editor.ts
git commit -m "feat: add mountInlineNotesEditor module"
```

---

## Task 3: Modify `[...slug].astro` — buttons + mount div + boot script

**Files:**
- Modify: `src/pages/[...slug].astro:668-679` (remove teacherCreateHref/teacherEditHref/cleanEditor vars)
- Modify: `src/pages/[...slug].astro:786-839` (remove isEditorActive server logic)
- Modify: `src/pages/[...slug].astro:850-865` (remove isEditorActive head style block)
- Modify: `src/pages/[...slug].astro:3575-3584` (change E/C buttons)
- Modify: `src/pages/[...slug].astro:3903` (remove is-editor-active class binding)
- Modify: `src/pages/[...slug].astro:3913-3957` (remove old editor form)
- Modify: `src/pages/[...slug].astro:3970` (add mount div after class-content)
- Modify: `src/pages/[...slug].astro:4346-4355` (replace old script with new boot script)

> **Note:** This file is 13,060 lines. Make each edit surgically. Read the surrounding context before each edit to confirm line numbers haven't shifted.

- [ ] **Step 1: Remove `teacherCreateHref`, `teacherEditHref`, `cleanEditorSearchParams`, `cleanEditorHref` (lines ~668-679)**

Find and remove:
```ts
const teacherCreateHref = canManageLiveInteractions
  ? `${Astro.url.pathname}?mode=create&dir=${encodeURIComponent(currentEntrySourceDir)}`
  : '';
const teacherEditHref =
  canManageLiveInteractions && currentEntrySourcePath
    ? `${Astro.url.pathname}?mode=edit`
    : '';
const cleanEditorSearchParams = new URLSearchParams(Astro.url.searchParams);
cleanEditorSearchParams.delete('mode');
cleanEditorSearchParams.delete('path');
cleanEditorSearchParams.delete('dir');
const cleanEditorHref = `${Astro.url.pathname}${cleanEditorSearchParams.toString() ? `?${cleanEditorSearchParams.toString()}` : ''}`;
```

- [ ] **Step 2: Remove the `isEditorActive` server-side block (lines ~786-839)**

Find and remove this entire block (from `const editorMode` through the closing `}`):
```ts
const editorMode = String(Astro.url.searchParams.get('mode') || '').trim().toLowerCase();
const isEditing = canManageLiveInteractions && editorMode === 'edit';
const isCreating = canManageLiveInteractions && editorMode === 'create';
const isEditorActive = isEditing || isCreating;

let editorInitialContent = '';
let editorInitialSha = '';
let editorError = '';
let editorTargetPath = isEditing ? ...

if (isEditorActive) {
  ...
}
```
(This block spans approximately lines 786–839 — read the file around this range and remove the full block.)

- [ ] **Step 3: Remove the `isEditorActive` style block in `<head>` (lines ~854-865)**

Find and remove:
```astro
{isEditorActive && (
  <style>
    .content-area.is-editor-active { ... }
    .class-content[hidden] { ... }
    .integrated-editor-shell { ... }
    .integrated-editor { ... }
    ...
  </style>
)}
```
(Read the file from line 854 to find the closing `)}` of this block.)

- [ ] **Step 4: Remove `isEditorActive` from `<BaseHead>` title (line ~850)**

Find:
```astro
title={isEditorActive ? `${isCreating ? 'Creando' : 'Editando'}: ${currentEntry.data.title || 'Nueva nota'}` : (currentEntry.data.title || courseIndex?.data?.title)}
```
Replace with:
```astro
title={currentEntry.data.title || courseIndex?.data?.title}
```

- [ ] **Step 5: Change E/C buttons (lines ~3575-3584)**

Find:
```astro
{(teacherEditHref || teacherCreateHref) && (
  <div class="course-teacher-actions" aria-label="Acciones docentes">
    {teacherEditHref && (
      <a href={teacherEditHref} class="teacher-action-btn" title="Editar esta nota" aria-label="Editar">E</a>
    )}
    {teacherCreateHref && (
      <a href={teacherCreateHref} class="teacher-action-btn teacher-action-btn--create" title="Crear nueva nota" aria-label="Crear">C</a>
    )}
  </div>
)}
```

Replace with:
```astro
{canManageLiveInteractions && (
  <div class="course-teacher-actions" aria-label="Acciones docentes">
    {lessonSlug && (
      <button
        class="teacher-action-btn"
        title="Editar esta nota"
        aria-label="Editar"
        data-notes-action="edit"
        data-course-id={canonicalCourseId || courseSlug}
        data-slug={lessonSlug}
      >E</button>
    )}
    <button
      class="teacher-action-btn teacher-action-btn--create"
      title="Crear nueva nota"
      aria-label="Crear"
      data-notes-action="create"
      data-course-id={canonicalCourseId || courseSlug}
    >C</button>
  </div>
)}
```

- [ ] **Step 6: Remove `is-editor-active` class binding from `<article>` (line ~3903)**

Find:
```astro
<article class:list={['content-area', { 'is-editor-active': isEditorActive }]} transition:name="course-content" transition:animate="fade">
```
Replace with:
```astro
<article class="content-area" transition:name="course-content" transition:animate="fade">
```

- [ ] **Step 7: Remove old editor form block (lines ~3913-3957)**

Find and remove the entire block:
```astro
{isEditorActive && (
  <section class="integrated-editor-shell" data-inline-editor>
    ...
  </section>
)}
```

- [ ] **Step 8: Remove `hidden={isEditorActive}` from class-content div (line ~3959)**

Find:
```astro
<div class="class-content" data-class-content data-entry-type={...} hidden={isEditorActive}>
```
Replace with:
```astro
<div class="class-content" data-class-content data-entry-type={isRecursosEditorPage ? 'recursos-editor' : currentEntryType}>
```

- [ ] **Step 9: Add mount div after class-content closing tag (after line ~3970)**

After the `</div>` that closes `class-content`, add:
```astro
<div id="notes-editor-mount" hidden style="flex:1;display:flex;flex-direction:column;overflow:hidden;min-height:0;"></div>
```

- [ ] **Step 10: Replace old boot script with new one (lines ~4346-4355)**

Find:
```astro
{isEditorActive && (
  <script>
    import { mountIntegratedCourseNotesEditor } from '../scripts/course/notes/index.ts';

    mountIntegratedCourseNotesEditor();
    document.addEventListener('astro:page-load', () => {
      mountIntegratedCourseNotesEditor();
    });
  </script>
)}
```

Replace with:
```astro
{canManageLiveInteractions && (
  <script>
    import { mountInlineNotesEditor } from '../scripts/course/notes/inline-editor.ts';

    function bootInlineEditor() {
      const mountEl = document.getElementById('notes-editor-mount') as HTMLElement | null;
      const contentEl = document.querySelector<HTMLElement>('[data-class-content]');
      if (!mountEl || !contentEl) return;

      document.querySelectorAll<HTMLElement>('[data-notes-action]').forEach(btn => {
        if (btn.dataset.notesBound) return;
        btn.dataset.notesBound = 'true';
        btn.addEventListener('click', () => {
          const mode = (btn.dataset.notesAction || 'edit') as 'edit' | 'create';
          const courseId = btn.dataset.courseId || '';
          const slug = btn.dataset.slug || null;
          mountInlineNotesEditor({ mountEl: mountEl!, contentEl: contentEl!, courseId, slug, mode });
        });
      });
    }

    bootInlineEditor();
    document.addEventListener('astro:page-load', bootInlineEditor);
  </script>
)}
```

- [ ] **Step 11: Check for remaining references to removed variables**

```bash
grep -n "isEditorActive\|isEditing\|isCreating\|editorMode\|editorInitialContent\|editorInitialSha\|editorTargetPath\|editorError\|teacherCreateHref\|teacherEditHref\|cleanEditorHref\|cleanEditorSearchParams" src/pages/\[...slug\].astro | grep -v "^[[:space:]]*//"
```

Expected: no output. If any remain, remove or replace them.

- [ ] **Step 12: Commit**

```bash
git add src/pages/\[...slug\].astro
git commit -m "feat: wire inline notes editor — replace textarea editor with CodeMirror embed"
```

---

## Task 4: Smoke test in browser

- [ ] **Step 1: Start dev server**

```bash
npm run dev
```

- [ ] **Step 2: Navigate to a lesson as a teacher**

Open `http://localhost:4321/s123/<any-lesson-slug>` while logged in as a teacher account.

- [ ] **Step 3: Test E button**

Click E → the content area should be replaced by the two-column editor with the note tree on the left and CodeMirror on the right. The note for `<lesson-slug>` should load.

- [ ] **Step 4: Test C button**

Click C → prompt for title → enter a title → a new note should be created and opened in the editor.

- [ ] **Step 5: Test save**

Make a small edit in CodeMirror → click "Guardar" or press Cmd/Ctrl+S → status shows "Guardado".

- [ ] **Step 6: Test close**

Click ✕ → the content area returns to the original lesson content.

- [ ] **Step 7: Final commit if any fixes were needed**

```bash
git add -p
git commit -m "fix: inline notes editor smoke test fixes"
```
