// Core of /api/lily/render against a fake lilypond-service socket.
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fakeService, makeTmpDir, ok, EVIL_SVG, LILY_SVG } from './test/fake-service.mjs';

const workDir = makeTmpDir('lily-api-');
process.chdir(workDir); // isolates .cache/lilypond-renders.json

const { handleLilyRenderPost, handleLilyAssetGet, handleLilyFileGet, MAX_SOURCE_BYTES } = await import('./render-api.mjs');
const { resetLilypondServiceState } = await import('./service.mjs');
const { withRenderedLilypondComment, cacheRenderedLilypondUrl, getCachedRenderedLilypondUrl } = await import('../lilypond-rendered-comment.mjs');
const R2_ENV = { R2_PUBLIC_URL: 'https://pub-abc.r2.dev' };

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

  test('`% rendered:` comments in the POST body are ignored and never persisted', async () => {
    const r2 = 'https://pub-abc.r2.dev/scores/0123456789abcdef0123456789abcdef.svg';
    const code = withRenderedLilypondComment('{ a4 }', r2);
    const fetched = [];
    const fetchImpl = async (u) => { fetched.push(u); return new Response(LILY_SVG); };
    const before = srv.seen.length;
    const { status, json } = parse(await handleLilyRenderPost({ code }, { dir, env: { ...env, ...R2_ENV }, fetchImpl }));
    assert.equal(status, 200);
    assert.equal(json.generated, true, 'rendered by the service, not taken from the comment');
    assert.equal(srv.seen.length, before + 1);
    assert.equal(fetched.length, 0);
    assert.equal(getCachedRenderedLilypondUrl('{ a4 }'), '', 'nothing persisted to the render cache');
  });

  test('a trusted render-cache entry (legacy R2) is reused and copied locally without rendering', async () => {
    const r2 = 'https://pub-abc.r2.dev/scores/fedcba9876543210fedcba9876543210.svg';
    cacheRenderedLilypondUrl('{ h4 }', r2); // what page rendering / publish do for trusted content
    const fetched = [];
    const fetchImpl = async (u) => {
      fetched.push(u);
      if (u.endsWith('.svg')) return new Response(EVIL_SVG);
      return new Response('nope', { status: 404 });
    };
    const before = srv.seen.length;
    const { status, json } = parse(await handleLilyRenderPost({ code: '{ h4 }' }, { dir, env: { ...env, ...R2_ENV }, fetchImpl }));
    assert.equal(status, 200);
    assert.equal(srv.seen.length, before, 'service not called');
    assert.equal(json.cached, true);
    const hash = md5('{ h4 }');
    assert.equal(json.url, `/lily/${hash}.svg`);
    assert.doesNotMatch(fs.readFileSync(path.join(dir, `${hash}.svg`), 'utf8'), /<script|onload=/i);
    assert.ok(fetched.every((u) => u.startsWith('https://pub-abc.r2.dev/')));
  });

  test('rate limit: 429 before a service render; cached scores are not limited', async () => {
    const code = '{ rl4 }';
    let asked = 0;
    const deny = () => { asked += 1; return { ok: false, retryAfterMs: 30_000 }; };
    const res = await handleLilyRenderPost({ code }, { dir, env, limiter: deny, clientKey: 'ip:1.2.3.4' });
    assert.equal(res.status, 429);
    assert.equal(res.headers['Retry-After'], '30');
    await handleLilyRenderPost({ code }, { dir, env });
    const cachedRes = await handleLilyRenderPost({ code }, { dir, env, limiter: deny });
    assert.equal(cachedRes.status, 200);
    assert.equal(asked, 1);
  });

  test('score hitting the service timeout (504) → 422; busy → 503', async () => {
    reply = ({ source }) => (source.includes('loop')
      ? { status: 504, body: { error: 'lilypond timed out after 20000 ms' } }
      : { status: 503, body: { error: 'busy' } });
    const t = parse(await handleLilyRenderPost({ code: '{ loop }' }, { dir, env }));
    assert.equal(t.status, 422);
    const b = await handleLilyRenderPost({ code: '{ crowded }' }, { dir, env });
    assert.equal(b.status, 503);
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
    cacheRenderedLilypondUrl('{ trusted-attacker }', 'https://attacker.r2.dev/0123456789abcdef0123456789abcdef.svg');
    for (const url of [
      'https://evil.example/0123456789abcdef0123456789abcdef.svg',
      'https://attacker.r2.dev/0123456789abcdef0123456789abcdef.svg',
      'https://pub-abc.r2.dev/scores/not-in-cache-0123456789abcdef0123456789abcdef.svg',
      'http://pub-abc.r2.dev/0123456789abcdef0123456789abcdef.svg',
      'http://127.0.0.1:4321/0123456789abcdef0123456789abcdef.svg',
      'https://user:pw@pub-abc.r2.dev/0123456789abcdef0123456789abcdef.svg',
    ]) {
      const res = await handleLilyAssetGet(url, { dir, fetchImpl, env: R2_ENV });
      assert.equal(res.status, 404, url);
    }
    assert.equal(fetched.length, 0);
    assert.equal(fs.readdirSync(dir).length, 0);
  });

  test('proxies a configured-host R2 object known to the render cache, sanitized, under md5(url)', async () => {
    const url = 'https://scores.example.org/scores/0123456789abcdef0123456789abcdef.svg';
    cacheRenderedLilypondUrl('{ known }', url);
    const fetchImpl = async (u) => (u.endsWith('.svg') ? new Response(EVIL_SVG) : u.endsWith('.midi') ? new Response('MThd') : new Response('', { status: 404 }));
    const env = { R2_PUBLIC_URL: 'https://scores.example.org' };
    const res = await handleLilyAssetGet(url, { dir, fetchImpl, env });
    assert.equal(res.status, 200);
    assert.doesNotMatch(String(res.body), /<script|onload=/i);
    assert.ok(fs.existsSync(path.join(dir, `${md5(url)}.svg`)), 'stored in the md5(url) namespace');
    assert.ok(!fs.existsSync(path.join(dir, '0123456789abcdef0123456789abcdef.svg')), 'remote name never shadows a local render');
    const midi = await handleLilyAssetGet(url.replace('.svg', '.midi'), { dir, fetchImpl, env });
    assert.equal(midi.status, 200, 'player MIDI proxy candidate keeps working');
    assert.equal(midi.headers['Content-Security-Policy'], 'sandbox');
    assert.match(midi.headers['Content-Disposition'], /^attachment; filename="[a-f0-9]{32}\.midi"$/);
  });

  test('remote downloads are capped at 2 MB (declared and streamed)', async () => {
    const url = 'https://scores.example.org/scores/11111111111111111111111111111111.svg';
    cacheRenderedLilypondUrl('{ big }', url);
    const env = { R2_PUBLIC_URL: 'https://scores.example.org' };
    const warn = console.warn;
    console.warn = () => {};
    try {
      const declared = async () => new Response('x', { headers: { 'content-length': String(3 * 1024 * 1024) } });
      assert.equal((await handleLilyAssetGet(url, { dir, fetchImpl: declared, env })).status, 404);
      const streamed = async () => new Response(new ReadableStream({
        start(controller) {
          for (let i = 0; i < 3; i += 1) controller.enqueue(new Uint8Array(1024 * 1024));
          controller.close();
        },
      }));
      assert.equal((await handleLilyAssetGet(url, { dir, fetchImpl: streamed, env })).status, 404);
    } finally {
      console.warn = warn;
    }
    assert.equal(fs.readdirSync(dir).length, 0);
  });
});

describe('GET /lily/<hash>.<ext> (file route)', () => {
  const H = 'a'.repeat(32);
  let store;
  let dist;
  let pub;
  let readDirs;
  beforeEach(() => {
    store = makeTmpDir('lily-store-');
    dist = makeTmpDir('lily-dist-');
    pub = makeTmpDir('lily-public-');
    readDirs = [store, dist, pub];
  });

  test('serves SVG from the store, sanitized, with CSP sandbox + nosniff + immutable cache', async () => {
    fs.writeFileSync(path.join(store, `${H}.svg`), EVIL_SVG);
    const res = await handleLilyFileGet(`${H}.svg`, { readDirs });
    assert.equal(res.status, 200);
    assert.equal(res.headers['Content-Type'], 'image/svg+xml; charset=utf-8');
    assert.equal(res.headers['Content-Security-Policy'], "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    assert.equal(res.headers['X-Content-Type-Options'], 'nosniff');
    assert.equal(res.headers['Cache-Control'], 'public, max-age=31536000, immutable');
    assert.doesNotMatch(String(res.body), /<script|onload=|javascript:/i);
  });

  test('MIDI and PDF are sandboxed attachments; .mid request finds a .midi file', async () => {
    fs.writeFileSync(path.join(store, `${H}.midi`), 'MThd');
    fs.writeFileSync(path.join(store, `${H}.pdf`), '%PDF-1.4');
    for (const ext of ['midi', 'mid']) {
      const res = await handleLilyFileGet(`${H}.${ext}`, { readDirs });
      assert.equal(res.status, 200, ext);
      assert.equal(res.headers['Content-Type'], 'audio/midi');
      assert.equal(res.headers['Content-Security-Policy'], 'sandbox');
      assert.match(res.headers['Content-Disposition'], new RegExp(`^attachment; filename="${H}\\.midi"$`));
      assert.equal(res.headers['X-Content-Type-Options'], 'nosniff');
      assert.equal(Buffer.from(res.body).toString(), 'MThd');
    }
    const pdf = await handleLilyFileGet(`${H}.pdf`, { readDirs });
    assert.equal(pdf.headers['Content-Type'], 'application/pdf');
    assert.equal(pdf.headers['Content-Security-Policy'], 'sandbox');
    assert.match(pdf.headers['Content-Disposition'], /^attachment; filename="a+\.pdf"$/);
  });

  test('fallback order: store, then dist/client/lily, then public/lily', async () => {
    fs.writeFileSync(path.join(pub, `${H}.svg`), LILY_SVG.replace('Allegro', 'public'));
    let res = await handleLilyFileGet(`${H}.svg`, { readDirs });
    assert.match(String(res.body), /public &amp; co|public &#x26; co/);
    fs.writeFileSync(path.join(dist, `${H}.svg`), LILY_SVG.replace('Allegro', 'dist'));
    res = await handleLilyFileGet(`${H}.svg`, { readDirs });
    assert.match(String(res.body), /dist &amp; co|dist &#x26; co/);
    fs.writeFileSync(path.join(store, `${H}.svg`), LILY_SVG.replace('Allegro', 'store'));
    res = await handleLilyFileGet(`${H}.svg`, { readDirs });
    assert.match(String(res.body), /store &amp; co|store &#x26; co/);
    fs.writeFileSync(path.join(pub, `${H}.midi`), 'MThd-public');
    res = await handleLilyFileGet(`${H}.midi`, { readDirs });
    assert.equal(Buffer.from(res.body).toString(), 'MThd-public');
  });

  test('strict names: traversal, other extensions, uppercase, short hashes and missing files are 404', async () => {
    fs.writeFileSync(path.join(store, `${H}.svg`), LILY_SVG);
    fs.writeFileSync(path.join(path.dirname(store), 'secret.svg'), LILY_SVG);
    for (const name of [
      '../secret.svg', `../${path.basename(store)}/${H}.svg`, '..%2Fsecret.svg', `${H}.svg/..`, `${H}.SVG`, `${'A'.repeat(32)}.svg`,
      `${'a'.repeat(31)}.svg`, `${'a'.repeat(65)}.svg`, `${H}.ly`, `${H}.svg.tmp`, `${H}`, '', null, undefined,
      `${H}.svg\0`, `x${H}.svg`, `${'b'.repeat(32)}.svg`,
    ]) {
      const res = await handleLilyFileGet(name, { readDirs });
      assert.equal(res.status, 404, String(name));
      assert.equal(res.headers['X-Content-Type-Options'], 'nosniff');
    }
  });
});

describe('GET /api/lily/render?url= reads the store and legacy dirs', () => {
  test('a local /lily/<hash>.svg found only in a legacy read dir is served', async () => {
    const H = 'c'.repeat(32);
    const store = makeTmpDir('lily-store-');
    const legacy = makeTmpDir('lily-legacy-');
    fs.writeFileSync(path.join(legacy, `${H}.svg`), LILY_SVG);
    const res = await handleLilyAssetGet(`/lily/${H}.svg`, { dir: store, readDirs: [store, legacy], env: {} });
    assert.equal(res.status, 200);
    assert.match(String(res.body), /<svg/);
  });
});
