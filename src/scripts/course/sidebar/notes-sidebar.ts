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
      notes: [...notes].sort((a, b) => a.order - b.order || a.title.localeCompare(b.title ?? '')),
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

// slug = "cursos/s123/10 Chapter/note.md", courseId = "s123"
// Returns the URL path segment after the courseId prefix, without extension
// e.g. "10 Chapter/note.md" -> "10-chapter/note"
export function noteSlugToRelPath(slug: string, courseId: string): string {
  const relPath = slug.replace(`cursos/${courseId}/`, '').replace(/\.md$/, '');
  return relPath
    .split('/')
    .map(seg =>
      seg.normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/\s+/g, '-')
        .toLowerCase(),
    )
    .join('/');
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

import { listNotes, getNote, saveNote, createNote, deleteNote, moveNote } from '../../notes-editor/api';
import { parseFrontmatter, serializeFrontmatter } from '../../notes-editor/yaml-strip';

// ── Context menu ──────────────────────────────────────────────────────────

let activeMenu: HTMLElement | null = null;

function closeMenu() {
  activeMenu?.remove();
  activeMenu = null;
}

type MenuItem =
  | { label: string; action: () => void; danger?: boolean }
  | { separator: true };

function showContextMenu(x: number, y: number, items: MenuItem[]) {
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

// ── Render ────────────────────────────────────────────────────────────────

function dispatchRefresh() {
  window.dispatchEvent(new CustomEvent('notes-sidebar-refresh'));
}

export function renderNotesSidebar(
  container: HTMLElement,
  notes: NoteListItem[],
  activeSlug: string | null,
  courseId: string,
  courseHref: string,
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

  // ── Drop line factory ──────────────────────────────────────────────────
  function makeDropLine(chapter: string, afterSlug: string | null): HTMLLIElement {
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

  // ── Chapter loop ──────────────────────────────────────────────────────
  for (const group of groups) {
    const chapterEl = document.createElement('div');
    chapterEl.className = 'chapter';

    const details = document.createElement('details');
    details.className = 'chapter-details';
    details.open = true;

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

    // ── Lesson list ──────────────────────────────────────────────────
    const ul = document.createElement('ul');
    ul.className = 'lesson-list';
    ul.style.cssText = 'padding:0;margin:0;list-style:none;';

    ul.appendChild(makeDropLine(group.name, null));

    for (const note of group.notes) {
      const li = document.createElement('li');
      li.style.cssText = 'list-style:none;padding:0;margin:0;';

      const isActive = note.slug === activeSlug;
      const relPath = noteSlugToRelPath(note.slug, courseId);
      const noteUrl = `${courseHref}/${relPath}`;

      const a = document.createElement('a');
      a.href = noteUrl;
      a.className = 'lesson-link' + (isActive ? ' is-active-lesson' : '');
      a.textContent = note.title || note.slug.split('/').pop()?.replace('.md', '') || note.slug;
      a.draggable = true;

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
              const bare = note.slug.replace(`cursos/${courseId}/`, '').replace(/\.md$/, '');
              const newBare = prompt('Nuevo slug (sin extensión):', bare);
              if (!newBare || newBare === bare) return;
              await moveNote(courseId, bare, newBare);
              dispatchRefresh();
            },
          },
          {
            label: 'Eliminar',
            danger: true,
            action: async () => {
              if (!confirm(`¿Eliminar "${note.title}"? Esta acción no se puede deshacer.`)) return;
              const bare = note.slug.replace(`cursos/${courseId}/`, '').replace(/\.md$/, '');
              await deleteNote(courseId, bare);
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
      ul.appendChild(makeDropLine(group.name, note.slug));
    }

    details.appendChild(ul);
    chapterEl.appendChild(details);
    container.appendChild(chapterEl);
  }
}
