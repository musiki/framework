import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sanitizeLilyDir } from './store.mjs';
import { makeTmpDir, EVIL_SVG, LILY_SVG } from './test/fake-service.mjs';

test('sanitizeLilyDir rewrites unsafe SVGs once, then skips unchanged files', async () => {
  const dir = makeTmpDir('lily-store-');
  const manifestPath = path.join(makeTmpDir('lily-manifest-'), 'm.json');
  fs.writeFileSync(path.join(dir, `${'a'.repeat(32)}.svg`), EVIL_SVG);
  fs.writeFileSync(path.join(dir, `${'b'.repeat(32)}.svg`), LILY_SVG);
  fs.writeFileSync(path.join(dir, `${'c'.repeat(32)}.svg`), '<script>alert(1)</script>');
  fs.writeFileSync(path.join(dir, `${'d'.repeat(32)}.midi`), 'MThd');

  const first = await sanitizeLilyDir(dir, { manifestPath });
  assert.deepEqual(first, { checked: 3, skipped: 0, rewritten: 2, removed: 1, failed: 0 });
  assert.doesNotMatch(fs.readFileSync(path.join(dir, `${'a'.repeat(32)}.svg`), 'utf8'), /<script|onload=/i);
  assert.ok(!fs.existsSync(path.join(dir, `${'c'.repeat(32)}.svg`)));
  assert.ok(fs.existsSync(path.join(dir, `${'d'.repeat(32)}.midi`)));

  const second = await sanitizeLilyDir(dir, { manifestPath });
  assert.deepEqual(second, { checked: 0, skipped: 2, rewritten: 0, removed: 0, failed: 0 });
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.startsWith('.')), [], 'no manifest in the served dir');
});

test('a failed rewrite is not recorded, so the next run retries it', { skip: process.getuid?.() === 0 }, async () => {
  const dir = makeTmpDir('lily-store-ro-');
  const manifestPath = path.join(makeTmpDir('lily-manifest-'), 'm.json');
  const file = path.join(dir, `${'e'.repeat(32)}.svg`);
  fs.writeFileSync(file, EVIL_SVG);
  fs.chmodSync(dir, 0o555); // rename into the dir fails
  try {
    const first = await sanitizeLilyDir(dir, { manifestPath });
    assert.equal(first.failed, 1);
    assert.equal(first.skipped, 0);
  } finally {
    fs.chmodSync(dir, 0o755);
  }
  // Memoized in-process markup must not hide the unsafe file from the retry.
  fs.utimesSync(file, new Date(), new Date(Date.now() + 5000));
  const second = await sanitizeLilyDir(dir, { manifestPath });
  assert.deepEqual([second.checked, second.rewritten, second.failed], [1, 1, 0]);
  assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /<script|onload=/i);
});

test('getLilyDir: LILYPOND_ASSET_DIR, then legacy LILYPOND_PUBLIC_DIR, then production store, then public/lily', async () => {
  const { getLilyDir, getLilyReadDirs, PRODUCTION_LILY_DIR } = await import('./store.mjs');
  const cwd = '/srv/fw';
  const exists = (p) => p === PRODUCTION_LILY_DIR;
  const missing = () => false;
  assert.equal(PRODUCTION_LILY_DIR, '/opt/musiki/data/lily');
  assert.equal(getLilyDir({ LILYPOND_ASSET_DIR: '/data/lily', LILYPOND_PUBLIC_DIR: '/old' }, { cwd, existsSync: exists }), '/data/lily');
  assert.equal(getLilyDir({ LILYPOND_ASSET_DIR: 'rel/lily' }, { cwd, existsSync: exists }), '/srv/fw/rel/lily');
  assert.equal(getLilyDir({ LILYPOND_PUBLIC_DIR: '/old' }, { cwd, existsSync: exists }), '/old');
  assert.equal(getLilyDir({ NODE_ENV: 'production' }, { cwd, existsSync: exists }), PRODUCTION_LILY_DIR);
  assert.equal(getLilyDir({ NODE_ENV: 'production' }, { cwd, existsSync: missing }), '/srv/fw/public/lily');
  assert.equal(getLilyDir({ NODE_ENV: 'development' }, { cwd, existsSync: exists }), '/srv/fw/public/lily');
  assert.equal(getLilyDir({ LILYPOND_ASSET_DIR: '  ' }, { cwd, existsSync: missing }), '/srv/fw/public/lily');

  assert.deepEqual(getLilyReadDirs({ NODE_ENV: 'production' }, { cwd, existsSync: exists }),
    [PRODUCTION_LILY_DIR, '/srv/fw/dist/client/lily', '/srv/fw/public/lily']);
  // dev: the store is public/lily itself (no duplicate)
  assert.deepEqual(getLilyReadDirs({}, { cwd, existsSync: missing }), ['/srv/fw/public/lily', '/srv/fw/dist/client/lily']);
});
