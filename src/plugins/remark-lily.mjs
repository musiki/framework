// ```lily / ```lilypond / ```ly code blocks → inline SVG score.
//
// Rendering goes through the sandboxed lilypond-service (src/lib/lilypond/service.mjs);
// the engine never runs LilyPond itself. Output is cached as
// public/lily/<md5(code)>.svg / .midi (same names and markup as before), and
// every SVG is security-sanitized before it is written or inlined. When the
// service is unreachable the code block is left as is (remark-remote-lilypond
// may still show a previously rendered R2 image).
import { visit } from 'unist-util-visit';
import { sanitizeLilypondSvgMarkup } from '../lib/lilypond-support.mjs';
import { renderLilypond } from '../lib/lilypond/service.mjs';
import {
  getLilyDir,
  lilyAssetPaths,
  md5Hex,
  readSanitizedSvg,
  resolveMidiPath,
  writeLilyAssets,
} from '../lib/lilypond/store.mjs';
import fs from 'node:fs';

const LILY_LANGS = new Set(['lily', 'lilypond', 'ly']);

/**
 * @param {{render?: typeof renderLilypond, dir?: string, timeoutMs?: number}} [options]
 */
export default function remarkLily(options = {}) {
  const render = options.render ?? renderLilypond;
  const timeoutMs = options.timeoutMs ?? 30_000;

  return async (tree, file) => {
    const lilyDir = options.dir ?? getLilyDir();
    const entries = [];

    visit(tree, 'code', (node, index, parent) => {
      if (!parent || typeof index !== 'number') return;
      const lang = String(node.lang || '').trim().toLowerCase();
      if (!LILY_LANGS.has(lang)) return;
      entries.push({ node, index, parent });
    });
    if (entries.length === 0) return;

    const memo = new Map();
    const renderToFiles = async (code, hash) => {
      const { svgPath } = lilyAssetPaths(hash, lilyDir);
      if (fs.existsSync(svgPath)) return true;
      const outcome = await render(code, { formats: ['svg', 'midi'], timeoutMs });
      if (!outcome.ok) {
        if (outcome.reason === 'render_failed') {
          const src = file?.path || file?.history?.[0] || 'unknown';
          console.error(`[remark-lily] Failed to generate SVG for ${hash} (${src}): ${outcome.message}`);
        }
        return false;
      }
      const written = await writeLilyAssets(hash, outcome.result, { dir: lilyDir });
      return Boolean(written.svg);
    };

    await Promise.all(entries.map(async ({ node, index, parent }) => {
      const code = String(node.value ?? '');
      if (!code.trim()) return;
      // Same cache key as before the sandbox: md5 of the block as written.
      const hash = md5Hex(code);

      let pending = memo.get(hash);
      if (!pending) {
        pending = renderToFiles(code, hash).catch((error) => {
          console.error(`[remark-lily] ${hash}:`, error?.message || error);
          return false;
        });
        memo.set(hash, pending);
      }
      if (!(await pending)) return;

      const { svgPath } = lilyAssetPaths(hash, lilyDir);
      const safeSvg = await readSanitizedSvg(svgPath);
      if (!safeSvg) return;
      const svgContent = sanitizeLilypondSvgMarkup(safeSvg).trim();
      const midiAttr = resolveMidiPath(hash, lilyDir) ? ` data-midi-url="/lily/${hash}.midi"` : '';

      parent.children[index] = {
        type: 'html',
        value: `<figure class="lilypond-block lily-score" data-lily-url="/lily/${hash}.svg"${midiAttr}>\n${svgContent}\n</figure>`,
      };
    }));
  };
}
