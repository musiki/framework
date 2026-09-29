// Pure CSRF decision shared by the studio (`studio-http.ts`) and mm API
// wrappers: reject a present-but-mismatched Origin (403) and, when asked, a
// non-JSON Content-Type (415). A missing Origin is allowed through.
export type SameOriginRejection = { status: 403 | 415; error: string };

export function sameOriginJsonRejection(
  request: Request,
  expectedOrigin: string,
  opts: { requireJson?: boolean } = {},
): SameOriginRejection | null {
  const origin = request.headers.get('origin');
  if (origin && origin !== expectedOrigin) return { status: 403, error: 'Forbidden' };
  if (opts.requireJson) {
    const contentType = (request.headers.get('content-type') || '').toLowerCase();
    if (!contentType.startsWith('application/json')) return { status: 415, error: 'Unsupported Media Type' };
  }
  return null;
}
