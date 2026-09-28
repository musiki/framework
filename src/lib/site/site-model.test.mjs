import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFrontmatter, slugify } from './frontmatter.ts';
import { buildSiteModel } from './site-model.ts';

// ---------------------------------------------------------------------------
// slugify
// ---------------------------------------------------------------------------

test('slugify: lowercases, strips diacritics, replaces punctuation with -', () => {
  assert.equal(slugify('Café Résumé!'), 'cafe-resume');
});

test('slugify: collapses runs of punctuation/whitespace and trims dashes', () => {
  assert.equal(slugify('  Hello,   World -- Again!!  '), 'hello-world-again');
});

test('slugify: falls back to "page" for an empty/unsalvageable title', () => {
  assert.equal(slugify(''), 'page');
  assert.equal(slugify('###'), 'page');
});

// ---------------------------------------------------------------------------
// parseFrontmatter
// ---------------------------------------------------------------------------

test('parseFrontmatter: parses a valid frontmatter block', () => {
  const md = `---\nslug: about\nmenu: false\nlayout: page\ndraft: true\ndescription: hi\n---\nBody text`;
  const { data, body } = parseFrontmatter(md);
  assert.deepEqual(data, { slug: 'about', menu: false, layout: 'page', draft: true, description: 'hi' });
  assert.equal(body.trim(), 'Body text');
});

test('parseFrontmatter: absent frontmatter yields empty data and full body', () => {
  const md = 'Just a note, no frontmatter.';
  const { data, body } = parseFrontmatter(md);
  assert.deepEqual(data, {});
  assert.equal(body, md);
});

test('parseFrontmatter: invalid values are dropped, not coerced', () => {
  const md = `---\nlayout: nonsense\nmenu: "yes"\ndraft: 1\nslug: 42\n---\nBody`;
  const { data } = parseFrontmatter(md);
  assert.deepEqual(data, {});
});

// ---------------------------------------------------------------------------
// buildSiteModel
// ---------------------------------------------------------------------------

function note(id, folderId, title, body, position = null) {
  return { id, folderId, title, body: body ?? `Body of ${title}`, position };
}

function folder(id, parentId, name, position = null) {
  return { id, parentId, name, position };
}

test('buildSiteModel: Home is the first Site-root item when it is a note', () => {
  const model = buildSiteModel({
    siteFolderId: 'site',
    folders: [],
    notes: [note('n1', 'site', 'Home Note', 'hi', 1), note('n2', 'site', 'About', 'about', 2)],
  });
  assert.equal(model.pages.find((p) => p.id === 'n1').path, '/');
  assert.equal(model.pages.find((p) => p.id === 'n2').path, '/about');
  assert.equal(model.menu[0].path, '/');
});

test('buildSiteModel: Home is the first Site-root item when it is a folder (its landing gets /)', () => {
  const model = buildSiteModel({
    siteFolderId: 'site',
    folders: [folder('f1', 'site', 'Home Folder', 1)],
    notes: [
      note('n1', 'f1', 'Index Page', 'idx', 1),
      note('n2', 'site', 'About', 'about', 2),
    ],
  });
  const landing = model.pages.find((p) => p.id === 'n1');
  assert.equal(landing.path, '/');
  assert.equal(model.menu[0].path, '/');
  assert.equal(model.menu[0].title, 'Home Folder');
});

test('buildSiteModel: folder landing chosen by frontmatter slug: index', () => {
  const model = buildSiteModel({
    siteFolderId: 'site',
    folders: [folder('research', 'site', 'Research', 2)],
    notes: [
      note('home', 'site', 'Home', 'hi', 1),
      note('r1', 'research', 'Zebra Page', 'first alpha order', 1),
      note('r2', 'research', 'Index', '---\nslug: index\n---\nlanding body', 2),
    ],
  });
  const landing = model.pages.find((p) => p.id === 'r2');
  assert.equal(landing.path, '/research');
  const other = model.pages.find((p) => p.id === 'r1');
  assert.equal(other.path, '/research/zebra-page');
});

test('buildSiteModel: folder landing falls back to first page in tree order when no slug:index', () => {
  const model = buildSiteModel({
    siteFolderId: 'site',
    folders: [folder('research', 'site', 'Research', 2)],
    notes: [
      note('home', 'site', 'Home', 'hi', 1),
      note('r1', 'research', 'First In Order', 'body', 1),
      note('r2', 'research', 'Second In Order', 'body', 2),
    ],
  });
  const landing = model.pages.find((p) => p.id === 'r1');
  assert.equal(landing.path, '/research');
  const other = model.pages.find((p) => p.id === 'r2');
  assert.equal(other.path, '/research/second-in-order');
});

test('buildSiteModel: nested folder paths compose (/research/m5live)', () => {
  const model = buildSiteModel({
    siteFolderId: 'site',
    folders: [
      folder('research', 'site', 'Research', 2),
      folder('projects', 'research', 'Projects', 1),
    ],
    notes: [
      note('home', 'site', 'Home', 'hi', 1),
      note('rindex', 'research', 'Research Index', '---\nslug: index\n---\nlanding', 1),
      note('m5live', 'projects', 'M5Live', '---\nslug: index\n---\nlanding'),
    ],
  });
  const projectsLanding = model.pages.find((p) => p.id === 'm5live');
  assert.equal(projectsLanding.path, '/research/projects');

  const researchMenu = model.menu.find((m) => m.path === '/research');
  const projectsMenu = researchMenu.children.find((c) => c.path === '/research/projects');
  assert.ok(projectsMenu, 'projects folder should appear as a submenu entry under research');
});

test('buildSiteModel: menu:false keeps the path but omits the menu entry', () => {
  const model = buildSiteModel({
    siteFolderId: 'site',
    folders: [],
    notes: [
      note('home', 'site', 'Home', 'hi', 1),
      note('hidden', 'site', 'Hidden Page', '---\nmenu: false\n---\nbody', 2),
    ],
  });
  const page = model.pages.find((p) => p.id === 'hidden');
  assert.equal(page.path, '/hidden-page');
  assert.equal(model.menu.some((m) => m.path === '/hidden-page'), false);
});

test('buildSiteModel: draft:true notes are excluded entirely', () => {
  const model = buildSiteModel({
    siteFolderId: 'site',
    folders: [],
    notes: [
      note('home', 'site', 'Home', 'hi', 1),
      note('d1', 'site', 'Draft Page', '---\ndraft: true\n---\nbody', 2),
    ],
  });
  assert.equal(model.pages.some((p) => p.id === 'd1'), false);
  assert.equal(model.menu.some((m) => m.title === 'Draft Page'), false);
});

test('buildSiteModel: duplicate slugs get deterministic -2, -3 suffixes in tree order', () => {
  const model = buildSiteModel({
    siteFolderId: 'site',
    folders: [],
    notes: [
      note('home', 'site', 'Home', 'hi', 1),
      note('a1', 'site', 'About', 'body', 2),
      note('a2', 'site', 'About', 'body', 3),
      note('a3', 'site', 'About', 'body', 4),
    ],
  });
  assert.equal(model.pages.find((p) => p.id === 'a1').path, '/about');
  assert.equal(model.pages.find((p) => p.id === 'a2').path, '/about-2');
  assert.equal(model.pages.find((p) => p.id === 'a3').path, '/about-3');
});

test('buildSiteModel: an empty folder (no publishable pages) is omitted', () => {
  const model = buildSiteModel({
    siteFolderId: 'site',
    folders: [folder('empty', 'site', 'Empty Folder', 2)],
    notes: [
      note('home', 'site', 'Home', 'hi', 1),
      note('d1', 'empty', 'Only Draft', '---\ndraft: true\n---\nbody', 1),
    ],
  });
  assert.equal(model.menu.some((m) => m.title === 'Empty Folder'), false);
  assert.equal(model.pages.some((p) => p.id === 'd1'), false);
});

test('buildSiteModel: deterministic order with null positions (alphabetical, locale en)', () => {
  const model = buildSiteModel({
    siteFolderId: 'site',
    folders: [],
    notes: [
      note('home', 'site', 'Home', 'hi', 1),
      note('z', 'site', 'Zebra', 'body', null),
      note('a', 'site', 'Apple', 'body', null),
      note('m', 'site', 'Mango', 'body', null),
    ],
  });
  const order = model.pages.filter((p) => p.id !== 'home').map((p) => p.id);
  assert.deepEqual(order, ['a', 'm', 'z']);
});

test('buildSiteModel: default layout is "page" when frontmatter omits it', () => {
  const model = buildSiteModel({
    siteFolderId: 'site',
    folders: [],
    notes: [note('home', 'site', 'Home', 'plain body, no frontmatter', 1)],
  });
  assert.equal(model.pages[0].layout, 'page');
  assert.equal(model.pages[0].markdown, 'plain body, no frontmatter');
});
