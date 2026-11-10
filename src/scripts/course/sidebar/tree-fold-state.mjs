// Estado plegado/desplegado del árbol de la sidebar izquierda, por persona y por
// materia. Todo arranca plegado salvo lo que la persona dejó abierto y el camino
// hasta la nota que está leyendo. Recursos tiene su propio estado y no se toca;
// la raíz (notas sin capítulo) no tiene título y está siempre abierta.

const STORAGE_PREFIX = 'musiki:tree-open:';
const FOLDABLE = 'details.chapter-details, details.recursos-sidebar-folder';
const ACTIVE_LINK = 'a[aria-current="page"], a.active';

const storageKey = (courseId) => `${STORAGE_PREFIX}${courseId || 'global'}`;

/** Lo guardado, tolerante a basura: siempre un Set de claves. */
export function parseOpenState(raw) {
  try {
    const parsed = JSON.parse(raw || '[]');
    return new Set(Array.isArray(parsed) ? parsed.filter((k) => typeof k === 'string') : []);
  } catch {
    return new Set();
  }
}

/** Clave de un nodo: los títulos de sus ancestros plegables, de afuera hacia adentro. */
export function foldKeyFromTitles(titles) {
  // Sin los glifos de adelante (▸, ⊟…): la clave es el nombre, no el dibujo.
  return titles
    .map((t) => String(t || '').replace(/\s+/g, ' ').trim().replace(/^[^\p{L}\p{N}]+/u, ''))
    .filter(Boolean)
    .join(' / ');
}

const titleOf = (details) => {
  const summary = details.querySelector(':scope > summary');
  const text = summary?.querySelector('.chapter-title-text')?.textContent ?? summary?.textContent ?? '';
  return text;
};

function foldKeyOf(details, root) {
  const titles = [];
  for (let node = details; node && node !== root; node = node.parentElement?.closest(FOLDABLE) ?? null) {
    if (!root.contains(node)) break;
    titles.unshift(titleOf(node));
  }
  return foldKeyFromTitles(titles);
}

const foldables = (root) =>
  Array.from(root.querySelectorAll(FOLDABLE)).filter((d) => !d.closest('.chapter--recursos, .chapter--root'));

function readOpen(courseId) {
  try { return parseOpenState(window.localStorage.getItem(storageKey(courseId))); } catch { return new Set(); }
}

function writeOpen(courseId, open) {
  try { window.localStorage.setItem(storageKey(courseId), JSON.stringify([...open])); } catch { /* sin storage */ }
}

/** Guarda lo que está abierto ahora. Se llama después de cada pliegue de la persona. */
export function rememberTreeFold(root, courseId) {
  if (!root) return;
  // Sólo se actualizan los nodos de este árbol: el de la docencia y el de
  // estudiantes comparten la clave y uno no borra lo del otro.
  const open = readOpen(courseId);
  for (const details of foldables(root)) {
    const key = foldKeyOf(details, root);
    if (details.open) open.add(key); else open.delete(key);
  }
  writeOpen(courseId, open);
}

/** Guarda un solo nodo: con varias pestañas abiertas, un pliegue no pisa los de las otras. */
function rememberOne(details, root, courseId) {
  const open = readOpen(courseId);
  const key = foldKeyOf(details, root);
  if (details.open) open.add(key); else open.delete(key);
  writeOpen(courseId, open);
}

const bound = new WeakSet();

/**
 * Pliega el árbol según lo guardado: abierto sólo lo que la persona dejó abierto
 * y el camino a la nota activa. Idempotente: se puede llamar en cada render.
 */
export function applyTreeFoldState(root, courseId) {
  if (!root) return;
  const open = readOpen(courseId);
  for (const details of foldables(root)) {
    const holdsActive = Boolean(details.querySelector(ACTIVE_LINK));
    details.open = holdsActive || open.has(foldKeyOf(details, root));
    if (bound.has(details)) continue;
    bound.add(details);
    // Sólo los pliegues de la persona se guardan; los que hace el código no.
    details.querySelector(':scope > summary')?.addEventListener('click', () => {
      window.setTimeout(() => rememberOne(details, root, courseId), 0);
    });
  }
}
