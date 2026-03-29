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
    return json({ error: 'YouTube search is not configured on this server.' }, 503);
  }

  const requestUrl = new URL('https://www.googleapis.com/youtube/v3/search');
  requestUrl.searchParams.set('key', apiKey);
  requestUrl.searchParams.set('part', 'snippet');
  requestUrl.searchParams.set('type', 'video');
  requestUrl.searchParams.set('videoEmbeddable', 'true');
  requestUrl.searchParams.set('safeSearch', 'moderate');
  requestUrl.searchParams.set('maxResults', String(SEARCH_LIMIT));
  requestUrl.searchParams.set(
    'fields',
    'items(id/videoId,snippet/title,snippet/channelTitle,snippet/publishedAt,snippet/thumbnails/default/url,snippet/thumbnails/medium/url)',
  );
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
