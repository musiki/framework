import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkRehype from 'remark-rehype';
import rehypeStringify from 'rehype-stringify';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import rehypeHighlight from 'rehype-highlight';
import { all as lowlightAll } from 'lowlight';

import slugMathRemark from '../plugins/slug-math-remark.js';
import rehypeObsidianCallouts from '../plugins/remark-obsidian-callouts.mjs';
import rehypeObsidianImageSize from '../plugins/rehype-obsidian-image-size.mjs';
import remarkMermaid from '../plugins/remark-mermaid.mjs';
import remarkMediaEmbed from '../plugins/remark-media-embed.mjs';
import remarkWikiLink from '../plugins/remark-wiki-link.mjs';
import remarkRemoteLilypond from '../plugins/remark-remote-lilypond.mjs';
import remarkForumMathMacros from '../plugins/remark-forum-math-macros.mjs';

const forumHighlightAliases = {
  javascript: ['js'],
  python: ['py'],
  shell: ['bash', 'sh', 'zsh', 'fish'],
  xml: ['html'],
  markdown: ['md'],
  latex: ['mathjax', 'math', 'tex'],
  lisp: ['lilypond', 'ly', 'lily'],
};

export type RenderForumMarkdownOptions = {
  remoteLilypond?: boolean;
};

function createForumMarkdownProcessor(options: RenderForumMarkdownOptions = {}) {
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(slugMathRemark)
    .use(remarkMath)
    .use(remarkForumMathMacros)
    .use(remarkMermaid)
    .use(remarkWikiLink)
    .use(remarkMediaEmbed)
    .use(remarkRemoteLilypond, {
      enabled: options.remoteLilypond !== false,
      timeoutMs: 10_000,
      preferRemote: true,
    });

  return processor
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeObsidianCallouts)
    .use(rehypeRaw)
    .use(rehypeObsidianImageSize)
    .use(rehypeKatex, { strict: false })
    .use(rehypeHighlight, {
      languages: lowlightAll,
      aliases: forumHighlightAliases,
      ignoreMissing: true,
    })
    .use(rehypeStringify, { allowDangerousHtml: true });
}

export async function renderForumMarkdown(
  markdown: string,
  options: RenderForumMarkdownOptions = {},
): Promise<string> {
  const source = typeof markdown === 'string' ? markdown : '';
  const processor = createForumMarkdownProcessor(options);
  const output = await processor.process(source);
  return String(output);
}
