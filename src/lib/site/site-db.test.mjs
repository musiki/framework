import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPublicSite } from './site-db.ts';

const SPACE_ID = 'space-1';

function fakeQuery(routes) {
  return async (text, params = []) => {
    for (const [match, handler] of routes) {
      const hit = typeof match === 'string' ? text.includes(match) : match.test(text);
      if (hit) return { data: handler(params, text) ?? [], error: null };
    }
    return { data: [], error: null };
  };
}

// A realistic fixture: GTX (supervision) and Output (committee) roots
// exactly like the OKA bootstrap, plus a Site root with a public home note,
// a public "Research" folder with one public and one draft note, and a
// private note directly under Site.
function fixture() {
  const folders = [
    { id: 'f-gtx', parentId: null, name: 'GTX', visibility: 'supervision', position: 1024 },
    { id: 'f-output', parentId: null, name: 'Output', visibility: 'committee', position: 2048 },
    { id: 'f-site', parentId: null, name: 'Site', visibility: 'public', position: 3072 },
    { id: 'f-research', parentId: 'f-site', name: 'Research', visibility: null, position: 100 },
    // A subfolder under the (public) Site tree that is itself explicitly
    // private — its own visibility overrides the inherited "public" from
    // Site, per effectiveVisibility's nearest-ancestor rule.
    { id: 'f-hidden', parentId: 'f-site', name: 'Hidden', visibility: 'private', position: 300 },
  ];
  const notes = [
    { id: 'n-home', folderId: 'f-site', title: 'Home', body: '---\nslug: index\n---\nWelcome', visibility: null, position: 10, userId: 'u1' },
    { id: 'n-gtx', folderId: 'f-gtx', title: 'Supervision note', body: 'secret', visibility: null, position: 10, userId: 'u1' },
    { id: 'n-output', folderId: 'f-output', title: 'Committee note', body: 'secret', visibility: null, position: 10, userId: 'u1' },
    { id: 'n-private', folderId: 'f-site', title: 'Private under Site', body: 'shh', visibility: 'private', position: 20, userId: 'u1' },
    { id: 'n-research-pub', folderId: 'f-research', title: 'Public research', body: 'hello', visibility: null, position: 10, userId: 'u1' },
    { id: 'n-research-draft', folderId: 'f-research', title: 'Draft research', body: '---\ndraft: true\n---\nnope', visibility: null, position: 20, userId: 'u1' },
    { id: 'n-hidden', folderId: 'f-hidden', title: 'Hidden note', body: 'shh, folder is private', visibility: null, position: 10, userId: 'u1' },
  ];
  return fakeQuery([
    ['"Space"', () => [{ id: SPACE_ID }]],
    ['"LiveClassNoteFolder"', () => folders],
    ['"LiveClassNote"', () => notes],
  ]);
}

test('loadPublicSite: excludes items under GTX (supervision) and Output (committee)', async () => {
  const q = fixture();
  const model = await loadPublicSite(q, { tenantId: 'so' });
  const titles = model.pages.map((p) => p.title);
  assert.ok(!titles.includes('Supervision note'));
  assert.ok(!titles.includes('Committee note'));
});

test('loadPublicSite: excludes a note under Site explicitly marked private', async () => {
  const q = fixture();
  const model = await loadPublicSite(q, { tenantId: 'so' });
  const titles = model.pages.map((p) => p.title);
  assert.ok(!titles.includes('Private under Site'));
});

test('loadPublicSite: excludes drafts', async () => {
  const q = fixture();
  const model = await loadPublicSite(q, { tenantId: 'so' });
  const titles = model.pages.map((p) => p.title);
  assert.ok(!titles.includes('Draft research'));
  assert.ok(titles.includes('Public research'));
});

test('loadPublicSite: a folder-level "private" visibility under Site hides its notes and itself, even though Site is public', async () => {
  const q = fixture();
  const model = await loadPublicSite(q, { tenantId: 'so' });
  const titles = model.pages.map((p) => p.title);
  assert.ok(!titles.includes('Hidden note'));
  // The folder itself has no publishable pages left, so it never surfaces
  // as a menu group either.
  const menuTitles = JSON.stringify(model.menu);
  assert.ok(!menuTitles.includes('Hidden'));
});

test('loadPublicSite: output never contains user ids or other author fields', async () => {
  const q = fixture();
  const model = await loadPublicSite(q, { tenantId: 'so' });
  const serialized = JSON.stringify(model);
  assert.ok(!serialized.includes('userId'));
  assert.ok(!serialized.includes('u1'));
});

test('loadPublicSite: returns null when the tenant has no dissertation space', async () => {
  const q = fakeQuery([['"Space"', () => []]]);
  assert.equal(await loadPublicSite(q, { tenantId: 'so' }), null);
});

test('loadPublicSite: returns null when the space has no root Site folder yet', async () => {
  const q = fakeQuery([
    ['"Space"', () => [{ id: SPACE_ID }]],
    ['"LiveClassNoteFolder"', () => [
      { id: 'f-gtx', parentId: null, name: 'GTX', visibility: 'supervision', position: 1024 },
    ]],
    ['"LiveClassNote"', () => []],
  ]);
  assert.equal(await loadPublicSite(q, { tenantId: 'so' }), null);
});

test('loadPublicSite: a lone public note directly under Site is served at "/"', async () => {
  const q = fakeQuery([
    ['"Space"', () => [{ id: SPACE_ID }]],
    ['"LiveClassNoteFolder"', () => [
      { id: 'f-site', parentId: null, name: 'Site', visibility: 'public', position: 3072 },
    ]],
    ['"LiveClassNote"', () => [
      { id: 'n-home', folderId: 'f-site', title: 'Home', body: 'Welcome', visibility: null, position: 10 },
    ]],
  ]);
  const model = await loadPublicSite(q, { tenantId: 'so' });
  const home = model.pages.find((p) => p.path === '/');
  assert.equal(home?.title, 'Home');
});
