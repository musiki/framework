import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeSvgSecurity } from './svg-sanitize.mjs';
import { LILY_SVG, EVIL_SVG } from './test/fake-service.mjs';

const assertHarmless = (out) => {
  assert.doesNotMatch(out, /<\s*(?:\w+:)?script/i);
  assert.doesNotMatch(out, /<[^>]*\son\w+\s*=/i, "no event handler attribute inside a tag");
  assert.doesNotMatch(out, /javascript:/i);
  assert.doesNotMatch(out, /<(?:\w+:)?foreignObject/i);
  assert.doesNotMatch(out, /<(?:\w+:)?(?:image|img|iframe|animate|set)\b/i);
  assert.doesNotMatch(out, /https?:\/\/evil/i);
  assert.doesNotMatch(out, /@import/i);
};

test('keeps ordinary LilyPond SVG (paths, text, style, currentColor, viewBox)', async () => {
  const out = await sanitizeSvgSecurity(LILY_SVG);
  assert.match(out, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
  assert.match(out, /viewBox="0 -0 67.9 9.5"/);
  assert.match(out, /<rect transform="translate\(5.7, 4.5\)"[^>]*fill="currentColor"\/>/);
  assert.match(out, /d="M218 136c55 0 108 -28 108 -89"/);
  assert.match(out, /<tspan>Allegro &amp; co<\/tspan>/);
  assert.match(out, /tspan \{ white-space: pre; \}/);
  assert.doesNotMatch(out, /<\?xml/);
  assert.match(out, /<\/svg>$/);
});

test('keeps internal url(#id) and #fragment references', async () => {
  const out = await sanitizeSvgSecurity('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><defs><clipPath id="c1"><rect width="1" height="1"/></clipPath></defs><rect clip-path="url(#c1)" fill="url(\'#g\')"/><a xlink:href="#c1"><text>x</text></a></svg>');
  assert.match(out, /clip-path="url\(#c1\)"/);
  assert.match(out, /fill="url\('#g'\)"/);
  assert.match(out, /xlink:href="#c1"/);
});

test('strips script, handlers, js/data/external hrefs, foreignObject, image, external url()', async () => {
  const out = await sanitizeSvgSecurity(EVIL_SVG);
  assertHarmless(out);
  assert.match(out, /<path d="M0 0" fill="currentColor"\/>/, 'harmless content survives');
});

const attacks = {
  prefixedScript: '<svg:svg><svg:script>alert(1)</svg:script></svg:svg>',
  unclosedScript: '<svg><script>alert(1)',
  slashAttr: '<svg/onload=alert(1)>',
  noSpaceAttr: '<svg><a href="#"onclick="alert(1)">x</a></svg>',
  entityHref: '<svg><a href="&#106;avascript:alert(1)">x</a><a xlink:href=" jav&#x09;ascript:alert(1)">y</a></svg>',
  dataHref: '<svg><a href="data:text/html,<script>alert(1)</script>">x</a></svg>',
  animateHref: '<svg><a><animate attributeName="href" values="javascript:alert(1)"/><text>x</text></a></svg>',
  setHandler: '<svg><set attributeName="onmouseover" to="alert(1)"/></svg>',
  externalUse: '<svg><use href="https://evil/x.svg#a"/><image href="https://evil/track.png"/><feImage href="https://evil/f.png"/></svg>',
  styleImport: '<svg><style>@import url(https://evil/x.css); rect{fill:url(https://evil/p)}</style><rect style="background:url(javascript:alert(1))"/></svg>',
  styleExternalUrl: '<svg><style>rect{fill:url(https://evil/p)}</style></svg>',
  cdataBreakout: '<svg><![CDATA[</svg><img src=x onerror=alert(1)>]]></svg>',
  titleHtml: '<svg><title><img src=x onerror=alert(1)></title></svg>',
  iframeInside: '<svg><iframe src="https://evil"></iframe></svg>',
  htmlAround: '<div onclick="alert(1)"><svg><rect/></svg></div><script>alert(2)</script>',
};

for (const [name, payload] of Object.entries(attacks)) {
  test(`neutralizes ${name}`, async () => {
    assertHarmless(await sanitizeSvgSecurity(payload));
  });
}

test('non-SVG input yields empty string', async () => {
  assert.equal(await sanitizeSvgSecurity(''), '');
  assert.equal(await sanitizeSvgSecurity('<p>hello</p>'), '');
  assert.equal(await sanitizeSvgSecurity('<script>alert(1)</script>'), '');
});
