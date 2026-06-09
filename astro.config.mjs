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
import remarkCoverBlock from './src/plugins/remark-cover-block.mjs'
import rehypeLazyYouTube from './src/plugins/rehype-lazy-youtube.mjs'
import rehypeCodeSyntax from './src/plugins/rehype-code-syntax.mjs'
import remarkObsidianHighlight from './src/plugins/remark-obsidian-highlight.mjs'

import auth from 'auth-astro';
import node from '@astrojs/node';
import react from '@astrojs/react';

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
  process.env.NEXTAUTH_URL
) || (process.env.NODE_ENV === 'production' ? 'https://musiki.org.ar' : 'http://localhost:4321');

const remoteDevHmrHost = (
  process.env.REMOTE_DEV_HMR_HOST ||
  process.env.VITE_HMR_HOST ||
  ''
).trim();
const viteServerConfig = {
  allowedHosts: ['musiki.org.ar', 'www.musiki.org.ar', 'dev.musiki.org.ar', '46.225.154.68', '.ngrok-free.app', '.ngrok.io'],
};

if (remoteDevHmrHost) {
  viteServerConfig.hmr = {
    protocol: 'wss',
    host: remoteDevHmrHost,
    clientPort: Number(process.env.VITE_HMR_CLIENT_PORT || 443),
  };
}

export default defineConfig({
  site,
  devToolbar: { enabled: false },
  output: 'server',
  adapter: node({
    mode: 'standalone'
  }),
  vite: {
    server: viteServerConfig,
    optimizeDeps: {
      exclude: ['force-graph', 'three'],
      include: [
        '@auth/core',
        'reveal.js',
        'reveal.js/plugin/notes/notes.esm.js',
        'reveal.js/plugin/highlight/highlight.esm.js',
        'reveal.js/plugin/math/math.esm.js',
        'reveal.js/plugin/markdown/markdown.esm.js',
        'marked',
        'mermaid',
        'tabulator-tables',
        'codemirror',
        '@codemirror/state',
        '@codemirror/view',
        '@codemirror/lang-markdown',
        '@codemirror/language',
        'dockview-core',
        'vexflow',
      ],
    },
  },
  // Auth.js already validates CSRF tokens for auth endpoints.
  // Astro's origin guard can false-positive behind reverse proxies.
  security: {
    checkOrigin: false,
  },
  server: {
    trustProxy: true,
  },
  integrations: [
    mdx(), 
    react(),
    auth({ injectEndpoints: false })
  ],
  markdown: {
    shikiConfig: {
      themes: {
        light: 'github-light',
        dark: 'github-dark',
      },
      defaultColor: false,
      langAlias: {
        'dataview': 'javascript',
        'dataviewjs': 'javascript',
        'ref': 'text',
        'run-python': 'python',
        'ActivityHistory': 'text',
        'lily': 'scheme',
        'lilypond': 'scheme',
        'ly': 'scheme',
      }
    },
    remarkPlugins: [
      remarkGfm,
      remarkCoverBlock,
      slugMathRemark,         // primero traducís $<
      remarkMath,
      remarkMermaid,          // luego procesá mermaid si aparece dentro
      remarkEvalBlocks,       // procesa bloques eval
      remarkDataviewLite,     // procesa bloques dataview
      remarkWikiLink,         // procesa wiki links [[Link]]
      remarkLily,             // usa renderer local de lilypond
      remarkObsidianHighlight,
    ],
    rehypePlugins: [
      rehypeObsidianCallouts, // detecta y transforma callouts tipo GitHub/Obsidian
      rehypeRaw,              // permite inyectar HTML desde remark
      [rehypeKatex, { strict: false }], // Render math even if there are minor LaTeX errors
      rehypeLazyYouTube,
      rehypeCodeSyntax,
    ]
  }
})
