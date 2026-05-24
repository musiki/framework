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
  // New fields (optional for backward compatibility):
  persistence?: import('../notes-persistence').NotesPersistence | null;
  hideHeader?: boolean;       // hide the top header bar (we have our own in the panel)
  overrideContent?: string | null; // pre-loaded content (e.g. recovered draft)
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

function injectNieCss() {
  if (typeof document === 'undefined' || document.querySelector('[data-cnw-nie-css]')) return;
  const s = document.createElement('style');
  s.setAttribute('data-cnw-nie-css', '1');
  s.textContent = `
    #nie-toolbar .snip-btn { position:relative; }
    #nie-toolbar .snip-btn:hover { color:var(--c-fg); background:var(--c-bg-mute,rgba(128,128,128,.1)); }
    #nie-toolbar .snip-btn::after {
      content:attr(title);
      position:absolute;
      bottom:calc(100% + 4px);
      left:50%;
      transform:translateX(-50%);
      background:var(--c-bg-surface,var(--c-bg-mute));
      color:var(--c-fg);
      font-size:10px;
      padding:2px 6px;
      border-radius:3px;
      white-space:nowrap;
      pointer-events:none;
      opacity:0;
      z-index:200;
      box-shadow:0 1px 4px rgba(0,0,0,.15);
    }
    #nie-toolbar .snip-btn:hover::after { opacity:1; }
  `;
  document.head.appendChild(s);
}

function buildLayout(mountEl: HTMLElement, _courseId: string, _courseName: string, _slug: string | null, hideHeader: boolean = false): void {
  injectNieCss();
  const inputStyle = 'background:var(--c-bg-mute,var(--c-bg));border:1px solid var(--c-border);color:var(--c-fg);padding:1px 4px;font-size:11px;border-radius:2px;';
  mountEl.innerHTML = `
    ${hideHeader ? '' : `<div id="nie-header" style="display:flex;align-items:center;gap:.5rem;padding:.35rem .75rem;background:var(--c-bg-surface,var(--c-bg-mute));border-bottom:1px solid var(--c-border);flex-shrink:0;">
      <span style="font-size:11px;color:var(--c-fg-subtle);flex-shrink:0;">Notas</span>
      <span id="nie-status" style="font-size:11px;color:var(--c-fg-dim);flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;"></span>
      <button id="nie-save" style="background:transparent;border:1px solid #2a4a2a;color:#7ec87e;padding:2px 10px;border-radius:3px;font-size:11px;cursor:pointer;flex-shrink:0;">Guardar</button>
      <button id="nie-close" style="background:none;border:none;color:var(--c-fg-dim);font-size:14px;cursor:pointer;padding:0 4px;line-height:1;flex-shrink:0;">✕</button>
    </div>`}
    <div id="nie-editor-panel" style="flex:1;display:flex;flex-direction:column;overflow:hidden;">
      <div style="padding:.4rem .75rem;border-bottom:1px solid var(--c-border);flex-shrink:0;">
        <input id="nie-title" type="text" placeholder="Título de la nota"
          style="width:100%;background:transparent;border:none;outline:none;color:var(--c-fg);font-size:13px;font-family:inherit;" />
      </div>
      <div id="nie-toolbar" style="display:none;flex-shrink:0;border-bottom:1px solid var(--c-border);padding:.25rem .5rem;font-size:11px;color:var(--c-fg-dim);">
        <div style="display:flex;flex-wrap:wrap;align-items:center;gap:.35rem;">
          <form id="nie-yaml-form" style="display:contents;">
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
              <input id="fm-order" type="number" value="0" style="${inputStyle}width:50px;" />
            </label>
            <label style="display:flex;gap:.25rem;align-items:center;">
              Tema
              <select id="fm-theme" style="${inputStyle}">
                <option value="">—</option>
              </select>
            </label>
          </form>
          <span style="display:block;width:1px;height:14px;background:var(--c-border);flex-shrink:0;"></span>
          <button class="snip-btn" data-snippet="cover" title="Insertar portada" style="background:none;border:none;padding:1px 4px;font-size:11px;color:var(--c-fg-dim);cursor:pointer;border-radius:2px;">cover</button>
          <button class="snip-btn" data-snippet="lily" title="Insertar bloque LilyPond" style="background:none;border:none;padding:1px 4px;font-size:11px;color:var(--c-fg-dim);cursor:pointer;border-radius:2px;">lily</button>
          <button class="snip-btn" data-snippet="mermaid" title="Insertar diagrama Mermaid" style="background:none;border:none;padding:1px 4px;font-size:11px;color:var(--c-fg-dim);cursor:pointer;border-radius:2px;">mermaid</button>
          <button class="snip-btn" data-snippet="iframe" title="Insertar iframe" style="background:none;border:none;padding:1px 4px;font-size:11px;color:var(--c-fg-dim);cursor:pointer;border-radius:2px;">iframe</button>
          <button class="snip-btn" data-snippet="eval" title="Insertar bloque eval" style="background:none;border:none;padding:1px 4px;font-size:11px;color:var(--c-fg-dim);cursor:pointer;border-radius:2px;">eval</button>
          <button class="snip-btn" data-snippet="img" title="Subir imagen" style="background:none;border:none;padding:1px 4px;font-size:11px;color:var(--c-fg-dim);cursor:pointer;border-radius:2px;">img</button>
        </div>
      </div>
      <div id="editor-cm-wrap" style="flex:1;overflow:hidden;min-height:0;"></div>
    </div>
  `;
}

async function loadNote(
  slug: string,
  courseId: string,
  statusEl: HTMLElement,
  overrideContent?: string | null,
  onEditorChange?: () => void,
): Promise<FrontmatterData | null> {
  setStatus(statusEl, 'Cargando...');
  try {
    let noteContent: string;
    if (overrideContent != null) {
      noteContent = overrideContent;
    } else {
      const note = await getNote(courseId, slug);
      noteContent = note.content;
    }
    const { data, body } = parseFrontmatter(noteContent);

    const toolbar = document.getElementById('nie-toolbar');
    if (toolbar) toolbar.style.display = '';

    const titleEl = document.getElementById('nie-title') as HTMLInputElement | null;
    if (titleEl) titleEl.value = data.title || '';

    populateYamlStrip(notesList, data);

    if (editorCreated) {
      setEditorContent(body);
    } else {
      const wrap = document.getElementById('editor-cm-wrap');
      if (wrap) {
        createEditor(wrap, body, onEditorChange ?? (() => {}));
        editorCreated = true;
        initToolbar(courseId, (msg, type) => setStatus(statusEl, msg, type));
      }
    }

    currentSlug = slug;
    setStatus(statusEl, '');
    return data as FrontmatterData;
  } catch (err) {
    setStatus(statusEl, err instanceof Error ? err.message : 'Error al cargar', 'error');
    return null;
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

  const hideHeader = opts.hideHeader ?? false;

  // Render HTML skeleton
  buildLayout(mountEl, courseId, courseName, slug, hideHeader);

  const statusEl = document.getElementById('nie-status') as HTMLElement | null;
  const saveBtn = document.getElementById('nie-save') as HTMLButtonElement | null;
  const closeBtn = document.getElementById('nie-close') as HTMLButtonElement | null;

  if (!hideHeader && (!statusEl || !saveBtn || !closeBtn)) {
    console.error('inline-editor: required DOM elements missing');
    return;
  }

  // If persistence is provided, hide save button and use auto-save
  if (opts.persistence && saveBtn) {
    saveBtn.setAttribute('hidden', '');
    saveBtn.style.setProperty('display', 'none');
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

  if (closeBtn) closeBtn.addEventListener('click', closeEditor);

  if (saveBtn && !opts.persistence) {
    saveBtn.addEventListener('click', () => {
      void saveCurrentNote(courseId, statusEl!);
    });
  }

  if (!opts.persistence) {
    keydownHandler = (e: KeyboardEvent) => {
      if (!mounted) return;
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        void saveCurrentNote(courseId, statusEl!);
      }
    };
    document.addEventListener('keydown', keydownHandler);
  }

  void (async () => {
    const myToken = ++mountToken;

    const activeStatusEl0 = statusEl ?? document.createElement('span');
    // In pod mode (hideHeader) the notes list is only needed for the YAML-strip chapter autocomplete
    // which isn't rendered — skip the fetch to avoid a ~2s network round-trip before loading the note.
    if (!opts.hideHeader) {
      setStatus(activeStatusEl0, 'Cargando notas...');
      try {
        const { notes } = await listNotes(courseId);
        if (mountToken !== myToken) return;
        notesList = notes;
      } catch (err) {
        if (mountToken !== myToken) return;
        setStatus(activeStatusEl0, err instanceof Error ? err.message : 'Error al cargar notas', 'error');
        return;
      }
    }

    // Build a fallback status element for headerless mode
    const activeStatusEl = statusEl ?? document.createElement('span');

    // Mutable ref captures frontmatter after loadNote so persistenceOnChange can re-serialize it
    const fmRef: { data: FrontmatterData | null } = { data: null };
    const persistenceOnChange = opts.persistence
      ? () => {
        const body = getEditorContent();
        if (opts.hideHeader && fmRef.data) {
          // Pod mode: frontmatter is not editable — preserve it, only update body
          opts.persistence!.onChange(serializeFrontmatter(fmRef.data, body));
        } else if (!opts.hideHeader) {
          // Full editor: read live values from title + yaml strip UI
          const titleEl = document.getElementById('nie-title') as HTMLInputElement | null;
          const yamlFields = readYamlStrip();
          const fmData: FrontmatterData = {
            title: titleEl?.value || fmRef.data?.title || '',
            type: yamlFields.type || fmRef.data?.type || 'lesson',
            chapter: yamlFields.chapter || fmRef.data?.chapter || '',
            status: yamlFields.status || fmRef.data?.status || 'draft',
            order: yamlFields.order ?? fmRef.data?.order ?? 0,
            theme: yamlFields.theme || fmRef.data?.theme || '',
          };
          opts.persistence!.onChange(serializeFrontmatter(fmData, body));
        } else {
          opts.persistence!.onChange(body);
        }
      }
      : undefined;

    if (mode === 'edit' && slug) {
      fmRef.data = await loadNote(slug, courseId, activeStatusEl, opts.overrideContent ?? null, persistenceOnChange);
    } else if (mode === 'create') {
      const title = prompt('Nueva nota — Título:');
      if (!title) { setStatus(activeStatusEl, ''); return; }
      const newSlug = slugify(title);
      if (!newSlug) { setStatus(activeStatusEl, 'Título inválido', 'error'); return; }
      setStatus(activeStatusEl, 'Creando...');
      try {
        await createNote(courseId, { slug: newSlug, title, type: 'lesson', chapter: '', status: 'draft', order: 0 });
        if (mountToken !== myToken) return;
        const { notes } = await listNotes(courseId);
        if (mountToken !== myToken) return;
        notesList = notes;
        const fullSlug = notes.find(n => n.slug.endsWith(`/${newSlug}.md`))?.slug || newSlug;
        fmRef.data = await loadNote(fullSlug, courseId, activeStatusEl, null, persistenceOnChange);
      } catch (err) {
        if (mountToken !== myToken) return;
        setStatus(activeStatusEl, err instanceof Error ? err.message : 'Error al crear', 'error');
      }
    } else {
      setStatus(activeStatusEl, 'Seleccioná una nota del árbol');
      const wrap = document.getElementById('editor-cm-wrap');
      if (wrap && !editorCreated) {
        createEditor(wrap, '', () => {});
        editorCreated = true;
        initToolbar(courseId, (msg, type) => setStatus(activeStatusEl, msg, type));
      }
    }
  })();
}
