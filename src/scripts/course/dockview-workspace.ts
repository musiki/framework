// src/scripts/course/dockview-workspace.ts
import { DockviewComponent } from 'dockview-core';
import { NotesPersistence } from './notes-persistence';
import { getNote } from '../notes-editor/api';
import { parseFrontmatter } from '../notes-editor/yaml-strip';
import {
  mountInlineNotesEditor,
  type InlineEditorOptions,
} from './notes/inline-editor';

export type NoteMode = 'preview' | 'edit';

export interface CourseNotesWorkspace {
  openNote(slug: string, mode: NoteMode, split?: boolean): void;
  destroy(): void;
}

type PanelParams = { slug: string; courseId: string; mode: NoteMode };

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

// ── Inject CSS ────────────────────────────────────────────────────────────

let cssInjected = false;
function injectWorkspaceCss(containerId: string) {
  if (cssInjected) return;
  cssInjected = true;
  const style = document.createElement('style');
  style.textContent = `
    /* Hide ALL native dockview tabs — scoped to our container */
    #${containerId} .dv-header,
    #${containerId} .dv-tab-container,
    #${containerId} .dv-tab,
    #${containerId} .dv-tab-divider,
    #${containerId} .dv-tab-separator,
    #${containerId} .dv-tabs-and-actions-container {
      height: 0 !important;
      min-height: 0 !important;
      max-height: 0 !important;
      padding: 0 !important;
      margin: 0 !important;
      border: none !important;
      visibility: hidden !important;
      overflow: hidden !important;
      opacity: 0 !important;
      pointer-events: none !important;
    }
    /* Keep separator for split functionality */
    #${containerId} .dv-separator {
      visibility: visible !important;
      opacity: 1 !important;
      pointer-events: auto !important;
      background: var(--c-border, rgba(120,120,140,0.15)) !important;
    }

    /* DIY Shell */
    .cnw-shell {
      display: flex;
      flex-direction: column;
      height: 100%;
      width: 100%;
      overflow: hidden;
      background: var(--c-bg);
      position: relative;
    }

    /* Transparent header — the drag zone */
    .cnw-header {
      position: relative;
      width: 100%;
      height: 22px;
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: flex-end;
      background: transparent;
      cursor: grab;
      user-select: none;
      padding: 0 6px;
      box-sizing: border-box;
      gap: 6px;
    }
    .cnw-header:active { cursor: grabbing; }
    .cnw-header.is-dragging { opacity: .4; }

    /* Note title — invisible at rest, shows on hover */
    .cnw-title {
      font-size: 10px;
      color: var(--c-fg-subtle, var(--c-fg-dim));
      opacity: 0;
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      transition: opacity 160ms;
      pointer-events: none;
    }
    .cnw-shell:hover .cnw-title { opacity: 0.45; }

    /* Status dot */
    .cnw-status {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      flex-shrink: 0;
      opacity: 0;
      transition: opacity 300ms, background 200ms;
    }
    .cnw-status.pending { background: var(--c-fg-dim); opacity: 1; }
    .cnw-status.saving  { background: var(--c-link, #3b82f6); opacity: 1; animation: cnw-pulse 800ms infinite; }
    .cnw-status.error   { background: #c87e7e; opacity: 1; }
    @keyframes cnw-pulse { 0%,100%{opacity:.6} 50%{opacity:1} }

    /* Pencil / eye icon button */
    .cnw-mode-btn {
      background: none;
      border: none;
      padding: 0;
      cursor: pointer;
      color: var(--c-fg-dim);
      opacity: 0;
      line-height: 1;
      font-size: 12px;
      transition: opacity 160ms, color 160ms;
      display: flex;
      align-items: center;
      flex-shrink: 0;
    }
    .cnw-shell:hover .cnw-mode-btn { opacity: 0.6; }
    .cnw-mode-btn:hover { opacity: 1 !important; color: var(--c-fg); }

    /* Panel body */
    .cnw-body {
      flex: 1;
      overflow: auto;
      min-height: 0;
      position: relative;
    }

    /* Recovery banner */
    .cnw-recovery {
      position: absolute;
      top: 0; left: 0; right: 0;
      background: var(--c-bg-surface, var(--c-bg-mute));
      border-bottom: 1px solid var(--c-border);
      padding: 6px 12px;
      font-size: 11px;
      color: var(--c-fg);
      display: flex;
      align-items: center;
      gap: 8px;
      z-index: 10;
    }
    .cnw-recovery button {
      font-size: 11px;
      padding: 2px 8px;
      border-radius: 3px;
      border: 1px solid var(--c-border);
      background: none;
      color: var(--c-fg);
      cursor: pointer;
    }
  `;
  document.head.appendChild(style);
}

// ── DIY Shell builder ─────────────────────────────────────────────────────

function buildShell(
  panelId: string,
  slug: string,
  title: string,
  dockview: DockviewComponent,
): { shell: HTMLElement; bodyEl: HTMLElement; statusDot: HTMLElement; pencilBtn: HTMLButtonElement } {
  const shell = document.createElement('div');
  shell.className = 'cnw-shell';
  shell.dataset.panelId = panelId;

  // Header
  const header = document.createElement('div');
  header.className = 'cnw-header';

  const titleEl = document.createElement('span');
  titleEl.className = 'cnw-title';
  titleEl.textContent = title;
  header.appendChild(titleEl);

  const statusDot = document.createElement('span');
  statusDot.className = 'cnw-status';
  header.appendChild(statusDot);

  const pencilBtn = document.createElement('button');
  pencilBtn.className = 'cnw-mode-btn';
  pencilBtn.title = 'Alternar modo edición / vista previa';
  pencilBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`;
  header.appendChild(pencilBtn);

  // Drag behaviour on header
  header.draggable = true;
  header.addEventListener('dragstart', e => {
    if (!e.dataTransfer) return;
    e.dataTransfer.setData('musiki/panel-id', panelId);
    e.dataTransfer.setData('text/plain', panelId);
    e.dataTransfer.effectAllowed = 'move';
    header.classList.add('is-dragging');
  });
  header.addEventListener('dragend', () => header.classList.remove('is-dragging'));

  // Drop target on shell (same pattern as room workspace)
  shell.addEventListener('dragover', e => {
    if (!e.dataTransfer?.types.includes('musiki/panel-id')) return;
    e.preventDefault();
    shell.classList.add('cnw-drag-over');
  });
  shell.addEventListener('dragleave', e => {
    if (!shell.contains(e.relatedTarget as Node)) shell.classList.remove('cnw-drag-over');
  });
  shell.addEventListener('drop', e => {
    shell.classList.remove('cnw-drag-over');
    const srcId = e.dataTransfer?.getData('musiki/panel-id');
    if (!srcId || srcId === panelId) return;
    e.preventDefault();
    const srcPanel = dockview.getGroupPanel(srcId);
    const tgtPanel = dockview.getGroupPanel(panelId);
    if (srcPanel && tgtPanel) {
      dockview.moveGroupOrPanel({
        from: { panelId: srcId },
        to: { group: tgtPanel.group, position: 'right' },
      });
    }
  });

  shell.appendChild(header);

  const body = document.createElement('div');
  body.className = 'cnw-body';
  shell.appendChild(body);

  return { shell, bodyEl: body, statusDot, pencilBtn };
}

// ── Preview renderer ──────────────────────────────────────────────────────

async function renderPreview(bodyEl: HTMLElement, courseId: string, slug: string): Promise<string> {
  bodyEl.innerHTML = '<p style="padding:1rem;opacity:.4;font-size:.85rem;">Cargando…</p>';
  try {
    const note = await getNote(courseId, slug);
    const { body } = parseFrontmatter(note.content);
    // Render as pre for now — full markdown render would require server round-trip
    bodyEl.innerHTML = `<div style="padding:1.2rem 1.5rem;font-size:var(--font-size-base,1rem);line-height:1.72;color:var(--c-fg)"><pre style="white-space:pre-wrap;font-family:inherit">${escHtml(body)}</pre></div>`;
    return note.content;
  } catch {
    bodyEl.innerHTML = `<p style="padding:1rem;color:#c87e7e;font-size:.85rem;">Error al cargar la nota</p>`;
    return '';
  }
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Mode switching ────────────────────────────────────────────────────────

async function enterEditMode(state: PanelState) {
  state.mode = 'edit';
  state.bodyEl.innerHTML = '';
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

      // Mode toggle
      pencilBtn.addEventListener('click', () => {
        if (state.mode === 'preview') enterEditMode(state);
        else enterPreviewMode(state);
      });

      // Render initial mode
      if (params.mode === 'edit') {
        enterEditMode(state);
      } else {
        if (initialContent && params.slug === initialSlug) {
          // Use server-rendered content for the initial panel
          bodyEl.innerHTML = initialContent;
        } else {
          renderPreview(bodyEl, params.courseId, params.slug);
        }
      }

      // dockview expects the component to implement { element }
      return { element: shell };
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

  function openNote(slug: string, mode: NoteMode = 'preview', split = false): void {
    const panelId = `note-${slug}`;
    const existing = dockview.getGroupPanel(panelId);

    if (existing && !split) {
      // Navigate existing panel to new slug (same panel, new content)
      const state = panelStates.get(panelId);
      if (!state) return;
      state.slug = slug;
      if (state.mode === 'preview') renderPreview(state.bodyEl, courseId, slug);
      else {
        state.persistence?.destroy();
        enterEditMode(state);
      }
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
        ? { referencePanel: referencePanel.id, direction: 'right' }
        : undefined,
    });
  }

  // Listen for sidebar note-open events
  window.addEventListener('note-open', (e: Event) => {
    const ev = e as CustomEvent<{ slug: string; courseId: string; mode: NoteMode; split?: boolean }>;
    e.preventDefault();
    openNote(ev.detail.slug, ev.detail.mode ?? 'preview', ev.detail.split ?? false);
  });

  // Cleanup on panel removal
  dockview.onDidRemovePanel(event => {
    const state = panelStates.get(event.id);
    if (state?.persistence) {
      state.persistence.flush().then(() => state.persistence?.destroy());
    }
    panelStates.delete(event.id);
  });

  return {
    openNote,
    destroy: () => {
      ro.disconnect();
      panelStates.forEach(s => s.persistence?.destroy());
      panelStates.clear();
      dockview.dispose();
    },
  };
}
