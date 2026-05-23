// src/scripts/notas/personal-notes-workspace.ts
import { DockviewComponent } from 'dockview-core';
import { buildShell, injectWorkspaceCss } from '../course/dockview-shell';

export interface PersonalNotesWorkspace {
  destroy(): void;
}

const pendingParams = new Map<string, any>();
let _workspace: PersonalNotesWorkspace | null = null;
let _ctrl: AbortController | null = null;

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
        const { shell, bodyEl, pencilBtn } = buildShell(options.id, params.noteId, params.title, dockview);
        pencilBtn.style.display = 'none';
        void loadDbNoteContent(bodyEl, params.noteId);
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
      item.title = note.title || '(sin título)';
      item.textContent = note.title || '(sin título)';
      item.addEventListener('mouseenter', () => { item.style.opacity = '1'; });
      item.addEventListener('mouseleave', () => { item.style.opacity = '.75'; });
      item.addEventListener('click', () => openNotePanel(note.id, note.title ?? '', dockview));
      tree.appendChild(item);
    }
  }

  search.addEventListener('input', () => render(search.value));

  newBtn.addEventListener('click', async () => {
    const title = prompt('Nombre de la nueva nota:');
    if (!title?.trim()) return;
    const res = await fetch('/api/live/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: title.trim(), body: '' }),
    });
    if (!res.ok) return;
    await loadAll();
  });

  void loadAll();
  return el;
}

function openNotePanel(noteId: string, title: string, dockview: DockviewComponent) {
  const newId = `pnw-note-${noteId}`;
  const existing = dockview.getGroupPanel(newId);
  if (existing) { existing.api.setActive(); return; }
  pendingParams.set(newId, { kind: 'db-note', noteId, title });
  const refPanel = dockview.panels[dockview.panels.length - 1] ?? undefined;
  dockview.addPanel({ id: newId, component: 'note-panel', position: refPanel ? { referencePanel: refPanel.id, direction: 'right' } : undefined });
}

async function loadDbNoteContent(bodyEl: HTMLElement, noteId: string) {
  bodyEl.innerHTML = '<p style="padding:1rem;opacity:.4;font-size:.85rem;">Cargando…</p>';
  const r = await fetch(`/api/live/notes?id=${noteId}`).catch(() => null);
  const d = r ? await r.json().catch(() => null) : null;
  const note = d?.notes?.[0];
  if (!note) { bodyEl.innerHTML = '<p style="padding:1rem;opacity:.4">Nota no encontrada</p>'; return; }
  const { marked } = await import('marked');
  const html = String(marked.parse(note.body ?? '', { async: false }));
  bodyEl.innerHTML = `<div style="padding:1.2rem 1.5rem;font-size:var(--font-size-base,1rem);line-height:1.72">${html}</div>`;
}
