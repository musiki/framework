import type { APIRoute } from 'astro';
import { json } from '../../../../lib/forum-server';
import { resolveLiveParticipantRole } from '../../../../lib/live/access';

const SEARCH_LIMIT = 8;

const normalizeText = (value: unknown) => String(value ?? '').trim();

const readYouTubeApiKey = () =>
  normalizeText(import.meta.env.YOUTUBE_DATA_API_KEY) ||
  normalizeText(import.meta.env.YOUTUBE_API_KEY) ||
  normalizeText(import.meta.env.GOOGLE_API_KEY);

const readThumbnailUrl = (thumbnails: Record<string, { url?: string }> | null | undefined) =>
  normalizeText(thumbnails?.medium?.url) ||
  normalizeText(thumbnails?.default?.url) ||
  normalizeText(thumbnails?.high?.url);

const readNested = (value: any, path: Array<string | number>) =>
  path.reduce((current, key) => current?.[key], value);

const findBalancedJson = (source: string, marker: string) => {
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) return '';
  const start = source.indexOf('{', markerIndex);
  if (start < 0) return '';

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }

  return '';
};

const collectYouTubeRenderers = (value: any, out: any[] = []) => {
  if (!value || out.length >= SEARCH_LIMIT) return out;
  if (Array.isArray(value)) {
    for (const item of value) {
      collectYouTubeRenderers(item, out);
      if (out.length >= SEARCH_LIMIT) break;
    }
    return out;
  }
  if (typeof value !== 'object') return out;

  if (value.videoRenderer?.videoId) {
    out.push(value.videoRenderer);
    return out;
  }

  for (const child of Object.values(value)) {
    collectYouTubeRenderers(child, out);
    if (out.length >= SEARCH_LIMIT) break;
  }
  return out;
};

const parseYouTubeText = (value: any) =>
  normalizeText(value?.simpleText) ||
  normalizeText(Array.isArray(value?.runs) ? value.runs.map((run: any) => normalizeText(run?.text)).join('') : '');

const searchYouTubeWithoutApiKey = async (q: string) => {
  const requestUrl = new URL('https://www.youtube.com/results');
  requestUrl.searchParams.set('search_query', q);
  requestUrl.searchParams.set('sp', 'EgIQAQ==');
  requestUrl.searchParams.set('hl', 'es');

  const response = await fetch(requestUrl, {
    headers: {
      Accept: 'text/html',
      'Accept-Language': 'es,en;q=0.8',
      'User-Agent': 'Mozilla/5.0 Musiki/1.0',
    },
  });
  if (!response.ok) throw new Error('YouTube search fallback failed.');

  const html = await response.text();
  const rawJson = findBalancedJson(html, 'ytInitialData');
  if (!rawJson) throw new Error('YouTube search fallback returned no data.');

  const data = JSON.parse(rawJson);
  return collectYouTubeRenderers(data)
    .map((renderer: any) => {
      const mediaId = normalizeText(renderer?.videoId);
      if (!mediaId) return null;
      return {
        channelTitle:
          parseYouTubeText(readNested(renderer, ['ownerText'])) ||
          parseYouTubeText(readNested(renderer, ['longBylineText'])) ||
          parseYouTubeText(readNested(renderer, ['shortBylineText'])),
        mediaId,
        publishedAt: parseYouTubeText(renderer?.publishedTimeText),
        thumbnailUrl: normalizeText(renderer?.thumbnail?.thumbnails?.at?.(-1)?.url),
        title: parseYouTubeText(renderer?.title) || 'YouTube',
      };
    })
    .filter(Boolean);
};

export const GET: APIRoute = async ({ locals, url }) => {
  const session = (locals as App.Locals).session;
  if (!session?.user?.email) {
    return json({ error: 'Not authenticated' }, 401);
  }

  const courseId = normalizeText(url.searchParams.get('courseId'));
  const role = await resolveLiveParticipantRole(session, courseId);
  if (role !== 'teacher') {
    return json({ error: 'Teachers only' }, 403);
  }

  const q = normalizeText(url.searchParams.get('q'));
  if (q.length < 2) {
    return json({ items: [] }, 200);
  }

  const apiKey = readYouTubeApiKey();
  if (!apiKey) {
    try {
      const items = await searchYouTubeWithoutApiKey(q);
      return json({ items }, 200);
    } catch {
      return json({
        error: 'YouTube search is not configured on this server. Set YOUTUBE_API_KEY to enable API search.',
      }, 503);
    }
  }

  const requestUrl = new URL('https://www.googleapis.com/youtube/v3/search');
  requestUrl.searchParams.set('key', apiKey);
  requestUrl.searchParams.set('part', 'snippet');
  requestUrl.searchParams.set('type', 'video');
  requestUrl.searchParams.set('videoEmbeddable', 'true');
  requestUrl.searchParams.set('safeSearch', 'moderate');
  requestUrl.searchParams.set('maxResults', String(SEARCH_LIMIT));
  requestUrl.searchParams.set('q', q);

  try {
    const response = await fetch(requestUrl, {
      headers: {
        Accept: 'application/json',
      },
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const message =
        normalizeText(payload?.error?.message) ||
        normalizeText(payload?.error) ||
        'YouTube search failed.';
      return json({ error: message }, response.status);
    }

    const items = Array.isArray(payload?.items)
      ? payload.items
          .map((item: any) => {
            const mediaId = normalizeText(item?.id?.videoId);
            if (!mediaId) return null;
            return {
              channelTitle: normalizeText(item?.snippet?.channelTitle),
              mediaId,
              publishedAt: normalizeText(item?.snippet?.publishedAt),
              thumbnailUrl: readThumbnailUrl(item?.snippet?.thumbnails),
              title: normalizeText(item?.snippet?.title) || 'YouTube',
            };
          })
          .filter(Boolean)
      : [];

    return json({ items }, 200);
  } catch {
    return json({ error: 'YouTube search failed.' }, 500);
  }
};
