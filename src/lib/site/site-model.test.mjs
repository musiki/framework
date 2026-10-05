import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFrontmatter, slugify, sanitizeSlug } from './frontmatter.ts';
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
  // A root Home folder (position 1) precedes Research (position 2) so
  // Research is not itself Home — isolates the landing-selection rule
  // under test from the Home-is-first-item rule.
  const model = buildSiteModel({
    siteFolderId: 'site',
    folders: [
      folder('home', 'site', 'Home', 1),
      folder('research', 'site', 'Research', 2),
    ],
    notes: [
      note('homeidx', 'home', 'Home Index', '---\nslug: index\n---\nhi'),
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
    folders: [
      folder('home', 'site', 'Home', 1),
      folder('research', 'site', 'Research', 2),
    ],
    notes: [
      note('homeidx', 'home', 'Home Index', '---\nslug: index\n---\nhi'),
      note('r1', 'research', 'First In Order', 'body', 1),
      note('r2', 'research', 'Second In Order', 'body', 2),
    ],
  });
  const landing = model.pages.find((p) => p.id === 'r1');
  assert.equal(landing.path, '/research');
  const other = model.pages.find((p) => p.id === 'r2');
  assert.equal(other.path, '/research/second-in-order');
});

test('buildSiteModel: folder landing lookup considers only direct notes, never descends into subfolders', () => {
  const model = buildSiteModel({
    siteFolderId: 'site',
    folders: [
      folder('home', 'site', 'Home', 1),
      folder('outer', 'site', 'Outer', 2),
      folder('inner', 'outer', 'Inner', 1),
    ],
    notes: [
      note('homeidx', 'home', 'Home Index', '---\nslug: index\n---\nhi'),
      // Outer has no slug:index note of its own — only a plain first note.
      note('outerFirst', 'outer', 'First Page', 'body', 1),
      // Inner (a subfolder of Outer) has its own slug:index note; it must
      // NOT be picked up as Outer's landing.
      note('innerIndex', 'inner', 'Real Index', '---\nslug: index\n---\nlanding'),
    ],
  });
  const outerLanding = model.pages.find((p) => p.id === 'outerFirst');
  assert.equal(outerLanding.path, '/outer', "Outer's landing must be its own first direct note");
  const innerLanding = model.pages.find((p) => p.id === 'innerIndex');
  assert.equal(innerLanding.path, '/outer/inner', "Inner's own slug:index is Inner's landing, not Outer's");
});

test('buildSiteModel: nested folder paths compose (/research/m5live)', () => {
  const model = buildSiteModel({
    siteFolderId: 'site',
    folders: [
      folder('home', 'site', 'Home', 1),
      folder('research', 'site', 'Research', 2),
      folder('projects', 'research', 'Projects', 1),
    ],
    notes: [
      note('homeidx', 'home', 'Home Index', '---\nslug: index\n---\nhi'),
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

test('buildSiteModel: order is folders-first-then-notes at every level, like buildTree; Home is the first item in that order', () => {
  // Research (a folder, position 2) sorts before About (a note, position 1)
  // because folders always precede notes in display order, regardless of
  // position across the two groups — matching what the studio tree shows.
  const model = buildSiteModel({
    siteFolderId: 'site',
    folders: [folder('research', 'site', 'Research', 2)],
    notes: [
      note('about', 'site', 'About', 'body', 1),
      note('rindex', 'research', 'Research Index', '---\nslug: index\n---\nlanding'),
    ],
  });
  const researchLanding = model.pages.find((p) => p.id === 'rindex');
  assert.equal(researchLanding.path, '/', "Research's landing is Home because Research is the first item in display order");
  const about = model.pages.find((p) => p.id === 'about');
  assert.equal(about.path, '/about');

  assert.equal(model.menu[0].path, '/');
  assert.equal(model.menu[0].title, 'Research');
  assert.equal(model.menu[1].path, '/about');
});

test('buildSiteModel: a folder with only subfolders keeps its own group wrapping the subfolder groups (never flattens)', () => {
  const model = buildSiteModel({
    siteFolderId: 'site',
    folders: [
      folder('home', 'site', 'Home', 1),
      folder('parent', 'site', 'Parent', 2),
      folder('child', 'parent', 'Child', 1),
    ],
    notes: [
      note('homeidx', 'home', 'Home Index', '---\nslug: index\n---\nhi'),
      note('childidx', 'child', 'Child Index', '---\nslug: index\n---\nlanding'),
    ],
  });
  const childLanding = model.pages.find((p) => p.id === 'childidx');
  assert.equal(childLanding.path, '/parent/child');

  const parentGroup = model.menu.find((m) => m.title === 'Parent');
  assert.ok(parentGroup, 'Parent must still appear as its own group, not be flattened away');
  assert.equal(parentGroup.path, '/parent/child', "falls back to its first (only) visible descendant's path");
  assert.equal(parentGroup.children.length, 1);
  assert.equal(parentGroup.children[0].title, 'Child');
  assert.equal(parentGroup.children[0].path, '/parent/child');
});

test('buildSiteModel: landing with menu:false keeps its page reachable, keeps the group, falls back to a visible child path', () => {
  const model = buildSiteModel({
    siteFolderId: 'site',
    folders: [
      folder('home', 'site', 'Home', 1),
      folder('section', 'site', 'Section', 2),
    ],
    notes: [
      note('homeidx', 'home', 'Home Index', '---\nslug: index\n---\nhi'),
      note('sectionidx', 'section', 'Section Index', '---\nslug: index\nmenu: false\n---\nlanding'),
      note('subpage', 'section', 'Sub Page', 'body', 2),
    ],
  });
  // The hidden landing is still generated as a reachable page.
  const landingPage = model.pages.find((p) => p.id === 'sectionidx');
  assert.equal(landingPage.path, '/section');

  const subPage = model.pages.find((p) => p.id === 'subpage');
  assert.equal(subPage.path, '/section/sub-page');

  const sectionGroup = model.menu.find((m) => m.title === 'Section');
  assert.ok(sectionGroup, 'Section must still have a group entry since it has a visible descendant');
  assert.equal(sectionGroup.path, '/section/sub-page', "falls back to the first visible descendant's path since the landing itself is hidden");
  assert.equal(sectionGroup.children.length, 1);
  assert.equal(sectionGroup.children[0].path, '/section/sub-page');
  // The hidden landing note itself must not also appear as a menu entry.
  assert.equal(model.menu.some((m) => m.path === '/section' && m.title !== 'Section'), false);
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

// ---------------------------------------------------------------------------
// Final-review fixes (M1-M4)
// ---------------------------------------------------------------------------

test('buildSiteModel: Home skips a leading empty / drafts-only folder (M1)', () => {
  const model = buildSiteModel({
    siteFolderId: 'site',
    folders: [folder('empty', 'site', 'Aaa Empty', 1), folder('drafts', 'site', 'Bbb Drafts', 2), folder('about', 'site', 'About', 3)],
    notes: [
      note('d1', 'drafts', 'Only Draft', '---\ndraft: true\n---\nbody', 1),
      note('ab', 'about', 'About Me', 'body', 1),
      note('other', 'site', 'Other', 'body', 1),
    ],
  });
  assert.equal(model.pages.find((p) => p.id === 'ab').path, '/');
  assert.equal(model.pages.find((p) => p.id === 'other').path, '/other');
  assert.equal(model.pages.some((p) => p.id === 'd1'), false);
});

test('buildSiteModel: Home falls to the first root note when every root folder is empty (M1)', () => {
  const model = buildSiteModel({
    siteFolderId: 'site',
    folders: [folder('empty', 'site', 'Empty', 1)],
    notes: [note('n', 'site', 'Welcome', 'hi', 1)],
  });
  assert.equal(model.pages.find((p) => p.id === 'n').path, '/');
});

test('buildSiteModel: duplicate suffixes never collide with a literal -2 slug (M3)', () => {
  const model = buildSiteModel({
    siteFolderId: 'site',
    folders: [],
    notes: [
      note('home', 'site', 'Home', 'hi', 1),
      note('f1', 'site', 'Foo', 'body', 2),
      note('f2', 'site', 'Foo', 'body', 3),
      note('f3', 'site', 'Foo 2', 'body', 4),
    ],
  });
  const paths = model.pages.map((p) => p.path);
  assert.equal(new Set(paths).size, paths.length, `paths must be unique: ${paths.join(', ')}`);
  assert.equal(model.pages.find((p) => p.id === 'f1').path, '/foo');
  assert.equal(model.pages.find((p) => p.id === 'f2').path, '/foo-2');
  assert.equal(model.pages.find((p) => p.id === 'f3').path, '/foo-2-2');
});

test('buildSiteModel: a literal foo-2 slug earlier in order pushes the duplicate to -3 (M3)', () => {
  const model = buildSiteModel({
    siteFolderId: 'site',
    folders: [],
    notes: [
      note('home', 'site', 'Home', 'hi', 1),
      note('x', 'site', 'X', '---\nslug: foo-2\n---\nbody', 2),
      note('f1', 'site', 'Foo', 'body', 3),
      note('f2', 'site', 'Foo', 'body', 4),
    ],
  });
  assert.equal(model.pages.find((p) => p.id === 'x').path, '/foo-2');
  assert.equal(model.pages.find((p) => p.id === 'f1').path, '/foo');
  assert.equal(model.pages.find((p) => p.id === 'f2').path, '/foo-3');
});

test('sanitizeSlug / frontmatter slug: strips slashes, rejects .., slugifies whitespace (M2)', () => {
  assert.equal(sanitizeSlug('/about/'), 'about');
  assert.equal(sanitizeSlug('My Page'), 'my-page');
  assert.equal(sanitizeSlug('a/b'), 'a-b');
  assert.equal(sanitizeSlug('../etc'), undefined);
  assert.equal(sanitizeSlug('foo/../bar'), undefined);
  assert.equal(sanitizeSlug('   '), undefined);
  assert.equal(sanitizeSlug('///'), undefined);
  assert.equal(sanitizeSlug('###'), undefined);
  assert.equal(sanitizeSlug('index'), 'index');
  assert.equal(parseFrontmatter('---\nslug: /About Us/\n---\nx').data.slug, 'about-us');
  assert.equal(parseFrontmatter('---\nslug: ../x\n---\nx').data.slug, undefined);
});

test('buildSiteModel: a traversal slug falls back to the title slug (M2)', () => {
  const model = buildSiteModel({
    siteFolderId: 'site',
    folders: [],
    notes: [note('home', 'site', 'Home', 'hi', 1), note('e', 'site', 'Evil', '---\nslug: ../../etc\n---\nx', 2)],
  });
  assert.equal(model.pages.find((p) => p.id === 'e').path, '/evil');
});

test('parseFrontmatter: draft "true"/"yes" strings count as drafts; other strings do not (M4)', () => {
  assert.equal(parseFrontmatter('---\ndraft: "true"\n---\nx').data.draft, true);
  assert.equal(parseFrontmatter('---\ndraft: "Yes"\n---\nx').data.draft, true);
  assert.equal(parseFrontmatter('---\ndraft: "no"\n---\nx').data.draft, undefined);
  const model = buildSiteModel({
    siteFolderId: 'site',
    folders: [],
    notes: [note('home', 'site', 'Home', 'hi', 1), note('d', 'site', 'D', '---\ndraft: "true"\n---\nx', 2)],
  });
  assert.equal(model.pages.some((p) => p.id === 'd'), false);
});

test('pages carry date, tags, createdAt and updatedAt', () => {
  const created = new Date('2026-01-02T03:04:05Z');
  const mk = (id, title, body, extra = {}) => ({ id, folderId: 'site', title, body, createdAt: created, updatedAt: '2026-02-03T00:00:00Z', ...extra });
  const model = buildSiteModel({
    siteFolderId: 'site',
    folders: [],
    notes: [
      mk('a', 'A', 'plain'),
      mk('b', 'B', '---\ndate: 2025-12-24\ntags: [x, y, 3]\n---\nbody'),
      mk('c', 'C', '---\ndate: not-a-date\ntags: "p, q ,"\n---\nbody'),
      mk('d', 'D', 'x', { createdAt: undefined, updatedAt: null }),
    ],
  });
  const by = Object.fromEntries(model.pages.map((p) => [p.id, p]));
  assert.equal(by.a.date, '2026-01-02T03:04:05.000Z');
  assert.deepEqual(by.a.tags, []);
  assert.equal(by.a.createdAt, '2026-01-02T03:04:05.000Z');
  assert.equal(by.a.updatedAt, '2026-02-03T00:00:00.000Z');
  assert.equal(by.b.date, '2025-12-24T00:00:00.000Z');
  assert.deepEqual(by.b.tags, ['x', 'y']);
  assert.equal(by.c.date, '2026-01-02T03:04:05.000Z');
  assert.deepEqual(by.c.tags, ['p', 'q']);
  assert.equal(by.d.date, null);
  assert.equal(by.d.createdAt, null);
  assert.equal(by.d.updatedAt, null);
});
