// ```bibtex (o bib/biblatex/btx) → referencias APA 7 en el lugar del bloque.
// Si el bloque no se puede formatear completo queda como código, y se avisa.
import { visit } from 'unist-util-visit';
import { renderBibtexBlock } from '../lib/bibtex/apa-refs.mjs';

const LANGS = new Set(['bibtex', 'bib', 'biblatex', 'btx']);

export default function remarkBibtexApa(options = {}) {
  const lang = String(options.lang || 'es-ES');
  return (tree, file) => {
    visit(tree, 'code', (node, index, parent) => {
      if (!parent || typeof index !== 'number') return;
      if (!LANGS.has(String(node.lang || '').toLowerCase())) return;
      try {
        const html = renderBibtexBlock(node.value, { lang });
        if (html) parent.children.splice(index, 1, { type: 'html', value: html });
      } catch (err) {
        console.warn('[remark-bibtex-apa]', file?.path || 'nota', err instanceof Error ? err.message : err);
      }
    });
  };
}
