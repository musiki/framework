// astro.config.mjs
import { defineConfig } from 'astro/config'
import mdx from '@astrojs/mdx'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'

import slugMathRemark from './src/plugins/slug-math-remark.js'
import rehypeObsidianCallouts from './src/plugins/remark-obsidian-callouts.mjs'
import remarkMermaid from './src/plugins/remark-mermaid.mjs'
import remarkRefsApa from './src/plugins/remark-refs-apa.mjs'
import remarkEvalBlocks from './src/plugins/remark-eval-blocks.mjs'
import remarkDataviewLite from './src/plugins/remark-dataview-lite.mjs'
import remarkWikiLink from './src/plugins/remark-wiki-link.mjs'
import remarkLily from './src/plugins/remark-lily.mjs'
import remarkRemoteLilypond from './src/plugins/remark-remote-lilypond.mjs'

import auth from 'auth-astro';
import node from '@astrojs/node';

const localhostUrlRe = /^https?:\/\/(?:localhost|127(?:\.\d+){3}|0\.0\.0\.0)(?::\d+)?(?:\/|$)/i;

const normalizeUrl = (value) => {
  if (!value) return undefined;
  const withProtocol = value.startsWith('http://') || value.startsWith('https://')
    ? value
    : `https://${value}`;
  return withProtocol.replace(/\/$/, '');
};

const firstNonLocalUrl = (...values) => {
  for (const value of values) {
    const normalized = normalizeUrl(value);
    if (!normalized) continue;
    if (localhostUrlRe.test(normalized)) continue;
    return normalized;
  }
};

const site = firstNonLocalUrl(
  process.env.SITE_URL,
  process.env.AUTH_URL,
  process.env.NEXTAUTH_URL,
  process.env.VERCEL_PROJECT_PRODUCTION_URL,
  process.env.VERCEL_URL
) || 'http://localhost:4321';

export default defineConfig({
  site,
  output: 'server',
  adapter: node({
    mode: 'standalone'
  }),
  vite: {
    optimizeDeps: {
      include: [
        '@mediapipe/tasks-vision',
        'reveal.js',
        'reveal.js/plugin/notes/notes.esm.js',
        'reveal.js/plugin/highlight/highlight.esm.js',
        'reveal.js/plugin/math/math.esm.js',
        'reveal.js/plugin/markdown/markdown.esm.js',
        'marked',
        'mermaid',
      ],
    },
  },
  // Auth.js already validates CSRF tokens for auth endpoints.
  // Astro's origin guard can false-positive behind reverse proxies.
  security: {
    checkOrigin: false,
  },
  integrations: [
    mdx(), 
    auth({ injectEndpoints: false })
  ],
  markdown: {
    shikiConfig: {
      langAlias: {
        'dataview': 'javascript',
        'dataviewjs': 'javascript',
        'ref': 'text',
        'run-python': 'python',
      }
    },
    remarkPlugins: [
      remarkGfm,
      slugMathRemark,         // primero traducís $<
      remarkMath,
      remarkMermaid,          // luego procesá mermaid si aparece dentro
      remarkEvalBlocks,       // procesa bloques eval
      remarkDataviewLite,     // procesa bloques dataview
      remarkWikiLink,         // procesa wiki links [[Link]]
      [remarkRemoteLilypond, { enabled: true, timeoutMs: 10_000 }], // intenta renderer remoto primero
      remarkLily,             // procesa bloques lilypond
    ],
    rehypePlugins: [
      rehypeObsidianCallouts, // detecta y transforma callouts tipo GitHub/Obsidian
      rehypeRaw,              // permite inyectar HTML desde remark
      [rehypeKatex, { strict: false }], // Render math even if there are minor LaTeX errors
    ]
  }
})
