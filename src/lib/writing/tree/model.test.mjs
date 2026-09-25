import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTree,
  sortSiblings,
  displayOrderFolders,
  displayOrderNotes,
  positionBetween,
  needsRenormalize,
  renormalizedPositions,
  planReorder,
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
// displayOrderFolders / displayOrderNotes
// ---------------------------------------------------------------------------

test('displayOrderFolders: matches buildTree order exactly, plus a deterministic id tie-break on exact ties', () => {
  const folders = [
    { id: 'f-zebra', parentId: null, name: 'Zebra', position: null },
    { id: 'f-arbol', parentId: null, name: 'Árbol', position: null },
    { id: 'f-arbusto', parentId: null, name: 'arbusto', position: null },
    // Two folders that tie under `sensitivity: 'base'` (same base letters,
    // different case) -> must be ordered deterministically by id.
    { id: 'f-tie-b', parentId: null, name: 'Nota', position: null },
    { id: 'f-tie-a', parentId: null, name: 'nota', position: null },
  ];
  const ordered = displayOrderFolders(folders, 'es');
  const tree = buildTree(folders, [], 'es');

  assert.deepEqual(ordered.map((f) => f.id), tree.map((n) => n.folder.id));
  // The tied pair lands in a stable, id-ordered position relative to each other.
  const tieIndexA = ordered.findIndex((f) => f.id === 'f-tie-a');
  const tieIndexB = ordered.findIndex((f) => f.id === 'f-tie-b');
  assert.ok(tieIndexA < tieIndexB); // 'f-tie-a' < 'f-tie-b' lexicographically
});

test('displayOrderNotes: matches buildTree order exactly, plus a deterministic id tie-break on exact ties', () => {
  const notes = [
    { id: 'n-zeta', folderId: null, title: 'Zeta', position: null },
    { id: 'n-alpha', folderId: null, title: 'alpha', position: null },
    { id: 'n-alpha2', folderId: null, title: 'Alpha', position: null },
  ];
  const ordered = displayOrderNotes(notes, 'es');
  const tree = buildTree([], notes, 'es');

  assert.deepEqual(ordered.map((n) => n.id), tree.map((n) => n.note.id));
});

test('displayOrderNotes/Folders: "nota"/"Nota" and "Canción"/"Cancion" with null positions match buildTree order, and the resulting index feeds planReorder correctly', () => {
  const notes = [
    { id: 'n-nota-lower', folderId: null, title: 'nota', position: null },
    { id: 'n-nota-upper', folderId: null, title: 'Nota', position: null },
    { id: 'n-cancion-accent', folderId: null, title: 'Canción', position: null },
    { id: 'n-cancion-plain', folderId: null, title: 'Cancion', position: null },
  ];

  const serverOrder = displayOrderNotes(notes, 'es');
  const tree = buildTree([], notes, 'es');
  const treeOrder = tree.map((n) => n.note.id);

  // Server (reorderSpaceItem's) display order must equal buildTree's order
  // exactly, including how the "nota"/"Nota" tie and the
  // "Canción"/"Cancion" pair resolve — not just "some" order.
  assert.deepEqual(serverOrder.map((n) => n.id), treeOrder);

  // Reorder lands at the intended index: drag the last item in server
  // display order to the front, and confirm it's the same item the UI
  // would have shown last (buildTree's last item), not some other item
  // that a differently-tied sort might have placed there instead.
  const draggedId = serverOrder[serverOrder.length - 1].id;
  assert.equal(draggedId, treeOrder[treeOrder.length - 1]);

  const plan = planReorder(
    serverOrder.map((n) => ({ id: n.id, position: n.position ?? null })),
    draggedId,
    0,
  );
  const resorted = displayOrderNotes(
    plan.map((p) => ({ id: p.id, position: p.position, title: notes.find((n) => n.id === p.id).title })),
    'es',
  );
  assert.equal(resorted[0].id, draggedId);
});

// ---------------------------------------------------------------------------
// planReorder
// ---------------------------------------------------------------------------

test('planReorder: all-null siblings (musiki today) -> full renormalization, dragged item lands at target index', () => {
  // Display order as sortSiblings would produce it for all-null positions:
  // alphabetical. Drag "c" (currently last) to index 0.
  const siblings = [
    { id: 'a', position: null },
    { id: 'b', position: null },
    { id: 'c', position: null },
  ];
  const plan = planReorder(siblings, 'c', 0);

  // Full renormalization: every sibling gets a fresh position.
  assert.equal(plan.length, 3);
  assert.deepEqual(
    plan.map((p) => p.position),
    [1024, 2048, 3072],
  );

  // Re-sorting by the plan's positions must put the dragged item first.
  const resorted = sortSiblings(plan, (p) => ({ position: p.position, label: p.id }), 'en');
  assert.equal(resorted[0].id, 'c');
});

test('planReorder: fully positioned siblings with a wide gap -> single assignment for the dragged item', () => {
  const siblings = [
    { id: 'a', position: 1024 },
    { id: 'b', position: 2048 },
    { id: 'c', position: 3072 },
  ];
  // Move "c" to index 1 (between a and b).
  const plan = planReorder(siblings, 'c', 1);
  assert.deepEqual(plan, [{ id: 'c', position: (1024 + 2048) / 2 }]);
});

test('planReorder: tiny gap at the drop point -> falls back to full renormalization', () => {
  const siblings = [
    { id: 'a', position: 1024 },
    { id: 'b', position: 1024 + 1e-10 },
    { id: 'c', position: 3072 },
  ];
  // Move "c" to index 1 (between a and b), where the gap is too tiny.
  const plan = planReorder(siblings, 'c', 1);
  assert.equal(plan.length, 3);
  assert.deepEqual(
    plan.map((p) => p.position),
    [1024, 2048, 3072],
  );
  assert.deepEqual(plan.map((p) => p.id), ['a', 'c', 'b']);
});

test('planReorder: target index clamped to the start (0)', () => {
  const siblings = [
    { id: 'a', position: 1024 },
    { id: 'b', position: 2048 },
  ];
  const plan = planReorder(siblings, 'b', -5);
  assert.deepEqual(plan, [{ id: 'b', position: 1024 - 1024 }]);
});

test('planReorder: target index clamped to the end', () => {
  const siblings = [
    { id: 'a', position: 1024 },
    { id: 'b', position: 2048 },
  ];
  const plan = planReorder(siblings, 'a', 99);
  assert.deepEqual(plan, [{ id: 'a', position: 2048 + 1024 }]);
});

test('planReorder: dragged item comes from another parent (not in the list)', () => {
  const siblings = [
    { id: 'a', position: 1024 },
    { id: 'b', position: 2048 },
  ];
  const plan = planReorder(siblings, 'incoming', 1);
  assert.deepEqual(plan, [{ id: 'incoming', position: (1024 + 2048) / 2 }]);
});

test('planReorder: dragged item from another parent into all-null siblings -> full renormalization including the incoming item', () => {
  const siblings = [
    { id: 'a', position: null },
    { id: 'b', position: null },
  ];
  const plan = planReorder(siblings, 'incoming', 1);
  assert.equal(plan.length, 3);
  assert.deepEqual(plan.map((p) => p.id), ['a', 'incoming', 'b']);
  assert.deepEqual(
    plan.map((p) => p.position),
    [1024, 2048, 3072],
  );
});
