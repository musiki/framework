import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RESERVED_SLUGS, SLUG_MAX, checkCustomSlug, hasSlugFormat, isReservedSlug, isRootSlug, isRootSlugPath, slugProblemMessage,
  slugifyLabel,
} from './slugs.ts';

test('reserved words include every top-level mm path and family', () => {
  for (const w of ['f', 'c', 'r', 'graph', 'about', 'join', 'admin', 'concepts', 'api', 'auth', 'mm', 'lily', '_astro',
    'mm-app', 'favicon.ico', 'robots.txt', 'sitemap.xml', 'healthz']) {
    assert.ok(RESERVED_SLUGS.includes(w), w);
    assert.ok(isReservedSlug(w), w);
  }
  assert.ok(isReservedSlug('GRAPH'));
  assert.equal(isReservedSlug('pharmakon'), false);
  assert.equal(isReservedSlug(null), false);
  assert.ok(Object.isFrozen(RESERVED_SLUGS));
});

test('slug format: lowercase words joined by single hyphens', () => {
  for (const s of ['a', 'ab', 'a1', 'tertiary-retention', 'x-2', '2026']) assert.ok(hasSlugFormat(s), s);
  for (const s of ['', '-a', 'a-', 'a--b', 'A', 'a_b', 'a.b', 'a b', 'é', 'a/b', '%61', 7]) assert.equal(hasSlugFormat(s), false, String(s));
});

test('isRootSlug / isRootSlugPath: canonical, not reserved, bounded', () => {
  assert.ok(isRootSlug('pharmakon'));
  assert.equal(isRootSlug('graph'), false);
  assert.equal(isRootSlug('a'.repeat(201)), false);
  assert.ok(isRootSlugPath('/pharmakon'));
  for (const p of ['pharmakon', '/', '//pharmakon', '/pharmakon/', '/Pharmakon', '/%70harmakon', '/about', '/f', '/c',
    '/concepts', '/x.y', undefined]) {
    assert.equal(isRootSlugPath(p), false, String(p));
  }
});

test('checkCustomSlug: trims, then format / length / reserved', () => {
  assert.deepEqual(checkCustomSlug(' pharmakon '), { slug: 'pharmakon', problem: null });
  assert.equal(checkCustomSlug('').problem, 'required');
  assert.equal(checkCustomSlug(undefined).problem, 'required');
  assert.equal(checkCustomSlug('x').problem, 'length');
  assert.equal(checkCustomSlug('a'.repeat(SLUG_MAX + 1)).problem, 'length');
  assert.equal(checkCustomSlug('a'.repeat(SLUG_MAX)).problem, null);
  assert.equal(checkCustomSlug('Pharmakon').problem, 'format');
  assert.equal(checkCustomSlug('a--b').problem, 'format');
  assert.equal(checkCustomSlug('café').problem, 'format');
  assert.equal(checkCustomSlug('graph').problem, 'reserved');
  assert.equal(checkCustomSlug('concepts').problem, 'reserved');
  assert.match(slugProblemMessage('reserved', 'graph'), /"graph" is a reserved word/);
  assert.match(slugProblemMessage('length'), /2–80/);
});

test('slugifyLabel: same rule as the site slugify, no fallback, cut at a hyphen', () => {
  assert.equal(slugifyLabel('Tertiary Retention'), 'tertiary-retention');
  assert.equal(slugifyLabel('Pharmakón!'), 'pharmakon');
  assert.equal(slugifyLabel('  --Æther / Ånd-- '), 'ther-and');
  assert.equal(slugifyLabel('???'), '');
  assert.equal(slugifyLabel(null), '');
  const long = slugifyLabel('word '.repeat(40));
  assert.ok(long.length <= SLUG_MAX && hasSlugFormat(long), long);
  assert.equal(long.endsWith('word'), true);
  assert.equal(slugifyLabel('a'.repeat(100)).length, SLUG_MAX);
});
