import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_DEPTH, clampDepth, neighborhood } from './connectome-depth.mjs';

// a — b — c — d — e — f, y g suelto
const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
const edges = [
  { source: 'a', target: 'b' },
  { source: 'c', target: 'b' },
  { source: { id: 'c' }, target: { id: 'd' } },
  { source: 'd', target: 'e' },
  { source: 'e', target: 'f' },
  { source: 'f', target: 'zzz' },
];
const sorted = (set) => [...set].sort();

test('clampDepth queda entre 1 y 5', () => {
  assert.equal(clampDepth(0), 1);
  assert.equal(clampDepth(9), 5);
  assert.equal(clampDepth('3'), 3);
  assert.equal(clampDepth('x'), 2);
});

test('profundidad 1: la nota y sus vecinos, en los dos sentidos', () => {
  assert.deepEqual(sorted(neighborhood(ids, edges, ['c'], 1)), ['b', 'c', 'd']);
});

test('profundidad 2 y 3 se abren de a un salto', () => {
  assert.deepEqual(sorted(neighborhood(ids, edges, ['c'], 2)), ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(sorted(neighborhood(ids, edges, ['a'], 3)), ['a', 'b', 'c', 'd']);
});

test('profundidad máxima o sin inicio conocido: el mapa entero', () => {
  assert.equal(neighborhood(ids, edges, ['c'], MAX_DEPTH).size, ids.length);
  assert.equal(neighborhood(ids, edges, ['nada'], 1).size, ids.length);
  assert.equal(neighborhood(ids, edges, [], 1).size, ids.length);
});

test('las aristas a nodos de afuera se ignoran', () => {
  assert.deepEqual(sorted(neighborhood(ids, edges, ['f'], 1)), ['e', 'f']);
});
