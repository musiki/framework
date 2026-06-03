import { listNotes, getNote, saveNote, createNote, deleteNote, moveNote } from './api';
import { renderTree } from './tree';
import { createEditor, getEditorContent, setEditorContent, isInsideEvalBlock } from './editor';
import { parseFrontmatter, serializeFrontmatter, populateYamlStrip, readYamlStrip } from './yaml-strip';
import { initToolbar } from './toolbar';
import type { NoteListItem } from './types';

const courseId = document.body.dataset.course || '';
let allNotes: NoteListItem[] = [];
let activeSlug: string | null = null;
let originalContent: string | null = null;
let editorMounted = false;

function broadcastNotesSidebarRefresh() {
  const detail = { courseId, at: Date.now() };
  window.dispatchEvent(new CustomEvent('musiki:notes-sidebar-refresh', { detail }));
  try {
    localStorage.setItem('musiki:notes-sidebar-refresh', JSON.stringify(detail));
  } catch {}
}

function setStatus(msg: string, type?: 'ok' | 'error') {
  const bar = document.getElementById('status-bar')!;
  bar.textContent = msg;
  bar.className = type ?? '';
  if (type === 'ok') setTimeout(() => { bar.textContent = 'listo'; bar.className = ''; }, 2500);
}

function showEditorPanel(show: boolean) {
  ['yaml-strip', 'snippet-toolbar', 'title-input-row', 'editor-cm-wrap'].forEach(id => {
    (document.getElementById(id) as HTMLElement).style.display = show ? '' : 'none';
  });
  (document.getElementById('empty-state') as HTMLElement).style.display = show ? 'none' : '';
}

async function loadNote(slug: string) {
  setStatus('Cargando...');
  try {
    const data = await getNote(courseId, slug);
    activeSlug = slug;
    originalContent = data.content;

    const { data: fm } = parseFrontmatter(data.content);
    (document.getElementById('title-input') as HTMLInputElement).value = fm.title;
    populateYamlStrip(allNotes, fm);

    const wrap = document.getElementById('editor-cm-wrap') as HTMLElement;
    if (!editorMounted) {
      createEditor(wrap, data.content, onEditorChange);
      editorMounted = true;
    } else {
      setEditorContent(data.content);
    }

    showEditorPanel(true);
    initToolbar(courseId, setStatus);
    refreshTree();
    setStatus('listo');
  } catch (e: any) {
    setStatus(e.message, 'error');
  }
}

function onEditorChange() {
  const inEval = isInsideEvalBlock();
  document.getElementById('eval-strip')!.classList.toggle('visible', inEval);
}

async function saveCurrentNote() {
  if (!activeSlug) return;
  setStatus('Guardando...');
  try {
    const raw = getEditorContent();
    const { data: fm, body } = parseFrontmatter(raw);
    const strip = readYamlStrip();
    const merged = { ...fm, ...strip } as any;

    const titleInput = document.getElementById('title-input') as HTMLInputElement;
    if (titleInput.value.trim()) merged.title = titleInput.value.trim();

    const content = serializeFrontmatter(merged, body);
    await saveNote(courseId, activeSlug, content);
    originalContent = content;

    await refreshNotesList();
    broadcastNotesSidebarRefresh();
    setStatus('Guardado', 'ok');
  } catch (e: any) {
    setStatus(e.message, 'error');
  }
}

async function refreshNotesList() {
  const listData = await listNotes(courseId);
  allNotes = listData.notes;
  refreshTree();
  return listData.notes;
}

function refreshTree() {
  const container = document.getElementById('tree-scroll') as HTMLElement;
  renderTree(container, allNotes, activeSlug, {
    onSelect: slug => loadNote(slug),
    onCreate: async chapter => {
      const title = prompt('Título de la nueva nota:');
      if (!title) return;
      const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      const maxOrder = Math.max(0, ...allNotes.filter(n => n.chapter === chapter).map(n => n.order));
      try {
        const result = await createNote(courseId, { slug, title, type: 'lesson', chapter, status: 'draft', order: maxOrder + 1 });
        await refreshNotesList();
        broadcastNotesSidebarRefresh();
        await loadNote(result.slug);
      } catch (e: any) {
        setStatus(e.message, 'error');
      }
    },
    onDelete: async slug => {
      if (!confirm(`¿Eliminar "${slug}"? Esta acción no se puede deshacer.`)) return;
      try {
        await deleteNote(courseId, slug);
        if (activeSlug === slug) { activeSlug = null; showEditorPanel(false); }
        await refreshNotesList();
        broadcastNotesSidebarRefresh();
        setStatus('Nota eliminada', 'ok');
      } catch (e: any) {
        setStatus(e.message, 'error');
      }
    },
    onRename: async slug => {
      const newSlug = prompt('Nuevo slug (nombre de archivo sin .md):', slug);
      if (!newSlug || newSlug === slug) return;
      try {
        await moveNote(courseId, slug, newSlug);
        await refreshNotesList();
        broadcastNotesSidebarRefresh();
        if (activeSlug === slug) await loadNote(newSlug);
        else refreshTree();
        setStatus('Nota renombrada', 'ok');
      } catch (e: any) {
        setStatus(e.message, 'error');
      }
    },
    onOrderChange: async (slug, _newOrder, newChapter) => {
      try {
        const data = await getNote(courseId, slug);
        const { data: fm, body } = parseFrontmatter(data.content);
        fm.chapter = newChapter;
        const content = serializeFrontmatter(fm as any, body);
        await saveNote(courseId, slug, content);
        await refreshNotesList();
        broadcastNotesSidebarRefresh();
      } catch (e: any) {
        setStatus(e.message, 'error');
      }
    },
  });
}

// Discard
document.getElementById('btn-discard')?.addEventListener('click', () => {
  if (!originalContent) return;
  setEditorContent(originalContent);
  const { data: fm } = parseFrontmatter(originalContent);
  populateYamlStrip(allNotes, fm);
  (document.getElementById('title-input') as HTMLInputElement).value = fm.title;
  setStatus('Cambios descartados');
});

// Save button + Cmd/Ctrl+S
document.getElementById('btn-save')?.addEventListener('click', saveCurrentNote);
document.getElementById('tree-refresh-btn')?.addEventListener('click', () => {
  setStatus('Refrescando árbol...');
  refreshNotesList()
    .then(notes => setStatus(`${notes.length} notas cargadas`, 'ok'))
    .catch((e: any) => setStatus(e.message, 'error'));
});
document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); saveCurrentNote(); }
});

// Global new note button
document.getElementById('tree-new-btn')?.addEventListener('click', () => {
  const chapter = allNotes[0]?.chapter || '';
  const title = prompt('Título de la nueva nota:');
  if (!title) return;
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  createNote(courseId, { slug, title, type: 'lesson', chapter, status: 'draft', order: 0 })
    .then(async result => {
      await refreshNotesList();
      broadcastNotesSidebarRefresh();
      return loadNote(result.slug);
    })
    .catch(e => setStatus(e.message, 'error'));
});

// Boot
showEditorPanel(false);
listNotes(courseId)
  .then(data => {
    allNotes = data.notes;
    refreshTree();
    setStatus(`${data.notes.length} notas cargadas`);
  })
  .catch(e => setStatus(e.message, 'error'));
