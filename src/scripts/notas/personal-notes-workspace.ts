// src/scripts/notas/personal-notes-workspace.ts
import { DockviewComponent } from 'dockview-core';
import { EditorView } from '@codemirror/view';
import { buildShell, injectWorkspaceCss } from '../course/dockview-shell';
import { createLiveMdEditor } from '../course/notes/live-md-editor';
import { enhanceCourseNotesContent } from '../course/notes/content';
import { markdownToLatex } from './markdown-latex-export.ts';
import type { TraceMarginHandle } from '../course/notes/trace-margin';

export interface PersonalNotesWorkspace {
  destroy(): void;
}

export const HIGHLIGHT_COLORS: Record<string, { label: string; color: string; bg: string; border: string }> = {
  green: { label: 'Idea principal', color: '#4ade80', bg: 'rgba(74, 222, 128, 0.15)', border: 'rgba(74, 222, 128, 0.3)' },
  blue: { label: 'Concepto / ideas', color: '#60a5fa', bg: 'rgba(96, 165, 250, 0.15)', border: 'rgba(96, 165, 250, 0.3)' },
  red: { label: 'Antítesis o crítica', color: '#f87171', bg: 'rgba(248, 113, 113, 0.15)', border: 'rgba(248, 113, 113, 0.3)' },
  yellow: { label: 'Dato', color: '#facc15', bg: 'rgba(250, 204, 21, 0.15)', border: 'rgba(250, 204, 21, 0.3)' },
  orange: { label: 'Método / acción operativa', color: '#fb923c', bg: 'rgba(251, 146, 60, 0.15)', border: 'rgba(251, 146, 60, 0.3)' },
  violet: { label: 'Inspiración / abducción / generativo', color: '#a78bfa', bg: 'rgba(167, 139, 250, 0.15)', border: 'rgba(167, 139, 250, 0.3)' },
};

const pendingParams = new Map<string, any>();
let _workspace: PersonalNotesWorkspace | null = null;
let _ctrl: AbortController | null = null;
let _activeDbNoteBody: HTMLElement | null = null;

export function initPersonalNotesWorkspace(container: HTMLElement): PersonalNotesWorkspace {
  if (_workspace) { _ctrl?.abort(); _workspace = null; }
  _ctrl = new AbortController();

  const containerId = 'pnw-root';
  container.id = containerId;
  injectWorkspaceCss(containerId);

  const dockview = new DockviewComponent(container, {
    createComponent: (options) => {
      const params = pendingParams.get(options.id);
      pendingParams.delete(options.id);

      if (!params || params.kind === 'browser') {
        return { element: buildBrowserPanel(options.id, dockview), init: () => {} };
      }

      if (params.kind === 'db-note') {
        const { shell, bodyEl, pencilBtn, statusDot, splitRightBtn, splitBelowBtn, traceBtn, downloadBtn, downloadMenu } = buildShell(
          options.id, params.noteId, params.title, dockview, true,
        );
        splitRightBtn.style.display = 'none';
        splitBelowBtn.style.display = 'none';
        void mountDbNoteEditor(bodyEl, statusDot, traceBtn, params.noteId, pencilBtn, downloadBtn, downloadMenu);
        return { element: shell, init: () => {} };
      }

      return { element: document.createElement('div'), init: () => {} };
    },
  });

  const ro = new ResizeObserver(entries => {
    for (const e of entries) dockview.layout(e.contentRect.width, e.contentRect.height);
  });
  ro.observe(container);

  pendingParams.set('pnw-browser', { kind: 'browser' });
  dockview.addPanel({ id: 'pnw-browser', component: 'note-panel' });

  _workspace = {
    destroy: () => {
      _ctrl?.abort();
      container.querySelectorAll('.cnw-body').forEach((bodyEl) => {
        (bodyEl as any).__editorCleanups?.forEach((c: any) => c());
      });
      ro.disconnect();
      dockview.dispose();
      _workspace = null;
    },
  };
  return _workspace;
}

function buildBrowserPanel(panelId: string, dockview: DockviewComponent): HTMLElement {
  const el = document.createElement('div');
  el.style.cssText = 'display:flex;flex-direction:column;height:100%;background:var(--c-bg);min-width:200px';

  const search = document.createElement('input');
  search.type = 'search';
  search.placeholder = '🔍 Buscar notas…';
  search.style.cssText = 'margin:.5rem;padding:.3rem .5rem;border:1px solid var(--c-border,rgba(120,120,140,.2));border-radius:3px;background:transparent;color:inherit;font:inherit;font-size:.8rem';

  const tree = document.createElement('div');
  tree.style.cssText = 'flex:1;overflow-y:auto;padding:.2rem 0';

  const footer = document.createElement('div');
  footer.style.cssText = 'padding:.4rem .5rem;border-top:1px solid var(--c-border,rgba(120,120,140,.1))';
  const newBtn = document.createElement('button');
  newBtn.textContent = '+ nueva nota';
  newBtn.style.cssText = 'font:inherit;font-size:.72rem;border:1px solid rgba(60,140,80,.5);color:rgba(40,120,60,.9);background:none;border-radius:2px;padding:.2rem .5rem;cursor:pointer;width:100%';
  footer.appendChild(newBtn);

  el.appendChild(search);
  el.appendChild(tree);
  el.appendChild(footer);

  let allNotes: any[] = [];

  async function loadAll() {
    const r = await fetch('/api/live/notes?limit=200').catch(() => null);
    allNotes = r?.ok ? (await r.json()).notes ?? [] : [];
    render('');
  }

  function render(query: string) {
    tree.innerHTML = '';
    const filtered = query
      ? allNotes.filter(n => (n.title ?? '').toLowerCase().includes(query.toLowerCase()))
      : allNotes;

    if (!filtered.length) {
      const empty = document.createElement('div');
      empty.style.cssText = 'padding:.5rem .7rem;font-size:.78rem;opacity:.35';
      empty.textContent = query ? 'Sin resultados' : 'Sin notas aún';
      tree.appendChild(empty);
      return;
    }

    for (const note of filtered) {
      const item = document.createElement('div');
      item.style.cssText = 'padding:.22rem .7rem;font-size:.75rem;cursor:pointer;opacity:.75;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transition:opacity 100ms';
      item.dataset.noteId = note.id;
      item.title = note.title || '(sin título)';
      item.textContent = note.title || '(sin título)';
      item.addEventListener('mouseenter', () => { item.style.opacity = '1'; });
      item.addEventListener('mouseleave', () => { item.style.opacity = '.75'; });
      item.addEventListener('click', (e) => openNotePanel(note.id, note.title ?? '', dockview, e.altKey));
      tree.appendChild(item);
    }
  }

  search.addEventListener('input', () => render(search.value));

  newBtn.addEventListener('click', async () => {
    const existing = new Set(allNotes.map(note => String(note.title ?? '').toLowerCase()));
    let number = 1;
    while (existing.has(`note-${String(number).padStart(2, '0')}`)) number++;
    const defaultTitle = `note-${String(number).padStart(2, '0')}`;
    const res = await fetch('/api/live/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: defaultTitle, body: '' }),
    });
    if (!res.ok) return;
    const data = await res.json();
    const newId = data.note?.id;
    await loadAll();
    if (!newId) return;
    const item = tree.querySelector<HTMLElement>(`[data-note-id="${newId}"]`);
    if (item) startInlineNoteRename(item, newId, defaultTitle);
  });

  void loadAll();
  return el;
}

function openNotePanel(noteId: string, title: string, dockview: DockviewComponent, split = false) {
  const newId = `pnw-note-${noteId}`;
  const existing = dockview.getGroupPanel(newId);
  if (existing) { existing.api.setActive(); return; }

  const openNotePanel = dockview.panels.find(p => p.id.startsWith('pnw-note-'));
  pendingParams.set(newId, { kind: 'db-note', noteId, title });

  if (openNotePanel && !split) {
    dockview.addPanel({
      id: newId,
      component: 'note-panel',
      position: { referencePanel: openNotePanel.id, direction: 'within' },
    });
    openNotePanel.api.close();
  } else {
    const refPanel = openNotePanel ?? (dockview.panels[dockview.panels.length - 1] ?? undefined);
    dockview.addPanel({ id: newId, component: 'note-panel', position: refPanel ? { referencePanel: refPanel.id, direction: 'right' } : undefined });
  }
}

function startInlineNoteRename(item: HTMLElement, noteId: string, initialTitle: string) {
  const input = document.createElement('input');
  input.value = initialTitle;
  input.style.cssText = 'width:100%;font:inherit;color:inherit;background:transparent;border:none;border-bottom:1px solid var(--c-link,#3b82f6);outline:none';
  item.textContent = '';
  item.appendChild(input);
  input.focus();
  input.select();
  const commit = async () => {
    const title = input.value.trim() || initialTitle;
    item.textContent = title;
    item.title = title;
    await fetch('/api/live/notes', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: noteId, title }),
    });
  };
  input.addEventListener('blur', () => { void commit(); }, { once: true });
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); input.blur(); }
    if (event.key === 'Escape') { event.preventDefault(); input.value = initialTitle; input.blur(); }
  });
}

type DbNoteViewMode = 'live-edit' | 'render';

const PENCIL_ICON = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;
const EYE_ICON = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;

function updateHud(bodyEl: HTMLElement, content: string, mode: DbNoteViewMode = 'live-edit') {
  const hud = bodyEl.closest('.cnw-shell')?.querySelector<HTMLElement>('.cnw-hud-stats');
  if (!hud) return;
  const words = content.trim() ? content.trim().split(/\s+/).length : 0;
  const sentences = content.split(/[.!?]+/).filter(sentence => sentence.trim()).length;
  const modeTitle = mode === 'live-edit'
    ? 'MODO LIVE EDIT. Click para ver Markdown renderizado. Atajo: Alt+Shift+E.'
    : 'MODO RENDER. Click para volver al editor. Atajo: Alt+Shift+E.';
  const modeIcon = mode === 'live-edit' ? PENCIL_ICON : EYE_ICON;
  hud.innerHTML = `
    <button type="button" class="cnw-hud-mini cnw-hud-mode-toggle" title="${escHtml(modeTitle)}" aria-label="${escHtml(modeTitle)}">${modeIcon}</button>
    <span class="cnw-hud-mini" title="${words.toLocaleString()} palabras" aria-label="${words.toLocaleString()} palabras">≋ ${words.toLocaleString()}</span>
    <span class="cnw-hud-mini" title="${content.length.toLocaleString()} caracteres" aria-label="${content.length.toLocaleString()} caracteres"># ${content.length.toLocaleString()}</span>
    <span class="cnw-hud-mini" title="${sentences.toLocaleString()} oraciones" aria-label="${sentences.toLocaleString()} oraciones">. ${sentences.toLocaleString()}</span>
  `;
}

function escHtml(s: string) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function filenamePart(value: string, fallback = 'nota'): string {
  return String(value || fallback)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9_-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    || fallback;
}

function downloadTextFile(content: string, filename: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function renderMarkdownForExport(markdown: string): Promise<string> {
  const res = await fetch('/api/live/preview-markdown', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ markdown }),
  });
  if (!res.ok) throw new Error('preview failed');
  const data = await res.json() as { html?: string };
  return data.html || `<pre>${escHtml(markdown)}</pre>`;
}

function openPrintablePdf(html: string, title: string): void {
  const printWindow = window.open('', '_blank', 'width=960,height=720');
  if (!printWindow) return;
  printWindow.document.write(`<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escHtml(title)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #111827; background: #fff; margin: 0; }
    main { max-width: 760px; margin: 0 auto; padding: 42px 44px; line-height: 1.62; }
    h1, h2, h3 { line-height: 1.22; margin: 1.35em 0 .45em; }
    pre, code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    pre { white-space: pre-wrap; background: #f3f4f6; padding: 12px; border-radius: 4px; overflow-wrap: anywhere; }
    img, svg, video { max-width: 100%; height: auto; }
    blockquote { border-left: 3px solid #d1d5db; margin-left: 0; padding-left: 14px; color: #4b5563; }
    @page { margin: 18mm; }
  </style>
</head>
<body>
  <main>${html}</main>
  <script>
    window.addEventListener('load', () => {
      window.setTimeout(() => window.print(), 160);
    });
  <\/script>
</body>
</html>`);
  printWindow.document.close();
}

function formatRelativeTime(dateStr: string): string {
  const d = new Date(dateStr);
  const diffMs = Date.now() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'ahora';
  if (diffMins < 60) return `hace ${diffMins} min`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `hace ${diffHours} h`;
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${day}/${month}`;
}

function findAnnotationOffsets(docText: string, quote: string, anchorJson: any): { from: number; to: number } | null {
  if (!quote) return null;
  let index = docText.indexOf(quote);
  if (index === -1) return null;
  let nextIndex = docText.indexOf(quote, index + 1);
  if (nextIndex === -1) {
    return { from: index, to: index + quote.length };
  }
  const prefix = anchorJson?.prefix || '';
  const suffix = anchorJson?.suffix || '';
  let bestIndex = index;
  let bestScore = -1;
  let currentIdx = index;
  while (currentIdx !== -1) {
    let score = 0;
    if (prefix) {
      const docPrefix = docText.slice(Math.max(0, currentIdx - prefix.length), currentIdx);
      if (docPrefix === prefix) score += 10;
      else {
        for (let i = 1; i <= Math.min(prefix.length, docPrefix.length); i++) {
          if (docPrefix.slice(-i) === prefix.slice(-i)) score += 1;
        }
      }
    }
    if (suffix) {
      const docSuffix = docText.slice(currentIdx + quote.length, currentIdx + quote.length + suffix.length);
      if (docSuffix === suffix) score += 10;
      else {
        for (let i = 1; i <= Math.min(suffix.length, docSuffix.length); i++) {
          if (docSuffix.slice(0, i) === suffix.slice(0, i)) score += 1;
        }
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestIndex = currentIdx;
    }
    currentIdx = docText.indexOf(quote, currentIdx + 1);
  }
  return { from: bestIndex, to: bestIndex + quote.length };
}

function injectWorkspaceExtraCss() {
  if (document.getElementById('pnw-extra-css')) return;
  const s = document.createElement('style');
  s.id = 'pnw-extra-css';
  s.textContent = `
    .pnw-sidebar-title {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--c-fg-dim);
    }
    .comment-card {
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid var(--c-border, rgba(120, 120, 140, 0.15));
      border-radius: 6px;
      padding: 10px;
      margin-bottom: 8px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      transition: border-color 0.2s, background-color 0.2s;
    }
    .comment-card:hover {
      background: rgba(255, 255, 255, 0.03);
    }
    .comment-card.is-active {
      background: rgba(59, 130, 246, 0.05);
      border-color: var(--c-link, #3b82f6);
    }
    .comment-quote {
      font-size: 11px;
      opacity: 0.7;
      border-left: 2px solid var(--c-border, rgba(120, 120, 140, 0.3));
      padding-left: 6px;
      margin: 0;
      color: var(--c-fg-dim);
      font-style: italic;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .comment-author {
      font-weight: 600;
      color: var(--c-fg);
    }
    .comment-time {
      font-size: 9.5px;
      color: var(--c-fg-dim);
      opacity: 0.8;
    }
    .comment-reply {
      background: rgba(0, 0, 0, 0.1);
      border-radius: 4px;
      padding: 6px 8px;
      margin-top: 4px;
      border: 1px solid rgba(120,120,140,0.06);
    }
    .comment-reply-delete {
      background: none;
      border: none;
      color: #c87e7e;
      cursor: pointer;
      opacity: 0.6;
      transition: opacity 0.15s;
      padding: 0;
      display: flex;
      align-items: center;
    }
    .comment-reply-delete:hover {
      opacity: 1;
    }
    .version-card {
      background: rgba(255, 255, 255, 0.02);
      border: 1px solid var(--c-border, rgba(120, 120, 140, 0.15));
      border-radius: 6px;
      padding: 10px;
      margin-bottom: 6px;
      display: flex;
      flex-direction: column;
      gap: 4px;
      transition: background-color 0.15s;
    }
    .version-card:hover {
      background: rgba(255, 255, 255, 0.03);
    }
    .annotation-highlight {
      background-color: rgba(220, 160, 40, 0.22) !important;
      border-bottom: 2px solid rgba(220, 160, 40, 0.6) !important;
      cursor: pointer;
      transition: background-color 0.2s;
    }
    .annotation-highlight:hover, .annotation-highlight.is-active {
      background-color: rgba(220, 160, 40, 0.38) !important;
    }
    .annotation-highlight--green {
      background-color: rgba(74, 222, 128, 0.14) !important;
      border-bottom: 2px solid rgba(74, 222, 128, 0.5) !important;
    }
    .annotation-highlight--green:hover, .annotation-highlight--green.is-active {
      background-color: rgba(74, 222, 128, 0.28) !important;
    }
    .annotation-highlight--blue {
      background-color: rgba(96, 165, 250, 0.14) !important;
      border-bottom: 2px solid rgba(96, 165, 250, 0.5) !important;
    }
    .annotation-highlight--blue:hover, .annotation-highlight--blue.is-active {
      background-color: rgba(96, 165, 250, 0.28) !important;
    }
    .annotation-highlight--red {
      background-color: rgba(248, 113, 113, 0.14) !important;
      border-bottom: 2px solid rgba(248, 113, 113, 0.5) !important;
    }
    .annotation-highlight--red:hover, .annotation-highlight--red.is-active {
      background-color: rgba(248, 113, 113, 0.28) !important;
    }
    .annotation-highlight--yellow {
      background-color: rgba(250, 204, 21, 0.14) !important;
      border-bottom: 2px solid rgba(250, 204, 21, 0.5) !important;
    }
    .annotation-highlight--yellow:hover, .annotation-highlight--yellow.is-active {
      background-color: rgba(250, 204, 21, 0.28) !important;
    }
    .annotation-highlight--orange {
      background-color: rgba(251, 146, 60, 0.14) !important;
      border-bottom: 2px solid rgba(251, 146, 60, 0.5) !important;
    }
    .annotation-highlight--orange:hover, .annotation-highlight--orange.is-active {
      background-color: rgba(251, 146, 60, 0.28) !important;
    }
    .annotation-highlight--violet {
      background-color: rgba(167, 139, 250, 0.14) !important;
      border-bottom: 2px solid rgba(167, 139, 250, 0.5) !important;
    }
    .annotation-highlight--violet:hover, .annotation-highlight--violet.is-active {
      background-color: rgba(167, 139, 250, 0.28) !important;
    }
    .pnw-selection-toolbar {
      position: absolute;
      display: none;
      align-items: center;
      gap: 6px;
      padding: 6px 10px;
      background: rgba(20, 20, 25, 0.85);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border: 1px solid var(--c-border, rgba(120, 120, 140, 0.25));
      border-radius: 20px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.45);
      z-index: 1000;
      pointer-events: auto;
      transform: translate(-50%, -100%);
      transition: opacity 0.15s, transform 0.15s;
    }
    .pnw-render-preview {
      height: 100%;
      overflow: auto;
      padding: 1rem 1.2rem 1.5rem;
      box-sizing: border-box;
    }
    .pnw-render-preview .cnw-md {
      max-width: 860px;
      margin: 0 auto;
    }
    .cnw-hud-stats {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }
    .cnw-hud-mini {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      border: 0;
      background: none;
      color: inherit;
      font: inherit;
      padding: 0;
      opacity: .78;
      white-space: nowrap;
    }
    button.cnw-hud-mini {
      cursor: pointer;
    }
    .cnw-hud-mini:hover {
      opacity: 1;
      color: var(--c-link, #3b82f6);
    }
  `;
  document.head.appendChild(s);
}

export async function mountDbNoteEditor(
  bodyEl: HTMLElement,
  statusDot: HTMLElement,
  traceBtn: HTMLButtonElement,
  noteId: string,
  pencilBtn?: HTMLButtonElement,
  downloadBtn?: HTMLButtonElement,
  downloadMenu?: HTMLElement,
) {
  const localCleanups: Array<() => void> = [];
  (bodyEl as any).__editorCleanups = localCleanups;
  injectWorkspaceExtraCss();

  bodyEl.innerHTML = '<p style="padding:1rem;opacity:.4;font-size:.85rem;">Cargando…</p>';
  const r = await fetch(`/api/live/notes?id=${noteId}`).catch(() => null);
  const d = r ? await r.json().catch(() => null) : null;
  const note = d?.notes?.[0];
  if (!note) { bodyEl.innerHTML = '<p style="padding:1rem;opacity:.4">Nota no encontrada</p>'; return; }
  if (!bodyEl.isConnected) return;
  bodyEl.innerHTML = '';
  let currentMode: DbNoteViewMode = 'live-edit';
  let currentContent = String(note.body ?? '');
  let traceWantsRestore = false;
  
  const isReadOnly = note.accessLevel === 'view' || note.accessLevel === 'comment';
  const canComment = note.accessLevel === 'comment' || note.accessLevel === 'edit';

  const updateModeButton = () => {
    if (!pencilBtn) return;
    pencilBtn.style.display = '';
    pencilBtn.title = currentMode === 'live-edit'
      ? 'Ver render Markdown (Alt+Shift+E)'
      : 'Volver a live edit (Alt+Shift+E)';
    pencilBtn.innerHTML = currentMode === 'live-edit' ? EYE_ICON : PENCIL_ICON;
    pencilBtn.classList.toggle('is-active', currentMode === 'live-edit');
  };

  const renderMarkdownPreview = async () => {
    if (editor) currentContent = editor.getContent();
    currentMode = 'render';
    updateModeButton();
    updateHud(bodyEl, currentContent, currentMode);
    selectionToolbar.style.display = 'none';
    if (traceHandle) {
      traceWantsRestore = traceBtn.classList.contains('is-active');
      traceHandle.destroy();
      traceHandle = null;
      traceBtn.classList.remove('is-active');
    }
    editor?.destroy();
    editor = null;
    (bodyEl as any).__editor = null;
    editorWrap.innerHTML = '<div class="pnw-render-preview"><p style="opacity:.4;font-size:.85rem;">Renderizando…</p></div>';
    try {
      const res = await fetch('/api/live/preview-markdown', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markdown: currentContent }),
      });
      if (!res.ok) throw new Error('preview failed');
      const data = await res.json();
      editorWrap.innerHTML = `<div class="pnw-render-preview"><div class="cnw-md">${data.html || ''}</div></div>`;
      enhanceCourseNotesContent(editorWrap);
    } catch {
      editorWrap.innerHTML = '<div class="pnw-render-preview"><p style="color:#c87e7e;font-size:.85rem;">No se pudo renderizar la vista Markdown.</p></div>';
    }
  };

  const renderLiveEditor = () => {
    currentMode = 'live-edit';
    updateModeButton();
    editorWrap.innerHTML = '';
    editorWrap.appendChild(selectionToolbar);
    editor = createLiveMdEditor(editorWrap, currentContent, save, { readOnly: isReadOnly });
    (bodyEl as any).__editor = editor;
    updateHud(bodyEl, currentContent, currentMode);
    editor.focus();
    void loadAnnotations();
    if (traceWantsRestore) {
      traceWantsRestore = false;
      traceBtn.click();
    }
  };

  const toggleMode = () => {
    if (currentMode === 'live-edit') void renderMarkdownPreview();
    else renderLiveEditor();
  };

  const shellEl = bodyEl.closest('.cnw-shell') as HTMLElement | null;
  const markActiveDbNote = () => {
    _activeDbNoteBody = bodyEl;
  };
  const hudStatsEl = shellEl?.querySelector<HTMLElement>('.cnw-hud-stats');
  shellEl?.addEventListener('pointerdown', markActiveDbNote);
  shellEl?.addEventListener('focusin', markActiveDbNote);
  localCleanups.push(() => {
    shellEl?.removeEventListener('pointerdown', markActiveDbNote);
    shellEl?.removeEventListener('focusin', markActiveDbNote);
    if (_activeDbNoteBody === bodyEl) _activeDbNoteBody = null;
  });

  pencilBtn?.addEventListener('click', (event) => {
    event.stopPropagation();
    markActiveDbNote();
    toggleMode();
  });

  const onHudModeClick = (event: MouseEvent) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest('.cnw-hud-mode-toggle')) return;
    event.preventDefault();
    event.stopPropagation();
    markActiveDbNote();
    toggleMode();
  };
  hudStatsEl?.addEventListener('click', onHudModeClick);
  localCleanups.push(() => hudStatsEl?.removeEventListener('click', onHudModeClick));

  const onModeShortcut = (event: KeyboardEvent) => {
    if (event.key.toLowerCase() !== 'e' || !event.altKey || !event.shiftKey || event.metaKey || event.ctrlKey) return;
    const shell = shellEl;
    const target = event.target instanceof Node ? event.target : null;
    const targetIsPage = target === document.body || target === document.documentElement;
    const eventTargetsThisShell = Boolean(shell && target && shell.contains(target));
    if (!eventTargetsThisShell && (!targetIsPage || _activeDbNoteBody !== bodyEl)) return;
    event.preventDefault();
    toggleMode();
  };
  document.addEventListener('keydown', onModeShortcut);
  localCleanups.push(() => document.removeEventListener('keydown', onModeShortcut));

  const mount = document.createElement('div');
  mount.style.cssText = 'height:100%;overflow:hidden;display:flex;flex-direction:column;';
  bodyEl.appendChild(mount);

  const save = async (content: string) => {
    currentContent = content;
    try {
      localStorage.setItem(`db-note-draft::${noteId}`, JSON.stringify({
        body: content,
        ts: Date.now()
      }));
    } catch {}

    statusDot.className = 'cnw-status saving';
    const result = await fetch('/api/live/notes', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: noteId, body: content }),
    }).catch(() => null);

    if (result?.ok) {
      statusDot.className = 'cnw-status saved';
      try {
        localStorage.removeItem(`db-note-draft::${noteId}`);
      } catch {}
    } else {
      statusDot.className = 'cnw-status error';
    }
    updateHud(bodyEl, content, currentMode);
  };

  const workspaceRow = document.createElement('div');
  workspaceRow.style.cssText = 'display:flex;flex-direction:row;flex:1;min-height:0;width:100%;position:relative;';

  const editorWrap = document.createElement('div');
  editorWrap.style.cssText = 'flex:1;min-height:0;height:100%;min-width:0;position:relative;';

  const commentsSidebar = document.createElement('div');
  commentsSidebar.style.cssText = 'width:300px;border-left:1px solid var(--c-border, rgba(120,120,140,0.18));background:var(--c-bg);display:none;flex-direction:column;height:100%;flex-shrink:0;overflow:hidden;font-family:var(--font-ui, system-ui, sans-serif);font-size:11px;';

  const versionsSidebar = document.createElement('div');
  versionsSidebar.style.cssText = 'width:260px;border-left:1px solid var(--c-border, rgba(120,120,140,0.18));background:var(--c-bg);display:none;flex-direction:column;height:100%;flex-shrink:0;overflow:hidden;font-family:var(--font-ui, system-ui, sans-serif);font-size:11px;';

  workspaceRow.appendChild(editorWrap);
  workspaceRow.appendChild(commentsSidebar);
  workspaceRow.appendChild(versionsSidebar);

  commentsSidebar.innerHTML = `
    <div style="padding: 10px 12px; border-bottom: 1px solid var(--c-border, rgba(120,120,140,0.15)); display: flex; align-items: center; justify-content: space-between; flex-shrink: 0;">
      <span class="pnw-sidebar-title">Comentarios</span>
      <div style="display:flex; align-items:center; gap:6px;">
        <select class="category-filter-select" style="background: rgba(0,0,0,0.2); border: 1px solid var(--c-border, rgba(120,120,140,0.22)); border-radius: 3px; font-size: 9.5px; color: var(--c-fg); padding: 1px 4px; outline: none; cursor: pointer; max-width: 95px;">
          <option value="all">Todas</option>
        </select>
        <label style="font-size: 9px; color: var(--c-fg-dim); display: flex; align-items: center; gap: 2px; cursor: pointer; user-select: none; margin-left: 2px; white-space: nowrap;">
          <input type="checkbox" class="show-resolved-checkbox" style="margin:0;" /> Resueltos
        </label>
        <button class="comments-close-btn" style="background:none; border:none; color:var(--c-fg-dim); cursor:pointer; font-size:12px; display:flex; align-items:center; margin-left: 2px;">✖</button>
      </div>
    </div>
    <div class="new-comment-section" style="padding: 10px; border-bottom: 1px solid var(--c-border, rgba(120,120,140,0.15)); flex-shrink: 0; display: none; flex-direction: column; gap: 6px;"></div>
    <div class="comments-list-container" style="flex: 1; overflow-y: auto; padding: 10px; display: flex; flex-direction: column; gap: 8px;"></div>
  `;

  const filterSelect = commentsSidebar.querySelector('.category-filter-select');
  if (filterSelect) {
    const emojis: Record<string, string> = { green: '🟢', blue: '🔵', red: '🔴', yellow: '🟡', orange: '🟠', violet: '🟣' };
    for (const [colorName, colorObj] of Object.entries(HIGHLIGHT_COLORS)) {
      const opt = document.createElement('option');
      opt.value = colorName;
      opt.textContent = `${emojis[colorName] || '⚪'} ${colorObj.label}`;
      filterSelect.appendChild(opt);
    }
  }

  versionsSidebar.innerHTML = `
    <div style="padding: 10px 12px; border-bottom: 1px solid var(--c-border, rgba(120,120,140,0.15)); display: flex; align-items: center; justify-content: space-between; flex-shrink: 0;">
      <span class="pnw-sidebar-title">Versiones</span>
      <button class="versions-close-btn" style="background:none; border:none; color:var(--c-fg-dim); cursor:pointer; font-size:12px; display:flex; align-items:center;">✖</button>
    </div>
    <div style="padding: 10px; border-bottom: 1px solid var(--c-border, rgba(120,120,140,0.15)); flex-shrink: 0;">
      <button class="save-version-btn" style="width: 100%; padding: 6px; font-size: 11px; background: var(--c-link, #3b82f6); border: none; border-radius: 4px; color: #fff; cursor: pointer; font-weight: 500;">Guardar versión...</button>
    </div>
    <div class="versions-list-container" style="flex: 1; overflow-y: auto; padding: 10px;"></div>
  `;

  let editor: any;
  let currentSelectionColor: string | null = null;
  let traceHandle: TraceMarginHandle | null = null;

  const currentMarkdown = () => {
    if (editor) currentContent = editor.getContent();
    return currentContent;
  };
  const downloadBaseName = () => filenamePart(String(note.title || 'nota'));

  if (downloadBtn && downloadMenu) {
    const downloadWrap = downloadBtn.closest('.cnw-hud-download');
    downloadBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      downloadWrap?.classList.toggle('is-open');
    });

    downloadMenu.addEventListener('click', async (event) => {
      const target = event.target instanceof HTMLElement ? event.target.closest<HTMLButtonElement>('[data-download-format]') : null;
      if (!target) return;
      event.preventDefault();
      event.stopPropagation();
      downloadWrap?.classList.remove('is-open');
      const markdown = currentMarkdown();
      const basename = downloadBaseName();
      if (target.dataset.downloadFormat === 'markdown') {
        downloadTextFile(markdown, `${basename}.md`, 'text/markdown;charset=utf-8');
        return;
      }
      if (target.dataset.downloadFormat === 'latex') {
        downloadTextFile(
          markdownToLatex(markdown, String(note.title || basename)),
          `${basename}.tex`,
          'application/x-tex;charset=utf-8',
        );
        return;
      }
      if (target.dataset.downloadFormat === 'latex-template') {
        const templateId = target.dataset.latexTemplate || 'direct';
        downloadTextFile(
          markdownToLatex(markdown, String(note.title || basename), { templateId }),
          `${basename}-${templateId}.tex`,
          'application/x-tex;charset=utf-8',
        );
        return;
      }
      if (target.dataset.downloadFormat === 'pdf') {
        try {
          const html = await renderMarkdownForExport(markdown);
          openPrintablePdf(html, String(note.title || basename));
        } catch {
          openPrintablePdf(`<pre>${escHtml(markdown)}</pre>`, String(note.title || basename));
        }
      }
    });

    const closeDownloadMenu = (event: MouseEvent) => {
      if (!downloadWrap?.contains(event.target as Node)) downloadWrap?.classList.remove('is-open');
    };
    document.addEventListener('click', closeDownloadMenu);
    localCleanups.push(() => document.removeEventListener('click', closeDownloadMenu));
  }

  const selectionToolbar = document.createElement('div');
  selectionToolbar.className = 'pnw-selection-toolbar';
  editorWrap.appendChild(selectionToolbar);

  for (const [colorName, colorObj] of Object.entries(HIGHLIGHT_COLORS)) {
    const btn = document.createElement('button');
    btn.className = `pnw-color-btn pnw-color-btn--${colorName}`;
    btn.title = colorObj.label;
    btn.style.cssText = `
      width: 14px;
      height: 14px;
      border-radius: 50%;
      border: 1.5px solid transparent;
      background-color: ${colorObj.color};
      cursor: pointer;
      padding: 0;
      transition: transform 0.1s, border-color 0.15s;
    `;
    btn.addEventListener('mouseenter', () => {
      btn.style.transform = 'scale(1.25)';
      btn.style.borderColor = 'var(--c-fg, #fff)';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.transform = '';
      btn.style.borderColor = 'transparent';
    });
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleColorSelect(colorName);
    });
    selectionToolbar.appendChild(btn);
  }

  const handleColorSelect = (colorName: string) => {
    if (commentsSidebar.style.display !== 'flex') {
      toggleCommentsSidebar();
    }
    currentSelectionColor = colorName;
    updateNewCommentSection();
    
    const textInput = commentsSidebar.querySelector<HTMLTextAreaElement>('.new-comment-text');
    if (textInput) {
      textInput.focus();
    }
    selectionToolbar.style.display = 'none';
  };

  const updateSelectionToolbar = () => {
    if (!canComment) {
      selectionToolbar.style.display = 'none';
      return;
    }
    const sel = getSelectionInfo();
    if (!sel) {
      selectionToolbar.style.display = 'none';
      return;
    }

    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) {
      selectionToolbar.style.display = 'none';
      return;
    }

    if (!editorWrap.contains(selection.anchorNode)) {
      selectionToolbar.style.display = 'none';
      return;
    }

    try {
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      const wrapRect = editorWrap.getBoundingClientRect();

      if (rect.width === 0 || rect.height === 0) {
        selectionToolbar.style.display = 'none';
        return;
      }

      const left = rect.left - wrapRect.left + rect.width / 2;
      let top = rect.top - wrapRect.top - 12;

      selectionToolbar.style.display = 'flex';
      selectionToolbar.style.left = `${left}px`;

      if (top < 30) {
        top = rect.bottom - wrapRect.top + 8;
        selectionToolbar.style.top = `${top}px`;
        selectionToolbar.style.transform = 'translate(-50%, 0)';
      } else {
        selectionToolbar.style.top = `${top}px`;
        selectionToolbar.style.transform = 'translate(-50%, -100%)';
      }
    } catch {
      selectionToolbar.style.display = 'none';
    }
  };

  const onDocClick = (e: MouseEvent) => {
    if (!editorWrap.contains(e.target as Node) && !selectionToolbar.contains(e.target as Node)) {
      selectionToolbar.style.display = 'none';
    }
  };
  document.addEventListener('mousedown', onDocClick);
  localCleanups.push(() => document.removeEventListener('mousedown', onDocClick));

  const onContextMenu = (e: MouseEvent) => {
    if (!canComment) return;

    const sel = getSelectionInfo();
    if (!sel) return;

    e.preventDefault();

    const wrapRect = editorWrap.getBoundingClientRect();
    const left = e.clientX - wrapRect.left;
    const top = e.clientY - wrapRect.top - 10;

    selectionToolbar.style.display = 'flex';
    selectionToolbar.style.left = `${left}px`;
    selectionToolbar.style.top = `${top}px`;
    selectionToolbar.style.transform = 'translate(-50%, -100%)';
  };
  editorWrap.addEventListener('contextmenu', onContextMenu);
  localCleanups.push(() => editorWrap.removeEventListener('contextmenu', onContextMenu));

  const hud = bodyEl.closest('.cnw-shell')?.querySelector<HTMLElement>('.cnw-hud');
  const commentBtn = document.createElement('button');
  commentBtn.className = 'cnw-hud-icon-btn cnw-hud-comment-btn';
  commentBtn.title = 'Comentarios y Anotaciones';
  commentBtn.dataset.tooltip = 'Comentarios y Anotaciones';
  commentBtn.style.cssText = 'display: flex; align-items: center; justify-content: center;';
  commentBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;

  const historyBtn = document.createElement('button');
  historyBtn.className = 'cnw-hud-icon-btn cnw-hud-history-btn';
  historyBtn.title = 'Historial de versiones';
  historyBtn.dataset.tooltip = 'Historial de versiones';
  historyBtn.style.cssText = 'display: flex; align-items: center; justify-content: center;';
  historyBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/></svg>`;

  if (hud) {
    const infoBtn = hud.querySelector<HTMLElement>(':scope > .cnw-hud-info-btn');
    if (infoBtn?.parentElement === hud) {
      hud.insertBefore(commentBtn, infoBtn);
      hud.insertBefore(historyBtn, infoBtn);
    } else {
      hud.appendChild(commentBtn);
      hud.appendChild(historyBtn);
    }
  }

  const getSelectionInfo = () => {
    if (!editor) return null;
    const view = editor.getView();
    const { from, to } = view.state.selection.main;
    if (from === to) {
      currentSelectionColor = null;
      return null;
    }
    const docText = view.state.doc.toString();
    const quote = docText.slice(from, to);
    const prefix = docText.slice(Math.max(0, from - 30), from);
    const suffix = docText.slice(to, Math.min(docText.length, to + 30));
    return { quote, anchorJson: { from, to, prefix, suffix } };
  };

  let activeAnnotations: any[] = [];

  const loadAnnotations = async () => {
    try {
      const res = await fetch(`/api/live/notes/annotations?noteId=${noteId}`);
      if (!res.ok) return;
      const data = await res.json();
      activeAnnotations = data.annotations ?? [];
      if (!editor) {
        renderCommentsList();
        return;
      }
      
      const docText = editor.getContent();
      currentContent = docText;
      const editorAnns: Array<{ id: string; from: number; to: number; color?: string }> = [];
      
      for (const ann of activeAnnotations) {
        if (ann.isResolved) continue;
        const range = findAnnotationOffsets(docText, ann.quote, ann.anchorJson);
        if (range) {
          editorAnns.push({
            id: ann.id,
            from: range.from,
            to: range.to,
            color: ann.anchorJson?.color
          });
        }
      }
      editor.setAnnotations(editorAnns);
      renderCommentsList();
    } catch {}
  };

  const focusAnnotation = (annId: string) => {
    if (!editor) {
      renderLiveEditor();
      window.setTimeout(() => focusAnnotation(annId), 0);
      return;
    }
    const cards = commentsSidebar.querySelectorAll('.comment-card');
    cards.forEach(card => {
      if (card.id === `comment-card-${annId}`) {
        card.classList.add('is-active');
        (card as HTMLElement).style.borderColor = 'var(--c-link, #3b82f6)';
        card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } else {
        card.classList.remove('is-active');
        (card as HTMLElement).style.borderColor = '';
      }
    });

    const ann = activeAnnotations.find(a => a.id === annId);
    if (ann) {
      const docText = editor.getContent();
      const range = findAnnotationOffsets(docText, ann.quote, ann.anchorJson);
      if (range) {
        editor.getView().dispatch({
          selection: { anchor: range.from, head: range.to },
          effects: EditorView.scrollIntoView(range.from, { y: 'center' })
        });
      }
    }
  };

  const updateNewCommentSection = () => {
    const newCommentSec = commentsSidebar.querySelector<HTMLElement>('.new-comment-section')!;
    if (isReadOnly) {
      newCommentSec.style.display = 'none';
      return;
    }

    const sel = getSelectionInfo();
    if (!sel) {
      newCommentSec.style.display = 'flex';
      newCommentSec.innerHTML = `
        <textarea class="new-comment-text" placeholder="Escribir un comentario general..." style="width: 100%; box-sizing: border-box; height: 50px; padding: 6px; font-size: 11px; background: rgba(0,0,0,0.15); border: 1px solid var(--c-border, rgba(120,120,140,0.22)); border-radius: 4px; color: inherit; outline: none; resize: vertical;"></textarea>
        <div style="display: flex; justify-content: flex-end; gap: 4px; margin-top: 4px;">
          <button class="save-general-comment-btn" style="padding: 4px 8px; font-size: 10px; background: var(--c-link, #3b82f6); border: none; border-radius: 3px; color: #fff; cursor: pointer; font-weight: 500;">Comentar</button>
        </div>
      `;
      newCommentSec.querySelector('.save-general-comment-btn')?.addEventListener('click', async () => {
        const body = newCommentSec.querySelector<HTMLTextAreaElement>('.new-comment-text')!.value.trim();
        if (!body) return;
        await fetch('/api/live/notes/annotations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ noteId, quote: '', anchorJson: {}, body })
        });
        void loadAnnotations();
        updateNewCommentSection();
      });
      return;
    }

    if (!currentSelectionColor) {
      currentSelectionColor = 'yellow';
    }
    const colorObj = HIGHLIGHT_COLORS[currentSelectionColor] || HIGHLIGHT_COLORS['yellow'];

    newCommentSec.style.display = 'flex';
    newCommentSec.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 2px;">
        <span style="font-size: 10px; color: var(--c-fg-dim); font-weight: 500;">Comentar selección:</span>
        <div style="display: flex; align-items: center; gap: 4px; font-size: 9.5px; background: ${colorObj.bg}; color: ${colorObj.color}; border: 1px solid ${colorObj.border}; padding: 1px 6px; border-radius: 10px; font-weight: 500;">
          <span style="width: 5px; height: 5px; border-radius: 50%; background-color: ${colorObj.color};"></span>
          <span>${colorObj.label}</span>
        </div>
      </div>
      <blockquote class="comment-quote" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; margin-bottom: 4px;">"${escHtml(sel.quote)}"</blockquote>
      <textarea class="new-comment-text" placeholder="Añadir comentario sobre esta ${colorObj.label.toLowerCase()}..." style="width: 100%; box-sizing: border-box; height: 55px; padding: 6px; font-size: 11px; background: rgba(0,0,0,0.15); border: 1px solid var(--c-border, rgba(120,120,140,0.22)); border-radius: 4px; color: inherit; outline: none; resize: vertical;"></textarea>
      <div style="display: flex; justify-content: flex-end; gap: 4px; margin-top: 4px;">
        <button class="cancel-new-comment-btn" style="padding: 4px 8px; font-size: 10px; background: none; border: 1px solid var(--c-border, rgba(120,120,140,0.22)); border-radius: 3px; color: inherit; cursor: pointer;">Cancelar</button>
        <button class="save-new-comment-btn" style="padding: 4px 8px; font-size: 10px; background: var(--c-link, #3b82f6); border: none; border-radius: 3px; color: #fff; cursor: pointer; font-weight: 500;">Comentar</button>
      </div>
    `;

    newCommentSec.querySelector('.cancel-new-comment-btn')?.addEventListener('click', () => {
      const view = editor.getView();
      const pos = view.state.selection.main.head;
      view.dispatch({ selection: { anchor: pos, head: pos } });
      updateNewCommentSection();
    });

    newCommentSec.querySelector('.save-new-comment-btn')?.addEventListener('click', async () => {
      const body = newCommentSec.querySelector<HTMLTextAreaElement>('.new-comment-text')!.value.trim();
      if (!body) return;
      await fetch('/api/live/notes/annotations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          noteId,
          quote: sel.quote,
          anchorJson: { ...sel.anchorJson, color: currentSelectionColor },
          body
        })
      });
      void loadAnnotations();
      
      const view = editor.getView();
      const pos = view.state.selection.main.head;
      view.dispatch({ selection: { anchor: pos, head: pos } });
      updateNewCommentSection();
    });
  };

  const renderCommentsList = () => {
    const listContainer = commentsSidebar.querySelector<HTMLElement>('.comments-list-container')!;
    const showResolved = commentsSidebar.querySelector<HTMLInputElement>('.show-resolved-checkbox')!.checked;
    const filterCategory = commentsSidebar.querySelector<HTMLSelectElement>('.category-filter-select')!.value;
    listContainer.innerHTML = '';
    
    const filteredAnns = activeAnnotations.filter(ann => {
      const matchResolved = showResolved || !ann.isResolved;
      const matchCategory = filterCategory === 'all' || ann.anchorJson?.color === filterCategory;
      return matchResolved && matchCategory;
    });

    if (filteredAnns.length === 0) {
      listContainer.innerHTML = '<div style="font-size: 11px; opacity: 0.4; padding: 20px; text-align: center;">No hay comentarios aún</div>';
      return;
    }
    
    for (const ann of filteredAnns) {
      const card = document.createElement('div');
      card.id = `comment-card-${ann.id}`;
      card.className = 'comment-card';
      
      const annColor = ann.anchorJson?.color || 'yellow';
      const colorObj = HIGHLIGHT_COLORS[annColor] || HIGHLIGHT_COLORS['yellow'];
      card.style.borderLeft = `3px solid ${colorObj.color}`;
      
      const quoteBlock = ann.quote ? `<blockquote class="comment-quote" style="margin-top: 4px;">"${escHtml(ann.quote)}"</blockquote>` : '';
      const isOwner = note.userId === d.currentUserId;
      const isAuthor = ann.authorId === d.currentUserId;
      
      let resolveBtn = '';
      if (!ann.isResolved && (isOwner || isAuthor)) {
        resolveBtn = `<button class="resolve-comment-btn" style="background: none; border: 1px solid rgba(120,120,140,0.3); border-radius: 3px; font-size: 9px; cursor: pointer; color: var(--c-fg-dim); padding: 1px 4px;">Resolver</button>`;
      } else if (ann.isResolved) {
        resolveBtn = `<span style="font-size: 9px; color: #45d384; font-weight: 500;">✓ Resuelto</span>`;
      }
      
      let deleteBtn = '';
      if (isOwner || isAuthor) {
        deleteBtn = `<button class="delete-comment-btn" style="background: none; border: none; cursor: pointer; color: #c87e7e; padding: 2px; display: flex; align-items: center;" title="Eliminar conversación"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>`;
      }

      card.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 6px;">
          <div>
            <span class="comment-author">${escHtml(ann.authorName || 'Usuario')}</span>
            <span class="comment-time">${formatRelativeTime(ann.createdAt)}</span>
          </div>
          <div style="display: flex; align-items: center; gap: 4px;">
            ${resolveBtn}
            ${deleteBtn}
          </div>
        </div>
        <div style="display: flex; align-items: center; gap: 4px; margin-top: 2px;">
          <span style="font-size: 8.5px; background: ${colorObj.bg}; color: ${colorObj.color}; border: 1px solid ${colorObj.border}; padding: 1px 5px; border-radius: 8px; font-weight: 500;">
            ${colorObj.label}
          </span>
        </div>
        ${quoteBlock}
        <div style="font-size: 11px; line-height: 1.4; color: var(--c-fg); margin-top: 4px; white-space: pre-wrap;">${escHtml(ann.body)}</div>
        <div class="replies-thread" style="margin-top: 4px; display: flex; flex-direction: column; gap: 4px; border-top: 1px solid rgba(120,120,140,0.08); padding-top: 4px;"></div>
        ${!isReadOnly && !ann.isResolved ? `
          <div style="display: flex; gap: 4px; margin-top: 6px;">
            <input type="text" class="reply-input" placeholder="Responder..." style="flex: 1; padding: 3px 6px; font-size: 10px; background: rgba(0,0,0,0.1); border: 1px solid var(--c-border, rgba(120,120,140,0.2)); border-radius: 3px; color: inherit; outline: none;" />
            <button class="reply-send-btn" style="padding: 3px 6px; font-size: 10px; background: rgba(120,120,140,0.15); border: 1px solid var(--c-border); border-radius: 3px; color: inherit; cursor: pointer;">Enviar</button>
          </div>
        ` : ''}
      `;
      
      const threadContainer = card.querySelector('.replies-thread')!;
      for (const rep of ann.replies ?? []) {
        const repRow = document.createElement('div');
        repRow.className = 'comment-reply';
        const repIsAuthor = rep.authorId === d.currentUserId;
        const repDeleteBtn = (isOwner || repIsAuthor) ? `
          <button class="delete-reply-btn" data-reply-id="${rep.id}" style="background: none; border: none; cursor: pointer; color: #c87e7e; padding: 2px; display: flex; align-items: center;" title="Eliminar respuesta">
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        ` : '';

        repRow.innerHTML = `
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 2px;">
            <div>
              <span class="comment-author" style="font-size: 10px;">${escHtml(rep.authorName || 'Usuario')}</span>
              <span class="comment-time" style="font-size: 9px;">${formatRelativeTime(rep.createdAt)}</span>
            </div>
            ${repDeleteBtn}
          </div>
          <div style="font-size: 10.5px; line-height: 1.35; color: var(--c-fg); white-space: pre-wrap;">${escHtml(rep.body)}</div>
        `;
        
        repRow.querySelector('.delete-reply-btn')?.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (!confirm('¿Eliminar esta respuesta?')) return;
          await fetch(`/api/live/notes/annotations?commentId=${rep.id}`, { method: 'DELETE' });
          void loadAnnotations();
        });

        threadContainer.appendChild(repRow);
      }
      
      card.querySelector('.resolve-comment-btn')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        await fetch('/api/live/notes/annotations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: ann.id, noteId, body: ann.body, isResolved: true })
        });
        void loadAnnotations();
      });
      
      card.querySelector('.delete-comment-btn')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm('¿Eliminar esta conversación por completo?')) return;
        await fetch(`/api/live/notes/annotations?id=${ann.id}`, { method: 'DELETE' });
        void loadAnnotations();
      });
      
      const rInput = card.querySelector<HTMLInputElement>('.reply-input');
      const rSend = card.querySelector<HTMLButtonElement>('.reply-send-btn');
      
      const sendReply = async () => {
        if (!rInput) return;
        const text = rInput.value.trim();
        if (!text) return;
        await fetch('/api/live/notes/annotations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ annotationId: ann.id, body: text })
        });
        rInput.value = '';
        void loadAnnotations();
      };
      
      rSend?.addEventListener('click', sendReply);
      rInput?.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          void sendReply();
        }
      });
      
      card.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('button, input, textarea, select')) return;
        focusAnnotation(ann.id);
      });
      
      listContainer.appendChild(card);
    }
  };

  commentsSidebar.querySelector('.show-resolved-checkbox')?.addEventListener('change', renderCommentsList);
  commentsSidebar.querySelector('.category-filter-select')?.addEventListener('change', renderCommentsList);

  const toggleCommentsSidebar = () => {
    if (commentsSidebar.style.display === 'flex') {
      commentsSidebar.style.display = 'none';
      commentBtn.classList.remove('is-active');
    } else {
      commentsSidebar.style.display = 'flex';
      versionsSidebar.style.display = 'none';
      commentBtn.classList.add('is-active');
      historyBtn.classList.remove('is-active');
      updateNewCommentSection();
      void loadAnnotations();
    }
  };
  commentBtn.addEventListener('click', toggleCommentsSidebar);
  commentsSidebar.querySelector('.comments-close-btn')?.addEventListener('click', toggleCommentsSidebar);

  // Versions Sidebar Logic
  let activeVersions: any[] = [];
  const loadVersions = async () => {
    try {
      const res = await fetch(`/api/live/notes/versions?noteId=${noteId}`);
      if (!res.ok) return;
      const data = await res.json();
      activeVersions = data.versions ?? [];
      renderVersionsList();
    } catch {}
  };

  const renderVersionsList = () => {
    const listContainer = versionsSidebar.querySelector('.versions-list-container')!;
    listContainer.innerHTML = '';
    
    if (activeVersions.length === 0) {
      listContainer.innerHTML = '<div style="font-size: 11px; opacity: 0.4; padding: 20px; text-align: center;">No hay versiones guardadas</div>';
      return;
    }
    
    for (const v of activeVersions) {
      const card = document.createElement('div');
      card.className = 'version-card';
      card.innerHTML = `
        <div style="font-weight: 600; color: var(--c-fg); word-break: break-word;">${escHtml(v.versionName)}</div>
        <div style="font-size: 9.5px; color: var(--c-fg-dim); opacity: 0.8; margin-top: 2px;">
          Por ${escHtml(v.createdByUserName || 'Usuario')} · ${formatRelativeTime(v.createdAt)}
        </div>
        <div style="display: flex; justify-content: flex-end; margin-top: 6px;">
          <button class="restore-version-btn" style="padding: 3px 8px; font-size: 10px; background: rgba(59, 130, 246, 0.15); border: 1px solid rgba(59, 130, 246, 0.4); border-radius: 4px; color: var(--c-link, #3b82f6); cursor: pointer;">Restaurar</button>
        </div>
      `;
      
      card.querySelector('.restore-version-btn')?.addEventListener('click', async () => {
        if (!confirm(`¿Restaurar la versión "${v.versionName}"? Se reemplazará el contenido actual del editor.`)) return;
        
        const res = await fetch('/api/live/notes/versions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ noteId, versionId: v.id })
        });
        
        if (res.ok) {
          const resData = await res.json();
          const restoredBody = String(resData.body ?? '');
          currentContent = restoredBody;
          if (editor) {
            editor.setContent(restoredBody);
          } else if (currentMode === 'render') {
            void renderMarkdownPreview();
          }
          const titleEl = bodyEl.closest('.cnw-shell')?.querySelector('.cnw-title');
          if (titleEl && resData.title) {
            titleEl.textContent = resData.title;
          }
          updateHud(bodyEl, restoredBody, currentMode);
          void loadAnnotations();
          statusDot.className = 'cnw-status saved';
        } else {
          alert('No se pudo restaurar la versión.');
        }
      });
      listContainer.appendChild(card);
    }
  };

  versionsSidebar.querySelector('.save-version-btn')?.addEventListener('click', async () => {
    const name = prompt('Nombre de la versión (ej: Primer borrador, Notas de clase):');
    if (!name || !name.trim()) return;
    
    const res = await fetch('/api/live/notes/versions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ noteId, versionName: name.trim() })
    });
    
    if (res.ok) {
      void loadVersions();
    } else {
      alert('Error al guardar la versión.');
    }
  });

  const toggleVersionsSidebar = () => {
    if (versionsSidebar.style.display === 'flex') {
      versionsSidebar.style.display = 'none';
      historyBtn.classList.remove('is-active');
    } else {
      versionsSidebar.style.display = 'flex';
      commentsSidebar.style.display = 'none';
      historyBtn.classList.add('is-active');
      commentBtn.classList.remove('is-active');
      void loadVersions();
    }
  };
  historyBtn.addEventListener('click', toggleVersionsSidebar);
  versionsSidebar.querySelector('.versions-close-btn')?.addEventListener('click', toggleVersionsSidebar);

  // Check for draft recovery
  let draft: { body: string; ts: number } | null = null;
  try {
    const raw = localStorage.getItem(`db-note-draft::${noteId}`);
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
    mount.appendChild(workspaceRow);

    updateModeButton();
    updateHud(bodyEl, currentContent, currentMode);

    banner.querySelector('#cnw-recover-discard')?.addEventListener('click', () => {
      try { localStorage.removeItem(`db-note-draft::${noteId}`); } catch {}
      banner.remove();
      currentContent = String(note.body ?? '');
      editor = createLiveMdEditor(editorWrap, currentContent, save, { readOnly: isReadOnly });
      (bodyEl as any).__editor = editor;
      updateModeButton();
      updateHud(bodyEl, currentContent, currentMode);
      editor.focus();
      void loadAnnotations();
    });
    banner.querySelector('#cnw-recover-accept')?.addEventListener('click', () => {
      banner.remove();
      currentContent = draft.body;
      editor = createLiveMdEditor(editorWrap, currentContent, save, { readOnly: isReadOnly });
      (bodyEl as any).__editor = editor;
      updateModeButton();
      updateHud(bodyEl, currentContent, currentMode);
      editor.focus();
      void save(currentContent);
      void loadAnnotations();
    });
  } else {
    mount.appendChild(workspaceRow);
    editor = createLiveMdEditor(editorWrap, currentContent, save, { readOnly: isReadOnly });
    (bodyEl as any).__editor = editor;
    updateModeButton();
    updateHud(bodyEl, currentContent, currentMode);
    editor.focus();
    void loadAnnotations();
  }

  const onSelectionChanged = () => {
    updateNewCommentSection();
    updateSelectionToolbar();
  };
  bodyEl.addEventListener('editor-selection-changed', onSelectionChanged);
  localCleanups.push(() => bodyEl.removeEventListener('editor-selection-changed', onSelectionChanged));

  // Reposition selection toolbar on editor scroll
  const scroller = editorWrap.querySelector('.cm-scroller');
  if (scroller) {
    scroller.addEventListener('scroll', updateSelectionToolbar);
    localCleanups.push(() => scroller.removeEventListener('scroll', updateSelectionToolbar));
  }

  bodyEl.addEventListener('annotation-clicked', (e: any) => {
    const annId = e.detail.annotationId;
    if (annId) {
      commentsSidebar.style.display = 'flex';
      versionsSidebar.style.display = 'none';
      commentBtn.classList.add('is-active');
      historyBtn.classList.remove('is-active');
      focusAnnotation(annId);
    }
  });

  const toggleTrace = async () => {
    if (traceHandle) {
      traceHandle.destroy();
      traceHandle = null;
      traceBtn.classList.remove('is-active');
      return;
    }
    if (!editor) {
      traceWantsRestore = true;
      renderLiveEditor();
      return;
    }
    const { mountTraceMargin } = await import('../course/notes/trace-margin');
    traceHandle = await mountTraceMargin(editor.getView(), noteId, bodyEl, { canWrite: canComment });
    traceBtn.classList.add('is-active');
  };
  traceBtn.addEventListener('click', () => { void toggleTrace(); });
  await toggleTrace();
  localCleanups.push(() => {
    traceHandle?.destroy();
    editor?.destroy();
  });
}
