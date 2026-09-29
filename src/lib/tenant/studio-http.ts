import { resolveRequestAuthOrigin } from '../auth-origin';
import { json } from '../forum-server';
import { sameOriginJsonRejection } from './same-origin.ts';

/**
 * CSRF guard for mutating studio API routes.
 *
 * - Rejects (403) when an `Origin` header is present and does not match the
 *   tenant-aware origin `resolveRequestAuthOrigin` derives for this request.
 *   A missing `Origin` header (same-origin navigations, some non-browser
 *   clients) is allowed through — this mirrors the common "reject only a
 *   mismatched Origin" CSRF pattern rather than requiring one.
 * - When `requireJson` is set, rejects (415) unless `Content-Type` starts
 *   with `application/json`.
 *
 * Returns a `Response` to send immediately when the request is rejected,
 * or `null` when the request may proceed.
 */
export function assertSameOriginJson(request: Request, opts: { requireJson?: boolean } = {}): Response | null {
  const rejection = sameOriginJsonRejection(request, resolveRequestAuthOrigin(request), opts);
  return rejection ? json({ error: rejection.error }, rejection.status) : null;
}
