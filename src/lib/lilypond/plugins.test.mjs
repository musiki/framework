// remark-lily / remark-remote-lilypond against a fake lilypond-service socket.
import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fakeService, makeTmpDir, ok, EVIL_SVG } from './test/fake-service.mjs';

// lilypond-rendered-comment keeps its cache under <cwd>/.cache: isolate it.
const workDir = makeTmpDir('lily-plugins-');
process.chdir(workDir);
process.env.LILYPOND_PUBLIC_DIR = path.join(workDir, 'public', 'lily');

const { unified } = await import('unified');
const { default: remarkParse } = await import('remark-parse');
const { default: remarkRehype } = await import('remark-rehype');
const { default: rehypeRaw } = await import('rehype-raw');
const { default: rehypeStringify } = await import('rehype-stringify');
const { default: remarkLily } = await import('../../plugins/remark-lily.mjs');
const { default: remarkRemoteLilypond } = await import('../../plugins/remark-remote-lilypond.mjs');
const { resetLilypondServiceState } = await import('./service.mjs');

const lilyDir = process.env.LILYPOND_PUBLIC_DIR;
const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');

async function toHtml(markdown, { remote = false, fetchImpl } = {}) {
  let processor = unified().use(remarkParse).use(remarkLily);
  if (remote) processor = processor.use(remarkRemoteLilypond, { enabled: true, fetch: fetchImpl });
  processor = processor.use(remarkRehype, { allowDangerousHtml: true }).use(rehypeRaw).use(rehypeStringify);
  return String(await processor.process(markdown));
}

describe('remark-lily', () => {
  let srv;
  let reply = () => ok();
  before(async () => {
    srv = await fakeService((body) => reply(body));
    process.env.LILYPOND_SOCKET = srv.socketPath;
  });
  after(async () => { await srv.close(); delete process.env.LILYPOND_SOCKET; });
  beforeEach(() => { resetLilypondServiceState(); reply = () => ok(); });

  test('renders through the service, writes public/lily/<md5>.svg|midi and inlines the SVG', async () => {
    const code = "\\score { { c'4 d' } }";
    const html = await toHtml(`intro\n\n\`\`\`lilypond\n${code}\n\`\`\`\n`);
    const hash = md5(code);
    assert.match(html, new RegExp(`<figure class="lilypond-block lily-score" data-lily-url="/lily/${hash}.svg" data-midi-url="/lily/${hash}.midi">`));
    assert.match(html, /<svg[^>]*viewBox="0 -0 67.9 9.5"/);
    assert.match(html, /Allegro &#x26; co|Allegro &amp; co/);
    assert.doesNotMatch(html, /<pre>/);
    assert.ok(fs.existsSync(path.join(lilyDir, `${hash}.svg`)));
    assert.equal(fs.readFileSync(path.join(lilyDir, `${hash}.midi`), 'utf8'), 'MThd-fake');
    assert.ok(!fs.readdirSync(lilyDir).some((f) => f.endsWith('.ly')), 'no source files written');
  });

  test('uses the cached file without calling the service again; identical blocks render once', async () => {
    const code = '{ e4 f g a }';
    const before = srv.seen.length;
    await toHtml(`\`\`\`ly\n${code}\n\`\`\`\n\n\`\`\`ly\n${code}\n\`\`\`\n`);
    assert.equal(srv.seen.length - before, 1);
    const html = await toHtml(`\`\`\`lily\n${code}\n\`\`\`\n`);
    assert.equal(srv.seen.length - before, 1);
    assert.match(html, /lilypond-block/);
  });

  test('malicious SVG from the service is sanitized before it is written or inlined', async () => {
    reply = () => ok({ svg: EVIL_SVG });
    const code = '{ c4 % evil }';
    const html = await toHtml(`\`\`\`lilypond\n${code}\n\`\`\`\n`);
    const onDisk = fs.readFileSync(path.join(lilyDir, `${md5(code)}.svg`), 'utf8');
    for (const out of [html, onDisk]) {
      assert.doesNotMatch(out, /<script|onload=|onerror=|javascript:|foreignObject|<image|evil\.example/i);
    }
    assert.match(html, /lilypond-block/);
  });

  test('legacy unsanitized file in public/lily is sanitized on read (and rewritten)', async () => {
    const code = '{ legacy }';
    const file = path.join(lilyDir, `${md5(code)}.svg`);
    fs.mkdirSync(lilyDir, { recursive: true });
    fs.writeFileSync(file, EVIL_SVG);
    const before = srv.seen.length;
    const html = await toHtml(`\`\`\`lilypond\n${code}\n\`\`\`\n`);
    assert.equal(srv.seen.length, before, 'cached file used');
    assert.doesNotMatch(html, /<script|onload=|javascript:/i);
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /<script|onload=|javascript:/i);
  });

  test('render failure keeps the code block', async () => {
    reply = () => ({ status: 422, body: { error: 'lilypond failed', stderr: 'boom' } });
    const original = console.error;
    console.error = () => {};
    try {
      const html = await toHtml('```lilypond\n{ broken\n```\n');
      assert.match(html, /<pre><code class="language-lilypond">\{ broken/);
    } finally {
      console.error = original;
    }
  });
});

describe('degradation without the service', () => {
  before(() => { process.env.LILYPOND_SOCKET = path.join(makeTmpDir(), 'none.sock'); resetLilypondServiceState(); });
  after(() => { delete process.env.LILYPOND_SOCKET; });

  test('service unreachable → code block kept, one warning', async () => {
    const original = console.warn;
    const lines = [];
    console.warn = (...a) => lines.push(a.join(' '));
    try {
      const html = await toHtml('```lilypond\n{ c4 d4 }\n```\n\n```lilypond\n{ e4 f4 }\n```\n');
      assert.equal((html.match(/<pre><code class="language-lilypond">/g) || []).length, 2);
      assert.equal(lines.filter((l) => l.includes('render service unavailable')).length, 1);
    } finally {
      console.warn = original;
    }
  });

  test('remark-remote-lilypond still shows a legacy `% rendered:` R2 image, HEAD only on allowed hosts', async () => {
    const { withRenderedLilypondComment } = await import('../lilypond-rendered-comment.mjs');
    const url = 'https://pub-abc.r2.dev/scores/0123456789abcdef0123456789abcdef.svg';
    const block = withRenderedLilypondComment('{ g4 a4 }', url);
    const heads = [];
    const fetchImpl = async (u, init) => { heads.push([u, init?.method]); return { ok: u.endsWith('.midi') }; };
    const html = await toHtml(`\`\`\`lilypond\n${block}\n\`\`\`\n`, { remote: true, fetchImpl });
    assert.match(html, new RegExp(`<figure class="lilypond-block lily-score" data-lily-url="${url.replace(/[.]/g, '\\.')}" data-midi-url="https://pub-abc\\.r2\\.dev/scores/0123456789abcdef0123456789abcdef\\.midi"><img src="${url.replace(/[.]/g, '\\.')}"`));
    assert.deepEqual(heads[0], [url.replace('.svg', '.midi'), 'HEAD']);

    heads.length = 0;
    const evil = withRenderedLilypondComment('{ b4 }', 'https://evil.example/x/0123456789abcdef0123456789abcdef.svg');
    const html2 = await toHtml(`\`\`\`lilypond\n${evil}\n\`\`\`\n`, { remote: true, fetchImpl });
    assert.equal(heads.length, 0, 'no server-side request to a non-allowed host');
    assert.match(html2, /<img src="https:\/\/evil\.example/); // as before: an <img>, not inlined, no midi
    assert.doesNotMatch(html2, /data-midi-url/);
  });
});
