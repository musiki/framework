import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { cleanTemplater, projectInstrument } from './projection.ts';

function note(body, overrides = {}) {
  return { id: 'n1', title: 'Fallback Title', body, ...overrides };
}

test('projectInstrument: returns null for non-instrument notes', () => {
  const body = `---\ntype: page\ntitle: Not An Instrument\n---\nbody text`;
  assert.equal(projectInstrument(note(body)), null);
});

test('projectInstrument: returns null when type is missing entirely', () => {
  const body = `---\nurl: https://example.org\n---\nbody text`;
  assert.equal(projectInstrument(note(body)), null);
});

test('projectInstrument: whitelist shape and body never leaks', () => {
  const body = `---
type: instrument
title: Daxophone
year: 1987
family: friction idiophone
layer: acoustic
sachs-hornbostel: "132.1"
person: "[[Hans Reichel]]"
authors:
  - Hans Reichel
url: https://example.org/dax
img: https://example.org/dax.png
hyper:
  - "[[speculative organology]]"
connect:
  - "[[friction excitation]]"
  - "[[movable bridge|the bridge]]"
moaie:
  M: "[[material-as-filter]] wood species"
  O: "cantilever tongue"
  A: "two-handed performer"
  I: "friction excitation"
  E: "amplified radiation"
  recursive: false
  vector: [0.70, 0.55, 0.50, 0.70, 0.30]
interface_profile:
  affordance: 0.35
  liveness: 0.75
  playability: 0.30
  learnability: 0.30
  situatedness: 0.35
  mediality: 0.75
  mapping: 0.35
  sensorimotor_scheme: 0.45
  ergonomics: 0.45
  expressivity: 0.90
status: draft
---
This sentence must never leave the studio and describes the daxophone in prose.`;

  const result = projectInstrument(note(body), { fictional: false });
  assert.ok(result);
  assert.equal(result.id, 'n1');
  assert.equal(result.title, 'Daxophone');
  assert.equal(result.year, 1987);
  assert.equal(result.family, 'friction idiophone');
  assert.equal(result.layer, 'acoustic');
  assert.equal(result.sachsHornbostel, '132.1');
  assert.deepEqual(result.authors, ['Hans Reichel']);
  assert.equal(result.person, 'Hans Reichel');
  assert.equal(result.url, 'https://example.org/dax');
  assert.equal(result.img, 'https://example.org/dax.png');
  assert.equal(result.fictional, false);
  assert.deepEqual(result.hyper, ['speculative organology']);
  // [[movable bridge|the bridge]] -> target "movable bridge", not the alias.
  assert.deepEqual(result.connect, ['friction excitation', 'movable bridge']);
  assert.deepEqual(result.moaie.vector, [0.7, 0.55, 0.5, 0.7, 0.3]);
  assert.equal(result.moaie.empty, false);
  assert.equal(result.moaie.recursive, false);
  assert.equal(result.moaie.text.M, 'material-as-filter wood species');
  assert.ok(result.profile);
  assert.equal(result.profile.expressivity, 0.9);

  const json = JSON.stringify(result);
  assert.ok(!json.includes('never leave the studio'));
  assert.ok(!json.includes('describes the daxophone in prose'));
});

test('projectInstrument: a `---js` frontmatter block is never executed (gray-matter eval hardening)', () => {
  const globalKey = '__soog_projection_pwned__';
  delete globalThis[globalKey];
  const body = `---js\nglobalThis.${globalKey} = true; ({ type: 'instrument', title: 'Pwned' })\n---\nbody text`;

  try {
    const result = projectInstrument(note(body));
    // The unrecognized `---js` block must yield no data at all, so the
    // note fails the `type === 'instrument'` check and is dropped, not
    // silently evaluated into a valid instrument.
    assert.equal(result, null);
    assert.equal(globalThis[globalKey], undefined);
  } finally {
    delete globalThis[globalKey];
  }
});

test('projectInstrument: [[X|Y]] wikilink reduces to the target X, not the alias Y', () => {
  const body = `---
type: instrument
title: T
person: "[[Real Name|Display Alias]]"
---
body`;
  const result = projectInstrument(note(body));
  assert.equal(result.person, 'Real Name');
});

test('projectInstrument: vector must be exactly 5 finite numbers, else null', () => {
  const tooShort = note(`---
type: instrument
title: T
moaie:
  vector: [0.1, 0.2]
---
body`);
  assert.equal(projectInstrument(tooShort).moaie.vector, null);

  const nonNumeric = note(`---
type: instrument
title: T
moaie:
  vector: [0.1, 0.2, 0.3, 0.4, "n/a"]
---
body`);
  assert.equal(projectInstrument(nonNumeric).moaie.vector, null);

  const missing = note(`---
type: instrument
title: T
---
body`);
  assert.equal(projectInstrument(missing).moaie.vector, null);
});

test('projectInstrument: all-zero vector is kept and flagged empty', () => {
  const body = note(`---
type: instrument
title: T
moaie:
  vector: [0, 0, 0, 0, 0]
---
body`);
  const result = projectInstrument(body);
  assert.deepEqual(result.moaie.vector, [0, 0, 0, 0, 0]);
  assert.equal(result.moaie.empty, true);
});

test('projectInstrument: non-https url/img are dropped, https kept', () => {
  const body = note(`---
type: instrument
title: T
url: http://insecure.example.org
img: https://secure.example.org/x.png
---
body`);
  const result = projectInstrument(body);
  assert.equal(result.url, undefined);
  assert.equal(result.img, 'https://secure.example.org/x.png');
});

test('projectInstrument: title falls back to note title when frontmatter title is empty/absent', () => {
  const emptyTitle = note(`---
type: instrument
title: ""
---
body`);
  assert.equal(projectInstrument(emptyTitle).title, 'Fallback Title');

  const noTitle = note(`---
type: instrument
---
body`);
  assert.equal(projectInstrument(noTitle).title, 'Fallback Title');
});

test('projectInstrument: fictional flag is set from opts, not inferred', () => {
  const body = note(`---
type: instrument
title: T
---
body`);
  assert.equal(projectInstrument(body, { fictional: true }).fictional, true);
  assert.equal(projectInstrument(body).fictional, false);
});

test('projectInstrument: Templater expression in frontmatter is cleaned and parsed', () => {
  const body = note(`---
type: instrument
title: T
modified: <% tp.date.now("YYYY-MM-DD") %>
---
body`);
  const result = projectInstrument(body);
  assert.ok(result);
  assert.equal(result.title, 'T');
});

test('cleanTemplater: replaces Templater tags in the frontmatter block with the injected date, leaves body alone', () => {
  const md = `---\nmodified: <% tp.date.now("YYYY-MM-DD") %>\n---\nBody mentions <% not touched %> here.`;
  const cleaned = cleanTemplater(md, '2026-09-28');
  assert.ok(cleaned.includes('modified: 2026-09-28'));
  assert.ok(cleaned.includes('Body mentions <% not touched %> here.'));
});

test('cleanTemplater: markdown without a frontmatter block is returned unchanged', () => {
  const md = 'just a body, no frontmatter';
  assert.equal(cleanTemplater(md, '2026-09-28'), md);
});

test('projectInstrument: interface_profile with missing keys defaults them to 0 (as long as something is scored)', () => {
  const body = note(`---
type: instrument
title: T
interface_profile:
  affordance: 0.5
---
body`);
  const result = projectInstrument(body);
  assert.ok(result.profile);
  assert.equal(result.profile.affordance, 0.5);
  assert.equal(result.profile.expressivity, 0);
});

test('projectInstrument: profile is null when every dimension is 0 or missing (unscored)', () => {
  const allZero = note(`---
type: instrument
title: T
interface_profile:
  affordance: 0
  liveness: 0
  playability: 0
  learnability: 0
  situatedness: 0
  mediality: 0
  mapping: 0
  sensorimotor_scheme: 0
  ergonomics: 0
  expressivity: 0
---
body`);
  assert.equal(projectInstrument(allZero).profile, null);

  const emptyStrings = note(`---
type: instrument
title: T
interface_profile:
  affordance: ""
  liveness: ""
---
body`);
  assert.equal(projectInstrument(emptyStrings).profile, null);
});

test('projectInstrument: bounds single strings to 2000 chars (truncated, not dropped)', () => {
  const longFamily = 'x'.repeat(2500);
  const body = note(`---
type: instrument
title: T
family: "${longFamily}"
---
body`);
  const result = projectInstrument(body);
  assert.equal(result.family.length, 2000);
  assert.equal(result.family, 'x'.repeat(2000));
});

test('projectInstrument: bounds arrays to 50 items, each truncated to 200 chars', () => {
  const items = Array.from({ length: 60 }, (_, i) => `"connection-${i}-${'y'.repeat(250)}"`);
  const body = note(`---
type: instrument
title: T
connect: [${items.join(', ')}]
---
body`);
  const result = projectInstrument(body);
  assert.equal(result.connect.length, 50);
  for (const c of result.connect) {
    assert.ok(c.length <= 200);
  }
  assert.equal(result.connect[0], `connection-0-${'y'.repeat(250)}`.slice(0, 200));
});

// --- Real vault sweep --------------------------------------------------
// Opt-in: set INSTRUMENTS_VAULT_ROOT to the vault's `03-thesis/cases`
// folder (machine-specific, never committed). Skipped (not failed) when
// unset or when `case instruments` isn't there (e.g. CI). The
// `case instruments fictional` folder is swept too when it exists.

const VAULT_ROOT = String(process.env.INSTRUMENTS_VAULT_ROOT ?? '').trim();
const REAL_DIRS = VAULT_ROOT
  ? [
      { dir: path.join(VAULT_ROOT, 'case instruments'), fictional: false },
      { dir: path.join(VAULT_ROOT, 'case instruments fictional'), fictional: true },
    ].filter(({ dir }) => fs.existsSync(dir))
  : [];

const vaultAvailable = REAL_DIRS.some(({ fictional }) => !fictional);

test(
  'projectInstrument: runs over every real vault case-instrument note without throwing',
  { skip: !vaultAvailable && 'set INSTRUMENTS_VAULT_ROOT to the vault cases folder to run' },
  () => {
    let total = 0;
    let validVector = 0;
    let scoredProfile = 0;
    for (const { dir, fictional } of REAL_DIRS) {
      for (const name of fs.readdirSync(dir)) {
        if (!name.endsWith('.md')) continue;
        total += 1;
        const body = fs.readFileSync(path.join(dir, name), 'utf8');
        let result;
        assert.doesNotThrow(() => {
          result = projectInstrument(
            { id: name, title: name.replace(/\.md$/, ''), body },
            { fictional },
          );
        }, `projectInstrument threw on ${dir}/${name}`);
        if (result && result.moaie.vector) validVector += 1;
        if (result && result.profile) scoredProfile += 1;
      }
    }
    console.log(
      `[vault sweep] ${total} notes scanned, ${validVector} with a valid 5-number MOAIE vector, ${scoredProfile} with a non-null (scored) interface profile`,
    );
    assert.ok(total > 0, 'expected to find real vault files');
  },
);

test('projectInstrument: tags from array, dedupe, drop dss*, strip #', () => {
  const body = `---\ntype: instrument\ntags:\n  - " noise "\n  - noise\n  - "#sensor"\n  - dss/case/instruments\n  - DSS\n  - a/b\n---\nx`;
  assert.deepEqual(projectInstrument(note(body)).tags, ['noise', 'sensor', 'a/b']);
});

test('projectInstrument: tags from comma string; absent -> []', () => {
  assert.deepEqual(projectInstrument(note(`---\ntype: instrument\ntags: "a, b ,a,dss/x, "\n---\n`)).tags, ['a', 'b']);
  assert.deepEqual(projectInstrument(note(`---\ntype: instrument\n---\n`)).tags, []);
});

test('projectInstrument: videos from frontmatter and body, no body leak', () => {
  const body = `---\ntype: instrument\nvideo: https://youtu.be/dQw4w9WgXcQ\n---\nPRIVATE BODY [v](https://vimeo.com/123?h=ab) text`;
  const r = projectInstrument(note(body));
  assert.deepEqual(r.videos, [
    { provider: 'youtube', id: 'dQw4w9WgXcQ', url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
    { provider: 'vimeo', id: '123', url: 'https://vimeo.com/123?h=ab' },
  ]);
  assert.ok(!JSON.stringify(r).includes('PRIVATE BODY'));
});
