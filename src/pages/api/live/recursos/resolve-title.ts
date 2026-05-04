// Server-side URL fetch to extract <title> and basic metadata.
// Used by the metadata.ts client module for CORS-blocked URLs.
import type { APIRoute } from 'astro';
import { json } from '../../../../lib/forum-server';

const TIMEOUT_MS = 6000;

function extractTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([^<]{1,300})<\/title>/i);
  return m ? m[1].trim().replace(/\s+/g, ' ') : null;
}

function extractOgTitle(html: string): string | null {
  const m = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']{1,300})["']/i)
         ?? html.match(/<meta[^>]+content=["']([^"']{1,300})["'][^>]+property=["']og:title["']/i);
  return m ? m[1].trim() : null;
}

export const GET: APIRoute = async ({ url, locals }) => {
  const session = (locals as any).session;
  if (!session?.user?.email) return json({ error: 'Not authenticated' }, 401);

  const targetUrl = url.searchParams.get('url') ?? '';
  if (!targetUrl.startsWith('http')) return json({ error: 'Invalid URL' }, 400);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const resp = await fetch(targetUrl, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Musiki/1.0 (title-resolver)' },
    });
    clearTimeout(timer);

    if (!resp.ok) return json({ title: null, reason: `HTTP ${resp.status}` });

    const contentType = resp.headers.get('content-type') ?? '';
    if (!contentType.includes('text/html')) return json({ title: null, reason: 'not html' });

    const reader = resp.body?.getReader();
    if (!reader) return json({ title: null, reason: 'no body' });
    let html = '';
    let done = false;
    while (!done && html.length < 32768) {
      const { value, done: d } = await reader.read();
      done = d;
      if (value) html += new TextDecoder().decode(value);
    }
    reader.cancel();

    const title = extractOgTitle(html) ?? extractTitle(html);
    return json({ title });
  } catch (e: any) {
    return json({ title: null, reason: e?.message ?? 'fetch failed' });
  }
};
