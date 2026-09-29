import type { APIRoute } from 'astro';
import { handleLilyAssetGet, handleLilyRenderPost } from '../../../lib/lilypond/render-api.mjs';
import { createRateLimiter, lilyRateLimitIdentity, RENDER_LIMITS } from '../../../lib/lilypond/rate-limit.mjs';

// LilyPond rendering goes through the sandboxed lilypond-service
// (LILYPOND_SOCKET / LILYPOND_SERVICE_URL); see src/lib/lilypond/render-api.mjs.
// LILYPOND_RENDER_STRATEGY and REMOTE_LILYPOND_RENDER_URL are no longer used.
//
// POST is used by public pages too (slides, course workspace), so instead of
// requiring a session it is rate-limited per client (see lilyRateLimitIdentity):
// signed-in users by user id, anonymous clients by their real IP behind
// Cloudflare → Caddy (cf-connecting-ip, else the last x-forwarded-for entry).
// Only renders that reach the service count; cached scores are free.
const limiter = createRateLimiter({ limit: RENDER_LIMITS.ip, windowMs: 10 * 60_000 });

function toResponse(result: { status: number; headers: Record<string, string>; body: string | Buffer }) {
  const body = typeof result.body === 'string' ? result.body : new Uint8Array(result.body);
  return new Response(body, { status: result.status, headers: result.headers });
}

export const GET: APIRoute = async ({ url }) => {
  return toResponse(await handleLilyAssetGet(url.searchParams.get('url')));
};

export const POST: APIRoute = async ({ request, locals, clientAddress }) => {
  let payload: unknown = null;
  try {
    payload = await request.json();
  } catch {
    payload = null;
  }

  let address = '';
  try {
    address = clientAddress || '';
  } catch {
    address = '';
  }
  const identity = lilyRateLimitIdentity((locals as any)?.session, request.headers, address);

  return toResponse(await handleLilyRenderPost(payload, {
    clientKey: identity.key,
    limiter: (key: string) => limiter(key, identity.limit),
  }));
};
