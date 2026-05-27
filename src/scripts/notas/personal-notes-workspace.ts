// src/scripts/notas/personal-notes-workspace.ts
import { DockviewComponent } from 'dockview-core';
import { buildShell, injectWorkspaceCss } from '../course/dockview-shell';
import { createLiveMdEditor } from '../course/notes/live-md-editor';
import type { TraceMarginHandle } from '../course/notes/trace-margin';

export interface PersonalNotesWorkspace {
  destroy(): void;
}

const pendingParams = new Map<string, any>();
let _workspace: PersonalNotesWorkspace | null = null;
let _ctrl: AbortController | null = null;
let _editorCleanups: Array<() => void> = [];

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
        const { shell, bodyEl, pencilBtn, statusDot, splitRightBtn, splitBelowBtn, traceBtn } = buildShell(
          options.id, params.noteId, params.title, dockview, true,
        );
        pencilBtn.style.display = 'none';
        splitRightBtn.style.display = 'none';
        splitBelowBtn.style.display = 'none';
        void mountDbNoteEditor(bodyEl, statusDot, traceBtn, params.noteId);
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
      for (const cleanup of _editorCleanups) cleanup();
      _editorCleanups = [];
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

function updateHud(bodyEl: HTMLElement, content: string) {
  const hud = bodyEl.closest('.cnw-shell')?.querySelector<HTMLElement>('.cnw-hud-stats');
  if (!hud) return;
  const words = content.trim() ? content.trim().split(/\s+/).length : 0;
  const sentences = content.split(/[.!?]+/).filter(sentence => sentence.trim()).length;
  hud.textContent = `${words} palabras · ${content.length.toLocaleString()} caracteres · ${sentences} oraciones`;
}

async function mountDbNoteEditor(bodyEl: HTMLElement, statusDot: HTMLElement, traceBtn: HTMLButtonElement, noteId: string) {
  bodyEl.innerHTML = '<p style="padding:1rem;opacity:.4;font-size:.85rem;">Cargando…</p>';
  const r = await fetch(`/api/live/notes?id=${noteId}`).catch(() => null);
  const d = r ? await r.json().catch(() => null) : null;
  const note = d?.notes?.[0];
  if (!note) { bodyEl.innerHTML = '<p style="padding:1rem;opacity:.4">Nota no encontrada</p>'; return; }
  if (!bodyEl.isConnected) return;
  bodyEl.innerHTML = '';
  const mount = document.createElement('div');
  mount.style.cssText = 'height:100%;overflow:hidden;display:flex;flex-direction:column;';
  bodyEl.appendChild(mount);

  const save = async (content: string) => {
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
    updateHud(bodyEl, content);
  };

  const editorWrap = document.createElement('div');
  editorWrap.style.cssText = 'flex:1;min-height:0;';

  let editor: any;

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
    mount.appendChild(editorWrap);

    banner.querySelector('#cnw-recover-discard')?.addEventListener('click', () => {
      try { localStorage.removeItem(`db-note-draft::${noteId}`); } catch {}
      banner.remove();
      editor = createLiveMdEditor(editorWrap, note.body ?? '', save);
      updateHud(bodyEl, note.body ?? '');
      editor.focus();
    });
    banner.querySelector('#cnw-recover-accept')?.addEventListener('click', () => {
      banner.remove();
      editor = createLiveMdEditor(editorWrap, draft.body, save);
      updateHud(bodyEl, draft.body);
      editor.focus();
      void save(draft.body);
    });
  } else {
    mount.appendChild(editorWrap);
    editor = createLiveMdEditor(editorWrap, note.body ?? '', save);
    updateHud(bodyEl, note.body ?? '');
    editor.focus();
  }

  let traceHandle: TraceMarginHandle | null = null;
  const toggleTrace = async () => {
    if (traceHandle) {
      traceHandle.destroy();
      traceHandle = null;
      traceBtn.classList.remove('is-active');
      return;
    }
    const { mountTraceMargin } = await import('../course/notes/trace-margin');
    traceHandle = await mountTraceMargin(editor.getView(), noteId, bodyEl);
    traceBtn.classList.add('is-active');
  };
  traceBtn.addEventListener('click', () => { void toggleTrace(); });
  await toggleTrace();
  _editorCleanups.push(() => {
    traceHandle?.destroy();
    editor.destroy();
  });
}
