import test from 'node:test';
import assert from 'node:assert/strict';
import { ConceptError } from './concepts-core.ts';
import {
  getRelationView, setStance, settleRelation, stanceRevealDays, revealAt,
  REVEAL_AT_SQL, REVEALED_SQL, REVEAL_DAYS_SQL, STANCE_NAMES_SQL,
} from './stances-core.ts';

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SPACE = id(1);
const OTHER_SPACE = id(2);
const REL = id(50);
const POST = id(40);
const THREAD = id(30);
const U = { admin: id(100), curator: id(101), member: id(102), voter: id(103), guest: id(104), voter2: id(105), stranger: id(106) };
const ROLES = { [U.admin]: 'admin', [U.curator]: 'curator', [U.member]: 'member', [U.voter]: 'member', [U.voter2]: 'member', [U.guest]: 'guest' };
const NAMES = { [U.voter]: 'Vera Voter', [U.voter2]: 'vera@example.org', [U.member]: 'Mem', [U.admin]: 'Ada Admin' };
const MEMBER_UP = ['member', 'curator', 'admin'];

/**
 * A small faithful stand-in for the database: it holds the stance rows and
 * whether the relation is revealed, and answers each statement the way
 * Postgres would GIVEN THE STATEMENT'S TEXT — in particular the names query
 * returns every holder unless the text itself carries the reveal guard and the
 * membership check. A module that forgot the guard would leak here.
 */
function db({ revealed = false, settled = false, stances = [], relSpace = SPACE } = {}) {
  const state = {
    revealed,
    settledAt: settled ? '2026-09-20T00:00:00.000Z' : null,
    stances: stances.map((s) => ({ afterReveal: false, ...s })),
  };
  const calls = [];
  const count = (stance) => state.stances.filter((s) => s.stance === stance).length;
  const routes = [
    ['"SpaceMember" m\n     JOIN "Space" s', ([spaceId, userId]) => (spaceId === SPACE && ROLES[userId] ? [{ role: ROLES[userId] }] : [])],
    [/^SELECT id, "spaceId" FROM "ConceptRelation"/, ([rid]) => (rid === REL ? [{ id: REL, spaceId: relSpace }] : [])],
    [/^SELECT r\.id, r\."createdAt"/, ([rid, spaceId]) => (rid === REL && (!spaceId || spaceId === relSpace)
      ? [{
          id: REL, createdAt: '2026-09-10T00:00:00.000Z', createdBy: U.member, createdByName: 'Mem', settled: !!state.settledAt, type: 'derives',
          revealAt: state.settledAt ?? '2026-09-24T00:00:00.000Z', revealed: state.revealed,
          sourceSlug: 'a', sourceLabel: 'A', sourceLabelNb: null, targetSlug: 'b', targetLabel: 'B', targetLabelNb: 'B nb',
          fromPostId: POST, fromThreadId: THREAD, fromBoardSlug: 'concepts', fromGroupSlug: 'stiegler',
          agree: count('agree'), disagree: count('disagree'),
        }]
      : [])],
    [/^SELECT s\.stance, s\."afterReveal" FROM "ConceptRelationStance" s\s+WHERE s\."relationId" = \$1::uuid AND s\."userId" = \$2::uuid/, ([, viewer]) =>
      state.stances.filter((s) => s.userId === viewer).map((s) => ({ stance: s.stance, afterReveal: s.afterReveal }))],
    [/u\.name[\s\S]*FROM "ConceptRelationStance" s/, ([, viewer], text) => {
      const guarded = text.includes(`AND ${REVEALED_SQL}`);
      const memberChecked = /m\."userId" = \$2::uuid AND m\."role" IN \('member', 'curator', 'admin'\)/.test(text);
      if (guarded && !state.revealed) return [];
      if (memberChecked && !MEMBER_UP.includes(ROLES[viewer])) return [];
      return state.stances.map((s) => ({ stance: s.stance, afterReveal: s.afterReveal, name: NAMES[s.userId] ?? null, deleted: false }));
    }],
    [/^SELECT 1 FROM "ConceptRelation" r\s+JOIN "Space" sp/, ([, viewer]) => (MEMBER_UP.includes(ROLES[viewer]) ? [{ ok: 1 }] : [])],
    ['DELETE FROM "ConceptRelationStance"', ([, userId]) => { state.stances = state.stances.filter((s) => s.userId !== userId); return []; }],
    ['INSERT INTO "ConceptRelationStance"', ([, userId, stance], text) => {
      // afterReveal comes from the database clock inside the statement.
      const after = text.includes(`(${REVEALED_SQL})`) ? state.revealed : false;
      const cur = state.stances.find((s) => s.userId === userId);
      if (!cur) { state.stances.push({ userId, stance, afterReveal: after }); return [{ stance, afterReveal: after }]; }
      if (cur.stance !== stance) { cur.stance = stance; cur.afterReveal = after; }
      return [{ stance: cur.stance, afterReveal: cur.afterReveal }];
    }],
    ['UPDATE "ConceptRelation" SET "settledAt"', () => {
      state.settledAt = state.settledAt ?? '2026-09-30T12:00:00.000Z';
      state.revealed = true;
      return [{ settledAt: state.settledAt }];
    }],
  ];
  const q = async (text, params = []) => {
    const t = text.trim();
    calls.push({ text: t, params });
    for (const [match, handler] of routes) {
      if (typeof match === 'string' ? t.includes(match) : match.test(t)) return { data: handler(params, t) ?? [], error: null };
    }
    return { data: [], error: null };
  };
  return { q, calls, state };
}

async function rejectsStatus(promise, status) {
  await assert.rejects(promise, (err) => err instanceof ConceptError && err.status === status, `expected ${status}`);
}

const TWO = [{ userId: U.voter, stance: 'agree' }, { userId: U.voter2, stance: 'disagree' }];
const VIEWERS = [['admin', U.admin], ['curator', U.curator], ['member', U.member], ['voter', U.voter], ['guest', U.guest], ['stranger', U.stranger], ['anonymous', null]];

// ---------------------------------------------------------------------------
// Reveal time
// ---------------------------------------------------------------------------

test('reveal SQL: COALESCE(settledAt, createdAt + stanceRevealDays days), default 14, clamped 1–90', () => {
  assert.match(REVEAL_AT_SQL, /^COALESCE\(r\."settledAt", r\."createdAt" \+ make_interval\(days => /);
  assert.match(REVEAL_DAYS_SQL, /jsonb_typeof\(sp\.settings -> 'stanceRevealDays'\) = 'number'/);
  assert.match(REVEAL_DAYS_SQL, /LEAST\(90, GREATEST\(1, round\(\(sp\.settings ->> 'stanceRevealDays'\)::numeric\)\)\)::int/);
  assert.match(REVEAL_DAYS_SQL, /ELSE 14 END/);
  assert.equal(REVEALED_SQL, `now() >= ${REVEAL_AT_SQL}`);
});

test('stanceRevealDays / revealAt (pure mirror): default, clamp, settle wins, auto-reveal by date', () => {
  assert.equal(stanceRevealDays({}), 14);
  assert.equal(stanceRevealDays(null), 14);
  assert.equal(stanceRevealDays({ stanceRevealDays: '7' }), 14, 'only numbers count');
  assert.equal(stanceRevealDays({ stanceRevealDays: 7 }), 7);
  assert.equal(stanceRevealDays('{"stanceRevealDays": 30}'), 30);
  assert.equal(stanceRevealDays({ stanceRevealDays: 0 }), 1);
  assert.equal(stanceRevealDays({ stanceRevealDays: 1e9 }), 90);
  const created = '2026-09-10T00:00:00.000Z';
  assert.equal(revealAt(created, null, 14).toISOString(), '2026-09-24T00:00:00.000Z');
  assert.equal(revealAt(created, '2026-09-12T08:00:00.000Z', 14).toISOString(), '2026-09-12T08:00:00.000Z');
  // Auto-reveal by date: open the day before, revealed on the day.
  const at = revealAt(created, null, stanceRevealDays({}));
  assert.ok(new Date('2026-09-23T23:59:59Z') < at && new Date('2026-09-24T00:00:00Z') >= at);
});

test('the names statement is guarded in SQL: reveal time, membership, commons space; it never selects a user id', () => {
  assert.ok(STANCE_NAMES_SQL.includes(`AND ${REVEALED_SQL}`));
  assert.match(STANCE_NAMES_SQL, /m\."userId" = \$2::uuid AND m\."role" IN \('member', 'curator', 'admin'\)/);
  assert.match(STANCE_NAMES_SQL, /sp\.kind = 'commons'/);
  const selectList = STANCE_NAMES_SQL.slice(0, STANCE_NAMES_SQL.indexOf('FROM'));
  assert.doesNotMatch(selectList, /userId|email|u\.id,|s\.\*/);
});

// ---------------------------------------------------------------------------
// Blind before the reveal — for every role
// ---------------------------------------------------------------------------

for (const [who, viewer] of VIEWERS) {
  test(`blind: ${who} cannot see who voted what before the reveal (totals only)`, async () => {
    const fx = db({ revealed: false, stances: TWO });
    const view = await getRelationView(fx.q, { relationId: REL, spaceId: SPACE, viewerUserId: viewer });
    assert.equal(view.revealed, false);
    assert.deepEqual([view.agree, view.disagree], [1, 1]);
    assert.equal(view.stances, null);
    assert.equal(view.myStance, viewer === U.voter ? 'agree' : null, 'only the viewer\'s own stance');
    const json = JSON.stringify(view);
    assert.ok(!json.includes('Vera') && !json.includes('example.org'), 'no voter names');
    for (const uid of Object.values(U)) assert.ok(!json.includes(uid), 'no user ids');
    // No statement that reads names or holders of stances ran without the guard.
    for (const c of fx.calls) {
      if (!c.text.includes('"ConceptRelationStance"')) continue;
      const readsHolders = /u\.name|SELECT[^;]*s\."userId"[^;]*FROM/.test(c.text.replace(/WHERE[\s\S]*/, ''));
      assert.ok(!readsHolders || c.text.includes(REVEALED_SQL), c.text);
    }
  });
}

test('blind: even if the names statement is run for an admin before the reveal, the database returns nothing', async () => {
  const fx = db({ revealed: false, stances: TWO });
  const { data } = await fx.q(STANCE_NAMES_SQL, [REL, U.admin]);
  assert.deepEqual(data, []);
  // Sanity of the stand-in: the same statement without its guard WOULD leak.
  const leaky = await fx.q(STANCE_NAMES_SQL.replace(`AND ${REVEALED_SQL}`, ''), [REL, U.admin]);
  assert.equal(leaky.data.length, 2);
});

// ---------------------------------------------------------------------------
// After the reveal
// ---------------------------------------------------------------------------

test('revealed: members, curators and admins see display names (never ids, never e-mail-like names)', async () => {
  for (const viewer of [U.admin, U.curator, U.member, U.voter]) {
    const fx = db({ revealed: true, stances: [...TWO, { userId: U.admin, stance: 'agree', afterReveal: true }] });
    const view = await getRelationView(fx.q, { relationId: REL, spaceId: SPACE, viewerUserId: viewer });
    assert.equal(view.revealed, true);
    assert.deepEqual(view.stances, [
      { name: 'Vera Voter', deleted: false, stance: 'agree', afterReveal: false },
      { name: null, deleted: false, stance: 'disagree', afterReveal: false }, // name looked like an e-mail
      { name: 'Ada Admin', deleted: false, stance: 'agree', afterReveal: true },
    ]);
    const json = JSON.stringify(view);
    assert.ok(!json.includes('example.org'));
    for (const uid of Object.values(U)) assert.ok(!json.includes(uid));
    assert.deepEqual(fx.calls.find((c) => c.text.includes('u.name')).params, [REL, viewer]);
  }
});

test('revealed: guests, strangers and the public still get totals only', async () => {
  for (const viewer of [U.guest, U.stranger, null]) {
    const fx = db({ revealed: true, stances: TWO });
    const view = await getRelationView(fx.q, { relationId: REL, spaceId: SPACE, viewerUserId: viewer });
    assert.deepEqual([view.revealed, view.agree, view.disagree, view.stances], [true, 1, 1, null]);
    assert.ok(!JSON.stringify(view).includes('Vera'));
  }
  // Anonymous: the names statement is not even run.
  const anon = db({ revealed: true, stances: TWO });
  await getRelationView(anon.q, { relationId: REL, viewerUserId: null });
  assert.ok(!anon.calls.some((c) => c.text.includes('u.name')));
});

test('revealed with no stances: a member gets an empty list, a guest null', async () => {
  assert.deepEqual((await getRelationView(db({ revealed: true }).q, { relationId: REL, viewerUserId: U.member })).stances, []);
  assert.equal((await getRelationView(db({ revealed: true }).q, { relationId: REL, viewerUserId: U.guest })).stances, null);
});

test('getRelationView: shape, provenance, own; pinned to the space; bad ids → null', async () => {
  const fx = db({ stances: TWO });
  const view = await getRelationView(fx.q, { relationId: REL, spaceId: SPACE, viewerUserId: U.member });
  assert.deepEqual(view, {
    id: REL, type: 'derives',
    source: { slug: 'a', label: 'A', labelNb: null }, target: { slug: 'b', label: 'B', labelNb: 'B nb' },
    createdBy: { name: 'Mem', deleted: false }, own: true, createdAt: '2026-09-10T00:00:00.000Z',
    fromPost: { id: POST, threadId: THREAD, groupSlug: 'stiegler', channelSlug: 'concepts' },
    settled: false, revealAt: '2026-09-24T00:00:00.000Z', revealed: false, agree: 1, disagree: 1,
    myStance: null, myStanceAfterReveal: false, stances: null,
  });
  const main = fx.calls[0];
  assert.ok(main.text.includes(`${REVEAL_AT_SQL} AS "revealAt"`) && main.text.includes(`(${REVEALED_SQL}) AS revealed`));
  assert.deepEqual(main.params, [REL, SPACE]);
  assert.equal(await getRelationView(fx.q, { relationId: REL, spaceId: OTHER_SPACE }), null);
  assert.equal(await getRelationView(fx.q, { relationId: 'nope' }), null);
  assert.equal(await getRelationView(fx.q, { relationId: id(999) }), null);
});

// ---------------------------------------------------------------------------
// setStance / settleRelation
// ---------------------------------------------------------------------------

test('setStance: members+ only (guests, strangers, anonymous denied); invalid stance 400; unknown relation 404', async () => {
  for (const actor of [U.member, U.curator, U.admin]) {
    assert.deepEqual(await setStance(db().q, { relationId: REL, actorUserId: actor, stance: 'agree' }), { stance: 'agree', afterReveal: false });
  }
  for (const [actor, status] of [[U.guest, 403], [U.stranger, 403], [null, 401]]) {
    const fx = db();
    await rejectsStatus(setStance(fx.q, { relationId: REL, actorUserId: actor, stance: 'agree' }), status);
    await rejectsStatus(setStance(fx.q, { relationId: REL, actorUserId: actor, stance: null }), status);
    assert.equal(fx.state.stances.length, 0);
  }
  for (const stance of ['maybe', 1, undefined, '']) {
    await rejectsStatus(setStance(db().q, { relationId: REL, actorUserId: U.member, stance }), 400);
  }
  await rejectsStatus(setStance(db().q, { relationId: id(999), actorUserId: U.member, stance: 'agree' }), 404);
  await rejectsStatus(setStance(db().q, { relationId: REL, actorUserId: U.member, stance: 'agree', spaceId: OTHER_SPACE }), 404);
  await rejectsStatus(setStance(db({ relSpace: OTHER_SPACE }).q, { relationId: REL, actorUserId: U.member, stance: 'agree' }), 403);
});

test('setStance: one stance per user, changeable (upsert on the primary key)', async () => {
  const fx = db();
  await setStance(fx.q, { relationId: REL, actorUserId: U.member, stance: 'agree' });
  await setStance(fx.q, { relationId: REL, actorUserId: U.member, stance: 'disagree' });
  assert.deepEqual(fx.state.stances, [{ userId: U.member, stance: 'disagree', afterReveal: false }]);
  const ins = fx.calls.find((c) => c.text.includes('INSERT INTO "ConceptRelationStance"'));
  assert.match(ins.text, /ON CONFLICT \("relationId", "userId"\) DO UPDATE/);
  assert.deepEqual(ins.params, [REL, U.member, 'agree']);
});

test('withdrawn stance leaves no row — nothing is left to reveal', async () => {
  const fx = db({ stances: [...TWO, { userId: U.member, stance: 'agree' }] });
  assert.deepEqual(await setStance(fx.q, { relationId: REL, actorUserId: U.member, stance: null }), { stance: null, afterReveal: false });
  const del = fx.calls.find((c) => c.text.startsWith('DELETE FROM "ConceptRelationStance"'));
  assert.deepEqual(del.params, [REL, U.member]);
  assert.match(del.text, /"relationId" = \$1::uuid AND "userId" = \$2::uuid/);
  assert.ok(!fx.state.stances.some((s) => s.userId === U.member));
  assert.ok(!fx.calls.some((c) => /INSERT|UPDATE/.test(c.text)), 'no tombstone, no flag');
  // After the reveal the withdrawn member is not among the names.
  fx.state.revealed = true;
  const view = await getRelationView(fx.q, { relationId: REL, viewerUserId: U.admin });
  assert.deepEqual(view.stances.map((s) => s.name), ['Vera Voter', null]);
  assert.deepEqual([view.agree, view.disagree], [1, 1]);
});

test('afterReveal: set by the database clock when a stance is created or changed after the reveal; kept when repeated', async () => {
  const fx = db({ revealed: true, stances: [{ userId: U.voter, stance: 'agree', afterReveal: false }] });
  // Created after the reveal.
  assert.deepEqual(await setStance(fx.q, { relationId: REL, actorUserId: U.member, stance: 'agree' }), { stance: 'agree', afterReveal: true });
  // Repeating a pre-reveal stance does not flag it…
  assert.deepEqual(await setStance(fx.q, { relationId: REL, actorUserId: U.voter, stance: 'agree' }), { stance: 'agree', afterReveal: false });
  // …changing it does.
  assert.deepEqual(await setStance(fx.q, { relationId: REL, actorUserId: U.voter, stance: 'disagree' }), { stance: 'disagree', afterReveal: true });
  const ins = fx.calls.find((c) => c.text.includes('INSERT INTO "ConceptRelationStance"'));
  assert.ok(ins.text.includes(`SELECT r.id, $2::uuid, $3::text, (${REVEALED_SQL})`), 'the flag is computed in SQL, not passed in');
  assert.match(ins.text, /CASE WHEN cur\.stance IS DISTINCT FROM EXCLUDED\.stance THEN EXCLUDED\."afterReveal" ELSE cur\."afterReveal" END/);
  assert.equal(ins.params.length, 3);
  // Before the reveal nothing is flagged.
  const open = db();
  assert.equal((await setStance(open.q, { relationId: REL, actorUserId: U.member, stance: 'agree' })).afterReveal, false);
});

test('settleRelation: curator/admin only; reveals from then on; idempotent; member cannot reveal', async () => {
  for (const [actor, status] of [[U.member, 403], [U.voter, 403], [U.guest, 403], [null, 401]]) {
    const fx = db({ stances: TWO });
    await rejectsStatus(settleRelation(fx.q, { relationId: REL, actorUserId: actor }), status);
    assert.equal(fx.state.revealed, false);
    assert.ok(!fx.calls.some((c) => c.text.includes('UPDATE')));
  }
  const fx = db({ stances: TWO });
  assert.equal((await getRelationView(fx.q, { relationId: REL, viewerUserId: U.curator })).stances, null);
  assert.deepEqual(await settleRelation(fx.q, { relationId: REL, actorUserId: U.curator }), { settled: true, settledAt: '2026-09-30T12:00:00.000Z' });
  const upd = fx.calls.find((c) => c.text.includes('UPDATE "ConceptRelation"'));
  assert.match(upd.text, /"settledAt" = COALESCE\("settledAt", now\(\)\), "settledBy" = COALESCE\("settledBy", \$2::uuid\)/);
  assert.deepEqual(upd.params, [REL, U.curator]);
  const after = await getRelationView(fx.q, { relationId: REL, viewerUserId: U.member });
  assert.deepEqual([after.settled, after.revealed, after.stances.length], [true, true, 2]);
  assert.ok(!JSON.stringify(after).includes(U.curator), 'who settled is not exposed');
  // Settling again keeps the first settle time.
  assert.equal((await settleRelation(fx.q, { relationId: REL, actorUserId: U.admin })).settledAt, '2026-09-30T12:00:00.000Z');
  await rejectsStatus(settleRelation(db().q, { relationId: id(999), actorUserId: U.admin }), 404);
});
