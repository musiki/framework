import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTree,
  sortSiblings,
  positionBetween,
  needsRenormalize,
  renormalizedPositions,
} from './model.ts';

// ---------------------------------------------------------------------------
// sortSiblings
// ---------------------------------------------------------------------------

test('sortSiblings: positioned items come before null-position items', () => {
  const items = [
    { id: 'a', position: null, label: 'zzz' },
    { id: 'b', position: 10, label: 'aaa' },
  ];
  const sorted = sortSiblings(items, (i) => ({ position: i.position, label: i.label }), 'en');
  assert.deepEqual(sorted.map((i) => i.id), ['b', 'a']);
});

test('sortSiblings: positioned items sort ascending by position', () => {
  const items = [
    { id: 'a', position: 300, label: 'a' },
    { id: 'b', position: 100, label: 'b' },
    { id: 'c', position: 200, label: 'c' },
  ];
  const sorted = sortSiblings(items, (i) => ({ position: i.position, label: i.label }), 'en');
  assert.deepEqual(sorted.map((i) => i.id), ['b', 'c', 'a']);
});

test('sortSiblings: null-position items sort alphabetically with es locale (árbol < barco)', () => {
  const items = [
    { id: 'barco', position: null, label: 'barco' },
    { id: 'arbol', position: null, label: 'árbol' },
  ];
  const sorted = sortSiblings(items, (i) => ({ position: i.position, label: i.label }), 'es');
  assert.deepEqual(sorted.map((i) => i.id), ['arbol', 'barco']);
});

// ---------------------------------------------------------------------------
// positionBetween
// ---------------------------------------------------------------------------

test('positionBetween: both null -> 1024', () => {
  assert.equal(positionBetween(null, null), 1024);
});

test('positionBetween: only next -> next - 1024', () => {
  assert.equal(positionBetween(null, 500), 500 - 1024);
});

test('positionBetween: only prev -> prev + 1024', () => {
  assert.equal(positionBetween(500, null), 500 + 1024);
});

test('positionBetween: both -> midpoint', () => {
  assert.equal(positionBetween(100, 200), 150);
});

// ---------------------------------------------------------------------------
// needsRenormalize
// ---------------------------------------------------------------------------

test('needsRenormalize: true when gap is tiny', () => {
  assert.equal(needsRenormalize(100, 100 + 1e-10), true);
});

test('needsRenormalize: false when gap is large enough', () => {
  assert.equal(needsRenormalize(100, 200), false);
});

test('needsRenormalize: false when either side is null', () => {
  assert.equal(needsRenormalize(null, 200), false);
  assert.equal(needsRenormalize(100, null), false);
  assert.equal(needsRenormalize(null, null), false);
});

// ---------------------------------------------------------------------------
// renormalizedPositions
// ---------------------------------------------------------------------------

test('renormalizedPositions: 1024-step sequence', () => {
  assert.deepEqual(renormalizedPositions(4), [1024, 2048, 3072, 4096]);
});

test('renormalizedPositions: zero count -> empty array', () => {
  assert.deepEqual(renormalizedPositions(0), []);
});

// ---------------------------------------------------------------------------
// buildTree
// ---------------------------------------------------------------------------

test('buildTree: folders come before notes at each level', () => {
  const folders = [{ id: 'f1', parentId: null, name: 'Zeta', position: null }];
  const notes = [{ id: 'n1', folderId: null, title: 'Alpha', position: null }];
  const tree = buildTree(folders, notes, 'en');
  assert.equal(tree.length, 2);
  assert.equal(tree[0].kind, 'folder');
  assert.equal(tree[1].kind, 'note');
});

test('buildTree: nested folders build correct hierarchy', () => {
  const folders = [
    { id: 'root', parentId: null, name: 'Root', position: null },
    { id: 'child', parentId: 'root', name: 'Child', position: null },
  ];
  const notes = [{ id: 'n1', folderId: 'child', title: 'Note', position: null }];
  const tree = buildTree(folders, notes, 'en');
  assert.equal(tree.length, 1);
  assert.equal(tree[0].kind, 'folder');
  assert.equal(tree[0].folder.id, 'root');
  const childNode = tree[0].children[0];
  assert.equal(childNode.kind, 'folder');
  assert.equal(childNode.folder.id, 'child');
  assert.equal(childNode.children[0].kind, 'note');
  assert.equal(childNode.children[0].note.id, 'n1');
});

test('buildTree: orphan folder (missing parent) goes to root', () => {
  const folders = [{ id: 'f1', parentId: 'missing-parent', name: 'Orphan', position: null }];
  const notes = [];
  const tree = buildTree(folders, notes, 'en');
  assert.equal(tree.length, 1);
  assert.equal(tree[0].folder.id, 'f1');
});

test('buildTree: orphan note (missing folder) goes to root', () => {
  const folders = [];
  const notes = [{ id: 'n1', folderId: 'missing-folder', title: 'Note', position: null }];
  const tree = buildTree(folders, notes, 'en');
  assert.equal(tree.length, 1);
  assert.equal(tree[0].kind, 'note');
  assert.equal(tree[0].note.id, 'n1');
});

test('buildTree: parent cycle does not hang and breaks the cycle (both to root)', () => {
  const folders = [
    { id: 'a', parentId: 'b', name: 'A', position: null },
    { id: 'b', parentId: 'a', name: 'B', position: null },
  ];
  const tree = buildTree(folders, [], 'en');
  // Must terminate; both folders should appear exactly once total across the tree.
  const ids = [];
  const collect = (nodes) => {
    for (const n of nodes) {
      if (n.kind === 'folder') {
        ids.push(n.folder.id);
        collect(n.children);
      }
    }
  };
  collect(tree);
  assert.deepEqual(ids.sort(), ['a', 'b']);
});

test('buildTree: all-null positions reproduce musiki\'s current sort exactly (folders es/base, notes plain localeCompare)', () => {
  const folders = [
    { id: 'f-zebra', parentId: null, name: 'Zebra', position: null },
    { id: 'f-arbol', parentId: null, name: 'Árbol', position: null },
    { id: 'f-arbusto', parentId: null, name: 'arbusto', position: null },
  ];
  const notes = [
    { id: 'n-zeta', folderId: null, title: 'Zeta', position: null },
    { id: 'n-alpha', folderId: null, title: 'alpha', position: null },
    { id: 'n-alpha2', folderId: null, title: 'Alpha', position: null },
  ];

  const tree = buildTree(folders, notes, 'es');

  // Reference behaviour taken directly from notes-sidebar.ts renderNotesTree:
  const expectedFolderOrder = [...folders]
    .sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }))
    .map((f) => f.id);
  const expectedNoteOrder = [...notes]
    .sort((a, b) => (a.title || '').localeCompare(b.title || ''))
    .map((n) => n.id);

  const folderNodes = tree.filter((n) => n.kind === 'folder');
  const noteNodes = tree.filter((n) => n.kind === 'note');

  assert.deepEqual(folderNodes.map((n) => n.folder.id), expectedFolderOrder);
  assert.deepEqual(noteNodes.map((n) => n.note.id), expectedNoteOrder);
});

// ---------------------------------------------------------------------------
// dropPosition
// ---------------------------------------------------------------------------

test('dropPosition: insert at start among positioned siblings', async () => {
  const { dropPosition } = await import('./model.ts');
  const siblings = [100, 200, 300];
  const pos = dropPosition(siblings, 0);
  assert.equal(pos, 100 - 1024);
});

test('dropPosition: insert at end among positioned siblings', async () => {
  const { dropPosition } = await import('./model.ts');
  const siblings = [100, 200, 300];
  const pos = dropPosition(siblings, 3);
  assert.equal(pos, 300 + 1024);
});

test('dropPosition: insert in the middle between two positioned siblings', async () => {
  const { dropPosition } = await import('./model.ts');
  const siblings = [100, 200, 300];
  const pos = dropPosition(siblings, 1);
  assert.equal(pos, 150);
});

test('dropPosition: empty siblings -> 1024', async () => {
  const { dropPosition } = await import('./model.ts');
  const pos = dropPosition([], 0);
  assert.equal(pos, 1024);
});

test('dropPosition: neighbour is null -> falls back to nearest non-null neighbour', async () => {
  const { dropPosition } = await import('./model.ts');
  // siblings sorted as they'd appear: [100, null, null, 300]
  const siblings = [100, null, null, 300];
  // inserting at index 2 (between the two nulls): nearest non-null before is 100,
  // nearest non-null after is 300 -> midpoint 200.
  const pos = dropPosition(siblings, 2);
  assert.equal(pos, 200);
});
