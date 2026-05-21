# Dynamic Notes Sidebar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the static Astro chapter/lesson list in the course left sidebar with a JS-rendered tree (teacher-only) that supports right-click context menus and drag-and-drop reordering, mirroring the Recursos Editor pattern.

**Architecture:** A single module `notes-sidebar.ts` owns rendering, context menus, and DnD. It reuses `api.ts` and `yaml-strip.ts` from `notes-editor`. The Astro page replaces the teacher chapter list with a `<div data-notes-sidebar>` placeholder and adds a script tag to init the module. Mutations dispatch a `notes-sidebar-refresh` CustomEvent on `window`; the sidebar listener re-fetches and re-renders.

**Tech Stack:** TypeScript (browser), HTML drag-and-drop API, existing `/api/notes/*` endpoints, `parseFrontmatter`/`serializeFrontmatter` from `yaml-strip.ts`, Node built-in test runner for pure utility tests.

---

## File map

| File | Action | Purpose |
|---|---|---|
| `src/scripts/course/sidebar/notes-sidebar.ts` | Create | All sidebar logic: grouping, rendering, context menus, DnD |
| `src/scripts/course/sidebar/notes-sidebar.test.mjs` | Create | Unit tests for pure utility functions |
| `src/pages/[...slug].astro` | Modify | Placeholder + init script for teacher sidebar; remove E/C buttons |
| `src/scripts/course/notes/inline-editor.ts` | Modify | Dispatch `notes-sidebar-refresh` after save |

---

### Task 1: Pure utility functions + tests

**Files:**
- Create: `src/scripts/course/sidebar/notes-sidebar.ts` (utilities only)
- Create: `src/scripts/course/sidebar/notes-sidebar.test.mjs`

- [ ] **Step 1.1: Create the module file with utilities**

```typescript
// src/scripts/course/sidebar/notes-sidebar.ts
import type { NoteListItem } from '../../notes-editor/types';

export type ChapterGroup = { name: string; notes: NoteListItem[] };

export function groupByChapter(notes: NoteListItem[]): ChapterGroup[] {
  const map = new Map<string, NoteListItem[]>();
  for (const note of notes) {
    const ch = note.chapter || '(sin capítulo)';
    if (!map.has(ch)) map.set(ch, []);
    map.get(ch)!.push(note);
  }
  return Array.from(map.entries())
    .map(([name, notes]) => ({
      name,
      notes: [...notes].sort((a, b) => a.order - b.order || a.title.localeCompare(b.title)),
    }))
    .sort((a, b) => {
      const minA = Math.min(...a.notes.map(n => n.order));
      const minB = Math.min(...b.notes.map(n => n.order));
      return minA - minB || a.name.localeCompare(b.name);
    });
}

export function computeNewOrders(
  notesInChapter: NoteListItem[],
  draggedSlug: string,
  insertAfterSlug: string | null,
): { slug: string; order: number }[] {
  const withoutDragged = notesInChapter.filter(n => n.slug !== draggedSlug);
  const dragged = notesInChapter.find(n => n.slug === draggedSlug);
  if (!dragged) return [];
  const insertIdx = insertAfterSlug === null
    ? 0
    : withoutDragged.findIndex(n => n.slug === insertAfterSlug) + 1;
  const reordered = [
    ...withoutDragged.slice(0, insertIdx),
    dragged,
    ...withoutDragged.slice(insertIdx),
  ];
  return reordered.map((n, i) => ({ slug: n.slug, order: i }));
}

export function noteSlugToUrl(slug: string, courseId: string): string {
  // slug = "cursos/s123/10 Chapter/note.md" → "/s123/10-chapter/note"
  const relPath = slug
    .replace(`cursos/${courseId}/`, '')
    .replace(/\.md$/, '');
  const normalized = relPath
    .split('/')
    .map(seg =>
      seg.normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/\s+/g, '-')
        .toLowerCase(),
    )
    .join('/');
  return `/${courseId}/${normalized}`;
}

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

export function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
```

- [ ] **Step 1.2: Write tests**

```javascript
// src/scripts/course/sidebar/notes-sidebar.test.mjs
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// Import as CommonJS-compatible ESM (the TS will be transpiled by Astro/vite for browser,
// so we test the logic extracted as pure JS here)
const { groupByChapter, computeNewOrders, noteSlugToUrl, slugify } = await import(
  './notes-sidebar-utils.mjs'
);

describe('groupByChapter', () => {
  test('groups notes by chapter and sorts by order', () => {
    const notes = [
      { slug: 'a', title: 'A', chapter: 'Ch1', order: 2, type: 'lesson', status: 'draft', filePath: 'a' },
      { slug: 'b', title: 'B', chapter: 'Ch1', order: 1, type: 'lesson', status: 'draft', filePath: 'b' },
      { slug: 'c', title: 'C', chapter: 'Ch2', order: 0, type: 'lesson', status: 'draft', filePath: 'c' },
    ];
    const groups = groupByChapter(notes);
    assert.equal(groups.length, 2);
    assert.equal(groups[0].name, 'Ch2'); // Ch2 has min order 0
    assert.equal(groups[1].notes[0].slug, 'b'); // Ch1 sorted: b(1) before a(2)
  });

  test('notes without chapter go to (sin capítulo)', () => {
    const notes = [
      { slug: 'x', title: 'X', chapter: '', order: 0, type: 'lesson', status: 'draft', filePath: 'x' },
    ];
    const groups = groupByChapter(notes);
    assert.equal(groups[0].name, '(sin capítulo)');
  });
});

describe('computeNewOrders', () => {
  const notes = [
    { slug: 'a', order: 0 },
    { slug: 'b', order: 1 },
    { slug: 'c', order: 2 },
  ];

  test('moves c to first position', () => {
    const result = computeNewOrders(notes, 'c', null);
    assert.deepEqual(result.map(r => r.slug), ['c', 'a', 'b']);
    assert.deepEqual(result.map(r => r.order), [0, 1, 2]);
  });

  test('moves a after c', () => {
    const result = computeNewOrders(notes, 'a', 'c');
    assert.deepEqual(result.map(r => r.slug), ['b', 'c', 'a']);
  });
});

describe('noteSlugToUrl', () => {
  test('converts repo path to course URL', () => {
    const url = noteSlugToUrl('cursos/s123/10 Introducción/lesson-01.md', 's123');
    assert.equal(url, '/s123/10-introduccion/lesson-01');
  });
});

describe('slugify', () => {
  test('normalizes title to slug', () => {
    assert.equal(slugify('Armonía Básica'), 'armonia-basica');
    assert.equal(slugify('  Intro  '), 'intro');
  });
});
```

- [ ] **Step 1.3: Create the utils `.mjs` companion file so the test can import without Vite**

```javascript
// src/scripts/course/sidebar/notes-sidebar-utils.mjs
// Pure utility functions mirrored from notes-sidebar.ts for Node test runner

export function groupByChapter(notes) {
  const map = new Map();
  for (const note of notes) {
    const ch = note.chapter || '(sin capítulo)';
    if (!map.has(ch)) map.set(ch, []);
    map.get(ch).push(note);
  }
  return Array.from(map.entries())
    .map(([name, notes]) => ({
      name,
      notes: [...notes].sort((a, b) => a.order - b.order || a.title?.localeCompare(b.title ?? '') ?? 0),
    }))
    .sort((a, b) => {
      const minA = Math.min(...a.notes.map(n => n.order));
      const minB = Math.min(...b.notes.map(n => n.order));
      return minA - minB || a.name.localeCompare(b.name);
    });
}

export function computeNewOrders(notesInChapter, draggedSlug, insertAfterSlug) {
  const withoutDragged = notesInChapter.filter(n => n.slug !== draggedSlug);
  const dragged = notesInChapter.find(n => n.slug === draggedSlug);
  if (!dragged) return [];
  const insertIdx = insertAfterSlug === null
    ? 0
    : withoutDragged.findIndex(n => n.slug === insertAfterSlug) + 1;
  const reordered = [
    ...withoutDragged.slice(0, insertIdx),
    dragged,
    ...withoutDragged.slice(insertIdx),
  ];
  return reordered.map((n, i) => ({ slug: n.slug, order: i }));
}

export function noteSlugToUrl(slug, courseId) {
  const relPath = slug.replace(`cursos/${courseId}/`, '').replace(/\.md$/, '');
  const normalized = relPath.split('/').map(seg =>
    seg.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '-').toLowerCase()
  ).join('/');
  return `/${courseId}/${normalized}`;
}

export function slugify(title) {
  return title.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-');
}
```

- [ ] **Step 1.4: Update `package.json` test glob to include new test file**

In `package.json`, change:
```json
"test": "node --test \"src/lib/live/*.test.mjs\""
```
to:
```json
"test": "node --test \"src/lib/live/*.test.mjs\" \"src/scripts/course/sidebar/*.test.mjs\""
```

- [ ] **Step 1.5: Run tests, verify pass**

```bash
cd /Users/zztt/projects/26-musiki/framework && npm test
```
Expected: all tests pass, no failures.

- [ ] **Step 1.6: Commit**

```bash
git add src/scripts/course/sidebar/ package.json
git commit -m "feat: notes-sidebar utility functions with tests (groupByChapter, computeNewOrders, noteSlugToUrl)"
```

---

### Task 2: renderNotesSidebar — tree HTML using sidebar CSS classes

**Files:**
- Modify: `src/scripts/course/sidebar/notes-sidebar.ts` (add render function)

- [ ] **Step 2.1: Add context menu helpers to the module**

Append to `src/scripts/course/sidebar/notes-sidebar.ts`:

```typescript
// ── Context menu ──────────────────────────────────────────────────────────

let activeMenu: HTMLElement | null = null;

function closeMenu() {
  activeMenu?.remove();
  activeMenu = null;
}

type MenuItem =
  | { label: string; action: () => void; danger?: boolean }
  | { separator: true };

export function showContextMenu(x: number, y: number, items: MenuItem[]) {
  closeMenu();
  const menu = document.createElement('div');
  menu.style.cssText = [
    `position:fixed;left:${x}px;top:${y}px;`,
    'background:var(--c-bg-surface,var(--c-bg-mute));',
    'border:1px solid var(--c-border);border-radius:4px;',
    'padding:3px 0;z-index:9999;min-width:168px;',
    'box-shadow:0 4px 12px rgba(0,0,0,.4);',
  ].join('');

  for (const item of items) {
    if ('separator' in item) {
      const sep = document.createElement('hr');
      sep.style.cssText = 'border:none;border-top:1px solid var(--c-border);margin:3px 0;';
      menu.appendChild(sep);
      continue;
    }
    const el = document.createElement('div');
    el.textContent = item.label;
    el.style.cssText = `padding:4px 12px;font-size:11px;cursor:pointer;color:${item.danger ? '#c87e7e' : 'var(--c-fg)'};`;
    el.addEventListener('mouseenter', () => { el.style.background = 'var(--c-bg-alt,var(--c-bg-mute))'; });
    el.addEventListener('mouseleave', () => { el.style.background = ''; });
    el.addEventListener('click', () => { closeMenu(); item.action(); });
    menu.appendChild(el);
  }

  activeMenu = menu;
  document.body.appendChild(menu);
  // Flip up if off-screen
  requestAnimationFrame(() => {
    const rect = menu.getBoundingClientRect();
    if (rect.bottom > window.innerHeight) menu.style.top = `${y - rect.height}px`;
    if (rect.right > window.innerWidth) menu.style.left = `${x - rect.width}px`;
  });
}

if (typeof document !== 'undefined') {
  document.addEventListener('click', closeMenu);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeMenu(); });
}
```

- [ ] **Step 2.2: Add renderNotesSidebar function**

Append to `src/scripts/course/sidebar/notes-sidebar.ts`:

```typescript
import { listNotes, getNote, saveNote, createNote, deleteNote, moveNote } from '../../notes-editor/api';
import { parseFrontmatter, serializeFrontmatter } from '../../notes-editor/yaml-strip';

function dispatchRefresh() {
  window.dispatchEvent(new CustomEvent('notes-sidebar-refresh'));
}

export function renderNotesSidebar(
  container: HTMLElement,
  notes: NoteListItem[],
  activeSlug: string | null,
  courseId: string,
): void {
  container.innerHTML = '';
  const groups = groupByChapter(notes);

  let draggingSlug: string | null = null;
  let activeDropTarget: HTMLElement | null = null;

  function clearDropState() {
    activeDropTarget?.classList.remove('ns-drag-over');
    container.querySelectorAll<HTMLElement>('.ns-drop-line').forEach(el => {
      el.style.height = '0';
      el.style.background = '';
    });
    activeDropTarget = null;
  }

  for (const group of groups) {
    // ── Chapter wrapper ────────────────────────────────────────────────
    const chapterEl = document.createElement('div');
    chapterEl.className = 'chapter';

    const details = document.createElement('details');
    details.className = 'chapter-details';
    details.open = true;

    // ── Chapter summary ────────────────────────────────────────────────
    const summary = document.createElement('summary');
    summary.className = 'chapter-title';
    summary.innerHTML = `
      <span class="chapter-title-main">
        <span class="chapter-title-text">${escHtml(group.name)}</span>
      </span>
      <span class="chapter-caret">
        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </span>
    `;

    // Chapter context menu
    summary.addEventListener('contextmenu', e => {
      e.preventDefault();
      e.stopPropagation();
      showContextMenu(e.clientX, e.clientY, [
        {
          label: 'Nueva nota en este capítulo',
          action: async () => {
            const title = prompt('Título:');
            if (!title) return;
            const maxOrder = group.notes.length ? Math.max(...group.notes.map(n => n.order)) : -1;
            await createNote(courseId, {
              slug: slugify(title), title, type: 'lesson',
              chapter: group.name, status: 'draft', order: maxOrder + 1,
            });
            dispatchRefresh();
          },
        },
        {
          label: 'Renombrar capítulo',
          action: async () => {
            const newName = prompt('Nuevo nombre:', group.name);
            if (!newName || newName === group.name) return;
            for (const note of group.notes) {
              const nd = await getNote(courseId, note.slug);
              const { data: fm, body } = parseFrontmatter(nd.content);
              (fm as any).chapter = newName;
              await saveNote(courseId, note.slug, serializeFrontmatter(fm as any, body));
            }
            dispatchRefresh();
          },
        },
        {
          label: 'Nuevo subcapítulo',
          action: async () => {
            const chapterName = prompt('Nombre del capítulo:');
            if (!chapterName) return;
            const title = prompt('Título de la primera nota:');
            if (!title) return;
            await createNote(courseId, {
              slug: slugify(title), title, type: 'lesson',
              chapter: chapterName, status: 'draft', order: 0,
            });
            dispatchRefresh();
          },
        },
      ]);
    });

    // Chapter as cross-chapter drop target
    summary.addEventListener('dragover', e => {
      if (!draggingSlug) return;
      e.preventDefault();
      if (activeDropTarget !== summary) {
        clearDropState();
        activeDropTarget = summary;
        summary.classList.add('ns-drag-over');
      }
    });
    summary.addEventListener('dragleave', e => {
      if (!summary.contains(e.relatedTarget as Node)) {
        summary.classList.remove('ns-drag-over');
        if (activeDropTarget === summary) activeDropTarget = null;
      }
    });
    summary.addEventListener('drop', async e => {
      e.preventDefault();
      clearDropState();
      const slug = draggingSlug;
      if (!slug) return;
      const note = notes.find(n => n.slug === slug);
      if (!note || note.chapter === group.name) return;
      const maxOrder = group.notes.length ? Math.max(...group.notes.map(n => n.order)) : -1;
      const nd = await getNote(courseId, slug);
      const { data: fm, body } = parseFrontmatter(nd.content);
      (fm as any).chapter = group.name;
      (fm as any).order = maxOrder + 1;
      await saveNote(courseId, slug, serializeFrontmatter(fm as any, body));
      dispatchRefresh();
    });

    details.appendChild(summary);

    // ── Lesson list ────────────────────────────────────────────────────
    const ul = document.createElement('ul');
    ul.className = 'lesson-list';
    ul.style.cssText = 'padding:0;margin:0;list-style:none;';

    // Drop line before first note
    ul.appendChild(makeDropLine(group.name, null));

    for (const note of group.notes) {
      const li = document.createElement('li');
      li.style.cssText = 'list-style:none;padding:0;margin:0;';

      const isActive = note.slug === activeSlug;
      const noteUrl = noteSlugToUrl(note.slug, courseId);

      const a = document.createElement('a');
      a.href = noteUrl;
      a.className = 'lesson-link' + (isActive ? ' is-active-lesson' : '');
      a.textContent = note.title || note.slug.split('/').pop()?.replace('.md', '') || note.slug;
      a.draggable = true;

      // Emit note-open on click (Plan 2 will intercept; fallback = navigate)
      a.addEventListener('click', e => {
        const cancelled = !window.dispatchEvent(
          new CustomEvent('note-open', {
            detail: { slug: note.slug, courseId, mode: 'preview' },
            cancelable: true,
            bubbles: false,
          }),
        );
        if (cancelled) e.preventDefault();
      });

      // DnD
      a.addEventListener('dragstart', e => {
        draggingSlug = note.slug;
        e.dataTransfer!.setData('text/plain', note.slug);
        e.dataTransfer!.effectAllowed = 'move';
        setTimeout(() => { a.style.opacity = '.35'; }, 0);
      });
      a.addEventListener('dragend', () => {
        draggingSlug = null;
        a.style.opacity = '';
        clearDropState();
      });

      // Context menu
      a.addEventListener('contextmenu', e => {
        e.preventDefault();
        e.stopPropagation();
        showContextMenu(e.clientX, e.clientY, [
          {
            label: 'Editar',
            action: () => {
              const cancelled = !window.dispatchEvent(
                new CustomEvent('note-open', {
                  detail: { slug: note.slug, courseId, mode: 'edit' },
                  cancelable: true,
                  bubbles: false,
                }),
              );
              if (!cancelled) window.location.href = noteUrl;
            },
          },
          {
            label: 'Renombrar slug',
            action: async () => {
              const bare = note.slug.split('/').pop()?.replace('.md', '') ?? note.slug;
              const newBare = prompt('Nuevo slug (sin extensión):', bare);
              if (!newBare || newBare === bare) return;
              await moveNote(courseId, note.slug, newBare);
              dispatchRefresh();
            },
          },
          {
            label: 'Eliminar',
            danger: true,
            action: async () => {
              if (!confirm(`¿Eliminar "${note.title}"? Esta acción no se puede deshacer.`)) return;
              await deleteNote(courseId, note.slug);
              dispatchRefresh();
            },
          },
          { separator: true },
          {
            label: 'Nueva nota aquí',
            action: async () => {
              const title = prompt('Título:');
              if (!title) return;
              await createNote(courseId, {
                slug: slugify(title), title, type: 'lesson',
                chapter: note.chapter, status: 'draft', order: note.order + 0.5,
              });
              dispatchRefresh();
            },
          },
        ]);
      });

      li.appendChild(a);
      ul.appendChild(li);

      // Drop line after each note
      ul.appendChild(makeDropLine(group.name, note.slug));
    }

    details.appendChild(ul);
    chapterEl.appendChild(details);
    container.appendChild(chapterEl);
  }

  // ── Drop line factory ──────────────────────────────────────────────────

  function makeDropLine(chapter: string, afterSlug: string | null): HTMLElement {
    const li = document.createElement('li');
    li.className = 'ns-drop-line';
    li.style.cssText = 'height:0;list-style:none;padding:0;margin:0;transition:height 80ms,background 80ms;border-radius:1px;';

    li.addEventListener('dragover', e => {
      if (!draggingSlug) return;
      e.preventDefault();
      if (activeDropTarget !== li) {
        clearDropState();
        activeDropTarget = li;
        li.style.height = '3px';
        li.style.background = 'var(--c-link, #3b82f6)';
      }
    });
    li.addEventListener('dragleave', () => {
      if (activeDropTarget === li) {
        li.style.height = '0';
        li.style.background = '';
        activeDropTarget = null;
      }
    });
    li.addEventListener('drop', async e => {
      e.preventDefault();
      clearDropState();
      const slug = draggingSlug;
      if (!slug) return;

      const chapterGroup = groups.find(g => g.name === chapter);
      if (!chapterGroup) return;

      const note = notes.find(n => n.slug === slug);
      const crossChapter = note?.chapter !== chapter;

      const newOrders = computeNewOrders(
        crossChapter
          ? [...chapterGroup.notes, { ...note!, chapter, order: chapterGroup.notes.length }]
          : chapterGroup.notes,
        slug,
        afterSlug,
      );

      for (const { slug: s, order } of newOrders) {
        const existing = notes.find(n => n.slug === s);
        if (existing && (existing.order !== order || existing.chapter !== chapter)) {
          const nd = await getNote(courseId, s);
          const { data: fm, body } = parseFrontmatter(nd.content);
          (fm as any).order = order;
          (fm as any).chapter = chapter;
          await saveNote(courseId, s, serializeFrontmatter(fm as any, body));
        }
      }
      dispatchRefresh();
    });

    return li;
  }
}
```

- [ ] **Step 2.3: Run dev server and visually verify the tree renders correctly for a teacher user**

```bash
npm run dev
```

Navigate to a course page as a teacher. The left sidebar should show the JS-rendered chapter/note tree with the same visual appearance as before (same CSS classes). Verify chapters expand/collapse.

- [ ] **Step 2.4: Commit**

```bash
git add src/scripts/course/sidebar/notes-sidebar.ts
git commit -m "feat: renderNotesSidebar — chapter tree with context menus and DnD drop zones"
```

---

### Task 3: initNotesSidebar and CSS for drop states

**Files:**
- Modify: `src/scripts/course/sidebar/notes-sidebar.ts` (add init + CSS injection)

- [ ] **Step 3.1: Add initNotesSidebar and CSS injection**

Append to `src/scripts/course/sidebar/notes-sidebar.ts`:

```typescript
// ── CSS injection (once) ──────────────────────────────────────────────────

let cssInjected = false;
function injectCss() {
  if (cssInjected || typeof document === 'undefined') return;
  cssInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    .ns-drag-over.chapter-title {
      background: var(--c-bg-alt, var(--c-bg-mute)) !important;
      outline: 1px dashed var(--c-link, #3b82f6);
      outline-offset: -2px;
    }
    [data-notes-sidebar] .lesson-link.is-active-lesson {
      border-left-color: var(--c-link, #3b82f6);
      color: var(--c-link, #3b82f6);
    }
    [data-notes-sidebar] .lesson-link[draggable="true"] {
      cursor: grab;
    }
    [data-notes-sidebar] .lesson-link[draggable="true"]:active {
      cursor: grabbing;
    }
  `;
  document.head.appendChild(style);
}

// ── Init ──────────────────────────────────────────────────────────────────

export function initNotesSidebar(
  container: HTMLElement,
  courseId: string,
  activeSlug: string | null,
): void {
  injectCss();

  let currentActive = activeSlug;

  async function refresh() {
    try {
      const { notes } = await listNotes(courseId);
      renderNotesSidebar(container, notes, currentActive, courseId);
    } catch (err) {
      console.error('[notes-sidebar] failed to load notes', err);
    }
  }

  window.addEventListener('notes-sidebar-refresh', () => refresh());

  // Update active slug when workspace navigates to a different note
  window.addEventListener('note-open', (e: Event) => {
    const detail = (e as CustomEvent).detail as { slug?: string };
    if (detail?.slug) currentActive = detail.slug;
  });

  refresh();
}
```

- [ ] **Step 3.2: Verify in browser — right-click on a note shows context menu**

With dev server running, right-click a note row. Menu should show: Editar, Renombrar slug, Eliminar, separator, Nueva nota aquí.

- [ ] **Step 3.3: Verify in browser — right-click on chapter header shows chapter menu**

Right-click a `<summary>` / chapter title. Menu should show: Nueva nota en este capítulo, Renombrar capítulo, Nuevo subcapítulo.

- [ ] **Step 3.4: Commit**

```bash
git add src/scripts/course/sidebar/notes-sidebar.ts
git commit -m "feat: initNotesSidebar with CSS injection and window event listeners"
```

---

### Task 4: Wire placeholder into [...]slug.astro

**Files:**
- Modify: `src/pages/[...slug].astro`

- [ ] **Step 4.1: Find and replace the teacher chapter list rendering**

In `src/pages/[...slug].astro`, find the block inside `<aside class="sidebar sidebar--left">` that contains:
```
{(!isPublicWikiPage || Boolean(session)) && sidebarChapterEntries.map((entry) => {
```
(approximately line 3476).

**The change is a surgical wrap.** Keep ALL existing rendering code inside. Only wrap with a conditional:

```astro
{canManageLiveInteractions ? (
  <>
    {/* For teachers: recursos section stays static, notes replaced by dynamic sidebar */}
    {sidebarChapterEntries
      .filter((entry): entry is { kind: 'recursos' } => entry.kind === 'recursos')
      .slice(0, 1)
      .map(() => {
        // Copy the FULL existing `entry.kind === 'recursos'` rendering block verbatim here.
        // It starts with `<div class="chapter">` and contains the <details> + recursos-sidebar-tree.
        // Do not shorten or summarize it — copy it exactly as-is from the current code.
        return (/* existing recursos block unchanged */);
      })
    }
    {/* Dynamic notes sidebar — replaces the chapter loop for teachers */}
    <div
      data-notes-sidebar
      data-course-id={canonicalCourseId || courseSlug}
      data-active-slug={currentEntrySourcePath || ''}
    ></div>
  </>
) : (
  /* Non-teachers: existing static rendering, completely unchanged */
  (!isPublicWikiPage || Boolean(session)) && sidebarChapterEntries.map((entry) => {
    // Leave this entire .map() callback exactly as it currently exists.
    // Do not modify it. It covers both recursos and chapter entries.
  })
)}
```

**Concretely**, the two things to change in the file are:
1. Wrap the existing `sidebarChapterEntries.map(...)` block with `canManageLiveInteractions ? (<> teacher branch </>) : (existing non-teacher block)`.
2. The teacher branch renders: (a) the existing recursos `<div class="chapter">` block filtered from `sidebarChapterEntries` where `entry.kind === 'recursos'`, followed by (b) `<div data-notes-sidebar ...></div>`.

The non-teacher branch is the original `sidebarChapterEntries.map(...)` code with zero modifications.

Also find and remove the E and C buttons block (approximately lines 3418–3438):
```astro
{canManageLiveInteractions && (
  <div class="course-teacher-actions" aria-label="Acciones docentes">
    {lessonSlug && (
      <button
        class="teacher-action-btn"
        data-notes-action="edit"
        data-course-id={...}
        data-slug={...}
      >E</button>
    )}
    <button
      class="teacher-action-btn teacher-action-btn--create"
      data-notes-action="create"
      data-course-id={...}
    >C</button>
  </div>
)}
```
Delete this entire `{canManageLiveInteractions && (...)}` block. The context menu is the new management entry point.

- [ ] **Step 4.2: Add the init script to [...]slug.astro**

Add a new `<script>` tag near the end of the existing scripts section:

```astro
<script>
  import { initNotesSidebar } from '../scripts/course/sidebar/notes-sidebar.ts';

  const container = document.querySelector<HTMLElement>('[data-notes-sidebar]');
  if (container) {
    const courseId = container.dataset.courseId ?? '';
    const activeSlug = container.dataset.activeSlug ?? null;
    if (courseId) initNotesSidebar(container, courseId, activeSlug || null);
  }
</script>
```

- [ ] **Step 4.3: Start dev server and verify teacher sidebar loads JS tree**

```bash
npm run dev
```

As a teacher, open a course page. Expected:
- Left sidebar shows the JS-rendered chapters and notes
- E and C buttons are gone from the top
- Right-click on a note shows context menu
- Right-click on a chapter shows chapter menu
- "Nueva nota aquí" creates a note and refreshes the sidebar
- "Eliminar" shows confirm dialog and removes the note

As a non-teacher (log out or use student account): static Astro rendering is unchanged.

- [ ] **Step 4.4: Commit**

```bash
git add src/pages/\[...slug\].astro
git commit -m "feat: wire dynamic notes sidebar placeholder in course page, remove E/C buttons"
```

---

### Task 5: DnD — verify reorder and cross-chapter move

- [ ] **Step 5.1: Test DnD within a chapter**

With dev server running:
1. Have a course with ≥ 2 notes in the same chapter
2. Drag a note row — it should become semi-transparent (opacity 0.35)
3. Drag over the drop line below another note — the 3px blue line should appear
4. Drop — the note should appear in the new position after sidebar refresh
5. Verify the `order` field was updated: check the note's YAML frontmatter file on disk

- [ ] **Step 5.2: Test cross-chapter DnD**

1. Drag a note from one chapter
2. Hover over a different chapter's `<summary>` — the summary should show `outline: 1px dashed var(--c-link)`
3. Drop — the note should move to the new chapter
4. Verify the `chapter` field was updated in the YAML frontmatter

- [ ] **Step 5.3: If DnD doesn't work, common fixes**

- `dragover` must call `e.preventDefault()` — verify this is in `makeDropLine` and chapter summary handlers
- `draggingSlug` must be set before `drop` fires — verify `dragstart` sets it synchronously
- If `clearDropState` isn't firing on `dragend`, add logging: `console.log('dragend', draggingSlug)`

- [ ] **Step 5.4: Commit**

```bash
git commit -m "fix: verify DnD reorder and cross-chapter move in notes sidebar"
```

---

### Task 6: Sidebar refresh after inline editor save

**Files:**
- Modify: `src/scripts/course/notes/inline-editor.ts`

- [ ] **Step 6.1: Add refresh dispatch to saveCurrentNote in inline-editor.ts**

In `src/scripts/course/notes/inline-editor.ts`, find the `saveCurrentNote` function. After the successful save (after `await saveNote(...)`), add:

```typescript
window.dispatchEvent(new CustomEvent('notes-sidebar-refresh'));
```

The function currently looks like:
```typescript
async function saveCurrentNote(courseId: string, statusEl: HTMLElement): Promise<void> {
  // ...
  await saveNote(courseId, currentSlug, fullContent);
  setStatus(statusEl, 'Guardado', 'ok');
  setTimeout(() => setStatus(statusEl, ''), 2000);
  // ADD HERE:
  window.dispatchEvent(new CustomEvent('notes-sidebar-refresh'));
}
```

- [ ] **Step 6.2: Verify sidebar refreshes after save in the inline editor**

1. Open a note via the inline editor (if the "E" button remains in the inline editor overlay — it was only removed from the sidebar top, the inline editor still works from context menu "Editar")
2. Change the note's title via `nie-title` input
3. Click save
4. Verify the sidebar note item updates to show the new title

- [ ] **Step 6.3: Commit**

```bash
git add src/scripts/course/notes/inline-editor.ts
git commit -m "feat: dispatch notes-sidebar-refresh after inline editor save"
```

---

### Task 7: Final integration check and test run

- [ ] **Step 7.1: Run full test suite**

```bash
cd /Users/zztt/projects/26-musiki/framework && npm test
```

Expected: all tests pass.

- [ ] **Step 7.2: Manual smoke test checklist**

As teacher:
- [ ] Sidebar loads JS tree (chapters collapsed/expanded correctly)
- [ ] Right-click note → Editar, Renombrar slug, Eliminar, Nueva nota aquí all work
- [ ] Right-click chapter → Nueva nota, Renombrar capítulo, Nuevo subcapítulo all work
- [ ] Drag note within chapter → reorders correctly, YAML updated
- [ ] Drag note to different chapter → moves, YAML updated
- [ ] Save via inline editor → sidebar refreshes

As student (non-teacher):
- [ ] Static Astro chapter tree renders as before
- [ ] No context menus, no drag handles

- [ ] **Step 7.3: Final commit**

```bash
git add -A
git commit -m "feat: complete dynamic notes sidebar — context menus, DnD, refresh sync"
```
