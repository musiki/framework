import test from 'node:test';
import assert from 'node:assert/strict';
import { loadForumBibliography, searchForumCitations, toCitation, createRateLimiter, BibliographyError } from './bibliography.ts';

const env = { SESHAT_API_URL: 'https://seshat.test/', SESHAT_INTEGRATION_TOKEN: 'tok' };
const settings = { forumId: 'f', seshatLibraryId: 'lib1', zoteroCollection: null, ownerEmail: 'o@x.org' };

test('loadForumBibliography scopes to mm commons and normalizes settings', async () => {
  let sql = '';
  const q = async (text, params) => {
    sql = text;
    assert.deepEqual(params, ['stiegler']);
    return { data: [{ id: 'f1', settings: { seshatLibraryId: ' L ', ownerEmail: 'Own@X.org', zoteroCollection: 'C' } }], error: null };
  };
  const s = await loadForumBibliography(q, 'stiegler');
  assert.match(sql, /'mm'/);
  assert.match(sql, /'commons'/);
  assert.deepEqual(s, { forumId: 'f1', seshatLibraryId: 'L', zoteroCollection: 'C', ownerEmail: 'own@x.org' });
});

test('loadForumBibliography rejects bad slug, missing forum, db error', async () => {
  const never = async () => { throw new Error('no query'); };
  assert.equal(await loadForumBibliography(never, '../x'), null);
  assert.equal(await loadForumBibliography(async () => ({ data: [], error: null }), 'nope'), null);
  await assert.rejects(loadForumBibliography(async () => ({ data: null, error: new Error('x') }), 'ok'), BibliographyError);
});

test('search sends owner + library, whitelists fields, caps results', async () => {
  let call;
  const items = Array.from({ length: 30 }, (_, i) => ({
    citeKey: `k${i}`, title: `T${i}`, authors: ['A B'], year: 1998, identifiers: { doi: '10.1/x' },
    tags: ['secret'], libraryIds: ['lib1'], id: 'internal', notes: 'private', updatedAt: 'x',
  }));
  const fetch = async (u, init) => { call = { u: new URL(u), init }; return Response.json({ items }); };
  const out = await searchForumCitations(settings, 'stie', { env, fetch, limit: 500 });
  assert.equal(call.u.origin, 'https://seshat.test');
  assert.equal(call.u.pathname, '/api/integrations/citations/search');
  assert.equal(call.u.searchParams.get('libraryId'), 'lib1');
  assert.equal(call.u.searchParams.get('limit'), '20');
  assert.equal(call.init.headers['X-Seshat-Owner'], 'o@x.org');
  assert.equal(call.init.headers.Authorization, 'Bearer tok');
  assert.equal(out.length, 20);
  assert.deepEqual(Object.keys(out[0]).sort(), ['authors', 'citekey', 'doi', 'title', 'url', 'year']);
  assert.equal(out[0].url, 'https://doi.org/10.1/x');
  assert.equal(JSON.stringify(out).includes('secret'), false);
  assert.equal(JSON.stringify(out).includes('o@x.org'), false);
});

test('search returns [] without library/owner, errors generically otherwise', async () => {
  const fetch = async () => { throw new Error('should not fetch'); };
  assert.deepEqual(await searchForumCitations({ ...settings, seshatLibraryId: null }, 'q', { env, fetch }), []);
  assert.deepEqual(await searchForumCitations({ ...settings, ownerEmail: null }, 'q', { env, fetch }), []);
  await assert.rejects(searchForumCitations(settings, 'q', { env: {}, fetch }), { status: 503 });
  await assert.rejects(searchForumCitations(settings, 'q', { env, fetch: async () => new Response('x', { status: 401 }) }), { status: 502 });
  await assert.rejects(searchForumCitations(settings, 'q', { env, fetch }), { status: 502 });
});

test('toCitation drops items without citekey and non-http urls', () => {
  assert.equal(toCitation({ title: 'x' }), null);
  const c = toCitation({ citeKey: 'a', title: 't', identifiers: { url: 'javascript:alert(1)' } });
  assert.equal(c.url, null);
  assert.equal(c.year, null);
});

test('rate limiter blocks after max within the window and resets', () => {
  let t = 0;
  const allow = createRateLimiter(2, 1000, () => t);
  assert.ok(allow('a')); assert.ok(allow('a')); assert.equal(allow('a'), false);
  assert.ok(allow('b'));
  t = 1001;
  assert.ok(allow('a'));
});
