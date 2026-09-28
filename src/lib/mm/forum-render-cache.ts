// Bounded LRU cache for rendered mm post HTML. Rendering can be slow (remote
// LilyPond render + MIDI HEAD resolution, Seshat citation lookups), and mm
// threads are read anonymously, so each post is rendered once per version:
// the key is post id + updatedAt + a hash of the body, so an edit, a
// moderation change or a body change yields a new key and the old entry just
// ages out. Failed renders are not cached. Pure module (node:crypto only).

import { createHash } from 'node:crypto';

export type PostRef = { id: string; updatedAt: string | null };
export type RenderFn = (markdown: string, post?: PostRef) => Promise<string>;

export const RENDER_CACHE_MAX = 500;

export function renderCacheKey(markdown: string, post?: PostRef): string {
  const hash = createHash('sha256').update(markdown).digest('base64url').slice(0, 22);
  return post ? `${post.id}|${post.updatedAt ?? ''}|${hash}` : `body|${hash}`;
}

/** Wraps `render` with an LRU of at most `max` entries (in-flight renders are shared). */
export function createRenderCache(render: RenderFn, max = RENDER_CACHE_MAX) {
  const entries = new Map<string, Promise<string>>();
  const cached: RenderFn = (markdown, post) => {
    const key = renderCacheKey(markdown, post);
    const hit = entries.get(key);
    if (hit) {
      entries.delete(key); // refresh recency
      entries.set(key, hit);
      return hit;
    }
    const pending = render(markdown, post);
    entries.set(key, pending);
    pending.catch(() => {
      if (entries.get(key) === pending) entries.delete(key);
    });
    while (entries.size > max) {
      const oldest = entries.keys().next().value as string;
      entries.delete(oldest);
    }
    return pending;
  };
  return { render: cached, size: () => entries.size, clear: () => entries.clear() };
}
