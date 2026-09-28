import test from 'node:test';
import assert from 'node:assert/strict';
import { withSiteRebuildOnRestore } from './version-restore.ts';

function ctxWith(body) {
  return {
    request: new Request('https://so.test/api/studio/notes/versions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  };
}

function setup({ under = true, status = 200 } = {}) {
  const calls = { checked: [], rebuilds: 0, handlerBody: null };
  const handler = async (ctx) => {
    calls.handlerBody = await ctx.request.json(); // handler still gets the body
    return new Response(JSON.stringify({ ok: status === 200 }), { status });
  };
  const wrapped = withSiteRebuildOnRestore(handler, {
    isNoteUnderSite: async (id) => {
      calls.checked.push(id);
      return under;
    },
    requestRebuild: () => {
      calls.rebuilds++;
    },
  });
  return { wrapped, calls };
}

const flush = () => new Promise((r) => setImmediate(r));

test('restore of a note under Site requests a rebuild (and the handler still reads the body)', async () => {
  const { wrapped, calls } = setup();
  const res = await wrapped(ctxWith({ noteId: 'n1', versionId: 'v1' }));
  await flush();
  assert.equal(res.status, 200);
  assert.deepEqual(calls.handlerBody, { noteId: 'n1', versionId: 'v1' });
  assert.deepEqual(calls.checked, ['n1']);
  assert.equal(calls.rebuilds, 1);
});

test('restore of a note outside Site does not request a rebuild', async () => {
  const { wrapped, calls } = setup({ under: false });
  await wrapped(ctxWith({ noteId: 'n1', versionId: 'v1' }));
  await flush();
  assert.equal(calls.rebuilds, 0);
});

test('saving a named snapshot (no versionId) never checks or rebuilds', async () => {
  const { wrapped, calls } = setup();
  await wrapped(ctxWith({ noteId: 'n1', versionName: 'draft 2' }));
  await flush();
  assert.deepEqual(calls.checked, []);
  assert.equal(calls.rebuilds, 0);
});

test('a failed restore (non-2xx) does not rebuild', async () => {
  const { wrapped, calls } = setup({ status: 403 });
  const res = await wrapped(ctxWith({ noteId: 'n1', versionId: 'v1' }));
  await flush();
  assert.equal(res.status, 403);
  assert.equal(calls.rebuilds, 0);
});
