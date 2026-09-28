import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkRehype from 'remark-rehype';
import rehypeStringify from 'rehype-stringify';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema, type Options as SanitizeSchema } from 'rehype-sanitize';
import rehypeHighlight from 'rehype-highlight';
import { all as lowlightAll } from 'lowlight';
import rehypeCodeSyntax from '../plugins/rehype-code-syntax.mjs';

import slugMathRemark from '../plugins/slug-math-remark.js';
import rehypeObsidianCallouts from '../plugins/remark-obsidian-callouts.mjs';
import rehypeObsidianImageSize from '../plugins/rehype-obsidian-image-size.mjs';
import remarkMermaid from '../plugins/remark-mermaid.mjs';
import remarkMediaEmbed from '../plugins/remark-media-embed.mjs';
import remarkWikiLink from '../plugins/remark-wiki-link.mjs';
import remarkLily from '../plugins/remark-lily.mjs';
import remarkRemoteLilypond from '../plugins/remark-remote-lilypond.mjs';
import remarkForumMathMacros from '../plugins/remark-forum-math-macros.mjs';
import remarkDataviewLite from '../plugins/remark-dataview-lite.mjs';
import remarkObsidianHighlight from '../plugins/remark-obsidian-highlight.mjs';
import remarkStrudelBlocks from '../plugins/remark-strudel-blocks.mjs';
import remarkSeshatCitations from '../plugins/remark-seshat-citations.mjs';

const forumHighlightAliases = {
  javascript: ['js'],
  python: ['py'],
  shell: ['bash', 'sh', 'zsh', 'fish'],
  xml: ['html'],
  markdown: ['md'],
  latex: ['mathjax', 'math', 'tex'],
  scheme: ['guile', 'lilypond', 'ly', 'lily'],
};

export type RenderForumMarkdownOptions = {
  remoteLilypond?: boolean;
  strudelBlocks?: boolean;
  /**
   * Strip untrusted HTML (scripts, event handlers, javascript: URLs, iframes,
   * inline SVG, style) from the author's markdown before the trusted
   * KaTeX/highlight passes run. mm always sets this; the musiki course forum
   * keeps the historical default (false) until it is raised separately.
   */
  sanitize?: boolean;
};

const withDefault = (tag: string, extra: NonNullable<SanitizeSchema['attributes']>[string]) => [
  ...(defaultSchema.attributes?.[tag] ?? []),
  ...extra,
];

/**
 * GitHub's default schema (as so-web's Site markdown) plus what the forum
 * remark plugins emit: math placeholders (code/pre/span/div className, read by
 * rehype-katex afterwards), LilyPond figures (data-lily-url/data-midi-url and
 * an <img>), Seshat citations/references (data-citekey(s)), Obsidian callouts
 * (aside/div className), media embeds (audio/video, http(s) src), highlights
 * (<mark>). No iframe (no forum plugin emits one), no svg, no style, no script.
 */
export const forumSanitizeSchema: SanitizeSchema = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames ?? []),
    'img', 'figure', 'figcaption', 'mark', 'aside', 'section', 'audio', 'video', 'source',
  ],
  attributes: {
    ...defaultSchema.attributes,
    img: withDefault('img', ['src', 'alt', 'title', 'width', 'height', 'loading', 'className']),
    code: withDefault('code', ['className']),
    pre: withDefault('pre', ['className']),
    span: withDefault('span', ['className', 'dataCitekey']),
    div: withDefault('div', ['className']),
    p: withDefault('p', ['className']),
    mark: ['className'],
    aside: ['className'],
    section: ['className', 'dataCitekeys'],
    figure: ['className', 'dataLilyUrl', 'dataMidiUrl'],
    figcaption: ['className'],
    audio: ['src', 'controls', 'preload', 'className'],
    video: ['src', 'controls', 'preload', 'poster', 'width', 'height', 'className'],
    source: ['src', 'type'],
  },
  protocols: {
    ...defaultSchema.protocols,
    src: ['http', 'https'],
    poster: ['http', 'https'],
  },
};

const LILY_URL_RE = /^(?:\/lily\/[A-Za-z0-9._-]+\.svg|https:\/\/[^\s"'<>]+)$/;

/**
 * After sanitizing, a locally rendered LilyPond figure has lost its inline
 * <svg>; show the same score through its data-lily-url as an <img> instead
 * (only same-origin /lily/*.svg or https URLs).
 */
export function rehypeLilyFigureImage() {
  const visitNode = (node: any) => {
    if (!node || !Array.isArray(node.children)) return;
    for (const child of node.children) visitNode(child);
    if (node.type !== 'element' || node.tagName !== 'figure') return;
    const cls = node.properties?.className;
    const classes = Array.isArray(cls) ? cls.map(String) : String(cls ?? '').split(/\s+/);
    if (!classes.includes('lilypond-block')) return;
    const hasImg = node.children.some((c: any) => c.type === 'element' && c.tagName === 'img');
    const url = String(node.properties?.dataLilyUrl ?? '');
    if (hasImg || !LILY_URL_RE.test(url)) return;
    node.children = [
      { type: 'element', tagName: 'img', properties: { src: url, alt: 'LilyPond notation render', loading: 'lazy' }, children: [] },
    ];
  };
  return (tree: any) => visitNode(tree);
}

function createForumMarkdownProcessor(options: RenderForumMarkdownOptions = {}) {
  let processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(slugMathRemark)
    .use(remarkMath)
    .use(remarkForumMathMacros);

  if (options.strudelBlocks === true) {
    processor = processor.use(remarkStrudelBlocks);
  }

  processor = processor
    .use(remarkMermaid)
    .use(remarkWikiLink)
    .use(remarkMediaEmbed)
    .use(remarkLily)
    .use(remarkObsidianHighlight)
    .use(remarkDataviewLite)
    .use(remarkSeshatCitations)
    .use(remarkRemoteLilypond, {
      enabled: options.remoteLilypond !== false,
      timeoutMs: 10_000,
      preferRemote: true,
    });

  return processor
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeObsidianCallouts)
    .use(rehypeRaw)
    // Untrusted author HTML is cleaned here, before the trusted passes below
    // (KaTeX, highlight, code syntax) generate their own markup.
    .use(options.sanitize === true ? [[rehypeSanitize, forumSanitizeSchema], rehypeLilyFigureImage] : [])
    .use(rehypeObsidianImageSize)
    .use(rehypeKatex, { strict: false })
    .use(rehypeHighlight, {
      languages: lowlightAll,
      aliases: forumHighlightAliases,
      ignoreMissing: true,
    })
    .use(rehypeCodeSyntax)
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
