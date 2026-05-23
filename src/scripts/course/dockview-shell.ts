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

export function buildShell(
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
        from: { groupId: srcPanel.group.id, panelId: srcId },
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
