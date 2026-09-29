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
  /**
   * Seshat citation rendering. Omitted: musiki's defaults (Spanish heading,
   * global SESHAT_CITATION_OWNER_EMAIL). mm passes a localized heading/lang
   * and a `resolve` scoped to the forum's own library owner.
   */
  citations?: {
    headingText?: string;
    lang?: string;
    resolve?: (keys: string[]) => Promise<Map<string, unknown> | Iterable<[string, unknown]>>;
  };
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

/**
 * rehypeLilyFigureImage only runs in sanitize mode (mm), where scores must be
 * same-origin: no third-party request may leave a reader's browser.
 */
const LILY_URL_RE = /^\/lily\/[A-Za-z0-9._-]+\.svg$/;

const LILY_LANGS = new Set(['lily', 'lilypond', 'ly']);
const RENDERED_COMMENT_RE = /^\s*%\s*rendered:/i;

/**
 * Sanitize mode: drops `% rendered: <url>` annotation lines from LilyPond
 * fences so an author cannot point a score at a third-party render URL.
 */
export function remarkStripLilyRenderedComments() {
  const visitNode = (node: any) => {
    if (!node) return;
    if (node.type === 'code' && LILY_LANGS.has(String(node.lang ?? '').trim().toLowerCase())) {
      node.value = String(node.value ?? '')
        // Same line terminators as the consumer's /m regexes (CR, LF, CRLF, U+2028/9).
        .split(/\r\n|[\n\r\u2028\u2029]/)
        .filter((line: string) => !RENDERED_COMMENT_RE.test(line))
        .join('\n');
    }
    if (Array.isArray(node.children)) for (const child of node.children) visitNode(child);
  };
  return (tree: any) => visitNode(tree);
}

/** Same-origin media paths an mm post may load: LilyPond renders and mm's own files. */
const SAME_ORIGIN_MEDIA_RE = /^\/(?:lily|mm)\/[A-Za-z0-9._~%\/-]*$/;
export const isSameOriginMediaPath = (value: unknown): boolean => {
  const v = String(value ?? '');
  return SAME_ORIGIN_MEDIA_RE.test(v) && !v.includes('..') && !v.includes('//');
};

const HTTP_URL_RE = /^https?:\/\//i;
const MEDIA_TAGS = new Set(['img', 'audio', 'video']);

const textOf = (node: any): string =>
  node?.type === 'text' ? String(node.value ?? '') : Array.isArray(node?.children) ? node.children.map(textOf).join('') : '';

/**
 * Sanitize mode only (mm "no tracking"): after rehype-sanitize, <img>,
 * <audio>, <video> and <source> may load only same-origin /lily/ or /mm/
 * paths; anything else becomes a plain link the reader can choose to follow
 * (`<a rel="nofollow noopener noreferrer">[image: alt]</a>`, href only for
 * http(s)). Non-same-origin posters and LilyPond data URLs are dropped.
 */
export function rehypeSameOriginMedia() {
  const toLink = (url: string, label: string, insideLink: boolean) => {
    // No nested <a>: inside a link the label alone replaces the media.
    if (insideLink) return { type: 'text', value: label };
    const properties: Record<string, unknown> = { rel: ['nofollow', 'noopener', 'noreferrer'] };
    if (HTTP_URL_RE.test(url)) properties.href = url;
    return { type: 'element', tagName: 'a', properties, children: [{ type: 'text', value: label }] };
  };
  const visitNode = (node: any, insideLink: boolean) => {
    if (!node || !Array.isArray(node.children)) return;
    node.children = node.children.map((child: any) => {
      if (child?.type !== 'element') {
        visitNode(child, insideLink);
        return child;
      }
      const tag = child.tagName;
      const props = child.properties ?? (child.properties = {});
      if (tag === 'figure') {
        if (props.dataLilyUrl != null && !isSameOriginMediaPath(props.dataLilyUrl)) delete props.dataLilyUrl;
        if (props.dataMidiUrl != null && !isSameOriginMediaPath(props.dataMidiUrl)) delete props.dataMidiUrl;
      }
      if (MEDIA_TAGS.has(tag)) {
        if (props.poster != null && !isSameOriginMediaPath(props.poster)) delete props.poster;
        const sources = [
          ...(props.src != null ? [String(props.src)] : []),
          ...(Array.isArray(child.children) ? child.children : [])
            .filter((c: any) => c?.type === 'element' && c.tagName === 'source' && c.properties?.src != null)
            .map((c: any) => String(c.properties.src)),
        ];
        const external = sources.find((src) => !isSameOriginMediaPath(src));
        if (external !== undefined) {
          const alt = tag === 'img' ? String(props.alt ?? '').trim() : textOf(child).trim();
          const kind = tag === 'img' ? 'image' : tag;
          return toLink(external, alt ? `[${kind}: ${alt}]` : `[${kind}]`, insideLink);
        }
      }
      if (tag === 'source' && props.src != null && !isSameOriginMediaPath(props.src)) {
        return toLink(String(props.src), '[media]', insideLink);
      }
      visitNode(child, insideLink || tag === 'a');
      return child;
    });
  };
  return (tree: any) => visitNode(tree, false);
}

/**
 * After sanitizing, a locally rendered LilyPond figure has lost its inline
 * <svg>; show the same score through its data-lily-url as an <img> instead
 * (only same-origin /lily/*.svg).
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
      { type: 'element', tagName: 'img', properties: { src: url, alt: '', loading: 'lazy' }, children: [] },
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

  if (options.sanitize === true) {
    processor = processor.use(remarkStripLilyRenderedComments);
  }

  // Sanitized (mm) posts never render Mermaid server-side: the SVG would be
  // stripped anyway, and author-controlled diagrams can stall the JSDOM
  // renderer. The source stays a plain code block.
  if (options.sanitize !== true) {
    processor = processor.use(remarkMermaid);
  }

  processor = processor
    .use(remarkWikiLink)
    .use(remarkMediaEmbed)
    .use(remarkLily)
    .use(remarkObsidianHighlight)
    .use(remarkDataviewLite)
    .use(remarkSeshatCitations, options.citations ?? {})
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
    .use(options.sanitize === true ? [[rehypeSanitize, forumSanitizeSchema], rehypeLilyFigureImage, rehypeSameOriginMedia] : [])
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
