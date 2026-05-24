import { visit } from 'unist-util-visit';

function isYouTubeSrc(src) {
  try {
    const url = new URL(String(src || ''), 'https://musiki.local');
    const host = url.hostname.replace(/^www\./, '').toLowerCase();
    return (
      (host === 'youtube.com' || host === 'youtube-nocookie.com') &&
      (url.pathname.startsWith('/embed/') || url.pathname === '/watch')
    ) || host === 'youtu.be';
  } catch {
    return false;
  }
}

function toStringValue(value, fallback = '') {
  if (Array.isArray(value)) return value.join(' ');
  return value == null ? fallback : String(value);
}

export default function rehypeLazyYouTube() {
  return (tree) => {
    visit(tree, 'element', (node) => {
      if (node.tagName !== 'iframe') return;
      const props = node.properties || {};
      const src = toStringValue(props.src || props.dataSrc);
      if (!src || !isYouTubeSrc(src)) return;

      const title = toStringValue(props.title, 'YouTube');
      const width = Number(props.width) || 16;
      const height = Number(props.height) || 9;
      const ratio = width > 0 && height > 0 ? `${width} / ${height}` : '16 / 9';

      node.tagName = 'div';
      node.properties = {
        className: ['cnw-lazy-embed', 'cnw-lazy-embed--youtube'],
        style: `aspect-ratio:${ratio}`,
        dataCnwYoutubeSrc: src,
        dataCnwYoutubeTitle: title,
      };
      node.children = [
        {
          type: 'element',
          tagName: 'button',
          properties: {
            type: 'button',
            className: ['cnw-lazy-embed-btn'],
            ariaLabel: `Cargar video: ${title}`,
          },
          children: [
            {
              type: 'element',
              tagName: 'span',
              properties: {
                className: ['cnw-lazy-embed-play'],
                ariaHidden: 'true',
              },
              children: [{ type: 'text', value: '▶' }],
            },
            {
              type: 'element',
              tagName: 'span',
              properties: { className: ['cnw-lazy-embed-label'] },
              children: [{ type: 'text', value: 'YouTube' }],
            },
          ],
        },
      ];
    });
  };
}
