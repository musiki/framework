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

function getNoteIconInfo(note: NoteListItem) {
  const noteType = String(note.type || '').trim().toLowerCase();
  const noteStatus = String(note.status || '').trim().toLowerCase();
  const title = String(note.title || '');

  if (noteStatus === 'draft') {
    return { char: '◩', color: '#888888', isConcept: false };
  }
  if (noteType === 'concept') {
    return { char: '🔷', color: '', isConcept: true };
  }
  if (title.toUpperCase().includes('MOC')) {
    return { char: '■', color: '#8e7cc3', isConcept: false };
  }
  return { char: '■', color: '#888888', isConcept: false };
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
  // Before rebuilding, rescue static trees to prevent them from being destroyed
  const currentRecursosTree = container.querySelector('.recursos-sidebar-tree');
  if (currentRecursosTree) {
    document.getElementById('recursos-sidebar-tree-container')?.appendChild(currentRecursosTree);
  }
  const currentNotasTree = container.querySelector('.notas-sb-tree');
  if (currentNotasTree) {
    const parent = document.querySelector('#notas-sidebar-tree-container .chapter-details');
    if (parent) {
      parent.appendChild(currentNotasTree);
    } else {
      document.getElementById('notas-sidebar-tree-container')?.appendChild(currentNotasTree);
    }
  }

  // Preserve collapsed chapters across re-renders
  const closedNames = new Set<string>();
  container.querySelectorAll<HTMLDetailsElement>('details.chapter-details').forEach(d => {
    if (!d.open) {
      const name = d.querySelector('.chapter-title-text')?.textContent?.trim();
      if (name) closedNames.add(name);
    }
  });

  const groups = groupByChapter(notes);

  // Ensure virtual chapters are present in groups
  let recursosGroup = groups.find(g => g.name.toUpperCase().includes('RECURSOS'));
  if (!recursosGroup) {
    recursosGroup = { name: '80 RECURSOS', notes: [] };
    groups.push(recursosGroup);
  }
  let notasGroup = groups.find(g => g.name.toUpperCase().includes('NOTAS'));
  if (!notasGroup) {
    notasGroup = { name: '90 NOTAS', notes: [] };
    groups.push(notasGroup);
  }

  // Sort groups by min note order (with defaults for empty groups)
  groups.sort((a, b) => {
    const minA = a.notes.length ? Math.min(...a.notes.map(n => n.order)) : 80;
    const minB = b.notes.length ? Math.min(...b.notes.map(n => n.order)) : 90;
    return minA - minB || a.name.localeCompare(b.name);
  });

  const newChapterEls: HTMLElement[] = [];

  let draggingSlug: string | null = null;
  let draggingChapterName: string | null = null;
  let activeDropTarget: HTMLElement | null = null;

  function clearDropState() {
    activeDropTarget?.classList.remove('ns-drag-over', 'ns-drop-active');
    activeDropTarget = null;
  }

  function canAcceptDraggedNote(e: DragEvent): boolean {
    return Boolean(draggingSlug || Array.from(e.dataTransfer?.types ?? []).includes('text/x-musiki-course-note'));
  }

  function getDraggedSlug(e: DragEvent): string | null {
    if (draggingSlug) return draggingSlug;
    if (!Array.from(e.dataTransfer?.types ?? []).includes('text/x-musiki-course-note')) return null;
    const slug = e.dataTransfer?.getData('text/x-musiki-course-note')?.trim() || null;
    return slug && notes.some(note => note.slug === slug) ? slug : null;
  }

  function makeChapterDropLine(afterChapterName: string | null): HTMLDivElement {
    const div = document.createElement('div');
    div.className = 'ns-chapter-drop-line';

    div.addEventListener('dragover', e => {
      if (!e.dataTransfer?.types.includes('text/x-musiki-course-chapter')) return;
      e.preventDefault();
      if (activeDropTarget !== div) {
        clearDropState();
        activeDropTarget = div;
        div.classList.add('ns-drop-active');
      }
    });
    div.addEventListener('dragleave', () => {
      if (activeDropTarget === div) {
        div.classList.remove('ns-drop-active');
        activeDropTarget = null;
      }
    });
    div.addEventListener('drop', async e => {
      e.preventDefault();
      clearDropState();
      const draggedName = e.dataTransfer?.getData('text/x-musiki-course-chapter') || draggingChapterName;
      if (!draggedName || draggedName === afterChapterName) return;

      try {
        const draggedIndex = groups.findIndex(g => g.name === draggedName);
        if (draggedIndex === -1) return;

        const draggedGroup = groups[draggedIndex];
        const remaining = groups.filter(g => g.name !== draggedName);

        let insertIdx = 0;
        if (afterChapterName !== null) {
          insertIdx = remaining.findIndex(g => g.name === afterChapterName) + 1;
        }

        const reorderedGroups = [
          ...remaining.slice(0, insertIdx),
          draggedGroup,
          ...remaining.slice(insertIdx),
        ];

        let globalOrder = 0;
        for (const g of reorderedGroups) {
          if (g.notes.length === 0) {
            const isRecursos = g.name.toUpperCase().includes('RECURSOS');
            const isNotas = g.name.toUpperCase().includes('NOTAS');
            if (isRecursos || isNotas) {
              const slug = isRecursos ? 'recursos-info' : 'notas-info';
              const title = isRecursos ? 'Recursos Info' : 'Notas Info';
              try {
                await createNote(courseId, {
                  slug, title, type: 'info',
                  chapter: g.name, status: 'draft', order: globalOrder,
                });
              } catch (e) {
                console.warn('[notes-sidebar] dummy note creation failed:', e);
              }
            }
          } else {
            for (const note of g.notes) {
              if (note.order !== globalOrder) {
                const nd = await getNote(courseId, note.slug);
                const { data: fm, body } = parseFrontmatter(nd.content);
                (fm as any).order = globalOrder;
                await saveNote(courseId, note.slug, serializeFrontmatter(fm as any, body));
              }
            }
          }
          globalOrder += Math.max(1, g.notes.length);
        }
        dispatchRefresh();
      } catch (err) {
        console.error('[notes-sidebar] chapter drop failed:', err);
      }
    });

    return div;
  }

  // ── Drop line factory ──────────────────────────────────────────────────
  function makeDropLine(chapter: string, afterSlug: string | null): HTMLLIElement {
    const li = document.createElement('li');
    li.className = 'ns-drop-line';

    li.addEventListener('dragover', e => {
      if (!canAcceptDraggedNote(e)) return;
      e.preventDefault();
      if (activeDropTarget !== li) {
        clearDropState();
        activeDropTarget = li;
        li.classList.add('ns-drop-active');
      }
    });
    li.addEventListener('dragleave', () => {
      if (activeDropTarget === li) {
        li.classList.remove('ns-drop-active');
        activeDropTarget = null;
      }
    });
    li.addEventListener('drop', async e => {
      e.preventDefault();
      clearDropState();
      const slug = getDraggedSlug(e);
      if (!slug) return;

      try {
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
      } catch (err) {
        console.error('[notes-sidebar] drop failed:', err);
      }
    });

    return li;
  }

  newChapterEls.push(makeChapterDropLine(null));

  // ── Chapter loop ──────────────────────────────────────────────────────
  for (const group of groups) {
    const chapterEl = document.createElement('div');
    const nameUpper = group.name.toUpperCase();
    const isConceptos = nameUpper.includes('CONCEPTOS');
    const isRecursos = nameUpper.includes('RECURSOS');
    const isNotas = nameUpper.includes('NOTAS');
    chapterEl.className = `chapter${isConceptos ? ' chapter--conceptos' : ''}${isRecursos ? ' chapter--recursos' : ''}${isNotas ? ' chapter--notas' : ''}`;

    const details = document.createElement('details');
    details.className = 'chapter-details';
    details.open = true;

    const summary = document.createElement('summary');
    summary.className = 'chapter-title';
    if (isRecursos) {
      summary.innerHTML = `
        <span class="chapter-title-main">
          <span class="chapter-drag-handle" title="Arrastrar para reordenar">⋮⋮</span>
          <span class="chapter-caret">▸</span>
          <span class="chapter-title-text">${escHtml(group.name)}</span>
          <a
            href="${courseHref}/recursos"
            class="chapter-editor-link"
            title="Editor de recursos"
            aria-label="Editor de recursos"
            onclick="event.stopPropagation()"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:0.82rem;height:0.82rem;stroke:currentColor;">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </svg>
          </a>
        </span>
      `;
    } else if (isNotas) {
      summary.innerHTML = `
        <span class="chapter-title-main">
          <span class="chapter-drag-handle" title="Arrastrar para reordenar">⋮⋮</span>
          <span class="chapter-caret">▸</span>
          <span class="chapter-title-text">${escHtml(group.name)}</span>
          <button type="button" class="chapter-editor-link notas-sb-new-btn" title="Nueva nota" onclick="event.stopPropagation()" style="border:none;background:none;cursor:pointer;padding:0 3px;opacity:.6;font-size:.85rem;line-height:1">+</button>
          <button type="button" class="chapter-editor-link notas-sb-new-folder-btn" title="Nueva carpeta" onclick="event.stopPropagation()" style="border:none;background:none;cursor:pointer;padding:0 3px;opacity:.6;font-size:.75rem;line-height:1">⊟+</button>
        </span>
      `;
      summary.querySelector('.notas-sb-new-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        document.querySelector('#notas-sidebar-tree-container .notas-sb-new-btn')?.dispatchEvent(new MouseEvent('click'));
      });
      summary.querySelector('.notas-sb-new-folder-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        document.querySelector('#notas-sidebar-tree-container .notas-sb-new-folder-btn')?.dispatchEvent(new MouseEvent('click'));
      });
    } else {
      summary.innerHTML = `
        <span class="chapter-title-main">
          <span class="chapter-drag-handle" title="Arrastrar para reordenar">⋮⋮</span>
          <span class="chapter-caret">▸</span>
          <span class="chapter-title-text">${escHtml(group.name)}</span>
        </span>
      `;
    }
    summary.draggable = true;

    summary.addEventListener('dragstart', e => {
      draggingChapterName = group.name;
      e.dataTransfer!.setData('text/x-musiki-course-chapter', group.name);
      e.dataTransfer!.setData('text/plain', group.name);
      e.dataTransfer!.effectAllowed = 'move';
      setTimeout(() => { chapterEl.style.opacity = '.4'; }, 0);
    });
    summary.addEventListener('dragend', () => {
      draggingChapterName = null;
      chapterEl.style.opacity = '';
      clearDropState();
    });

    // Chapter context menu
    summary.addEventListener('contextmenu', e => {
      e.preventDefault();
      e.stopPropagation();
      showContextMenu(e.clientX, e.clientY, [
        {
          label: 'Nueva nota en este capítulo',
          action: async () => {
            try {
              const title = prompt('Título:');
              if (!title) return;
              const maxOrder = group.notes.length ? Math.max(...group.notes.map(n => n.order)) : -1;
              await createNote(courseId, {
                slug: slugify(title), title, type: 'lesson',
                chapter: group.name, status: 'draft', order: maxOrder + 1,
              });
              dispatchRefresh();
            } catch (err) {
              console.error('[notes-sidebar] mutation failed:', err);
            }
          },
        },
        {
          label: 'Renombrar capítulo',
          action: async () => {
            try {
              const newName = prompt('Nuevo nombre:', group.name);
              if (!newName || newName === group.name) return;
              for (const note of group.notes) {
                const nd = await getNote(courseId, note.slug);
                const { data: fm, body } = parseFrontmatter(nd.content);
                (fm as any).chapter = newName;
                await saveNote(courseId, note.slug, serializeFrontmatter(fm as any, body));
              }
              dispatchRefresh();
            } catch (err) {
              console.error('[notes-sidebar] mutation failed:', err);
            }
          },
        },
        {
          label: 'Nuevo subcapítulo',
          action: async () => {
            try {
              const chapterName = prompt('Nombre del capítulo:');
              if (!chapterName) return;
              const title = prompt('Título de la primera nota:');
              if (!title) return;
              await createNote(courseId, {
                slug: slugify(title), title, type: 'lesson',
                chapter: chapterName, status: 'draft', order: 0,
              });
              dispatchRefresh();
            } catch (err) {
              console.error('[notes-sidebar] mutation failed:', err);
            }
          },
        },
      ]);
    });

    // Chapter as cross-chapter drop target
    summary.addEventListener('dragover', e => {
      if (!canAcceptDraggedNote(e)) return;
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
      const slug = getDraggedSlug(e);
      if (!slug) return;
      try {
        const note = notes.find(n => n.slug === slug);
        if (!note || note.chapter === group.name) return;
        const maxOrder = group.notes.length ? Math.max(...group.notes.map(n => n.order)) : -1;
        const nd = await getNote(courseId, slug);
        const { data: fm, body } = parseFrontmatter(nd.content);
        (fm as any).chapter = group.name;
        (fm as any).order = maxOrder + 1;
        await saveNote(courseId, slug, serializeFrontmatter(fm as any, body));
        dispatchRefresh();
      } catch (err) {
        console.error('[notes-sidebar] drop failed:', err);
      }
    });

    details.appendChild(summary);

    // ── Lesson list ──────────────────────────────────────────────────
    const ul = document.createElement('ul');
    ul.className = 'lesson-list';

    ul.appendChild(makeDropLine(group.name, null));

    for (const note of group.notes) {
      const li = document.createElement('li');
      li.className = 'lesson-item';

      const isActive = note.slug === activeSlug;
      const relPath = noteSlugToRelPath(note.slug, courseId);
      const noteUrl = `${courseHref}/${relPath}`;

      const a = document.createElement('a');
      a.href = noteUrl;
      a.className = 'lesson-link' + (isActive ? ' active' : '');
      a.dataset.astroPrefetch = 'false';
      a.draggable = true;

      const titleText = note.title || note.slug.split('/').pop()?.replace('.md', '') || note.slug;
      const textSpan = document.createElement('span');
      textSpan.className = 'lesson-link-text';
      textSpan.textContent = titleText;
      const trailingSpan = document.createElement('span');
      trailingSpan.className = 'lesson-link-trailing';

      const ic = getNoteIconInfo(note);
      const iconSpan = document.createElement('span');
      iconSpan.className = 'lesson-icon' + (ic.isConcept ? ' lesson-icon--concept' : '');
      if (ic.color) {
        iconSpan.style.color = ic.color;
      }
      iconSpan.textContent = ic.char;

      a.appendChild(iconSpan);
      a.appendChild(textSpan);
      a.appendChild(trailingSpan);

      a.addEventListener('click', e => {
        const cancelled = !window.dispatchEvent(
          new CustomEvent('note-open', {
            detail: { slug: note.slug, courseId, mode: 'preview', split: e.altKey },
            cancelable: true,
            bubbles: false,
          }),
        );
        if (cancelled) e.preventDefault();
      });

      a.addEventListener('dragstart', e => {
        draggingSlug = note.slug;
        e.dataTransfer!.setData('text/x-musiki-course-note', note.slug);
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
              try {
                const bare = note.slug.replace(`cursos/${courseId}/`, '').replace(/\.md$/, '');
                const newBare = prompt('Nuevo slug (sin extensión):', bare);
                if (!newBare || newBare === bare) return;
                await moveNote(courseId, bare, newBare);
                dispatchRefresh();
              } catch (err) {
                console.error('[notes-sidebar] mutation failed:', err);
              }
            },
          },
          {
            label: 'Eliminar',
            danger: true,
            action: async () => {
              try {
                if (!confirm(`¿Eliminar "${note.title}"? Esta acción no se puede deshacer.`)) return;
                const bare = note.slug.replace(`cursos/${courseId}/`, '').replace(/\.md$/, '');
                await deleteNote(courseId, bare);
                dispatchRefresh();
              } catch (err) {
                console.error('[notes-sidebar] mutation failed:', err);
              }
            },
          },
          { separator: true },
          {
            label: 'Nueva nota aquí',
            action: async () => {
              try {
                const title = prompt('Título:');
                if (!title) return;
                await createNote(courseId, {
                  slug: slugify(title), title, type: 'lesson',
                  chapter: note.chapter, status: 'draft', order: note.order + 0.5,
                });
                dispatchRefresh();
              } catch (err) {
                console.error('[notes-sidebar] mutation failed:', err);
              }
            },
          },
        ]);
      });

      li.appendChild(a);
      ul.appendChild(li);
      ul.appendChild(makeDropLine(group.name, note.slug));
    }

    if (isRecursos) {
      const tree = document.querySelector('#recursos-sidebar-tree-container .recursos-sidebar-tree')
        || document.querySelector('.recursos-sidebar-tree');
      if (tree) {
        details.appendChild(tree);
      }
    } else if (isNotas) {
      const tree = document.querySelector('#notas-sidebar-tree-container .notas-sb-tree')
        || document.querySelector('.notas-sb-tree');
      if (tree) {
        details.appendChild(tree);
      }
    } else {
      details.appendChild(ul);
    }
    chapterEl.appendChild(details);
    newChapterEls.push(chapterEl);
    newChapterEls.push(makeChapterDropLine(group.name));
  }

  // Restore collapsed state on new elements before inserting into DOM
  if (closedNames.size > 0) {
    for (const el of newChapterEls) {
      el.querySelectorAll<HTMLDetailsElement>('details.chapter-details').forEach(d => {
        const name = d.querySelector('.chapter-title-text')?.textContent?.trim();
        if (name && closedNames.has(name)) d.open = false;
      });
    }
  }

  // Atomic swap — no blank flash between teardown and rebuild
  container.replaceChildren(...newChapterEls);
}

// ── CSS injection ─────────────────────────────────────────────────────────

function injectCss() {
  if (typeof document === 'undefined' || document.querySelector('[data-cnw-ns-css]')) return;
  const style = document.createElement('style');
  style.setAttribute('data-cnw-ns-css', '1');
  style.textContent = `
    /* ── Notes sidebar overrides ─────────────────────────────── */
    /* Chapter titles: small, grey, bold, uppercase */
    [data-notes-sidebar] .chapter-title {
      font-size: 0.8rem !important;
      font-weight: 700 !important;
      letter-spacing: 0.08em !important;
      text-transform: uppercase !important;
      color: var(--c-fg-subtle, #888) !important;
      padding: 0.2rem 0.75rem 0.2rem 0 !important;
      margin: 0 !important;
    }
    [data-notes-sidebar] details > summary::-webkit-details-marker {
      display: none !important;
    }
    [data-notes-sidebar] details > summary::marker {
      display: none !important;
      content: "" !important;
    }
    [data-notes-sidebar] details > summary {
      list-style: none !important;
    }
    [data-notes-sidebar] .lesson-item {
      margin: 0 !important;
      padding: 0 !important;
    }
    /* Suppress list-item ::before markers injected by global stylesheet */
    [data-notes-sidebar] .lesson-item::before {
      content: none !important;
      display: none !important;
    }
    /* Note items: smaller, no blue, black/white hierarchy */
    [data-notes-sidebar] .lesson-list { gap: 0 !important; margin-top: 0.16rem !important; margin-bottom: 0.22rem !important; }
    [data-notes-sidebar] .lesson-link {
      font-size: 0.84rem !important;
      color: var(--c-fg-dim) !important;
      padding: 0.12rem 0.25rem !important;
    }
    [data-notes-sidebar] .lesson-link:hover {
      color: var(--c-fg) !important;
      background: var(--c-bg-mute) !important;
    }
    [data-notes-sidebar] .lesson-link.active {
      color: var(--c-fg) !important;
      font-weight: 600 !important;
      background: var(--c-bg-alt, var(--c-bg-mute)) !important;
      box-shadow: inset 0 0 0 1px var(--c-border, rgba(120,120,140,0.25)) !important;
    }
    /* ── Drop lines ──────────────────────────────────────────── */
    .ns-drop-line {
      height: 0;
      list-style: none;
      padding: 0;
      margin: 0;
      transition: height 80ms, background-color 80ms;
      overflow: visible;
      position: relative;
    }
    .ns-drop-line::after {
      content: '';
      position: absolute;
      left: 0;
      right: 0;
      top: -4px;
      height: 8px;
      z-index: 10;
      background: transparent;
    }
    .ns-drop-line.ns-drop-active {
      height: 3px;
      background: var(--c-link, #3b82f6);
      margin: 3px 0;
    }
    .ns-drop-line::before { content: none !important; display: none !important; }
    .ns-chapter-drop-line {
      height: 0;
      padding: 0;
      margin: 0;
      transition: height 80ms, background-color 80ms;
      overflow: visible;
      position: relative;
    }
    .ns-chapter-drop-line::after {
      content: '';
      position: absolute;
      left: 0;
      right: 0;
      top: -6px;
      height: 12px;
      z-index: 10;
      background: transparent;
    }
    .ns-chapter-drop-line.ns-drop-active {
      height: 3px;
      background: var(--c-link, #3b82f6);
      margin: 6px 0;
    }
    .ns-drag-over.chapter-title {
      background: var(--c-bg-alt, var(--c-bg-mute)) !important;
      outline: 1px dashed var(--c-link, #3b82f6);
      outline-offset: -2px;
    }
    [data-notes-sidebar] .chapter-link {
      display: flex;
      align-items: center;
      gap: 0.35rem;
    }
    [data-notes-sidebar] .chapter-caret {
      font-size: 1.0rem !important;
    }
    [data-notes-sidebar] .chapter-details {
      padding: 0 !important;
    }

    [data-notes-sidebar] .lesson-link[draggable="true"] {
      cursor: grab;
    }
    [data-notes-sidebar] .lesson-link[draggable="true"]:active {
      cursor: grabbing;
    }
    [data-notes-sidebar] .chapter-title[draggable="true"] {
      cursor: grab;
    }
    [data-notes-sidebar] .chapter-title[draggable="true"]:active {
      cursor: grabbing;
    }
  `;
  document.head.appendChild(style);
}

// ── Init ──────────────────────────────────────────────────────────────────

// Module-level lifecycle — prevents stale refresh/note-open listeners across navigations
let _sidebarCtrl: AbortController | null = null;
let _sidebarContainer: HTMLElement | null = null;

export function initNotesSidebar(
  container: HTMLElement,
  courseId: string,
  courseHref: string,
  activeSlug: string | null,
): void {
  // Idempotency: same container + same course is already initialized
  if (_sidebarContainer === container && container.dataset.cnwCourseId === courseId) return;
  container.dataset.cnwCourseId = courseId;

  // Abort previous global listeners
  _sidebarCtrl?.abort();
  _sidebarContainer = container;
  _sidebarCtrl = new AbortController();
  const { signal } = _sidebarCtrl;

  injectCss();

  let currentActive = activeSlug;

  async function refresh() {
    try {
      const { notes } = await listNotes(courseId);
      renderNotesSidebar(container, notes, currentActive, courseId, courseHref);
    } catch (err) {
      console.error('[notes-sidebar] failed to load notes:', err);
    }
  }

  window.addEventListener('notes-sidebar-refresh', () => { void refresh(); }, { signal });

  window.addEventListener('note-open', (e: Event) => {
    const detail = (e as CustomEvent<{ slug?: string }>).detail;
    if (detail?.slug) currentActive = detail.slug;
  }, { signal });

  void refresh();
}
