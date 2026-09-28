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
    { action: 'create', folder: 'Instruments', title: 'Daxophone', markdown: files[0].markdown },
  ]);
});

test('planInstrumentImport: note title is the file name minus .md, never a frontmatter title', () => {
  const files = [instrumentFile('Instruments', 'aeolian harp.md')];
  const steps = planInstrumentImport(files, []);
  assert.equal(steps[0].title, 'aeolian harp');
});

test('planInstrumentImport: skips files whose type is not instrument', () => {
  const files = [
    { folder: 'Instruments', name: 'cricket.md', markdown: `---\ntype: box\n---\nbody` },
  ];
  const steps = planInstrumentImport(files, []);
  assert.deepEqual(steps, [
    { action: 'skip', folder: 'Instruments', title: 'cricket', reason: 'not-instrument' },
  ]);
});

test('planInstrumentImport: skips files with no type field at all', () => {
  const files = [
    { folder: 'Instruments', name: 'digitAize.md', markdown: `---\nurl: https://x.org\n---\nbody` },
  ];
  const steps = planInstrumentImport(files, []);
  assert.equal(steps[0].action, 'skip');
  assert.equal(steps[0].reason, 'not-instrument');
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
      ['skip', 'Instruments', 'B'],
      ['create', 'Instruments (fictional)', 'C'],
    ],
  );
});
