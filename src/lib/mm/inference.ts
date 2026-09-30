// Inference over asserted relations (spec "Inference (read-only, computed)").
// Pure: no db, no astro. Inferred relations are computed on read, never stored
// and never votable.
//
//  - transitive types: closure over the asserted relations of that one type,
//    breadth-first from every node, at most `maxDepth` hops (hard cap 6),
//    cycle-safe (a node is visited once per start). A pair that is already
//    asserted is never emitted again, and a node never relates to itself.
//  - symmetric types: a relation reads the same from both ends, so the closure
//    walks edges in both directions and a pair is emitted once (A–C, not also
//    C–A), and never when either direction is asserted.
//  - hierarchical types must stay acyclic: `wouldCloseCycle` / `hasCycle`.
//
// Node ids and type keys are opaque strings (concept ids or slugs, type slugs).

export type RelationLike = { source: string; target: string; type: string };
export type TypeProperties = { symmetric?: boolean; transitive?: boolean; hierarchical?: boolean };
export type InferredRelation = {
  source: string;
  target: string;
  type: string;
  inferred: true;
  /** Hops of the shortest supporting path (≥ 2). */
  depth: number;
  /** Indexes (into the input `relations`) of the asserted relations along that path, in order. */
  via: number[];
};

export const MAX_INFERENCE_DEPTH = 6;

type TypeLookup = Record<string, TypeProperties | undefined> | Map<string, TypeProperties>;
const typeOf = (types: TypeLookup, key: string): TypeProperties | undefined =>
  types instanceof Map ? types.get(key) : Object.prototype.hasOwnProperty.call(types, key) ? types[key] : undefined;

const pairKey = (a: string, b: string) => `${a.length}:${a}${b}`;

export function inferRelations(
  relations: readonly RelationLike[],
  types: TypeLookup,
  { maxDepth = MAX_INFERENCE_DEPTH }: { maxDepth?: number } = {},
): InferredRelation[] {
  const depthCap = Math.max(1, Math.min(MAX_INFERENCE_DEPTH, Math.floor(Number(maxDepth)) || MAX_INFERENCE_DEPTH));
  // Relations grouped by type, in order of first appearance.
  const byType = new Map<string, number[]>();
  relations.forEach((r, i) => {
    if (!typeOf(types, r.type)?.transitive || r.source === r.target) return;
    const list = byType.get(r.type);
    if (list) list.push(i);
    else byType.set(r.type, [i]);
  });

  const out: InferredRelation[] = [];
  for (const [type, indexes] of byType) {
    const symmetric = typeOf(types, type)?.symmetric === true;
    const adjacency = new Map<string, Array<{ to: string; index: number }>>();
    const asserted = new Set<string>();
    const starts: string[] = [];
    const link = (from: string, to: string, index: number) => {
      let list = adjacency.get(from);
      if (!list) {
        list = [];
        adjacency.set(from, list);
        starts.push(from);
      }
      list.push({ to, index });
    };
    for (const i of indexes) {
      const r = relations[i];
      link(r.source, r.target, i);
      asserted.add(pairKey(r.source, r.target));
      if (symmetric) {
        link(r.target, r.source, i);
        asserted.add(pairKey(r.target, r.source));
      }
    }

    const emitted = new Set<string>();
    for (const start of starts) {
      // Breadth-first: the first time a node is reached is by a shortest path.
      const path = new Map<string, number[]>([[start, []]]);
      let frontier = [start];
      for (let depth = 1; depth <= depthCap && frontier.length; depth++) {
        const next: string[] = [];
        for (const node of frontier) {
          for (const edge of adjacency.get(node) ?? []) {
            if (path.has(edge.to)) continue;
            const via = [...(path.get(node) as number[]), edge.index];
            path.set(edge.to, via);
            next.push(edge.to);
            if (depth < 2 || asserted.has(pairKey(start, edge.to)) || emitted.has(pairKey(start, edge.to))) continue;
            emitted.add(pairKey(start, edge.to));
            if (symmetric) emitted.add(pairKey(edge.to, start));
            out.push({ source: start, target: edge.to, type, inferred: true, depth, via });
          }
        }
        frontier = next;
      }
    }
  }
  return out;
}

/**
 * Whether adding `candidate` (source → target) to the directed `relations` of
 * ONE hierarchical type closes a cycle: true when the target already reaches
 * the source, or when source and target are the same node. Unbounded (a cycle
 * of any length counts) and safe on input that already contains cycles.
 */
export function wouldCloseCycle(
  relations: ReadonlyArray<{ source: string; target: string }>,
  candidate: { source: string; target: string },
): boolean {
  if (candidate.source === candidate.target) return true;
  const adjacency = new Map<string, string[]>();
  for (const r of relations) {
    const list = adjacency.get(r.source);
    if (list) list.push(r.target);
    else adjacency.set(r.source, [r.target]);
  }
  const seen = new Set<string>([candidate.target]);
  const stack = [candidate.target];
  while (stack.length) {
    const node = stack.pop() as string;
    if (node === candidate.source) return true;
    for (const next of adjacency.get(node) ?? []) {
      if (!seen.has(next)) {
        seen.add(next);
        stack.push(next);
      }
    }
  }
  return false;
}

/** Whether the directed `relations` (of one type) contain a cycle (a self-relation counts). */
export function hasCycle(relations: ReadonlyArray<{ source: string; target: string }>): boolean {
  const adjacency = new Map<string, string[]>();
  for (const r of relations) {
    if (r.source === r.target) return true;
    const list = adjacency.get(r.source);
    if (list) list.push(r.target);
    else adjacency.set(r.source, [r.target]);
  }
  // Iterative three-colour depth-first search.
  const state = new Map<string, 1 | 2>(); // 1 = on the stack, 2 = done
  for (const root of adjacency.keys()) {
    if (state.has(root)) continue;
    const stack: Array<{ node: string; i: number }> = [{ node: root, i: 0 }];
    state.set(root, 1);
    while (stack.length) {
      const top = stack[stack.length - 1];
      const next = (adjacency.get(top.node) ?? [])[top.i++];
      if (next === undefined) {
        state.set(top.node, 2);
        stack.pop();
      } else if (state.get(next) === 1) return true;
      else if (!state.has(next)) {
        state.set(next, 1);
        stack.push({ node: next, i: 0 });
      }
    }
  }
  return false;
}
