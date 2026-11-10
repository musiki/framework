// Dónde está el estudiante sobre el itinerario (paso C del plan de itinerario).
// Cruza las paradas del docente con el estado de cada nota que trae el pod
// (/api/progress/pod) y con la nota que se está leyendo.
//
// Las notas llegan con slugs de forma distinta según de dónde vengan:
// `sesgo-de-confirmacion`, `public/11-sesgos/sesgo-de-confirmacion`,
// `cursos/s123/Forma`. Se comparan por la última parte, normalizada.

import { isStructural } from './itinerary.mjs';

export function noteKey(value) {
  return String(value || '')
    .split(/[?#]/, 1)[0]
    .split('/')
    .filter(Boolean)
    .pop()
    ?.replace(/\.(md|mdx)$/i, '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || '';
}

/** 0 no leído · 1 leído · 2 completado · 3 evaluado (la escala del pod). */
export function conceptState(concept) {
  if (concept?.evaluated) return 3;
  if (concept?.completed) return 2;
  if (concept?.read) return 1;
  return 0;
}

function indexConcepts(concepts) {
  const byKey = new Map();
  for (const concept of concepts || []) {
    for (const value of [concept.slug, concept.id, concept.pageSlug]) {
      const key = noteKey(value);
      if (key && !byKey.has(key)) byKey.set(key, concept);
    }
  }
  return byKey;
}

/**
 * Las paradas con sus notas resueltas y el estado de cada una:
 *  - done: todas sus notas completadas (o sin notas y ya pasada)
 *  - current: la que tiene la nota activa; si ninguna, la primera sin terminar
 *  - upcoming: el resto
 * Devuelve { stops: [{ stop, items, state }], currentIndex }.
 */
export function resolveRoute(stops, concepts, activeSlug = '') {
  const byKey = indexConcepts(concepts);
  const activeKey = noteKey(activeSlug);
  const resolved = (stops || []).map((stop) => {
    const items = (stop.notes || []).map((slug) => {
      const key = noteKey(slug);
      return byKey.get(key) ?? { id: slug, slug: key, name: key.replace(/-/g, ' '), placeholder: true };
    });
    const complete = items.length > 0 && items.every((item) => conceptState(item) >= 2);
    const holdsActive = Boolean(activeKey) && (stop.notes || []).some((slug) => noteKey(slug) === activeKey);
    return { stop, items, complete, holdsActive };
  });

  // Las paradas de estructura (bifurcación, vuelta al tronco) no son destino.
  const eligible = (r) => !isStructural(r.stop);
  let currentIndex = resolved.findIndex((r) => r.holdsActive);
  if (currentIndex < 0) currentIndex = resolved.findIndex((r) => eligible(r) && !r.complete);
  if (currentIndex < 0) currentIndex = resolved.findLastIndex(eligible);

  return {
    currentIndex,
    stops: resolved.map((r, index) => ({
      stop: r.stop,
      items: r.items,
      state: isStructural(r.stop) ? 'structure'
        : index === currentIndex ? 'current'
        : (r.complete || index < currentIndex && r.items.length === 0 ? 'done' : 'upcoming'),
    })),
  };
}

/** Índices visibles: todos, o en la vista plegada la actual y sus vecinas. */
export function visibleStopIndexes(total, currentIndex, folded) {
  const all = Array.from({ length: Math.max(0, total) }, (_, i) => i);
  if (!folded || currentIndex < 0) return all;
  return all.filter((i) => Math.abs(i - currentIndex) <= 1);
}

/**
 * Los gajos del aro de una parada (como los de un círculo de Duolingo): sus
 * notas. Una parada de una sola nota que tiene hijas por `hypo:` (o notas que
 * la declaran `hyper:`) se parte en esas hijas: una clase con sus conceptos.
 */
export function sliceItems(items, concepts, edges) {
  if (!Array.isArray(items) || items.length !== 1 || items[0]?.placeholder) return items || [];
  const parentId = items[0].id;
  const byId = new Map((concepts || []).map((c) => [c.id, c]));
  const childIds = [];
  for (const edge of edges || []) {
    if (edge?.type !== 'rel') continue;
    const child = edge.relType === 'hypo' && edge.source === parentId
      ? edge.target
      : (edge.relType === 'hyper' && edge.target === parentId ? edge.source : null);
    if (child && child !== parentId && byId.has(child) && !childIds.includes(child)) childIds.push(child);
  }
  return childIds.length ? childIds.map((id) => byId.get(id)) : items;
}

/**
 * Las paradas como bloques para dibujar: una parada del tronco, o una
 * bifurcación con sus ramas (en el orden en que aparece cada letra) hasta la
 * vuelta al tronco. Trabaja sobre índices de la lista original.
 */
export function routeBlocks(stops) {
  const blocks = [];
  let fork = null;
  (stops || []).forEach((stop, index) => {
    if (stop?.kind === 'bifurcacion') {
      fork = { type: 'fork', fork: index, union: -1, branches: [] };
      blocks.push(fork);
    } else if (stop?.kind === 'union' && fork) {
      fork.union = index;
      fork = null;
    } else if (fork) {
      const label = stop?.branch || 'A';
      let branch = fork.branches.find((b) => b.label === label);
      if (!branch) fork.branches.push(branch = { label, indexes: [] });
      branch.indexes.push(index);
    } else {
      blocks.push({ type: 'stop', index });
    }
  });
  return blocks;
}
