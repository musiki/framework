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
  joinFrontmatter,
  type FrontmatterData,
} from '../../notes-editor/yaml-strip';
import { mountFrontmatterPod, releaseFrontmatterPod, type FrontmatterPodHandle } from './frontmatter-pod';
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
  showMetadata?: boolean;     // editar las propiedades en el pod Info del sidebar derecho
  overrideContent?: string | null; // pre-loaded content (e.g. recovered draft)
};

// Module-level state
let mounted = false;
let currentSlug: string | null = null;
let notesList: NoteListItem[] = [];
let editorCreated = false;
let keydownHandler: ((e: KeyboardEvent) => void) | null = null;
let mountToken = 0;
let currentFmData: FrontmatterData | null = null;
// YAML original que no se pudo leer: se reescribe intacto hasta que se corrija
// en el pod Info, para no perder propiedades al autoguardar.
let rawFmOverride: string | null = null;
let fmPod: FrontmatterPodHandle | null = null;

function resetState() {
  mounted = false;
  currentSlug = null;
  notesList = [];
  editorCreated = false;
  currentFmData = null;
  rawFmOverride = null;
  fmPod = null;
  releaseFrontmatterPod();
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

function toCourseContentPath(courseId: string, slug: string): string {
  const repoPrefix = `cursos/${courseId}/`;
  if (slug.startsWith(repoPrefix)) return `${courseId}/${slug.slice(repoPrefix.length)}`;
  if (slug.startsWith(`${courseId}/`)) return slug;
  return `${courseId}/${slug}`;
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
          <button class="snip-btn" data-snippet="cover" title="Insertar portada" style="background:none;border:none;padding:1px 4px;font-size:11px;color:var(--c-fg-dim);cursor:pointer;border-radius:2px;">cover</button>
          <button class="snip-btn" data-snippet="lily" title="Insertar bloque LilyPond" style="background:none;border:none;padding:1px 4px;font-size:11px;color:var(--c-fg-dim);cursor:pointer;border-radius:2px;">lily</button>
          <button class="snip-btn" data-snippet="mermaid" title="Insertar diagrama Mermaid" style="background:none;border:none;padding:1px 4px;font-size:11px;color:var(--c-fg-dim);cursor:pointer;border-radius:2px;">mermaid</button>
          <button class="snip-btn" data-snippet="iframe" title="Insertar iframe" style="background:none;border:none;padding:1px 4px;font-size:11px;color:var(--c-fg-dim);cursor:pointer;border-radius:2px;">iframe</button>
          <button class="snip-btn" data-snippet="eval" title="Insertar bloque eval" style="background:none;border:none;padding:1px 4px;font-size:11px;color:var(--c-fg-dim);cursor:pointer;border-radius:2px;">eval</button>
          <button class="snip-btn" data-snippet="img" title="Subir imagen" style="background:none;border:none;padding:1px 4px;font-size:11px;color:var(--c-fg-dim);cursor:pointer;border-radius:2px;">img</button>
          <button id="nie-props-btn" class="snip-btn" title="Propiedades y YAML en el panel Info (⌘/Ctrl+I)" style="background:none;border:none;padding:1px 4px;font-size:11px;color:var(--c-fg-dim);cursor:pointer;border-radius:2px;margin-left:auto;">propiedades ›</button>
        </div>
      </div>
      <div id="editor-cm-wrap" style="flex:1;overflow:hidden;min-height:0;"></div>
    </div>
  `;
}

async function loadNote(
  slug: string,
  courseId: string,
  mountEl: HTMLElement,
  showMetadata: boolean,
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
      try {
        const note = await getNote(courseId, slug);
        noteContent = note.content;
      } catch (primaryError) {
        const path = toCourseContentPath(courseId, slug);
        const res = await fetch(
          `/api/get-lesson-content?courseId=${encodeURIComponent(courseId)}&path=${encodeURIComponent(path)}`,
        );
        if (!res.ok) throw primaryError;
        noteContent = await res.text();
      }
    }
    const { data, body, raw, error } = parseFrontmatter(noteContent);
    const listed = notesList.find(note => note.slug === slug || note.filePath === slug);
    const effectiveData: FrontmatterData = {
      ...data,
      title: data.title || listed?.title || '',
      chapter: data.chapter || listed?.chapter || '',
      theme: data.theme || listed?.theme || '',
    };

    const toolbar = mountEl.querySelector<HTMLElement>('#nie-toolbar');
    if (toolbar && showMetadata) toolbar.style.display = '';

    const titleEl = mountEl.querySelector<HTMLInputElement>('#nie-title');
    if (titleEl) titleEl.value = effectiveData.title || '';

    currentFmData = effectiveData;
    rawFmOverride = error ? raw : null;
    if (showMetadata) {
      fmPod = mountFrontmatterPod({
        owner: mountEl,
        notes: notesList,
        data: effectiveData,
        rawYaml: rawFmOverride,
        error,
        onChange: (next) => {
          currentFmData = next;
          const titleInput = mountEl.querySelector<HTMLInputElement>('#nie-title');
          if (titleInput && titleInput.value !== String(next.title || '')) titleInput.value = String(next.title || '');
          onEditorChange?.();
        },
        onRawFixed: () => { rawFmOverride = null; },
      });
    }

    if (editorCreated) {
      setEditorContent(body);
    } else {
      const wrap = mountEl.querySelector<HTMLElement>('#editor-cm-wrap');
      if (wrap) {
        createEditor(wrap, body, onEditorChange ?? (() => {}));
        editorCreated = true;
        initToolbar(courseId, (msg, type) => setStatus(statusEl, msg, type), mountEl);
      }
    }

    currentSlug = slug;
    setStatus(statusEl, error ? `YAML inválido: se conserva tal cual (${error})` : '', error ? 'error' : undefined);
    return effectiveData;
  } catch (err) {
    setStatus(statusEl, err instanceof Error ? err.message : 'Error al cargar', 'error');
    return null;
  }
}


/** La nota completa: frontmatter (del estado único) + cuerpo del editor. */
function composeNote(mountEl: HTMLElement, body: string): string {
  if (!currentFmData) return body;
  const titleEl = mountEl.querySelector<HTMLInputElement>('#nie-title');
  if (titleEl) currentFmData = { ...currentFmData, title: titleEl.value };
  if (rawFmOverride != null) return joinFrontmatter(rawFmOverride, body);
  return serializeFrontmatter(currentFmData, body);
}

async function saveCurrentNote(
  courseId: string,
  mountEl: HTMLElement,
  statusEl: HTMLElement,
): Promise<void> {
  if (!currentSlug) {
    setStatus(statusEl, 'Sin nota activa', 'error');
    return;
  }

  setStatus(statusEl, 'Guardando...');
  try {
    const fullContent = composeNote(mountEl, getEditorContent());
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
  const showMetadata = opts.showMetadata ?? !hideHeader;

  // Render HTML skeleton
  buildLayout(mountEl, courseId, courseName, slug, hideHeader);

  const statusEl = mountEl.querySelector<HTMLElement>('#nie-status');
  const saveBtn = mountEl.querySelector<HTMLButtonElement>('#nie-save');
  const closeBtn = mountEl.querySelector<HTMLButtonElement>('#nie-close');

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
    releaseFrontmatterPod(mountEl);
    fmPod = null;
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
      void saveCurrentNote(courseId, mountEl, statusEl!);
    });
  }

  mountEl.querySelector<HTMLButtonElement>('#nie-props-btn')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('musiki:open-page-info', { detail: { open: true } }));
  });

  if (!opts.persistence) {
    keydownHandler = (e: KeyboardEvent) => {
      if (!mounted) return;
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        void saveCurrentNote(courseId, mountEl, statusEl!);
      }
    };
    document.addEventListener('keydown', keydownHandler);
  }

  void (async () => {
    const myToken = ++mountToken;

    const activeStatusEl0 = statusEl ?? document.createElement('span');
    if (showMetadata) {
      setStatus(activeStatusEl0, 'Cargando notas...');
      try {
        const { notes } = await listNotes(courseId);
        if (mountToken !== myToken) return;
        notesList = notes;
      } catch (err) {
        if (mountToken !== myToken) return;
        setStatus(activeStatusEl0, err instanceof Error ? err.message : 'Error al cargar notas', 'error');
      }
    }

    // Build a fallback status element for headerless mode
    const activeStatusEl = statusEl ?? document.createElement('span');

    // Mutable ref captures frontmatter after loadNote so persistenceOnChange can re-serialize it
    const persistenceOnChange = opts.persistence
      ? () => opts.persistence!.onChange(composeNote(mountEl, getEditorContent()))
      : undefined;

    mountEl.querySelector<HTMLInputElement>('#nie-title')?.addEventListener('input', () => {
      if (!currentFmData) return;
      currentFmData = { ...currentFmData, title: mountEl.querySelector<HTMLInputElement>('#nie-title')?.value || '' };
      fmPod?.setData(currentFmData);
      persistenceOnChange?.();
    });

    if (mode === 'edit' && slug) {
      currentFmData = await loadNote(slug, courseId, mountEl, showMetadata, activeStatusEl, opts.overrideContent ?? null, persistenceOnChange);
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
        currentFmData = await loadNote(fullSlug, courseId, mountEl, showMetadata, activeStatusEl, null, persistenceOnChange);
      } catch (err) {
        if (mountToken !== myToken) return;
        setStatus(activeStatusEl, err instanceof Error ? err.message : 'Error al crear', 'error');
      }
    } else {
      setStatus(activeStatusEl, 'Seleccioná una nota del árbol');
      const wrap = mountEl.querySelector<HTMLElement>('#editor-cm-wrap');
      if (wrap && !editorCreated) {
        createEditor(wrap, '', () => {});
        editorCreated = true;
        initToolbar(courseId, (msg, type) => setStatus(activeStatusEl, msg, type), mountEl);
      }
    }
  })();
}
