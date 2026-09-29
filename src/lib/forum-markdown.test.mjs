// Sanitizing mode of the forum renderer (mm always renders with sanitize: true).
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderForumMarkdown } from './forum-markdown.ts';

const safe = (md) => renderForumMarkdown(md, { sanitize: true, remoteLilypond: false });

test('sanitize strips script, event handlers, javascript: links and iframes', async () => {
  const html = await safe([
    'Hello <script>alert(1)</script>',
    '',
    '<img src="https://x.test/a.png" onerror="alert(2)">',
    '',
    '[click](javascript:alert(3)) <a href="javascript:alert(4)">raw</a>',
    '',
    '<iframe src="https://evil.test/"></iframe>',
    '',
    '<div style="position:fixed" onclick="x()">styled</div>',
    '',
    '<img src="javascript:alert(5)">',
  ].join('\n'));
  assert.ok(!/<script/i.test(html), html);
  assert.ok(!/alert\(1\)/.test(html), html);
  assert.ok(!/onerror|onclick/i.test(html), html);
  assert.ok(!/javascript:/i.test(html), html);
  assert.ok(!/<iframe/i.test(html), html);
  assert.ok(!/style=/i.test(html), html);
  // External images never load (no third-party requests): they become links.
  assert.ok(!/<img src="https:/.test(html), html);
  assert.match(html, /<a rel="nofollow noopener noreferrer" href="https:\/\/x\.test\/a\.png">\[image\]<\/a>/);
  assert.ok(!/<img src="javascript/.test(html), html);
  assert.match(html, /styled/);
});

test('sanitize keeps KaTeX math (rendered after sanitizing)', async () => {
  const html = await safe('Inline $e^{i\\pi}+1=0$ and\n\n$$\n\\int_0^1 x\\,dx\n$$\n');
  assert.match(html, /class="katex"/);
  assert.match(html, /katex-display/);
  assert.match(html, /<math/);
});

test('sanitize keeps a LilyPond figure (inline svg replaced by its image) and remote figures', async () => {
  const local = await safe('<figure class="lilypond-block lily-score" data-lily-url="/lily/abc123.svg" data-midi-url="/lily/abc123.midi"><svg onload="alert(1)"><script>x</script></svg></figure>');
  assert.match(local, /<figure class="lilypond-block lily-score" data-lily-url="\/lily\/abc123\.svg" data-midi-url="\/lily\/abc123\.midi">/);
  assert.match(local, /<img src="\/lily\/abc123\.svg" alt="" loading="lazy"/);
  assert.ok(!/<svg|onload|<script/.test(local), local);

  // Remote (third-party) scores are not loaded in sanitize mode.
  const remote = await safe('<figure class="lilypond-block lily-score" data-lily-url="https://lily.test/s.svg" data-midi-url="https://lily.test/s.midi"><img src="https://lily.test/s.svg" alt="" loading="lazy" /></figure>');
  assert.ok(!/<img/.test(remote), remote);
  assert.ok(!/data-lily-url|data-midi-url/.test(remote), remote);
  assert.match(remote, /<a rel="nofollow noopener noreferrer" href="https:\/\/lily\.test\/s\.svg">\[image\]<\/a>/);
  const remoteNoImg = await safe('<figure class="lilypond-block lily-score" data-lily-url="https://lily.test/s.svg"></figure>');
  assert.ok(!/<img|lily\.test/.test(remoteNoImg), remoteNoImg);

  const evil = await safe('<figure class="lilypond-block" data-lily-url="javascript:alert(1)"></figure>');
  assert.ok(!/<img/.test(evil), evil);
});

test('sanitize keeps Seshat citation spans, references, callouts, highlights and code classes', async () => {
  const html = await safe([
    'See <span class="seshat-citation" data-citekey="stiegler1998">(Stiegler, 1998)</span>.',
    '',
    '<section class="seshat-references" data-citekeys="stiegler1998"><div class="csl-entry"><span class="csl-author">Stiegler</span> (1998)</div></section>',
    '',
    '> [!note] Title',
    '> body',
    '',
    '==marked==',
    '',
    '```js',
    'const a = 1;',
    '```',
  ].join('\n'));
  assert.match(html, /<span class="seshat-citation" data-citekey="stiegler1998">\(Stiegler, 1998\)<\/span>/);
  assert.match(html, /<section class="seshat-references" data-citekeys="stiegler1998">/);
  assert.match(html, /<span class="csl-author">/);
  assert.match(html, /<aside class="callout callout-note">/);
  assert.match(html, /<mark>marked<\/mark>/);
  assert.match(html, /language-js/);
  assert.match(html, /hljs/);
});

test('without sanitize (musiki default) raw HTML is unchanged', async () => {
  const html = await renderForumMarkdown('<div style="color:red">x</div>', { remoteLilypond: false });
  assert.match(html, /style="color:red"/);
});

test('sanitize: only same-origin /lily/ and /mm/ media load; others become links', async () => {
  const html = await safe([
    '![local](/mm/files/a.png) ![score](/lily/abc.svg)',
    '',
    '![tracker](https://t.test/p.gif) ![proto](//t.test/p.gif) ![up](/lily/../secret.png) ![other](/api/x.png)',
    '',
    '![clip](https://t.test/a.mp3)',
    '',
    '<video src="/mm/v.mp4" poster="https://t.test/p.jpg" controls></video>',
    '',
    '<video controls><source src="https://t.test/v.mp4" type="video/mp4"></video>',
    '',
    '[![inlink](https://t.test/i.png)](https://example.test/)',
    '',
    '<img src="data:image/png;base64,AAAA" alt="d">',
  ].join('\n'));
  assert.match(html, /<img src="\/mm\/files\/a\.png" alt="local"/);
  assert.match(html, /<img src="\/lily\/abc\.svg" alt="score"/);
  assert.match(html, /href="https:\/\/t\.test\/p\.gif">\[image: tracker\]<\/a>/);
  assert.match(html, /\[image: proto\]/);
  assert.match(html, /\[image: up\]/);
  assert.match(html, /\[image: other\]/);
  assert.match(html, /href="https:\/\/t\.test\/a\.mp3">\[audio\]<\/a>/);
  assert.match(html, /<video src="\/mm\/v\.mp4" controls>/);
  assert.match(html, /href="https:\/\/t\.test\/v\.mp4">\[video\]<\/a>/);
  assert.match(html, /<a href="https:\/\/example\.test\/">\[image: inlink\]<\/a>/);
  assert.ok(!/<a[^>]*><a/.test(html), html);
  // Nothing but same-origin paths in any src/poster.
  for (const m of html.matchAll(/(?:src|poster)="([^"]*)"/g)) assert.match(m[1], /^\/(lily|mm)\//, html);
  assert.ok(!/href="\/\/|href="data:/.test(html), html);
});

test('sanitize strips `% rendered:` lines inside LilyPond fences only', async () => {
  const { remarkStripLilyRenderedComments } = await import('./forum-markdown.ts');
  const tree = {
    type: 'root',
    children: [
      { type: 'code', lang: 'lilypond', value: '% rendered: sha1:abc https://evil.test/x.svg\n{ c4 }\n  %rendered: again' },
      { type: 'code', lang: 'js', value: '% rendered: keep' },
    ],
  };
  remarkStripLilyRenderedComments()(tree);
  assert.equal(tree.children[0].value, '{ c4 }');
  assert.equal(tree.children[1].value, '% rendered: keep');
});

test('without sanitize, remote/external media behaviour is unchanged', async () => {
  const html = await renderForumMarkdown('![x](https://t.test/p.gif)', { remoteLilypond: false });
  assert.match(html, /<img src="https:\/\/t\.test\/p\.gif" alt="x"/);
});

test('citations option: custom resolver, localized heading and lang; unresolved keys stay literal', async () => {
  const seen = [];
  const resolve = async (keys) => {
    seen.push(keys);
    return new Map([['stiegler1998', { id: 'stiegler1998', type: 'book', title: 'Technics and Time', author: [{ family: 'Stiegler', given: 'Bernard' }], issued: { 'date-parts': [[1998]] } }]]);
  };
  const html = await renderForumMarkdown('See [@stiegler1998] and [@missing].', {
    sanitize: true, remoteLilypond: false, citations: { headingText: 'Referanser', lang: 'nb-NO', resolve },
  });
  assert.deepEqual(seen, [['stiegler1998', 'missing']]);
  assert.match(html, /<span class="seshat-citation" data-citekey="stiegler1998">/);
  assert.match(html, /Stiegler/);
  assert.match(html, /\[@missing\]/);
  assert.match(html, /<h1>Referanser<\/h1>/);
  assert.match(html, /<section class="seshat-references" data-citekeys="stiegler1998">/);
});

test('citations option: a failing resolver leaves the text as written', async () => {
  const html = await renderForumMarkdown('See [@k1].', {
    sanitize: true, remoteLilypond: false, citations: { resolve: async () => { throw new Error('down'); } },
  });
  assert.match(html, /\[@k1\]/);
});

test('sanitize mode never renders Mermaid (the source stays a code block)', async () => {
  // Would hang the JSDOM renderer (waits for the <img> to load) if rendered.
  const md = '```mermaid\ngraph TD; A["<img src=/mm/a.png>"]-->B\n```\n';
  let timer;
  const html = await Promise.race([
    safe(md),
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('mermaid render not skipped')), 5000); }),
  ]).finally(() => clearTimeout(timer));
  assert.match(html, /<pre[^>]*><code class="[^"]*language-mermaid/);
  assert.ok(!/<svg|class="mermaid/.test(html), html);
  assert.ok(!/<img/.test(html), html);
});

test('sanitize: `% rendered:` stripping splits on every line terminator', async () => {
  const { remarkStripLilyRenderedComments } = await import('./forum-markdown.ts');
  const tree = { type: 'root', children: [{ type: 'code', lang: 'ly', value: '{ c4 }\r% rendered: a https://e.test/x.svg\u2028% rendered: b\r\n{ d4 }\u2029%rendered: c' }] };
  remarkStripLilyRenderedComments()(tree);
  assert.equal(tree.children[0].value, '{ c4 }\n{ d4 }');
});

test('lilypond scores never get a visible caption from their alt text', async () => {
  const { default: rehypeObsidianImageSize } = await import('../plugins/rehype-obsidian-image-size.mjs');
  const tree = { type: 'root', children: [{ type: 'element', tagName: 'figure', properties: { className: ['lilypond-block', 'lily-score'] }, children: [
    { type: 'element', tagName: 'img', properties: { src: '/lily/abc.svg', alt: '' }, children: [] },
  ] }] };
  rehypeObsidianImageSize()(tree);
  const fig = tree.children[0];
  assert.equal(fig.children.length, 1);
  assert.equal(fig.children[0].tagName, 'img');
  assert.equal(fig.children[0].properties.alt, '');
});
