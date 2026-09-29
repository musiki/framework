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
