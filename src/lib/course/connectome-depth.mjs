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
 * Los ids a no más de `depth` saltos de los de inicio, siguiendo aristas en
 * los dos sentidos. Con depth máximo, o sin inicio conocido, son todos.
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

  const seen = new Set(starts);
  let frontier = starts;
  for (let hop = 0; hop < level && frontier.length; hop++) {
    const next = [];
    for (const id of frontier) {
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
