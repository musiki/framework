// Funciones puras y convención de capítulos de la sidebar de notas.
//
// Esto era un espejo a mano de notes-sidebar.ts, mantenido sólo para que el test
// runner de Node pudiera importarlo. Dos copias de la misma lógica: los tests
// pasaban en verde mientras el runtime usaba otra versión. Ahora es la única
// fuente y el .ts importa de acá, como ya hace publish.ts con los .mjs de lilypond.

import { noteRelPathKey } from '../../../lib/course/note-path.mjs';

/**
 * Convención de capítulos.
 *
 * Estaba repartida en cinco lugares del .ts: los nombres reservados escritos con
 * subconjuntos distintos en cada sitio, un umbral numérico —a partir de 70 un
 * capítulo se trata como «de sistema»— que no figuraba en ninguna documentación,
 * un `if (courseId === 's123')` suelto, y dos copias del criterio de orden que ya
 * diferían entre sí.
 *
 * Es el paso previo a moverla a configuración por materia: cuando eso pase, hay un
 * solo lugar que tocar y la forma del objeto ya es la que va a tener el config.
 *
 * Importante: esto gobierna cómo se *ordena y pinta* un capítulo, no si existe. Los
 * capítulos salen del contenido, así que cambiar algo acá no hace desaparecer a
 * ninguno.
 */
export const CHAPTER_CONVENTION = {
  /** Índices, no recorridos: no se reordenan notas adentro ni aceptan drops. */
  global: ['CONCEPTOS', 'INSTRUMENTOS', 'SPEAKERS', 'GLOSARIO'],
  /** Desde este prefijo numérico, el capítulo se ordena como de sistema, al final. */
  systemOrderFrom: 70,
  /** Capítulos que la sidebar crea si la materia no los trae. */
  virtual: [
    {
      match: 'RECURSOS', name: '80 RECURSOS', order: 80, courses: null,
    },
    {
      match: 'AMIGX', name: '85 AMIGX CRÍTICX', order: 85, courses: ['s123'],
    },
    {
      match: 'NOTAS', name: '90 NOTAS', order: 90, courses: null,
    },
  ],
  /** Capítulos que se dibujan como árbol jerárquico en vez de lista plana. */
  treeView: ['CONCEPTOS'],
  /** Clase CSS extra por capítulo, para color e ícono. */
  styles: [
    { match: 'CONCEPTOS', className: 'chapter--conceptos' },
    { match: 'RECURSOS', className: 'chapter--recursos' },
    { match: 'AMIGX', className: 'chapter--amigxcriticx' },
    { match: 'NOTAS', className: 'chapter--notas' },
  ],
};

const chapterUpper = (name) => String(name || '').toUpperCase();

/** Un capítulo global es un índice: se lee, no se reordena. */
export function isGlobalChapter(name) {
  return CHAPTER_CONVENTION.global.some((word) => chapterUpper(name).includes(word));
}

/** Prefijo numérico del capítulo, o null si no tiene. */
export function chapterNumber(name) {
  const match = String(name || '').trim().match(/^(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

/** La entrada de capítulo virtual que corresponde a este nombre, si hay. */
export function virtualChapterFor(name) {
  return CHAPTER_CONVENTION.virtual.find((v) => chapterUpper(name).includes(v.match)) || null;
}

/** Capítulos virtuales que corresponden a esta materia. */
export function virtualChaptersFor(courseId) {
  return CHAPTER_CONVENTION.virtual.filter((v) => !v.courses || v.courses.includes(courseId));
}

/** Clases CSS extra del capítulo, según la convención. */
export function chapterClassNames(name) {
  return CHAPTER_CONVENTION.styles
    .filter((s) => chapterUpper(name).includes(s.match))
    .map((s) => s.className);
}

/** Este capítulo se dibuja como árbol jerárquico, no como lista. */
export function chapterRendersAsTree(name) {
  return CHAPTER_CONVENTION.treeView.some((word) => chapterUpper(name).includes(word));
}

/** Clave de orden de un capítulo. Una sola implementación, usada en los dos sitios. */
export function chapterSortKey(name, notes) {
  if (name === ROOT_CHAPTER) return -Infinity;
  const prefix = chapterNumber(name);
  const virtual = virtualChapterFor(name);
  const esDeSistema =
    (prefix !== null && prefix >= CHAPTER_CONVENTION.systemOrderFrom) ||
    virtual !== null ||
    (notes.length > 0 && notes.every((n) => n.order === 0));
  if (esDeSistema && prefix !== null) return prefix;
  if (notes.length > 0) return Math.min(...notes.map((n) => n.order));
  if (prefix !== null) return prefix;
  return virtual ? virtual.order : 9999;
}

/**
 * Grupo de las notas sin capítulo. No lleva nombre ni carpeta: se dibuja en la
 * raíz de la sidebar, antes que los capítulos, como en el vault.
 */
export const ROOT_CHAPTER = '';

export function groupByChapter(notes) {
  const map = new Map();
  for (const note of notes) {
    const ch = note.chapter || ROOT_CHAPTER;
    if (!map.has(ch)) map.set(ch, []);
    map.get(ch).push(note);
  }
  return Array.from(map.entries())
    .map(([name, grouped]) => ({
      name,
      notes: [...grouped].sort(
        (a, b) => a.order - b.order || (a.title ?? '').localeCompare(b.title ?? ''),
      ),
    }))
    .sort((a, b) =>
      chapterSortKey(a.name, a.notes) - chapterSortKey(b.name, b.notes)
      || a.name.localeCompare(b.name));
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
  return noteRelPathKey(slug.replace(`cursos/${courseId}/`, ''));
}

export function slugify(title) {
  return title.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-');
}

export function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
