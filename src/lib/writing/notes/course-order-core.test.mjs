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
