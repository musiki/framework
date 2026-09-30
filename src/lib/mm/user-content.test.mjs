import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MERGE_REPOINT_COLUMNS, repointMergedUserContent, findSpaceScopedContent, deleteBlockedMessage,
} from './user-content.ts';

const KEEP = 'keep-id';
const MERGE = 'merge-id';

test('merge re-points concept AND forum user columns', () => {
  const cols = MERGE_REPOINT_COLUMNS.map(([t, c]) => `${t}.${c}`);
  for (const c of ['Concept.createdBy', 'ConceptVersion.editedBy', 'ConceptVersion.creditedUserId', 'ConceptRelation.createdBy',
    'ConceptRelation.settledBy', 'RelationType.createdBy', 'ForumBoard.createdByUserId', 'ForumThread.createdByUserId', 'ForumPost.authorUserId']) {
    assert.ok(cols.includes(c), c);
  }
});

test('repoint: duplicate votes dropped first, then moved; every column updated', async () => {
  const calls = [];
  const q = async (text, params) => { calls.push({ text, params }); return { data: [], error: null }; };
  assert.deepEqual(await repointMergedUserContent(q, KEEP, MERGE), { ok: true });
  assert.match(calls[0].text, /DELETE FROM "ForumPostVote" m WHERE m\."userId" = \$2\s+AND EXISTS \(SELECT 1 FROM "ForumPostVote" k WHERE k\."userId" = \$1 AND k\."postId" = m\."postId"\)/);
  assert.match(calls[1].text, /UPDATE "ForumPostVote" SET "userId" = \$1 WHERE "userId" = \$2/);
  // Relation stances: one per (relation, user) — duplicates dropped, the rest re-pointed.
  assert.match(calls[2].text, /DELETE FROM "ConceptRelationStance" m WHERE m\."userId" = \$2\s+AND EXISTS \(SELECT 1 FROM "ConceptRelationStance" k WHERE k\."userId" = \$1 AND k\."relationId" = m\."relationId"\)/);
  assert.match(calls[3].text, /UPDATE "ConceptRelationStance" SET "userId" = \$1 WHERE "userId" = \$2/);
  for (const c of calls) assert.deepEqual(c.params, [KEEP, MERGE]);
  for (const [t, c] of MERGE_REPOINT_COLUMNS) {
    assert.ok(calls.some((x) => x.text === `UPDATE "${t}" SET "${c}" = $1 WHERE "${c}" = $2`), `${t}.${c}`);
  }
});

test('repoint: missing mm schema is skipped, other errors abort', async () => {
  const missing = async () => ({ data: null, error: { code: '42P01', message: 'no table' } });
  assert.deepEqual(await repointMergedUserContent(missing, KEEP, MERGE), { ok: true });
  const broken = async (text) => (text.includes('"ForumPost" SET')
    ? { data: null, error: { code: '23503', message: 'fk' } }
    : { data: [], error: null });
  assert.deepEqual(await repointMergedUserContent(broken, KEEP, MERGE), { ok: false, error: 'fk' });
});

test('findSpaceScopedContent lists kinds of space content (space-scoped forum only)', async () => {
  const q = async (text, params) => {
    assert.deepEqual(params, ['u1']);
    if (text.includes('FROM "ForumPost" p')) return { data: [{ '?column?': 1 }], error: null };
    if (text.includes('FROM "Concept"')) return { data: [{ x: 1 }], error: null };
    if (text.includes('"ConceptRelation"')) return { data: null, error: { code: '42P01' } };
    return { data: [], error: null };
  };
  assert.deepEqual(await findSpaceScopedContent(q, 'u1'), ['forum posts', 'concepts']);
  const none = async () => ({ data: [], error: null });
  assert.deepEqual(await findSpaceScopedContent(none, 'u1'), []);
  await assert.rejects(findSpaceScopedContent(async () => ({ data: null, error: { code: 'XX', message: 'boom' } }), 'u1'));
});

test('forum probes only match space-scoped rows (course forum users can still be deleted)', async () => {
  const texts = [];
  await findSpaceScopedContent(async (t) => { texts.push(t); return { data: [], error: null }; }, 'u');
  for (const t of texts.filter((t) => t.includes('Forum'))) assert.match(t, /"spaceId" IS NOT NULL/);
});

test('delete refusal message tells the admin to merge', () => {
  assert.match(deleteBlockedMessage(['forum posts']), /forum posts/);
  assert.match(deleteBlockedMessage(['forum posts']), /[Mm]erge/);
});

test('relation stances do not block an account deletion (they cascade)', async () => {
  const texts = [];
  await findSpaceScopedContent(async (t) => { texts.push(t); return { data: [], error: null }; }, 'u');
  assert.ok(!texts.some((t) => t.includes('ConceptRelationStance')));
});
