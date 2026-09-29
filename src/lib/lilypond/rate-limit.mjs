import { clientKey } from '../client-key.ts';

// Small in-memory sliding-window limiter for POST /api/lily/render. Only real
// service renders are counted (cache hits are free). Keys are bounded.
export function createRateLimiter({ limit = 20, windowMs = 10 * 60_000, maxKeys = 5000, now = Date.now } = {}) {
  const hits = new Map(); // key -> timestamps (ascending)
  return function check(key, keyLimit = limit) {
    const t = now();
    const id = String(key || 'anonymous');
    const recent = (hits.get(id) || []).filter((ts) => ts > t - windowMs);
    if (recent.length >= keyLimit) {
      hits.set(id, recent);
      return { ok: false, retryAfterMs: recent[0] + windowMs - t };
    }
    recent.push(t);
    hits.delete(id);
    hits.set(id, recent);
    while (hits.size > maxKeys) hits.delete(hits.keys().next().value);
    return { ok: true };
  };
}

export const RENDER_LIMITS = Object.freeze({ user: 60, ip: 20, unknown: 200 });

/**
 * Rate-limit identity for POST /api/lily/render: `u:<userId|email>` when signed
 * in; otherwise the real client IP behind Cloudflare → Caddy → Node (see
 * src/lib/client-key.ts). When no address is known at all every such request
 * shares one 'unknown' bucket with its own, higher limit (never a
 * per-request-unique key, which would disable the limit).
 */
export function lilyRateLimitIdentity(session, headers, clientAddress, limits = RENDER_LIMITS) {
  const user = session?.user;
  const userId = String(user?.id || user?.email || '').trim().toLowerCase();
  if (userId) return { key: `u:${userId}`, limit: limits.user };
  const ip = clientKey(headers, clientAddress);
  if (ip === 'unknown') return { key: 'unknown', limit: limits.unknown };
  return { key: `ip:${ip}`, limit: limits.ip };
}
