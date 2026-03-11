export const REMOTE_LILYPOND_RENDER_URL =
  process.env.REMOTE_LILYPOND_RENDER_URL || 'http://85.31.234.141:4543/render';

export async function renderRemoteLilypond(source, { timeoutMs = 10_000 } = {}) {
  const normalizedSource = String(source || '');
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

    return url;
  } catch (error) {
    console.error('[lilypond-remote] Render error:', error);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}
