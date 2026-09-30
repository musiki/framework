import test from 'node:test';
import assert from 'node:assert/strict';
import { mmHandler } from './api-core.ts';
import { relationApi, RELATION_ROUTES, relationTypePatchKind } from './relation-api-core.ts';
import { getRelationView, setStance, settleRelation, REVEALED_SQL } from './stances-core.ts';

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const SPACE = { id: id(1), settings: {} };
const REL = id(50);
const ORIGIN = 'https://mm.zztt.org';
const U = { admin: id(100), curator: id(101), member: id(102), voter: id(103), voter2: id(105), guest: id(104), stranger: id(106) };
const ROLES = { [U.admin]: 'admin', [U.curator]: 'curator', [U.member]: 'member', [U.voter]: 'member', [U.voter2]: 'member', [U.guest]: 'guest' };
const NAMES = { [U.voter]: 'Vera Voter', [U.voter2]: 'Vic Other', [U.member]: 'Mem', [U.admin]: 'Ada Admin' };
const MEMBER_UP = ['member', 'curator', 'admin'];

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const EMAIL_RE = /[^\s@"]+@[^\s@"]+\.[a-z]{2,}/i;

// ---------------------------------------------------------------------------
// Harness: mmHandler with the route's own options, fake session → user id
// ---------------------------------------------------------------------------

function deps(over = {}) {
  const buckets = [];
  return {
    buckets,
    expectedOrigin: () => ORIGIN,
    loadSpace: async () => SPACE,
    loadUserId: async (locals) => locals.session?.userId ?? null,
    q: async () => ({ data: [], error: null }),
    allowWrite: (bucket) => { buckets.push(bucket); return true; },
    ...over,
  };
}

function call(route, handlers, d, { tenant = 'mm', method = 'GET', user = null, body, params = {}, origin = ORIGIN, query = '', contentType } = {}) {
  const headers = {};
  if (method !== 'GET') headers.origin = origin;
  if (body !== undefined) headers['content-type'] = contentType ?? 'application/json';
  const request = new Request(`${ORIGIN}/api/mm/x${query}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const h = mmHandler(RELATION_ROUTES[route], handlers[route], d);
  return h({ request, url: new URL(request.url), params, locals: { tenant: { id: tenant }, session: user ? { userId: user } : null } });
}

/** Cores that record their calls; every one of them is a spy. */
function spyCores(over = {}) {
  const calls = [];
  const spy = (name, result) => async (a) => { calls.push({ name, args: a }); return typeof result === 'function' ? result(a) : result; };
  const type = { slug: 'contains', label: 'contains', isArchived: false, relationCount: 0 };
  const cores = {
    listRelationTypes: spy('listRelationTypes', [type, { ...type, slug: 'old', isArchived: true, relationCount: 0 }, { ...type, slug: 'used', isArchived: true, relationCount: 2 }]),
    getRelationType: spy('getRelationType', (a) => (a.slug === 'contains'
      ? { ...type, concept: { id: id(70), spaceId: SPACE.id, slug: 'rel:contains', label: 'contains' } }
      : null)),
    createRelationType: spy('createRelationType', { slug: 'contains', conceptSlug: 'rel:contains', threadId: null, versionId: id(71) }),
    updateRelationType: spy('updateRelationType', { slug: 'contains' }),
    archiveRelationType: spy('archiveRelationType', { slug: 'contains', isArchived: true }),
    reorderRelationTypes: spy('reorderRelationTypes', { order: ['contains'] }),
    editDefinition: spy('editDefinition', { versionId: id(72) }),
    getForumRef: spy('getForumRef', (a) => (a.ref === 'stiegler' ? { id: id(10) } : null)),
    getRelationView: spy('getRelationView', { id: REL, stances: null, agree: 1, disagree: 0 }),
    setStance: spy('setStance', { stance: 'agree', afterReveal: false }),
    settleRelation: spy('settleRelation', { settled: true, settledAt: '2026-09-30T00:00:00.000Z' }),
    deleteRelation: spy('deleteRelation', { deleted: true }),
    graph: spy('graph', { nodes: [], edges: [], relationTypes: [] }),
    ...over,
  };
  return { cores, calls, handlers: relationApi(cores) };
}

const READS = [['listTypes', {}], ['getType', { slug: 'contains' }], ['getRelation', { id: REL }], ['graph', {}]];
const WRITES = [
  ['createType', 'POST', {}, { label: 'contains', definition: 'd' }],
  ['reorderTypes', 'PUT', {}, { slugs: ['contains'] }],
  ['patchType', 'PATCH', { slug: 'contains' }, { color: 'green' }],
  ['deleteRelation', 'DELETE', { id: REL }, undefined],
  ['stance', 'POST', { id: REL }, { stance: 'agree' }],
  ['settle', 'POST', { id: REL }, undefined],
];

// ---------------------------------------------------------------------------
// Wrapper behaviour per route
// ---------------------------------------------------------------------------

test('every relation route: tenants other than mm get a 404 and no core runs', async () => {
  const { handlers, calls } = spyCores();
  for (const tenant of ['musiki', 'so']) {
    for (const [route, params] of READS) assert.equal((await call(route, handlers, deps(), { tenant, params })).status, 404, route);
    for (const [route, method, params, body] of WRITES) {
      assert.equal((await call(route, handlers, deps(), { tenant, method, params, body, user: U.admin })).status, 404, route);
    }
  }
  assert.equal(calls.length, 0);
});

test('every mutation: cross-origin → 403, anonymous → 401, before any core runs', async () => {
  const { handlers, calls } = spyCores();
  for (const [route, method, params, body] of WRITES) {
    const r1 = await call(route, handlers, deps(), { method, params, body, user: U.admin, origin: 'https://evil.example' });
    assert.equal(r1.status, 403, `${route} csrf`);
    const r2 = await call(route, handlers, deps(), { method, params, body });
    assert.equal(r2.status, 401, `${route} anonymous`);
  }
  assert.equal(calls.length, 0);
});

test('relation id routes: a non-uuid id is a 400 before any core runs', async () => {
  const { handlers, calls } = spyCores();
  assert.equal((await call('getRelation', handlers, deps(), { params: { id: 'nope' } })).status, 400);
  for (const [route, method, , body] of WRITES.filter(([r]) => ['deleteRelation', 'stance', 'settle'].includes(r))) {
    const r = await call(route, handlers, deps(), { method, params: { id: "1' OR 1=1" }, body, user: U.admin });
    assert.equal(r.status, 400, route);
    assert.match((await r.json()).error, /invalid relation id/);
  }
  assert.equal(calls.length, 0);
});

test('rate buckets: stances use the vote bucket, every other mutation the write bucket; reads none', async () => {
  const { handlers } = spyCores();
  for (const [route, method, params, body] of WRITES) {
    const d = deps();
    const r = await call(route, handlers, d, { method, params, body, user: U.member });
    assert.ok(r.status < 300, `${route} ${r.status}`);
    assert.deepEqual(d.buckets, [route === 'stance' ? 'vote' : 'write'], route);
  }
  for (const [route, params] of READS) {
    const d = deps();
    await call(route, handlers, d, { params });
    assert.deepEqual(d.buckets, [], route);
  }
  // 429 when the bucket is spent.
  const spent = deps({ allowWrite: () => false });
  assert.equal((await call('stance', handlers, spent, { method: 'POST', params: { id: REL }, body: { stance: 'agree' }, user: U.member })).status, 429);
});

test('settle and delete need no JSON body (origin still checked)', async () => {
  const { handlers, calls } = spyCores();
  assert.equal((await call('settle', handlers, deps(), { method: 'POST', params: { id: REL }, user: U.curator })).status, 200);
  assert.equal((await call('deleteRelation', handlers, deps(), { method: 'DELETE', params: { id: REL }, user: U.curator })).status, 200);
  assert.deepEqual(calls.map((c) => c.name), ['settleRelation', 'deleteRelation']);
  for (const c of calls) assert.deepEqual(c.args, { relationId: REL, spaceId: SPACE.id, actorUserId: U.curator });
});

// ---------------------------------------------------------------------------
// Relation types
// ---------------------------------------------------------------------------

test('list types: public, space-pinned, ?archived=1 includes archived', async () => {
  const { handlers, calls } = spyCores();
  const r = await call('listTypes', handlers, deps());
  assert.equal(r.status, 200);
  assert.ok(Array.isArray((await r.json()).relationTypes));
  await call('listTypes', handlers, deps(), { query: '?archived=1' });
  assert.deepEqual(calls.map((c) => c.args), [{ spaceId: SPACE.id, includeArchived: false }, { spaceId: SPACE.id, includeArchived: true }]);
});

test('create type: fields go to the core as `type`, forum resolved in the space, unknown keys 400', async () => {
  const { handlers, calls } = spyCores();
  const body = { label: 'contains', color: 'green', render: 'area', hierarchical: true, slug: 'contains', definition: 'A contains B', definitionNb: 'nb', forum: 'stiegler' };
  const r = await call('createType', handlers, deps(), { method: 'POST', body, user: U.curator });
  assert.equal(r.status, 201);
  const c = calls.find((x) => x.name === 'createRelationType').args;
  assert.deepEqual(c.type, { label: 'contains', color: 'green', render: 'area', hierarchical: true });
  assert.equal(c.slug, 'contains');
  assert.equal(c.forumId, id(10));
  assert.equal(c.spaceId, SPACE.id);
  assert.equal(c.actorUserId, U.curator);
  assert.equal((await call('createType', handlers, deps(), { method: 'POST', body: { ...body, forum: 'nope' }, user: U.curator })).status, 404);
  assert.equal((await call('createType', handlers, deps(), { method: 'POST', body: { ...body, isBuiltin: true }, user: U.curator })).status, 400);
});

test('get type: 404 when unknown; the definition concept goes out without the space id', async () => {
  const { handlers } = spyCores();
  assert.equal((await call('getType', handlers, deps(), { params: { slug: 'nope' } })).status, 404);
  const r = await call('getType', handlers, deps(), { params: { slug: 'contains' } });
  const { relationType } = await r.json();
  assert.equal(relationType.concept.slug, 'rel:contains');
  assert.ok(!('spaceId' in relationType.concept));
});

test('patch type: exactly one kind — fields, archived, or a definition through the type (never the concept API)', async () => {
  assert.equal(relationTypePatchKind({ color: 'green', label: 'x' }), 'fields');
  assert.equal(relationTypePatchKind({ archived: false }), 'archive');
  assert.equal(relationTypePatchKind({ definition: 'd', lang: 'nb' }), 'definition');
  for (const bad of [{}, { archived: 'yes' }, { archived: true, color: 'green' }, { definition: 'd', color: 'green' }, { slug: 'other' }, { color: 'green', slug: 'x' }, { definition: 'd', extra: 1 }]) {
    assert.throws(() => relationTypePatchKind(bad), (e) => e.status === 400, JSON.stringify(bad));
  }
  const { handlers, calls } = spyCores();
  const p = (body, slug = 'contains') => call('patchType', handlers, deps(), { method: 'PATCH', params: { slug }, body, user: U.curator });
  assert.equal((await p({ color: 'green' })).status, 200);
  assert.equal((await p({ archived: true })).status, 200);
  assert.equal((await p({ definition: 'new', lang: 'nb', sources: [] })).status, 200);
  assert.equal((await p({ definition: 'new' }, 'nope')).status, 404);
  assert.equal((await p({ definition: 'new', lang: 'nn' })).status, 400);
  const names = calls.map((c) => c.name);
  assert.deepEqual(names.filter((n) => n !== 'getRelationType'), ['updateRelationType', 'archiveRelationType', 'editDefinition']);
  assert.deepEqual(calls.find((c) => c.name === 'editDefinition').args, {
    conceptId: id(70), actorUserId: U.curator, lang: 'nb', definition: 'new', sources: [],
  });
  assert.deepEqual(calls.find((c) => c.name === 'archiveRelationType').args, { spaceId: SPACE.id, slug: 'contains', actorUserId: U.curator, archived: true });
});

test('reorder: { slugs } only', async () => {
  const { handlers, calls } = spyCores();
  assert.equal((await call('reorderTypes', handlers, deps(), { method: 'PUT', body: { slugs: ['b', 'a'] }, user: U.curator })).status, 200);
  assert.deepEqual(calls[0].args, { spaceId: SPACE.id, actorUserId: U.curator, slugs: ['b', 'a'] });
  assert.equal((await call('reorderTypes', handlers, deps(), { method: 'PUT', body: { slugs: [], x: 1 }, user: U.curator })).status, 400);
});

test('graph: space-pinned; unknown forum → empty graph with the legend (archived types only while used)', async () => {
  const { handlers, calls } = spyCores();
  const r = await call('graph', handlers, deps(), { query: '?forum=nope' });
  const body = await r.json();
  assert.deepEqual(body.nodes, []);
  assert.deepEqual(body.relationTypes.map((t) => t.slug), ['contains', 'used']);
  await call('graph', handlers, deps(), { query: '?forum=stiegler&status=neologism&lang=nn' });
  assert.deepEqual(calls.find((c) => c.name === 'graph').args, { spaceId: SPACE.id, forumId: id(10), status: 'neologism', lang: 'nn' });
});

test('stance body: exactly { stance }; the core decides the rest', async () => {
  const { handlers, calls } = spyCores();
  const s = (body, user = U.member) => call('stance', handlers, deps(), { method: 'POST', params: { id: REL }, body, user });
  assert.equal((await s({})).status, 400);
  assert.equal((await s({ stance: 'agree', userId: U.voter })).status, 400);
  assert.equal(calls.length, 0);
  assert.equal((await s({ stance: null }, U.guest)).status, 200);
  assert.deepEqual(calls[0].args, { relationId: REL, spaceId: SPACE.id, actorUserId: U.guest, stance: null });
});

// ---------------------------------------------------------------------------
// Blind, then revealed — through the routes, with the real stances core
// ---------------------------------------------------------------------------

/**
 * A stand-in database that answers each statement according to its text:
 * the names statement returns every holder UNLESS it carries the reveal guard
 * and the membership check. A handler that bypassed the core, or a core that
 * lost its guard, would leak here.
 */
function db({ revealed = false, stances = [] } = {}) {
  const state = { revealed, settledAt: null, stances: stances.map((s) => ({ afterReveal: false, ...s })) };
  const count = (st) => state.stances.filter((s) => s.stance === st).length;
  const routes = [
    ['"SpaceMember" m\n     JOIN "Space" s', ([spaceId, userId]) => (spaceId === SPACE.id && ROLES[userId] ? [{ role: ROLES[userId] }] : [])],
    [/^SELECT r\.id, r\."spaceId" FROM "ConceptRelation" r/, ([rid, sid]) => (rid === REL && sid === SPACE.id ? [{ id: REL, spaceId: SPACE.id }] : [])],
    [/^SELECT r\.id, r\."createdAt"/, ([rid, sid]) => (rid === REL && sid === SPACE.id
      ? [{
          id: REL, createdAt: '2026-09-10T00:00:00.000Z', createdBy: U.member, createdByName: 'Mem', settled: !!state.settledAt, type: 'contains',
          revealAt: state.settledAt ?? '2026-09-24T00:00:00.000Z', revealed: state.revealed,
          sourceSlug: 'a', sourceLabel: 'A', sourceLabelNb: null, targetSlug: 'b', targetLabel: 'B', targetLabelNb: null,
          fromPostId: null, fromThreadId: null, fromBoardSlug: null, fromGroupSlug: null, fromArchived: false,
          agree: count('agree'), disagree: count('disagree'),
        }]
      : [])],
    [/^SELECT s\.stance, s\."afterReveal" FROM "ConceptRelationStance" s\s+WHERE s\."relationId" = \$1::uuid AND s\."userId" = \$2::uuid/, ([, viewer]) =>
      state.stances.filter((s) => s.userId === viewer).map((s) => ({ stance: s.stance, afterReveal: s.afterReveal }))],
    [/u\.name[\s\S]*FROM "ConceptRelationStance" s/, ([, viewer], text) => {
      if (text.includes(`AND ${REVEALED_SQL}`) && !state.revealed) return [];
      if (/m\."role" IN \('member', 'curator', 'admin'\)/.test(text) && !MEMBER_UP.includes(ROLES[viewer])) return [];
      return state.stances.map((s) => ({ stance: s.stance, afterReveal: s.afterReveal, name: NAMES[s.userId] ?? null, deleted: false }));
    }],
    [/^SELECT 1 FROM "ConceptRelation" r\s+JOIN "Space" sp/, ([, viewer]) => (MEMBER_UP.includes(ROLES[viewer]) ? [{ ok: 1 }] : [])],
    ['DELETE FROM "ConceptRelationStance"', ([rid, userId]) => {
      if (rid === REL) state.stances = state.stances.filter((s) => s.userId !== userId);
      return [];
    }],
    ['INSERT INTO "ConceptRelationStance"', ([, userId, stance]) => {
      const cur = state.stances.find((s) => s.userId === userId);
      if (!cur) { state.stances.push({ userId, stance, afterReveal: state.revealed }); return [{ stance, afterReveal: state.revealed }]; }
      if (cur.stance !== stance) { cur.stance = stance; cur.afterReveal = state.revealed; }
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
    for (const [match, handler] of routes) {
      if (typeof match === 'string' ? t.includes(match) : match.test(t)) return { data: handler(params, t) ?? [], error: null };
    }
    return { data: [], error: null };
  };
  return { q, state };
}

function realHandlers(fx) {
  return spyCores({
    getRelationView: (a) => getRelationView(fx.q, a),
    setStance: (a) => setStance(fx.q, a),
    settleRelation: (a) => settleRelation(fx.q, a),
  }).handlers;
}

/** No stance holder's name anywhere in the payload; no uuid other than the relation's own id; no e-mail. */
function assertNoIdentities(payload, label) {
  const text = JSON.stringify(payload);
  for (const name of ['Vera Voter', 'Vic Other']) assert.ok(!text.includes(name), `${label}: leaked ${name}`);
  for (const m of text.match(new RegExp(UUID_RE.source, 'gi')) ?? []) assert.equal(m, REL, `${label}: leaked uuid ${m}`);
  assert.doesNotMatch(text, EMAIL_RE, `${label}: e-mail`);
}

const TWO = [{ userId: U.voter, stance: 'agree' }, { userId: U.voter2, stance: 'disagree' }];

test('blind: neither GET /relations/[id] nor POST /stance exposes who voted what before the reveal — any role', async () => {
  for (const viewer of [U.admin, U.curator, U.member, U.voter, U.guest, U.stranger, null]) {
    const fx = db({ revealed: false, stances: TWO });
    const h = realHandlers(fx);
    const g = await (await call('getRelation', h, deps(), { params: { id: REL }, user: viewer })).json();
    assert.equal(g.relation.stances, null);
    assert.equal(g.relation.agree, 1);
    assert.equal(g.relation.disagree, 1);
    assertNoIdentities(g, `GET as ${viewer}`);
    if (!viewer) continue;
    const s = await call('stance', h, deps(), { method: 'POST', params: { id: REL }, body: { stance: 'agree' }, user: viewer });
    const sb = await s.json();
    if (MEMBER_UP.includes(ROLES[viewer])) {
      assert.equal(s.status, 200);
      assert.equal(sb.stance, 'agree');
      assert.equal(sb.relation.stances, null);
      assert.equal(sb.relation.myStance, 'agree');
    } else {
      assert.equal(s.status, 403);
    }
    assertNoIdentities(sb, `stance as ${viewer}`);
  }
});

test('withdraw (null) works for any signed-in user and leaves no row; after the reveal only members see names', async () => {
  const fx = db({ revealed: false, stances: [...TWO, { userId: U.guest, stance: 'agree' }] });
  const h = realHandlers(fx);
  // A guest (e.g. demoted after voting) can still withdraw.
  const w = await call('stance', h, deps(), { method: 'POST', params: { id: REL }, body: { stance: null }, user: U.guest });
  assert.equal(w.status, 200);
  assert.equal((await w.json()).stance, null);
  assert.ok(!fx.state.stances.some((s) => s.userId === U.guest));
  // A member withdraws too, before the reveal: gone for good.
  await call('stance', h, deps(), { method: 'POST', params: { id: REL }, body: { stance: null }, user: U.voter2 });
  assert.deepEqual(fx.state.stances.map((s) => s.userId), [U.voter]);

  // Members cannot settle; curators can — then names reach members only.
  assert.equal((await call('settle', h, deps(), { method: 'POST', params: { id: REL }, user: U.member })).status, 403);
  assert.equal((await call('settle', h, deps(), { method: 'POST', params: { id: REL }, user: U.curator })).status, 200);
  const asMember = await (await call('getRelation', h, deps(), { params: { id: REL }, user: U.member })).json();
  assert.deepEqual(asMember.relation.stances.map((s) => [s.name, s.stance]), [['Vera Voter', 'agree']]);
  for (const viewer of [U.guest, U.stranger, null]) {
    const v = await (await call('getRelation', h, deps(), { params: { id: REL }, user: viewer })).json();
    assert.equal(v.relation.stances, null, `viewer ${viewer}`);
    assertNoIdentities(v, `revealed as ${viewer}`);
  }
  // Even revealed, the payload names people — never their ids or e-mails.
  const text = JSON.stringify(asMember);
  for (const uid of Object.values(U)) assert.ok(!text.includes(uid), `user id ${uid}`);
});

test('a relation of another space is a 404 through the routes', async () => {
  const fx = db({ stances: TWO });
  const h = realHandlers(fx);
  const other = id(51);
  assert.equal((await call('getRelation', h, deps(), { params: { id: other }, user: U.admin })).status, 404);
  assert.equal((await call('stance', h, deps(), { method: 'POST', params: { id: other }, body: { stance: 'agree' }, user: U.admin })).status, 404);
  assert.equal((await call('settle', h, deps(), { method: 'POST', params: { id: other }, user: U.admin })).status, 404);
});
