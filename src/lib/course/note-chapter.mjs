// El capítulo de una nota tal como lo arma el árbol de autor: el `chapter` del
// frontmatter; si no hay, la carpeta (de la materia, o la de public/ para los
// conceptos globales); sin carpeta, la raíz (''). El Recorrido de Progreso lo
// usa como separador de secciones entre círculos.

const leadingOrder = (value) => {
  const match = String(value || '').trim().match(/^(\d+)/);
  return match ? Number(match[1]) : 999;
};

export function humanizeChapter(value) {
  const clean = String(value || '')
    .replace(/^\d+[\s._-]*/, '')
    .replace(/[-_]+/g, ' ')
    .trim()
    .toLowerCase();
  return clean ? clean.charAt(0).toUpperCase() + clean.slice(1) : '';
}

/** { id, label, order } para un nodo de build-graph-data ({ id, chapter, publicFolder }). */
export function chapterForNode(node, courseId) {
  const explicit = String(node?.chapter || '').trim();
  if (explicit) return { id: explicit, label: humanizeChapter(explicit), order: leadingOrder(explicit) };

  const parts = String(node?.id || '').split('/').filter(Boolean);
  let folder = '';
  if (parts[0] === 'public') {
    folder = node?.publicFolder || (parts.length > 2 ? parts[1] : '');
  } else {
    const courseIndex = parts.indexOf(courseId);
    const relative = courseIndex >= 0 ? parts.slice(courseIndex + 1) : parts;
    folder = relative.length > 1 ? relative[0] : '';
  }
  return { id: folder, label: humanizeChapter(folder), order: folder ? leadingOrder(folder) : -1 };
}
