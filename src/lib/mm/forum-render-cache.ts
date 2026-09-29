// Bounded LRU cache for rendered mm post HTML. Rendering can be slow
// (LilyPond render, Seshat citation lookups), and mm threads are read
// anonymously, so each post is rendered once per version: the key is forum id
// + UI lang + post id + updatedAt + a hash of the body and the forum's
// bibliography link (library id + owner), so an edit, a
// moderation change, a body change or a different forum bibliography scope
// yields a new key and the old entry just ages out. Failed renders are not
// cached, and neither are renders the renderer marks as not cacheable nor
// renders where a LilyPond fence produced no score figure (the render service
// may be down; retry on the next read). Pure module (node:crypto only).

import { createHash } from 'node:crypto';

export type PostRef = {
  id: string;
  updatedAt: string | null;
  forumId?: string | null;
  /** Forum bibliography link (library id + owner): part of the key (hashed), so re-linking invalidates. */
  forumBibliography?: string | null;
  lang?: string | null;
};
export type RenderFn = (markdown: string, post?: PostRef) => Promise<string>;
/** A renderer may return `{ html, cacheable: false }` (e.g. citation lookup failed). */
export type DetailedRenderFn = (
  markdown: string,
  post?: PostRef,
) => Promise<string | { html: string; cacheable: boolean }>;

export const RENDER_CACHE_MAX = 500;

export function renderCacheKey(markdown: string, post?: PostRef): string {
  const hash = createHash('sha256')
    .update(markdown)
    .update('\0')
    .update(post?.forumBibliography ?? '')
    .digest('base64url')
    .slice(0, 22);
  const scope = `${post?.forumId ?? ''}|${post?.lang ?? ''}`;
  return post ? `${scope}|${post.id}|${post.updatedAt ?? ''}|${hash}` : `${scope}|body|${hash}`;
}

const LILY_FENCE_RE = /^ {0,3}(`{3,}|~{3,})[ \t]*(?:lily|lilypond|ly)\b/im;
const LILY_FIGURE_RE = /<figure\b[^>]*\blilypond-block\b/i;

/** True when the body has a LilyPond fence but the HTML has no score figure. */
export function lilypondRenderMissing(markdown: string, html: string): boolean {
  return LILY_FENCE_RE.test(markdown) && !LILY_FIGURE_RE.test(html);
}

/** Wraps `render` with an LRU of at most `max` entries (in-flight renders are shared). */
export function createRenderCache(render: DetailedRenderFn, max = RENDER_CACHE_MAX) {
  const entries = new Map<string, Promise<string>>();
  const cached: RenderFn = (markdown, post) => {
    const key = renderCacheKey(markdown, post);
    const hit = entries.get(key);
    if (hit) {
      entries.delete(key); // refresh recency
      entries.set(key, hit);
      return hit;
    }
    const evict = () => {
      if (entries.get(key) === pending) entries.delete(key);
    };
    const pending: Promise<string> = render(markdown, post).then((out) => {
      const html = typeof out === 'string' ? out : out.html;
      const cacheable = typeof out === 'string' ? true : out.cacheable !== false;
      if (!cacheable || lilypondRenderMissing(markdown, html)) evict();
      return html;
    });
    entries.set(key, pending);
    pending.catch(evict);
    while (entries.size > max) {
      const oldest = entries.keys().next().value as string;
      entries.delete(oldest);
    }
    return pending;
  };
  return { render: cached, size: () => entries.size, clear: () => entries.clear() };
}
