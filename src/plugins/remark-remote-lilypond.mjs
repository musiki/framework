import { visit } from 'unist-util-visit';

const REMOTE_LILYPOND_RENDER_URL = 'http://85.31.234.141:4543/render';

function escapeHtmlAttribute(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

async function renderRemoteLilypond(source, { timeoutMs }) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(REMOTE_LILYPOND_RENDER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
      },
      body: source,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Remote LilyPond render failed with ${response.status}`);
    }

    const payload = await response.json().catch(() => null);
    const url = typeof payload?.url === 'string' ? payload.url.trim() : '';
    if (!url || !/^https?:\/\//i.test(url)) {
      throw new Error('Remote LilyPond render returned no url');
    }

    return url;
  } catch (error) {
    console.error('[remark-remote-lilypond] Render error:', error);
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
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
