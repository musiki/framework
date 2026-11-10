import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PENDING_TTL_MS, pendingFromPod, pendingLabel, readCachedPending } from './progress-pending.mjs';

test('readCachedPending: vigente, vencido, del futuro o basura', () => {
  const now = 1_000_000;
  assert.equal(readCachedPending(JSON.stringify({ count: 3, at: now - 1000 }), now), 3);
  assert.equal(readCachedPending(JSON.stringify({ count: 3, at: now - PENDING_TTL_MS - 1 }), now), null);
  assert.equal(readCachedPending(JSON.stringify({ count: 3, at: now + 5000 }), now), null);
  assert.equal(readCachedPending('{roto', now), null);
  assert.equal(readCachedPending(null, now), null);
  assert.equal(readCachedPending(JSON.stringify({ count: '3', at: now }), now), null);
});

test('pendingFromPod cuenta los repasos vencidos', () => {
  assert.equal(pendingFromPod({ daily: { total: 4 } }), 4);
  assert.equal(pendingFromPod({ daily: { total: 0 } }), 0);
  assert.equal(pendingFromPod({}), 0);
  assert.equal(pendingFromPod(null), 0);
  assert.equal(pendingFromPod({ daily: { total: -2 } }), 0);
});

test('pendingLabel en singular y plural', () => {
  assert.equal(pendingLabel(0), '');
  assert.equal(pendingLabel(1), 'Una idea pide volver');
  assert.equal(pendingLabel(5), '5 ideas piden volver');
});
