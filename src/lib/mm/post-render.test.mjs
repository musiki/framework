import test from 'node:test';
import assert from 'node:assert/strict';
import { createMmPostRenderer, CITATION_LOCALE } from './post-render.ts';
import { renderForumMarkdown } from '../forum-markdown.ts';
import { resolveForumCitations } from './bibliography.ts';

const FORUM = '11111111-1111-4111-8111-111111111111';
const settings = { forumId: FORUM, seshatLibraryId: 'lib1', zoteroCollection: null, ownerEmail: 'forum-owner@x.org' };
const env = { SESHAT_API_URL: 'https://seshat.test', SESHAT_INTEGRATION_TOKEN: 'tok', SESHAT_CITATION_OWNER_EMAIL: 'global@musiki' };

test('mm renders sanitized, without remote LilyPond, with localized citations', async () => {
  const seen = [];
  const render = createMmPostRenderer({
    renderMarkdown: async (md, options) => { seen.push(options); return 'html'; },
    loadForum: async () => settings,
    resolve: async () => new Map(),
  });
  assert.deepEqual(await render('x', { id: 'p', updatedAt: 't', forumId: FORUM, lang: 'nb' }), { html: 'html', cacheable: true });
  assert.equal(seen[0].sanitize, true);
  assert.equal(seen[0].remoteLilypond, false);
  assert.equal(seen[0].citations.headingText, 'Referanser');
  assert.equal(seen[0].citations.lang, 'nb-NO');
  await render('x', { id: 'p', updatedAt: 't', forumId: FORUM });
  assert.equal(seen[1].citations.headingText, CITATION_LOCALE.en.headingText);
  assert.equal(seen[1].citations.lang, 'en-GB');
});

test('citations resolve against the forum owner (stubbed Seshat fetch), end to end', async () => {
  const calls = [];
  const fetch = async (u, init) => {
    calls.push({ u: new URL(u), owner: init.headers['X-Seshat-Owner'] });
    return Response.json({ items: [{ id: 'stiegler1998', type: 'book', title: 'Technics and Time', author: [{ family: 'Stiegler', given: 'B.' }], issued: { 'date-parts': [[1998]] } }] });
  };
  const loaded = [];
  const render = createMmPostRenderer({
    renderMarkdown: renderForumMarkdown,
    loadForum: async (id) => { loaded.push(id); return settings; },
    resolve: (s, keys) => resolveForumCitations(s, keys, { env, fetch }),
  });
  const { html, cacheable } = await render('See [@stiegler1998].', { id: 'p', updatedAt: 't', forumId: FORUM, lang: 'en' });
  assert.equal(cacheable, true);
  assert.deepEqual(loaded, [FORUM]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].owner, 'forum-owner@x.org');
  assert.match(html, /data-citekey="stiegler1998"/);
  assert.match(html, /<h1>References<\/h1>/);
});

test('no forum / no linked library: no lookup, keys stay literal', async () => {
  const render = createMmPostRenderer({
    renderMarkdown: renderForumMarkdown,
    loadForum: async () => ({ ...settings, seshatLibraryId: null }),
    resolve: (s, keys) => resolveForumCitations(s, keys, { env, fetch: async () => { throw new Error('no fetch'); } }),
  });
  const out = await render('See [@k].', { id: 'p', updatedAt: 't', forumId: FORUM });
  assert.match(out.html, /\[@k\]/);
  assert.equal(out.cacheable, true);
  const noForum = await render('See [@k].', { id: 'p', updatedAt: 't' });
  assert.match(noForum.html, /\[@k\]/);
});

test('a failed citation lookup renders literally but is not cacheable', async () => {
  const render = createMmPostRenderer({
    renderMarkdown: renderForumMarkdown,
    loadForum: async () => settings,
    resolve: (s, keys) => resolveForumCitations(s, keys, { env, fetch: async () => new Response('', { status: 500 }) }),
  });
  const out = await render('See [@k].', { id: 'p', updatedAt: 't', forumId: FORUM });
  assert.match(out.html, /\[@k\]/);
  assert.equal(out.cacheable, false);
});
