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

// Importamos tus plugins personalizados
// Nota: Usamos import dinámico si son .mjs o tienen efectos secundarios
import slugMathRemark from '../plugins/slug-math-remark.js';
import rehypeObsidianCallouts from '../plugins/remark-obsidian-callouts.mjs';
import remarkMermaid from '../plugins/remark-mermaid.mjs';
import remarkEvalBlocks from '../plugins/remark-eval-blocks.mjs';
import remarkDataviewLite from '../plugins/remark-dataview-lite.mjs';
import remarkWikiLink from '../plugins/remark-wiki-link.mjs';
import remarkLily from '../plugins/remark-lily.mjs';
import remarkRemoteLilypond from '../plugins/remark-remote-lilypond.mjs';

const CONTENT_DIR = path.resolve(process.cwd(), 'src/content/cursos');

export async function getRuntimeDynamicContent(slug: string) {
  // 1. Localizar el archivo en el sistema de archivos
  // El slug puede ser "i1/clase1" -> "src/content/cursos/i1/clase1.md"
  const filePath = path.join(CONTENT_DIR, `${slug}.md`);
  const filePathMdx = path.join(CONTENT_DIR, `${slug}.mdx`);
  
  let rawContent: string;
  let actualPath: string;

  try {
    if (await fs.access(filePath).then(() => true).catch(() => false)) {
      actualPath = filePath;
    } else if (await fs.access(filePathMdx).then(() => true).catch(() => false)) {
      actualPath = filePathMdx;
    } else {
      return null; // No encontrado
    }
    
    rawContent = await fs.readFile(actualPath, 'utf-8');
  } catch (e) {
    console.error(`[Runtime Content] Error reading ${slug}:`, e);
    return null;
  }

  // 2. Extraer Frontmatter
  const { data: frontmatter, content: markdownBody } = matter(rawContent);

  // 3. Renderizar Markdown a HTML usando tu pipeline exacto
  const processor = unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(slugMathRemark)
    .use(remarkMath)
    .use(remarkMermaid)
    .use(remarkEvalBlocks)
    .use(remarkDataviewLite)
    .use(remarkWikiLink)
    .use(remarkRemoteLilypond, { enabled: true, timeoutMs: 10000 })
    .use(remarkLily)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeObsidianCallouts)
    .use(rehypeRaw)
    .use(rehypeKatex, { strict: false })
    .use(rehypeStringify);

  const result = await processor.process(markdownBody);
  const html = result.toString();

  return {
    html,
    frontmatter,
    id: slug,
  };
}
