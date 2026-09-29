import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mmHandler, errorResponse, requireUuidParam, readJsonObject, conceptPatchKind, loadMmSpace, MmApiError, SPACE_SQL,
} from './api-core.ts';
import { ConceptError } from './concepts-core.ts';
import { ForumError } from './forum-core.ts';

const SPACE = { id: '00000000-0000-4000-8000-000000000001', settings: {} };
const USER = '00000000-0000-4000-8000-000000000002';
const ORIGIN = 'https://mm.zztt.org';

const deps = (over = {}) => ({
  expectedOrigin: () => ORIGIN,
  loadSpace: async () => SPACE,
  loadUserId: async (locals) => (locals.session ? USER : null),
  q: async () => ({ data: [], error: null }),
  ...over,
});

const ctx = ({ tenant = 'mm', method = 'GET', headers = {}, session = null, body, params = {} } = {}) => {
  const request = new Request(`${ORIGIN}/api/mm/x`, { method, headers, body });
  return { request, url: new URL(request.url), params, locals: { tenant: tenant === null ? undefined : { id: tenant }, session } };
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
