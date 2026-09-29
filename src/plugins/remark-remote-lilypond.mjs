// Fallback for LilyPond blocks that remark-lily could not render (render
// service unreachable): if the block was rendered before and carries a valid
// `% rendered:` comment (or is in the local render cache), show the existing
// R2 image. No rendering happens here any more — the old HTTP render service
// is replaced by the sandboxed lilypond-service used by remark-lily.
import { visit } from 'unist-util-visit';
import { isAllowedRemoteLilyUrl, resolveRenderedLilypondUrl } from '../lib/lilypond-remote.mjs';

function escapeHtmlAttribute(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function resolveRemoteMidiUrl(svgUrl, fetchImpl) {
  const normalizedSvgUrl = String(svgUrl || '').trim();
  if (!normalizedSvgUrl || !isAllowedRemoteLilyUrl(normalizedSvgUrl)) return '';

  const candidates = [
    normalizedSvgUrl.replace(/\.svg(?=([?#].*)?$)/i, '.midi'),
    normalizedSvgUrl.replace(/\.svg(?=([?#].*)?$)/i, '.mid'),
  ];

  for (const candidate of candidates) {
    if (candidate === normalizedSvgUrl) continue;
    try {
      const response = await fetchImpl(candidate, { method: 'HEAD', signal: AbortSignal.timeout(5000) });
      if (response.ok) return candidate;
    } catch {
      // Keep trying fallbacks.
    }
  }

  return '';
}

/**
 * @param {{enabled?: boolean, fetch?: typeof fetch}} [options]
 *   `timeoutMs` / `preferRemote` from the old API are accepted and ignored.
 */
export default function remarkRemoteLilypond(options = {}) {
  const enabled = options.enabled === true;
  const fetchImpl = options.fetch ?? globalThis.fetch;

  return async (tree) => {
    if (!enabled) return;

    const replacements = [];
    visit(tree, 'code', (node, index, parent) => {
      if (!parent || typeof index !== 'number') return;
      const lang = String(node.lang || '').trim().toLowerCase();
      if (!['lilypond', 'lily', 'ly'].includes(lang)) return;
      const source = typeof node.value === 'string' ? node.value : '';
      replacements.push({ index, parent, source });
    });

    const midiMemo = new Map();
    await Promise.all(
      replacements.map(async (entry) => {
        const url = resolveRenderedLilypondUrl(entry.source);
        if (!url || !/^https?:\/\//i.test(url)) return;
        let midiPromise = midiMemo.get(url);
        if (!midiPromise) {
          midiPromise = resolveRemoteMidiUrl(url, fetchImpl);
          midiMemo.set(url, midiPromise);
        }
        const midiUrl = await midiPromise;
        const midiAttr = midiUrl ? ` data-midi-url="${escapeHtmlAttribute(midiUrl)}"` : '';

        entry.parent.children[entry.index] = {
          type: 'html',
          value: `<figure class="lilypond-block lily-score" data-lily-url="${escapeHtmlAttribute(url)}"${midiAttr}><img src="${escapeHtmlAttribute(url)}" alt="LilyPond notation render" loading="lazy" /></figure>`,
        };
      }),
    );
  };
}
