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
