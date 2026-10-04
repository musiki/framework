import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { envKeyNames, missingKeys } from './env-keys-check.mjs';

const script = new URL('./env-keys-check.mjs', import.meta.url).pathname;

function tempEnvs(reference, target) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-keys-'));
  const ref = path.join(dir, 'reference.env');
  const tgt = path.join(dir, 'target.env');
  fs.writeFileSync(ref, reference);
  fs.writeFileSync(tgt, target);
  return { ref, tgt };
}

test('envKeyNames parses KEY= prefixes only', () => {
  const names = envKeyNames('# COMMENT=1\nA=1\n  export B="x=y"\r\nnot a key\nC=\n=nokey\nD = spaced\n');
  assert.deepEqual([...names], ['A', 'B', 'C', 'D']);
});

test('missingKeys lists reference keys absent in target', () => {
  assert.deepEqual(missingKeys('A=1\nB=2\nC=3\n', 'B=other\n# A=commented\n'), ['A', 'C']);
  assert.deepEqual(missingKeys('A=1\n', 'A=\n'), []);
});

test('CLI prints missing names, never values, and exits 1', () => {
  const { ref, tgt } = tempEnvs('SECRET_TOKEN=super-secret-value\nSHARED=abc\nDB_URL=postgres://u:pw@h/db\n', 'SHARED=xyz\n');
  const r = spawnSync(process.execPath, [script, ref, tgt], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.deepEqual(r.stdout.trim().split('\n'), ['SECRET_TOKEN', 'DB_URL']);
  const all = r.stdout + r.stderr;
  for (const value of ['super-secret-value', 'abc', 'xyz', 'pw@h']) assert(!all.includes(value));
});

test('CLI exits 0 when nothing is missing and 2 on bad usage', () => {
  const { ref, tgt } = tempEnvs('A=1\n', 'A=2\nB=3\n');
  const ok = spawnSync(process.execPath, [script, ref, tgt], { encoding: 'utf8' });
  assert.equal(ok.status, 0);
  assert.equal(ok.stdout, '');
  assert.equal(spawnSync(process.execPath, [script, ref], { encoding: 'utf8' }).status, 2);
  assert.equal(spawnSync(process.execPath, [script, ref, `${tgt}.missing`], { encoding: 'utf8' }).status, 2);
});
