// Previously rendered LilyPond (legacy R2 objects).
//
// The old HTTP render service (REMOTE_LILYPOND_RENDER_URL, :4543) is gone: all
// rendering goes through the sandboxed lilypond-service (src/lib/lilypond/service.mjs).
// What remains here is lookup only — `% rendered: sha1:<hash> <url|key>`
// comments embedded in content and the local .cache/lilypond-renders.json map
// still resolve to their existing R2 objects (static files), so pages that
// reference them keep working. Nothing here talks to a renderer.
import {
  getCachedRenderedLilypondUrl,
  getRenderedLilypondUrl,
  stripRenderedLilypondComment,
} from './lilypond-rendered-comment.mjs';
import { ensurePlayableLilypondSource } from './lilypond-support.mjs';

/** Cached URL of a previous render of `source` (R2), or null. Never renders. */
export function resolveRenderedLilypondUrl(source) {
  const normalizedSource = stripRenderedLilypondComment(source);
  if (!normalizedSource.trim()) return null;
  const preparedSource = ensurePlayableLilypondSource(normalizedSource);
  const cachedUrl =
    preparedSource === normalizedSource
      ? getRenderedLilypondUrl(source)
      : getCachedRenderedLilypondUrl(preparedSource);
  return cachedUrl || null;
}

/**
 * @deprecated Kept for callers of the old API; resolves cached URLs only.
 * New renders go through renderLilypond() (src/lib/lilypond/service.mjs).
 */
export async function renderRemoteLilypond(source) {
  return resolveRenderedLilypondUrl(source);
}

function hostsFromEnv(env) {
  const hosts = new Set();
  for (const key of ['R2_PUBLIC_URL', 'R2_PUBLIC_DEV_URL']) {
    const value = String(env?.[key] || '').trim();
    if (!value) continue;
    try {
      hosts.add(new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`).hostname.toLowerCase());
    } catch {
      // ignore malformed values
    }
  }
  for (const entry of String(env?.LILYPOND_REMOTE_ASSET_HOSTS || '').split(',')) {
    const host = entry.trim().toLowerCase();
    if (host) hosts.add(host);
  }
  return hosts;
}

/**
 * True when `url` is a legacy rendered-score object the server may fetch or
 * HEAD: https on an R2 public host (*.r2.dev, R2_PUBLIC_URL, R2_PUBLIC_DEV_URL)
 * or a host listed in LILYPOND_REMOTE_ASSET_HOSTS. Everything else is refused
 * so /api/lily/render?url= cannot be used to fetch arbitrary URLs.
 */
export function isAllowedRemoteLilyUrl(url, env = process.env) {
  let parsed;
  try {
    parsed = new URL(String(url || ''));
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  if (parsed.username || parsed.password) return false;
  const host = parsed.hostname.toLowerCase();
  if (host.endsWith('.r2.dev')) return true;
  return hostsFromEnv(env).has(host);
}
