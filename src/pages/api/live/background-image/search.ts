import type { APIRoute } from 'astro';
import { json } from '../../../../lib/forum-server';

const SEARCH_LIMIT = 8;

const normalizeText = (value: unknown) => String(value ?? '').trim();

const readGoogleApiKey = () =>
  normalizeText(import.meta.env.GOOGLE_CUSTOM_SEARCH_API_KEY) ||
  normalizeText(import.meta.env.GOOGLE_API_KEY);

const readSearchEngineId = () =>
  normalizeText(import.meta.env.GOOGLE_CUSTOM_SEARCH_ENGINE_ID) ||
  normalizeText(import.meta.env.GOOGLE_SEARCH_ENGINE_ID) ||
  normalizeText(import.meta.env.GOOGLE_PROGRAMMABLE_SEARCH_ENGINE_ID);

export const GET: APIRoute = async ({ locals, url }) => {
  const session = (locals as App.Locals).session;
  if (!session?.user?.email) {
    return json({ error: 'Not authenticated' }, 401);
  }

  const q = normalizeText(url.searchParams.get('q'));
  if (q.length < 2) {
    return json({ items: [] }, 200);
  }

  const apiKey = readGoogleApiKey();
  const searchEngineId = readSearchEngineId();
  if (!apiKey || !searchEngineId) {
    return json({ error: 'Google image search is not configured on this server.' }, 503);
  }

  const requestUrl = new URL('https://customsearch.googleapis.com/customsearch/v1');
  requestUrl.searchParams.set('key', apiKey);
  requestUrl.searchParams.set('cx', searchEngineId);
  requestUrl.searchParams.set('q', q);
  requestUrl.searchParams.set('searchType', 'image');
  requestUrl.searchParams.set('imgType', 'photo');
  requestUrl.searchParams.set('imgSize', 'xlarge');
  requestUrl.searchParams.set('safe', 'active');
  requestUrl.searchParams.set('num', String(SEARCH_LIMIT));
  requestUrl.searchParams.set(
    'fields',
    'items(link,title,displayLink,image/contextLink,image/thumbnailLink)',
  );

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
        'Google image search failed.';
      return json({ error: message }, response.status);
    }

    const items = Array.isArray(payload?.items)
      ? payload.items
          .map((item: any) => {
            const imageUrl = normalizeText(item?.link);
            if (!imageUrl) return null;
            return {
              imageUrl,
              sourceLabel: normalizeText(item?.displayLink) || 'Google Images',
              sourceUrl: normalizeText(item?.image?.contextLink),
              thumbnailUrl: normalizeText(item?.image?.thumbnailLink) || imageUrl,
              title: normalizeText(item?.title) || 'Image result',
            };
          })
          .filter(Boolean)
      : [];

    return json({ items }, 200);
  } catch {
    return json({ error: 'Google image search failed.' }, 500);
  }
};
