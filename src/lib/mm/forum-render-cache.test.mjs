import test from 'node:test';
import assert from 'node:assert/strict';
import { createRenderCache, renderCacheKey } from './forum-render-cache.ts';

const counting = () => {
  const calls = [];
  const render = async (md) => {
    calls.push(md);
    return `<p>${md}</p>`;
  };
  return { render, calls };
};

test('same post version renders once; concurrent reads share the in-flight render', async () => {
  const { render, calls } = counting();
  const cache = createRenderCache(render);
  const post = { id: 'p1', updatedAt: 't1' };
  const [a, b] = await Promise.all([cache.render('x', post), cache.render('x', post)]);
  assert.equal(a, '<p>x</p>');
  assert.equal(b, a);
  assert.equal(await cache.render('x', post), a);
  assert.deepEqual(calls, ['x']);
});

test('a new updatedAt or body is a new key (natural invalidation)', async () => {
  const { render, calls } = counting();
  const cache = createRenderCache(render);
  await cache.render('x', { id: 'p1', updatedAt: 't1' });
  await cache.render('x', { id: 'p1', updatedAt: 't2' });
  await cache.render('y', { id: 'p1', updatedAt: 't2' });
  await cache.render('x', { id: 'p2', updatedAt: 't1' });
  assert.equal(calls.length, 4);
  assert.notEqual(renderCacheKey('x', { id: 'p1', updatedAt: 't1' }), renderCacheKey('y', { id: 'p1', updatedAt: 't1' }));
});

test('bounded LRU evicts the least recently used entry', async () => {
  const { render, calls } = counting();
  const cache = createRenderCache(render, 2);
  const p = (id) => ({ id, updatedAt: 't' });
  await cache.render('a', p('a'));
  await cache.render('b', p('b'));
  await cache.render('a', p('a')); // a is now most recent
  await cache.render('c', p('c')); // evicts b
  assert.equal(cache.size(), 2);
  await cache.render('a', p('a'));
  assert.deepEqual(calls, ['a', 'b', 'c']);
  await cache.render('b', p('b'));
  assert.deepEqual(calls, ['a', 'b', 'c', 'b']);
});

test('failed renders are not cached', async () => {
  let fail = true;
  const cache = createRenderCache(async (md) => {
    if (fail) throw new Error('remote down');
    return md;
  });
  await assert.rejects(cache.render('x', { id: 'p', updatedAt: 't' }));
  await new Promise((r) => setImmediate(r));
  assert.equal(cache.size(), 0);
  fail = false;
  assert.equal(await cache.render('x', { id: 'p', updatedAt: 't' }), 'x');
});

test('forum id and lang are part of the key', async () => {
  const { render, calls } = counting();
  const cache = createRenderCache(render);
  await cache.render('x', { id: 'p', updatedAt: 't', forumId: 'f1', lang: 'en' });
  await cache.render('x', { id: 'p', updatedAt: 't', forumId: 'f2', lang: 'en' });
  await cache.render('x', { id: 'p', updatedAt: 't', forumId: 'f2', lang: 'nb' });
  await cache.render('x', { id: 'p', updatedAt: 't', forumId: 'f2', lang: 'nb' });
  assert.equal(calls.length, 3);
});

test('renders marked not cacheable are not cached', async () => {
  let n = 0;
  const cache = createRenderCache(async (md) => ({ html: `${md}${(n += 1)}`, cacheable: false }));
  assert.equal(await cache.render('x', { id: 'p', updatedAt: 't' }), 'x1');
  assert.equal(await cache.render('x', { id: 'p', updatedAt: 't' }), 'x2');
  assert.equal(cache.size(), 0);
});

test('a lilypond fence without a rendered figure is not cached', async () => {
  const { lilypondRenderMissing } = await import('./forum-render-cache.ts');
  const md = 'Score:\n\n```lilypond\n{ c4 }\n```\n';
  assert.equal(lilypondRenderMissing(md, '<pre><code>{ c4 }</code></pre>'), true);
  assert.equal(lilypondRenderMissing(md, '<figure class="lilypond-block lily-score"><img src="/lily/a.svg"></figure>'), false);
  assert.equal(lilypondRenderMissing('```js\nx\n```', '<pre></pre>'), false);

  let figure = false;
  let n = 0;
  const cache = createRenderCache(async () => {
    n += 1;
    return figure ? '<figure class="lilypond-block"></figure>' : '<pre>{ c4 }</pre>';
  });
  const post = { id: 'p', updatedAt: 't' };
  await cache.render(md, post);
  await cache.render(md, post);
  assert.equal(n, 2);
  figure = true;
  await cache.render(md, post);
  await cache.render(md, post);
  assert.equal(n, 3);
});

test('re-linking the forum bibliography invalidates cached renders (and the owner is not in the key)', async () => {
  const { render, calls } = counting();
  const cache = createRenderCache(render);
  const post = (bib) => ({ id: 'p', updatedAt: 't', forumId: 'f', lang: 'en', forumBibliography: bib });
  await cache.render('x', post('lib1|a@x.org'));
  await cache.render('x', post('lib1|a@x.org'));
  await cache.render('x', post('lib2|a@x.org'));
  await cache.render('x', post('lib2|b@x.org'));
  assert.equal(calls.length, 3);
  assert.ok(!renderCacheKey('x', post('lib1|a@x.org')).includes('@'));
});
