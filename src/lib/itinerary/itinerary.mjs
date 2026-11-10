// El itinerario de una cohorte: la lista ordenada de paradas que arma el docente
// en Progreso. Vive en la base (tabla "Itinerary", una fila por cohorte) y no en
// el repo de la materia: Obsidian genera el contenido, musiki ordena la cursada
// (plan de itinerario, sección 18).
//
// Una parada tiene nombre, kind y notas. El reservorio no es un campo: son las
// notas de la materia que ninguna parada referencia (sección 10).

/** Los cinco kinds de la sección 9 del plan. El orden es el de la UI. */
export const ITINERARY_KINDS = [
  { id: 'concepto', label: 'Concepto', icon: '◆' },
  { id: 'protocolo', label: 'Protocolo', icon: '≡' },
  { id: 'clase', label: 'Clase', icon: '●' },
  { id: 'assignment', label: 'Assignment', icon: '▲' },
  { id: 'output', label: 'Output', icon: '■' },
];

const KIND_IDS = new Set(ITINERARY_KINDS.map((k) => k.id));

/** El `type` del frontmatter agrupado en un kind; '' si es recurso de apoyo. */
const KIND_BY_NOTE_TYPE = {
  concept: 'concepto',
  glossary: 'concepto',
  info: 'protocolo',
  note: 'protocolo',
  lesson: 'clase',
  'lesson-presentation': 'clase',
  assignment: 'assignment',
  eval: 'assignment',
  obra: 'output',
  work: 'output',
  proyecto: 'output',
};

export function kindForNoteType(type) {
  return KIND_BY_NOTE_TYPE[String(type || '').trim().toLowerCase()] || '';
}

export const MAX_STOPS = 200;
export const MAX_NOTES_PER_STOP = 50;
export const MAX_TITLE_LENGTH = 120;

const cleanSlug = (value) => String(value || '').trim().replace(/^\/+|\/+$/g, '').replace(/\.mdx?$/i, '');

/** Clave de comparación de un slug: sin la materia adelante y en minúsculas. */
export function slugKey(slug, courseId = '') {
  const clean = cleanSlug(slug).toLowerCase();
  const prefix = `${String(courseId || '').toLowerCase()}/`;
  return courseId && clean.startsWith(prefix) ? clean.slice(prefix.length) : clean;
}

let idCounter = 0;
export function newStopId() {
  idCounter = (idCounter + 1) % 1e6;
  return `p${Date.now().toString(36)}${idCounter.toString(36)}`;
}

/**
 * Valida y normaliza la lista que manda la UI. Devuelve { ok, stops } o
 * { ok: false, error }. Lo que no se puede arreglar es error; lo que sí
 * (espacios, notas repetidas en una parada) se arregla en silencio.
 */
export function normalizeStops(input) {
  if (!Array.isArray(input)) return { ok: false, error: 'El itinerario tiene que ser una lista de paradas.' };
  if (input.length > MAX_STOPS) return { ok: false, error: `Un itinerario admite hasta ${MAX_STOPS} paradas.` };

  const seenIds = new Set();
  const stops = [];
  for (const [index, raw] of input.entries()) {
    if (!raw || typeof raw !== 'object') return { ok: false, error: `La parada ${index + 1} está vacía.` };
    const title = String(raw.title || '').replace(/\s+/g, ' ').trim();
    if (!title) return { ok: false, error: `La parada ${index + 1} no tiene nombre.` };
    if (title.length > MAX_TITLE_LENGTH) {
      return { ok: false, error: `El nombre de la parada ${index + 1} pasa de ${MAX_TITLE_LENGTH} caracteres.` };
    }
    const kind = String(raw.kind || '').trim();
    if (!KIND_IDS.has(kind)) return { ok: false, error: `La parada «${title}» tiene un kind desconocido.` };

    let id = String(raw.id || '').trim();
    if (!/^[a-z0-9_-]{1,40}$/i.test(id) || seenIds.has(id)) id = newStopId();
    seenIds.add(id);

    const notes = [];
    for (const slug of Array.isArray(raw.notes) ? raw.notes : []) {
      const clean = cleanSlug(slug);
      if (clean && !notes.includes(clean)) notes.push(clean);
    }
    if (notes.length > MAX_NOTES_PER_STOP) {
      return { ok: false, error: `La parada «${title}» pasa de ${MAX_NOTES_PER_STOP} notas.` };
    }
    stops.push({ id, title, kind, notes });
  }
  return { ok: true, stops };
}

/** Las notas de la materia que ninguna parada referencia, en el orden recibido. */
export function reservoirOf(notes, stops, courseId = '') {
  const used = new Set();
  for (const stop of stops || []) {
    for (const slug of stop.notes || []) used.add(slugKey(slug, courseId));
  }
  return (notes || []).filter((note) => !used.has(slugKey(note.slug, courseId)));
}

/** Una parada nueva a partir de una nota: toma su título y el kind de su type. */
export function stopFromNote(note) {
  return {
    id: newStopId(),
    title: String(note?.title || cleanSlug(note?.slug).split('/').pop() || 'Parada').slice(0, MAX_TITLE_LENGTH),
    kind: kindForNoteType(note?.type) || 'clase',
    notes: note?.slug ? [cleanSlug(note.slug)] : [],
  };
}
