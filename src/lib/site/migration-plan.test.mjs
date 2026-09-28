import test from 'node:test';
import assert from 'node:assert/strict';
import { planMigration, noteSlug } from './migration-plan.ts';
import matter from 'gray-matter';
import { buildSiteModel } from './site-model.ts';
import { positionBetween } from '../writing/tree/model.ts';

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

// ---------------------------------------------------------------------------
// end-to-end: planMigration(...) -> simulated apply -> buildSiteModel(...)
// reproduces the required header menu (Task 7 finding 4).
// ---------------------------------------------------------------------------

// Mirrors the shape of so-web's scripts/site-migration.json (titles,
// parents, frontmatter) without reading that file from disk, so this test
// is self-contained and does not depend on the sibling so-web repo/worktree
// being checked out at a particular path.
const soWebManifestFixture = {
  items: [
    { kind: 'folder', title: 'Home', parent: null },
    { kind: 'note', title: 'Speculative Organology', parent: 'Home', frontmatter: { slug: 'index', layout: 'home', description: 'Composing instruments, objects and environments.' }, markdownFile: 'home-index.md' },

    { kind: 'folder', title: 'Research', parent: null },
    { kind: 'note', title: 'Research', parent: 'Research', frontmatter: { slug: 'index' }, markdownFile: 'research-index.md' },
    { kind: 'note', title: 'The Speculative Organological Model', parent: 'Research', frontmatter: { slug: 'speculative-instruments' }, markdownFile: 'research-speculative-instruments.md' },
    { kind: 'note', title: 'SOOG: writing instrumental relations', parent: 'Research', frontmatter: { slug: 'soog' }, markdownFile: 'research-soog.md' },
    { kind: 'note', title: 'Materials, resonance and interaction', parent: 'Research', frontmatter: { slug: 'sonic-materialities' }, markdownFile: 'research-sonic-materialities.md' },
    { kind: 'note', title: 'Biome Consurgens', parent: 'Research', frontmatter: { slug: 'biome-consurgens' }, markdownFile: 'research-biome-consurgens.md' },
    { kind: 'note', title: 'M5live', parent: 'Research', frontmatter: { slug: 'm5live' }, markdownFile: 'research-m5live.md' },

    { kind: 'folder', title: 'Blog', parent: null },
    { kind: 'note', title: 'Blog', parent: 'Blog', frontmatter: { slug: 'index', layout: 'blog' }, markdownFile: 'blog-index.md' },

    { kind: 'folder', title: 'Tools', parent: null },
    { kind: 'note', title: 'Tools', parent: 'Tools', frontmatter: { slug: 'index' }, markdownFile: 'tools-index.md' },

    { kind: 'folder', title: 'CV', parent: null },
    { kind: 'note', title: 'Luciano Azzigotti — Research profile', parent: 'CV', frontmatter: { slug: 'index' }, markdownFile: 'cv-index.md' },

    { kind: 'folder', title: 'About', parent: null },
    { kind: 'note', title: 'About', parent: 'About', frontmatter: { slug: 'index' }, markdownFile: 'about-index.md' },

    { kind: 'folder', title: 'Tags', parent: null },
    { kind: 'note', title: 'Tags', parent: 'Tags', frontmatter: { slug: 'index', layout: 'tags' }, markdownFile: 'tags-index.md' },
  ],
};

/**
 * Simulates applying a create-only plan (no skip steps, matching an empty
 * starting tree — the same precondition the script's own applyPlan runs
 * under on first run) to build a fake `{ siteFolderId, folders, notes }`
 * tree for `buildSiteModel`, using the same `positionBetween` sibling
 * ordering `createSpaceFolder`/`createSpaceNote` use, and the same
 * frontmatter-serialization shape (`matter.stringify`) the script's
 * `applyPlan` writes to each note's body.
 */
function simulateApply(steps) {
  const SITE_ID = 'site';
  const folders = [];
  const notes = [];
  const folderIdByTitle = new Map();
  const lastPositionByParent = new Map(); // parentId -> last position
  let nextId = 1;

  const takePosition = (parentKey) => {
    const prev = lastPositionByParent.get(parentKey) ?? null;
    const position = positionBetween(prev, null);
    lastPositionByParent.set(parentKey, position);
    return position;
  };

  for (const step of steps) {
    assert.ok(step.action === 'create-folder' || step.action === 'create-note', `unexpected step for an empty starting tree: ${step.action}`);

    if (step.action === 'create-folder') {
      const parentId = step.parent === null ? SITE_ID : folderIdByTitle.get(step.parent);
      assert.ok(parentId, `parent folder "${step.parent}" not found/created yet`);
      const id = `folder-${nextId++}`;
      folders.push({ id, parentId, name: step.title, position: takePosition(parentId) });
      folderIdByTitle.set(step.title, id);
      continue;
    }

    const parentId = folderIdByTitle.get(step.parent);
    assert.ok(parentId, `parent folder "${step.parent}" not found/created yet`);
    const id = `note-${nextId++}`;
    const body = matter.stringify(`# ${step.title}\n\nplaceholder body.\n`, step.frontmatter);
    notes.push({ id, folderId: parentId, title: step.title, body, position: takePosition(parentId) });
  }

  return { siteFolderId: SITE_ID, folders, notes };
}

test('end-to-end: applying planMigration(so-web manifest, empty tree) yields the required header menu', () => {
  const steps = planMigration(soWebManifestFixture, emptyTree);
  const tree = simulateApply(steps);
  const model = buildSiteModel(tree);

  assert.deepEqual(
    model.menu.map((m) => m.title),
    ['Home', 'Research', 'Blog', 'Tools', 'CV', 'About', 'Tags'],
  );

  const homeItem = model.menu.find((m) => m.title === 'Home');
  assert.equal(homeItem.path, '/');

  const researchPaths = model.pages.filter((p) => p.path.startsWith('/research/')).map((p) => p.path);
  assert.deepEqual(
    researchPaths.sort(),
    ['/research/biome-consurgens', '/research/m5live', '/research/soog', '/research/sonic-materialities', '/research/speculative-instruments'].sort(),
  );
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
