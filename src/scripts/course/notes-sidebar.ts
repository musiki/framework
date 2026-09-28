// src/scripts/course/notes-sidebar.ts

import { renderTree, type TreeLabels } from '../../lib/writing/tree/render';
import type { TreeNote } from '../../lib/writing/tree/model';

export interface NoteFolder {
  id: string; name: string; parentId: string | null; courseId: string | null;
  position?: number | null;
}
export interface NoteItem {
  id: string; title: string; folderId: string | null; updatedAt: string; body?: string;
  userId?: string;
  ownerName?: string;
  position?: number | null;
}

// musiki has always sorted notas in Spanish collation; also drives the
// manual-ordering reorder endpoint's sibling read.
const TREE_LOCALE = 'es';

// Spanish labels for the shared tree renderer — these are exactly the
// strings musiki's own DOM previously used for these actions (Renombrar,
// Eliminar, "nueva nota...", etc.). `visibility`/`inherit`/`private`/
// `supervision`/`committee`/`public` are unused (musiki passes
// `showVisibility: false`) but required by TreeLabels' shape.
const SPANISH_LABELS: TreeLabels = {
  newNote: 'nueva nota...',
  newFolder: 'nueva carpeta...',
  rename: 'Renombrar',
  delete: 'Eliminar',
  visibility: 'Visibilidad',
  inherit: 'Heredar',
  private: 'Privado',
  supervision: 'Supervisión',
  committee: 'Comité',
  public: 'Público',
  confirmDelete: '¿Eliminar? Esta acción no se puede deshacer.',
  empty: 'Sin notas',
  loading: 'Cargando…',
  error: 'No se pudieron cargar las notas.',
  actionError: 'No se pudo completar la acción.',
  up: '↑',
  down: '↓',
  actions: 'Acciones',
};

function broadcastNotesSidebarRefresh(courseId: string) {
  const detail = { courseId, at: Date.now() };
  window.dispatchEvent(new CustomEvent('musiki:notes-sidebar-refresh', { detail }));
  try {
    localStorage.setItem('musiki:notes-sidebar-refresh', JSON.stringify(detail));
  } catch {}
}

function getNoteIconInfo(note: NoteItem) {
  const body = note.body || '';
  const title = note.title || '';

  let isConcept = false;
  let isDraft = false;

  const frontmatterMatch = body.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (frontmatterMatch) {
    const yaml = frontmatterMatch[1];
    const typeMatch = yaml.match(/^type:\s*["']?concept["']?\s*$/m);
    if (typeMatch) {
      isConcept = true;
    }
    const draftMatch = yaml.match(/^draft:\s*true\s*$/m);
    const statusMatch = yaml.match(/^status:\s*["']?draft["']?/m);
    if (draftMatch || statusMatch) {
      isDraft = true;
    }
  }

  if (isDraft) return { char: '◩', color: '#888888', isConcept: false };
  if (isConcept) return { char: '🔷', color: '', isConcept: true };
  if (title.toUpperCase().includes('MOC')) return { char: '■', color: '#8e7cc3', isConcept: false };
  return { char: '■', color: '#45d384', isConcept: false };
}

export async function loadNotesTree(courseId: string): Promise<{ folders: NoteFolder[]; notes: NoteItem[]; currentUserId: string }> {
  const [fRes, nRes] = await Promise.all([
    fetch(`/api/note-folders?courseId=${encodeURIComponent(courseId)}`),
    fetch(`/api/live/notes?courseId=${encodeURIComponent(courseId)}&limit=200`),
  ]);
  if (!nRes.ok) {
    const data = await nRes.json().catch(() => null);
    throw new Error(data?.error || 'No se pudieron cargar las notas.');
  }
  const fData = fRes.ok ? await fRes.json() : { folders: [] };
  const nData = await nRes.json();
  return {
    folders: fData.folders ?? [],
    notes: nData.notes ?? [],
    currentUserId: nData.currentUserId || ''
  };
}

export async function createFolder(courseId: string, name: string, parentId: string | null = null): Promise<NoteFolder | null> {
  const res = await fetch('/api/note-folders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, courseId, parentId }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data.folder ?? null;
}

function nextDefaultNoteTitle(notes: NoteItem[]): string {
  const existing = new Set(notes.map(note => note.title.toLowerCase()));
  let index = 1;
  while (existing.has(`note-${String(index).padStart(2, '0')}`)) index++;
  return `note-${String(index).padStart(2, '0')}`;
}

// Tracks, per outer sidebar container, the promise for that container's
// current tree's first `refresh()` — so beginRootNoteCreation/
// beginInlineFolderCreation (called by [...slug].astro right after
// renderNotesTree, without awaiting it) can wait for the shared renderer's
// create buttons to actually exist in the DOM before clicking them.
const treeReady = new WeakMap<HTMLElement, Promise<void>>();

// Tracks, per outer sidebar container, the currently-mounted shared tree so a
// re-render (e.g. after a course switch reuses the same container) destroys
// the previous tree instance instead of leaking its refresh loop/listeners.
const mountedTree = new WeakMap<HTMLElement, { destroy(): void }>();

export function beginRootNoteCreation(container: HTMLElement): void {
  const ready = treeReady.get(container) ?? Promise.resolve();
  void ready.then(() => {
    const createBar = container.querySelector<HTMLElement>('.notas-sb-owned-tree .writing-tree > .wt-create');
    createBar?.querySelector<HTMLButtonElement>('button')?.click();
  });
}

export function beginInlineFolderCreation(
  container: HTMLElement,
  _courseId: string,
  parentId: string | null = null,
  _indent = 0,
): void {
  // Only root-level creation is reachable through this entry point now: the
  // shared renderer nests each open folder's own "new folder" button inside
  // that folder (no per-folder id marker to target from the outside), so a
  // non-null parentId here is a no-op. Every current caller passes the
  // default (root) parentId.
  if (parentId !== null) return;
  const ready = treeReady.get(container) ?? Promise.resolve();
  void ready.then(() => {
    const createBar = container.querySelector<HTMLElement>('.notas-sb-owned-tree .writing-tree > .wt-create');
    const buttons = createBar?.querySelectorAll<HTMLButtonElement>('button');
    if (buttons && buttons.length > 1) buttons[1].click();
  });
}

export function renderNotesTree(
  container: HTMLElement,
  folders: NoteFolder[],
  notes: NoteItem[],
  courseId: string,
  currentUserId?: string,
) {
  mountedTree.get(container)?.destroy();
  container.innerHTML = '';

  const treeContainer = document.createElement('div');
  treeContainer.className = 'notas-sb-owned-tree';
  container.appendChild(treeContainer);

  const sharedContainer = document.createElement('div');
  sharedContainer.className = 'notas-sb-shared-section';
  container.appendChild(sharedContainer);

  let currentUid = currentUserId || '';
  let latestNotes: NoteItem[] = notes;
  // The initial paint reuses the already-loaded data the caller passed in
  // (matches the previous synchronous-render behavior); every subsequent
  // refresh (after create/rename/delete/reorder, or an external reload)
  // fetches fresh via loadNotesTree.
  let pendingInitial: { folders: NoteFolder[]; notes: NoteItem[]; currentUserId: string } | null = {
    folders, notes, currentUserId: currentUid,
  };

  let tree: ReturnType<typeof renderTree>;

  function renderSharedSection(allNotes: NoteItem[], uid: string) {
    sharedContainer.innerHTML = '';
    const sharedNotes = allNotes.filter(n => n.userId && n.userId !== uid);
    if (!sharedNotes.length) return;

    const sharedDetails = document.createElement('details');
    sharedDetails.open = false;
    sharedDetails.className = 'notas-sb-folder--special shared-notes-folder';

    const sharedSummary = document.createElement('summary');
    sharedSummary.className = 'notas-sb-folder';
    sharedSummary.style.cssText = 'cursor:pointer;list-style:none;';
    sharedSummary.innerHTML = `<span class="notas-sb-folder-caret" style="color:var(--c-fg-dim);font-size:12px;width:10px">▸</span><span class="notas-sb-folder-icon" style="color:var(--c-fg-dim);font-size:11px">👥</span><span class="notas-sb-folder-name">Compartidas conmigo</span>`;

    const sharedContent = document.createElement('div');
    sharedContent.className = 'notas-sb-level';

    const sortedShared = [...sharedNotes].sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    for (const note of sortedShared) {
      sharedContent.appendChild(makeNoteItem(note, 0, uid, courseId));
    }

    sharedDetails.appendChild(sharedSummary);
    sharedDetails.appendChild(sharedContent);
    sharedDetails.addEventListener('toggle', () => {
      const caret = sharedSummary.querySelector<HTMLElement>('.notas-sb-folder-caret');
      if (caret) caret.textContent = sharedDetails.open ? '▾' : '▸';
    });
    const caret = sharedSummary.querySelector<HTMLElement>('.notas-sb-folder-caret');
    if (caret) caret.textContent = sharedDetails.open ? '▾' : '▸';

    sharedContainer.appendChild(sharedDetails);
  }

  // Render the shared-with-me section synchronously from the initial data
  // so it doesn't flash empty while the owned tree's first refresh runs.
  renderSharedSection(notes, currentUid);

  tree = renderTree({
    container: treeContainer,
    labels: SPANISH_LABELS,
    locale: TREE_LOCALE,
    canManage: true, // owner's own DB-notes tree
    showVisibility: false,
    selectedNoteId: null,
    noteIcon: (note) => getNoteIconInfo(note as unknown as NoteItem).char,
    noteActions: (note) => [{
      label: 'Compartir',
      run: () => openSharingModal(note.id, (note as unknown as NoteItem).title || '(sin título)', courseId),
    }],
    // The dockview workspace's external-drop handler
    // (src/scripts/course/dockview-workspace.ts) reads these to open the
    // note as a db-note pod; folders have nothing to drop onto a pod, so
    // they carry no payload.
    dragData: (n): Record<string, string> => n.kind === 'note' ? {
      'text/x-musiki-note': n.note.id,
      'text/x-musiki-note-title': (n.note as unknown as NoteItem).title || '',
    } : {},
    load: async () => {
      const data = pendingInitial ?? await loadNotesTree(courseId);
      pendingInitial = null;
      currentUid = data.currentUserId || currentUid;
      latestNotes = data.notes;
      renderSharedSection(data.notes, currentUid);
      const owned = data.notes.filter(n => !n.userId || n.userId === currentUid);
      return { folders: data.folders, notes: owned as unknown as TreeNote[] };
    },
    onOpenNote(id) {
      const note = latestNotes.find(n => n.id === id);
      window.dispatchEvent(new CustomEvent('musiki:open-db-note', {
        detail: { noteId: id, title: note?.title || '(sin título)' },
      }));
    },
    actions: {
      async createNote(parentId) {
        const suggested = nextDefaultNoteTitle(latestNotes);
        const title = window.prompt('Nombre de la nota…', suggested)?.trim();
        if (!title) return;
        const res = await fetch('/api/live/notes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, body: '', courseId, folderId: parentId }),
        });
        if (!res.ok) throw new Error('create-note-failed');
        broadcastNotesSidebarRefresh(courseId);
      },
      async createFolder(parentId, name) {
        const folder = await createFolder(courseId, name, parentId);
        if (!folder) throw new Error('create-folder-failed');
        broadcastNotesSidebarRefresh(courseId);
      },
      async renameNote(id, title) {
        const res = await fetch('/api/live/notes', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, title }),
        });
        if (!res.ok) throw new Error('rename-note-failed');
        broadcastNotesSidebarRefresh(courseId);
      },
      async renameFolder(id, name) {
        const res = await fetch('/api/note-folders', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, name }),
        });
        if (!res.ok) throw new Error('rename-folder-failed');
        broadcastNotesSidebarRefresh(courseId);
      },
      async deleteNote(id) {
        const res = await fetch(`/api/live/notes?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('delete-note-failed');
        broadcastNotesSidebarRefresh(courseId);
      },
      async deleteFolder(id) {
        const res = await fetch(`/api/note-folders?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('delete-folder-failed');
        broadcastNotesSidebarRefresh(courseId);
      },
      async reorder(kind, id, parentId, targetIndex) {
        // Folder reparenting is allowed here — the server (course-order-core.ts)
        // validates the target is the caller's own folder in the same course
        // scope (or root) and not the folder itself or one of its own
        // descendants; see src/lib/writing/notes/course-order-core.test.mjs.
        const res = await fetch('/api/live/notes/reorder', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ courseId, kind, id, parentId, targetIndex }),
        });
        if (!res.ok) throw new Error('reorder-failed');
        broadcastNotesSidebarRefresh(courseId);
      },
    },
  });

  mountedTree.set(container, tree);
  treeReady.set(container, tree.refresh());
}

function makeNoteItem(note: NoteItem, indent: number, currentUserId: string, courseId: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'notas-sb-item';
  el.draggable = true;
  el.dataset.noteId = note.id;
  el.style.cssText = `cursor:pointer;border-left:2px solid transparent;display:flex;align-items:center;justify-content:space-between;width:100%;box-sizing:border-box;padding-right:4px;`;
  el.title = note.title || '(sin título)';

  const ic = getNoteIconInfo(note);
  const scaleStyle = ic.isConcept ? 'transform: scale(0.6); transform-origin: center; display: inline-block;' : '';
  const colorStyle = ic.color ? `color: ${ic.color};` : '';

  const isOwner = !note.userId || note.userId === currentUserId;

  const left = document.createElement('div');
  left.style.cssText = 'display:flex;align-items:center;gap:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex-grow:1;';

  const iconSpan = document.createElement('span');
  iconSpan.className = 'lesson-icon';
  iconSpan.style.cssText = `font-size:12px;width:17px;text-align:center;flex-shrink:0;${scaleStyle}${colorStyle}`;
  iconSpan.innerHTML = ic.char;
  left.appendChild(iconSpan);

  const titleSpan = document.createElement('span');
  titleSpan.className = 'notas-sb-note-title';
  titleSpan.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
  titleSpan.textContent = note.title || '(sin título)';
  left.appendChild(titleSpan);

  if (!isOwner && note.ownerName) {
    const ownerSpan = document.createElement('span');
    ownerSpan.className = 'notas-sb-note-owner';
    ownerSpan.style.cssText = 'font-size:10px;color:var(--c-fg-dim);margin-left:4px;flex-shrink:0;opacity:0.8;';
    ownerSpan.textContent = `(${note.ownerName})`;
    left.appendChild(ownerSpan);
  }

  el.appendChild(left);

  if (isOwner) {
    const shareBtn = document.createElement('button');
    shareBtn.type = 'button';
    shareBtn.className = 'notas-sb-item-share-btn';
    shareBtn.title = 'Compartir nota';
    shareBtn.style.cssText = 'background:none;border:none;cursor:pointer;padding:0 4px;opacity:0;transition:opacity 0.2s, color 0.15s;flex-shrink:0;color:var(--c-fg-dim);display:flex;align-items:center;justify-content:center;';
    shareBtn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" style="width:11px;height:11px;display:block;opacity:0.85;"><path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81a3 3 0 1 0-3-3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9a3 3 0 1 0 0 6c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65a3 3 0 1 0 3-3z"/></svg>`;

    el.addEventListener('mouseenter', () => { shareBtn.style.opacity = '1'; });
    el.addEventListener('mouseleave', () => { shareBtn.style.opacity = '0'; });
    shareBtn.addEventListener('mouseenter', () => { shareBtn.style.color = 'var(--c-fg, #fff)'; });
    shareBtn.addEventListener('mouseleave', () => { shareBtn.style.color = 'var(--c-fg-dim, #888)'; });

    shareBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openSharingModal(note.id, note.title || '(sin título)', courseId);
    });
    el.appendChild(shareBtn);
  }

  // Click: open as pod in the course workspace
  el.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('musiki:open-db-note', {
      detail: { noteId: note.id, title: note.title || '(sin título)' },
    }));
  });

  el.addEventListener('dragstart', e => {
    if (!e.dataTransfer) return;
    e.dataTransfer.setData('text/x-musiki-note', note.id);
    e.dataTransfer.setData('text/x-musiki-note-title', note.title || '');
    e.dataTransfer.effectAllowed = 'move';
  });

  el.addEventListener('contextmenu', e => {
    e.preventDefault();
    showNoteMenu(e, note);
  });
  return el;
}

// Used only for the "Compartidas conmigo" section: those notes are never
// owned by the viewer (renderSharedSection only feeds it notes whose
// userId differs from the viewer's), so this menu only ever offers to open
// the note — rename/share/delete for the viewer's own notes now live in
// the shared renderer's per-note action menu (see renderNotesTree above).
function showNoteMenu(e: MouseEvent, note: NoteItem) {
  document.querySelector('.notas-sb-ctx')?.remove();
  const menu = buildCtxMenu(e.clientX, e.clientY, [
    ['Abrir como pod', () => {
      window.dispatchEvent(new CustomEvent('musiki:open-db-note', {
        detail: { noteId: note.id, title: note.title || '(sin título)' },
      }));
    }],
  ]);
  document.body.appendChild(menu);
  setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 0);
}

function buildCtxMenu(x: number, y: number, items: [string, () => void][]): HTMLElement {
  const menu = document.createElement('div');
  menu.className = 'notas-sb-ctx';
  menu.style.cssText = `position:fixed;left:${x}px;top:${y}px;background:var(--c-bg,#fff);border:1px solid var(--c-border,rgba(120,120,140,.2));border-radius:4px;box-shadow:0 2px 8px rgba(0,0,0,.15);z-index:9999;min-width:140px;padding:.25rem 0;font-size:.75rem`;
  for (const [label, action] of items) {
    const btn = document.createElement('button');
    btn.style.cssText = 'display:block;width:100%;text-align:left;padding:.3rem .7rem;border:none;background:none;cursor:pointer;color:inherit;font:inherit;font-size:.75rem';
    btn.textContent = label;
    btn.addEventListener('mouseenter', () => { btn.style.background = 'rgba(0,0,0,.06)'; });
    btn.addEventListener('mouseleave', () => { btn.style.background = ''; });
    btn.addEventListener('click', () => { menu.remove(); action(); });
    menu.appendChild(btn);
  }
  return menu;
}

function escHtml(s: string) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function renderNotesTreeError(container: HTMLElement, error: unknown) {
  container.querySelector('[data-notas-error]')?.remove();
  const message = error instanceof Error ? error.message : 'Error al cargar notas.';
  const row = document.createElement('div');
  row.dataset.notasError = 'true';
  row.style.cssText = 'padding:5px 8px;color:#c87e7e;font-size:11px;';
  row.textContent = message;
  container.prepend(row);
}

export function openSharingModal(noteId: string, noteTitle: string, courseId: string) {
  let backdrop = document.getElementById('notes-share-modal');
  if (backdrop) backdrop.remove();

  backdrop = document.createElement('div');
  backdrop.id = 'notes-share-modal';
  backdrop.style.cssText = `
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.45);
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
    z-index: 10000;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: opacity 0.2s ease;
  `;

  const card = document.createElement('div');
  card.style.cssText = `
    width: 520px;
    max-width: 92vw;
    max-height: 90vh;
    background: var(--c-bg, #1a1a1f);
    border: 1px solid var(--c-border, rgba(120, 120, 140, 0.25));
    border-radius: 8px;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.35);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    transform: scale(0.96);
    transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    color: var(--c-fg, #e5e5e5);
    font-family: var(--font-ui, system-ui, -apple-system, sans-serif);
  `;

  card.innerHTML = `
    <div style="padding: 16px 20px; border-bottom: 1px solid var(--c-border, rgba(120,120,140,0.18)); display: flex; align-items: center; justify-content: space-between;">
      <div>
        <h3 style="margin: 0; font-size: 1rem; font-weight: 600; letter-spacing: 0.02em;">Compartir Nota</h3>
        <div style="font-size: 11px; color: var(--c-fg-dim); max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escHtml(noteTitle)}">${escHtml(noteTitle)}</div>
      </div>
      <button class="notes-share-close-btn" style="background: none; border: none; color: var(--c-fg-dim); cursor: pointer; padding: 4px; display: flex; align-items: center; justify-content: center; transition: color 0.12s;">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>

    <div style="flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 16px; min-height: 0;">
      <!-- Seccion 1: Selector de nivel de acceso y Filtro -->
      <div style="display: flex; flex-direction: column; gap: 6px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <label style="font-size: 10px; font-weight: 700; color: var(--c-fg-dim); text-transform: uppercase; letter-spacing: 0.05em;">Asignar acceso</label>
          <div style="display: flex; align-items: center; gap: 6px;">
            <span style="font-size: 11px; color: var(--c-fg-dim);">Nivel:</span>
            <select class="share-user-level" style="padding: 3px 6px; font-size: 11px; background: rgba(0,0,0,0.18); border: 1px solid var(--c-border, rgba(120,120,140,0.25)); border-radius: 4px; color: inherit; outline: none; cursor: pointer;">
              <option value="view">Leer</option>
              <option value="comment" selected>Comentar</option>
              <option value="edit">Editar</option>
            </select>
          </div>
        </div>
        <input type="text" class="share-user-search" placeholder="Filtrar personas, roles o comisiones..." style="width: 100%; padding: 8px 12px; font-size: 12px; background: rgba(0,0,0,0.15); border: 1px solid var(--c-border, rgba(120,120,140,0.22)); border-radius: 6px; color: inherit; outline: none; transition: border-color 0.15s;" />
      </div>

      <!-- Seccion 2: Paneles de seleccion (Personas y Grupos/Roles) -->
      <div style="display: grid; grid-template-columns: 1.2fr 1fr; gap: 14px; height: 220px; min-height: 220px;">
        <!-- Columna Izquierda: Personas -->
        <div style="display: flex; flex-direction: column; border: 1px solid var(--c-border, rgba(120,120,140,0.15)); border-radius: 6px; background: rgba(0,0,0,0.08); overflow: hidden;">
          <div style="padding: 6px 10px; font-size: 9.5px; font-weight: 700; text-transform: uppercase; color: var(--c-fg-dim); border-bottom: 1px solid rgba(120,120,140,0.12); background: rgba(0,0,0,0.15); letter-spacing: 0.05em;">Personas</div>
          <div class="share-members-list" style="flex: 1; overflow-y: auto; padding: 4px; display: flex; flex-direction: column; gap: 2px;">
             <div style="font-size: 11px; opacity: 0.4; padding: 12px; text-align: center;">Cargando personas...</div>
          </div>
        </div>

        <!-- Columna Derecha: Roles y Grupos -->
        <div style="display: flex; flex-direction: column; border: 1px solid var(--c-border, rgba(120,120,140,0.15)); border-radius: 6px; background: rgba(0,0,0,0.08); overflow: hidden;">
          <div style="padding: 6px 10px; font-size: 9.5px; font-weight: 700; text-transform: uppercase; color: var(--c-fg-dim); border-bottom: 1px solid rgba(120,120,140,0.12); background: rgba(0,0,0,0.15); letter-spacing: 0.05em;">Roles y Grupos</div>
          <div class="share-groups-list" style="flex: 1; overflow-y: auto; padding: 4px; display: flex; flex-direction: column; gap: 2px;">
             <div style="font-size: 11px; opacity: 0.4; padding: 12px; text-align: center;">Cargando grupos...</div>
          </div>
        </div>
      </div>

      <!-- Seccion 3: Lista de accesos activos -->
      <div style="display: flex; flex-direction: column; min-height: 120px; max-height: 160px; min-height: 0; flex: 1;">
        <label style="display: block; font-size: 10px; font-weight: 700; color: var(--c-fg-dim); text-transform: uppercase; margin-bottom: 6px; letter-spacing: 0.05em;">Accesos activos</label>
        <div class="active-shares-list" style="flex: 1; overflow-y: auto; background: rgba(0,0,0,0.08); border: 1px solid var(--c-border, rgba(120,120,140,0.15)); border-radius: 6px; padding: 6px; display: flex; flex-direction: column; gap: 4px;">
          <div style="font-size: 11px; opacity: 0.4; padding: 12px; text-align: center;">Cargando accesos...</div>
        </div>
      </div>
    </div>
  `;

  backdrop.appendChild(card);
  document.body.appendChild(backdrop);

  // Trigger modal transition
  void backdrop.offsetWidth;
  backdrop.style.opacity = '1';
  card.style.transform = 'scale(1)';

  // Close helper
  const closeModal = () => {
    backdrop!.style.opacity = '0';
    card.style.transform = 'scale(0.96)';
    setTimeout(() => { backdrop!.remove(); }, 200);
  };

  card.querySelector('.notes-share-close-btn')?.addEventListener('click', closeModal);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeModal(); });

  // Elements
  const searchInput = card.querySelector<HTMLInputElement>('.share-user-search')!;
  const userLevelSelect = card.querySelector<HTMLSelectElement>('.share-user-level')!;
  const membersList = card.querySelector<HTMLElement>('.share-members-list')!;
  const groupsList = card.querySelector<HTMLElement>('.share-groups-list')!;
  const activeList = card.querySelector<HTMLElement>('.active-shares-list')!;

  // Caches
  let allUsers: any[] = [];
  let allGroups: any[] = [];
  let activeShares: any[] = [];

  const getAccessLabel = (level: string) => {
    if (level === 'view') return 'Leer';
    if (level === 'comment') return 'Comentar';
    if (level === 'edit') return 'Editar';
    return level;
  };

  const renderMembersColumn = () => {
    membersList.innerHTML = '';
    const queryStr = searchInput.value.trim().toLowerCase();

    const filteredUsers = allUsers.filter(u => {
      if (!queryStr) return true;
      const roleLabel = u.roleInCourse === 'teacher' ? 'docente' : 'estudiante';
      const groupLabel = u.grupo ? `comisión ${u.grupo}` : '';
      return (
        String(u.name || '').toLowerCase().includes(queryStr) ||
        String(u.email || '').toLowerCase().includes(queryStr) ||
        roleLabel.includes(queryStr) ||
        groupLabel.toLowerCase().includes(queryStr)
      );
    });

    if (filteredUsers.length === 0) {
      membersList.innerHTML = '<div style="font-size: 11px; opacity: 0.4; padding: 12px; text-align: center;">No se encontraron personas</div>';
      return;
    }

    for (const u of filteredUsers) {
      const item = document.createElement('div');

      const activeShare = activeShares.find(s => s.targetType === 'user' && String(s.targetId) === String(u.id));
      const isShared = !!activeShare;

      item.style.cssText = `
        padding: 6px 10px;
        font-size: 11px;
        cursor: pointer;
        transition: background 0.15s, border-left-color 0.15s;
        display: flex;
        align-items: center;
        justify-content: space-between;
        border-bottom: 1px solid rgba(120,120,140,0.06);
        border-left: 3px solid ${isShared ? 'var(--c-link, #45d384)' : 'transparent'};
        background: ${isShared ? 'rgba(69,211,132,0.04)' : 'transparent'};
      `;

      const roleLabel = u.roleInCourse === 'teacher' ? 'Docente' : 'Estudiante';
      const groupLabel = u.grupo ? ` · Com. ${u.grupo}` : '';

      let rightColumnMarkup = '';
      if (isShared) {
        rightColumnMarkup = `<span style="font-size: 9px; color: var(--c-link, #45d384); font-weight: 600; display: inline-flex; align-items: center; gap: 2px; flex-shrink: 0;">✓ ${getAccessLabel(activeShare.accessLevel)}</span>`;
      } else {
        rightColumnMarkup = `<span style="font-size: 9.5px; background: rgba(120,120,140,0.12); padding: 1px 4px; border-radius: 3px; opacity: 0.75; flex-shrink: 0; white-space: nowrap;">${roleLabel}${groupLabel}</span>`;
      }

      item.innerHTML = `
        <div style="display: flex; flex-direction: column; overflow: hidden; margin-right: 8px; flex: 1;">
          <strong style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px;">${escHtml(u.name)}</strong>
          <span style="opacity: 0.5; font-size: 9.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escHtml(u.email)}</span>
        </div>
        ${rightColumnMarkup}
      `;

      item.addEventListener('mouseenter', () => {
        item.style.background = isShared ? 'rgba(69,211,132,0.08)' : 'rgba(255,255,255,0.05)';
      });
      item.addEventListener('mouseleave', () => {
        item.style.background = isShared ? 'rgba(69,211,132,0.04)' : 'transparent';
      });

      item.addEventListener('click', async () => {
        await fetch('/api/live/notes/share', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            noteId,
            targetType: 'user',
            targetId: u.id,
            accessLevel: userLevelSelect.value
          })
        });
        void loadActiveShares();
      });

      membersList.appendChild(item);
    }
  };

  const renderGroupsColumn = () => {
    groupsList.innerHTML = '';
    const queryStr = searchInput.value.trim().toLowerCase();

    const systemGroups = [
      { id: 'teachers', name: 'Todos los Profesores', icon: '👥' },
      { id: 'students', name: 'Todos los Estudiantes', icon: '👥' }
    ];

    const itemsList = [
      ...systemGroups.map(g => ({ id: g.id, name: g.name, type: g.id, icon: g.icon })),
      ...allGroups.map(g => ({ id: g.id, name: g.name, type: 'class', icon: '👥' }))
    ];

    const filteredItems = itemsList.filter(item => {
      if (!queryStr) return true;
      return item.name.toLowerCase().includes(queryStr);
    });

    if (filteredItems.length === 0) {
      groupsList.innerHTML = '<div style="font-size: 11px; opacity: 0.4; padding: 12px; text-align: center;">No se encontraron grupos</div>';
      return;
    }

    for (const itemInfo of filteredItems) {
      const item = document.createElement('div');

      const targetType = (itemInfo.type === 'teachers' || itemInfo.type === 'students') ? itemInfo.type : 'class';
      const targetId = (itemInfo.type === 'teachers' || itemInfo.type === 'students') ? courseId : itemInfo.id;

      const activeShare = activeShares.find(s => s.targetType === targetType && String(s.targetId) === String(targetId));
      const isShared = !!activeShare;

      item.style.cssText = `
        padding: 8px 10px;
        font-size: 11px;
        cursor: pointer;
        transition: background 0.15s, border-left-color 0.15s;
        display: flex;
        align-items: center;
        justify-content: space-between;
        border-bottom: 1px solid rgba(120,120,140,0.06);
        border-left: 3px solid ${isShared ? 'var(--c-link, #45d384)' : 'transparent'};
        background: ${isShared ? 'rgba(69,211,132,0.04)' : 'transparent'};
      `;

      let rightColumnMarkup = '';
      if (isShared) {
        rightColumnMarkup = `<span style="font-size: 9px; color: var(--c-link, #45d384); font-weight: 600; display: inline-flex; align-items: center; gap: 2px; flex-shrink: 0;">✓ ${getAccessLabel(activeShare.accessLevel)}</span>`;
      }

      item.innerHTML = `
        <div style="display: flex; align-items: center; gap: 6px; overflow: hidden; margin-right: 8px; flex: 1;">
          <span style="font-size: 12px; flex-shrink: 0;">${itemInfo.icon}</span>
          <span style="font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px;">${escHtml(itemInfo.name)}</span>
        </div>
        ${rightColumnMarkup}
      `;

      item.addEventListener('mouseenter', () => {
        item.style.background = isShared ? 'rgba(69,211,132,0.08)' : 'rgba(255,255,255,0.05)';
      });
      item.addEventListener('mouseleave', () => {
        item.style.background = isShared ? 'rgba(69,211,132,0.04)' : 'transparent';
      });

      item.addEventListener('click', async () => {
        await fetch('/api/live/notes/share', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            noteId,
            targetType,
            targetId,
            accessLevel: userLevelSelect.value
          })
        });
        void loadActiveShares();
      });

      groupsList.appendChild(item);
    }
  };

  const loadActiveShares = async () => {
    try {
      const res = await fetch(`/api/live/notes/share?noteId=${noteId}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      activeShares = data.shares ?? [];

      activeList.innerHTML = '';
      if (activeShares.length === 0) {
        activeList.innerHTML = '<div style="font-size: 11px; opacity: 0.4; padding: 12px; text-align: center;">Nota privada (no compartida con nadie más)</div>';
      } else {
        for (const share of activeShares) {
          const row = document.createElement('div');
          row.style.cssText = 'display: flex; align-items: center; justify-content: space-between; padding: 6px 8px; background: rgba(255,255,255,0.02); border-radius: 4px; border: 1px solid rgba(120,120,140,0.1); font-size: 11px; gap: 8px; transition: background 0.15s;';
          row.addEventListener('mouseenter', () => { row.style.background = 'rgba(255,255,255,0.04)'; });
          row.addEventListener('mouseleave', () => { row.style.background = 'rgba(255,255,255,0.02)'; });

          let label = '';
          if (share.targetType === 'user') {
            label = `${share.targetName || 'Usuario'} <span style="opacity: 0.6; font-size: 10px;">(${share.targetEmail || 'sin email'})</span>`;
          } else if (share.targetType === 'teachers') {
            label = '👥 Todos los Profesores';
          } else if (share.targetType === 'students') {
            label = '👥 Todos los Estudiantes';
          } else if (share.targetType === 'class') {
            const name = share.targetId.split('/').pop() || share.targetId;
            label = `👥 Comisión: ${name}`;
          }

          row.innerHTML = `
            <div style="flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${label}</div>
            <div style="display: flex; align-items: center; gap: 6px;">
              <select class="share-update-level" style="padding: 2px 4px; font-size: 10px; background: rgba(0,0,0,0.12); border: 1px solid var(--c-border, rgba(120,120,140,0.22)); border-radius: 3px; color: inherit; outline: none; cursor: pointer;">
                <option value="view" ${share.accessLevel === 'view' ? 'selected' : ''}>Leer</option>
                <option value="comment" ${share.accessLevel === 'comment' ? 'selected' : ''}>Comentar</option>
                <option value="edit" ${share.accessLevel === 'edit' ? 'selected' : ''}>Editar</option>
              </select>
              <button class="share-revoke-btn" style="background: none; border: none; color: #c87e7e; cursor: pointer; padding: 2px; display: flex; align-items: center; transition: opacity 0.12s, transform 0.12s; opacity: 0.7;">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>
          `;

          // Hover feedback for revoke button
          const revokeBtn = row.querySelector('.share-revoke-btn') as HTMLElement;
          revokeBtn.addEventListener('mouseenter', () => {
            revokeBtn.style.opacity = '1';
            revokeBtn.style.transform = 'scale(1.15)';
          });
          revokeBtn.addEventListener('mouseleave', () => {
            revokeBtn.style.opacity = '0.7';
            revokeBtn.style.transform = 'scale(1)';
          });

          // Bind update
          row.querySelector('.share-update-level')?.addEventListener('change', async (ev) => {
            const newLevel = (ev.target as HTMLSelectElement).value;
            await fetch('/api/live/notes/share', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                noteId,
                targetType: share.targetType,
                targetId: share.targetId,
                accessLevel: newLevel
              })
            });
            void loadActiveShares();
          });

          // Bind revoke
          row.querySelector('.share-revoke-btn')?.addEventListener('click', async () => {
            await fetch(`/api/live/notes/share?id=${share.id}`, { method: 'DELETE' });
            void loadActiveShares();
          });

          activeList.appendChild(row);
        }
      }

      // Sync members and groups selections checkmarks/badges
      renderMembersColumn();
      renderGroupsColumn();
    } catch {
      activeList.innerHTML = '<div style="font-size: 11px; color: #c87e7e; padding: 12px; text-align: center;">Error al cargar accesos</div>';
    }
  };

  // Sync text input client-side filtering
  searchInput.addEventListener('input', () => {
    renderMembersColumn();
    renderGroupsColumn();
  });

  const loadInitialData = async () => {
    try {
      const [membersRes, groupsRes] = await Promise.all([
        fetch(`/api/live/notes/share?courseId=${encodeURIComponent(courseId)}&search=`),
        fetch(`/api/live/notes/share?courseId=${encodeURIComponent(courseId)}&groups=true`)
      ]);

      if (membersRes.ok) {
        const data = await membersRes.json();
        allUsers = data.users ?? [];
      }

      if (groupsRes.ok) {
        const data = await groupsRes.json();
        allGroups = data.classes ?? [];
      }

      void loadActiveShares();
    } catch {
      membersList.innerHTML = '<div style="font-size: 11px; color: #c87e7e; padding: 12px; text-align: center;">Error al cargar</div>';
      groupsList.innerHTML = '<div style="font-size: 11px; color: #c87e7e; padding: 12px; text-align: center;">Error al cargar</div>';
    }
  };

  void loadInitialData();
}
