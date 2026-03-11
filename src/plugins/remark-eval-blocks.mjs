import { visit } from 'unist-util-visit';
import { Buffer } from 'node:buffer';
import { parseEvalBlock } from '../lib/eval/parse-eval-block.mjs';

const sanitizeFallbackId = (value) =>
  String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');

export default function remarkEvalBlocks() {
  return (tree, file) => {
    let evalCounter = 0;
    const sourcePrefix = sanitizeFallbackId(file?.path || file?.history?.[0] || '') || 'eval';

    visit(tree, 'code', (node, index, parent) => {
      if (node.lang !== 'eval') return;
      
      try {
        evalCounter += 1;
        const evalData = parseEvalBlock(node.value, {
          fallbackId: `${sourcePrefix}-eval-${evalCounter}`,
          sourcePath: file?.path || '',
        });
        const payload = Buffer.from(JSON.stringify(evalData), 'utf8').toString('base64');
        
        // Transform to custom HTML component
        const replacement = {
          type: 'html',
          value: `<div class="eval-block-wrapper" data-eval-b64="${payload}" data-eval-id="${evalData.id}" data-eval-type="${evalData.type}"></div>`
        };
        
        parent.children[index] = replacement;
      } catch (error) {
        console.error('Error parsing eval block:', file?.path || 'unknown-file', error);
        // Keep original code block on error
      }
    });
  };
}
