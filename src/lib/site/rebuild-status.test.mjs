import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readPublishStatus } from './rebuild.ts';

const IDLE = { state: 'idle', requestedAt: null, startedAt: null, publishedAt: null, commit: null, release: null };

async function withFile(content, fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pubstatus-'));
  const file = path.join(dir, 's.json');
  if (content !== undefined) await fs.writeFile(file, content);
  try { return await fn(file); } finally { await fs.rm(dir, { recursive: true, force: true }); }
}

test('missing file -> idle', async () => {
  await withFile(undefined, async (f) => assert.deepEqual(await readPublishStatus(f), IDLE));
});
test('bad JSON -> idle', async () => {
  await withFile('{nope', async (f) => assert.deepEqual(await readPublishStatus(f), IDLE));
});
test('valid status passes through, extra fields dropped', async () => {
  const s = { state: 'published', requestedAt: '2026-10-05T10:00:00Z', startedAt: '2026-10-05T10:00:01Z', publishedAt: '2026-10-05T10:01:00Z', commit: 'abc', release: 'r1', secretPath: '/x' };
  await withFile(JSON.stringify(s), async (f) => {
    const { secretPath, ...expected } = s;
    assert.deepEqual(await readPublishStatus(f), expected);
  });
});
test('unknown state -> idle', async () => {
  await withFile(JSON.stringify({ state: 'exploding', commit: 'abc' }), async (f) => assert.deepEqual(await readPublishStatus(f), IDLE));
});
