// How mm renders a forum post (pure; deps injected, tested in post-render.test.mjs):
// - always sanitized, never remote LilyPond (no third-party requests: the
//   sanitizer pass also keeps media same-origin only);
// - `[@key]` citations resolved against the post's FORUM bibliography
//   (its seshatLibraryId + ownerEmail), never musiki's global owner, with a
//   localized references heading and CSL locale;
// - a failed citation lookup is rendered (keys stay literal) but marked not
//   cacheable, so the next read retries.

import type { RenderForumMarkdownOptions } from '../forum-markdown';
import type { ForumBibliographySettings } from './bibliography.ts';
import type { DetailedRenderFn, PostRef } from './forum-render-cache.ts';
import type { MmLang } from './ui-lang.ts';

export const CITATION_LOCALE: Record<MmLang, { headingText: string; lang: string }> = {
  en: { headingText: 'References', lang: 'en-GB' },
  nb: { headingText: 'Referanser', lang: 'nb-NO' },
};

export interface MmPostRenderDeps {
  renderMarkdown: (markdown: string, options: RenderForumMarkdownOptions) => Promise<string>;
  loadForum: (forumId: string) => Promise<ForumBibliographySettings | null>;
  resolve: (settings: ForumBibliographySettings, keys: string[]) => Promise<Map<string, unknown>>;
}

export function createMmPostRenderer(deps: MmPostRenderDeps): DetailedRenderFn {
  return async (markdown: string, post?: PostRef) => {
    const lang: MmLang = post?.lang === 'nb' ? 'nb' : 'en';
    let cacheable = true;
    const forumId = post?.forumId ?? null;
    const resolve = async (keys: string[]) => {
      try {
        const settings = forumId ? await deps.loadForum(forumId) : null;
        if (!settings) return new Map<string, unknown>();
        return await deps.resolve(settings, keys);
      } catch (err) {
        cacheable = false;
        throw err;
      }
    };
    const html = await deps.renderMarkdown(markdown, {
      remoteLilypond: false,
      sanitize: true,
      citations: { ...CITATION_LOCALE[lang], resolve },
    });
    return { html, cacheable };
  };
}
