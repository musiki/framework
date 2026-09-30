import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MERGE_REPOINT_COLUMNS, MERGE_DROP_BLIND_STANCES_SQL, repointMergedUserContent, findSpaceScopedContent, deleteBlockedMessage,
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

test('repoint: blind stances deleted first; votes and revealed stances deduped then moved; every column updated', async () => {
  const calls = [];
  const q = async (text, params) => { calls.push({ text, params }); return { data: [], error: null }; };
  assert.deepEqual(await repointMergedUserContent(q, KEEP, MERGE), { ok: true });
  // 1. The merged user's stances on unrevealed relations are deleted — never handed to the kept account.
  assert.equal(calls[0].text, MERGE_DROP_BLIND_STANCES_SQL);
  assert.deepEqual(calls[0].params, [MERGE]);
  assert.match(calls[0].text, /DELETE FROM "ConceptRelationStance" m USING "ConceptRelation" r\s+WHERE m\."userId" = \$1 AND r\."id" = m\."relationId"/);
  assert.ok(calls[0].text.includes('(now() >= LEAST(r."revealAt", COALESCE(r."settledAt", r."revealAt"))) IS NOT TRUE'));
  assert.match(calls[1].text, /DELETE FROM "ForumPostVote" m WHERE m\."userId" = \$2\s+AND EXISTS \(SELECT 1 FROM "ForumPostVote" k WHERE k\."userId" = \$1 AND k\."postId" = m\."postId"\)/);
  assert.match(calls[2].text, /UPDATE "ForumPostVote" SET "userId" = \$1 WHERE "userId" = \$2/);
  // 2. What is left (stances on revealed relations): duplicates dropped, the rest re-pointed.
  assert.match(calls[3].text, /DELETE FROM "ConceptRelationStance" m WHERE m\."userId" = \$2\s+AND EXISTS \(SELECT 1 FROM "ConceptRelationStance" k WHERE k\."userId" = \$1 AND k\."relationId" = m\."relationId"\)/);
  assert.match(calls[4].text, /UPDATE "ConceptRelationStance" SET "userId" = \$1 WHERE "userId" = \$2/);
  for (const c of calls.slice(1)) assert.deepEqual(c.params, [KEEP, MERGE]);
  for (const [t, c] of MERGE_REPOINT_COLUMNS) {
    assert.ok(calls.some((x) => x.text === `UPDATE "${t}" SET "${c}" = $1 WHERE "${c}" = $2`), `${t}.${c}`);
  }
});

test('merge never de-anonymises: simulated rows — blind stances vanish, only revealed ones reach the kept user', async () => {
  // r1 blind, r2 revealed, r3 revealed (kept user voted too), r4 blind (kept user's own stance).
  const revealed = { r1: false, r2: true, r3: true, r4: false };
  let rows = [
    { relationId: 'r1', userId: MERGE, stance: 'agree' },
    { relationId: 'r2', userId: MERGE, stance: 'disagree' },
    { relationId: 'r3', userId: MERGE, stance: 'agree' },
    { relationId: 'r3', userId: KEEP, stance: 'disagree' },
    { relationId: 'r4', userId: KEEP, stance: 'agree' },
  ];
  const q = async (text, params) => {
    if (text === MERGE_DROP_BLIND_STANCES_SQL) rows = rows.filter((r) => !(r.userId === params[0] && !revealed[r.relationId]));
    else if (text.startsWith('DELETE FROM "ConceptRelationStance" m')) {
      rows = rows.filter((r) => !(r.userId === params[1] && rows.some((k) => k.userId === params[0] && k.relationId === r.relationId)));
    } else if (text.startsWith('UPDATE "ConceptRelationStance"')) rows = rows.map((r) => (r.userId === params[1] ? { ...r, userId: params[0] } : r));
    return { data: [], error: null };
  };
  await repointMergedUserContent(q, KEEP, MERGE);
  assert.deepEqual(rows, [
    { relationId: 'r2', userId: KEEP, stance: 'disagree' },
    { relationId: 'r3', userId: KEEP, stance: 'disagree' },
    { relationId: 'r4', userId: KEEP, stance: 'agree' },
  ]);
  assert.ok(!rows.some((r) => r.relationId === 'r1'), 'the blind stance is gone, not re-pointed');
});

test('merge: if blind stances cannot be dropped, no stance is moved (missing column) or the merge aborts (other errors)', async () => {
  const calls = [];
  const noColumn = async (text) => {
    calls.push(text);
    return text === MERGE_DROP_BLIND_STANCES_SQL ? { data: null, error: { code: '42703', message: 'no revealAt' } } : { data: [], error: null };
  };
  assert.deepEqual(await repointMergedUserContent(noColumn, KEEP, MERGE), { ok: true });
  assert.ok(!calls.slice(1).some((t) => t.includes('ConceptRelationStance')));
  const broken = async (text) => (text === MERGE_DROP_BLIND_STANCES_SQL ? { data: null, error: { code: 'XX000', message: 'boom' } } : { data: [], error: null });
  assert.deepEqual(await repointMergedUserContent(broken, KEEP, MERGE), { ok: false, error: 'boom' });
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
