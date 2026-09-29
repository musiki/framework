import test from 'node:test';
import assert from 'node:assert/strict';
import { loadForumBibliography, searchForumCitations, toCitation, createRateLimiter, BibliographyError, listOwnerLibraries } from './bibliography.ts';

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

test('loadForumBibliographyById scopes to mm commons by uuid', async () => {
  const { loadForumBibliographyById } = await import('./bibliography.ts');
  const id = '11111111-1111-4111-8111-111111111111';
  let sql = '';
  const q = async (text, params) => {
    sql = text;
    assert.deepEqual(params, [id]);
    return { data: [{ id, settings: { seshatLibraryId: 'L', ownerEmail: 'o@x.org' } }], error: null };
  };
  const s = await loadForumBibliographyById(q, id);
  assert.match(sql, /'mm'/);
  assert.equal(s.ownerEmail, 'o@x.org');
  assert.equal(await loadForumBibliographyById(async () => { throw new Error('no'); }, 'nope'), null);
});

test('resolveForumCitations uses the FORUM owner, never the global owner env', async () => {
  const { resolveForumCitations } = await import('./bibliography.ts');
  let call;
  const fetch = async (u, init) => {
    call = { u: new URL(u), init };
    return Response.json({ items: [{ id: 'k1', title: 'T' }, { id: 'intruder', title: 'X' }], missing: ['k2'] });
  };
  const out = await resolveForumCitations(settings, ['k1', 'k2', 'k1', 'bad key!'], {
    env: { ...env, SESHAT_CITATION_OWNER_EMAIL: 'global@musiki' }, fetch,
  });
  assert.equal(call.u.pathname, '/api/integrations/citations/resolve');
  assert.deepEqual(call.u.searchParams.getAll('key'), ['k1', 'k2']);
  assert.equal(call.u.searchParams.get('libraryId'), 'lib1');
  assert.equal(call.init.headers['X-Seshat-Owner'], 'o@x.org');
  assert.equal(call.init.headers.Authorization, 'Bearer tok');
  assert.deepEqual([...out.keys()], ['k1']);
});

test('resolveForumCitations: no library/owner -> no request; upstream failure throws', async () => {
  const { resolveForumCitations } = await import('./bibliography.ts');
  const never = async () => { throw new Error('should not fetch'); };
  assert.equal((await resolveForumCitations({ ...settings, ownerEmail: null }, ['k'], { env, fetch: never })).size, 0);
  assert.equal((await resolveForumCitations(null, ['k'], { env, fetch: never })).size, 0);
  await assert.rejects(resolveForumCitations(settings, ['k'], { env, fetch: async () => new Response('x', { status: 500 }) }), BibliographyError);
  await assert.rejects(resolveForumCitations(settings, ['k'], { env: {}, fetch: never }), BibliographyError);
});

test('listOwnerLibraries sends owner + token, whitelists fields', async () => {
  let call;
  const fetch = async (u, init) => {
    call = { u: new URL(u), init };
    return Response.json({ libraries: [
      { id: 'lib-1', name: '4.1 Stiegler', path: 'dissertation / 4.1 Stiegler', parentId: 'p', items: 12, ownerKey: 'secret', notes: 'x' },
      { id: 'bad id<script>', name: 'x', path: 'x', items: 1 },
      { name: 'no id' },
    ] });
  };
  const out = await listOwnerLibraries(' Own@X.org ', ' stie ', { env, fetch });
  assert.equal(call.u.origin, 'https://seshat.test');
  assert.equal(call.u.pathname, '/api/integrations/libraries');
  assert.equal(call.u.searchParams.get('q'), 'stie');
  assert.equal(call.init.headers['X-Seshat-Owner'], 'own@x.org');
  assert.equal(call.init.headers.Authorization, 'Bearer tok');
  assert.deepEqual(out, { available: true, libraries: [{ id: 'lib-1', name: '4.1 Stiegler', path: 'dissertation / 4.1 Stiegler', items: 12 }] });
  assert.equal(JSON.stringify(out).includes('secret'), false);
});

test('listOwnerLibraries: missing route/token -> unavailable, failures -> 502, bad email -> 400', async () => {
  for (const status of [404, 405, 501]) {
    assert.deepEqual(await listOwnerLibraries('o@x.org', '', { env, fetch: async () => new Response('Not found', { status }) }), { available: false, libraries: [] });
  }
  assert.deepEqual(await listOwnerLibraries('o@x.org', '', { env, fetch: async () => new Response('<html>', { status: 200 }) }), { available: false, libraries: [] });
  const never = async () => { throw new Error('should not fetch'); };
  assert.deepEqual(await listOwnerLibraries('o@x.org', '', { env: {}, fetch: never }), { available: false, libraries: [] });
  await assert.rejects(listOwnerLibraries('o@x.org', '', { env, fetch: async () => new Response('x', { status: 500 }) }), { status: 502 });
  await assert.rejects(listOwnerLibraries('o@x.org', '', { env, fetch: never }), { status: 502 });
  await assert.rejects(listOwnerLibraries('nope', '', { env, fetch: never }), { status: 400 });
});
