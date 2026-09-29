// Per-client key for rate limiting behind Cloudflare -> Caddy -> Node, where the
// socket address is always the proxy. Order: cf-connecting-ip, else the LAST
// x-forwarded-for entry (appended by Caddy), else the adapter's clientAddress.
export function clientKey(headers: Pick<Headers, 'get'>, clientAddress?: string | null): string {
  const cf = String(headers.get('cf-connecting-ip') || '').trim();
  if (cf) return cf.slice(0, 64);
  const xff = String(headers.get('x-forwarded-for') || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (xff.length) return xff[xff.length - 1].slice(0, 64);
  return String(clientAddress || '').trim().slice(0, 64) || 'unknown';
}
