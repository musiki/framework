// src/scripts/course/notes-sidebar.ts

export interface NoteFolder {
  id: string; name: string; parentId: string | null; courseId: string | null;
}
export interface NoteItem {
  id: string; title: string; folderId: string | null; updatedAt: string; body?: string;
  userId?: string;
  ownerName?: string;
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
  row.style.cssText = `padding:3px 8px 3px ${indent * 20 + 20}px;display:flex;align-items:center;gap:4px;font-size:11px;color:var(--c-fg)`;
  row.innerHTML = '<span style="color:var(--c-fg-dim);font-size:11px">⊟</span>';
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
    renderNotesTree(container, tree.folders, tree.notes, courseId, tree.currentUserId);
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
  currentUserId?: string,
) {
  container.innerHTML = '';

  const reload = async () => {
    try {
      const { folders: f, notes: n, currentUserId: uid } = await loadNotesTree(courseId);
      renderNotesTree(container, f, n, courseId, uid);
    } catch (error) {
      renderNotesTreeError(container, error);
    }
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
  const visibleFolderIds = new Set(folders.map(folder => folder.id));
  
  const uidToUse = currentUserId || '';
  const ownedNotes = notes.filter(n => !n.userId || n.userId === uidToUse);
  const sharedNotes = notes.filter(n => n.userId && n.userId !== uidToUse);

  for (const n of ownedNotes) {
    const key = n.folderId && visibleFolderIds.has(n.folderId) ? n.folderId : null;
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
      const isSpecialFolder = /^(70[\s-]*conceptos|80[\s-]*recursos|90[\s-]*notas)/i.test(folder.name);
      if (isSpecialFolder) {
        details.className = 'notas-sb-folder--special';
      }

      const summary = document.createElement('summary');
      summary.className = 'notas-sb-folder';
      summary.style.cssText = 'cursor:pointer;list-style:none;';
      summary.innerHTML = `<span class="notas-sb-folder-caret" style="color:var(--c-fg-dim);font-size:12px;width:10px">▸</span><span class="notas-sb-folder-icon" style="color:var(--c-fg-dim);font-size:11px">⊟</span><span class="notas-sb-folder-name">${escHtml(folder.name)}</span>`;

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
      frag.appendChild(makeNoteItem(note, indent, reload, uidToUse, courseId));
    }

    // Virtual Shared Notes folder at the bottom of the root level
    if (parentId === null && sharedNotes.length > 0) {
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
        sharedContent.appendChild(makeNoteItem(note, indent + 1, reload, uidToUse, courseId));
      }
      
      sharedDetails.appendChild(sharedSummary);
      sharedDetails.appendChild(sharedContent);
      
      sharedDetails.addEventListener('toggle', () => {
        const caret = sharedSummary.querySelector<HTMLElement>('.notas-sb-folder-caret');
        if (caret) caret.textContent = sharedDetails.open ? '▾' : '▸';
      });
      
      const caret = sharedSummary.querySelector<HTMLElement>('.notas-sb-folder-caret');
      if (caret) caret.textContent = sharedDetails.open ? '▾' : '▸';
      
      frag.appendChild(sharedDetails);
    }

    return frag;
  }

  container.appendChild(renderLevel(null, 0));
  const placeholder = document.createElement('button');
  placeholder.type = 'button';
  placeholder.className = 'notas-sb-placeholder';
  placeholder.dataset.notasNewPlaceholder = 'true';
  placeholder.style.cssText = 'display:flex;align-items:center;gap:5px;width:100%;border:none;background:none;cursor:pointer;text-align:left';
  placeholder.innerHTML = '<span class="lesson-icon" style="font-size:12px;width:17px;text-align:center;flex-shrink:0;color:#45d384">+</span><span>nueva nota...</span>';
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

function makeNoteItem(note: NoteItem, indent: number, reload: () => Promise<void>, currentUserId: string, courseId: string): HTMLElement {
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
  el.addEventListener('click', (e) => {
    window.dispatchEvent(new CustomEvent('musiki:open-db-note', {
      detail: { noteId: note.id, title: note.title || '(sin título)', split: e.altKey },
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
    showNoteMenu(e, note, el, reload, currentUserId, courseId);
  });
  return el;
}

function showNoteMenu(e: MouseEvent, note: NoteItem, el: HTMLElement, reload: () => Promise<void>, currentUserId: string, courseId: string) {
  document.querySelector('.notas-sb-ctx')?.remove();
  const isOwner = !note.userId || note.userId === currentUserId;
  const items: [string, () => void][] = [
    ['Abrir como pod', () => {
      window.dispatchEvent(new CustomEvent('musiki:open-db-note', {
        detail: { noteId: note.id, title: note.title || '(sin título)' },
      }));
    }]
  ];
  if (isOwner) {
    items.push(['Renombrar', () => renameNote(note, el)]);
    items.push(['Compartir', () => openSharingModal(note.id, note.title || '(sin título)', courseId)]);
    items.push(['Eliminar', () => deleteNote(note, reload)]);
  }
  const menu = buildCtxMenu(e.clientX, e.clientY, items);
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
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    if (container) renderNotesTreeError(container, new Error(data?.error || 'No se pudo crear la nota.'));
    return;
  }
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
