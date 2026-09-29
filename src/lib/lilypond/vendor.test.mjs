import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const vendorDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'vendor', 'lilypond-client');
const HEADER_RE = /^\/\/ @zztt\/lilypond-client@(\d+\.\d+\.\d+) — vendored copy of (index\.mjs|index\.d\.ts)\./;

test('vendored lilypond-client carries its version (header + export) in both files', async () => {
  const js = fs.readFileSync(path.join(vendorDir, 'index.mjs'), 'utf8');
  const dts = fs.readFileSync(path.join(vendorDir, 'index.d.ts'), 'utf8');
  const jsHeader = js.match(HEADER_RE);
  const dtsHeader = dts.match(HEADER_RE);
  assert.ok(jsHeader, 'index.mjs header');
  assert.ok(dtsHeader, 'index.d.ts header');
  assert.equal(jsHeader[1], dtsHeader[1]);

  const mod = await import(path.join(vendorDir, 'index.mjs'));
  assert.equal(mod.LILYPOND_CLIENT_VERSION, jsHeader[1]);
  assert.match(dts, /export declare const LILYPOND_CLIENT_VERSION: string;/);
  for (const name of ['render', 'health', 'isAvailable', 'getFile', 'LilypondError']) {
    assert.equal(typeof mod[name], 'function', name);
  }
});

test('vendored client stays zero-dependency (node: builtins only)', () => {
  const js = fs.readFileSync(path.join(vendorDir, 'index.mjs'), 'utf8');
  const imports = [...js.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]);
  assert.ok(imports.length > 0);
  assert.ok(imports.every((spec) => spec.startsWith('node:')), imports.join(', '));
});
