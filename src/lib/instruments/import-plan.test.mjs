import test from 'node:test';
import assert from 'node:assert/strict';
import { planInstrumentImport } from './import-plan.ts';

const instrumentFile = (folder, name, extra = '') => ({
  folder,
  name,
  markdown: `---\ntype: instrument\ntitle: whatever\n${extra}---\nbody text`,
});

test('planInstrumentImport: creates instrument files not already imported', () => {
  const files = [instrumentFile('Instruments', 'Daxophone.md')];
  const steps = planInstrumentImport(files, []);
  assert.deepEqual(steps, [
    { action: 'create', folder: 'Instruments', title: 'Daxophone', markdown: files[0].markdown, type: 'instrument' },
  ]);
});

test('planInstrumentImport: note title is the file name minus .md, never a frontmatter title', () => {
  const files = [instrumentFile('Instruments', 'aeolian harp.md')];
  const steps = planInstrumentImport(files, []);
  assert.equal(steps[0].title, 'aeolian harp');
});

test('planInstrumentImport: imports type: box files too, bucketed as "box" (studio is the source of truth; endpoint filters by type)', () => {
  const files = [
    { folder: 'Instruments', name: 'cricket.md', markdown: `---\ntype: box\n---\nbody` },
  ];
  const steps = planInstrumentImport(files, []);
  assert.deepEqual(steps, [
    { action: 'create', folder: 'Instruments', title: 'cricket', markdown: files[0].markdown, type: 'box' },
  ]);
});

test('planInstrumentImport: imports files with no type field at all, bucketed as "none"', () => {
  const files = [
    { folder: 'Instruments', name: 'digitAize.md', markdown: `---\nurl: https://x.org\n---\nbody` },
  ];
  const steps = planInstrumentImport(files, []);
  assert.equal(steps[0].action, 'create');
  assert.equal(steps[0].type, 'none');
});

test('planInstrumentImport: imports files with an unrecognized type value, bucketed as "other"', () => {
  const files = [
    { folder: 'Instruments', name: 'weird.md', markdown: `---\ntype: page\n---\nbody` },
  ];
  const steps = planInstrumentImport(files, []);
  assert.equal(steps[0].action, 'create');
  assert.equal(steps[0].type, 'other');
});

test('planInstrumentImport: idempotent — skips (folder, title) pairs already present', () => {
  const files = [instrumentFile('Instruments', 'Daxophone.md')];
  const existing = [{ folder: 'Instruments', title: 'Daxophone' }];
  const steps = planInstrumentImport(files, existing);
  assert.deepEqual(steps, [
    { action: 'skip', folder: 'Instruments', title: 'Daxophone', reason: 'exists' },
  ]);
});

test('planInstrumentImport: same title in a different folder is not considered existing', () => {
  const files = [instrumentFile('Instruments (fictional)', 'Daxophone.md')];
  const existing = [{ folder: 'Instruments', title: 'Daxophone' }];
  const steps = planInstrumentImport(files, existing);
  assert.equal(steps[0].action, 'create');
});

test('planInstrumentImport: Templater expression in frontmatter does not break the type check', () => {
  const files = [
    {
      folder: 'Instruments',
      name: 'ADDAC120.md',
      markdown: `---\ntype: instrument\nmodified: <% tp.date.now("YYYY-MM-DD") %>\n---\nbody`,
    },
  ];
  const steps = planInstrumentImport(files, []);
  assert.equal(steps[0].action, 'create');
});

test('planInstrumentImport: duplicate-key frontmatter is a distinct parse-error skip, not not-instrument', () => {
  // Mirrors the real vault file case instruments/Dadamachines.md: a
  // duplicated YAML mapping key makes js-yaml throw even after Templater
  // cleanup (there's no Templater tag to clean here).
  const files = [
    {
      folder: 'Instruments',
      name: 'Dadamachines.md',
      markdown: `---\ntype: instrument\nimg: https://example.org/a.png\nimg: https://example.org/b.png\n---\nbody`,
    },
  ];
  const steps = planInstrumentImport(files, []);
  assert.equal(steps.length, 1);
  assert.equal(steps[0].action, 'skip');
  assert.equal(steps[0].reason, 'parse-error');
  assert.ok(typeof steps[0].message === 'string' && steps[0].message.length > 0);
});

test('planInstrumentImport: an unquoted accented alias-like value is a distinct parse-error skip', () => {
  // Mirrors the real vault file
  // case instruments fictional/"potentiomètre d'espace.md": an unquoted
  // body-adjacent value starting with an accented word after `*` reads to
  // js-yaml as an (undefined) alias reference.
  const files = [
    {
      folder: 'Instruments (fictional)',
      name: "potentiomètre d'espace.md",
      markdown: `---\ntype: instrument\ndef: *potentiomètre d'espace* is an electroacoustic device\n---\nbody`,
    },
  ];
  const steps = planInstrumentImport(files, []);
  assert.equal(steps.length, 1);
  assert.equal(steps[0].action, 'skip');
  assert.equal(steps[0].reason, 'parse-error');
  assert.ok(typeof steps[0].message === 'string' && steps[0].message.length > 0);
});

test('planInstrumentImport: processes a mixed batch preserving input order', () => {
  const files = [
    instrumentFile('Instruments', 'A.md'),
    { folder: 'Instruments', name: 'B.md', markdown: `---\ntype: page\n---\nbody` },
    instrumentFile('Instruments (fictional)', 'C.md'),
  ];
  const existing = [{ folder: 'Instruments', title: 'A' }];
  const steps = planInstrumentImport(files, existing);
  assert.deepEqual(
    steps.map((s) => [s.action, s.folder, s.title]),
    [
      ['skip', 'Instruments', 'A'],
      ['create', 'Instruments', 'B'],
      ['create', 'Instruments (fictional)', 'C'],
    ],
  );
  assert.equal(steps[1].type, 'other');
  assert.equal(steps[2].type, 'instrument');
});
