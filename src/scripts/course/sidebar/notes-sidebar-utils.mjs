// Pure utility functions mirrored from notes-sidebar.ts for Node test runner

export function groupByChapter(notes) {
  const map = new Map();
  for (const note of notes) {
    const ch = note.chapter || '(sin capítulo)';
    if (!map.has(ch)) map.set(ch, []);
    map.get(ch).push(note);
  }
  return Array.from(map.entries())
    .map(([name, notes]) => ({
      name,
      notes: [...notes].sort((a, b) => a.order - b.order || (a.title ?? '').localeCompare(b.title ?? '')),
    }))
    .sort((a, b) => {
      const minA = Math.min(...a.notes.map(n => n.order));
      const minB = Math.min(...b.notes.map(n => n.order));
      return minA - minB || a.name.localeCompare(b.name);
    });
}

export function computeNewOrders(notesInChapter, draggedSlug, insertAfterSlug) {
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

export function noteSlugToRelPath(slug, courseId) {
  const relPath = slug.replace(`cursos/${courseId}/`, '').replace(/\.md$/, '');
  return relPath.split('/').map(seg =>
    seg.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '-').toLowerCase()
  ).join('/');
}

export function slugify(title) {
  return title.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-');
}
