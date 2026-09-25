import { buildTree, type TreeFolder, type TreeNote, type TreeNode } from './model.ts';
import { VISIBILITIES, type Visibility } from '../notes/visibility.ts';

export type TreeLabels = Record<'newNote' | 'newFolder' | 'rename' | 'delete' | 'visibility' | 'inherit' | 'private' | 'supervision' | 'committee' | 'public' | 'confirmDelete' | 'empty' | 'loading' | 'error' | 'up' | 'down' | 'actions', string>;
export type TreeRenderOptions = {
  container: HTMLElement; labels: TreeLabels; locale: string; canManage: boolean;
  showVisibility: boolean; selectedNoteId?: string | null;
  load(): Promise<{ folders: TreeFolder[]; notes: TreeNote[] }>;
  onOpenNote(id: string): void;
  actions: {
    createNote(parentId: string | null): Promise<void>;
    createFolder(parentId: string | null, name: string): Promise<void>;
    renameNote(id: string, title: string): Promise<void>;
    renameFolder(id: string, name: string): Promise<void>;
    deleteNote(id: string): Promise<void>;
    deleteFolder(id: string): Promise<void>;
    reorder(kind: 'note' | 'folder', id: string, parentId: string | null, targetIndex: number): Promise<void>;
    setVisibility?(kind: 'note' | 'folder', id: string, visibility: Visibility | null): Promise<void>;
  };
};

/** Reusable DOM renderer. Text always enters through textContent, including stored titles. */
export function renderTree(opts: TreeRenderOptions): { refresh(): Promise<void>; destroy(): void } {
  const { container, labels: l, actions } = opts;
  let alive = true;
  let generation = 0;
  let busy = false;
  let dragged: { id: string; kind: 'note' | 'folder'; parentId: string | null } | null = null;
  const closed = new Set<string>();
  const status = document.createElement('p'); status.setAttribute('role', 'status');
  const content = document.createElement('div'); content.className = 'writing-tree';
  container.replaceChildren(status, content);
  const button = (label: string, action: () => void) => {
    const el = document.createElement('button'); el.type = 'button'; el.textContent = label;
    el.addEventListener('click', e => { e.stopPropagation(); action(); }); return el;
  };
  async function run(action: () => Promise<void>) {
    if (busy || !alive) return;
    busy = true; content.setAttribute('aria-busy', 'true');
    try { await action(); await refresh(); }
    catch { status.textContent = l.error; }
    finally { busy = false; content.removeAttribute('aria-busy'); }
  }
  function createButtons(parentId: string | null) {
    const bar = document.createElement('div'); bar.className = 'wt-create';
    bar.append(button(l.newNote, () => void run(() => actions.createNote(parentId))), button(l.newFolder, () => {
      const name = window.prompt(l.newFolder)?.trim();
      if (name) void run(() => actions.createFolder(parentId, name));
    })); return bar;
  }
  function level(nodes: TreeNode[], parentId: string | null): HTMLUListElement {
    const ul = document.createElement('ul');
    for (const node of nodes) {
      const item = node.kind === 'folder' ? node.folder : node.note;
      const title = node.kind === 'folder' ? node.folder.name : node.note.title;
      const siblings = nodes.filter(n => n.kind === node.kind);
      const index = siblings.indexOf(node);
      const li = document.createElement('li'); const row = document.createElement('div'); row.className = 'wt-row';
      const label = button(title || l.newNote, () => {
        if (node.kind === 'note') opts.onOpenNote(item.id);
        else { details.open = !details.open; }
      });
      label.className = 'wt-label';
      if (node.kind === 'note' && opts.selectedNoteId === item.id) label.setAttribute('aria-current', 'page');
      row.append(label);
      if (opts.showVisibility) {
        const visibility = (item as TreeFolder & { effectiveVisibility?: string }).effectiveVisibility ?? item.visibility ?? 'private';
        const badge = document.createElement('small'); badge.textContent = l[visibility as Visibility] || l.private;
        row.append(badge);
      }
      const details = document.createElement('details');
      if (node.kind === 'folder') {
        details.open = !closed.has(item.id);
        const summary = document.createElement('summary'); summary.append(row); details.append(summary);
        label.addEventListener('click', e => e.preventDefault());
        details.addEventListener('toggle', () => {
          if (details.open) closed.delete(item.id); else closed.add(item.id);
          label.setAttribute('aria-expanded', String(details.open));
        });
        label.setAttribute('aria-expanded', String(details.open));
        if (opts.canManage) details.append(createButtons(item.id));
        details.append(level(node.children, item.id)); li.append(details);
      } else li.append(row);
      if (opts.canManage) {
        const menu = document.createElement('details'); menu.className = 'wt-actions';
        const summary = document.createElement('summary'); summary.textContent = '⋯'; summary.title = l.actions;
        const controls = document.createElement('div');
        controls.append(button(l.rename, () => {
          const name = window.prompt(l.rename, title)?.trim();
          if (name) void run(() => node.kind === 'folder' ? actions.renameFolder(item.id, name) : actions.renameNote(item.id, name));
        }), button(l.delete, () => {
          if (window.confirm(l.confirmDelete)) void run(() => node.kind === 'folder' ? actions.deleteFolder(item.id) : actions.deleteNote(item.id));
        }));
        for (const [label, delta] of [[l.up, -1], [l.down, 1]] as const) {
          const move = button(label, () => void run(() => actions.reorder(node.kind, item.id, parentId, index + delta)));
          move.disabled = index + delta < 0 || index + delta >= siblings.length; controls.append(move);
        }
        if (opts.showVisibility && actions.setVisibility) {
          const select = document.createElement('select'); select.setAttribute('aria-label', l.visibility);
          for (const v of ['', ...VISIBILITIES]) {
            const option = document.createElement('option'); option.value = v; option.textContent = v ? l[v as Visibility] : l.inherit; select.append(option);
          }
          select.value = item.visibility ?? '';
          select.addEventListener('change', () => void run(() => actions.setVisibility!(node.kind, item.id, (select.value || null) as Visibility | null)));
          controls.append(select);
        }
        menu.append(summary, controls); row.append(menu);
        label.draggable = true;
        label.addEventListener('dragstart', e => {
          dragged = { id: item.id, kind: node.kind, parentId }; e.dataTransfer?.setData('text/plain', item.id);
        });
        label.addEventListener('dragend', () => { dragged = null; });
        row.addEventListener('dragover', e => { if (dragged) { e.preventDefault(); e.stopPropagation(); } });
        row.addEventListener('drop', e => {
          e.preventDefault(); e.stopPropagation(); const d = dragged; dragged = null;
          if (!d || d.id === item.id) return;
          if (node.kind === 'folder' && d.kind === 'note') {
            const count = node.children.filter(n => n.kind === 'note' && n.note.id !== d.id).length;
            void run(() => actions.reorder('note', d.id, item.id, count));
          } else if (d.kind === node.kind && (d.kind === 'note' || d.parentId === parentId)) {
            const before = siblings.slice(0, index).filter(n => (n.kind === 'note' ? n.note.id : n.folder.id) !== d.id).length;
            void run(() => actions.reorder(d.kind, d.id, parentId, before));
          }
        });
      }
      ul.append(li);
    }
    return ul;
  }
  async function refresh() {
    const current = ++generation; status.textContent = l.loading;
    try {
      const data = await opts.load(); if (!alive || current !== generation) return;
      content.replaceChildren(); if (opts.canManage) content.append(createButtons(null));
      const nodes = buildTree(data.folders, data.notes, opts.locale);
      content.append(level(nodes, null)); status.textContent = nodes.length ? '' : l.empty;
    } catch { if (alive && current === generation) status.textContent = l.error; }
  }
  return { refresh, destroy() { alive = false; ++generation; container.replaceChildren(); } };
}
