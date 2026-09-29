// Core of /api/lily/render against a fake lilypond-service socket.
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fakeService, makeTmpDir, ok, EVIL_SVG, LILY_SVG } from './test/fake-service.mjs';

const workDir = makeTmpDir('lily-api-');
process.chdir(workDir); // isolates .cache/lilypond-renders.json

const { handleLilyRenderPost, handleLilyAssetGet, MAX_SOURCE_BYTES } = await import('./render-api.mjs');
const { resetLilypondServiceState } = await import('./service.mjs');
const { withRenderedLilypondComment } = await import('../lilypond-rendered-comment.mjs');

const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');
const parse = (res) => ({ status: res.status, json: JSON.parse(res.body) });

describe('POST /api/lily/render', () => {
  let srv;
  let reply = () => ok();
  let dir;
  let env;
  before(async () => { srv = await fakeService((body) => reply(body)); });
  after(() => srv.close());
  beforeEach(() => {
    resetLilypondServiceState();
    reply = () => ok();
    dir = makeTmpDir('lily-api-dir-');
    env = { LILYPOND_SOCKET: srv.socketPath };
  });

  test('renders through the service and answers with the same JSON shape as before', async () => {
    const code = "{ c'4 }";
    const { status, json } = parse(await handleLilyRenderPost({ code }, { dir, env }));
    const hash = md5(code);
    assert.equal(status, 200);
    assert.deepEqual(json, { success: true, hash, url: `/lily/${hash}.svg`, midiUrl: `/lily/${hash}.midi`, pdfUrl: '', generated: true, cached: false });
    assert.ok(fs.existsSync(path.join(dir, `${hash}.svg`)));
  });

  test('second request is served from public/lily without calling the service', async () => {
    const code = '{ d4 }';
    await handleLilyRenderPost({ code }, { dir, env });
    const before = srv.seen.length;
    const { json } = parse(await handleLilyRenderPost({ code }, { dir, env }));
    assert.equal(srv.seen.length, before);
    assert.equal(json.generated, false);
  });

  test('validation: invalid JSON 400, empty 400, too large 413', async () => {
    assert.equal((await handleLilyRenderPost(null, { dir, env })).status, 400);
    assert.equal((await handleLilyRenderPost({ code: '  ' }, { dir, env })).status, 400);
    assert.equal((await handleLilyRenderPost({ code: 'x'.repeat(MAX_SOURCE_BYTES + 1) }, { dir, env })).status, 413);
  });

  test('render failure → 422 with scrubbed stderr details', async () => {
    reply = () => ({ status: 422, body: { error: 'lilypond failed', stderr: 'in.ly:1: error: bad' } });
    const { status, json } = parse(await handleLilyRenderPost({ code: '{ bad' }, { dir, env }));
    assert.equal(status, 422);
    assert.equal(json.success, false);
    assert.equal(json.details, 'in.ly:1: error: bad');
  });

  test('service unreachable → 502 {success:false}', async () => {
    const res = parse(await handleLilyRenderPost({ code: '{ e4 }' }, { dir, env: { LILYPOND_SOCKET: path.join(dir, 'nope.sock') } }));
    assert.equal(res.status, 502);
    assert.equal(res.json.success, false);
  });

  test('malicious SVG is sanitized before it is stored', async () => {
    reply = () => ok({ svg: EVIL_SVG });
    const code = '{ f4 }';
    await handleLilyRenderPost({ code }, { dir, env });
    const stored = fs.readFileSync(path.join(dir, `${md5(code)}.svg`), 'utf8');
    assert.doesNotMatch(stored, /<script|onload=|onerror=|javascript:|foreignObject|evil\.example/i);
  });

  test('format=pdf renders a PDF through the service', async () => {
    reply = ({ formats }) => ({ status: 200, body: { hash: 'c'.repeat(64), cached: false, ...(formats.includes('pdf') ? { pdf: Buffer.from('%PDF-1.7').toString('base64') } : {}) } });
    const code = '{ g4 }';
    const { status, json } = parse(await handleLilyRenderPost({ code, format: 'pdf' }, { dir, env }));
    assert.equal(status, 200);
    assert.deepEqual(json, { success: true, url: `/lily/${md5(code)}.pdf` });
    assert.equal(fs.readFileSync(path.join(dir, `${md5(code)}.pdf`), 'utf8'), '%PDF-1.7');
    assert.deepEqual(srv.seen.at(-1).formats, ['pdf']);
  });

  test('legacy `% rendered:` R2 URL is reused (and copied locally) without rendering', async () => {
    const r2 = 'https://pub-abc.r2.dev/scores/0123456789abcdef0123456789abcdef.svg';
    const code = withRenderedLilypondComment('{ a4 }', r2);
    const fetched = [];
    const fetchImpl = async (u) => {
      fetched.push(u);
      if (u.endsWith('.svg')) return new Response(EVIL_SVG);
      return new Response('nope', { status: 404 });
    };
    const before = srv.seen.length;
    const { status, json } = parse(await handleLilyRenderPost({ code }, { dir, env, fetchImpl }));
    assert.equal(status, 200);
    assert.equal(srv.seen.length, before, 'service not called');
    assert.equal(json.cached, true);
    const hash = md5('{ a4 }');
    assert.equal(json.url, `/lily/${hash}.svg`);
    assert.doesNotMatch(fs.readFileSync(path.join(dir, `${hash}.svg`), 'utf8'), /<script|onload=/i);
    assert.ok(fetched.every((u) => u.startsWith('https://pub-abc.r2.dev/')));
  });
});

describe('GET /api/lily/render?url=', () => {
  let dir;
  beforeEach(() => { dir = makeTmpDir('lily-get-'); });

  test('serves a local SVG sanitized, with CSP + nosniff', async () => {
    const hash = 'a'.repeat(32);
    fs.writeFileSync(path.join(dir, `${hash}.svg`), EVIL_SVG);
    const res = await handleLilyAssetGet(`/lily/${hash}.svg`, { dir });
    assert.equal(res.status, 200);
    assert.match(res.headers['Content-Type'], /image\/svg\+xml/);
    assert.match(res.headers['Content-Security-Policy'], /default-src 'none'/);
    assert.equal(res.headers['X-Content-Type-Options'], 'nosniff');
    assert.doesNotMatch(String(res.body), /<script|onload=|javascript:/i);
  });

  test('serves local MIDI (legacy .mid renamed) and rejects unknown types', async () => {
    const hash = 'd'.repeat(32);
    fs.writeFileSync(path.join(dir, `${hash}.mid`), 'MThd');
    const res = await handleLilyAssetGet(`/lily/${hash}.midi`, { dir });
    assert.equal(res.status, 200);
    assert.equal(res.headers['Content-Type'], 'audio/midi');
    assert.equal(String(res.body), 'MThd');
    assert.equal((await handleLilyAssetGet('/lily/x.html', { dir })).status, 400);
    assert.equal((await handleLilyAssetGet(null, { dir })).status, 400);
  });

  test('never fetches URLs outside the allowed R2 hosts (no SSRF / cache poisoning)', async () => {
    const fetched = [];
    const fetchImpl = async (u) => { fetched.push(u); return new Response(LILY_SVG); };
    for (const url of [
      'https://evil.example/0123456789abcdef0123456789abcdef.svg',
      'http://pub-abc.r2.dev/0123456789abcdef0123456789abcdef.svg',
      'http://127.0.0.1:4321/0123456789abcdef0123456789abcdef.svg',
      'https://user:pw@pub-abc.r2.dev/0123456789abcdef0123456789abcdef.svg',
    ]) {
      const res = await handleLilyAssetGet(url, { dir, fetchImpl, env: {} });
      assert.equal(res.status, 502, url);
    }
    assert.equal(fetched.length, 0);
    assert.equal(fs.readdirSync(dir).length, 0);
  });

  test('proxies an allowed R2 object (R2_PUBLIC_URL host) and sanitizes it', async () => {
    const fetchImpl = async (u) => (u.endsWith('.svg') ? new Response(EVIL_SVG) : new Response('', { status: 404 }));
    const url = 'https://scores.example.org/scores/0123456789abcdef0123456789abcdef.svg';
    const res = await handleLilyAssetGet(url, { dir, fetchImpl, env: { R2_PUBLIC_URL: 'https://scores.example.org' } });
    assert.equal(res.status, 200);
    assert.doesNotMatch(String(res.body), /<script|onload=/i);
  });
});
