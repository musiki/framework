import { visit } from 'unist-util-visit';

export default function remarkObsidianHighlight() {
  return (tree) => {
    visit(tree, 'text', (node, index, parent) => {
      const value = node.value;
      if (!value || !value.includes('==')) return;

      const regex = /==([^=\n]+)==/g;
      const children = [];
      let lastIndex = 0;
      let match;

      while ((match = regex.exec(value)) !== null) {
        if (match.index > lastIndex) {
          children.push({
            type: 'text',
            value: value.slice(lastIndex, match.index),
          });
        }
        children.push({
          type: 'html',
          value: `<mark>${match[1]}</mark>`,
        });
        lastIndex = regex.lastIndex;
      }

      if (lastIndex < value.length) {
        children.push({
          type: 'text',
          value: value.slice(lastIndex),
        });
      }

      if (children.length > 0 && parent && typeof index === 'number') {
        parent.children.splice(index, 1, ...children);
      }
    });
  };
}
