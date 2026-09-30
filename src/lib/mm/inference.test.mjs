import test from 'node:test';
import assert from 'node:assert/strict';
import { inferRelations, wouldCloseCycle, hasCycle, MAX_INFERENCE_DEPTH } from './inference.ts';

const TYPES = {
  derives: { transitive: true },
  contains: { transitive: true, hierarchical: true },
  akin: { transitive: true, symmetric: true },
  combines: { symmetric: true },
  exemplifies: {},
};
const rel = (source, target, type = 'derives') => ({ source, target, type });
const pairs = (list) => list.map((r) => `${r.source}>${r.target}:${r.type}`);

test('transitive closure: A→B→C infers A→C, flagged inferred with depth and supporting path', () => {
  const out = inferRelations([rel('a', 'b'), rel('b', 'c')], TYPES);
  assert.deepEqual(out, [{ source: 'a', target: 'c', type: 'derives', inferred: true, depth: 2, via: [0, 1] }]);
});

test('non-transitive types infer nothing; unknown types are ignored; types do not mix', () => {
  assert.deepEqual(inferRelations([rel('a', 'b', 'exemplifies'), rel('b', 'c', 'exemplifies')], TYPES), []);
  assert.deepEqual(inferRelations([rel('a', 'b', 'combines'), rel('b', 'c', 'combines')], TYPES), []);
  assert.deepEqual(inferRelations([rel('a', 'b', 'nope'), rel('b', 'c', 'nope')], TYPES), []);
  assert.deepEqual(inferRelations([rel('a', 'b', 'toString'), rel('b', 'c', 'toString')], TYPES), [], 'no prototype keys');
  assert.deepEqual(inferRelations([rel('a', 'b', 'derives'), rel('b', 'c', 'contains')], TYPES), []);
  assert.deepEqual(pairs(inferRelations([rel('a', 'b'), rel('b', 'c')], new Map(Object.entries(TYPES)))), ['a>c:derives']);
});

test('an asserted pair is never duplicated as inferred', () => {
  const out = inferRelations([rel('a', 'b'), rel('b', 'c'), rel('a', 'c'), rel('c', 'd')], TYPES);
  assert.deepEqual(pairs(out).sort(), ['a>d:derives', 'b>d:derives']);
  // Two paths to the same node: one inferred relation only.
  const diamond = inferRelations([rel('a', 'b'), rel('a', 'c'), rel('b', 'd'), rel('c', 'd')], TYPES);
  assert.deepEqual(pairs(diamond), ['a>d:derives']);
});

test('bounded depth: at most maxDepth hops, hard cap 6', () => {
  const chain = Array.from({ length: 9 }, (_, i) => rel(`n${i}`, `n${i + 1}`)); // n0 → … → n9
  const from0 = (out) => out.filter((r) => r.source === 'n0').map((r) => r.target);
  assert.deepEqual(from0(inferRelations(chain, TYPES)), ['n2', 'n3', 'n4', 'n5', 'n6']);
  assert.deepEqual(from0(inferRelations(chain, TYPES, { maxDepth: 3 })), ['n2', 'n3']);
  assert.deepEqual(from0(inferRelations(chain, TYPES, { maxDepth: 50 })), ['n2', 'n3', 'n4', 'n5', 'n6']);
  assert.deepEqual(inferRelations(chain, TYPES, { maxDepth: 1 }), []);
  assert.equal(MAX_INFERENCE_DEPTH, 6);
  for (const r of inferRelations(chain, TYPES)) assert.ok(r.depth >= 2 && r.depth <= 6 && r.via.length === r.depth);
});

test('cycle-safe: terminates, no self relations, no duplicates', () => {
  const out = inferRelations([rel('a', 'b'), rel('b', 'c'), rel('c', 'a'), rel('x', 'x')], TYPES);
  assert.deepEqual(pairs(out).sort(), ['a>c:derives', 'b>a:derives', 'c>b:derives']);
  assert.ok(out.every((r) => r.source !== r.target));
  assert.equal(new Set(pairs(out)).size, out.length);
});

test('symmetric + transitive: walks both directions, one inferred relation per unordered pair, none for asserted pairs', () => {
  const out = inferRelations([rel('b', 'a', 'akin'), rel('b', 'c', 'akin')], TYPES);
  assert.deepEqual(pairs(out), ['a>c:akin']);
  assert.equal(out[0].depth, 2);
  // c–a asserted the other way round: still asserted, nothing inferred.
  assert.deepEqual(inferRelations([rel('a', 'b', 'akin'), rel('b', 'c', 'akin'), rel('c', 'a', 'akin')], TYPES), []);
});

test('larger graph: every inferred pair is unique and absent from the asserted set', () => {
  const rels = [];
  for (let i = 0; i < 30; i++) rels.push(rel(`n${i}`, `n${(i * 7 + 3) % 30}`), rel(`n${i}`, `n${(i + 1) % 30}`, 'contains'));
  const out = inferRelations(rels, TYPES);
  const asserted = new Set(pairs(rels));
  assert.ok(out.length > 0);
  assert.equal(new Set(pairs(out)).size, out.length);
  for (const r of out) assert.ok(!asserted.has(`${r.source}>${r.target}:${r.type}`) && r.source !== r.target);
});

test('wouldCloseCycle: direct, long and self cycles; unrelated additions are fine; tolerant of existing cycles', () => {
  const tree = [{ source: 'a', target: 'b' }, { source: 'b', target: 'c' }, { source: 'c', target: 'd' }];
  assert.equal(wouldCloseCycle(tree, { source: 'b', target: 'a' }), true);
  assert.equal(wouldCloseCycle(tree, { source: 'd', target: 'a' }), true);
  assert.equal(wouldCloseCycle(tree, { source: 'a', target: 'a' }), true);
  assert.equal(wouldCloseCycle(tree, { source: 'a', target: 'd' }), false, 'a shortcut is not a cycle');
  assert.equal(wouldCloseCycle(tree, { source: 'x', target: 'a' }), false);
  assert.equal(wouldCloseCycle([], { source: 'a', target: 'b' }), false);
  const looped = [{ source: 'p', target: 'q' }, { source: 'q', target: 'p' }];
  assert.equal(wouldCloseCycle(looped, { source: 'x', target: 'p' }), false);
  const long = Array.from({ length: 50 }, (_, i) => ({ source: `n${i}`, target: `n${i + 1}` }));
  assert.equal(wouldCloseCycle(long, { source: 'n50', target: 'n0' }), true, 'not bounded by the inference depth');
});

test('hasCycle', () => {
  assert.equal(hasCycle([]), false);
  assert.equal(hasCycle([{ source: 'a', target: 'b' }, { source: 'a', target: 'c' }, { source: 'b', target: 'c' }]), false);
  assert.equal(hasCycle([{ source: 'a', target: 'b' }, { source: 'b', target: 'c' }, { source: 'c', target: 'a' }]), true);
  assert.equal(hasCycle([{ source: 'a', target: 'a' }]), true);
});
