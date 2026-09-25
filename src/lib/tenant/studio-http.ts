import { resolveRequestAuthOrigin } from '../auth-origin';
import { json } from '../forum-server';

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
  const origin = request.headers.get('origin');
  if (origin && origin !== resolveRequestAuthOrigin(request)) {
    return json({ error: 'Forbidden' }, 403);
  }
  if (opts.requireJson) {
    const contentType = (request.headers.get('content-type') || '').toLowerCase();
    if (!contentType.startsWith('application/json')) {
      return json({ error: 'Unsupported Media Type' }, 415);
    }
  }
  return null;
}
