// El Connectoma del pod Progreso: el grafo de la materia visto desde la nota que
// se está leyendo. La profundidad va de 1 (sólo sus vecinos) a 5 (el mapa entero).

export const MIN_DEPTH = 1;
export const MAX_DEPTH = 5;

export function clampDepth(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return 2;
  return Math.min(MAX_DEPTH, Math.max(MIN_DEPTH, n));
}

const endpoint = (value) => (value && typeof value === 'object' ? value.id : value);

/**
 * Un hub (una nota índice que enlaza a casi todo, como «Temas de seminarios»)
 * aparece como vecino pero no se expande: si no, en dos saltos trae el mapa
 * entero. Es hub con más de 20 aristas y más de un cuarto de las notas.
 */
export function isHub(degree, total) {
  return degree > 20 && degree > total / 4;
}

/**
 * Los ids a no más de `depth` saltos de los de inicio, siguiendo aristas en
 * los dos sentidos y sin atravesar hubs (salvo el de inicio). Con depth
 * máximo, o sin inicio conocido, son todos.
 */
export function neighborhood(nodeIds, edges, startIds, depth) {
  const all = new Set(nodeIds);
  const level = clampDepth(depth);
  const starts = (startIds || []).filter((id) => all.has(id));
  if (level >= MAX_DEPTH || starts.length === 0) return all;

  const adjacency = new Map();
  for (const edge of edges || []) {
    const a = endpoint(edge.source);
    const b = endpoint(edge.target);
    if (!all.has(a) || !all.has(b) || a === b) continue;
    if (!adjacency.has(a)) adjacency.set(a, []);
    if (!adjacency.has(b)) adjacency.set(b, []);
    adjacency.get(a).push(b);
    adjacency.get(b).push(a);
  }

  const startSet = new Set(starts);
  const expands = (id) => startSet.has(id) || !isHub((adjacency.get(id) || []).length, all.size);
  const seen = new Set(starts);
  let frontier = starts;
  for (let hop = 0; hop < level && frontier.length; hop++) {
    const next = [];
    for (const id of frontier) {
      if (!expands(id)) continue;
      for (const neighbor of adjacency.get(id) || []) {
        if (!seen.has(neighbor)) {
          seen.add(neighbor);
          next.push(neighbor);
        }
      }
    }
    frontier = next;
  }
  return seen;
}
