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
  assert.match(html, /<img src="https:\/\/x\.test\/a\.png"[ >]/);
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
  assert.match(local, /<img src="\/lily\/abc123\.svg" alt="LilyPond notation render" loading="lazy"/);
  assert.ok(!/<svg|onload|<script/.test(local), local);

  const remote = await safe('<figure class="lilypond-block lily-score" data-lily-url="https://lily.test/s.svg"><img src="https://lily.test/s.svg" alt="LilyPond notation render" loading="lazy" /></figure>');
  assert.match(remote, /<img src="https:\/\/lily\.test\/s\.svg" alt="LilyPond notation render" loading="lazy"/);

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
