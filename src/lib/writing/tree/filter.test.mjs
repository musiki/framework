import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTree, filterTree, matchRange, nodeKey } from './model.ts';

const folders = [
  { id: 'f1', parentId: null, name: 'Capítulo uno' },
  { id: 'f2', parentId: 'f1', name: 'Fuentes' },
  { id: 'f3', parentId: null, name: 'Anexos' },
];
const notes = [
  { id: 'n1', folderId: 'f2', title: 'Écriture et son' },
  { id: 'n2', folderId: 'f1', title: 'Intro' },
  { id: 'n3', folderId: 'f3', title: 'Tabla' },
  { id: 'n4', folderId: null, title: 'Root note' },
];
const tree = () => buildTree(folders, notes, 'en');

test('filterTree: empty or blank query shows everything and forces nothing open', () => {
  for (const q of ['', '   ']) {
    const r = filterTree(tree(), q);
    assert.equal(r.visible.size, folders.length + notes.length);
    assert.equal(r.expand.size, 0);
    assert.equal(r.matches.size, 0);
  }
});

test('filterTree: a deep match is visible with all its ancestors expanded; unrelated branches are hidden', () => {
  const r = filterTree(tree(), 'ecri');
  assert.deepEqual([...r.matches], ['note:n1']);
  assert.deepEqual([...r.visible].sort(), ['folder:f1', 'folder:f2', 'note:n1']);
  assert.deepEqual([...r.expand].sort(), ['f1', 'f2']);
});

test('filterTree: case- and accent-insensitive in both directions', () => {
  assert.ok(filterTree(tree(), 'ÉCRITURE').matches.has('note:n1'));
  assert.ok(filterTree(tree(), 'capitulo').matches.has('folder:f1'));
  assert.ok(filterTree(tree(), 'capítulo').matches.has('folder:f1'));
});

test('filterTree: a matching folder keeps its descendants visible but is not itself forced open', () => {
  const r = filterTree(tree(), 'anex');
  assert.deepEqual([...r.visible].sort(), ['folder:f3', 'note:n3']);
  assert.equal(r.expand.has('f3'), false);
});

test('filterTree: no match leaves nothing visible', () => {
  const r = filterTree(tree(), 'zzz');
  assert.equal(r.visible.size, 0);
  assert.equal(r.expand.size, 0);
});

test('nodeKey distinguishes folders and notes sharing an id', () => {
  const [f] = buildTree([{ id: 'x', parentId: null, name: 'F' }], [{ id: 'x', folderId: null, title: 'N' }]);
  assert.equal(nodeKey(f), 'folder:x');
  assert.equal(nodeKey({ kind: 'note', note: { id: 'x', folderId: null, title: 'N' } }), 'note:x');
});

test('matchRange returns indices into the original (accented) text', () => {
  assert.deepEqual(matchRange('Écriture', 'ecr'), [0, 3]);
  assert.deepEqual(matchRange('Capítulo uno', 'ITU'), [3, 6]);
  // decomposed input (e + combining acute) keeps the mark inside the highlight
  assert.deepEqual(matchRange('café noir', 'café'), [0, 5]);
  assert.equal(matchRange('Intro', ''), null);
  assert.equal(matchRange('Intro', 'zz'), null);
});
