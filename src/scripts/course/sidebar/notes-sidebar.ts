import type { NoteListItem } from '../../notes-editor/types';

export type ChapterGroup = { name: string; notes: NoteListItem[] };

export function groupByChapter(notes: NoteListItem[]): ChapterGroup[] {
  const map = new Map<string, NoteListItem[]>();
  for (const note of notes) {
    const ch = note.chapter || '(sin capítulo)';
    if (!map.has(ch)) map.set(ch, []);
    map.get(ch)!.push(note);
  }
  return Array.from(map.entries())
    .map(([name, notes]) => ({
      name,
      notes: [...notes].sort((a, b) => a.order - b.order || a.title.localeCompare(b.title)),
    }))
    .sort((a, b) => {
      const minA = Math.min(...a.notes.map(n => n.order));
      const minB = Math.min(...b.notes.map(n => n.order));
      return minA - minB || a.name.localeCompare(b.name);
    });
}

export function computeNewOrders(
  notesInChapter: NoteListItem[],
  draggedSlug: string,
  insertAfterSlug: string | null,
): { slug: string; order: number }[] {
  const withoutDragged = notesInChapter.filter(n => n.slug !== draggedSlug);
  const dragged = notesInChapter.find(n => n.slug === draggedSlug);
  if (!dragged) return [];
  const insertIdx = insertAfterSlug === null
    ? 0
    : withoutDragged.findIndex(n => n.slug === insertAfterSlug) + 1;
  const reordered = [
    ...withoutDragged.slice(0, insertIdx),
    dragged,
    ...withoutDragged.slice(insertIdx),
  ];
  return reordered.map((n, i) => ({ slug: n.slug, order: i }));
}

// slug = "cursos/s123/10 Chapter/note.md", courseId = "s123"
// Returns the URL path segment after the courseId prefix, without extension
// e.g. "10 Chapter/note.md" -> "10-chapter/note"
export function noteSlugToRelPath(slug: string, courseId: string): string {
  const relPath = slug.replace(`cursos/${courseId}/`, '').replace(/\.md$/, '');
  return relPath
    .split('/')
    .map(seg =>
      seg.normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/\s+/g, '-')
        .toLowerCase(),
    )
    .join('/');
}

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

export function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
