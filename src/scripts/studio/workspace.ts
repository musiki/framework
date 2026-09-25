import { renderTree, type TreeLabels } from '../../lib/writing/tree/render';
import type { TreeFolder, TreeNote } from '../../lib/writing/tree/model';

for (const container of document.querySelectorAll<HTMLElement>('[data-studio-tree]')) {
  const spaceId = container.dataset.space!;
  const labels = JSON.parse(container.dataset.labels!) as TreeLabels;
  const base = '/api/studio/notes';
  async function request<T>(path: string, method = 'GET', payload?: Record<string, unknown>): Promise<T> {
    const url = new URL(path, window.location.origin); url.searchParams.set('spaceId', spaceId);
    const res = await fetch(url, { method, headers: payload ? { 'Content-Type': 'application/json' } : undefined,
      body: payload ? JSON.stringify({ ...payload, spaceId }) : undefined });
    if (!res.ok) throw new Error(labels.error);
    return res.json() as Promise<T>;
  }
  const open = (id: string) => { window.location.href = `/studio/editor?space=${encodeURIComponent(spaceId)}&note=${encodeURIComponent(id)}`; };
  const tree = renderTree({ container, labels, locale: container.dataset.locale || 'en', canManage: container.dataset.role === 'author',
    showVisibility: true, selectedNoteId: new URLSearchParams(location.search).get('note'),
    load: () => request<{ folders: TreeFolder[]; notes: TreeNote[] }>(base), onOpenNote: open,
    actions: {
      async createNote(folderId) {
        const title = window.prompt(labels.newNote)?.trim(); if (!title) return;
        const data = await request<{ note: { id: string } }>(base, 'POST', { title, folderId, lang: 'en' }); open(data.note.id);
      },
      async createFolder(parentId, name) { await request(`${base}/folders`, 'POST', { parentId, name }); },
      async renameNote(id, title) { await request(base, 'PATCH', { id, title }); },
      async renameFolder(id, name) { await request(`${base}/folders`, 'PATCH', { id, name }); },
      async deleteNote(id) { await request(`${base}?id=${encodeURIComponent(id)}`, 'DELETE'); },
      async deleteFolder(id) { await request(`${base}/folders?id=${encodeURIComponent(id)}`, 'DELETE'); },
      async reorder(kind, id, parentId, targetIndex) { await request(`${base}/reorder`, 'POST', { kind, id, parentId, targetIndex }); },
      async setVisibility(kind, id, visibility) { await request(kind === 'note' ? base : `${base}/folders`, 'PATCH', { id, visibility }); },
    },
  });
  void tree.refresh();
  window.addEventListener('pagehide', () => tree.destroy(), { once: true });
}
