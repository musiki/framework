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
  parseYamlBlock,
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
  showMetadata?: boolean;     // keep the YAML property strip available in headerless pods
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

function resetState() {
  mounted = false;
  currentSlug = null;
  notesList = [];
  editorCreated = false;
  currentFmData = null;
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
    #nie-yaml-dialog::backdrop {
      background: rgba(0, 0, 0, 0.45);
      backdrop-filter: blur(4px);
    }
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
          <button id="nie-yaml-raw-btn" title="Editar YAML Frontmatter" style="background:none;border:none;padding:2px 6px;font-size:11px;color:var(--c-fg-dim);cursor:pointer;border-radius:3px;font-weight:bold;margin-left:auto;border:1px solid var(--c-border);background:var(--c-bg-mute,rgba(128,128,128,.1));">YAML</button>
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
    const { data, body } = parseFrontmatter(noteContent);
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

    if (showMetadata) populateYamlStrip(notesList, effectiveData, mountEl);

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
    currentFmData = effectiveData;
    setStatus(statusEl, '');
    return effectiveData;
  } catch (err) {
    setStatus(statusEl, err instanceof Error ? err.message : 'Error al cargar', 'error');
    return null;
  }
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
    const body = getEditorContent();
    const titleEl = mountEl.querySelector<HTMLInputElement>('#nie-title');
    const title = titleEl?.value || '';

    const yamlFields = readYamlStrip(mountEl);
    const fmData: FrontmatterData = {
      ...currentFmData,
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

function showYamlModal(currentData: Record<string, any>, onSave: (newData: Record<string, any>) => void) {
  let dialog = document.getElementById('nie-yaml-dialog') as HTMLDialogElement;
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.id = 'nie-yaml-dialog';
    dialog.style.cssText = `
      background: var(--c-bg-surface, #f9f9f9);
      color: var(--c-fg, #111);
      border: 1px solid var(--c-border, #dcdcdc);
      border-radius: 8px;
      padding: 1.5rem;
      width: 90%;
      max-width: 500px;
      box-shadow: 0 10px 25px rgba(0,0,0,0.25);
      outline: none;
    `;
    document.body.appendChild(dialog);
  }

  const lines: string[] = [];
  for (const [k, v] of Object.entries(currentData)) {
    if (v === null || v === undefined) continue;
    if (Array.isArray(v)) {
      lines.push(`${k}:`);
      v.forEach(item => lines.push(`  - ${item}`));
    } else if (typeof v === 'string') {
      const escaped = /[:#\[\]{}|>&!'",%@`\n]/.test(v) ? `"${v.replace(/"/g, '\\"')}"` : v;
      lines.push(`${k}: ${escaped}`);
    } else {
      lines.push(`${k}: ${v}`);
    }
  }
  const yamlText = lines.join('\n');

  dialog.innerHTML = `
    <h3 style="margin-top:0;font-size:14px;color:var(--c-fg);border-bottom:1px solid var(--c-border);padding-bottom:.5rem;margin-bottom:1rem;font-weight:600;">Editar YAML Frontmatter</h3>
    <textarea id="nie-yaml-textarea" style="width:100%;height:250px;font-family:monospace;font-size:12px;background:var(--c-bg, #fff);color:var(--c-fg, #111);border:1px solid var(--c-border, #dcdcdc);padding:.5rem;border-radius:4px;box-sizing:border-box;resize:vertical;outline:none;" spellcheck="false">${yamlText}</textarea>
    <div style="display:flex;justify-content:end;gap:.5rem;margin-top:1rem;">
      <button id="nie-yaml-cancel" style="background:none;border:1px solid var(--c-border);color:var(--c-fg-dim);padding:4px 12px;border-radius:4px;font-size:12px;cursor:pointer;transition:background 0.2s;">Cancelar</button>
      <button id="nie-yaml-save" style="background:var(--c-link,#0b6cff);border:none;color:white;padding:4px 16px;border-radius:4px;font-size:12px;cursor:pointer;font-weight:bold;transition:opacity 0.2s;">Guardar</button>
    </div>
  `;

  const cancelBtn = dialog.querySelector<HTMLButtonElement>('#nie-yaml-cancel')!;
  const saveBtn = dialog.querySelector<HTMLButtonElement>('#nie-yaml-save')!;

  cancelBtn.addEventListener('mouseenter', () => { cancelBtn.style.background = 'var(--c-bg-mute,rgba(128,128,128,.1))'; });
  cancelBtn.addEventListener('mouseleave', () => { cancelBtn.style.background = 'none'; });
  saveBtn.addEventListener('mouseenter', () => { saveBtn.style.opacity = '0.85'; });
  saveBtn.addEventListener('mouseleave', () => { saveBtn.style.opacity = '1'; });

  dialog.querySelector('#nie-yaml-cancel')?.addEventListener('click', () => {
    dialog.close();
  });

  dialog.querySelector('#nie-yaml-save')?.addEventListener('click', () => {
    const text = dialog.querySelector<HTMLTextAreaElement>('#nie-yaml-textarea')?.value || '';
    const parsed = parseYamlBlock(text);
    onSave(parsed);
    dialog.close();
  });

  dialog.showModal();
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

  const yamlRawBtn = mountEl.querySelector<HTMLButtonElement>('#nie-yaml-raw-btn');
  yamlRawBtn?.addEventListener('click', () => {
    if (!currentSlug) return;
    const titleEl = mountEl.querySelector<HTMLInputElement>('#nie-title');
    const yamlFields = readYamlStrip(mountEl);
    
    const mergedData: FrontmatterData = {
      ...currentFmData,
      title: titleEl?.value || currentFmData?.title || '',
      type: yamlFields.type || currentFmData?.type || 'lesson',
      chapter: yamlFields.chapter || currentFmData?.chapter || '',
      status: yamlFields.status || currentFmData?.status || 'draft',
      order: yamlFields.order ?? currentFmData?.order ?? 0,
      theme: yamlFields.theme || currentFmData?.theme || '',
    };

    showYamlModal(mergedData, (parsed) => {
      currentFmData = parsed as FrontmatterData;

      if (titleEl) titleEl.value = String(parsed.title || '');
      populateYamlStrip(notesList, parsed as FrontmatterData, mountEl);

      if (opts.persistence && persistenceOnChange) {
        persistenceOnChange();
      }
    });
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
      ? () => {
        const body = getEditorContent();
        if (showMetadata && currentFmData) {
          const titleEl = mountEl.querySelector<HTMLInputElement>('#nie-title');
          const yamlFields = readYamlStrip(mountEl);
          const fmData: FrontmatterData = {
            ...currentFmData,
            title: titleEl?.value || currentFmData?.title || '',
            type: yamlFields.type || currentFmData?.type || 'lesson',
            chapter: yamlFields.chapter || currentFmData?.chapter || '',
            status: yamlFields.status || currentFmData?.status || 'draft',
            order: yamlFields.order ?? currentFmData?.order ?? 0,
            theme: yamlFields.theme || currentFmData?.theme || '',
          };
          opts.persistence!.onChange(serializeFrontmatter(fmData, body));
        } else if (currentFmData) {
          opts.persistence!.onChange(serializeFrontmatter(currentFmData, body));
        } else {
          opts.persistence!.onChange(body);
        }
      }
      : undefined;

    if (persistenceOnChange && showMetadata) {
      const yamlForm = mountEl.querySelector<HTMLFormElement>('#nie-yaml-form');
      yamlForm?.addEventListener('change', persistenceOnChange);
      yamlForm?.addEventListener('input', persistenceOnChange);
    }

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
