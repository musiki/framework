import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { renderLilypond, resetLilypondServiceState } from './service.mjs';
import { isLocalRenderAllowed } from './local-render.mjs';
import { fakeService, makeTmpDir, ok, HASH } from './test/fake-service.mjs';

const ENGLISH_SCORE = '\\language "english"\n\\score { { cis\'4 d e f } }';

function captureWarnings() {
  const original = console.warn;
  const lines = [];
  console.warn = (...args) => lines.push(args.join(' '));
  return { lines, restore: () => { console.warn = original; } };
}

describe('renderLilypond (service client, attempts loop)', () => {
  let srv;
  beforeEach(() => resetLilypondServiceState());
  afterEach(async () => { if (srv) await srv.close(); srv = null; });

  test('prepares the source (\\layout + \\midi) and returns the first successful render', async () => {
    srv = await fakeService(() => ok());
    const out = await renderLilypond('\\score { { c\'4 } }', { env: { LILYPOND_SOCKET: srv.socketPath } });
    assert.equal(out.ok, true);
    assert.equal(out.result.hash, HASH);
    assert.ok(Buffer.isBuffer(out.result.midi));
    assert.equal(srv.seen.length, 1);
    assert.match(srv.seen[0].source, /\\layout \{ \}/);
    assert.match(srv.seen[0].source, /\\midi \{ \}/);
    assert.deepEqual(srv.seen[0].formats, ['svg', 'midi']);
  });

  test('on render_failed moves on to the english → nederlands attempt', async () => {
    srv = await fakeService(({ source }) => (source.includes('"english"')
      ? { status: 422, body: { error: 'lilypond failed', stderr: 'in.ly:2: error: unknown pitch' } }
      : ok()));
    const out = await renderLilypond(ENGLISH_SCORE, { env: { LILYPOND_SOCKET: srv.socketPath } });
    assert.equal(out.ok, true);
    assert.equal(out.attempt, 1);
    assert.equal(srv.seen.length, 2);
    assert.match(srv.seen[1].source, /\\language "nederlands"/);
  });

  test('reports render_failed with the scrubbed stderr when every attempt fails', async () => {
    srv = await fakeService(() => ({ status: 422, body: { error: 'lilypond failed', stderr: 'in.ly:1:1: error: x' } }));
    const out = await renderLilypond(ENGLISH_SCORE, { env: { LILYPOND_SOCKET: srv.socketPath } });
    assert.equal(out.ok, false);
    assert.equal(out.reason, 'render_failed');
    assert.equal(out.stderr, 'in.ly:1:1: error: x');
    assert.equal(srv.seen.length, 2);
  });

  test('retries once the service is no longer busy', async () => {
    let calls = 0;
    srv = await fakeService(() => (++calls === 1 ? { status: 503, body: { error: 'busy' } } : ok()));
    const out = await renderLilypond('{ c4 }', { env: { LILYPOND_SOCKET: srv.socketPath } });
    assert.equal(out.ok, true);
    assert.equal(calls, 2);
  });

  test('bad_request / too_large are not retried', async () => {
    srv = await fakeService(() => ({ status: 413, body: { error: 'body exceeds 262144 bytes' } }));
    const out = await renderLilypond(ENGLISH_SCORE, { env: { LILYPOND_SOCKET: srv.socketPath } });
    assert.deepEqual([out.ok, out.reason], [false, 'too_large']);
    assert.equal(srv.seen.length, 1);
  });

  test('empty source never reaches the service', async () => {
    const out = await renderLilypond('   \n', { env: { LILYPOND_SOCKET: '/nonexistent/lily.sock' } });
    assert.deepEqual([out.ok, out.reason], [false, 'empty']);
  });
});

describe('graceful degradation', () => {
  beforeEach(() => resetLilypondServiceState());

  test('unreachable socket → unavailable, logged once, then the circuit short-circuits', async () => {
    const env = { LILYPOND_SOCKET: path.join(makeTmpDir(), 'missing.sock') };
    const warn = captureWarnings();
    try {
      let t = 1_000_000;
      const now = () => t;
      const a = await renderLilypond('{ c4 }', { env, now });
      const b = await renderLilypond('{ d4 }', { env, now });
      t += 60_000; // circuit closes again, still unreachable
      const c = await renderLilypond('{ e4 }', { env, now });
      assert.deepEqual([a.ok, a.reason], [false, 'unavailable']);
      assert.deepEqual([b.ok, b.reason], [false, 'unavailable']);
      assert.deepEqual([c.ok, c.reason], [false, 'unavailable']);
      assert.equal(warn.lines.filter((l) => l.includes('[lilypond] render service unavailable')).length, 1);
    } finally {
      warn.restore();
    }
  });

  test('client timeout degrades without throwing', async () => {
    const srv = await fakeService(() => undefined); // never answers
    try {
      const warn = captureWarnings();
      const out = await renderLilypond('{ c4 }', { env: { LILYPOND_SOCKET: srv.socketPath }, timeoutMs: 150 });
      warn.restore();
      assert.deepEqual([out.ok, out.reason], [false, 'timeout']);
    } finally {
      await srv.close();
    }
  });
});

describe('local binary gate', () => {
  test('LILYPOND_ALLOW_LOCAL=1 only outside production; default off', () => {
    assert.equal(isLocalRenderAllowed({}), false);
    assert.equal(isLocalRenderAllowed({ LILYPOND_ALLOW_LOCAL: '1', NODE_ENV: 'development' }), true);
    assert.equal(isLocalRenderAllowed({ LILYPOND_ALLOW_LOCAL: '1', NODE_ENV: 'production' }), false);
    assert.equal(isLocalRenderAllowed({ LILYPOND_ALLOW_LOCAL: 'true' }), false);
  });

  test('without the gate an unreachable service never falls back to a local binary', async () => {
    resetLilypondServiceState();
    const warn = captureWarnings();
    const calls = [];
    const client = { render: async () => { calls.push(1); const e = new Error('down'); e.code = 'unavailable'; throw e; } };
    const out = await renderLilypond('{ c4 }', { client, env: { LILYPOND_ALLOW_LOCAL: '1', NODE_ENV: 'production' } });
    warn.restore();
    assert.deepEqual([out.ok, out.reason], [false, 'unavailable']);
    assert.equal(calls.length, 1);
  });
});
