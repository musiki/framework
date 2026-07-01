// src/scripts/course/dockview-workspace.ts
import { DockviewComponent, positionToDirection } from 'dockview-core';
import { marked, type Renderer } from 'marked';
import { NotesPersistence } from './notes-persistence';
import { getNote } from '../notes-editor/api';
import { mountDbNoteEditor } from '../notas/personal-notes-workspace';
import { parseFrontmatter } from '../notes-editor/yaml-strip';
import type { InlineEditorOptions } from './notes/inline-editor';
import { buildShell, injectWorkspaceCss, type NoteMode } from './dockview-shell';
import type { LiveMdEditor } from './notes/live-md-editor';
import type { TraceMarginHandle } from './notes/trace-margin';
import { deferYouTubeEmbeds, hydrateLazyYouTubeEmbeds } from './lazy-youtube';
import { enhanceCourseNotesContent } from './notes/content';

export type { NoteMode } from './dockview-shell';

export interface CourseNotesWorkspace {
  openNote(slug: string, mode: NoteMode, split?: boolean): void;
  openMedia(url: string, title: string, position?: 'bottom' | 'right'): void;
  openHelp(path?: string, title?: string, split?: boolean): void;
  destroy(): void;
}

type PanelParams =
  | { kind?: 'note'; slug: string; courseId: string; mode: NoteMode }
  | { kind: 'media'; url: string; title: string }
  | { kind: 'help'; url: string; title: string }
  | { kind: 'db-note'; noteId: string; title: string; courseId?: string }
  | { kind: 'qa-analyzer'; noteId?: string; noteTitle?: string };

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

type DbNotePanelState = {
  noteId: string;
  mode: NoteMode;
  bodyEl: HTMLElement;
  statusDot: HTMLElement;
  pencilBtn: HTMLButtonElement;
  traceBtn: HTMLButtonElement;
  liveEditor: LiveMdEditor | null;
  traceHandle: TraceMarginHandle | null;
  traceOnEnterEdit: boolean;
};

type QaShell = {
  root: HTMLElement;
  titleEl: HTMLSpanElement;
  freqList: HTMLElement;
  kwicInput: HTMLInputElement;
  kwicList: HTMLElement;
  activeText: string;
};

const dbNotePanelStates = new Map<string, DbNotePanelState>();
const qaShells = new Map<string, QaShell>();
let _activeQaPanelId: string | null = null;
type SplitDirection = 'left' | 'right' | 'above' | 'below' | 'within';

// Module-level lifecycle — prevents double-init and stale window listeners across navigations
let _activeCtrl: AbortController | null = null;
let _activeContainer: HTMLElement | null = null;
let _activeWorkspace: CourseNotesWorkspace | null = null;

let _traceEnabledByDefault = false;
try {
  _traceEnabledByDefault = localStorage.getItem('musiki:trace:enabled') === 'true';
} catch {
  // ignore
}

function setTraceEnabledByDefault(enabled: boolean) {
  _traceEnabledByDefault = enabled;
  try {
    localStorage.setItem('musiki:trace:enabled', String(enabled));
  } catch {
    // ignore
  }
}

// ── marked setup (once) ────────────────────────────────────────────────────
let markedConfigured = false;
type KatexApi = typeof import('katex').default;
let katexApi: KatexApi | null = null;
let katexPromise: Promise<KatexApi> | null = null;

function containsMathSyntax(content: string): boolean {
  return /\$\$[\s\S]+?\$\$|\$[^$\n]+?\$/.test(content);
}

async function ensureKatexFor(content: string): Promise<void> {
  if (!containsMathSyntax(content) || katexApi) return;
  if (!katexPromise) {
    katexPromise = Promise.all([
      import('katex'),
      import('katex/dist/katex.min.css'),
    ]).then(([module]) => module.default);
  }
  katexApi = await katexPromise;
}

function configureMarked() {
  if (markedConfigured) return;
  markedConfigured = true;

  // Obsidian callout extension — must come first (block-level, before default blockquote)
  marked.use({
    extensions: [
      {
        name: 'callout',
        level: 'block',
        start(src: string) {
          const idx = src.indexOf('> [!');
          return idx === -1 ? src.length : idx;
        },
        tokenizer(src: string): any {
          if (!src.startsWith('> [!')) return undefined;
          // Collect all consecutive > lines in this block
          const blockMatch = src.match(/^((?:>[^\n]*\n?)+)/);
          if (!blockMatch) return undefined;
          const raw = blockMatch[1];
          const lines = raw.split('\n').map((l: string) => l.replace(/^>[ ]?/, ''));
          // Strip trailing empty lines (end of block)
          while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
          const firstLine = lines[0] ?? '';
          const typeMatch = firstLine.match(/^\[!(\w[\w-]*)\](.*)/);
          if (!typeMatch) return undefined;
          return {
            type: 'callout',
            raw,
            calloutType: typeMatch[1].toLowerCase(),
            title: typeMatch[2].trim(),
            body: lines.slice(1).join('\n'),
          };
        },
        renderer(token: any): string {
          const type = (token.calloutType as string) || 'note';
          const titleText = (token.title as string) || type;
          const bodyHtml = String(marked.parse((token.body as string) || '', { async: false }));
          return `<div class="callout callout-${escAttr(type)}" data-callout="${escAttr(type)}"><div class="callout-title">${escHtmlInline(titleText)}</div><div class="callout-body">${bodyHtml}</div></div>\n`;
        },
      },
    ],
  });

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
            return katexApi
              ? `<div class="cnw-math-block">${katexApi.renderToString(token.text, { displayMode: true, throwOnError: false })}</div>`
              : `<pre class="cnw-math-err">${escHtmlInline(token.text)}</pre>`;
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
            return katexApi
              ? katexApi.renderToString(token.text, { displayMode: false, throwOnError: false })
              : `<code>${escHtmlInline(token.text)}</code>`;
          } catch { return `<code>${escHtmlInline(token.text)}</code>`; }
        },
      },
    ],
  });

  marked.use({
    extensions: [
      {
        name: 'highlight',
        level: 'inline',
        start(src) { return src.indexOf('=='); },
        tokenizer(src) {
          const match = src.match(/^==([^=\n]+)==/);
          if (match) {
            return {
              type: 'highlight',
              raw: match[0],
              text: match[1].trim(),
              tokens: (this as any).lexer.inlineTokens(match[1].trim()),
            };
          }
        },
        renderer(token) {
          return `<mark>${(this as any).parser.parseInline(token.tokens)}</mark>`;
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

function resolveDocsUrl(pathOrUrl = '/pods/ayuda-contextual/'): string {
  const configuredBase = String(import.meta.env.PUBLIC_DOCS_URL || 'https://doc.musiki.org.ar').trim();
  const fallbackBase = configuredBase || 'https://doc.musiki.org.ar';
  const raw = String(pathOrUrl || '/pods/ayuda-contextual/').trim() || '/pods/ayuda-contextual/';
  try {
    return new URL(raw, fallbackBase.endsWith('/') ? fallbackBase : `${fallbackBase}/`).toString();
  } catch {
    return new URL('/pods/ayuda-contextual/', fallbackBase).toString();
  }
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

function toCourseContentPath(courseId: string, slug: string): string {
  if (slug.startsWith('public/')) return slug;
  const repoPrefix = `cursos/${courseId}/`;
  if (slug.startsWith(repoPrefix)) return `${courseId}/${slug.slice(repoPrefix.length)}`;
  if (slug.startsWith(`${courseId}/`)) return slug;
  return `${courseId}/${slug}`;
}

type PreviewContent = {
  content: string;
  renderedHtml?: string;
  pageInfo?: any;
};

const previewContentRequests = new Map<string, Promise<PreviewContent>>();

function rememberPreviewContentRequest(key: string, request: Promise<PreviewContent>) {
  previewContentRequests.set(key, request);
  request.catch(() => {
    if (previewContentRequests.get(key) === request) previewContentRequests.delete(key);
  });

  while (previewContentRequests.size > 40) {
    const oldestKey = previewContentRequests.keys().next().value;
    if (!oldestKey) break;
    previewContentRequests.delete(oldestKey);
  }
}

function loadPreviewContent(courseId: string, slug: string): Promise<PreviewContent> {
  const cacheKey = `${courseId}::${slug}`;
  const cachedRequest = previewContentRequests.get(cacheKey);
  if (cachedRequest) return cachedRequest;

  const layoutRoot = document.querySelector<HTMLElement>('[data-course-layout-root]');
  const canManage = layoutRoot?.dataset.canManageLiveInteractions === 'true';

  const request = (async () => {
    if (slug.startsWith('public/')) {
      const path = toCourseContentPath(courseId, slug);
      const res = await fetch(`/api/get-note-content?slug=${encodeURIComponent(path)}&rendered=true`);
      if (!res.ok) throw new Error('Note not found');
      const data = await res.json() as { body?: string; renderedHtml?: string; pageInfo?: any };
      return {
        content: data.body ?? '',
        renderedHtml: data.renderedHtml,
        pageInfo: data.pageInfo,
      };
    }

    if (!canManage) {
      const path = toCourseContentPath(courseId, slug);
      const res = await fetch(`/api/get-note-content?slug=${encodeURIComponent(path)}&rendered=true`);
      if (!res.ok) throw new Error('Note not found');
      const data = await res.json() as { body?: string; renderedHtml?: string; pageInfo?: any };
      return {
        content: data.body ?? '',
        renderedHtml: data.renderedHtml,
        pageInfo: data.pageInfo,
      };
    }

    try {
      const note = await getNote(courseId, slug, { rendered: true });
      return {
        content: note.content,
        renderedHtml: note.renderedHtml,
      };
    } catch (primaryError) {
      const path = toCourseContentPath(courseId, slug);
      const res = await fetch(`/api/get-note-content?slug=${encodeURIComponent(path)}&rendered=true`);
      if (!res.ok) throw primaryError;
      const data = await res.json() as { body?: string; renderedHtml?: string };
      return {
        content: data.body ?? '',
        renderedHtml: data.renderedHtml,
      };
    }
  })();

  rememberPreviewContentRequest(cacheKey, request);
  return request;
}

function runMermaidIn(bodyEl: HTMLElement) {
  const nodes = Array.from(bodyEl.querySelectorAll<HTMLElement>('.cnw-mermaid, .mermaid'))
    .filter(node => node.dataset.mermaidRendered !== 'true' && node.dataset.mermaidRendering !== 'true');
  if (!nodes.length) return;
  try {
    const result = (window as any).mermaid?.run({ nodes });
    if (result && typeof result.catch === 'function') {
      result.catch((err: unknown) => console.warn('[cnw] Mermaid render skipped:', err));
    }
  } catch (err) {
    console.warn('[cnw] Mermaid render skipped:', err);
  }
}

function mountHelpBody(bodyEl: HTMLElement, url: string) {
  const safeUrl = resolveDocsUrl(url);
  bodyEl.classList.add('cnw-help-body');
  bodyEl.innerHTML = `
    <iframe
      class="cnw-help-frame"
      src="${escAttr(safeUrl)}"
      title="Musiki Docs"
      loading="lazy"
      referrerpolicy="strict-origin-when-cross-origin"
      sandbox="allow-same-origin allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms"
    ></iframe>
  `;
}

async function renderPreview(bodyEl: HTMLElement, courseId: string, slug: string): Promise<string> {
  // Skip re-render if we already rendered this slug into this element
  if (bodyEl.dataset.renderedSlug === slug) return bodyEl.dataset.lastContent ?? '';
  injectMdCss();
  bodyEl.innerHTML = '<p style="padding:1rem;opacity:.4;font-size:.85rem;">Cargando…</p>';
  try {
    const preview = await loadPreviewContent(courseId, slug);
    const content = preview.content;
    if (preview.renderedHtml?.trim()) {
      bodyEl.innerHTML = `<div class="cnw-md">${preview.renderedHtml}</div>`;
      hydrateLazyYouTubeEmbeds(bodyEl);
      enhanceCourseNotesContent(bodyEl);
      // Hydrate eval blocks injected into this panel (handled by [...slug].astro).
      try { (window as any).__musikiHydrateEvals?.(bodyEl); } catch { /* noop */ }
      // Tell the page shell which note is now active so the Info sidebar refreshes.
      try {
        window.dispatchEvent(new CustomEvent('musiki:active-note', {
          detail: { slug, courseId, pageInfo: preview.pageInfo ?? null },
        }));
      } catch { /* noop */ }
      bodyEl.dataset.renderedSlug = slug;
      bodyEl.dataset.lastContent = content;
      return content;
    }
    const { body } = parseFrontmatter(content);
    // Strip %%cover%%...%%/cover%% presentation blocks and eval fences
    const cleanBody = body
      .replace(/%%cover%%[\s\S]*?%%\/cover%%/gi, '')
      .replace(/```eval[\s\S]*?```/gi, '')
      .replace(/^[ \t]*[nN]ote:[ \t]*/gm, '')
      .trim();
    await ensureKatexFor(cleanBody);
    configureMarked();
    const html = deferYouTubeEmbeds(String(marked.parse(cleanBody, { async: false })));
    bodyEl.innerHTML = `<div class="cnw-md">${html}</div>`;
    hydrateLazyYouTubeEmbeds(bodyEl);
    enhanceCourseNotesContent(bodyEl);
    // Lazy-load mermaid if any diagrams present
    if (bodyEl.querySelector('.cnw-mermaid, .mermaid') && !('mermaid' in window)) {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js';
      s.onload = () => runMermaidIn(bodyEl);
      document.head.appendChild(s);
    } else if (bodyEl.querySelector('.cnw-mermaid, .mermaid')) {
      runMermaidIn(bodyEl);
    }
    bodyEl.dataset.renderedSlug = slug;
    bodyEl.dataset.lastContent = content;
    // Async passes: lily API render + mermaid (don't block return)
    void hydrateLilyPlaceholders(bodyEl, slug);
    return content;
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
    .cnw-md {
      box-sizing:border-box;
      width:100%;
      max-width:min(100%, 86ch);
      margin-inline:auto;
      padding:clamp(1rem, 2vw, 1.8rem) clamp(1rem, 3vw, 2.4rem);
      font-size:calc(var(--font-size-base, 1rem) * 1.15);
      line-height:1.72;
      color:var(--c-fg);
    }
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
    .cnw-md .cnw-lazy-embed {
      width:100%;
      min-height:180px;
      margin:.8em 0;
      border:1px solid var(--c-border);
      border-radius:6px;
      overflow:hidden;
      background:
        linear-gradient(135deg, rgba(220,38,38,.16), rgba(15,23,42,.04)),
        var(--c-bg-mute);
      display:grid;
      place-items:center;
    }
    .cnw-md .cnw-lazy-embed iframe {
      width:100%;
      height:100%;
      border:0;
      display:block;
      background:#000;
    }
    .cnw-md .cnw-lazy-embed-btn {
      width:100%;
      height:100%;
      min-height:180px;
      border:0;
      display:flex;
      flex-direction:column;
      align-items:center;
      justify-content:center;
      gap:.55rem;
      cursor:pointer;
      color:var(--c-fg);
      background:transparent;
      font:inherit;
    }
    .cnw-md .cnw-lazy-embed-btn:hover {
      background:rgba(220,38,38,.08);
    }
    .cnw-md .cnw-lazy-embed-play {
      width:48px;
      height:48px;
      border-radius:999px;
      display:grid;
      place-items:center;
      padding-left:3px;
      background:#dc2626;
      color:white;
      box-shadow:0 8px 24px rgba(0,0,0,.22);
    }
    .cnw-md .cnw-lazy-embed-label {
      font-size:.82rem;
      opacity:.72;
    }
    /* Callout extra variants not covered by global.css */
    .cnw-md .callout[data-callout="book"] { --c-accent:#92400e;--c-border:rgba(146,64,14,.32);--c-bg:rgba(146,64,14,.1);--c-icon:"📖";--c-icon-bg:rgba(146,64,14,.18);--c-icon-border:rgba(146,64,14,.3); }
    .cnw-md .callout[data-callout="author"],.cnw-md .callout[data-callout="bio"],.cnw-md .callout[data-callout="cv"] { --c-accent:#7c3aed;--c-border:rgba(124,58,237,.32);--c-bg:rgba(124,58,237,.1);--c-icon:"✍";--c-icon-bg:rgba(124,58,237,.18);--c-icon-border:rgba(124,58,237,.3); }
    .cnw-md .callout[data-callout="oblique"] { --c-accent:#64748b;--c-border:rgba(100,116,139,.2);--c-bg:rgba(100,116,139,.07);font-style:italic; }
    .cnw-md .callout[data-callout="red"] { --c-accent:#dc2626;--c-border:rgba(220,38,38,.32);--c-bg:rgba(220,38,38,.1);--c-icon:"●";--c-icon-bg:rgba(220,38,38,.18);--c-icon-border:rgba(220,38,38,.3); }
    .cnw-md .callout[data-callout="green"] { --c-accent:#16a34a;--c-border:rgba(22,163,74,.32);--c-bg:rgba(22,163,74,.1);--c-icon:"●";--c-icon-bg:rgba(22,163,74,.18);--c-icon-border:rgba(22,163,74,.3); }
    .cnw-md .callout[data-callout="blue"] { --c-accent:#2563eb;--c-border:rgba(37,99,235,.32);--c-bg:rgba(37,99,235,.1);--c-icon:"●";--c-icon-bg:rgba(37,99,235,.18);--c-icon-border:rgba(37,99,235,.3); }
    .cnw-md .callout[data-callout="yellow"] { --c-accent:#ca8a04;--c-border:rgba(202,138,4,.32);--c-bg:rgba(202,138,4,.1);--c-icon:"●";--c-icon-bg:rgba(202,138,4,.18);--c-icon-border:rgba(202,138,4,.3); }
    .cnw-md .callout[data-callout="violet"] { --c-accent:#7c3aed;--c-border:rgba(124,58,237,.35);--c-bg:rgba(124,58,237,.1);--c-icon:"●";--c-icon-bg:rgba(124,58,237,.18);--c-icon-border:rgba(124,58,237,.3); }
    .cnw-md .callout[data-callout="orange"] { --c-accent:#ea580c;--c-border:rgba(234,88,12,.32);--c-bg:rgba(234,88,12,.1);--c-icon:"●";--c-icon-bg:rgba(234,88,12,.18);--c-icon-border:rgba(234,88,12,.3); }
    @media (max-width:720px) {
      .cnw-md {
        max-width:100%;
        padding:.9rem 1rem;
      }
    }
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
    onStatusChange: ({ status, error }) => {
      state.statusDot.className = 'cnw-status ' + (status === 'idle' ? '' : status);
      state.statusDot.title = error || status;
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

async function mountEditor(state: PanelState, overrideContent: string | null) {
  const editorMount = document.createElement('div');
  editorMount.style.cssText = 'display:flex;flex-direction:column;overflow:hidden;height:100%;';
  state.bodyEl.appendChild(editorMount);

  // Create a minimal content placeholder so mountInlineNotesEditor has something to replace
  const contentPlaceholder = document.createElement('div');
  contentPlaceholder.style.display = 'none';
  editorMount.appendChild(contentPlaceholder);

  const { mountInlineNotesEditor } = await import('./notes/inline-editor');
  if (!editorMount.isConnected || state.mode !== 'edit') return;

  const opts: InlineEditorOptions = {
    mountEl: editorMount,
    contentEl: contentPlaceholder,
    courseId: state.courseId,
    slug: state.slug,
    mode: 'edit',
    persistence: state.persistence!,
    overrideContent,
    hideHeader: true,  // no header row needed — we have our own
    showMetadata: true,
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

// ── DB-note panel helpers ─────────────────────────────────────────────────

async function loadDbNotePreview(state: DbNotePanelState) {
  state.mode = 'preview';
  state.bodyEl.innerHTML = '<p style="padding:1rem;opacity:.4;font-size:.85rem;">Cargando…</p>';
  try {
    const r = await fetch(`/api/live/notes?id=${state.noteId}`);
    if (!r.ok) throw new Error('fetch failed');
    const d = await r.json() as { notes?: any[] };
    const note = d.notes?.[0];
    if (!note) { state.bodyEl.innerHTML = '<p style="padding:1rem;opacity:.4;">Nota no encontrada</p>'; return; }
    injectMdCss();
    let html = typeof note.renderedHtml === 'string' ? note.renderedHtml.trim() : '';
    if (!html) {
      const cleanBody = (note.body ?? '').replace(/^[ \t]*[nN]ote:[ \t]*/gm, '');
      await ensureKatexFor(cleanBody);
      configureMarked();
      html = deferYouTubeEmbeds(String(marked.parse(cleanBody, { async: false })));
    }
    state.bodyEl.innerHTML = `<div class="cnw-md">${html}</div>`;
    hydrateLazyYouTubeEmbeds(state.bodyEl);
    enhanceCourseNotesContent(state.bodyEl);
    updateDbNoteHud(state, note.body ?? '');
  } catch {
    state.bodyEl.innerHTML = '<p style="padding:1rem;color:#c87e7e;font-size:.85rem;">Error al cargar</p>';
  }
}

async function enterDbNoteEditMode(state: DbNotePanelState) {
  state.liveEditor?.destroy();
  state.liveEditor = null;
  if (state.traceHandle) {
    state.traceHandle.destroy();
    state.traceHandle = null;
    state.traceBtn.classList.remove('is-active');
  }
  state.mode = 'edit';
  state.pencilBtn.title = 'Vista previa';
  state.bodyEl.innerHTML = '';

  const mount = document.createElement('div');
  mount.style.cssText = 'height:100%;overflow:hidden;display:flex;flex-direction:column;';
  state.bodyEl.appendChild(mount);

  try {
    const [d, { createLiveMdEditor }] = await Promise.all([
      fetch(`/api/live/notes?id=${state.noteId}`).then(r => r.json()),
      import('./notes/live-md-editor'),
    ]);
      if (!mount.isConnected) return;
      const content: string = d.notes?.[0]?.body ?? '';

      const save = async (text: string) => {
        try {
          localStorage.setItem(`db-note-draft::${state.noteId}`, JSON.stringify({
            body: text,
            ts: Date.now()
          }));
        } catch {}

        state.statusDot.className = 'cnw-status saving';
        const res = await fetch('/api/live/notes', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: state.noteId, body: text }),
        }).catch(() => null);

        if (res?.ok) {
          state.statusDot.className = 'cnw-status saved';
          try {
            localStorage.removeItem(`db-note-draft::${state.noteId}`);
          } catch {}
        } else {
          state.statusDot.className = 'cnw-status error';
        }
        setTimeout(() => { state.statusDot.className = 'cnw-status'; }, 2000);
        updateDbNoteHud(state, text);
      };

      const editorWrap = document.createElement('div');
      editorWrap.style.cssText = 'flex:1;min-height:0;';

      // Check for draft recovery
      let draft: { body: string; ts: number } | null = null;
      try {
        const raw = localStorage.getItem(`db-note-draft::${state.noteId}`);
        if (raw) draft = JSON.parse(raw);
      } catch {}

      if (draft) {
        const banner = document.createElement('div');
        banner.className = 'cnw-recovery';
        banner.style.cssText = 'padding: 8px 12px; display: flex; align-items: center; gap: 8px; font-size: 11px; background: rgba(220,180,50,0.15); border-bottom: 1px solid rgba(220,180,50,0.3); color: var(--c-fg); flex-shrink: 0;';
        banner.innerHTML = `
          <span style="flex:1">Borrador no guardado (${new Date(draft.ts).toLocaleTimeString()})</span>
          <button id="cnw-recover-accept" style="background:#2a4a2a; border:1px solid #7ec87e; color:#7ec87e; font-size:10px; padding:2px 6px; border-radius:3px; cursor:pointer">Usar borrador</button>
          <button id="cnw-recover-discard" style="background:none; border:1px solid var(--c-border); color:var(--c-fg-dim); font-size:10px; padding:2px 6px; border-radius:3px; cursor:pointer; margin-left: 4px;">Descartar</button>
        `;
        mount.appendChild(banner);
        mount.appendChild(editorWrap);

        banner.querySelector('#cnw-recover-discard')?.addEventListener('click', () => {
          try { localStorage.removeItem(`db-note-draft::${state.noteId}`); } catch {}
          banner.remove();
          state.liveEditor = createLiveMdEditor(editorWrap, content, save);
          updateDbNoteHud(state, content);
          state.liveEditor.focus();
        });
        banner.querySelector('#cnw-recover-accept')?.addEventListener('click', () => {
          banner.remove();
          state.liveEditor = createLiveMdEditor(editorWrap, draft.body, save);
          updateDbNoteHud(state, draft.body);
          state.liveEditor.focus();
          void save(draft.body);
        });
      } else {
        mount.appendChild(editorWrap);
        state.liveEditor = createLiveMdEditor(editorWrap, content, save);
        updateDbNoteHud(state, content);
        state.liveEditor.focus();
      }

      if (state.traceOnEnterEdit) {
        state.traceOnEnterEdit = false;
        state.traceBtn.click();
      }
  } catch {
    // Keep the editor shell available for a retry through the mode button.
  }
}

async function enterDbNotePreviewMode(state: DbNotePanelState) {
  state.liveEditor?.destroy();
  state.liveEditor = null;
  state.traceOnEnterEdit = false;
  if (state.traceHandle) {
    state.traceHandle.destroy();
    state.traceHandle = null;
    state.traceBtn.classList.remove('is-active');
  }
  state.pencilBtn.title = 'Editar';
  await loadDbNotePreview(state);
}

function updateDbNoteHud(state: DbNotePanelState, text: string) {
  const hud = state.bodyEl.closest('.cnw-shell')?.querySelector<HTMLElement>('.cnw-hud-stats');
  if (!hud) return;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const chars = text.length;
  const sentences = text.split(/[.!?]+/).filter(s => s.trim()).length;
  hud.textContent = `${words} palabras · ${chars.toLocaleString()} caracteres · ${sentences} oraciones`;
}

// ── QA Analyzer panel helpers ─────────────────────────────────────────────

function buildQaShell(panelId: string, initialTitle: string, dockview: DockviewComponent): QaShell {
  const { shell } = buildShell(panelId, 'qa', 'QA', dockview);
  shell.querySelector<HTMLElement>('.cnw-title')!.textContent = 'QA';

  const titleEl = document.createElement('span') as HTMLSpanElement;
  titleEl.className = 'cnw-qa-source';
  titleEl.style.cssText = 'font-size:.7rem;opacity:.5;padding-left:.4rem;';
  titleEl.textContent = initialTitle;
  const modeBtn = shell.querySelector('.cnw-mode-btn');
  if (modeBtn) shell.querySelector('.cnw-header')!.insertBefore(titleEl, modeBtn);

  const body = shell.querySelector<HTMLElement>('.cnw-body')!;
  body.style.cssText = 'display:flex;height:100%;overflow:hidden;position:relative';

  const freqPane = document.createElement('div');
  freqPane.style.cssText = 'width:200px;flex-shrink:0;overflow-y:auto;padding:.5rem;border-right:1px solid var(--c-border,rgba(120,120,140,.15))';
  const freqLabel = document.createElement('div');
  freqLabel.style.cssText = 'font-size:.58rem;letter-spacing:.1em;text-transform:uppercase;opacity:.4;margin-bottom:.4rem';
  freqLabel.textContent = 'Frecuencia';
  freqPane.appendChild(freqLabel);
  const freqList = document.createElement('div');
  freqPane.appendChild(freqList);

  const kwicPane = document.createElement('div');
  kwicPane.style.cssText = 'flex:1;overflow-y:auto;padding:.5rem;display:flex;flex-direction:column;gap:.4rem';
  const kwicLabel = document.createElement('div');
  kwicLabel.style.cssText = 'font-size:.58rem;letter-spacing:.1em;text-transform:uppercase;opacity:.4;margin-bottom:.2rem';
  kwicLabel.textContent = 'Concordancia';
  const kwicInput = document.createElement('input') as HTMLInputElement;
  kwicInput.type = 'text';
  kwicInput.placeholder = 'Buscar palabra…';
  kwicInput.style.cssText = 'font:inherit;font-size:.8rem;padding:.2rem .4rem;border:1px solid var(--c-border,rgba(120,120,140,.2));border-radius:2px;background:transparent;color:inherit;width:100%;box-sizing:border-box;margin-bottom:.3rem';
  const kwicList = document.createElement('div');
  kwicPane.appendChild(kwicLabel);
  kwicPane.appendChild(kwicInput);
  kwicPane.appendChild(kwicList);

  body.appendChild(freqPane);
  body.appendChild(kwicPane);

  const empty = document.createElement('div');
  empty.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;opacity:.3;font-size:.85rem;pointer-events:none';
  empty.textContent = 'Arrastra una nota aquí para analizar';
  empty.className = 'cnw-qa-empty';
  body.appendChild(empty);

  return { root: shell, titleEl, freqList, kwicList, kwicInput, activeText: '' };
}

async function activateQaNote(qa: QaShell, noteId: string, title: string, textOverride?: string) {
  let text = textOverride ?? '';
  if (!text) {
    const r = await fetch(`/api/live/notes?id=${noteId}`).catch(() => null);
    const d = r ? await r.json().catch(() => null) : null;
    text = d?.notes?.[0]?.body ?? '';
  }
  qa.activeText = text;
  qa.titleEl.textContent = title;
  const emptyEl = qa.root.querySelector<HTMLElement>('.cnw-qa-empty');
  if (emptyEl) emptyEl.style.display = 'none';

  const { computeFrequency, computeKwic } = await import('../notas/qa-analyzer-logic');
  (window as any).__qaLogic = { computeFrequency, computeKwic };

  const freq = computeFrequency(text, 20);
  qa.freqList.innerHTML = '';
  for (const { word, count, pct } of freq) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:.3rem;margin-bottom:.18rem;cursor:pointer';
    row.addEventListener('click', () => { qa.kwicInput.value = word; renderKwic(qa, word); });
    const bar = document.createElement('div');
    bar.style.cssText = `height:8px;border-radius:2px;background:var(--c-link,#2337ff);opacity:.55;width:${pct}%;flex-shrink:0;min-width:4px;max-width:80px`;
    const label = document.createElement('span');
    label.style.cssText = 'font-size:.7rem;opacity:.7;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100px';
    label.textContent = `${word} (${count})`;
    row.appendChild(bar);
    row.appendChild(label);
    qa.freqList.appendChild(row);
  }

  qa.kwicInput.oninput = () => renderKwic(qa, qa.kwicInput.value);
  if (freq[0]) renderKwic(qa, freq[0].word);
}

function renderKwic(qa: QaShell, word: string) {
  const logic = (window as any).__qaLogic as typeof import('../notas/qa-analyzer-logic') | undefined;
  if (!logic) return;
  const lines = logic.computeKwic(qa.activeText, word, 40);
  qa.kwicList.innerHTML = '';
  for (const { before, match, after } of lines) {
    const row = document.createElement('div');
    row.style.cssText = 'font-size:.78rem;line-height:1.5;padding:.15rem 0;opacity:.8;font-family:var(--font-mono,monospace)';
    row.innerHTML = `<span style="opacity:.5">${escHtml(before)}</span><mark style="background:rgba(255,200,0,.3);border-radius:1px">${escHtml(match)}</mark><span style="opacity:.5">${escHtml(after)}</span>`;
    qa.kwicList.appendChild(row);
  }
  if (!lines.length) {
    qa.kwicList.innerHTML = `<div style="opacity:.3;font-size:.78rem">Sin resultados</div>`;
  }
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

  // Capture open slugs before teardown so we can restore them if same course (Astro view transition swaps the DOM element)
  const previousCourseId = _activeContainer?.dataset.cnwCourseId ?? '';
  const slugsToRestore = (_activeWorkspace && previousCourseId === courseId)
    ? [...panelStates.values()].map(s => s.slug)
    : [];

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

  const cleanupDockviewDropArtifacts = () => {
    container.querySelectorAll('.cnw-external-drag-over, .cnw-drag-over').forEach(el => {
      el.classList.remove('cnw-external-drag-over', 'cnw-drag-over');
    });
    container.querySelectorAll('.dv-drop-target, .dv-dragged').forEach(el => {
      el.classList.remove('dv-drop-target', 'dv-dragged');
    });
    container.querySelectorAll('.dv-drop-target-dropzone').forEach(el => {
      el.remove();
    });
    container.querySelectorAll('.dv-drop-target-selection').forEach(el => {
      el.classList.remove(
        'dv-drop-target-left',
        'dv-drop-target-right',
        'dv-drop-target-top',
        'dv-drop-target-bottom',
        'dv-drop-target-center',
        'dv-drop-target-small-vertical',
        'dv-drop-target-small-horizontal',
      );
    });
  };

  const scheduleDockviewDropCleanup = () => {
    cleanupDockviewDropArtifacts();
    window.requestAnimationFrame(cleanupDockviewDropArtifacts);
    window.setTimeout(cleanupDockviewDropArtifacts, 80);
  };

  // Global drag-and-drop cleanup to release preview rectangles on drag end or drop
  const cleanupDragOver = () => {
    scheduleDockviewDropCleanup();
  };
  window.addEventListener('dragend', cleanupDragOver, { signal });
  window.addEventListener('drop', cleanupDragOver, { signal });

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
        bindExternalNoteDrop(shell, panelId);
        pencilBtn.style.display = 'none';
        mountMediaBody(bodyEl, params.url);
        return { element: shell, init: () => {} };
      }

      if (params.kind === 'help') {
        const { shell, bodyEl, pencilBtn, splitRightBtn, splitBelowBtn } = buildShell(panelId, params.url, params.title, dockview);
        bindExternalNoteDrop(shell, panelId);
        pencilBtn.style.display = 'none';
        splitRightBtn.style.display = 'none';
        splitBelowBtn.style.display = 'none';
        mountHelpBody(bodyEl, params.url);
        return { element: shell, init: () => {} };
      }

      if (params.kind === 'db-note') {
        const { shell, bodyEl, pencilBtn, statusDot, traceBtn, downloadBtn, downloadMenu } = buildShell(
          panelId, params.noteId, params.title, dockview, true,
        );
        bindExternalNoteDrop(shell, panelId);

        // Mount the comprehensive personal notes editor with highlighting and commenting support
        void mountDbNoteEditor(bodyEl, statusDot, traceBtn, params.noteId, pencilBtn, downloadBtn, downloadMenu);
        
        return { element: shell, init: () => {} };
      }

      if (params.kind === 'qa-analyzer') {
        const qa = buildQaShell(panelId, params.noteTitle ?? '', dockview);
        bindExternalNoteDrop(qa.root, panelId);
        qaShells.set(panelId, qa);
        _activeQaPanelId = panelId;
        if (params.noteId) {
          const noteBodyEl = container.querySelector(`[data-panel-id^="db-note-${params.noteId}"] .cnw-body`);
          const text = (noteBodyEl as any)?.__editor?.getContent() ?? undefined;
          void activateQaNote(qa, params.noteId, params.noteTitle ?? '', text);
        }
        return { element: qa.root, init: () => {} };
      }

      const noteTitle = params.slug.split('/').pop()?.replace('.md', '') ?? params.slug;
      const { shell, bodyEl, statusDot, pencilBtn, splitRightBtn, splitBelowBtn } = buildShell(
        panelId,
        params.slug,
        noteTitle,
        dockview,
      );
      bindExternalNoteDrop(shell, panelId);

      const layoutRoot = document.querySelector<HTMLElement>('[data-course-layout-root]');
      const canManage = layoutRoot?.dataset.canManageLiveInteractions === 'true';
      if (!canManage) {
        pencilBtn.style.display = 'none';
      }

      const state: PanelState = {
        slug: params.slug,
        courseId: params.courseId,
        mode: 'preview',
        persistence: null,
        bodyEl,
        statusDot,
        pencilBtn,
      };
      panelStates.set(panelId, state);

      pencilBtn.addEventListener('click', () => {
        if (state.mode === 'preview') enterEditMode(state);
        else void enterPreviewMode(state);
      });

      splitRightBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openNote(state.slug, 'preview', true, 'right', panelId);
      });
      splitBelowBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openNote(state.slug, 'preview', true, 'below', panelId);
      });

      void renderPreview(state.bodyEl, state.courseId, state.slug);

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

  // Keep class-content (course overview) visible until first panel; hide dockview until then
  const classContent = container.querySelector<HTMLElement>('[data-class-content]');
  const dvRoot = container.querySelector<HTMLElement>('.dv-dockview');
  const setDockviewActive = (active: boolean) => {
    container.classList.toggle('is-dockview-active', active);
    if (classContent) classContent.style.display = active ? 'none' : '';
    if (dvRoot) dvRoot.style.display = active ? '' : 'none';
    const shortcuts = container.querySelector<HTMLElement>('.scroll-shortcuts');
    if (shortcuts) shortcuts.style.display = active ? 'none' : '';
  };
  setDockviewActive(false);
  dockview.onDidAddPanel(() => {
    setDockviewActive(true);
    scheduleDockviewDropCleanup();
  });

  // When the focused panel changes (switching between already-open notes),
  // notify the page shell so the Info sidebar follows the active note.
  try {
    dockview.onDidActivePanelChange((panel: any) => {
      const state = panelStates.get(panel?.id ?? '');
      if (!state?.slug) return;
      window.dispatchEvent(new CustomEvent('musiki:active-note', {
        detail: { slug: state.slug, courseId: state.courseId ?? courseId, pageInfo: null },
      }));
    });
  } catch { /* onDidActivePanelChange may not exist on older builds */ }

  // Open initial panel
  if (initialSlug) {
    const pid = `note-${initialSlug}`;
    pendingParams.set(pid, { slug: initialSlug, courseId, mode: 'preview' });
    dockview.addPanel({ id: pid, component: 'note-panel' });
  }

  function openNote(slug: string, mode: NoteMode = 'preview', split = false, direction: SplitDirection = 'right', refPanelId?: string): void {
    const panelId = `note-${slug}`;
    const existing = dockview.getGroupPanel(panelId);

    if (existing && !split) {
      // Panel for this slug exists — reload it in preview
      const state = panelStates.get(existing.id);
      if (!state) return;
      state.slug = slug;
      void enterPreviewMode(state);
      return;
    }

    if (!split && dockview.panels.length > 0) {
      // Reuse any open note panel first (to prevent unwanted splits)
      const target = dockview.panels.find(p => (p.id.startsWith('note-') || p.id.startsWith('db-note-')) && !p.id.includes('-split-'))
        ?? dockview.activePanel
        ?? dockview.panels[dockview.panels.length - 1];
      
      if (target) {
        if (target.id.startsWith('note-') && !target.id.includes('-split-')) {
          const state = panelStates.get(target.id);
          if (state) {
            state.slug = slug;
            const titleEl = state.bodyEl.parentElement?.querySelector('.cnw-title');
            if (titleEl) titleEl.textContent = slug.split('/').pop()?.replace('.md', '') ?? slug;
            void enterPreviewMode(state);
            return;
          }
        }

        // Replace target panel with the new note panel in the same tab position
        const newId = panelId + (split ? `-split-${Date.now()}` : '');
        pendingParams.set(newId, { kind: 'note', slug, courseId, mode });
        dockview.addPanel({
          id: newId,
          component: 'note-panel',
          position: { referencePanel: target.id, direction: 'within' },
        });
        target.api.close();
        return;
      }
    }

    const referencePanel = split
      ? ((refPanelId ? dockview.getGroupPanel(refPanelId) : null) ?? dockview.panels[dockview.panels.length - 1] ?? undefined)
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

  function openHelp(path = '/pods/ayuda-contextual/', title = 'Ayuda Musiki', split = false): void {
    const url = resolveDocsUrl(path);
    const existing = dockview.getGroupPanel('musiki-help');
    if (existing && !split) {
      const bodyEl = container.querySelector<HTMLElement>('[data-panel-id="musiki-help"] .cnw-body');
      if (bodyEl) mountHelpBody(bodyEl, url);
      existing.api.setActive();
      return;
    }

    const panelId = split ? `musiki-help-${Date.now()}` : 'musiki-help';
    const referencePanel = dockview.activePanel ?? dockview.panels[dockview.panels.length - 1] ?? undefined;
    pendingParams.set(panelId, { kind: 'help', url, title });
    dockview.addPanel({
      id: panelId,
      component: 'note-panel',
      position: referencePanel
        ? { referencePanel: referencePanel.id, direction: 'right' }
        : undefined,
    });
  }

  function normalizeDropDirection(position: unknown): SplitDirection {
    const dir = position ? String(positionToDirection(position as any)) : 'right';
    if (dir === 'top') return 'above';
    if (dir === 'bottom') return 'below';
    if (dir === 'left' || dir === 'right' || dir === 'above' || dir === 'below' || dir === 'within') return dir;
    return 'right';
  }

  function resolveNativeDropDirection(target: HTMLElement, e: DragEvent): SplitDirection {
    const rect = target.getBoundingClientRect();
    const xRatio = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0.5;
    const yRatio = rect.height > 0 ? (e.clientY - rect.top) / rect.height : 0.5;
    if (yRatio < 0.32) return 'above';
    if (yRatio > 0.68) return 'below';
    return xRatio < 0.5 ? 'left' : 'right';
  }

  function getExternalNoteDropPayload(e: DragEvent): { kind: 'db-note'; noteId: string; title: string } | { kind: 'course-note'; slug: string } | null {
    const dt = e.dataTransfer;
    if (!dt || dt.types.includes('musiki/panel-id')) return null;

    const noteId = dt.getData('text/x-musiki-note')?.trim();
    if (noteId) {
      return {
        kind: 'db-note',
        noteId,
        title: dt.getData('text/x-musiki-note-title') || noteId,
      };
    }

    const explicitSlug = dt.getData('text/x-musiki-course-note')?.trim();
    const fallbackSlug = dt.types.includes('text/x-musiki-course-note')
      ? ''
      : dt.getData('text/plain')?.trim();
    const slug = explicitSlug || fallbackSlug;
    if (!slug || slug.startsWith('http://') || slug.startsWith('https://')) return null;
    return { kind: 'course-note', slug };
  }

  function openDbNotePanel(noteId: string, title: string, direction: SplitDirection = 'right', refPanelId?: string): void {
    const newId = `db-note-${noteId}-${Date.now()}`;
    pendingParams.set(newId, { kind: 'db-note', noteId, title });
    const referencePanel = (refPanelId ? dockview.getGroupPanel(refPanelId) : null)
      ?? dockview.activePanel
      ?? dockview.panels[dockview.panels.length - 1]
      ?? undefined;
    dockview.addPanel({
      id: newId,
      component: 'note-panel',
      position: referencePanel ? { referencePanel: referencePanel.id, direction } : undefined,
    });
  }

  let lastExternalDropKey = '';
  let lastExternalDropAt = 0;
  function openExternalDropPayload(payload: NonNullable<ReturnType<typeof getExternalNoteDropPayload>>, direction: SplitDirection, refPanelId?: string): void {
    const key = `${payload.kind}:${payload.kind === 'db-note' ? payload.noteId : payload.slug}:${direction}:${refPanelId ?? ''}`;
    const now = performance.now();
    if (key === lastExternalDropKey && now - lastExternalDropAt < 250) return;
    lastExternalDropKey = key;
    lastExternalDropAt = now;

    if (payload.kind === 'db-note') {
      openDbNotePanel(payload.noteId, payload.title, direction, refPanelId);
      return;
    }
    openNote(payload.slug, 'preview', dockview.panels.length > 0, direction, refPanelId);
  }

  function bindExternalNoteDrop(shell: HTMLElement, panelId: string): void {
    shell.addEventListener('dragover', e => {
      const payload = getExternalNoteDropPayload(e);
      if (!payload) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = payload.kind === 'db-note' ? 'copy' : 'move';
      shell.classList.add('cnw-external-drag-over');
    }, { signal });

    shell.addEventListener('dragleave', e => {
      if (!shell.contains(e.relatedTarget as Node)) shell.classList.remove('cnw-external-drag-over');
    }, { signal });

    shell.addEventListener('drop', e => {
      const payload = getExternalNoteDropPayload(e);
      if (!payload) return;
      e.preventDefault();
      e.stopPropagation();
      shell.classList.remove('cnw-external-drag-over');
      openExternalDropPayload(payload, resolveNativeDropDirection(shell, e), panelId);
    }, { signal });
  }

  function bindWorkspaceExternalDrop(): void {
    container.addEventListener('dragover', e => {
      const payload = getExternalNoteDropPayload(e);
      if (!payload) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = payload.kind === 'db-note' ? 'copy' : 'move';
    }, { signal });

    container.addEventListener('drop', e => {
      if ((e.target as HTMLElement | null)?.closest?.('.cnw-shell')) return;
      const payload = getExternalNoteDropPayload(e);
      if (!payload) return;
      e.preventDefault();
      const referencePanel = dockview.activePanel ?? dockview.panels[dockview.panels.length - 1] ?? undefined;
      openExternalDropPayload(payload, resolveNativeDropDirection(container, e), referencePanel?.id);
    }, { signal });
  }

  // Cmd/Ctrl+E — toggle edit/preview on active pod
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'e') {
      const layoutRoot = document.querySelector<HTMLElement>('[data-course-layout-root]');
      const canManage = layoutRoot?.dataset.canManageLiveInteractions === 'true';
      if (!canManage) return;

      const state = panelStates.get(dockview.activePanel?.id ?? '');
      if (!state) return;
      e.preventDefault();
      if (state.mode === 'preview') enterEditMode(state);
      else void enterPreviewMode(state);
    }
  }, { signal });

  // Cmd/Ctrl+ArrowUp / ArrowDown — scroll active panel/editor to top/bottom
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      const target = e.target;
      if (target instanceof HTMLElement && (
        /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) ||
        target.closest('.cm-editor')
      )) {
        return;
      }
      const activePanel = dockview.activePanel ?? dockview.panels.find(p => p.id.startsWith('note-') || p.id.startsWith('db-note-'));
      if (!activePanel) return;

      const el = activePanel.element;
      const scroller = el.querySelector('.cm-scroller, .cnw-body, .dockview-panel-content');
      if (!scroller) return;

      e.preventDefault();
      const targetTop = e.key === 'ArrowUp' ? 0 : scroller.scrollHeight;
      scroller.scrollTo({
        top: targetTop,
        behavior: 'smooth'
      });
    }
  }, { signal });

  // External DnD: sidebar notes dragged into workspace show drop overlay
  dockview.onUnhandledDragOverEvent(event => {
    event.accept();
  });
  dockview.onDidDrop(event => {
    const payload = getExternalNoteDropPayload(event.nativeEvent);
    if (payload) {
      try {
        openExternalDropPayload(payload, normalizeDropDirection(event.position));
      } catch (err) {
        console.error('[cnw] drop openNote failed:', err);
      }
    }
    scheduleDockviewDropCleanup();
  });

  bindWorkspaceExternalDrop();

  // Open a personal note as a db-note pod (fired by notes sidebar click/context menu)
  window.addEventListener('musiki:open-db-note', (e: Event) => {
    const ev = e as CustomEvent<{ noteId: string; title: string; split?: boolean }>;
    const { noteId, title, split } = ev.detail;
    const isSplit = split ?? false;

    // Check if panel for this exact note is already open
    const existing = dockview.panels.find(p => p.id.startsWith(`db-note-${noteId}`));
    if (existing) {
      existing.api.setActive();
      return;
    }

    const newId = `db-note-${noteId}-${Date.now()}`;
    pendingParams.set(newId, { kind: 'db-note', noteId, title });
    
    const openNotePanel = !isSplit ? dockview.panels.find(p => p.id.startsWith('db-note-') || p.id.startsWith('note-')) : undefined;
    if (openNotePanel) {
      dockview.addPanel({
        id: newId,
        component: 'note-panel',
        position: { referencePanel: openNotePanel.id, direction: 'within' },
      });
      openNotePanel.api.close();
    } else {
      const refPanel = dockview.panels.find(p => p.id.startsWith('db-note-') || p.id.startsWith('note-'))
        ?? (dockview.panels[dockview.panels.length - 1] ?? undefined);
      dockview.addPanel({
        id: newId, component: 'note-panel',
        position: refPanel ? { referencePanel: refPanel.id, direction: 'right' } : undefined,
      });
    }
  }, { signal });

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

  window.addEventListener('musiki:send-to-qa', async (e: Event) => {
    const ev = e as CustomEvent<{ noteId: string; content: string; title: string }>;
    const existingQaId = _activeQaPanelId ?? [...qaShells.keys()][0];
    const qa = existingQaId ? qaShells.get(existingQaId) : null;

    if (qa) {
      await activateQaNote(qa, ev.detail.noteId, ev.detail.title, ev.detail.content);
    } else {
      const newId = `qa-${Date.now()}`;
      pendingParams.set(newId, { kind: 'qa-analyzer', noteId: ev.detail.noteId, noteTitle: ev.detail.title });
      const refPanel = dockview.panels[dockview.panels.length - 1] ?? undefined;
      dockview.addPanel({ id: newId, component: 'note-panel', position: refPanel ? { referencePanel: refPanel.id, direction: 'right' } : undefined });
    }
  }, { signal });

  window.addEventListener('musiki:open-help', (e: Event) => {
    const ev = e as CustomEvent<{ path?: string; title?: string; split?: boolean }>;
    openHelp(ev.detail?.path || '/pods/ayuda-contextual/', ev.detail?.title || 'Ayuda Musiki', ev.detail?.split ?? false);
  }, { signal });

  // Cleanup on panel removal
  dockview.onDidRemovePanel(event => {
    const state = panelStates.get(event.id);
    if (state?.persistence) {
      state.persistence.flush().then(() => state.persistence?.destroy());
    }

    // Run panel-scoped editor cleanups (mousedown, contextmenu, scroll, annotations)
    const bodyEl = container.querySelector(`[data-panel-id="${event.id}"] .cnw-body`);
    if (bodyEl) {
      (bodyEl as any).__editorCleanups?.forEach((c: any) => c());
    }

    dbNotePanelStates.get(event.id)?.liveEditor?.destroy();
    panelStates.delete(event.id);
    dbNotePanelStates.delete(event.id);
    qaShells.delete(event.id);
    if (_activeQaPanelId === event.id) _activeQaPanelId = null;
    queueMicrotask(() => {
      if (dockview.panels.length === 0) {
        setDockviewActive(false);
      }
    });
  });

  const workspace: CourseNotesWorkspace = {
    openNote,
    openMedia,
    openHelp,
    destroy: () => {
      ro.disconnect();
      // Run cleanups for any open panel editors
      container.querySelectorAll('.cnw-body').forEach((bodyEl) => {
        (bodyEl as any).__editorCleanups?.forEach((c: any) => c());
      });
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

  // Restore panels that were open before a same-course Astro view transition swapped the container
  for (let i = 0; i < slugsToRestore.length; i++) {
    openNote(slugsToRestore[i], 'preview', i > 0);
  }

  return workspace;
}
