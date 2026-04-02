import { visit } from 'unist-util-visit';
import { renderRemoteLilypond } from '../lib/lilypond-remote.mjs';
import { hasLilypondBinary } from '../lib/lilypond-support.mjs';

function escapeHtmlAttribute(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function resolveRemoteMidiUrl(svgUrl) {
  const normalizedSvgUrl = String(svgUrl || '').trim();
  if (!normalizedSvgUrl) return '';

  const candidates = [
    normalizedSvgUrl.replace(/\.svg(?=([?#].*)?$)/i, '.midi'),
    normalizedSvgUrl.replace(/\.svg(?=([?#].*)?$)/i, '.mid'),
  ];

  for (const candidate of candidates) {
    try {
      const response = await fetch(candidate, { method: 'HEAD' });
      if (response.ok) return candidate;
    } catch {
      // Keep trying fallbacks.
    }
  }

  return '';
}

export default function remarkRemoteLilypond(options = {}) {
  const enabled = options.enabled === true;
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 10_000;
  const preferRemote = options.preferRemote !== false;

  return async (tree) => {
    if (!enabled) return;
    if (!preferRemote && hasLilypondBinary()) return;

    const memo = new Map();
    const replacements = [];

    visit(tree, 'code', (node, index, parent) => {
      if (!parent || typeof index !== 'number') return;
      const lang = String(node.lang || '').trim().toLowerCase();
      if (!['lilypond', 'lily', 'ly'].includes(lang)) return;

      const source = typeof node.value === 'string' ? node.value : '';
      replacements.push({
        index,
        parent,
        source,
      });
    });

    await Promise.all(
      replacements.map(async (entry) => {
        let requestPromise = memo.get(entry.source);
        if (!requestPromise) {
          requestPromise = renderRemoteLilypond(entry.source, { timeoutMs });
          memo.set(entry.source, requestPromise);
        }

        const url = await requestPromise;
        if (!url) return;
        const midiUrl = await resolveRemoteMidiUrl(url);
        const midiAttr = midiUrl ? ` data-midi-url="${escapeHtmlAttribute(midiUrl)}"` : '';

        entry.parent.children[entry.index] = {
          type: 'html',
          value: `<figure class="lilypond-block lily-score" data-lily-url="${escapeHtmlAttribute(url)}"${midiAttr}><img src="${escapeHtmlAttribute(url)}" alt="LilyPond notation render" loading="lazy" /></figure>`,
        };
      }),
    );
  };
}
