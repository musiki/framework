import { listNotes, getNote, saveNote, createNote } from '../../notes-editor/api';
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
  courseName?: string;
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
  statusEl.style.color = type === 'ok' ? '#7ec87e' : type === 'error' ? '#c87e7e' : 'var(--c-fg-dim)';
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

function buildLayout(mountEl: HTMLElement, _courseId: string, _courseName: string, _slug: string | null): void {
  const inputStyle = 'background:var(--c-bg-mute,var(--c-bg));border:1px solid var(--c-border);color:var(--c-fg);padding:1px 4px;font-size:11px;border-radius:2px;';
  mountEl.innerHTML = `
    <div id="nie-header" style="display:flex;align-items:center;gap:.5rem;padding:.35rem .75rem;background:var(--c-bg-surface,var(--c-bg-mute));border-bottom:1px solid var(--c-border);flex-shrink:0;">
      <span style="font-size:11px;color:var(--c-fg-subtle);flex-shrink:0;">Notas</span>
      <span id="nie-status" style="font-size:11px;color:var(--c-fg-dim);flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"></span>
      <button id="nie-save" style="background:transparent;border:1px solid #2a4a2a;color:#7ec87e;padding:2px 10px;border-radius:3px;font-size:11px;cursor:pointer;flex-shrink:0;">Guardar</button>
      <button id="nie-close" style="background:none;border:none;color:var(--c-fg-dim);font-size:14px;cursor:pointer;padding:0 4px;line-height:1;flex-shrink:0;">✕</button>
    </div>
    <div id="nie-editor-panel" style="flex:1;display:flex;flex-direction:column;overflow:hidden;">
      <div style="padding:.4rem .75rem;border-bottom:1px solid var(--c-border);flex-shrink:0;">
        <input id="nie-title" type="text" placeholder="Título de la nota"
          style="width:100%;background:transparent;border:none;outline:none;color:var(--c-fg);font-size:13px;font-family:inherit;" />
      </div>
      <div id="nie-yaml-strip" style="display:none;padding:.3rem .75rem;border-bottom:1px solid var(--c-border);flex-shrink:0;font-size:11px;color:var(--c-fg-dim);">
        <form id="nie-yaml-form" style="display:flex;gap:.5rem;flex-wrap:wrap;align-items:center;">
          <label style="display:flex;gap:.25rem;align-items:center;">
            Tipo
            <select id="fm-type" style="${inputStyle}">
              <option value="lesson">lesson</option>
              <option value="eval">eval</option>
              <option value="assignment">assignment</option>
              <option value="info">info</option>
              <option value="public-note">public-note</option>
            </select>
          </label>
          <label style="display:flex;gap:.25rem;align-items:center;">
            Capítulo
            <input id="fm-chapter" list="fm-chapter-list" placeholder="nuevo…" style="${inputStyle}width:100px;" />
            <datalist id="fm-chapter-list"></datalist>
          </label>
          <label style="display:flex;gap:.25rem;align-items:center;">
            Estado
            <select id="fm-status" style="${inputStyle}">
              <option value="draft">draft</option>
              <option value="published">published</option>
              <option value="archived">archived</option>
            </select>
          </label>
          <label style="display:flex;gap:.25rem;align-items:center;">
            Orden
            <input id="fm-order" type="number" value="0"
              style="${inputStyle}width:50px;" />
          </label>
          <label style="display:flex;gap:.25rem;align-items:center;">
            Tema
            <select id="fm-theme" style="${inputStyle}">
              <option value="">—</option>
            </select>
          </label>
        </form>
      </div>
      <div id="nie-snippet-toolbar" style="display:none;padding:.25rem .5rem;border-bottom:1px solid var(--c-border);flex-shrink:0;gap:.25rem;flex-wrap:wrap;">
        <button class="snip-btn" data-snippet="cover" style="${inputStyle}cursor:pointer;">cover</button>
        <button class="snip-btn" data-snippet="lily" style="${inputStyle}cursor:pointer;">lily</button>
        <button class="snip-btn" data-snippet="mermaid" style="${inputStyle}cursor:pointer;">mermaid</button>
        <button class="snip-btn" data-snippet="iframe" style="${inputStyle}cursor:pointer;">iframe</button>
        <button class="snip-btn" data-snippet="eval" style="${inputStyle}cursor:pointer;">eval</button>
        <button class="snip-btn" data-snippet="img" style="${inputStyle}cursor:pointer;">img</button>
      </div>
      <div id="editor-cm-wrap" style="flex:1;overflow:hidden;min-height:0;"></div>
    </div>
  `;
}

async function loadNote(
  slug: string,
  courseId: string,
  statusEl: HTMLElement,
): Promise<void> {
  setStatus(statusEl, 'Cargando...');
  try {
    const note = await getNote(courseId, slug);
    const { data, body } = parseFrontmatter(note.content);

    const yamlStrip = document.getElementById('nie-yaml-strip');
    const snippetToolbar = document.getElementById('nie-snippet-toolbar');
    if (yamlStrip) yamlStrip.style.display = '';
    if (snippetToolbar) snippetToolbar.style.display = 'flex';

    const titleEl = document.getElementById('nie-title') as HTMLInputElement | null;
    if (titleEl) titleEl.value = data.title || '';

    populateYamlStrip(notesList, data);

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
    setStatus(statusEl, '');
  } catch (err) {
    setStatus(statusEl, err instanceof Error ? err.message : 'Error al cargar', 'error');
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
    window.dispatchEvent(new CustomEvent('notes-sidebar-refresh'));
  } catch (err) {
    setStatus(statusEl, err instanceof Error ? err.message : 'Error al guardar', 'error');
  }
}

export function mountInlineNotesEditor(opts: InlineEditorOptions): void {
  const { mountEl, contentEl, courseId, slug, mode } = opts;
  const courseName = opts.courseName
    || document.querySelector<HTMLElement>('.course-title-link-text')?.textContent?.trim()
    || courseId;

  // Reset all state from any previous mount
  resetState();
  destroyEditor();
  editorCreated = false;

  // Hide content, show editor filling the same space
  contentEl.style.display = 'none';
  const articleEl = contentEl.closest<HTMLElement>('.content-area');
  if (articleEl) {
    articleEl.dataset.editorActive = 'true';
    articleEl.style.padding = '0';
    articleEl.style.overflow = 'hidden';
  }
  mountEl.removeAttribute('hidden');
  mountEl.style.cssText = 'display:flex;flex-direction:column;overflow:hidden;height:100%;';

  // Render HTML skeleton
  buildLayout(mountEl, courseId, courseName, slug);

  const statusEl = document.getElementById('nie-status') as HTMLElement | null;
  const saveBtn = document.getElementById('nie-save') as HTMLButtonElement | null;
  const closeBtn = document.getElementById('nie-close') as HTMLButtonElement | null;

  if (!statusEl || !saveBtn || !closeBtn) {
    console.error('inline-editor: required DOM elements missing');
    return;
  }

  mounted = true;

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
    mountEl.setAttribute('hidden', '');
    mountEl.innerHTML = '';
    contentEl.style.display = '';
    if (articleEl) {
      delete articleEl.dataset.editorActive;
      articleEl.style.padding = '';
      articleEl.style.overflow = '';
    }
  }

  closeBtn.addEventListener('click', closeEditor);

  saveBtn.addEventListener('click', () => {
    void saveCurrentNote(courseId, statusEl);
  });

  keydownHandler = (e: KeyboardEvent) => {
    if (!mounted) return;
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      void saveCurrentNote(courseId, statusEl);
    }
  };
  document.addEventListener('keydown', keydownHandler);

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

    if (mode === 'edit' && slug) {
      await loadNote(slug, courseId, statusEl);
    } else if (mode === 'create') {
      const title = prompt('Nueva nota — Título:');
      if (!title) { setStatus(statusEl, ''); return; }
      const newSlug = slugify(title);
      if (!newSlug) { setStatus(statusEl, 'Título inválido', 'error'); return; }
      setStatus(statusEl, 'Creando...');
      try {
        await createNote(courseId, { slug: newSlug, title, type: 'lesson', chapter: '', status: 'draft', order: 0 });
        if (mountToken !== myToken) return;
        const { notes } = await listNotes(courseId);
        if (mountToken !== myToken) return;
        notesList = notes;
        const fullSlug = notes.find(n => n.slug.endsWith(`/${newSlug}.md`))?.slug || newSlug;
        await loadNote(fullSlug, courseId, statusEl);
      } catch (err) {
        if (mountToken !== myToken) return;
        setStatus(statusEl, err instanceof Error ? err.message : 'Error al crear', 'error');
      }
    } else {
      setStatus(statusEl, 'Seleccioná una nota del árbol');
      const wrap = document.getElementById('editor-cm-wrap');
      if (wrap && !editorCreated) {
        createEditor(wrap, '', () => {});
        editorCreated = true;
        initToolbar(courseId, (msg, type) => setStatus(statusEl, msg, type));
      }
    }
  })();
}
