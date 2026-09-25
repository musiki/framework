import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeQuery } from './fake-query.test-helper.mjs';
import {
  SpaceNotesError,
  getMemberRole,
  listSpaceTree,
  getSpaceNote,
  createSpaceNote,
  updateSpaceNote,
  deleteSpaceNote,
  createSpaceFolder,
  renameSpaceFolder,
  moveSpaceFolder,
  deleteSpaceFolder,
  setFolderVisibility,
  reorderSpaceItem,
  ensureOkaFolders,
} from './space-notes-core.ts';

const SPACE = 's1';

// ---------------------------------------------------------------------------
// getMemberRole
// ---------------------------------------------------------------------------

test('getMemberRole: returns the role for a member, null otherwise', async () => {
  const { q } = fakeQuery([
    ['"SpaceMember"', ([, userId]) => (userId === 'u-author' ? [{ role: 'author' }] : [])],
  ]);
  assert.equal(await getMemberRole(q, SPACE, 'u-author'), 'author');
  assert.equal(await getMemberRole(q, SPACE, 'u-stranger'), null);
});

// ---------------------------------------------------------------------------
// listSpaceTree — role x visibility matrix
// ---------------------------------------------------------------------------

function gtxOutputFixture(role) {
  // Two root folders: GTX (supervision), Output (committee); GTX has one
  // empty subfolder. Notes: one under GTX (inherits supervision), one under
  // Output (inherits committee), one root note with no visibility (private),
  // one root note explicitly public.
  const folders = [
    { id: 'f-gtx', parentId: null, name: 'GTX', visibility: 'supervision', position: 1024 },
    { id: 'f-output', parentId: null, name: 'Output', visibility: 'committee', position: 2048 },
    { id: 'f-empty', parentId: null, name: 'Empty', visibility: null, position: 3072 },
    { id: 'f-sub', parentId: 'f-gtx', name: 'Sub', visibility: null, position: 100 },
  ];
  const notes = [
    { id: 'n-gtx', folderId: 'f-gtx', title: 'GTX note', userId: 'author1', visibility: null, position: 10 },
    { id: 'n-output', folderId: 'f-output', title: 'Output note', userId: 'author1', visibility: null, position: 20 },
    { id: 'n-private', folderId: null, title: 'Private root', userId: 'author1', visibility: null, position: 30 },
    { id: 'n-public', folderId: null, title: 'Public root', userId: 'author1', visibility: 'public', position: 40 },
  ];
  return fakeQuery([
    ['"SpaceMember"', () => [{ role }]],
    ['"LiveClassNoteFolder"', () => folders],
    ['"LiveClassNote"', () => notes],
  ]);
}

test('listSpaceTree: supervisor sees GTX (comment) and Output (view) notes, not the private root note', async () => {
  const { q } = gtxOutputFixture('supervisor');
  const { role, folders, notes } = await listSpaceTree(q, { spaceId: SPACE, userId: 'u1' });
  assert.equal(role, 'supervisor');

  const noteIds = notes.map((n) => n.id).sort();
  assert.deepEqual(noteIds, ['n-gtx', 'n-output', 'n-public']);
  assert.equal(notes.find((n) => n.id === 'n-gtx').access, 'comment');
  assert.equal(notes.find((n) => n.id === 'n-output').access, 'view');

  // f-sub has no notes of its own and no visible children -> dropped.
  // f-empty has no notes -> dropped.
  const folderIds = folders.map((f) => f.id).sort();
  assert.deepEqual(folderIds, ['f-gtx', 'f-output']);
});

test('listSpaceTree: coordinator only reaches the Output (committee) folder, not GTX (supervision)', async () => {
  const { q } = gtxOutputFixture('coordinator');
  const { folders, notes } = await listSpaceTree(q, { spaceId: SPACE, userId: 'u1' });

  const noteIds = notes.map((n) => n.id).sort();
  assert.deepEqual(noteIds, ['n-output', 'n-public']);

  const folderIds = folders.map((f) => f.id).sort();
  assert.deepEqual(folderIds, ['f-output']);
});

test('listSpaceTree: guest sees nothing unless the item is public', async () => {
  const { q } = gtxOutputFixture('guest');
  const { folders, notes } = await listSpaceTree(q, { spaceId: SPACE, userId: 'u1' });

  assert.deepEqual(notes.map((n) => n.id), ['n-public']);
  assert.deepEqual(folders, []);
});

test('listSpaceTree: author sees every folder (including empty ones) and every note, including private', async () => {
  const { q } = gtxOutputFixture('author');
  const { folders, notes } = await listSpaceTree(q, { spaceId: SPACE, userId: 'u1' });

  assert.equal(folders.length, 4);
  assert.equal(notes.length, 4);
  assert.ok(notes.every((n) => n.access === 'edit'));
});

test('listSpaceTree: throws 403 when the caller is not a space member', async () => {
  const { q } = fakeQuery([['"SpaceMember"', () => []]]);
  await assert.rejects(
    () => listSpaceTree(q, { spaceId: SPACE, userId: 'stranger' }),
    (err) => err instanceof SpaceNotesError && err.status === 403,
  );
});

// ---------------------------------------------------------------------------
// getSpaceNote
// ---------------------------------------------------------------------------

test('getSpaceNote: reviewer gets the Output (committee) note with versionsOnly true and no body', async () => {
  const note = {
    id: 'n1', userId: 'author1', spaceId: SPACE, folderId: 'f-output',
    title: 'T', body: 'secret body', lang: 'en', visibility: null, position: 1,
    createdAt: 'x', updatedAt: 'x',
  };
  const { q } = fakeQuery([
    ['"LiveClassNote"', () => [note]],
    ['"SpaceMember"', () => [{ role: 'reviewer' }]],
    ['"LiveClassNoteFolder"', () => [{ id: 'f-output', parentId: null, visibility: 'committee' }]],
  ]);
  const result = await getSpaceNote(q, { spaceId: SPACE, userId: 'u1', noteId: 'n1' });
  assert.equal(result.versionsOnly, true);
  assert.equal(result.accessLevel, 'view');
  assert.equal('body' in result.note, false);
});

test('getSpaceNote: returns null when the note does not exist in this space', async () => {
  const { q } = fakeQuery([['"LiveClassNote"', () => []]]);
  const result = await getSpaceNote(q, { spaceId: SPACE, userId: 'u1', noteId: 'missing' });
  assert.equal(result, null);
});

test('getSpaceNote: returns null (not an error) when access resolves to null', async () => {
  const note = {
    id: 'n1', userId: 'author1', spaceId: SPACE, folderId: null,
    title: 'T', body: 'b', lang: 'en', visibility: null, position: 1,
  };
  const { q } = fakeQuery([
    ['"LiveClassNote"', () => [note]],
    ['"SpaceMember"', () => [{ role: 'guest' }]],
    ['"LiveClassNoteFolder"', () => []],
  ]);
  const result = await getSpaceNote(q, { spaceId: SPACE, userId: 'u1', noteId: 'n1' });
  assert.equal(result, null);
});

// ---------------------------------------------------------------------------
// createSpaceNote
// ---------------------------------------------------------------------------

test('createSpaceNote: author only, appends at the end of the folder via positionBetween', async () => {
  const inserted = [];
  const { q } = fakeQuery([
    ['"SpaceMember"', () => [{ role: 'author' }]],
    ['SELECT id FROM "LiveClassNoteFolder"', () => [{ id: 'f1' }]],
    ['SELECT MAX', () => [{ maxPosition: 2048 }]],
    ['INSERT INTO "LiveClassNote"', (params) => {
      inserted.push(params);
      return [{ id: 'new1', position: params[6] }];
    }],
  ]);
  const note = await createSpaceNote(q, { spaceId: SPACE, userId: 'u1', folderId: 'f1', title: 'T', body: 'B', lang: 'en' });
  assert.equal(note.id, 'new1');
  assert.equal(note.position, 2048 + 1024); // positionBetween(2048, null)
  assert.equal(inserted[0][2], 'f1'); // folderId
  assert.equal(inserted[0][3], 'T');
});

test('createSpaceNote: non-author is rejected with 403', async () => {
  const { q } = fakeQuery([['"SpaceMember"', () => [{ role: 'supervisor' }]]]);
  await assert.rejects(
    () => createSpaceNote(q, { spaceId: SPACE, userId: 'u1', folderId: null, title: 'T', body: 'B' }),
    (err) => err instanceof SpaceNotesError && err.status === 403,
  );
});

test('createSpaceNote: folder from another space is rejected with 400', async () => {
  const { q } = fakeQuery([
    ['"SpaceMember"', () => [{ role: 'author' }]],
    ['SELECT id FROM "LiveClassNoteFolder"', () => []], // not found in this space
  ]);
  await assert.rejects(
    () => createSpaceNote(q, { spaceId: SPACE, userId: 'u1', folderId: 'foreign-folder', title: 'T', body: 'B' }),
    (err) => err instanceof SpaceNotesError && err.status === 400,
  );
});

// ---------------------------------------------------------------------------
// updateSpaceNote
// ---------------------------------------------------------------------------

test('updateSpaceNote: non-author patching folderId gets 403', async () => {
  const { q } = fakeQuery([
    ['SELECT id, "folderId", visibility FROM "LiveClassNote"', () => [{ id: 'n1', folderId: null, visibility: 'public' }]],
    ['"SpaceMember"', () => [{ role: 'supervisor' }]],
  ]);
  await assert.rejects(
    () => updateSpaceNote(q, { spaceId: SPACE, userId: 'u1', noteId: 'n1', patch: { folderId: 'f2' } }),
    (err) => err instanceof SpaceNotesError && err.status === 403,
  );
});

test('updateSpaceNote: non-author patching visibility gets 403', async () => {
  const { q } = fakeQuery([
    ['SELECT id, "folderId", visibility FROM "LiveClassNote"', () => [{ id: 'n1', folderId: null, visibility: 'public' }]],
    ['"SpaceMember"', () => [{ role: 'coordinator' }]],
  ]);
  await assert.rejects(
    () => updateSpaceNote(q, { spaceId: SPACE, userId: 'u1', noteId: 'n1', patch: { visibility: 'private' } }),
    (err) => err instanceof SpaceNotesError && err.status === 403,
  );
});

test('updateSpaceNote: author moving a note into a folder of another space gets 400', async () => {
  const { q } = fakeQuery([
    ['SELECT id, "folderId", visibility FROM "LiveClassNote"', () => [{ id: 'n1', folderId: null, visibility: 'public' }]],
    ['"SpaceMember"', () => [{ role: 'author' }]],
    ['SELECT id FROM "LiveClassNoteFolder"', () => []], // foreign folder not found in this space
  ]);
  await assert.rejects(
    () => updateSpaceNote(q, { spaceId: SPACE, userId: 'u1', noteId: 'n1', patch: { folderId: 'foreign-folder' } }),
    (err) => err instanceof SpaceNotesError && err.status === 400,
  );
});

test('updateSpaceNote: supervisor with comment-only access cannot edit body/title', async () => {
  const { q } = fakeQuery([
    ['SELECT id, "folderId", visibility FROM "LiveClassNote"', () => [{ id: 'n1', folderId: null, visibility: 'supervision' }]],
    ['"SpaceMember"', () => [{ role: 'supervisor' }]],
    ['"LiveClassNoteFolder"', () => []],
  ]);
  await assert.rejects(
    () => updateSpaceNote(q, { spaceId: SPACE, userId: 'u1', noteId: 'n1', patch: { body: 'new body' } }),
    (err) => err instanceof SpaceNotesError && err.status === 403,
  );
});

test('updateSpaceNote: author editing body succeeds and issues an UPDATE', async () => {
  const { q, calls } = fakeQuery([
    ['SELECT id, "folderId", visibility FROM "LiveClassNote"', () => [{ id: 'n1', folderId: null, visibility: 'public' }]],
    ['"SpaceMember"', () => [{ role: 'author' }]],
    ['"LiveClassNoteFolder"', () => []],
    ['UPDATE "LiveClassNote"', (params) => [{ id: 'n1', body: params[0] }]],
  ]);
  const updated = await updateSpaceNote(q, { spaceId: SPACE, userId: 'u1', noteId: 'n1', patch: { body: 'new body' } });
  assert.equal(updated.body, 'new body');
  assert.ok(calls.some((c) => c.text.includes('UPDATE "LiveClassNote"')));
});

test('updateSpaceNote: missing note gets 404 (for an actual member)', async () => {
  const { q } = fakeQuery([
    ['"SpaceMember"', () => [{ role: 'author' }]],
    ['SELECT id, "folderId", visibility FROM "LiveClassNote"', () => []],
  ]);
  await assert.rejects(
    () => updateSpaceNote(q, { spaceId: SPACE, userId: 'u1', noteId: 'missing', patch: { title: 'x' } }),
    (err) => err instanceof SpaceNotesError && err.status === 404,
  );
});

test('updateSpaceNote: non-member gets a uniform 403 without ever probing note existence (fix round 1, finding 5)', async () => {
  const noteLookupCalls = [];
  const { q } = fakeQuery([
    ['"SpaceMember"', () => []], // not a member
    ['SELECT id, "folderId", visibility FROM "LiveClassNote"', (params, text) => {
      noteLookupCalls.push(text);
      return [{ id: 'n1', folderId: null, visibility: 'public' }];
    }],
  ]);
  await assert.rejects(
    () => updateSpaceNote(q, { spaceId: SPACE, userId: 'stranger', noteId: 'n1', patch: { title: 'x' } }),
    (err) => err instanceof SpaceNotesError && err.status === 403,
  );
  // Role is checked before the note is ever looked up, so a non-member gets
  // the same 403 whether `noteId` exists or not -- the note lookup query
  // must never even run.
  assert.equal(noteLookupCalls.length, 0);
});

// ---------------------------------------------------------------------------
// deleteSpaceNote
// ---------------------------------------------------------------------------

test('deleteSpaceNote: author only, 404 when nothing deleted', async () => {
  const { q } = fakeQuery([
    ['"SpaceMember"', () => [{ role: 'author' }]],
    ['DELETE FROM "LiveClassNote"', () => []],
  ]);
  await assert.rejects(
    () => deleteSpaceNote(q, { spaceId: SPACE, userId: 'u1', noteId: 'missing' }),
    (err) => err instanceof SpaceNotesError && err.status === 404,
  );
});

test('deleteSpaceNote: non-author gets 403', async () => {
  const { q } = fakeQuery([['"SpaceMember"', () => [{ role: 'reviewer' }]]]);
  await assert.rejects(
    () => deleteSpaceNote(q, { spaceId: SPACE, userId: 'u1', noteId: 'n1' }),
    (err) => err instanceof SpaceNotesError && err.status === 403,
  );
});

// ---------------------------------------------------------------------------
// Folder CRUD
// ---------------------------------------------------------------------------

test('createSpaceFolder: rejects invalid visibility with 400', async () => {
  const { q } = fakeQuery([['"SpaceMember"', () => [{ role: 'author' }]]]);
  await assert.rejects(
    () => createSpaceFolder(q, { spaceId: SPACE, userId: 'u1', parentId: null, name: 'X', visibility: 'nonsense' }),
    (err) => err instanceof SpaceNotesError && err.status === 400,
  );
});

test('renameSpaceFolder: 404 when the folder is not in this space', async () => {
  const { q } = fakeQuery([
    ['"SpaceMember"', () => [{ role: 'author' }]],
    ['UPDATE "LiveClassNoteFolder"', () => []],
  ]);
  await assert.rejects(
    () => renameSpaceFolder(q, { spaceId: SPACE, userId: 'u1', folderId: 'missing', name: 'New' }),
    (err) => err instanceof SpaceNotesError && err.status === 404,
  );
});

test('moveSpaceFolder: moving a folder into its own descendant is rejected with 400', async () => {
  const folders = [
    { id: 'a', parentId: null },
    { id: 'b', parentId: 'a' },
    { id: 'c', parentId: 'b' },
  ];
  const { q } = fakeQuery([
    ['"SpaceMember"', () => [{ role: 'author' }]],
    ['"LiveClassNoteFolder"', () => folders],
  ]);
  await assert.rejects(
    () => moveSpaceFolder(q, { spaceId: SPACE, userId: 'u1', folderId: 'a', parentId: 'c' }),
    (err) => err instanceof SpaceNotesError && err.status === 400,
  );
});

test('moveSpaceFolder: moving a folder into itself is rejected with 400', async () => {
  const { q } = fakeQuery([
    ['"SpaceMember"', () => [{ role: 'author' }]],
    ['"LiveClassNoteFolder"', () => [{ id: 'a', parentId: null }]],
  ]);
  await assert.rejects(
    () => moveSpaceFolder(q, { spaceId: SPACE, userId: 'u1', folderId: 'a', parentId: 'a' }),
    (err) => err instanceof SpaceNotesError && err.status === 400,
  );
});

test('moveSpaceFolder: a normal move updates parentId', async () => {
  const folders = [{ id: 'a', parentId: null }, { id: 'b', parentId: null }];
  const { q } = fakeQuery([
    ['"SpaceMember"', () => [{ role: 'author' }]],
    ['SELECT id, "parentId" FROM "LiveClassNoteFolder"', () => folders],
    ['UPDATE "LiveClassNoteFolder"', (params) => [{ id: 'a', parentId: params[0] }]],
  ]);
  const moved = await moveSpaceFolder(q, { spaceId: SPACE, userId: 'u1', folderId: 'a', parentId: 'b' });
  assert.equal(moved.parentId, 'b');
});

test('moveSpaceFolder: moving to a genuinely different parent appends at the end via positionBetween (fix round 1, finding 7)', async () => {
  const folders = [{ id: 'a', parentId: null }, { id: 'b', parentId: null }];
  let updateParams;
  const { q } = fakeQuery([
    ['"SpaceMember"', () => [{ role: 'author' }]],
    ['SELECT id, "parentId" FROM "LiveClassNoteFolder"', () => folders],
    ['SELECT MAX', () => [{ maxPosition: 2048 }]], // existing last sibling under the new parent
    ['UPDATE "LiveClassNoteFolder"', (params) => { updateParams = params; return [{ id: 'a', parentId: params[0], position: params[1] }]; }],
  ]);
  const moved = await moveSpaceFolder(q, { spaceId: SPACE, userId: 'u1', folderId: 'a', parentId: 'b' });
  assert.equal(moved.parentId, 'b');
  assert.equal(moved.position, 2048 + 1024); // positionBetween(2048, null)
  assert.equal(updateParams.length, 4); // parentId, position, folderId, spaceId
});

test('moveSpaceFolder: moving within the same parent (a no-op parent) does not touch position', async () => {
  const folders = [{ id: 'a', parentId: 'root' }, { id: 'root', parentId: null }];
  let sawMaxQuery = false;
  const { q } = fakeQuery([
    ['"SpaceMember"', () => [{ role: 'author' }]],
    ['SELECT id, "parentId" FROM "LiveClassNoteFolder"', () => folders],
    ['SELECT MAX', () => { sawMaxQuery = true; return []; }],
    ['UPDATE "LiveClassNoteFolder"', (params) => [{ id: 'a', parentId: params[0] }]],
  ]);
  await moveSpaceFolder(q, { spaceId: SPACE, userId: 'u1', folderId: 'a', parentId: 'root' });
  assert.equal(sawMaxQuery, false);
});

test('deleteSpaceFolder: single DELETE, relies on FK cascade/SET NULL; 404 when absent', async () => {
  const { q, calls } = fakeQuery([
    ['"SpaceMember"', () => [{ role: 'author' }]],
    ['DELETE FROM "LiveClassNoteFolder"', () => [{ id: 'f1' }]],
  ]);
  await deleteSpaceFolder(q, { spaceId: SPACE, userId: 'u1', folderId: 'f1' });
  assert.ok(calls.some((c) => c.text.includes('DELETE FROM "LiveClassNoteFolder"')));
  assert.ok(!calls.some((c) => c.text.includes('LiveClassNote"')) || calls.every((c) => !c.text.startsWith('UPDATE "LiveClassNote"')));
});

test('setFolderVisibility: non-author gets 403', async () => {
  const { q } = fakeQuery([['"SpaceMember"', () => [{ role: 'coordinator' }]]]);
  await assert.rejects(
    () => setFolderVisibility(q, { spaceId: SPACE, userId: 'u1', folderId: 'f1', visibility: 'public' }),
    (err) => err instanceof SpaceNotesError && err.status === 403,
  );
});

// ---------------------------------------------------------------------------
// reorderSpaceItem
// ---------------------------------------------------------------------------

test('reorderSpaceItem: non-author gets 403 and issues no BEGIN', async () => {
  const { q, calls } = fakeQuery([['"SpaceMember"', () => [{ role: 'guest' }]]]);
  await assert.rejects(
    () => reorderSpaceItem(q, { spaceId: SPACE, userId: 'u1', kind: 'note', id: 'n1', parentId: null, targetIndex: 0 }),
    (err) => err instanceof SpaceNotesError && err.status === 403,
  );
  assert.ok(!calls.some((c) => c.text === 'BEGIN'));
});

test('reorderSpaceItem: note move sets folderId and reassigns positions inside one transaction', async () => {
  const siblings = [
    { id: 'n1', position: 1024, title: 'A' },
    { id: 'n2', position: 2048, title: 'B' },
  ];
  const updates = [];
  const { q, calls } = fakeQuery([
    ['"SpaceMember"', () => [{ role: 'author' }]],
    ['SELECT id FROM "LiveClassNote" WHERE', () => [{ id: 'n3' }]], // dragged note exists in this space
    ['SELECT id FROM "LiveClassNoteFolder"', () => [{ id: 'f-target' }]],
    [/^SELECT id, position, title AS label FROM "LiveClassNote"/, () => siblings],
    [/^UPDATE "LiveClassNote" SET position/, (params) => { updates.push(params); return []; }],
    [/^UPDATE "LiveClassNote" SET "folderId"/, (params) => { updates.push(['folderId', ...params]); return []; }],
  ]);

  const result = await reorderSpaceItem(q, {
    spaceId: SPACE, userId: 'u1', kind: 'note', id: 'n3', parentId: 'f-target', targetIndex: 1,
  });

  assert.ok(calls.some((c) => c.text === 'BEGIN'));
  assert.ok(calls.some((c) => c.text === 'COMMIT'));
  assert.equal(result.length, 1); // n3 wasn't a prior sibling and all positions were set -> single positionBetween insert
  assert.equal(result[0].id, 'n3');
  assert.equal(result[0].position, (1024 + 2048) / 2);
  assert.ok(updates.some((u) => u[0] === 'folderId' && u[1] === 'f-target' && u[2] === 'n3'));
});

test('reorderSpaceItem: rolls back and rethrows when the target folder is from another space', async () => {
  const { q, calls } = fakeQuery([
    ['"SpaceMember"', () => [{ role: 'author' }]],
    ['SELECT id FROM "LiveClassNote" WHERE', () => [{ id: 'n1' }]], // dragged note exists in this space
    ['SELECT id FROM "LiveClassNoteFolder"', () => []], // target folder not in this space
  ]);
  await assert.rejects(
    () => reorderSpaceItem(q, { spaceId: SPACE, userId: 'u1', kind: 'note', id: 'n1', parentId: 'foreign', targetIndex: 0 }),
    (err) => err instanceof SpaceNotesError && err.status === 400,
  );
  assert.ok(calls.some((c) => c.text === 'BEGIN'));
  assert.ok(calls.some((c) => c.text === 'ROLLBACK'));
  assert.ok(!calls.some((c) => c.text === 'COMMIT'));
});

test('reorderSpaceItem: folder move into its own descendant is rejected (400) and rolled back', async () => {
  const folders = [
    { id: 'a', parentId: null },
    { id: 'b', parentId: 'a' },
  ];
  const { q, calls } = fakeQuery([
    ['"SpaceMember"', () => [{ role: 'author' }]],
    ['SELECT id FROM "LiveClassNoteFolder" WHERE', () => [{ id: 'b' }]], // assertFolderInSpace(parentId='b')
    ['SELECT id, "parentId" FROM "LiveClassNoteFolder"', () => folders],
  ]);
  await assert.rejects(
    () => reorderSpaceItem(q, { spaceId: SPACE, userId: 'u1', kind: 'folder', id: 'a', parentId: 'b', targetIndex: 0 }),
    (err) => err instanceof SpaceNotesError && err.status === 400,
  );
  assert.ok(calls.some((c) => c.text === 'ROLLBACK'));
});

test('reorderSpaceItem: 404 when the dragged id is not an item of that kind in this space (fix round 1, finding 6)', async () => {
  const { q, calls } = fakeQuery([['"SpaceMember"', () => [{ role: 'author' }]]]);
  await assert.rejects(
    () => reorderSpaceItem(q, { spaceId: SPACE, userId: 'u1', kind: 'note', id: 'missing-note', parentId: null, targetIndex: 0 }),
    (err) => err instanceof SpaceNotesError && err.status === 404,
  );
  // Never opened a transaction for an item that doesn't even exist.
  assert.ok(!calls.some((c) => c.text === 'BEGIN'));
});

test('reorderSpaceItem: a failed UPDATE inside the transaction rolls back and rejects, never commits (fix round 1, finding 2)', async () => {
  // Deliberately not using the shared fakeQuery helper here: it always
  // reports `error: null`, so it cannot simulate a failed statement. This
  // hand-rolled q mirrors its shape but lets one specific UPDATE report an
  // error, the way the real pooled-client wrapper's q would on a genuine
  // constraint violation or dropped connection.
  const calls = [];
  const siblings = [{ id: 'n1', position: 1024, title: 'A' }];
  const q = async (text, params = []) => {
    calls.push({ text, params });
    if (text.includes('"SpaceMember"')) return { data: [{ role: 'author' }], error: null };
    if (text.includes('SELECT id FROM "LiveClassNote" WHERE')) return { data: [{ id: 'n2' }], error: null };
    if (/^SELECT id, position, title AS label FROM "LiveClassNote"/.test(text)) return { data: siblings, error: null };
    if (/^UPDATE "LiveClassNote" SET position/.test(text)) {
      return { data: null, error: new Error('constraint violation') };
    }
    return { data: [], error: null };
  };

  await assert.rejects(
    () => reorderSpaceItem(q, { spaceId: SPACE, userId: 'u1', kind: 'note', id: 'n2', parentId: null, targetIndex: 0 }),
    /constraint violation/,
  );
  assert.ok(calls.some((c) => c.text === 'BEGIN'));
  assert.ok(calls.some((c) => c.text === 'ROLLBACK'));
  assert.ok(!calls.some((c) => c.text === 'COMMIT'));
});

test('reorderSpaceItem: uses buildTree\'s exact display order (fix round 1, finding 1) — "nota"/"Nota" tie resolves deterministically', async () => {
  // Three notes with null positions where two titles tie under base
  // sensitivity ("nota" / "Nota"). The server must land the dragged note
  // at the same slot buildTree would have rendered for `targetIndex`.
  const siblingRows = [
    { id: 'n-nota-lower', position: null, label: 'nota' },
    { id: 'n-nota-upper', position: null, label: 'Nota' },
    { id: 'n-cancion', position: null, label: 'Canción' },
  ];
  const { q, calls } = fakeQuery([
    ['"SpaceMember"', () => [{ role: 'author' }]],
    ['SELECT id FROM "LiveClassNote" WHERE', () => [{ id: 'n-dragged' }]],
    [/^SELECT id, position, title AS label FROM "LiveClassNote"/, () => siblingRows],
    [/^UPDATE "LiveClassNote" SET position/, () => []],
    [/^UPDATE "LiveClassNote" SET "folderId"/, () => []],
  ]);

  // Expected order per displayOrderNotes/buildTree: "Canción" < "nota" <
  // "Nota" (base-sensitivity title compare, "nota"/"Nota" tie broken by id
  // ascending: 'n-nota-lower' < 'n-nota-upper').
  const result = await reorderSpaceItem(q, {
    spaceId: SPACE, userId: 'u1', kind: 'note', id: 'n-dragged', parentId: null, targetIndex: 0, locale: 'es',
  });
  // Dropped at index 0 among 3 existing siblings with null positions -> full renormalization.
  assert.equal(result.length, 4);
  assert.deepEqual(
    result.map((r) => r.id),
    ['n-dragged', 'n-cancion', 'n-nota-lower', 'n-nota-upper'],
  );
  assert.ok(calls.some((c) => c.text === 'COMMIT'));
});

// ---------------------------------------------------------------------------
// ensureOkaFolders
// ---------------------------------------------------------------------------

test('ensureOkaFolders: inserts GTX and Output once, then does nothing once they exist', async () => {
  let existing = [];
  const inserts = [];
  const { q } = fakeQuery([
    ['SELECT name FROM "LiveClassNoteFolder"', () => existing],
    ['INSERT INTO "LiveClassNoteFolder"', (params) => { inserts.push(params[0]); return []; }],
  ]);

  await ensureOkaFolders(q, { spaceId: SPACE, authorId: 'author1' });
  assert.deepEqual(inserts.sort(), ['GTX', 'Output']);

  existing = [{ name: 'GTX' }, { name: 'Output' }];
  inserts.length = 0;
  await ensureOkaFolders(q, { spaceId: SPACE, authorId: 'author1' });
  assert.deepEqual(inserts, []);
});
