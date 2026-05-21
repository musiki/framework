import { listNotes, getNote, saveNote, createNote } from '../../notes-editor/api';
import { renderTree } from '../../notes-editor/tree';
import {
  createEditor,
  getEditorContent,
  setEditorContent,
  destroyEditor,
} from '../../notes-editor/editor';
import {
  parseFrontmatter,
  serializeFrontmatter,
  populateYamlStrip,
  readYamlStrip,
  type FrontmatterData,
} from '../../notes-editor/yaml-strip';
import { initToolbar } from '../../notes-editor/toolbar';
import type { NoteListItem } from '../../notes-editor/types';

export type InlineEditorOptions = {
  mountEl: HTMLElement;
  contentEl: HTMLElement;
  courseId: string;
  slug: string | null;
  mode: 'edit' | 'create';
};

// Module-level state
let mounted = false;
let currentSlug: string | null = null;
let notesList: NoteListItem[] = [];
let editorCreated = false;
let keydownHandler: ((e: KeyboardEvent) => void) | null = null;
let mountToken = 0;

function resetState() {
  mounted = false;
  currentSlug = null;
  notesList = [];
  editorCreated = false;
  if (keydownHandler) {
    document.removeEventListener('keydown', keydownHandler);
    keydownHandler = null;
  }
}

function setStatus(statusEl: HTMLElement, msg: string, type?: 'ok' | 'error') {
  statusEl.textContent = msg;
  statusEl.style.color = type === 'ok' ? '#7ec87e' : type === 'error' ? '#c87e7e' : '#888';
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

function buildLayout(mountEl: HTMLElement, courseId: string, slug: string | null): void {
  mountEl.innerHTML = `
    <div id="nie-header" style="display:flex;align-items:center;gap:.75rem;padding:.5rem .75rem;background:#111;border-bottom:1px solid #1e1e1e;flex-shrink:0;">
      <span id="nie-label" style="font-size:11px;color:#555;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
        ${courseId}${slug ? ' / ' + slug : ''}
      </span>
      <span id="nie-status" style="font-size:11px;color:#888;"></span>
      <button id="nie-save" style="background:#1a2a1a;border:1px solid #2a4a2a;color:#7ec87e;padding:2px 10px;border-radius:3px;font-size:11px;cursor:pointer;">Guardar</button>
      <button id="nie-close" style="background:none;border:none;color:#666;font-size:14px;cursor:pointer;padding:0 4px;line-height:1;">✕</button>
    </div>
    <div id="nie-body" style="display:flex;flex:1;overflow:hidden;">
      <div id="nie-tree-panel" style="width:220px;flex-shrink:0;background:#0d0d0d;border-right:1px solid #1a1a1a;overflow:hidden;display:flex;flex-direction:column;">
        <div id="nie-tree-scroll" style="flex:1;overflow-y:auto;padding:.25rem 0;"></div>
      </div>
      <div id="nie-editor-panel" style="flex:1;display:flex;flex-direction:column;overflow:hidden;">
        <div style="padding:.4rem .75rem;border-bottom:1px solid #1a1a1a;flex-shrink:0;">
          <input id="nie-title" type="text" placeholder="Título de la nota"
            style="width:100%;background:transparent;border:none;outline:none;color:#ccc;font-size:13px;font-family:inherit;" />
        </div>
        <div id="nie-yaml-strip" style="display:none;padding:.3rem .75rem;border-bottom:1px solid #1a1a1a;flex-shrink:0;font-size:11px;color:#888;">
          <form id="nie-yaml-form" style="display:flex;gap:.5rem;flex-wrap:wrap;align-items:center;">
            <label style="display:flex;gap:.25rem;align-items:center;">
              Tipo
              <select id="fm-type" style="background:#111;border:1px solid #222;color:#aaa;padding:1px 4px;font-size:11px;border-radius:2px;">
                <option value="lesson">lesson</option>
                <option value="eval">eval</option>
                <option value="assignment">assignment</option>
                <option value="info">info</option>
                <option value="public-note">public-note</option>
              </select>
            </label>
            <label style="display:flex;gap:.25rem;align-items:center;">
              Capítulo
              <select id="fm-chapter" style="background:#111;border:1px solid #222;color:#aaa;padding:1px 4px;font-size:11px;border-radius:2px;"></select>
            </label>
            <label style="display:flex;gap:.25rem;align-items:center;">
              Estado
              <select id="fm-status" style="background:#111;border:1px solid #222;color:#aaa;padding:1px 4px;font-size:11px;border-radius:2px;">
                <option value="draft">draft</option>
                <option value="published">published</option>
                <option value="archived">archived</option>
              </select>
            </label>
            <label style="display:flex;gap:.25rem;align-items:center;">
              Orden
              <input id="fm-order" type="number" value="0"
                style="background:#111;border:1px solid #222;color:#aaa;padding:1px 4px;font-size:11px;border-radius:2px;width:50px;" />
            </label>
            <label style="display:flex;gap:.25rem;align-items:center;">
              Tema
              <select id="fm-theme" style="background:#111;border:1px solid #222;color:#aaa;padding:1px 4px;font-size:11px;border-radius:2px;">
                <option value="">—</option>
              </select>
            </label>
          </form>
        </div>
        <div id="nie-snippet-toolbar" style="display:none;padding:.25rem .5rem;border-bottom:1px solid #1a1a1a;flex-shrink:0;gap:.25rem;flex-wrap:wrap;">
          <button class="snip-btn" data-snippet="cover" style="background:#111;border:1px solid #222;color:#aaa;padding:1px 6px;font-size:10px;border-radius:2px;cursor:pointer;">cover</button>
          <button class="snip-btn" data-snippet="lily" style="background:#111;border:1px solid #222;color:#aaa;padding:1px 6px;font-size:10px;border-radius:2px;cursor:pointer;">lily</button>
          <button class="snip-btn" data-snippet="mermaid" style="background:#111;border:1px solid #222;color:#aaa;padding:1px 6px;font-size:10px;border-radius:2px;cursor:pointer;">mermaid</button>
          <button class="snip-btn" data-snippet="iframe" style="background:#111;border:1px solid #222;color:#aaa;padding:1px 6px;font-size:10px;border-radius:2px;cursor:pointer;">iframe</button>
          <button class="snip-btn" data-snippet="eval" style="background:#111;border:1px solid #222;color:#aaa;padding:1px 6px;font-size:10px;border-radius:2px;cursor:pointer;">eval</button>
          <button class="snip-btn" data-snippet="img" style="background:#111;border:1px solid #222;color:#aaa;padding:1px 6px;font-size:10px;border-radius:2px;cursor:pointer;">img</button>
        </div>
        <div id="editor-cm-wrap" style="flex:1;overflow:hidden;min-height:0;"></div>
      </div>
    </div>
  `;
}

async function loadNote(
  slug: string,
  courseId: string,
  statusEl: HTMLElement,
  treeScrollEl: HTMLElement,
): Promise<void> {
  setStatus(statusEl, 'Cargando...');
  try {
    const note = await getNote(courseId, slug);
    const { data, body } = parseFrontmatter(note.content);

    // Show yaml-strip and toolbar
    const yamlStrip = document.getElementById('nie-yaml-strip');
    const snippetToolbar = document.getElementById('nie-snippet-toolbar');
    if (yamlStrip) yamlStrip.style.display = '';
    if (snippetToolbar) snippetToolbar.style.display = 'flex';

    // Populate title
    const titleEl = document.getElementById('nie-title') as HTMLInputElement | null;
    if (titleEl) titleEl.value = data.title || '';

    // Populate yaml-strip fields
    populateYamlStrip(notesList, data);

    // Set editor content (body only, frontmatter is managed by yaml-strip)
    if (editorCreated) {
      setEditorContent(body);
    } else {
      const wrap = document.getElementById('editor-cm-wrap');
      if (wrap) {
        createEditor(wrap, body, () => {});
        editorCreated = true;
        initToolbar(courseId, (msg, type) => setStatus(statusEl, msg, type));
      }
    }

    currentSlug = slug;

    // Update label
    const labelEl = document.getElementById('nie-label');
    if (labelEl) labelEl.textContent = `${courseId} / ${slug}`;

    // Re-render tree to highlight active
    renderTree(treeScrollEl, notesList, currentSlug, {
      onSelect: (s) => { void loadNote(s, courseId, statusEl, treeScrollEl); },
      onCreate: (chapter) => { void handleCreate(courseId, chapter, statusEl, treeScrollEl); },
      onDelete: () => {},
      onRename: () => {},
      onOrderChange: () => {},
    });

    setStatus(statusEl, '');
  } catch (err) {
    setStatus(statusEl, err instanceof Error ? err.message : 'Error al cargar', 'error');
  }
}

async function handleCreate(
  courseId: string,
  chapter: string,
  statusEl: HTMLElement,
  treeScrollEl: HTMLElement,
): Promise<void> {
  const title = prompt(`Nueva nota en "${chapter}" — Título:`);
  if (!title) return;

  const slug = slugify(title);
  if (!slug) {
    setStatus(statusEl, 'Título inválido', 'error');
    return;
  }

  setStatus(statusEl, 'Creando...');
  try {
    await createNote(courseId, {
      slug,
      title,
      type: 'lesson',
      chapter,
      status: 'draft',
      order: 0,
    });

    // Refresh notes list
    const { notes } = await listNotes(courseId);
    notesList = notes;

    await loadNote(slug, courseId, statusEl, treeScrollEl);
  } catch (err) {
    setStatus(statusEl, err instanceof Error ? err.message : 'Error al crear', 'error');
  }
}

async function saveCurrentNote(
  courseId: string,
  statusEl: HTMLElement,
): Promise<void> {
  if (!currentSlug) {
    setStatus(statusEl, 'Sin nota activa', 'error');
    return;
  }

  setStatus(statusEl, 'Guardando...');
  try {
    const body = getEditorContent();
    const titleEl = document.getElementById('nie-title') as HTMLInputElement | null;
    const title = titleEl?.value || '';

    const yamlFields = readYamlStrip();
    const fmData: FrontmatterData = {
      title,
      type: yamlFields.type || 'lesson',
      chapter: yamlFields.chapter || '',
      status: yamlFields.status || 'draft',
      order: yamlFields.order ?? 0,
      theme: yamlFields.theme || '',
    };

    const fullContent = serializeFrontmatter(fmData, body);
    await saveNote(courseId, currentSlug, fullContent);
    setStatus(statusEl, 'Guardado', 'ok');
    setTimeout(() => setStatus(statusEl, ''), 2000);
  } catch (err) {
    setStatus(statusEl, err instanceof Error ? err.message : 'Error al guardar', 'error');
  }
}

export function mountInlineNotesEditor(opts: InlineEditorOptions): void {
  const { mountEl, contentEl, courseId, slug, mode } = opts;

  // Reset all state from any previous mount
  resetState();
  destroyEditor();
  editorCreated = false;

  // Show mount element, hide content
  contentEl.style.display = 'none';
  mountEl.style.display = 'flex';
  mountEl.style.flexDirection = 'column';
  mountEl.style.overflow = 'hidden';

  // Render HTML skeleton
  buildLayout(mountEl, courseId, slug);

  const statusEl = document.getElementById('nie-status') as HTMLElement | null;
  const saveBtn = document.getElementById('nie-save') as HTMLButtonElement | null;
  const closeBtn = document.getElementById('nie-close') as HTMLButtonElement | null;
  const treeScrollEl = document.getElementById('nie-tree-scroll') as HTMLElement | null;

  if (!statusEl || !saveBtn || !closeBtn || !treeScrollEl) {
    console.error('inline-editor: required DOM elements missing');
    return;
  }

  mounted = true;

  // Close handler
  function closeEditor() {
    mounted = false;
    if (keydownHandler) {
      document.removeEventListener('keydown', keydownHandler);
      keydownHandler = null;
    }
    destroyEditor();
    editorCreated = false;
    currentSlug = null;
    notesList = [];
    mountEl.style.display = 'none';
    mountEl.innerHTML = '';
    contentEl.style.display = '';
  }

  closeBtn.addEventListener('click', closeEditor);

  // Save on button click
  saveBtn.addEventListener('click', () => {
    void saveCurrentNote(courseId, statusEl);
  });

  // Cmd/Ctrl+S
  keydownHandler = (e: KeyboardEvent) => {
    if (!mounted) return;
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      void saveCurrentNote(courseId, statusEl);
    }
  };
  document.addEventListener('keydown', keydownHandler);

  // Load notes list then handle mode
  void (async () => {
    const myToken = ++mountToken;

    setStatus(statusEl, 'Cargando notas...');
    try {
      const { notes } = await listNotes(courseId);
      if (mountToken !== myToken) return;
      notesList = notes;
    } catch (err) {
      if (mountToken !== myToken) return;
      setStatus(statusEl, err instanceof Error ? err.message : 'Error al cargar notas', 'error');
      return;
    }

    // Always render tree
    renderTree(treeScrollEl, notesList, slug, {
      onSelect: (s) => { void loadNote(s, courseId, statusEl, treeScrollEl); },
      onCreate: (chapter) => { void handleCreate(courseId, chapter, statusEl, treeScrollEl); },
      onDelete: () => {},
      onRename: () => {},
      onOrderChange: () => {},
    });

    if (mode === 'edit' && slug) {
      // Load the note immediately
      await loadNote(slug, courseId, statusEl, treeScrollEl);
      if (mountToken !== myToken) return;
    } else if (mode === 'create') {
      // Prompt for title and create
      const title = prompt('Nueva nota — Título:');
      if (!title) {
        setStatus(statusEl, '');
        return;
      }
      const newSlug = slugify(title);
      if (!newSlug) {
        setStatus(statusEl, 'Título inválido', 'error');
        return;
      }
      setStatus(statusEl, 'Creando...');
      try {
        await createNote(courseId, {
          slug: newSlug,
          title,
          type: 'lesson',
          chapter: '',
          status: 'draft',
          order: 0,
        });
        if (mountToken !== myToken) return;
        // Refresh list
        const { notes } = await listNotes(courseId);
        if (mountToken !== myToken) return;
        notesList = notes;
        // Re-render tree
        renderTree(treeScrollEl, notesList, newSlug, {
          onSelect: (s) => { void loadNote(s, courseId, statusEl, treeScrollEl); },
          onCreate: (ch) => { void handleCreate(courseId, ch, statusEl, treeScrollEl); },
          onDelete: () => {},
          onRename: () => {},
          onOrderChange: () => {},
        });
        await loadNote(newSlug, courseId, statusEl, treeScrollEl);
        if (mountToken !== myToken) return;
      } catch (err) {
        if (mountToken !== myToken) return;
        setStatus(statusEl, err instanceof Error ? err.message : 'Error al crear', 'error');
      }
    } else {
      // No slug, no create mode — show placeholder
      setStatus(statusEl, 'Seleccioná una nota del árbol');
      // Initialize editor wrap as empty editor for when user selects a note
      const wrap = document.getElementById('editor-cm-wrap');
      if (wrap && !editorCreated) {
        createEditor(wrap, '', () => {});
        editorCreated = true;
        initToolbar(courseId, (msg, type) => setStatus(statusEl, msg, type));
      }
    }
  })();
}
