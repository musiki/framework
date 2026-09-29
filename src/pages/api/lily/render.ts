import type { APIRoute } from 'astro';
import { handleLilyAssetGet, handleLilyRenderPost } from '../../../lib/lilypond/render-api.mjs';
import { createRateLimiter } from '../../../lib/lilypond/rate-limit.mjs';

// LilyPond rendering goes through the sandboxed lilypond-service
// (LILYPOND_SOCKET / LILYPOND_SERVICE_URL); see src/lib/lilypond/render-api.mjs.
// LILYPOND_RENDER_STRATEGY and REMOTE_LILYPOND_RENDER_URL are no longer used.
//
// POST is used by public pages too (slides, course workspace), so instead of
// requiring a session it is rate-limited per client: signed-in users by email
// (60 renders / 10 min), anonymous clients by IP (20 / 10 min). Only renders
// that reach the service count; cached scores are free.
const limiter = createRateLimiter({ limit: 20, windowMs: 10 * 60_000 });
const SIGNED_IN_LIMIT = 60;

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

  const email = String((locals as any)?.session?.user?.email || '').trim().toLowerCase();
  let address = '';
  try {
    address = clientAddress || '';
  } catch {
    address = '';
  }
  const clientKey = email ? `user:${email}` : `ip:${address || 'unknown'}`;
  const limit = email ? SIGNED_IN_LIMIT : undefined;

  return toResponse(await handleLilyRenderPost(payload, {
    clientKey,
    limiter: (key: string) => limiter(key, limit),
  }));
};
