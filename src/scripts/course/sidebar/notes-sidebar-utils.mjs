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
      const getMinOrder = (name, notesList) => {
        const matchDigits = name.trim().match(/^(\d+)/);
        const fallbackFromTitle = matchDigits ? parseInt(matchDigits[1], 10) : null;
        const isSystemOrGlobal = (fallbackFromTitle !== null && fallbackFromTitle >= 70) ||
                                 name.toUpperCase().includes('RECURSOS') ||
                                 name.toUpperCase().includes('NOTAS') ||
                                 (notesList.length > 0 && notesList.every(n => n.order === 0));
        if (isSystemOrGlobal && fallbackFromTitle !== null) {
          return fallbackFromTitle;
        }
        if (notesList.length > 0) {
          return Math.min(...notesList.map(n => n.order));
        }
        if (fallbackFromTitle !== null) return fallbackFromTitle;
        const nameUpper = name.toUpperCase();
        if (nameUpper.includes('RECURSOS')) return 80;
        if (nameUpper.includes('NOTAS')) return 90;
        return 9999;
      };
      return getMinOrder(a.name, a.notes) - getMinOrder(b.name, b.notes) || a.name.localeCompare(b.name);
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

export function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
