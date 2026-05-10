import { type ResourceType } from './metadata';

export type ResourceItem = {
  id: string;
  url: string;
  name: string;
  type: ResourceType | 'other';
  folder: string;
  source: 'upload' | 'chat' | 'external-media' | 'sa' | 'sv' | 'vs' | 'paste';
  createdBy: string;
  sortOrder: number;
  createdAt: string;
  sessionId?: string | null;
};

const TYPE_ICON: Record<string, { char: string; color: string }> = {
  pdf:   { char: '■', color: '#e06666' },
  img:   { char: '▪', color: '#76d3ff' },
  md:    { char: '■', color: '#45d384' },
  tex:   { char: '■', color: '#f6b26b' },
  ly:    { char: '♩', color: '#ffd966' },
  audio: { char: '♪', color: '#93c47d' },
  video: { char: '▶', color: '#76d3ff' },
  link:  { char: '⬡', color: '#8e7cc3' },
  other: { char: '·', color: '#666'    },
};

function iconFor(type: string): { char: string; color: string } {
  return TYPE_ICON[type] ?? TYPE_ICON.other;
}

const PINNED_FOLDERS = ['DOC', 'media', 'compartidos'];

export function foldersFromItems(items: ResourceItem[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const pinned of PINNED_FOLDERS) {
    if (items.some(i => i.folder === pinned)) {
      seen.add(pinned);
      result.push(pinned);
    }
  }
  for (const item of items) {
    if (item.folder && !seen.has(item.folder)) {
      seen.add(item.folder);
      result.push(item.folder);
    }
  }
  return result;
}

export function itemsInFolder(items: ResourceItem[], folder: string): ResourceItem[] {
  return items
    .filter(i => i.folder === folder)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt));
}

export function moveItem(items: ResourceItem[], id: string, targetFolder: string): ResourceItem[] {
  const targetItems = items.filter(i => i.folder === targetFolder);
  const maxOrder = targetItems.reduce((m, i) => Math.max(m, i.sortOrder), -1);
  return items.map(item =>
    item.id === id
      ? { ...item, folder: targetFolder, sortOrder: maxOrder + 1 }
      : item
  );
}

export function removeItem(items: ResourceItem[], id: string): ResourceItem[] {
  return items.filter(i => i.id !== id);
}

export function addItem(items: ResourceItem[], item: ResourceItem): ResourceItem[] {
  const sessionId = item.sessionId ?? '';
  if (items.some(i => i.url === item.url && (i.sessionId ?? '') === sessionId && i.folder === item.folder)) return items;
  return [...items, item];
}

export function renderFiletree(
  container: HTMLElement,
  items: ResourceItem[],
  collapsedFolders: Set<string>,
  emptyFolders: Set<string>,
  options: {
    headerEl?: HTMLElement;
    canEdit?: boolean;
    onItemClick: (item: ResourceItem) => void;
    onItemContextMenu: (item: ResourceItem, e: MouseEvent) => void;
    onFolderContextMenu: (folder: string, e: MouseEvent) => void;
    onFolderToggle: (folder: string) => void;
    onDragStart: (id: string) => void;
    onDragOverFolder: (folder: string) => void;
    onDrop: (targetFolder: string) => void;
  },
) {
  container.innerHTML = '';

  if (options.headerEl) container.appendChild(options.headerEl);

  // Merge item-derived folders with explicitly created empty folders
  const itemFolders = foldersFromItems(items);
  const allEmpty = [...emptyFolders].filter(f => !itemFolders.includes(f));
  const folders = [...itemFolders, ...allEmpty];

  for (const folder of folders) {
    const isCollapsed = collapsedFolders.has(folder);
    const isAuto = folder === 'compartidos' || folder === 'media';
    const folderEl = document.createElement('div');
    folderEl.className = 're-folder';
    folderEl.dataset.folder = folder;

    const isDoc = folder === 'DOC';
    const isMedia = folder === 'media';
    const rowEl = document.createElement('div');
    rowEl.className = 're-folder-row';
    rowEl.innerHTML = `
      <span class="re-caret">${isCollapsed ? '▸' : '▾'}</span>
      <span class="re-folder-icon" style="color:${isDoc ? '#e06666' : isMedia ? '#93c47d' : isAuto ? '#6fa8dc' : '#555'}">${isDoc ? '□' : isMedia ? '♪' : isAuto ? '⊕' : '⊟'}</span>
      <span class="re-folder-name${isDoc || isMedia || isAuto ? ' re-folder-name--auto' : ''}" style="${isDoc ? 'color:#e06666' : isMedia ? 'color:#93c47d' : ''}">${escHtml(folder)}</span>
    `;
    rowEl.addEventListener('click', () => options.onFolderToggle(folder));
    rowEl.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); options.onFolderContextMenu(folder, e); });
    rowEl.addEventListener('dragover', (e) => { e.preventDefault(); options.onDragOverFolder(folder); });
    rowEl.addEventListener('drop', (e) => { e.preventDefault(); options.onDrop(folder); });
    folderEl.appendChild(rowEl);

    if (!isCollapsed) {
      const childrenEl = document.createElement('div');
      childrenEl.className = 're-folder-items';
      const folderItems = itemsInFolder(items, folder);
      for (const item of folderItems) {
        childrenEl.appendChild(buildItemEl(item, options));
      }
      folderEl.appendChild(childrenEl);
    }

    container.appendChild(folderEl);
  }

  const rootItems = itemsInFolder(items, '');
  for (const item of rootItems) {
    container.appendChild(buildItemEl(item, options));
  }

}

function buildItemEl(
  item: ResourceItem,
  options: Parameters<typeof renderFiletree>[4],
): HTMLElement {
  const { char, color } = iconFor(item.type);
  const canEdit = options.canEdit ?? true;
  const el = document.createElement('div');
  el.className = 're-item';
  el.dataset.itemId = item.id;
  el.draggable = canEdit;
  el.innerHTML = `
    <span class="re-item-icon" style="color:${color}">${char}</span>
    <span class="re-item-name" title="${escHtml(item.url)}">${escHtml(item.name)}</span>
  `;
  el.addEventListener('click', () => options.onItemClick(item));
  el.addEventListener('contextmenu', (e) => { e.preventDefault(); e.stopPropagation(); options.onItemContextMenu(item, e); });
  el.addEventListener('dragstart', () => options.onDragStart(item.id));
  return el;
}

function escHtml(s: string): string {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
