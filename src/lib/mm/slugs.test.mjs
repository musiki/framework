import { execFileSync } from 'node:child_process';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
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

test('every slug-shaped top-level entry of src/pages and public/ is reserved', () => {
  const missing = [];
  // Generated, gitignored build artifacts (e.g. public/vault-embeddings.json) are not routes
  // we own; skip them when git is available, else scan everything.
  const isIgnored = (rel) => {
    try {
      execFileSync('git', ['check-ignore', '-q', rel], { stdio: 'ignore' });
      return true;
    } catch (e) {
      return false; // exit 1 = not ignored; any other failure (no git/checkout) = scan it
    }
  };
  for (const dir of ['src/pages', 'public']) {
    for (const name of fs.readdirSync(path.resolve(dir))) {
      if (name.startsWith('.')) continue;
      if (isIgnored(`${dir}/${name}`)) continue;
      for (const candidate of new Set([name, name.replace(/\..*$/, '')])) {
        if (hasSlugFormat(candidate) && !isReservedSlug(candidate)) missing.push(`${dir}/${name} → ${candidate}`);
      }
    }
  }
  assert.deepEqual(missing, [], 'add these to RESERVED_SLUGS');
});

test('musiki top-level pages are reserved', () => {
  for (const w of ['dashboard', 'slides', 'cursos', 'foro', 'live', 'editor', 'privacy', 'terms', 'login', 'studio', 'search']) {
    assert.ok(isReservedSlug(w), w);
    assert.equal(isRootSlugPath(`/${w}`), false, w);
  }
});

const TID = '0b7c1a2e-3f4d-4a5b-8c6d-7e8f9a0b1c2d';

test('parseRootPath: concept/group, channel, group thread, channel thread', async () => {
  const { parseRootPath, isRootPath } = await import('./slugs.ts');
  assert.deepEqual(parseRootPath('/stiegler'), { kind: 'slug', slug: 'stiegler' });
  assert.deepEqual(parseRootPath('/stiegler/tt1'), { kind: 'board', group: 'stiegler', channel: 'tt1' });
  assert.deepEqual(parseRootPath(`/stiegler/t/${TID}`), { kind: 'thread', group: 'stiegler', channel: null, thread: TID });
  assert.deepEqual(parseRootPath(`/stiegler/tt1/t/${TID}`), { kind: 'thread', group: 'stiegler', channel: 'tt1', thread: TID });
  for (const p of ['/stiegler', '/stiegler/tt1', `/stiegler/t/${TID}`, `/a-b/c-d/t/${TID}`]) assert.ok(isRootPath(p), p);
});

test('parseRootPath refuses every other shape and spelling', async () => {
  const { parseRootPath } = await import('./slugs.ts');
  const refused = [
    '', '/', 'stiegler', '//stiegler', '/stiegler/', '/stiegler//tt1', '/stiegler/tt1/', `/stiegler/t/${TID}/`,
    '/stiegler/t', `/stiegler/t/${TID.toUpperCase()}`, '/stiegler/t/not-a-uuid', `/stiegler/tt1/t/${TID}/x`,
    `/stiegler/tt1/x/${TID}`, '/stiegler/tt1/extra', '/Stiegler/tt1', '/stiegler/TT1', '/%73tiegler/tt1',
    '/stiegler/%74t1', `/stiegler/%74/${TID}`, '/stiegler/t%2F1', '/stiegler/a.b', '/stiegler/..', '/./tt1',
    // first segment reserved: mm families, musiki pages, internal mount, static folders
    '/f/stiegler', '/f/stiegler/tt1', `/f/stiegler/t/${TID}`, '/c/x', '/r/derives', '/graph/x', '/api/mm', '/lily/x',
    '/mm-app/x', '/dashboard/x', '/cursos/x', '/_astro/x', '/fonts/x', '/admin/x',
    `/stiegler/t/${TID}/t/${TID}`, `/a/b/c/d/e`, null, 7,
  ];
  for (const p of refused) assert.equal(parseRootPath(p), null, String(p));
});

test('reserved channel slug "t" is the forum core\'s', async () => {
  const { RESERVED_CHANNEL_SLUGS, isRootChannelSlug } = await import('./slugs.ts');
  const forum = await import('./forum-core.ts');
  assert.deepEqual([...forum.RESERVED_CHANNEL_SLUGS], [...RESERVED_CHANNEL_SLUGS]);
  assert.equal(isRootChannelSlug('t'), false);
  assert.ok(isRootChannelSlug('graph'), 'a channel may be called like a reserved root word: it is a second segment');
});

test('resolveRootSlug: live concept, then group, then alias, else nothing', async () => {
  const { resolveRootSlug } = await import('./slugs.ts');
  assert.equal(resolveRootSlug({ concept: true, group: true, alias: true }), 'concept');
  assert.equal(resolveRootSlug({ concept: false, group: true, alias: true }), 'group');
  assert.equal(resolveRootSlug({ concept: false, group: false, alias: true }), 'alias');
  assert.equal(resolveRootSlug({ concept: false, group: false, alias: false }), 'none');
});
