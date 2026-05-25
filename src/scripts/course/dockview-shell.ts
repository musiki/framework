// src/scripts/course/dockview-shell.ts
import type { DockviewComponent } from 'dockview-core';

export type NoteMode = 'preview' | 'edit';

export function injectWorkspaceCss(containerId: string) {
  if (document.querySelector('[data-cnw-ws-css]')) return;
  const style = document.createElement('style');
  style.setAttribute('data-cnw-ws-css', '1');
  style.textContent = `
    /* Zero out content-area padding/overflow when dockview takes over */
    #${containerId}.content-area {
      padding: 0 !important;
      overflow: hidden !important;
      --dv-sash-color: var(--c-border, rgba(120,120,140,0.35));
      --dv-active-sash-color: var(--c-link, #3b82f6);
    }
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
      border: 1px solid var(--c-border, rgba(120,120,140,0.18));
      border-radius: 4px;
      box-sizing: border-box;
    }
    .cnw-shell.cnw-drag-over,
    .cnw-shell.cnw-external-drag-over {
      outline: 2px solid color-mix(in srgb, var(--c-link, #3b82f6) 62%, transparent);
      outline-offset: -2px;
      background: color-mix(in srgb, var(--c-link, #3b82f6) 7%, var(--c-bg));
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

    /* Drag handle — six dots grid */
    .cnw-handle {
      display: inline-grid;
      grid-template-columns: repeat(2, 3px);
      grid-template-rows: repeat(3, 3px);
      gap: 2px;
      opacity: 0.7;
      flex-shrink: 0;
      pointer-events: none;
    }
    .cnw-handle span {
      width: 3px;
      height: 3px;
      border-radius: 50%;
      background: var(--c-fg-dim, currentColor);
      display: block;
    }

    /* Note title — subtle but always visible */
    .cnw-title {
      font-size: 11px;
      color: var(--c-fg-subtle, var(--c-fg-dim));
      opacity: 0.5;
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      letter-spacing: 0.02em;
      pointer-events: none;
    }

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

    /* Header icon buttons: pencil, split, close */
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
    .cnw-close-btn:hover { color: #c87e7e !important; }
    .cnw-mode-btn.is-active { opacity: 1 !important; color: var(--c-link, #3b82f6) !important; }

    /* HUD icon buttons — cohesive with ribbon flat style */
    .cnw-hud-icon-btn {
      border: none;
      background: none;
      cursor: pointer;
      padding: 0 3px;
      color: inherit;
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: 1;
      flex-shrink: 0;
      position: relative;
      transition: color 120ms;
    }
    .cnw-hud-icon-btn:hover { color: var(--c-fg); }
    .cnw-hud-icon-btn.is-active { color: var(--c-link, #3b82f6) !important; }
    /* CSS tooltip — floats above the button, inside panel bounds */
    .cnw-hud-icon-btn::after {
      content: attr(data-tooltip);
      position: absolute;
      bottom: calc(100% + 6px);
      right: 0;
      background: color-mix(in srgb, var(--c-bg, #111) 93%, var(--c-fg) 7%);
      border: 1px solid var(--c-border, rgba(120,120,140,.3));
      color: var(--c-fg, #e5e5e5);
      font-size: .62rem;
      white-space: nowrap;
      padding: 3px 7px;
      border-radius: 4px;
      pointer-events: none;
      opacity: 0;
      transition: opacity 140ms 180ms;
      z-index: 200;
      font-family: var(--font-ui, system-ui, sans-serif);
    }
    .cnw-hud-icon-btn:hover::after { opacity: 1; }

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

    /* Unified prose-editor — no border box, CM looks like a document */
    .cnw-body .cm-editor { background: transparent !important; height: 100%; }
    .cnw-body .cm-scroller { padding: 1.2rem 1.5rem !important; font-size: var(--font-size-base, 1rem); line-height: 1.72; overflow: auto; }
    .cnw-body .cm-content { caret-color: var(--c-link, #3b82f6) !important; }
    .cnw-body .cm-focused { outline: none !important; }
    /* The shell owns the title row; the YAML strip remains available below it. */
    .cnw-body #nie-editor-panel > div:first-child { display: none !important; }
    .cnw-body #nie-editor-panel { flex: 1; height: 100%; }
  `;
  document.head.appendChild(style);
}

export function buildShell(
  panelId: string,
  slug: string,
  title: string,
  dockview: DockviewComponent,
  showHud = false,
): { shell: HTMLElement; bodyEl: HTMLElement; statusDot: HTMLElement; pencilBtn: HTMLButtonElement; splitRightBtn: HTMLButtonElement; splitBelowBtn: HTMLButtonElement; traceBtn: HTMLButtonElement } {
  const shell = document.createElement('div');
  shell.className = 'cnw-shell';
  shell.dataset.panelId = panelId;

  // Header
  const header = document.createElement('div');
  header.className = 'cnw-header';

  // 6-dot drag handle
  const handle = document.createElement('span');
  handle.className = 'cnw-handle';
  for (let i = 0; i < 6; i++) {
    const dot = document.createElement('span');
    handle.appendChild(dot);
  }
  header.appendChild(handle);

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

  const splitRightBtn = document.createElement('button');
  splitRightBtn.className = 'cnw-mode-btn';
  splitRightBtn.title = 'Dividir a la derecha';
  splitRightBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="1"/><line x1="12" y1="3" x2="12" y2="21"/></svg>`;
  header.appendChild(splitRightBtn);

  const splitBelowBtn = document.createElement('button');
  splitBelowBtn.className = 'cnw-mode-btn';
  splitBelowBtn.title = 'Dividir abajo';
  splitBelowBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="1"/><line x1="3" y1="12" x2="21" y2="12"/></svg>`;
  header.appendChild(splitBelowBtn);

  const traceBtn = document.createElement('button');
  traceBtn.className = 'cnw-hud-icon-btn cnw-hud-trace-btn';
  traceBtn.title = 'Monitor de análisis';
  traceBtn.dataset.tooltip = 'Monitor — Trace, Léxico, Zipf y QA';
  traceBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82Z"/><circle cx="7" cy="7" r="1.3" fill="currentColor" stroke="none"/></svg>`;

  const closeBtn = document.createElement('button');
  closeBtn.className = 'cnw-mode-btn cnw-close-btn';
  closeBtn.title = 'Cerrar panel';
  closeBtn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const panel = dockview.getGroupPanel(panelId);
    if (panel) dockview.removePanel(panel);
  });
  header.appendChild(closeBtn);

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

  const resolveShellDropPosition = (e: DragEvent): 'left' | 'right' | 'top' | 'bottom' => {
    const rect = shell.getBoundingClientRect();
    const xRatio = rect.width > 0 ? (e.clientX - rect.left) / rect.width : 0.5;
    const yRatio = rect.height > 0 ? (e.clientY - rect.top) / rect.height : 0.5;
    if (yRatio < 0.32) return 'top';
    if (yRatio > 0.68) return 'bottom';
    return xRatio < 0.5 ? 'left' : 'right';
  };

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
        from: { groupId: srcPanel.group.id, panelId: srcId },
        to: { group: tgtPanel.group, position: resolveShellDropPosition(e) },
      });
    }
  });

  shell.appendChild(header);

  const body = document.createElement('div');
  body.className = 'cnw-body';
  shell.appendChild(body);

  if (showHud) {
    const hud = document.createElement('div');
    hud.className = 'cnw-hud';
    hud.style.cssText = 'display:flex;align-items:center;padding:0 .6rem;height:20px;flex-shrink:0';

    const stats = document.createElement('span');
    stats.className = 'cnw-hud-stats';
    stats.style.cssText = 'font-size:.682rem;opacity:.7;font-family:var(--font-mono,monospace);flex:1';
    hud.appendChild(stats);
    hud.appendChild(traceBtn);

    shell.appendChild(hud);
  }

  return { shell, bodyEl: body, statusDot, pencilBtn, splitRightBtn, splitBelowBtn, traceBtn };
}
