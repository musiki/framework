import test from 'node:test';
import assert from 'node:assert/strict';
import { planMigration, noteSlug } from './migration-plan.ts';

// ---------------------------------------------------------------------------
// noteSlug
// ---------------------------------------------------------------------------

test('noteSlug: uses frontmatter.slug when set', () => {
  assert.equal(noteSlug({ kind: 'note', title: 'Home', parent: 'Home', frontmatter: { slug: 'index' }, markdownFile: 'x.md' }), 'index');
});

test('noteSlug: falls back to slugify(title) when frontmatter.slug is absent/blank', () => {
  assert.equal(noteSlug({ kind: 'note', title: 'Biome Consurgens', parent: 'Research', frontmatter: {}, markdownFile: 'x.md' }), 'biome-consurgens');
  assert.equal(
    noteSlug({ kind: 'note', title: 'Biome Consurgens', parent: 'Research', frontmatter: { slug: '  ' }, markdownFile: 'x.md' }),
    'biome-consurgens',
  );
});

// ---------------------------------------------------------------------------
// planMigration
// ---------------------------------------------------------------------------

const emptyTree = { folders: [], notes: [] };

test('planMigration: empty existing tree creates every folder and note, in manifest order', () => {
  const manifest = {
    items: [
      { kind: 'folder', title: 'Home', parent: null },
      { kind: 'note', title: 'Home', parent: 'Home', frontmatter: { slug: 'index', layout: 'home' }, markdownFile: 'home-index.md' },
      { kind: 'folder', title: 'Research', parent: null },
      { kind: 'note', title: 'Research', parent: 'Research', frontmatter: { slug: 'index' }, markdownFile: 'research-index.md' },
      { kind: 'note', title: 'SOOG', parent: 'Research', frontmatter: {}, markdownFile: 'research-soog.md' },
    ],
  };
  const steps = planMigration(manifest, emptyTree);
  assert.deepEqual(
    steps.map((s) => s.action),
    ['create-folder', 'create-note', 'create-folder', 'create-note', 'create-note'],
  );
  assert.equal(steps[4].slug, 'soog');
  assert.equal(steps[4].parent, 'Research');
});

test('planMigration: skips a folder that already exists under the same parent', () => {
  const manifest = { items: [{ kind: 'folder', title: 'Research', parent: null }] };
  const existing = { folders: [{ name: 'Research', parentName: null }], notes: [] };
  const steps = planMigration(manifest, existing);
  assert.deepEqual(steps, [{ action: 'skip-folder', title: 'Research', parent: null, reason: 'folder already exists' }]);
});

test('planMigration: a same-named folder under a different parent is not treated as existing', () => {
  const manifest = { items: [{ kind: 'folder', title: 'Index', parent: 'Research' }] };
  const existing = { folders: [{ name: 'Index', parentName: 'Tools' }], notes: [] };
  const steps = planMigration(manifest, existing);
  assert.equal(steps[0].action, 'create-folder');
});

test('planMigration: skips a note that already exists at the same slug under the same folder', () => {
  const manifest = {
    items: [{ kind: 'note', title: 'About', parent: 'About', frontmatter: { slug: 'index' }, markdownFile: 'about-index.md' }],
  };
  const existing = { folders: [], notes: [{ folderName: 'About', slug: 'index' }] };
  const steps = planMigration(manifest, existing);
  assert.deepEqual(steps, [{ action: 'skip-note', title: 'About', parent: 'About', slug: 'index', reason: 'note already exists at this slug' }]);
});

test('planMigration: same slug in a different folder does not collide', () => {
  const manifest = {
    items: [{ kind: 'note', title: 'CV', parent: 'CV', frontmatter: { slug: 'index' }, markdownFile: 'cv-index.md' }],
  };
  const existing = { folders: [], notes: [{ folderName: 'About', slug: 'index' }] };
  const steps = planMigration(manifest, existing);
  assert.equal(steps[0].action, 'create-note');
});

test('planMigration: a note under a folder created earlier in the same plan is not rejected — it is planned as a child of the about-to-be-created folder', () => {
  const manifest = {
    items: [
      { kind: 'folder', title: 'Research', parent: null },
      { kind: 'note', title: 'Research', parent: 'Research', frontmatter: { slug: 'index' }, markdownFile: 'research-index.md' },
    ],
  };
  const steps = planMigration(manifest, emptyTree);
  assert.equal(steps[0].action, 'create-folder');
  assert.equal(steps[1].action, 'create-note');
  assert.equal(steps[1].parent, 'Research');
});

test('planMigration: re-running the same manifest against the resulting tree skips everything (full idempotency)', () => {
  const manifest = {
    items: [
      { kind: 'folder', title: 'Home', parent: null },
      { kind: 'note', title: 'Home', parent: 'Home', frontmatter: { slug: 'index', layout: 'home' }, markdownFile: 'home-index.md' },
      { kind: 'folder', title: 'Research', parent: null },
      { kind: 'note', title: 'Research', parent: 'Research', frontmatter: { slug: 'index' }, markdownFile: 'research-index.md' },
      { kind: 'note', title: 'SOOG', parent: 'Research', frontmatter: {}, markdownFile: 'research-soog.md' },
    ],
  };
  const firstRun = planMigration(manifest, emptyTree);
  assert.ok(firstRun.every((s) => s.action === 'create-folder' || s.action === 'create-note'));

  // Simulate the resulting tree state after applying firstRun.
  const existingAfter = {
    folders: [{ name: 'Home', parentName: null }, { name: 'Research', parentName: null }],
    notes: [
      { folderName: 'Home', slug: 'index' },
      { folderName: 'Research', slug: 'index' },
      { folderName: 'Research', slug: 'soog' },
    ],
  };
  const secondRun = planMigration(manifest, existingAfter);
  assert.ok(secondRun.every((s) => s.action === 'skip-folder' || s.action === 'skip-note'));
  assert.equal(secondRun.length, manifest.items.length);
});

test('planMigration: preserves manifest order across folders and notes (folders-first is a manifest-authoring convention, not enforced here)', () => {
  const manifest = {
    items: [
      { kind: 'folder', title: 'A', parent: null },
      { kind: 'folder', title: 'B', parent: null },
      { kind: 'note', title: 'A index', parent: 'A', frontmatter: { slug: 'index' }, markdownFile: 'a.md' },
      { kind: 'note', title: 'B index', parent: 'B', frontmatter: { slug: 'index' }, markdownFile: 'b.md' },
    ],
  };
  const steps = planMigration(manifest, emptyTree);
  assert.deepEqual(
    steps.map((s) => s.title),
    ['A', 'B', 'A index', 'B index'],
  );
});
