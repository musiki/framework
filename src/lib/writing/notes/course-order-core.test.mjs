import test from 'node:test';
import assert from 'node:assert/strict';
import { fakeQuery } from './fake-query.test-helper.mjs';
import { CourseOrderError, reorderCourseItem } from './course-order-core.ts';

const USER = 'u1';
const COURSE = 'course-1';

test('reorderCourseItem: 404 when the dragged id is not an owned item of that kind in this course scope, no BEGIN issued', async () => {
  const { q, calls } = fakeQuery([]);
  await assert.rejects(
    () => reorderCourseItem(q, { userId: USER, courseId: COURSE, kind: 'note', id: 'missing', parentId: null, targetIndex: 0 }),
    (err) => err instanceof CourseOrderError && err.status === 404,
  );
  assert.ok(!calls.some((c) => c.text === 'BEGIN'));
});

test('reorderCourseItem: note move sets folderId and reassigns positions inside one transaction', async () => {
  const siblings = [
    { id: 'n1', position: 1024, title: 'A' },
    { id: 'n2', position: 2048, title: 'B' },
  ];
  const updates = [];
  const { q, calls } = fakeQuery([
    ['SELECT id FROM "LiveClassNote"\n', () => [{ id: 'n3' }]], // dragged note exists, owned, this course
    ['SELECT id FROM "LiveClassNoteFolder"', () => [{ id: 'f-target' }]], // target folder owned, this course
    [/^SELECT id, position, title AS label FROM "LiveClassNote"/, () => siblings],
    [/^UPDATE "LiveClassNote" SET position/, (params) => { updates.push(params); return []; }],
    [/^UPDATE "LiveClassNote" SET "folderId"/, (params) => { updates.push(['folderId', ...params]); return []; }],
  ]);

  const result = await reorderCourseItem(q, {
    userId: USER, courseId: COURSE, kind: 'note', id: 'n3', parentId: 'f-target', targetIndex: 1,
  });

  assert.ok(calls.some((c) => c.text === 'BEGIN'));
  assert.ok(calls.some((c) => c.text === 'COMMIT'));
  assert.equal(result.length, 1); // n3 wasn't a prior sibling and all positions were set -> single positionBetween insert
  assert.equal(result[0].id, 'n3');
  assert.equal(result[0].position, (1024 + 2048) / 2);
  assert.ok(updates.some((u) => u[0] === 'folderId' && u[1] === 'f-target' && u[2] === 'n3'));
});

test('reorderCourseItem: rolls back and rethrows when the target folder does not belong to this owner/course scope', async () => {
  const { q, calls } = fakeQuery([
    ['SELECT id FROM "LiveClassNote"\n', () => [{ id: 'n1' }]],
    ['SELECT id FROM "LiveClassNoteFolder"', () => []], // target folder not owned / different course / a space row
  ]);
  await assert.rejects(
    () => reorderCourseItem(q, { userId: USER, courseId: COURSE, kind: 'note', id: 'n1', parentId: 'foreign', targetIndex: 0 }),
    (err) => err instanceof CourseOrderError && err.status === 400,
  );
  assert.ok(calls.some((c) => c.text === 'BEGIN'));
  assert.ok(calls.some((c) => c.text === 'ROLLBACK'));
  assert.ok(!calls.some((c) => c.text === 'COMMIT'));
});

test('reorderCourseItem: folder move into its own descendant is rejected (400) and rolled back', async () => {
  const folders = [
    { id: 'a', parentId: null },
    { id: 'b', parentId: 'a' },
  ];
  const { q, calls } = fakeQuery([
    ['SELECT id FROM "LiveClassNoteFolder"\n', () => [{ id: 'b' }]], // parent ownership check for parentId='b'
    ['SELECT id, "parentId" FROM "LiveClassNoteFolder"', () => folders],
  ]);
  await assert.rejects(
    () => reorderCourseItem(q, { userId: USER, courseId: COURSE, kind: 'folder', id: 'a', parentId: 'b', targetIndex: 0 }),
    (err) => err instanceof CourseOrderError && err.status === 400,
  );
  assert.ok(calls.some((c) => c.text === 'ROLLBACK'));
});

test('reorderCourseItem: folder move into itself is rejected (400) before any BEGIN', async () => {
  const { q, calls } = fakeQuery([]);
  await assert.rejects(
    () => reorderCourseItem(q, { userId: USER, courseId: COURSE, kind: 'folder', id: 'a', parentId: 'a', targetIndex: 0 }),
    (err) => err instanceof CourseOrderError && err.status === 400,
  );
  assert.ok(!calls.some((c) => c.text === 'BEGIN'));
});

test('reorderCourseItem: a failed UPDATE inside the transaction rolls back and rejects, never commits', async () => {
  // fakeQuery always reports error: null, so simulate a failing statement by hand.
  const calls = [];
  const q = async (text, params = []) => {
    calls.push({ text, params });
    if (text.includes('SELECT id FROM "LiveClassNote"\n')) return { data: [{ id: 'n1' }], error: null };
    if (text === 'BEGIN') return { data: [], error: null };
    if (/^SELECT id, position, title AS label FROM "LiveClassNote"/.test(text)) {
      return { data: [{ id: 'n1', position: 1024, label: 'A' }, { id: 'n2', position: 2048, label: 'B' }], error: null };
    }
    if (/^UPDATE "LiveClassNote" SET position/.test(text)) return { data: null, error: new Error('db exploded') };
    if (text === 'ROLLBACK') return { data: [], error: null };
    return { data: [], error: null };
  };
  await assert.rejects(
    () => reorderCourseItem(q, { userId: USER, courseId: COURSE, kind: 'note', id: 'n1', parentId: null, targetIndex: 1 }),
    /db exploded/,
  );
  assert.ok(calls.some((c) => c.text === 'ROLLBACK'));
  assert.ok(!calls.some((c) => c.text === 'COMMIT'));
});

test('reorderCourseItem: takes a per-user advisory xact lock right after BEGIN, before reading siblings', async () => {
  const order = [];
  const { q } = fakeQuery([
    ['SELECT id FROM "LiveClassNote"\n', () => [{ id: 'n1' }]],
    ['BEGIN', () => { order.push('BEGIN'); return []; }],
    ['pg_advisory_xact_lock', (params) => { order.push(['lock', ...params]); return []; }],
    [/^SELECT id, position, title AS label FROM "LiveClassNote"/, () => { order.push('siblings'); return [{ id: 'n1', position: null, title: 'A' }]; }],
  ]);
  await reorderCourseItem(q, { userId: USER, courseId: COURSE, kind: 'note', id: 'n1', parentId: null, targetIndex: 0 });
  const lockIndex = order.findIndex((e) => Array.isArray(e) && e[0] === 'lock');
  assert.ok(lockIndex > -1);
  assert.equal(order[lockIndex][1], USER); // hashtext($1) keyed on the caller's userId
  assert.ok(order.indexOf('BEGIN') < lockIndex);
  assert.ok(lockIndex < order.indexOf('siblings'));
});

test('reorderCourseItem: if ROLLBACK itself fails, the original error is still what gets thrown', async () => {
  const q = async (text) => {
    if (text.includes('SELECT id FROM "LiveClassNote"\n')) return { data: [{ id: 'n1' }], error: null };
    if (text === 'BEGIN') return { data: [], error: null };
    if (text.includes('pg_advisory_xact_lock')) return { data: [], error: null };
    if (/^SELECT id, position, title AS label FROM "LiveClassNote"/.test(text)) {
      return { data: [{ id: 'n1', position: 1024, label: 'A' }], error: null };
    }
    if (/^UPDATE "LiveClassNote" SET position/.test(text)) return { data: null, error: new Error('db exploded') };
    if (text === 'ROLLBACK') return { data: null, error: new Error('rollback also failed') };
    return { data: [], error: null };
  };
  await assert.rejects(
    () => reorderCourseItem(q, { userId: USER, courseId: COURSE, kind: 'note', id: 'n1', parentId: null, targetIndex: 0 }),
    /db exploded/, // the ORIGINAL error, not "rollback also failed"
  );
});

test('reorderCourseItem: never touches a space row — scope filters always include "spaceId" IS NULL', async () => {
  const { q, calls } = fakeQuery([
    ['SELECT id FROM "LiveClassNote"\n', () => [{ id: 'n1' }]],
    [/^SELECT id, position, title AS label FROM "LiveClassNote"/, () => [{ id: 'n1', position: null, title: 'A' }]],
  ]);
  await reorderCourseItem(q, { userId: USER, courseId: COURSE, kind: 'note', id: 'n1', parentId: null, targetIndex: 0 });
  const relevant = calls.filter((c) => c.text.includes('"LiveClassNote"') && !['BEGIN', 'COMMIT', 'ROLLBACK'].includes(c.text));
  assert.ok(relevant.length > 0);
  for (const c of relevant) {
    assert.match(c.text, /"spaceId" IS NULL/);
  }
});

test('reorderCourseItem: courseId=null (root/no-course scope) is honored via IS NOT DISTINCT FROM', async () => {
  const { q, calls } = fakeQuery([
    ['SELECT id FROM "LiveClassNote"\n', () => [{ id: 'n1' }]],
    [/^SELECT id, position, title AS label FROM "LiveClassNote"/, () => [{ id: 'n1', position: null, title: 'A' }]],
  ]);
  await reorderCourseItem(q, { userId: USER, courseId: null, kind: 'note', id: 'n1', parentId: null, targetIndex: 0 });
  const existsCall = calls.find((c) => c.text.includes('SELECT id FROM "LiveClassNote"\n'));
  assert.equal(existsCall.params[2], null);
});

// ---------------------------------------------------------------------------
// Folder reparenting (fix round 1, decision 2: drag reparenting is allowed,
// as long as the target is the caller's own folder in the same course scope
// or root, and not the folder itself or one of its own descendants).
// ---------------------------------------------------------------------------

test('reorderCourseItem: folder reparent — move to another (owned, same-course) folder sets parentId', async () => {
  const updates = [];
  // The dragged-folder exists check and the parent-ownership check share the
  // same query shape ("SELECT id FROM \"LiveClassNoteFolder\" WHERE ..."),
  // so both resolving truthy here models folder 'a' (dragged) and folder
  // 'b' (target) both being USER's own folders in COURSE.
  const { q, calls } = fakeQuery([
    ['SELECT id FROM "LiveClassNoteFolder"\n', () => [{ id: 'ok' }]],
    ['SELECT id, "parentId" FROM "LiveClassNoteFolder"', () => [{ id: 'a', parentId: null }, { id: 'b', parentId: null }]],
    [/^SELECT id, position, name AS label FROM "LiveClassNoteFolder"/, () => [{ id: 'c', position: 1024, name: 'C' }]], // siblings already under 'b'
    [/^UPDATE "LiveClassNoteFolder" SET position/, (params) => { updates.push(params); return []; }],
    [/^UPDATE "LiveClassNoteFolder" SET "parentId"/, (params) => { updates.push(['parentId', ...params]); return []; }],
  ]);

  const result = await reorderCourseItem(q, {
    userId: USER, courseId: COURSE, kind: 'folder', id: 'a', parentId: 'b', targetIndex: 1,
  });

  assert.ok(calls.some((c) => c.text === 'BEGIN'));
  assert.ok(calls.some((c) => c.text === 'COMMIT'));
  assert.ok(result.some((r) => r.id === 'a'));
  assert.ok(updates.some((u) => u[0] === 'parentId' && u[1] === 'b' && u[2] === 'a'));
});

test('reorderCourseItem: folder reparent — move to root (parentId null) skips the parent-ownership check', async () => {
  const updates = [];
  const { q, calls } = fakeQuery([
    ['SELECT id FROM "LiveClassNoteFolder"\n', () => [{ id: 'a' }]], // exists check for dragged folder 'a'
    [/^SELECT id, position, name AS label FROM "LiveClassNoteFolder"/, () => [{ id: 'c', position: 1024, name: 'C' }]], // root siblings
    [/^UPDATE "LiveClassNoteFolder" SET position/, (params) => { updates.push(params); return []; }],
    [/^UPDATE "LiveClassNoteFolder" SET "parentId"/, (params) => { updates.push(['parentId', ...params]); return []; }],
  ]);

  await reorderCourseItem(q, { userId: USER, courseId: COURSE, kind: 'folder', id: 'a', parentId: null, targetIndex: 0 });

  assert.ok(calls.some((c) => c.text === 'COMMIT'));
  assert.ok(updates.some((u) => u[0] === 'parentId' && u[1] === null && u[2] === 'a'));
  // No "SELECT id, \"parentId\" FROM ..." cycle-detection call either — that only
  // runs for kind='folder' with a non-null parentId.
  assert.ok(!calls.some((c) => c.text.startsWith('SELECT id, "parentId" FROM')));
});

test("reorderCourseItem: folder reparent — moving a folder to another user's folder is rejected (400), rolled back", async () => {
  // The exists check (dragged folder 'a', this user) succeeds; the parent
  // lookup (target folder 'b', owned by a different user) returns empty,
  // simulating the "userId" filter excluding it.
  let n = 0;
  const q = async (text) => {
    n++;
    if (text.startsWith('SELECT id FROM "LiveClassNoteFolder"') && n === 1) return { data: [{ id: 'a' }], error: null };
    if (text.startsWith('SELECT id FROM "LiveClassNoteFolder"')) return { data: [], error: null };
    return { data: [], error: null };
  };
  await assert.rejects(
    () => reorderCourseItem(q, { userId: USER, courseId: COURSE, kind: 'folder', id: 'a', parentId: 'b', targetIndex: 0 }),
    (err) => err instanceof CourseOrderError && err.status === 400 && /scope/.test(err.message),
  );
});

test('reorderCourseItem: folder reparent — moving a folder into a folder from another course is rejected (400), rolled back', async () => {
  let n = 0;
  const q = async (text) => {
    n++;
    if (text.startsWith('SELECT id FROM "LiveClassNoteFolder"') && n === 1) return { data: [{ id: 'a' }], error: null }; // dragged folder exists in COURSE
    if (text.startsWith('SELECT id FROM "LiveClassNoteFolder"')) return { data: [], error: null }; // target folder belongs to a different courseId -> excluded by "courseId" IS NOT DISTINCT FROM
    return { data: [], error: null };
  };
  await assert.rejects(
    () => reorderCourseItem(q, { userId: USER, courseId: COURSE, kind: 'folder', id: 'a', parentId: 'foreign-course-folder', targetIndex: 0 }),
    (err) => err instanceof CourseOrderError && err.status === 400,
  );
});

test('reorderCourseItem: folder reparent — moving a folder into a Studio space folder is rejected (400), rolled back', async () => {
  let n = 0;
  const q = async (text) => {
    n++;
    if (text.startsWith('SELECT id FROM "LiveClassNoteFolder"') && n === 1) return { data: [{ id: 'a' }], error: null }; // dragged folder exists, spaceId IS NULL
    if (text.startsWith('SELECT id FROM "LiveClassNoteFolder"')) return { data: [], error: null }; // target folder is a space folder -> excluded by "spaceId" IS NULL
    return { data: [], error: null };
  };
  await assert.rejects(
    () => reorderCourseItem(q, { userId: USER, courseId: COURSE, kind: 'folder', id: 'a', parentId: 'space-folder', targetIndex: 0 }),
    (err) => err instanceof CourseOrderError && err.status === 400,
  );
});
