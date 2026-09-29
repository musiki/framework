import type { APIRoute } from 'astro';
import { handleLilyFileGet } from '../../lib/lilypond/render-api.mjs';

// GET /lily/<hash>.<svg|midi|mid|pdf>: rendered LilyPond assets from the
// persistent store (LILYPOND_ASSET_DIR, see src/lib/lilypond/store.mjs), with
// legacy fallbacks dist/client/lily and public/lily. Files that exist in
// dist/client (or public/ in dev) are served statically before this route runs;
// renders made at runtime or since the last build only exist in the store.
// Deeper paths (/lily/snippets/*) are not matched by this route.
export const prerender = false;

export const GET: APIRoute = async ({ params }) => {
  const result = await handleLilyFileGet(params.file);
  const body = typeof result.body === 'string' ? result.body : new Uint8Array(result.body);
  return new Response(body, { status: result.status, headers: result.headers });
};
