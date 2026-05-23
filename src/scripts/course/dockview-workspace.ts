// src/scripts/course/dockview-workspace.ts
import { DockviewComponent, positionToDirection } from 'dockview-core';
import { marked, type Renderer } from 'marked';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { NotesPersistence } from './notes-persistence';
import { getNote } from '../notes-editor/api';
import { parseFrontmatter } from '../notes-editor/yaml-strip';
import {
  mountInlineNotesEditor,
  type InlineEditorOptions,
} from './notes/inline-editor';
import { buildShell, injectWorkspaceCss, type NoteMode } from './dockview-shell';

export type { NoteMode } from './dockview-shell';

export interface CourseNotesWorkspace {
  openNote(slug: string, mode: NoteMode, split?: boolean): void;
  openMedia(url: string, title: string, position?: 'bottom' | 'right'): void;
  destroy(): void;
}

type PanelParams =
  | { kind?: 'note'; slug: string; courseId: string; mode: NoteMode }
  | { kind: 'media'; url: string; title: string };

// Side-channel map: populated just before addPanel(), consumed in createComponent()
// because dockview v5 createComponent() does NOT receive panel params directly.
const pendingParams = new Map<string, PanelParams>();

// Per-panel live state (not in dockview)
type PanelState = {
  slug: string;
  courseId: string;
  mode: NoteMode;
  persistence: NotesPersistence | null;
  bodyEl: HTMLElement;
  statusDot: HTMLElement;
  pencilBtn: HTMLButtonElement;
};

const panelStates = new Map<string, PanelState>();

// Module-level lifecycle — prevents double-init and stale window listeners across navigations
let _activeCtrl: AbortController | null = null;
let _activeContainer: HTMLElement | null = null;
let _activeWorkspace: CourseNotesWorkspace | null = null;

// ── marked setup (once) ────────────────────────────────────────────────────
let markedConfigured = false;
function configureMarked() {
  if (markedConfigured) return;
  markedConfigured = true;

  // Math extensions — block ($$) before inline ($)
  marked.use({
    extensions: [
      {
        name: 'mathBlock',
        level: 'block',
        start(src) { return src.indexOf('$$'); },
        tokenizer(src) {
          const match = src.match(/^\$\$([^$]*(?:\$(?!\$)[^$]*)*)\$\$/s);
          if (match) return { type: 'mathBlock', raw: match[0], text: match[1].trim() };
        },
        renderer(token) {
          try {
            return `<div class="cnw-math-block">${katex.renderToString(token.text, { displayMode: true, throwOnError: false })}</div>`;
          } catch { return `<pre class="cnw-math-err">${escHtmlInline(token.text)}</pre>`; }
        },
      },
      {
        name: 'mathInline',
        level: 'inline',
        start(src) { return src.indexOf('$'); },
        tokenizer(src) {
          const match = src.match(/^\$([^$\n]+?)\$/);
          if (match) return { type: 'mathInline', raw: match[0], text: match[1].trim() };
        },
        renderer(token) {
          try {
            return katex.renderToString(token.text, { displayMode: false, throwOnError: false });
          } catch { return `<code>${escHtmlInline(token.text)}</code>`; }
        },
      },
    ],
  });

  const renderer: Partial<Renderer> = {
    code({ text, lang }) {
      if (lang === 'mermaid') {
        return `<div class="cnw-mermaid mermaid">${escHtmlInline(text)}</div>`;
      }
      if (lang === 'lily' || lang === 'lilypond') {
        // Placeholder replaced async by hydrateLilyPlaceholders after render
        return `<div class="cnw-lily-pending" data-lily-source="${escAttr(text)}" style="padding:.75rem 1rem;background:var(--c-bg-mute);border-radius:4px;text-align:center;font-size:.8rem;color:var(--c-fg-dim);margin:.6em 0;">♩ cargando partitura…</div>`;
      }
      return `<pre><code>${escHtmlInline(text)}</code></pre>`;
    },
  };
  marked.use({ renderer });
}
function escHtmlInline(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function escAttr(s: string) {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Async LilyPond hydration ──────────────────────────────────────────────
async function hydrateLilyPlaceholders(bodyEl: HTMLElement, slug: string) {
  const pending = Array.from(bodyEl.querySelectorAll<HTMLElement>('.cnw-lily-pending'));
  if (!pending.length) return;
  await Promise.all(pending.map(async (el) => {
    if (bodyEl.dataset.renderedSlug !== slug || !el.isConnected) return;
    const src = el.dataset.lilySource;
    if (!src) return;
    try {
      const res = await fetch('/api/lily/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: src }),
      });
      if (!res.ok) { el.textContent = '⚠ No se pudo renderizar'; return; }
      const data = await res.json() as { success?: boolean; url?: string; midiUrl?: string };
      if (!data.success || !data.url) { el.textContent = '⚠ Error al renderizar'; return; }
      if (bodyEl.dataset.renderedSlug !== slug || !el.isConnected) return;
      const figure = document.createElement('figure');
      figure.className = 'lilypond-block lily-score';
      figure.dataset.lilyUrl = data.url;
      if (data.midiUrl) figure.dataset.midiUrl = data.midiUrl;
      const img = document.createElement('img');
      img.src = data.url;
      img.alt = 'LilyPond notation';
      img.loading = 'lazy';
      img.style.cssText = 'max-width:100%;height:auto;display:block;';
      figure.appendChild(img);
      el.replaceWith(figure);
      // lilypond-player MutationObserver detects .lilypond-block and auto-hydrates
    } catch { el.textContent = '⚠ Error al renderizar'; }
  }));
}

// ── Preview renderer ──────────────────────────────────────────────────────

async function renderPreview(bodyEl: HTMLElement, courseId: string, slug: string): Promise<string> {
  // Skip re-render if we already rendered this slug into this element
  if (bodyEl.dataset.renderedSlug === slug) return bodyEl.dataset.lastContent ?? '';
  injectMdCss();
  configureMarked();
  bodyEl.innerHTML = '<p style="padding:1rem;opacity:.4;font-size:.85rem;">Cargando…</p>';
  try {
    const note = await getNote(courseId, slug);
    const { body } = parseFrontmatter(note.content);
    // Strip %%cover%%...%%/cover%% presentation blocks and eval fences
    const cleanBody = body
      .replace(/%%cover%%[\s\S]*?%%\/cover%%/gi, '')
      .replace(/```eval[\s\S]*?```/gi, '')
      .trim();
    const html = String(marked.parse(cleanBody, { async: false }));
    bodyEl.innerHTML = `<div class="cnw-md" style="padding:1.2rem 1.5rem;font-size:var(--font-size-base,1rem);line-height:1.72;color:var(--c-fg)">${html}</div>`;
    // Lazy-load mermaid if any diagrams present
    if (bodyEl.querySelector('.cnw-mermaid') && !('mermaid' in window)) {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js';
      s.onload = () => (window as any).mermaid?.run({ nodes: bodyEl.querySelectorAll('.cnw-mermaid') });
      document.head.appendChild(s);
    } else if (bodyEl.querySelector('.cnw-mermaid')) {
      (window as any).mermaid?.run({ nodes: bodyEl.querySelectorAll('.cnw-mermaid') });
    }
    bodyEl.dataset.renderedSlug = slug;
    bodyEl.dataset.lastContent = note.content;
    // Async passes: lily API render + mermaid (don't block return)
    void hydrateLilyPlaceholders(bodyEl, slug);
    return note.content;
  } catch {
    bodyEl.innerHTML = `<p style="padding:1rem;color:#c87e7e;font-size:.85rem;">Error al cargar la nota</p>`;
    return '';
  }
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Markdown preview CSS (injected once) ─────────────────────────────────
function injectMdCss() {
  if (typeof document === 'undefined' || document.querySelector('[data-cnw-md-css]')) return;
  const s = document.createElement('style');
  s.setAttribute('data-cnw-md-css', '1');
  s.textContent = `
    .cnw-md h1,.cnw-md h2,.cnw-md h3,.cnw-md h4 { margin:.9em 0 .4em; font-weight:700; line-height:1.25; }
    .cnw-md h1 { font-size:1.4em; } .cnw-md h2 { font-size:1.2em; } .cnw-md h3 { font-size:1.05em; }
    .cnw-md p { margin:.55em 0; }
    .cnw-md ul,.cnw-md ol { margin:.5em 0; padding-left:1.4em; }
    .cnw-md li { margin:.2em 0; }
    .cnw-md code { background:var(--c-bg-mute); padding:.1em .35em; border-radius:3px; font-size:.88em; }
    .cnw-md pre { background:var(--c-bg-mute); padding:.75rem 1rem; border-radius:5px; overflow-x:auto; margin:.6em 0; }
    .cnw-md pre code { background:none; padding:0; }
    .cnw-md blockquote { border-left:3px solid var(--c-border); margin:.5em 0; padding:.1em .8em; opacity:.75; }
    .cnw-md a { color:var(--c-link,#3b82f6); }
    .cnw-md hr { border:none; border-top:1px solid var(--c-border); margin:.8em 0; }
    .cnw-md table { border-collapse:collapse; width:100%; margin:.6em 0; font-size:.9em; }
    .cnw-md th,.cnw-md td { border:1px solid var(--c-border); padding:.25em .5em; }
    .cnw-md img { max-width:100%; }
  `;
  document.head.appendChild(s);
}

// ── Media panel ────────────────────────────────────────────────────────────
function toEmbedUrl(url: string): string {
  const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]+)/);
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`;
  const vimeo = url.match(/vimeo\.com\/(\d+)/);
  if (vimeo) return `https://player.vimeo.com/video/${vimeo[1]}`;
  const sc = url.match(/soundcloud\.com\/.+/);
  if (sc) return `https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}&color=%23ff5500&auto_play=false&hide_related=true&show_comments=false&show_user=true&show_reposts=false`;
  return url;
}

function mountMediaBody(bodyEl: HTMLElement, rawUrl: string) {
  const url = toEmbedUrl(rawUrl);
  const isAudio = /\.(mp3|ogg|wav|flac|m4a)(\?|$)/i.test(rawUrl);
  const isVideo = /\.(mp4|webm|mov|ogv)(\?|$)/i.test(rawUrl);
  const isImage = /\.(png|jpe?g|gif|svg|webp|avif)(\?|$)/i.test(rawUrl);

  if (isImage) {
    Object.assign(bodyEl.style, { display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0.5rem', overflow: 'auto' });
    const img = document.createElement('img');
    img.src = rawUrl;
    img.style.cssText = 'max-width:100%;max-height:100%;object-fit:contain;border-radius:2px;';
    img.alt = '';
    bodyEl.appendChild(img);
  } else if (isAudio) {
    Object.assign(bodyEl.style, { display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' });
    const audio = document.createElement('audio');
    audio.controls = true;
    audio.src = rawUrl;
    audio.style.width = '100%';
    bodyEl.appendChild(audio);
  } else if (isVideo) {
    const video = document.createElement('video');
    video.controls = true;
    video.src = rawUrl;
    video.style.cssText = 'width:100%;height:100%;object-fit:contain;background:#000;';
    bodyEl.appendChild(video);
  } else {
    const iframe = document.createElement('iframe');
    iframe.src = url;
    iframe.style.cssText = 'width:100%;height:100%;border:none;';
    iframe.allow = 'autoplay; fullscreen; encrypted-media';
    bodyEl.appendChild(iframe);
  }
}

// ── Mode switching ────────────────────────────────────────────────────────

async function enterEditMode(state: PanelState) {
  state.mode = 'edit';
  state.bodyEl.innerHTML = '';
  delete state.bodyEl.dataset.renderedSlug;
  delete state.bodyEl.dataset.lastContent;
  state.pencilBtn.title = 'Vista previa';
  state.pencilBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;

  // Destroy old persistence if any
  state.persistence?.destroy();

  state.persistence = new NotesPersistence(state.courseId, state.slug, {
    debounceMs: 1500,
    onStatusChange: ({ status }) => {
      state.statusDot.className = 'cnw-status ' + (status === 'idle' ? '' : status);
    },
  });

  // Check for draft recovery
  const draft = state.persistence.recover();
  if (draft) {
    const banner = document.createElement('div');
    banner.className = 'cnw-recovery';
    banner.innerHTML = `
      <span>Borrador recuperado (${new Date(draft.ts).toLocaleTimeString()})</span>
      <button id="cnw-recover-accept">Usar borrador</button>
      <button id="cnw-recover-discard">Descartar</button>
    `;
    state.bodyEl.appendChild(banner);

    banner.querySelector('#cnw-recover-discard')?.addEventListener('click', () => {
      state.persistence?.discardDraft();
      banner.remove();
      mountEditor(state, null);
    });
    banner.querySelector('#cnw-recover-accept')?.addEventListener('click', () => {
      banner.remove();
      mountEditor(state, draft.content);
    });
  } else {
    mountEditor(state, null);
  }
}

function mountEditor(state: PanelState, overrideContent: string | null) {
  const editorMount = document.createElement('div');
  editorMount.style.cssText = 'display:flex;flex-direction:column;overflow:hidden;height:100%;';
  state.bodyEl.appendChild(editorMount);

  // Create a minimal content placeholder so mountInlineNotesEditor has something to replace
  const contentPlaceholder = document.createElement('div');
  contentPlaceholder.style.display = 'none';
  editorMount.appendChild(contentPlaceholder);

  const opts: InlineEditorOptions = {
    mountEl: editorMount,
    contentEl: contentPlaceholder,
    courseId: state.courseId,
    slug: state.slug,
    mode: 'edit',
    persistence: state.persistence!,
    overrideContent,
    hideHeader: true,  // no header row needed — we have our own
  };

  mountInlineNotesEditor(opts);
}

async function enterPreviewMode(state: PanelState) {
  // Flush pending saves before leaving edit mode
  if (state.persistence) {
    await state.persistence.flush();
    state.persistence.destroy();
    state.persistence = null;
  }
  state.mode = 'preview';
  state.bodyEl.innerHTML = '';
  state.pencilBtn.title = 'Editar';
  state.pencilBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;
  state.statusDot.className = 'cnw-status';
  await renderPreview(state.bodyEl, state.courseId, state.slug);
}

// ── Main init ─────────────────────────────────────────────────────────────

export function initDockviewWorkspace(
  container: HTMLElement,
  courseId: string,
  initialSlug: string | null,
  initialContent: string | null,
): CourseNotesWorkspace {
  // Idempotency: same container + same course already has an active workspace — skip
  if (_activeContainer === container && _activeWorkspace && container.dataset.cnwCourseId === courseId) return _activeWorkspace;
  container.dataset.cnwCourseId = courseId;

  // Teardown previous instance (different container = new navigation)
  _activeCtrl?.abort();
  _activeCtrl = null;
  if (_activeWorkspace) {
    const prev = _activeWorkspace;
    _activeWorkspace = null;
    _activeContainer = null;
    prev.destroy();
  }
  _activeContainer = container;
  panelStates.clear();

  const ctrl = new AbortController();
  _activeCtrl = ctrl;
  const { signal } = ctrl;

  const containerId = container.id || 'cnw-root';
  container.id = containerId;
  container.classList.add('dockview-theme-light'); // or dark — matched by CSS vars

  injectWorkspaceCss(containerId);

  const dockview = new DockviewComponent(container, {
    createComponent: options => {
      const panelId = options.id;
      const params = pendingParams.get(panelId);
      pendingParams.delete(panelId);
      if (!params) throw new Error(`[cnw] no params for panel ${panelId}`);

      // Media panel — reuse buildShell for drag/drop infra, mount media into bodyEl
      if (params.kind === 'media') {
        const { shell, bodyEl, pencilBtn } = buildShell(panelId, params.url, params.title, dockview);
        pencilBtn.style.display = 'none';
        mountMediaBody(bodyEl, params.url);
        return { element: shell, init: () => {} };
      }

      const { shell, bodyEl, statusDot, pencilBtn } = buildShell(
        panelId,
        params.slug,
        params.slug.split('/').pop()?.replace('.md', '') ?? params.slug,
        dockview,
      );

      const state: PanelState = {
        slug: params.slug,
        courseId: params.courseId,
        mode: params.mode,
        persistence: null,
        bodyEl,
        statusDot,
        pencilBtn,
      };
      panelStates.set(panelId, state);

      pencilBtn.addEventListener('click', () => {
        if (state.mode === 'preview') enterEditMode(state);
        else enterPreviewMode(state);
      });

      if (params.mode === 'edit') {
        enterEditMode(state);
      } else {
        if (initialContent && params.slug === initialSlug) {
          bodyEl.innerHTML = initialContent;
        } else {
          renderPreview(bodyEl, params.courseId, params.slug);
        }
      }

      return { element: shell, init: () => {} };
    },
  });

  // Resize observer
  const ro = new ResizeObserver(entries => {
    for (const entry of entries) {
      const { width, height } = entry.contentRect;
      dockview.layout(width, height);
    }
  });
  ro.observe(container);

  // Open initial panel
  if (initialSlug) {
    const pid = `note-${initialSlug}`;
    pendingParams.set(pid, { slug: initialSlug, courseId, mode: 'preview' });
    dockview.addPanel({ id: pid, component: 'note-panel' });
  }

  function openNote(slug: string, mode: NoteMode = 'preview', split = false, direction: 'left' | 'right' | 'above' | 'below' | 'within' = 'right'): void {
    const panelId = `note-${slug}`;
    const existing = dockview.getGroupPanel(panelId);

    if (existing && !split) {
      const state = panelStates.get(panelId);
      if (!state) return;
      state.slug = slug;
      if (state.mode === 'preview') renderPreview(state.bodyEl, courseId, slug);
      else { state.persistence?.destroy(); enterEditMode(state); }
      return;
    }

    const referencePanel = split
      ? (dockview.panels[dockview.panels.length - 1] ?? undefined)
      : undefined;

    const newId = panelId + (split ? `-split-${Date.now()}` : '');
    pendingParams.set(newId, { slug, courseId, mode });
    dockview.addPanel({
      id: newId,
      component: 'note-panel',
      position: referencePanel
        ? { referencePanel: referencePanel.id, direction }
        : undefined,
    });
  }

  function openMedia(url: string, title: string, position: 'bottom' | 'right' = 'bottom'): void {
    const mediaId = `media-${encodeURIComponent(url).slice(0, 40)}-${Date.now()}`;
    // First media goes below last note; subsequent media tiles right of the last media pod
    const lastMediaPanel = [...dockview.panels].reverse().find(p => p.id.startsWith('media-'));
    const referencePanel = lastMediaPanel ?? (dockview.panels[dockview.panels.length - 1] ?? undefined);
    const direction = lastMediaPanel ? 'right' : position;
    pendingParams.set(mediaId, { kind: 'media', url, title });
    dockview.addPanel({
      id: mediaId,
      component: 'note-panel',
      position: referencePanel
        ? { referencePanel: referencePanel.id, direction }
        : undefined,
    });
  }

  // Cmd/Ctrl+E — toggle edit/preview on active pod
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'e') {
      const state = panelStates.get(dockview.activePanel?.id ?? '');
      if (!state) return;
      e.preventDefault();
      if (state.mode === 'preview') enterEditMode(state);
      else void enterPreviewMode(state);
    }
  }, { signal });

  // External DnD: sidebar notes dragged into workspace show drop overlay
  dockview.onUnhandledDragOverEvent(event => {
    event.accept();
  });
  dockview.onDidDrop(event => {
    const slug = event.nativeEvent.dataTransfer?.getData('text/plain')?.trim();
    if (slug && slug.startsWith('cursos/')) {
      try {
        const split = dockview.panels.length > 0;
        const dir = split && event.position
          ? positionToDirection(event.position as any)
          : 'right';
        openNote(slug, 'preview', split, dir as any);
      } catch (err) {
        console.error('[cnw] drop openNote failed:', err);
      }
    }
  });

  // Listen for sidebar note-open events — signal is aborted on next initDockviewWorkspace call
  window.addEventListener('note-open', (e: Event) => {
    const ev = e as CustomEvent<{ slug: string; courseId: string; mode: NoteMode; split?: boolean }>;
    e.preventDefault();
    try {
      openNote(ev.detail.slug, ev.detail.mode ?? 'preview', ev.detail.split ?? false);
    } catch (err) {
      console.error('[cnw] openNote failed:', err);
    }
  }, { signal });

  // Ribbon "Notas" button — open/activate notes workspace
  window.addEventListener('musiki:open-notas', () => {
    if (dockview.panels.length > 0) {
      dockview.panels[0].api.setActive();
    } else if (initialSlug) {
      openNote(initialSlug, 'preview');
    }
  }, { signal });

  // Cleanup on panel removal
  dockview.onDidRemovePanel(event => {
    const state = panelStates.get(event.id);
    if (state?.persistence) {
      state.persistence.flush().then(() => state.persistence?.destroy());
    }
    panelStates.delete(event.id);
  });

  const workspace: CourseNotesWorkspace = {
    openNote,
    openMedia,
    destroy: () => {
      ro.disconnect();
      panelStates.forEach(s => s.persistence?.destroy());
      panelStates.clear();
      dockview.dispose();
      // Clear module-level refs only if this is still the active workspace
      if (_activeWorkspace === workspace) {
        _activeCtrl?.abort();
        _activeCtrl = null;
        _activeContainer = null;
        _activeWorkspace = null;
      }
    },
  };

  _activeWorkspace = workspace;
  return workspace;
}
