// mm's markdown renderers (DB-bound): musiki's forum markdown (KaTeX,
// LilyPond, Seshat [@key] citations) through createMmPostRenderer — ALWAYS
// sanitized (public to anonymous readers), no remote LilyPond and same-origin
// media only (no third-party requests), citations resolved against the FORUM's
// bibliography. One bounded LRU for post bodies, one for concept definition
// versions; each keyed by forum + UI lang + id + version + hash of the text and
// the forum's bibliography link (see forum-render-cache.ts).

import { query } from '../db/pool';
import { renderForumMarkdown } from '../forum-markdown';
import { createRenderCache } from './forum-render-cache.ts';
import { createMmPostRenderer } from './post-render.ts';
import { loadForumBibliographyById, resolveForumCitations, type QueryFn } from './bibliography.ts';
import type { MmLang } from './ui-lang.ts';
import type { PostRef } from './forum-render-cache.ts';

const poolQ: QueryFn = (text, params) => query(text, params as any[]);

const createMmRenderCache = () =>
  createRenderCache(
    createMmPostRenderer({
      renderMarkdown: renderForumMarkdown,
      loadForum: (forumId) => loadForumBibliographyById(poolQ, forumId),
      resolve: (settings, keys) => resolveForumCitations(settings, keys),
    }),
  );

export const mmPostRenderCache = createMmRenderCache();
export const mmDefinitionRenderCache = createMmRenderCache();

/** Renderer for one reader language (citation locale / references heading). */
export const mmRendererFor =
  (cache: ReturnType<typeof createMmRenderCache>, lang: MmLang) =>
  (markdown: string, ref?: PostRef): Promise<string> =>
    cache.render(markdown, ref ? { ...ref, lang } : ref);
