import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRateLimiter, lilyRateLimitIdentity, RENDER_LIMITS } from './rate-limit.mjs';

const h = (o) => new Headers(o);

test('identity: signed-in users by id (or email), never by IP', () => {
  assert.deepEqual(lilyRateLimitIdentity({ user: { id: 'U1', email: 'a@b.c' } }, h({ 'cf-connecting-ip': '1.1.1.1' }), '10.0.0.1'), { key: 'u:u1', limit: RENDER_LIMITS.user });
  assert.deepEqual(lilyRateLimitIdentity({ user: { email: 'A@b.c' } }, h({}), ''), { key: 'u:a@b.c', limit: RENDER_LIMITS.user });
});

test('identity: anonymous by real client IP behind Cloudflare → Caddy, not the proxy address', () => {
  assert.deepEqual(lilyRateLimitIdentity(null, h({ 'cf-connecting-ip': '1.1.1.1', 'x-forwarded-for': '9.9.9.9' }), '127.0.0.1'), { key: 'ip:1.1.1.1', limit: RENDER_LIMITS.ip });
  assert.deepEqual(lilyRateLimitIdentity(null, h({ 'x-forwarded-for': 'spoofed, 2.2.2.2' }), '127.0.0.1'), { key: 'ip:2.2.2.2', limit: RENDER_LIMITS.ip });
  assert.deepEqual(lilyRateLimitIdentity(undefined, h({}), '3.3.3.3'), { key: 'ip:3.3.3.3', limit: RENDER_LIMITS.ip });
});

test('identity: no address at all → one shared "unknown" bucket with a higher limit', () => {
  const a = lilyRateLimitIdentity(null, h({}), '');
  const b = lilyRateLimitIdentity(null, h({ 'x-forwarded-for': ' , ' }), undefined);
  assert.deepEqual(a, { key: 'unknown', limit: RENDER_LIMITS.unknown });
  assert.deepEqual(b, a);
  assert.ok(RENDER_LIMITS.unknown > RENDER_LIMITS.ip);
});

test('limiter: sliding window per key, per-key limit override', () => {
  let t = 0;
  const check = createRateLimiter({ limit: 2, windowMs: 1000, now: () => t });
  assert.equal(check('a').ok, true);
  assert.equal(check('a').ok, true);
  const denied = check('a');
  assert.equal(denied.ok, false);
  assert.equal(denied.retryAfterMs, 1000);
  assert.equal(check('b').ok, true, 'other keys unaffected');
  assert.equal(check('c', 5).ok && check('c', 5).ok && check('c', 5).ok, true, 'override limit');
  t = 1001;
  assert.equal(check('a').ok, true, 'window slides');
});
