import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mmHandler, errorResponse, requireUuidParam, readJsonObject, conceptPatchKind, loadMmSpace, MmApiError, SPACE_SQL,
  createWriteLimiter, apiLang,
} from './api-core.ts';
import { ConceptError, shouldDestroyClient } from './concepts-core.ts';
import { ForumError } from './forum-core.ts';

const SPACE = { id: '00000000-0000-4000-8000-000000000001', settings: {} };
const USER = '00000000-0000-4000-8000-000000000002';
const ORIGIN = 'https://mm.zztt.org';

const deps = (over = {}) => ({
  expectedOrigin: () => ORIGIN,
  loadSpace: async () => SPACE,
  loadUserId: async (locals) => (locals.session ? USER : null),
  q: async () => ({ data: [], error: null }),
  allowWrite: () => true,
  ...over,
});

const ctx = ({ tenant = 'mm', method = 'GET', headers = {}, session = null, body, params = {}, clientAddress } = {}) => {
  const request = new Request(`${ORIGIN}/api/mm/x`, { method, headers, body });
  return { request, url: new URL(request.url), params, clientAddress, locals: { tenant: tenant === null ? undefined : { id: tenant }, session } };
};

const ok = async (_c, env) => new Response(JSON.stringify({ ok: true, userId: env.userId, space: env.space.id }), { status: 200 });

test('non-mm tenants get a JSON 404 on reads and writes, before anything else runs', async () => {
  let loaded = false;
  const d = deps({ loadSpace: async () => { loaded = true; return SPACE; } });
  for (const tenant of ['musiki', 'so', null]) {
    const r1 = await mmHandler({}, ok, d)(ctx({ tenant }));
    assert.equal(r1.status, 404);
    assert.deepEqual(await r1.json(), { error: 'Not found' });
    const r2 = await mmHandler({ mutation: true }, ok, d)(ctx({ tenant, method: 'POST', headers: { origin: 'https://evil.example' } }));
    assert.equal(r2.status, 404);
  }
  assert.equal(loaded, false);
});

test('mutations: cross-origin → 403, non-JSON → 415, same-origin JSON passes', async () => {
  const h = mmHandler({ mutation: true }, ok, deps());
  const session = { user: { email: 'a@b.c' } };
  let r = await h(ctx({ method: 'POST', session, headers: { origin: 'https://evil.example', 'content-type': 'application/json' }, body: '{}' }));
  assert.equal(r.status, 403);
  r = await h(ctx({ method: 'POST', session, headers: { origin: ORIGIN, 'content-type': 'text/plain' }, body: '{}' }));
  assert.equal(r.status, 415);
  r = await h(ctx({ method: 'POST', session, headers: { origin: ORIGIN, 'content-type': 'application/json' }, body: '{}' }));
  assert.equal(r.status, 200);
  // DELETE without a body: requireJson false, origin still checked.
  const del = mmHandler({ mutation: true, requireJson: false }, ok, deps());
  assert.equal((await del(ctx({ method: 'DELETE', session, headers: { origin: 'https://evil.example' } }))).status, 403);
  assert.equal((await del(ctx({ method: 'DELETE', session, headers: { origin: ORIGIN } }))).status, 200);
});

test('anonymous writes → 401; anonymous reads pass with userId null', async () => {
  const w = mmHandler({ mutation: true }, ok, deps());
  const r = await w(ctx({ method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }));
  assert.equal(r.status, 401);
  const read = await mmHandler({}, ok, deps())(ctx());
  assert.equal(read.status, 200);
  assert.equal((await read.json()).userId, null);
  const adminRead = await mmHandler({ auth: true }, ok, deps())(ctx());
  assert.equal(adminRead.status, 401);
});

test('missing commons space → 404', async () => {
  const r = await mmHandler({}, ok, deps({ loadSpace: async () => null }))(ctx());
  assert.equal(r.status, 404);
});

test('invalid uuid params → 400 through the wrapper', async () => {
  const h = mmHandler({}, async (c) => { requireUuidParam(c.params.id, 'thread id'); return new Response('{}'); }, deps());
  const r = await h(ctx({ params: { id: 'not-a-uuid' } }));
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /invalid thread id/);
  assert.equal(requireUuidParam(USER), USER);
});

test('domain errors keep their status; other errors → generic 500 without details', async () => {
  const origError = console.error;
  console.error = () => {};
  try {
    for (const [err, status] of [
      [new ConceptError(403, 'not allowed: adoptPost'), 403],
      [new ForumError(409, 'post is deleted'), 409],
      [new MmApiError(404, 'forum not found'), 404],
      [new ConceptError(401, 'sign in required'), 401],
    ]) {
      const r = errorResponse(err);
      assert.equal(r.status, status);
      assert.equal((await r.json()).error, err.message);
    }
    const db = errorResponse(new ConceptError(500, 'relation "Concept" does not exist'));
    assert.equal(db.status, 500);
    assert.deepEqual(await db.json(), { error: 'Internal error' });
    const plain = errorResponse(Object.assign(new Error('secret SQL detail'), { status: 400 }));
    assert.equal(plain.status, 500);
    assert.doesNotMatch(JSON.stringify(await plain.json()), /secret/);
    const thrown = await mmHandler({}, async () => { throw new Error('boom'); }, deps())(ctx());
    assert.equal(thrown.status, 500);
    assert.deepEqual(await thrown.json(), { error: 'Internal error' });
  } finally {
    console.error = origError;
  }
});

test('readJsonObject rejects malformed and non-object bodies', async () => {
  const req = (body) => new Request(ORIGIN, { method: 'POST', body });
  await assert.rejects(readJsonObject(req('{nope')), (e) => e.status === 400);
  await assert.rejects(readJsonObject(req('[1]')), (e) => e.status === 400);
  await assert.rejects(readJsonObject(req('null')), (e) => e.status === 400);
  assert.deepEqual(await readJsonObject(req('{"a":1}')), { a: 1 });
});

test('concept PATCH rejects unknown extra keys', () => {
  assert.throws(() => conceptPatchKind({ definition: 'x', spaceId: 'y' }), (e) => e.status === 400 && /unexpected field: spaceId/.test(e.message));
  assert.throws(() => conceptPatchKind({ status: 'assimilated', lang: 'nb' }), (e) => e.status === 400);
  assert.throws(() => conceptPatchKind({ label: 'X', sources: [] }), (e) => e.status === 400);
  assert.equal(conceptPatchKind({ definition: 'x', lang: 'nb', sources: [] }), 'definition');
  assert.equal(conceptPatchKind({ label: 'X', labelNb: 'Y' }), 'labels');
});

test('API languages are en and nb only (nn is a UI fallback)', () => {
  assert.equal(apiLang(undefined), 'en');
  assert.equal(apiLang('en'), 'en');
  assert.equal(apiLang('nb'), 'nb');
  for (const bad of ['nn', 'no', 'EN', 1]) assert.throws(() => apiLang(bad), (e) => e.status === 400);
});

test('shouldDestroyClient: ForumError/MmApiError < 500 are clean like ConceptError', () => {
  for (const status of [400, 401, 403, 404, 409]) {
    assert.equal(shouldDestroyClient(new ForumError(status, 'x'), false), false);
    assert.equal(shouldDestroyClient(new MmApiError(status, 'x'), false), false);
  }
  assert.equal(shouldDestroyClient(new ForumError(500, 'x'), false), true);
  assert.equal(shouldDestroyClient(new MmApiError(409, 'x'), true), true);
  assert.equal(shouldDestroyClient({ name: 'ForumError', status: 400 }, false), true);
  assert.equal(shouldDestroyClient(Object.assign(new Error('x'), { status: 400 }), false), true);
});

test('write limiter: 30/min and 300/hour per key; votes in a looser separate bucket', () => {
  let t = 0;
  const allow = createWriteLimiter(() => t);
  for (let i = 0; i < 30; i++) assert.equal(allow('write', 'u:a'), true);
  assert.equal(allow('write', 'u:a'), false);
  assert.equal(allow('write', 'u:b'), true, 'per key');
  assert.equal(allow('vote', 'u:a'), true, 'votes counted separately');
  // Hourly cap: 300 writes spread over minutes.
  const hourly = createWriteLimiter(() => t);
  t = 0;
  let allowed = 0;
  for (let m = 0; m < 59; m++) { t = m * 60_000; for (let i = 0; i < 30; i++) if (hourly('write', 'u:c')) allowed++; }
  assert.equal(allowed, 300);
  t = 3_600_001;
  assert.equal(hourly('write', 'u:c'), true, 'resets after the hour');
  let v = 0;
  const votes = createWriteLimiter(() => 0);
  for (let i = 0; i < 200; i++) if (votes('vote', 'u:d')) v++;
  assert.equal(v, 120);
});

test('mmHandler: mutations are rate-limited per user (429), keyed by user id, bucket from opts; reads are not', async () => {
  const seen = [];
  const d = deps({ allowWrite: (bucket, key) => { seen.push([bucket, key]); return seen.length <= 1; } });
  const session = { user: { email: 'a@b.c' } };
  const post = () => ctx({ method: 'POST', session, headers: { 'content-type': 'application/json' }, body: '{}' });
  const h = mmHandler({ mutation: true, rateBucket: 'vote' }, ok, d);
  assert.equal((await h(post())).status, 200);
  const limited = await h(post());
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('retry-after'), '60');
  assert.deepEqual(seen[0], ['vote', `u:${USER}`]);
  await mmHandler({}, ok, d)(ctx());
  assert.equal(seen.length, 2, 'GET does not count');
  // Anonymous mutation without auth requirement → keyed by client address.
  const anon = [];
  const a = mmHandler({ mutation: true, auth: false }, ok, deps({ allowWrite: (b, k) => { anon.push(k); return true; } }));
  await a(ctx({ method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9' }, body: '{}' }));
  assert.deepEqual(anon, ['ip:203.0.113.9']);
  // Anonymous writes needing auth are 401 before counting.
  const none = [];
  const w = mmHandler({ mutation: true }, ok, deps({ allowWrite: (b, k) => { none.push(k); return true; } }));
  assert.equal((await w(ctx({ method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }))).status, 401);
  assert.deepEqual(none, []);
});

test('concept PATCH carries exactly one kind of change', () => {
  assert.equal(conceptPatchKind({ definition: 'x', lang: 'nb' }), 'definition');
  assert.equal(conceptPatchKind({ status: 'assimilated' }), 'status');
  assert.equal(conceptPatchKind({ labelNb: 'Samskaping' }), 'labels');
  assert.throws(() => conceptPatchKind({}), (e) => e.status === 400);
  assert.throws(() => conceptPatchKind({ status: 'x', definition: 'y' }), (e) => e.status === 400);
});

test('loadMmSpace pins tenant mm, kind commons, slug mishmash', async () => {
  let seen;
  const q = async (text, params) => { seen = { text, params }; return { data: [{ id: SPACE.id, settings: { openJoin: true } }], error: null }; };
  assert.deepEqual(await loadMmSpace(q), { id: SPACE.id, settings: { openJoin: true } });
  assert.equal(seen.text, SPACE_SQL);
  assert.deepEqual(seen.params, ['mm', 'mishmash']);
  assert.match(SPACE_SQL, /kind = 'commons'/);
  assert.equal(await loadMmSpace(async () => ({ data: [], error: null })), null);
});
