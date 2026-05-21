import type { NoteListItem } from './types';

export type TreeCallbacks = {
  onSelect: (slug: string) => void;
  onCreate: (chapter: string) => void;
  onDelete: (slug: string) => void;
  onRename: (slug: string) => void;
  onOrderChange: (slug: string, newOrder: number, newChapter: string) => void;
};

type ChapterGroup = { name: string; notes: NoteListItem[] };

function groupByChapter(notes: NoteListItem[]): ChapterGroup[] {
  const map = new Map<string, NoteListItem[]>();
  for (const note of notes) {
    const ch = note.chapter || '(sin capítulo)';
    if (!map.has(ch)) map.set(ch, []);
    map.get(ch)!.push(note);
  }
  return Array.from(map.entries())
    .map(([name, notes]) => ({ name, notes: notes.sort((a, b) => a.order - b.order) }))
    .sort((a, b) => {
      const minA = Math.min(...a.notes.map(n => n.order));
      const minB = Math.min(...b.notes.map(n => n.order));
      return minA - minB || a.name.localeCompare(b.name);
    });
}

function noteIcon(type: string): string {
  if (type === 'eval' || type === 'assignment') return '📝';
  if (type === 'info') return 'ℹ️';
  if (type === 'public-note') return '🌐';
  return '📄';
}

let contextMenuEl: HTMLElement | null = null;

function closeContextMenu() {
  contextMenuEl?.remove();
  contextMenuEl = null;
}

function showContextMenu(
  x: number, y: number,
  items: { label: string; action: () => void; danger?: boolean }[]
) {
  closeContextMenu();
  const menu = document.createElement('div');
  menu.style.cssText = `
    position:fixed;left:${x}px;top:${y}px;
    background:var(--c-bg-surface,var(--c-bg-mute));border:1px solid var(--c-border);border-radius:4px;
    padding:3px 0;z-index:9999;min-width:140px;box-shadow:0 4px 12px rgba(0,0,0,.4);
  `;
  for (const item of items) {
    const el = document.createElement('div');
    el.textContent = item.label;
    el.style.cssText = `padding:4px 12px;font-size:11px;cursor:pointer;color:${item.danger ? '#c87e7e' : 'var(--c-fg)'};`;
    el.addEventListener('mouseenter', () => { el.style.background = 'var(--c-bg-alt,var(--c-bg-mute))'; });
    el.addEventListener('mouseleave', () => { el.style.background = ''; });
    el.addEventListener('click', () => { closeContextMenu(); item.action(); });
    menu.appendChild(el);
  }
  contextMenuEl = menu;
  document.body.appendChild(menu);
}

document.addEventListener('click', closeContextMenu);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeContextMenu(); });

export function renderTree(
  container: HTMLElement,
  notes: NoteListItem[],
  activeSlug: string | null,
  cb: TreeCallbacks
) {
  container.innerHTML = '';
  const groups = groupByChapter(notes);

  for (const group of groups) {
    const header = document.createElement('div');
    header.style.cssText = 'padding:.25rem .7rem;font-size:9px;color:var(--c-fg-subtle);opacity:.7;text-transform:uppercase;letter-spacing:.05em;margin-top:.4rem;display:flex;align-items:center;gap:.3rem;';
    header.textContent = group.name;

    const newInChapter = document.createElement('button');
    newInChapter.textContent = '+';
    newInChapter.title = `Nueva nota en "${group.name}"`;
    newInChapter.style.cssText = 'background:none;border:none;color:var(--c-link);cursor:pointer;font-size:10px;padding:0 2px;margin-left:auto;opacity:.6;';
    newInChapter.addEventListener('click', e => { e.stopPropagation(); cb.onCreate(group.name); });
    header.appendChild(newInChapter);
    container.appendChild(header);

    for (const note of group.notes) {
      const row = document.createElement('div');
      const isActive = note.slug === activeSlug;
      row.style.cssText = `padding:.2rem .7rem .2rem 1.2rem;display:flex;gap:.3rem;align-items:center;cursor:pointer;font-size:11px;${isActive ? 'background:var(--c-bg-alt,var(--c-bg-mute));border-left:2px solid var(--c-link);color:var(--c-link);' : 'color:var(--c-fg-dim);border-left:2px solid transparent;'}`;
      row.setAttribute('draggable', 'true');
      row.dataset.slug = note.slug;

      const icon = document.createElement('span');
      icon.textContent = noteIcon(note.type);
      const label = document.createElement('span');
      label.textContent = note.title;
      row.appendChild(icon);
      row.appendChild(label);

      row.addEventListener('click', () => cb.onSelect(note.slug));
      row.addEventListener('contextmenu', e => {
        e.preventDefault();
        showContextMenu(e.clientX, e.clientY, [
          { label: 'Renombrar slug', action: () => cb.onRename(note.slug) },
          { label: 'Eliminar', action: () => cb.onDelete(note.slug), danger: true },
        ]);
      });

      row.addEventListener('dragstart', e => {
        e.dataTransfer!.setData('text/plain', note.slug);
        e.dataTransfer!.effectAllowed = 'move';
        row.style.opacity = '.4';
      });
      row.addEventListener('dragend', () => { row.style.opacity = ''; });

      container.appendChild(row);
    }
  }
}
