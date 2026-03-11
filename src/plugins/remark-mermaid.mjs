// plugins/remark-mermaid.mjs
import { visit } from 'unist-util-visit';

export default function remarkMermaid() {
  return (tree) => {
    visit(tree, 'code', (node, index, parent) => {
      if (!parent || typeof index !== 'number') return;
      if (node.lang !== 'mermaid') return;
      const code = String(node.value || '').trimEnd();
      parent.children.splice(index, 1, {
        type: 'html',
        value: `<div class="mermaid">\n${code}\n</div>`,
      });
    });
  };
}
