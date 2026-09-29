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
  assert.deepEqual(first, { checked: 3, skipped: 0, rewritten: 2, removed: 1 });
  assert.doesNotMatch(fs.readFileSync(path.join(dir, `${'a'.repeat(32)}.svg`), 'utf8'), /<script|onload=/i);
  assert.ok(!fs.existsSync(path.join(dir, `${'c'.repeat(32)}.svg`)));
  assert.ok(fs.existsSync(path.join(dir, `${'d'.repeat(32)}.midi`)));

  const second = await sanitizeLilyDir(dir, { manifestPath });
  assert.deepEqual(second, { checked: 0, skipped: 2, rewritten: 0, removed: 0 });
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f.startsWith('.')), [], 'no manifest in the served dir');
});
