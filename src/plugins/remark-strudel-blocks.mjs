import { visit } from 'unist-util-visit';

function encodeBase64Url(value) {
  return Buffer.from(String(value || ''), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function normalizeLanguage(value) {
  return String(value || '').trim().toLowerCase();
}

function renderStrudelBlock(source) {
  const encodedSource = encodeBase64Url(source);

  return `<figure class="strudel-note-block" data-strudel-block data-strudel-code="${encodedSource}">
  <header class="strudel-note-header">
    <button type="button" class="strudel-note-transport" data-strudel-transport data-playing="false" aria-label="Play Strudel" aria-pressed="false" title="Play Strudel">▶</button>
  </header>
  <div class="strudel-note-stage">
    <div class="strudel-note-host" data-strudel-host></div>
  </div>
  <div class="strudel-note-console" data-strudel-console data-level="ready" role="status" aria-live="polite" hidden></div>
</figure>`;
}

export default function remarkStrudelBlocks() {
  return (tree) => {
    visit(tree, 'code', (node, index, parent) => {
      if (!parent || typeof index !== 'number') return;
      if (normalizeLanguage(node.lang) !== 'strudel') return;

      parent.children[index] = {
        type: 'html',
        value: renderStrudelBlock(node.value || ''),
      };
    });
  };
}
