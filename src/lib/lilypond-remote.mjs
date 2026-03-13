import {
  cacheRenderedLilypondUrl,
  getRenderedLilypondUrl,
  stripRenderedLilypondComment,
} from './lilypond-rendered-comment.mjs';

export const REMOTE_LILYPOND_RENDER_URL =
  process.env.REMOTE_LILYPOND_RENDER_URL || 'http://85.31.234.141:4543/render';

export async function renderRemoteLilypond(source, { timeoutMs = 10_000 } = {}) {
  const cachedUrl = getRenderedLilypondUrl(source);
  if (cachedUrl) return cachedUrl;

  const normalizedSource = stripRenderedLilypondComment(source);
  if (!normalizedSource.trim()) return null;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(REMOTE_LILYPOND_RENDER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
      },
      body: normalizedSource,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Remote LilyPond render failed with ${response.status}`);
    }

    const payload = await response.json().catch(() => null);
    const url = typeof payload?.url === 'string' ? payload.url.trim() : '';
    if (!url || !/^https?:\/\//i.test(url)) {
      throw new Error('Remote LilyPond render returned no url');
    }

    return cacheRenderedLilypondUrl(normalizedSource, url) || url;
  } catch (error) {
    console.error('[lilypond-remote] Render error:', error);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}
