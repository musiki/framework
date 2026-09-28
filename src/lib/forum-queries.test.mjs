// Characterization of the musiki course forum SQL (src/pages/api/forum/*),
// extracted verbatim into forum-queries.ts. These pin the current behaviour:
// tables, filters, ordering, limits and parameter order, and the board
// activity aggregation. The route files call these helpers with the pool's
// `query`, so what is pinned here is what the routes run.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as sql from './forum-queries.ts';

const norm = (s) => s.replace(/\s+/g, ' ').trim();

function recorder(handler = () => []) {
  const calls = [];
  const q = async (text, params = []) => {
    calls.push({ text: norm(text), params });
    const out = handler(norm(text), params);
    if (out && !Array.isArray(out) && 'error' in out) return { data: null, error: out.error };
    return { data: out ?? [], error: null };
  };
  return { q, calls };
}

function includesAll(text, fragments) {
  for (const f of fragments) assert.ok(text.includes(norm(f)), `expected SQL to include: ${f}\n  got: ${text}`);
}

test('courseIdsFor: aliases when present, otherwise the canonical id', () => {
  assert.deepEqual(sql.courseIdsFor('c1', []), ['c1']);
  assert.deepEqual(sql.courseIdsFor('c1', ['c1', 'old-c1']), ['c1', 'old-c1']);
});

test('pickNewestTimestamp keeps the later timestamp and tolerates null/invalid', () => {
  assert.equal(sql.pickNewestTimestamp(null, '2026-01-01T00:00:00Z'), '2026-01-01T00:00:00Z');
  assert.equal(sql.pickNewestTimestamp('2026-01-01T00:00:00Z', null), '2026-01-01T00:00:00Z');
  assert.equal(sql.pickNewestTimestamp('2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z'), '2026-02-01T00:00:00Z');
  assert.equal(sql.pickNewestTimestamp('2026-02-01T00:00:00Z', '2026-01-01T00:00:00Z'), '2026-02-01T00:00:00Z');
  assert.equal(sql.pickNewestTimestamp('nope', '2026-01-01T00:00:00Z'), '2026-01-01T00:00:00Z');
  assert.equal(sql.pickNewestTimestamp('2026-01-01T00:00:00Z', 'nope'), '2026-01-01T00:00:00Z');
});

test('boards: default board lookup, list and by-slug are course-scoped and skip archived', async () => {
  const { q, calls } = recorder();
  await sql.selectDefaultBoard(q, ['c1']);
  await sql.listCourseBoards(q, ['c1', 'c1-old']);
  await sql.selectCourseBoardBySlug(q, ['c1'], 'teoria');
  await sql.selectActiveBoardId(q, ['c1'], 'teoria');

  includesAll(calls[0].text, ['FROM "ForumBoard"', '"courseId" = ANY($1)', '"slug" = $2', '"isArchived" = false']);
  assert.deepEqual(calls[0].params, [['c1'], 'general']);

  includesAll(calls[1].text, ['FROM "ForumBoard"', '"courseId" = ANY($1)', '"isArchived" = false', 'ORDER BY "isDefault" DESC, "title" ASC']);
  assert.deepEqual(calls[1].params, [['c1', 'c1-old']]);

  includesAll(calls[2].text, ['"courseId" = ANY($1)', '"slug" = $2', '"isArchived" = false']);
  assert.deepEqual(calls[2].params, [['c1'], 'teoria']);

  includesAll(calls[3].text, ['SELECT "id" FROM "ForumBoard"', '"courseId" = ANY($1)', '"slug" = $2', 'LIMIT 1']);
  assert.deepEqual(calls[3].params, [['c1'], 'teoria']);
});

test('boards: insert (default with ON CONFLICT, created with RETURNING), rename, archive', async () => {
  const { q, calls } = recorder();
  const row = {
    id: 'b1', courseId: 'c1', slug: 'general', title: 'General', description: 'Foro general del curso',
    createdByUserId: 'u1', isDefault: true, isArchived: false, createdAt: 't', updatedAt: 't',
  };
  await sql.insertBoard(q, row, { onConflictDoNothing: true });
  await sql.insertBoard(q, { ...row, slug: 'teoria', isDefault: false }, { returning: true });
  await sql.updateBoardTitle(q, 'b1', 'Nuevo', 't2');
  await sql.archiveBoard(q, 'b1', 't3');

  includesAll(calls[0].text, ['INSERT INTO "ForumBoard"', 'ON CONFLICT ("courseId", "slug") DO NOTHING']);
  assert.ok(!calls[0].text.includes('RETURNING'));
  assert.deepEqual(calls[0].params, ['b1', 'c1', 'general', 'General', 'Foro general del curso', 'u1', true, false, 't', 't']);

  includesAll(calls[1].text, ['INSERT INTO "ForumBoard"', 'RETURNING "id", "courseId", "slug"']);
  assert.ok(!calls[1].text.includes('ON CONFLICT'));

  includesAll(calls[2].text, ['UPDATE "ForumBoard" SET "title" = $1, "updatedAt" = $2 WHERE "id" = $3', 'RETURNING']);
  assert.deepEqual(calls[2].params, ['Nuevo', 't2', 'b1']);

  includesAll(calls[3].text, ['UPDATE "ForumBoard" SET "isArchived" = true, "updatedAt" = $1 WHERE "id" = $2']);
  assert.deepEqual(calls[3].params, ['t3', 'b1']);
});

test('loadBoardActivityMap aggregates non-deleted posts per @board: slug', async () => {
  const { q, calls } = recorder((text) => {
    if (text.includes('FROM "ForumThread"')) {
      return [
        { id: 't1', lessonSlug: '@board:Teoria', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z' },
        { id: 't2', lessonSlug: '@board:teoria', createdAt: '2026-01-03T00:00:00Z', updatedAt: null },
        { id: 't3', lessonSlug: '@board:general', createdAt: '2026-01-01T00:00:00Z', updatedAt: null },
        { id: 't4', lessonSlug: 'lesson-1', createdAt: '2026-05-01T00:00:00Z', updatedAt: null },
      ];
    }
    if (text.includes('FROM "ForumPost"')) {
      return [
        { threadId: 't1', createdAt: '2026-01-05T00:00:00Z' },
        { threadId: 't1', createdAt: '2026-01-04T00:00:00Z' },
        { threadId: 't2', createdAt: '2026-01-06T00:00:00Z' },
        { threadId: 'unknown', createdAt: '2027-01-01T00:00:00Z' },
      ];
    }
    return [];
  });
  const map = await sql.loadBoardActivityMap(q, 'c1', ['c1', 'c1-old']);

  includesAll(calls[0].text, ['FROM "ForumThread"', '"courseId" = ANY($1)', '"lessonSlug" LIKE $2', 'LIMIT 2000']);
  assert.deepEqual(calls[0].params, [['c1', 'c1-old'], '@board:%']);
  includesAll(calls[1].text, ['FROM "ForumPost"', '"threadId" = ANY($1)', `("status" IS NULL OR "status" <> 'deleted')`]);
  assert.deepEqual(calls[1].params, [['t1', 't2', 't3']]);

  assert.deepEqual(Object.fromEntries(map), {
    teoria: { messageCount: 3, lastActivityAt: '2026-01-06T00:00:00Z' },
    general: { messageCount: 0, lastActivityAt: '2026-01-01T00:00:00Z' },
  });
});

test('loadBoardActivityMap: no threads -> no post query; errors are thrown', async () => {
  const empty = recorder(() => []);
  assert.equal((await sql.loadBoardActivityMap(empty.q, 'c1', [])).size, 0);
  assert.equal(empty.calls.length, 1);
  assert.deepEqual(empty.calls[0].params[0], ['c1']);

  const failing = recorder(() => ({ error: new Error('boom') }));
  await assert.rejects(sql.loadBoardActivityMap(failing.q, 'c1', []), /boom/);
});

test('threads: list by scope, activity, users, insert thread + first post, cleanup', async () => {
  const { q, calls } = recorder();
  await sql.listThreadsByScope(q, ['c1'], '@board:teoria', 100);
  await sql.selectThreadPostActivity(q, ['t1']);
  await sql.selectUsersByIds(q, ['u1']);
  await sql.insertThread(q, { id: 't1', courseId: 'c1', lessonSlug: 'lesson-1', title: 'Hola', createdByUserId: 'u1', now: 'n' });
  await sql.insertFirstPost(q, { id: 'p1', threadId: 't1', authorUserId: 'u1', body: 'b', now: 'n' });
  await sql.deleteNewThread(q, 't1');

  includesAll(calls[0].text, [
    'FROM "ForumThread"', '"courseId" = ANY($1)', '"lessonSlug" = $2', 'ORDER BY "isPinned" DESC, "updatedAt" DESC', 'LIMIT $3',
  ]);
  assert.deepEqual(calls[0].params, [['c1'], '@board:teoria', 100]);
  includesAll(calls[1].text, ['SELECT "threadId", "createdAt", "parentPostId"', '"threadId" = ANY($1)', `"status" <> 'deleted'`]);
  includesAll(calls[2].text, ['SELECT "id", "name", "email", "image" FROM "User" WHERE "id" = ANY($1)']);
  includesAll(calls[3].text, ['INSERT INTO "ForumThread" ("id", "courseId", "lessonSlug", "title", "createdByUserId", "isPinned", "isLocked", "createdAt", "updatedAt")']);
  assert.deepEqual(calls[3].params, ['t1', 'c1', 'lesson-1', 'Hola', 'u1', false, false, 'n', 'n']);
  includesAll(calls[4].text, ['INSERT INTO "ForumPost"', 'RETURNING "id", "createdAt"']);
  assert.deepEqual(calls[4].params, ['p1', 't1', 'u1', null, 'b', 'published', 'n', 'n']);
  includesAll(calls[5].text, ['DELETE FROM "ForumThread" WHERE "id" = $1']);
  assert.deepEqual(calls[5].params, ['t1']);
});

test('thread by id: edit/posts lookups, dynamic update and delete', async () => {
  const { q, calls } = recorder();
  await sql.selectThreadForEdit(q, 't1');
  await sql.selectThreadForPosts(q, 't1');
  await sql.updateThread(q, 't1', { updatedAt: 'n', title: 'T', isPinned: true });
  await sql.deleteThread(q, 't1');

  includesAll(calls[0].text, ['SELECT id, "courseId", title, "createdByUserId", "isPinned", "isLocked"', 'FROM "ForumThread" WHERE id = $1']);
  assert.deepEqual(calls[0].params, ['t1']);
  includesAll(calls[1].text, ['SELECT id, "courseId", "lessonSlug", "createdByUserId", "isLocked" FROM "ForumThread" WHERE id = $1']);
  includesAll(calls[2].text, ['UPDATE "ForumThread" SET "updatedAt" = $1, "title" = $2, "isPinned" = $3 WHERE id = $4', 'RETURNING id, "courseId"']);
  assert.deepEqual(calls[2].params, ['n', 'T', true, 't1']);
  includesAll(calls[3].text, ['DELETE FROM "ForumThread" WHERE id = $1']);
});

test('posts: list with author join, reply insert', async () => {
  const { q, calls } = recorder();
  await sql.listThreadPosts(q, 't1', 500);
  await sql.insertReply(q, { threadId: 't1', authorUserId: 'u1', body: 'b', parentPostId: null, now: 'n' });

  includesAll(calls[0].text, [
    'SELECT p.*, u.name as "authorName"', 'FROM "ForumPost" p', 'LEFT JOIN "User" u ON p."authorUserId" = u.id',
    'p."threadId" = $1', 'ORDER BY p."createdAt" ASC', 'LIMIT $2',
  ]);
  assert.deepEqual(calls[0].params, ['t1', 500]);
  includesAll(calls[1].text, ['INSERT INTO "ForumPost" ( "threadId", "authorUserId", "body", "parentPostId", "createdAt", "updatedAt" )', 'RETURNING *']);
  assert.deepEqual(calls[1].params, ['t1', 'u1', 'b', null, 'n', 'n']);
});

test('post by id: edit/delete context, body/status update, thread touch', async () => {
  const { q, calls } = recorder();
  await sql.selectPostForEdit(q, 'p1');
  await sql.selectThreadOfPost(q, 't1');
  await sql.updatePostBodyStatus(q, 'p1', '', 'deleted', 'n');
  await sql.touchThread(q, 't1', 'n');

  includesAll(calls[0].text, ['FROM "ForumPost" WHERE id = $1']);
  assert.deepEqual(calls[0].params, ['p1']);
  includesAll(calls[1].text, ['SELECT id, "courseId", "createdByUserId", "isLocked" FROM "ForumThread" WHERE id = $1']);
  includesAll(calls[2].text, ['UPDATE "ForumPost" SET body = $1, status = $2, "updatedAt" = $3 WHERE id = $4', 'RETURNING id, "threadId"']);
  assert.deepEqual(calls[2].params, ['', 'deleted', 'n', 'p1']);
  includesAll(calls[3].text, ['UPDATE "ForumThread" SET "updatedAt" = $1 WHERE id = $2']);
  assert.deepEqual(calls[3].params, ['n', 't1']);
});

test('votes: context lookups, delete, upsert (one per user), list', async () => {
  const { q, calls } = recorder();
  await sql.selectPostForVote(q, 'p1');
  await sql.selectThreadForVote(q, 't1');
  await sql.deleteVote(q, 'p1', 'u1');
  await sql.upsertVote(q, 'p1', 'u1', 2);
  await sql.selectVotes(q, 'p1');

  includesAll(calls[0].text, ['SELECT "id", "threadId" FROM "ForumPost" WHERE "id" = $1', 'LIMIT 1']);
  includesAll(calls[1].text, ['SELECT "id", "courseId" FROM "ForumThread" WHERE "id" = $1', 'LIMIT 1']);
  includesAll(calls[2].text, ['DELETE FROM "ForumPostVote" WHERE "postId" = $1 AND "userId" = $2']);
  assert.deepEqual(calls[2].params, ['p1', 'u1']);
  includesAll(calls[3].text, ['INSERT INTO "ForumPostVote" ("postId", "userId", "value")', 'ON CONFLICT ("postId", "userId") DO UPDATE SET "value" = $3']);
  assert.deepEqual(calls[3].params, ['p1', 'u1', 2]);
  includesAll(calls[4].text, ['SELECT "userId", "value" FROM "ForumPostVote" WHERE "postId" = $1']);
});

test('helpers pass the query result through unchanged (routes keep their error handling)', async () => {
  const err = Object.assign(new Error('dup'), { code: '23505' });
  const { q } = recorder(() => ({ error: err }));
  const res = await sql.insertBoard(q, {
    id: 'b', courseId: 'c', slug: 's', title: 't', description: null, createdByUserId: 'u',
    isDefault: false, isArchived: false, createdAt: 'n', updatedAt: 'n',
  }, { returning: true });
  assert.equal(res.data, null);
  assert.equal(res.error, err);
});
