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

export function renderNotesTree(
  container: HTMLElement,
  folders: NoteFolder[],
  notes: NoteItem[],
  courseId: string,
) {
  container.innerHTML = '';

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

  function renderFolder(parentId: string | null, indent: number): HTMLElement {
    const frag = document.createElement('div');

    for (const folder of (children.get(parentId) ?? [])) {
      const details = document.createElement('details');
      details.open = true;
      details.style.cssText = `padding-left:${indent * 8}px`;
      const summary = document.createElement('summary');
      summary.className = 'notas-sb-folder';
      summary.style.cssText = 'font-size:.72rem;cursor:pointer;list-style:none;padding:.15rem .3rem;display:flex;align-items:center;gap:.25rem;opacity:.7';
      summary.innerHTML = `<span>📁</span><span class="notas-sb-folder-name">${escHtml(folder.name)}</span>`;
      details.appendChild(summary);
      summary.addEventListener('contextmenu', e => { e.preventDefault(); showFolderMenu(e, folder, container, courseId); });
      const inner = renderFolder(folder.id, indent + 1);
      details.appendChild(inner);
      frag.appendChild(details);
    }

    for (const note of (notesByFolder.get(parentId) ?? [])) {
      frag.appendChild(makeNoteItem(note, indent));
    }

    return frag;
  }

  container.appendChild(renderFolder(null, 0));
}

function makeNoteItem(note: NoteItem, indent: number): HTMLElement {
  const el = document.createElement('div');
  el.className = 'notas-sb-item';
  el.draggable = true;
  el.dataset.noteId = note.id;
  el.style.cssText = `padding:.18rem .4rem .18rem ${indent * 8 + 4}px;font-size:.73rem;cursor:pointer;display:flex;align-items:center;gap:.25rem;border-left:2px solid transparent;opacity:.75;transition:opacity 100ms,border-color 100ms`;
  el.title = note.title || '(sin título)';
  el.innerHTML = `<span style="opacity:.5">🗒</span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(note.title || '(sin título)')}</span>`;

  el.addEventListener('mouseenter', () => { el.style.opacity = '1'; });
  el.addEventListener('mouseleave', () => { el.style.opacity = '.75'; });

  el.addEventListener('dragstart', e => {
    if (!e.dataTransfer) return;
    e.dataTransfer.setData('text/x-musiki-note', note.id);
    e.dataTransfer.setData('text/x-musiki-note-title', note.title || '');
    e.dataTransfer.effectAllowed = 'copy';
  });

  el.addEventListener('contextmenu', e => { e.preventDefault(); showNoteMenu(e, note); });
  return el;
}

function showNoteMenu(e: MouseEvent, note: NoteItem) {
  document.querySelector('.notas-sb-ctx')?.remove();
  const menu = document.createElement('div');
  menu.className = 'notas-sb-ctx';
  menu.style.cssText = `position:fixed;left:${e.clientX}px;top:${e.clientY}px;background:var(--c-bg);border:1px solid var(--c-border,rgba(120,120,140,.2));border-radius:4px;box-shadow:0 2px 8px rgba(0,0,0,.15);z-index:9999;min-width:120px;padding:.25rem 0;font-size:.75rem`;
  const items: [string, () => void][] = [
    ['Renombrar', () => renameNote(note)],
    ['Eliminar', () => deleteNote(note)],
  ];
  for (const [label, action] of items) {
    const btn = document.createElement('button');
    btn.style.cssText = 'display:block;width:100%;text-align:left;padding:.3rem .7rem;border:none;background:none;cursor:pointer;color:inherit;font:inherit;font-size:.75rem';
    btn.textContent = label;
    btn.addEventListener('click', () => { menu.remove(); action(); });
    menu.appendChild(btn);
  }
  document.body.appendChild(menu);
  setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 0);
}

function showFolderMenu(e: MouseEvent, folder: NoteFolder, container: HTMLElement, courseId: string) {
  document.querySelector('.notas-sb-ctx')?.remove();
  const menu = document.createElement('div');
  menu.className = 'notas-sb-ctx';
  menu.style.cssText = `position:fixed;left:${e.clientX}px;top:${e.clientY}px;background:var(--c-bg);border:1px solid var(--c-border,rgba(120,120,140,.2));border-radius:4px;box-shadow:0 2px 8px rgba(0,0,0,.15);z-index:9999;min-width:120px;padding:.25rem 0;font-size:.75rem`;
  const items: [string, () => void][] = [
    ['Renombrar', () => renameFolder(folder, container, courseId)],
    ['Eliminar', () => deleteFolder(folder, container, courseId)],
  ];
  for (const [label, action] of items) {
    const btn = document.createElement('button');
    btn.style.cssText = 'display:block;width:100%;text-align:left;padding:.3rem .7rem;border:none;background:none;cursor:pointer;color:inherit;font:inherit;font-size:.75rem';
    btn.textContent = label;
    btn.addEventListener('click', () => { menu.remove(); action(); });
    menu.appendChild(btn);
  }
  document.body.appendChild(menu);
  setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 0);
}

async function renameNote(note: NoteItem) {
  const name = prompt('Nuevo nombre:', note.title);
  if (!name?.trim() || name === note.title) return;
  await fetch('/api/live/notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: note.id, title: name.trim() }),
  });
  document.querySelector<HTMLElement>(`[data-note-id="${note.id}"] span:last-child`)!.textContent = name.trim();
}

async function deleteNote(note: NoteItem) {
  if (!confirm('¿Eliminar esta nota?')) return;
  await fetch(`/api/live/notes?id=${note.id}`, { method: 'DELETE' });
  document.querySelector(`[data-note-id="${note.id}"]`)?.remove();
}

async function renameFolder(folder: NoteFolder, container: HTMLElement, courseId: string) {
  const name = prompt('Nuevo nombre:', folder.name);
  if (!name?.trim() || name === folder.name) return;
  await fetch('/api/note-folders', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: folder.id, name: name.trim() }),
  });
  const { folders, notes } = await loadNotesTree(courseId);
  renderNotesTree(container, folders, notes, courseId);
}

async function deleteFolder(folder: NoteFolder, container: HTMLElement, courseId: string) {
  if (!confirm('¿Eliminar carpeta? Las notas dentro quedarán sin carpeta.')) return;
  await fetch(`/api/note-folders?id=${folder.id}`, { method: 'DELETE' });
  const { folders, notes } = await loadNotesTree(courseId);
  renderNotesTree(container, folders, notes, courseId);
}

function escHtml(s: string) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
