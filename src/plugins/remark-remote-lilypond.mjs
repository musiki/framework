import { visit } from 'unist-util-visit';
import { renderRemoteLilypond } from '../lib/lilypond-remote.mjs';

function escapeHtmlAttribute(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export default function remarkRemoteLilypond(options = {}) {
  const enabled = options.enabled === true;
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 10_000;

  return async (tree) => {
    if (!enabled) return;

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

        entry.parent.children[entry.index] = {
          type: 'html',
          value: `<figure class="lilypond-block"><img src="${escapeHtmlAttribute(url)}" alt="LilyPond notation render" loading="lazy" /></figure>`,
        };
      }),
    );
  };
}
