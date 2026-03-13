import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeKatex from 'rehype-katex';
import rehypeStringify from 'rehype-stringify';
import rehypeHighlight from 'rehype-highlight';
import { all as lowlightAll } from 'lowlight';

// Importamos tus plugins personalizados
import slugMathRemark from '../plugins/slug-math-remark.js';
import rehypeObsidianCallouts from '../plugins/remark-obsidian-callouts.mjs';
import remarkMermaid from '../plugins/remark-mermaid.mjs';
import remarkEvalBlocks from '../plugins/remark-eval-blocks.mjs';
import remarkDataviewLite from '../plugins/remark-dataview-lite.mjs';
import remarkWikiLink from '../plugins/remark-wiki-link.mjs';
import remarkRemoteLilypond from '../plugins/remark-remote-lilypond.mjs';

const CONTENT_DIR = path.resolve(process.cwd(), 'src/content/cursos');
const runtimeHighlightAliases = {
  javascript: ['js'],
  python: ['py'],
  shell: ['bash', 'sh', 'zsh', 'fish'],
  xml: ['html'],
  markdown: ['md'],
  scheme: ['guile', 'lilypond', 'lily', 'ly'],
};

export async function renderRuntimeMarkdown(rawContent: string, id = '') {
  const { data: frontmatter, content: markdownBody } = matter(rawContent);

  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(slugMathRemark)
    .use(remarkMath)
    .use(remarkMermaid)
    .use(remarkEvalBlocks)
    .use(remarkDataviewLite)
    .use(remarkWikiLink)
    .use(remarkRemoteLilypond, { enabled: true, timeoutMs: 10000, preferRemote: true })
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeObsidianCallouts)
    .use(rehypeRaw)
    .use(rehypeKatex, { strict: false })
    .use(rehypeHighlight, {
      languages: lowlightAll,
      aliases: runtimeHighlightAliases,
      ignoreMissing: true,
    })
    .use(rehypeStringify);

  const result = await processor.process(markdownBody);
  const html = result.toString();

  return { html, frontmatter, id };
}

export async function getRuntimeDynamicContent(slug: string) {
  // El slug puede venir como "i1/01-mentes/segundo-cerebro"
  // Pero el archivo puede ser "i1/01-mentes/segundo cerebro.md"
  
  const cleanSlug = slug.replace(/\/index$/, '');
  
  const possiblePaths = [
    path.join(CONTENT_DIR, `${cleanSlug}.md`),
    path.join(CONTENT_DIR, `${cleanSlug}.mdx`),
    // Probar reemplazando guiones por espacios en el nombre del archivo
    path.join(CONTENT_DIR, cleanSlug.split('/').map((s, i, a) => i === a.length - 1 ? s.replace(/-/g, ' ') : s).join('/') + '.md'),
    path.join(CONTENT_DIR, cleanSlug.split('/').map((s, i, a) => i === a.length - 1 ? s.replace(/-/g, ' ') : s).join('/') + '.mdx'),
    // Probar reemplazando guiones por espacios en toda la ruta
    path.join(CONTENT_DIR, `${cleanSlug.replace(/-/g, ' ')}.md`),
    path.join(CONTENT_DIR, `${cleanSlug.replace(/-/g, ' ')}.mdx`),
  ];
  
  let rawContent: string | null = null;
  let actualPath: string | null = null;

  for (const p of possiblePaths) {
    try {
      if (await fs.access(p).then(() => true).catch(() => false)) {
        actualPath = p;
        rawContent = await fs.readFile(p, 'utf-8');
        break;
      }
    } catch (e) {}
  }

  if (!rawContent || !actualPath) {
    console.warn(`[Runtime Content] No file found for slug: ${slug}. Tried: ${possiblePaths.join(', ')}`);
    return null;
  }

  console.log(`[Runtime Content] RENDERING DYNAMIC: ${actualPath}`);

  try {
    return await renderRuntimeMarkdown(rawContent, slug);
  } catch (error) {
    console.error(`[Runtime Content] Error processing ${slug}:`, error);
    return null;
  }
}
