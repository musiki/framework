import type { APIRoute } from 'astro';
import { handleLilyAssetGet, handleLilyRenderPost } from '../../../lib/lilypond/render-api.mjs';

// LilyPond rendering goes through the sandboxed lilypond-service
// (LILYPOND_SOCKET / LILYPOND_SERVICE_URL); see src/lib/lilypond/render-api.mjs.
// LILYPOND_RENDER_STRATEGY and REMOTE_LILYPOND_RENDER_URL are no longer used.

function toResponse(result: { status: number; headers: Record<string, string>; body: string | Buffer }) {
  const body = typeof result.body === 'string' ? result.body : new Uint8Array(result.body);
  return new Response(body, { status: result.status, headers: result.headers });
}

export const GET: APIRoute = async ({ url }) => {
  return toResponse(await handleLilyAssetGet(url.searchParams.get('url')));
};

export const POST: APIRoute = async ({ request }) => {
  let payload: unknown = null;
  try {
    payload = await request.json();
  } catch {
    payload = null;
  }
  return toResponse(await handleLilyRenderPost(payload));
};
