// src/scripts/course/notes-sidebar.ts

export interface NoteFolder {
  id: string; name: string; parentId: string | null; courseId: string | null;
}
export interface NoteItem {
  id: string; title: string; folderId: string | null; updatedAt: string;
}

export async function loadNotesTree(courseId: string): Promise<{ folders: NoteFolder[]; notes: NoteItem[] }> {
  const [fRes, nRes] = await Promise.all([
    fetch(`/api/note-folders?courseId=${encodeURIComponent(courseId)}`),
    fetch(`/api/live/notes?courseId=${encodeURIComponent(courseId)}&limit=200`),
  ]);
  const fData = fRes.ok ? await fRes.json() : { folders: [] };
  const nData = nRes.ok ? await nRes.json() : { notes: [] };
  return { folders: fData.folders ?? [], notes: nData.notes ?? [] };
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

export function renderNotesTree(
  container: HTMLElement,
  folders: NoteFolder[],
  notes: NoteItem[],
  courseId: string,
) {
  container.innerHTML = '';

  const reload = async () => {
    const { folders: f, notes: n } = await loadNotesTree(courseId);
    renderNotesTree(container, f, n, courseId);
  };

  const children = new Map<string | null, NoteFolder[]>();
  for (const f of folders) {
    const key = f.parentId ?? null;
    if (!children.has(key)) children.set(key, []);
    children.get(key)!.push(f);
  }

  const notesByFolder = new Map<string | null, NoteItem[]>();
  for (const n of notes) {
    const key = n.folderId ?? null;
    if (!notesByFolder.has(key)) notesByFolder.set(key, []);
    notesByFolder.get(key)!.push(n);
  }

  // Root drop zone: drop a note here to remove it from its folder
  const rootDrop = document.createElement('div');
  rootDrop.className = 'notas-sb-root-drop';
  rootDrop.style.cssText = 'min-height:4px;transition:background 120ms';
  rootDrop.addEventListener('dragover', e => {
    if (!e.dataTransfer?.types.includes('text/x-musiki-note')) return;
    e.preventDefault();
    rootDrop.style.background = 'rgba(100,180,100,.15)';
  });
  rootDrop.addEventListener('dragleave', () => { rootDrop.style.background = ''; });
  rootDrop.addEventListener('drop', async e => {
    rootDrop.style.background = '';
    const noteId = e.dataTransfer?.getData('text/x-musiki-note');
    if (!noteId) return;
    e.preventDefault();
    await fetch('/api/live/notes', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: noteId, folderId: null }),
    });
    await reload();
  });
  container.appendChild(rootDrop);

  function renderLevel(parentId: string | null, indent: number): HTMLElement {
    const frag = document.createElement('div');

    for (const folder of (children.get(parentId) ?? [])) {
      const details = document.createElement('details');
      details.open = true;
      details.style.cssText = `padding-left:${indent * 8}px`;

      const summary = document.createElement('summary');
      summary.className = 'notas-sb-folder';
      summary.style.cssText = 'font-size:.72rem;cursor:pointer;list-style:none;padding:.15rem .3rem;display:flex;align-items:center;gap:.25rem;opacity:.7;border-radius:3px;transition:background 120ms';
      summary.innerHTML = `<span>⊟</span><span class="notas-sb-folder-name">${escHtml(folder.name)}</span>`;

      // Folder drop zone
      summary.addEventListener('dragover', e => {
        if (!e.dataTransfer?.types.includes('text/x-musiki-note')) return;
        e.preventDefault();
        summary.style.background = 'rgba(100,180,100,.18)';
      });
      summary.addEventListener('dragleave', () => { summary.style.background = ''; });
      summary.addEventListener('drop', async e => {
        summary.style.background = '';
        const noteId = e.dataTransfer?.getData('text/x-musiki-note');
        if (!noteId) return;
        e.preventDefault();
        await fetch('/api/live/notes', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: noteId, folderId: folder.id }),
        });
        await reload();
      });

      summary.addEventListener('contextmenu', e => { e.preventDefault(); showFolderMenu(e, folder, reload, courseId); });

      details.appendChild(summary);
      details.appendChild(renderLevel(folder.id, indent + 1));
      frag.appendChild(details);
    }

    for (const note of (notesByFolder.get(parentId) ?? [])) {
      frag.appendChild(makeNoteItem(note, indent, reload));
    }

    return frag;
  }

  container.appendChild(renderLevel(null, 0));
}

function makeNoteItem(note: NoteItem, indent: number, reload: () => Promise<void>): HTMLElement {
  const el = document.createElement('div');
  el.className = 'notas-sb-item';
  el.draggable = true;
  el.dataset.noteId = note.id;
  el.style.cssText = `padding:.18rem .4rem .18rem ${indent * 8 + 4}px;font-size:.73rem;cursor:pointer;display:flex;align-items:center;gap:.25rem;border-left:2px solid transparent;opacity:.75;transition:opacity 100ms,border-color 100ms,background 100ms;border-radius:3px`;
  el.title = note.title || '(sin título)';
  el.innerHTML = `<span style="opacity:.5;flex-shrink:0">🗒</span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(note.title || '(sin título)')}</span>`;

  el.addEventListener('mouseenter', () => { el.style.opacity = '1'; el.style.background = 'rgba(0,0,0,.04)'; });
  el.addEventListener('mouseleave', () => { el.style.opacity = '.75'; el.style.background = ''; });

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
    e.dataTransfer.effectAllowed = 'copy';
  });

  el.addEventListener('contextmenu', e => { e.preventDefault(); showNoteMenu(e, note, el, reload); });
  return el;
}

function showNoteMenu(e: MouseEvent, note: NoteItem, el: HTMLElement, reload: () => Promise<void>) {
  document.querySelector('.notas-sb-ctx')?.remove();
  const menu = buildCtxMenu(e.clientX, e.clientY, [
    ['Abrir como pod', () => {
      window.dispatchEvent(new CustomEvent('musiki:open-db-note', {
        detail: { noteId: note.id, title: note.title || '(sin título)' },
      }));
    }],
    ['Renombrar', () => renameNote(note, el)],
    ['Eliminar', () => deleteNote(note, reload)],
  ]);
  document.body.appendChild(menu);
  setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 0);
}

function showFolderMenu(e: MouseEvent, folder: NoteFolder, reload: () => Promise<void>, courseId: string) {
  document.querySelector('.notas-sb-ctx')?.remove();
  const menu = buildCtxMenu(e.clientX, e.clientY, [
    ['Nueva nota aquí', () => createNoteInFolder(folder.id, courseId, reload)],
    ['Nueva subcarpeta', () => createSubfolder(folder.id, courseId, reload)],
    ['Renombrar', () => renameFolder(folder, reload)],
    ['Eliminar', () => deleteFolder(folder, reload)],
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

async function renameNote(note: NoteItem, el: HTMLElement) {
  const name = prompt('Nuevo nombre:', note.title);
  if (!name?.trim() || name === note.title) return;
  await fetch('/api/live/notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: note.id, title: name.trim(), body: '' }),
  });
  const span = el.querySelector('span:last-child');
  if (span) span.textContent = name.trim();
  note.title = name.trim();
}

async function deleteNote(note: NoteItem, reload: () => Promise<void>) {
  if (!confirm(`¿Eliminar "${note.title || '(sin título)'}"?`)) return;
  await fetch(`/api/live/notes?id=${note.id}`, { method: 'DELETE' });
  await reload();
}

async function renameFolder(folder: NoteFolder, reload: () => Promise<void>) {
  const name = prompt('Nuevo nombre:', folder.name);
  if (!name?.trim() || name === folder.name) return;
  await fetch('/api/note-folders', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: folder.id, name: name.trim() }),
  });
  await reload();
}

async function deleteFolder(folder: NoteFolder, reload: () => Promise<void>) {
  if (!confirm('¿Eliminar carpeta? Las notas dentro quedarán sin carpeta.')) return;
  await fetch(`/api/note-folders?id=${folder.id}`, { method: 'DELETE' });
  await reload();
}

async function createNoteInFolder(folderId: string, courseId: string, reload: () => Promise<void>) {
  const title = prompt('Nombre de la nueva nota:');
  if (!title?.trim()) return;
  await fetch('/api/live/notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: title.trim(), body: '', courseId, folderId }),
  });
  await reload();
}

async function createSubfolder(parentId: string, courseId: string, reload: () => Promise<void>) {
  const name = prompt('Nombre de la subcarpeta:');
  if (!name?.trim()) return;
  await createFolder(courseId, name.trim(), parentId);
  await reload();
}

function escHtml(s: string) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
