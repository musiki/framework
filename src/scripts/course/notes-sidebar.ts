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

export function beginRootNoteCreation(container: HTMLElement): void {
  container.querySelector<HTMLButtonElement>('[data-notas-new-placeholder]')?.click();
}

export function beginInlineFolderCreation(
  container: HTMLElement,
  courseId: string,
  parentId: string | null = null,
  indent = 0,
): void {
  if (container.querySelector('[data-notas-folder-input]')) return;
  const row = document.createElement('div');
  row.dataset.notasFolderInput = 'true';
  row.style.cssText = `padding:3px 8px 3px ${indent * 20 + 20}px;display:flex;align-items:center;gap:4px;font-size:11px;color:#aaa`;
  row.innerHTML = '<span style="color:#4e6070;font-size:11px">⊟</span>';
  const input = document.createElement('input');
  input.placeholder = 'nombre de carpeta...';
  input.style.cssText = 'font:inherit;border:none;border-bottom:1px solid var(--c-link,#3b82f6);background:transparent;color:inherit;width:9rem;outline:none;padding:0';
  row.appendChild(input);
  container.appendChild(row);
  input.focus();

  let committing = false;
  const commit = async () => {
    if (committing) return;
    committing = true;
    const name = input.value.trim();
    row.remove();
    if (!name) return;
    await createFolder(courseId, name, parentId);
    const tree = await loadNotesTree(courseId);
    renderNotesTree(container, tree.folders, tree.notes, courseId);
  };
  input.addEventListener('blur', () => { void commit(); }, { once: true });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { e.preventDefault(); input.value = ''; input.blur(); }
  });
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
  for (const level of children.values()) {
    level.sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
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
    frag.className = 'notas-sb-level';

    for (const folder of (children.get(parentId) ?? [])) {
      const details = document.createElement('details');
      details.open = true;
      details.style.cssText = `padding-left:${indent * 8}px`;

      const summary = document.createElement('summary');
      summary.className = 'notas-sb-folder';
      summary.style.cssText = 'font-size:11px;cursor:pointer;list-style:none;padding:3px 8px;display:flex;align-items:center;gap:4px;color:#aaa;border-radius:2px;transition:background 120ms';
      summary.innerHTML = `<span class="notas-sb-folder-caret" style="color:#555;font-size:9px;width:8px">▸</span><span class="notas-sb-folder-icon" style="color:#4e6070;font-size:11px">⊟</span><span class="notas-sb-folder-name">${escHtml(folder.name)}</span>`;

      // Folder drop zone
      summary.addEventListener('dragover', e => {
        if (!e.dataTransfer?.types.includes('text/x-musiki-note')) return;
        e.preventDefault();
        summary.style.background = 'rgba(100,180,100,.18)';
      });
      summary.addEventListener('dragleave', () => { summary.style.background = ''; });
      summary.addEventListener('drop', async e => {
        e.preventDefault();
        e.stopPropagation();
        summary.style.background = '';
        const noteId = e.dataTransfer?.getData('text/x-musiki-note');
        if (!noteId) return;
        await fetch('/api/live/notes', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: noteId, folderId: folder.id }),
        });
        await reload();
      });

      summary.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); showFolderMenu(e, folder, notes, reload, courseId, summary, container, indent); });

      details.appendChild(summary);
      details.appendChild(renderLevel(folder.id, indent + 1));
      details.addEventListener('toggle', () => {
        const caret = summary.querySelector<HTMLElement>('.notas-sb-folder-caret');
        if (caret) caret.textContent = details.open ? '▾' : '▸';
      });
      const caret = summary.querySelector<HTMLElement>('.notas-sb-folder-caret');
      if (caret) caret.textContent = details.open ? '▾' : '▸';
      frag.appendChild(details);
    }

    const notesHere = [...(notesByFolder.get(parentId) ?? [])].sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    for (const note of notesHere) {
      frag.appendChild(makeNoteItem(note, indent, reload));
    }

    return frag;
  }

  container.appendChild(renderLevel(null, 0));
  const placeholder = document.createElement('button');
  placeholder.type = 'button';
  placeholder.dataset.notasNewPlaceholder = 'true';
  placeholder.style.cssText = 'display:flex;align-items:center;gap:5px;width:100%;padding:3px 8px;border:none;background:none;color:#888;cursor:pointer;font:inherit;font-size:11px;text-align:left';
  placeholder.innerHTML = '<span style="color:#45d384;font-size:12px;width:17px;text-align:center">+</span><span>nueva nota...</span>';
  placeholder.addEventListener('click', () => {
    void createNoteInFolder(null, courseId, reload, container, nextDefaultNoteTitle(notes));
  });
  placeholder.addEventListener('dragover', e => {
    if (!e.dataTransfer?.types.includes('text/x-musiki-note')) return;
    e.preventDefault();
    placeholder.style.background = 'rgba(69,211,132,.12)';
  });
  placeholder.addEventListener('dragleave', () => { placeholder.style.background = ''; });
  placeholder.addEventListener('drop', async e => {
    const noteId = e.dataTransfer?.getData('text/x-musiki-note');
    if (!noteId) return;
    e.preventDefault();
    placeholder.style.background = '';
    await fetch('/api/live/notes', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: noteId, folderId: null }),
    });
    await reload();
  });
  container.appendChild(placeholder);

  container.oncontextmenu = e => {
    if ((e.target as HTMLElement).closest('.notas-sb-item,.notas-sb-folder')) return;
    e.preventDefault();
    showRootMenu(e, container, courseId);
  };
}

function makeNoteItem(note: NoteItem, indent: number, reload: () => Promise<void>): HTMLElement {
  const el = document.createElement('div');
  el.className = 'notas-sb-item';
  el.draggable = true;
  el.dataset.noteId = note.id;
  el.style.cssText = `padding:2px 8px 2px ${indent * 20 + 8}px;font-size:11px;cursor:pointer;display:flex;align-items:center;gap:5px;border-left:2px solid transparent;opacity:.82;transition:opacity 100ms,border-color 100ms,background 100ms;border-radius:2px`;
  el.title = note.title || '(sin título)';
  el.dataset.noteId = note.id;
  el.innerHTML = `<span style="color:#45d384;font-size:12px;width:17px;text-align:center;flex-shrink:0">■</span><span class="notas-sb-note-title" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#d0d0d0">${escHtml(note.title || '(sin título)')}</span>`;

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
    e.dataTransfer.effectAllowed = 'move';
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

function showFolderMenu(e: MouseEvent, folder: NoteFolder, notes: NoteItem[], reload: () => Promise<void>, courseId: string, summaryEl: HTMLElement, container: HTMLElement, indent: number) {
  document.querySelector('.notas-sb-ctx')?.remove();
  const menu = buildCtxMenu(e.clientX, e.clientY, [
    ['Nueva nota aquí', () => createNoteInFolder(folder.id, courseId, reload, container, nextDefaultNoteTitle(notes))],
    ['Nueva carpeta aquí', () => beginInlineFolderCreation(container, courseId, folder.id, indent + 1)],
    ['Renombrar', () => renameFolder(folder, summaryEl)],
    ['Eliminar', () => deleteFolder(folder, reload)],
  ]);
  document.body.appendChild(menu);
  setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 0);
}

function showRootMenu(e: MouseEvent, container: HTMLElement, courseId: string) {
  document.querySelector('.notas-sb-ctx')?.remove();
  const menu = buildCtxMenu(e.clientX, e.clientY, [
    ['Nueva nota', () => beginRootNoteCreation(container)],
    ['Nueva carpeta', () => beginInlineFolderCreation(container, courseId)],
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

function renameNote(note: NoteItem, el: HTMLElement) {
  const titleSpan = el.querySelector<HTMLElement>('.notas-sb-note-title');
  if (!titleSpan) return;
  startInlineRename(titleSpan, note.id, el);
}

async function deleteNote(note: NoteItem, reload: () => Promise<void>) {
  if (!confirm(`¿Eliminar "${note.title || '(sin título)'}"?`)) return;
  await fetch(`/api/live/notes?id=${note.id}`, { method: 'DELETE' });
  await reload();
}

function renameFolder(folder: NoteFolder, summaryEl: HTMLElement) {
  const nameSpan = summaryEl.querySelector<HTMLElement>('.notas-sb-folder-name');
  if (!nameSpan) return;
  startInlineFolderRename(nameSpan, folder);
}

function startInlineFolderRename(nameSpan: HTMLElement, folder: NoteFolder) {
  const prev = nameSpan.textContent ?? '';
  const input = document.createElement('input');
  input.value = prev;
  input.placeholder = 'Nombre de la carpeta…';
  input.style.cssText = 'font:inherit;font-size:inherit;border:none;border-bottom:1px solid var(--c-link,#3b82f6);background:transparent;color:inherit;width:7rem;outline:none;padding:0';
  nameSpan.replaceWith(input);
  input.focus();
  input.select();
  const commit = async () => {
    const val = input.value.trim() || prev;
    input.replaceWith(nameSpan);
    nameSpan.textContent = val;
    if (val !== prev) {
      folder.name = val;
      await fetch('/api/note-folders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: folder.id, name: val }),
      });
    }
  };
  input.addEventListener('blur', commit, { once: true });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.value = prev; input.blur(); }
  });
}

async function deleteFolder(folder: NoteFolder, reload: () => Promise<void>) {
  if (!confirm('¿Eliminar carpeta? Las notas dentro quedarán sin carpeta.')) return;
  await fetch(`/api/note-folders?id=${folder.id}`, { method: 'DELETE' });
  await reload();
}

function nextDefaultNoteTitle(notes: NoteItem[]): string {
  const existing = new Set(notes.map(note => note.title.toLowerCase()));
  let index = 1;
  while (existing.has(`note-${String(index).padStart(2, '0')}`)) index++;
  return `note-${String(index).padStart(2, '0')}`;
}

async function createNoteInFolder(folderId: string | null, courseId: string, reload: () => Promise<void>, container?: HTMLElement, defaultTitle = 'note-01') {
  const res = await fetch('/api/live/notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: defaultTitle, body: '', courseId, folderId }),
  });
  if (!res.ok) return;
  const data = await res.json();
  const newId = data.note?.id;
  await reload();
  if (!newId || !container) return;
  const item = container.querySelector<HTMLElement>(`[data-note-id="${newId}"]`);
  const titleSpan = item?.querySelector<HTMLElement>('.notas-sb-note-title');
  if (!titleSpan || !item) return;
  startInlineRename(titleSpan, newId, item);
}

function startInlineRename(titleSpan: HTMLElement, noteId: string, item: HTMLElement) {
  const prev = titleSpan.textContent ?? '';
  const input = document.createElement('input');
  input.value = prev === '(sin título)' ? '' : prev;
  input.placeholder = 'Nombre de la nota…';
  input.style.cssText = 'font:inherit;font-size:inherit;border:none;border-bottom:1px solid var(--c-link,#3b82f6);background:transparent;color:inherit;width:100%;outline:none;padding:0';
  titleSpan.replaceWith(input);
  input.focus();
  input.select();
  const commit = async () => {
    const val = input.value.trim() || prev;
    input.replaceWith(titleSpan);
    titleSpan.textContent = val;
    item.title = val;
    await fetch('/api/live/notes', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: noteId, title: val }),
    });
  };
  input.addEventListener('blur', commit, { once: true });
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } if (e.key === 'Escape') { input.value = prev; input.blur(); } });
}

function escHtml(s: string) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
