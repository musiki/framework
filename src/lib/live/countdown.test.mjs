import test from 'node:test';
import assert from 'node:assert/strict';
import { formatCountdown, getRemainingMs } from './countdown.mjs';

test('formatCountdown returns mm:ss with ceiling seconds', () => {
  assert.equal(formatCountdown(61_000), '01:01');
  assert.equal(formatCountdown(1), '00:01');
  assert.equal(formatCountdown(0), '00:00');
});

test('getRemainingMs handles null/invalid and floors at zero', () => {
  const now = Date.parse('2026-03-05T12:10:00.000Z');

  assert.equal(getRemainingMs(null, now), null);
  assert.equal(getRemainingMs('not-a-date', now), null);

  const future = new Date(now + 2_000).toISOString();
  assert.equal(getRemainingMs(future, now), 2_000);

  const past = new Date(now - 5_000).toISOString();
  assert.equal(getRemainingMs(past, now), 0);
});
