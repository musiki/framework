// plugins/remark-mermaid.mjs
import { visit } from 'unist-util-visit';
import { renderMermaidSvg } from '../lib/mermaid-render.mjs';

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export default function remarkMermaid() {
  return async (tree, file) => {
    const diagrams = [];

    visit(tree, 'code', (node, index, parent) => {
      if (!parent || typeof index !== 'number') return;
      if (String(node.lang || '').trim().toLowerCase() !== 'mermaid') return;
      const code = String(node.value || '').trimEnd();
      diagrams.push({
        code,
        index,
        parent,
      });
    });

    await Promise.all(diagrams.map(async ({ code, index, parent }) => {
      try {
        const svg = await renderMermaidSvg(code);
        if (!svg) throw new Error('Mermaid returned empty SVG');
        parent.children[index] = {
          type: 'html',
          value: `<figure class="mermaid mermaid-rendered" data-mermaid-rendered="true">\n${svg}\n</figure>`,
        };
      } catch (error) {
        const source = file?.path || file?.history?.[0] || 'markdown';
        console.warn(`[remark-mermaid] Falling back to client rendering for ${source}:`, error.message);
        parent.children[index] = {
          type: 'html',
          value: `<div class="mermaid">\n${escapeHtml(code)}\n</div>`,
        };
      }
    }));
  };
}
