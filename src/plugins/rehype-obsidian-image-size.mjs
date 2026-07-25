import { visit } from 'unist-util-visit';

function parseImageOptions(rawAlt) {
  const alt = String(rawAlt ?? '').trim();
  let caption = '';
  let width = null;
  let height = null;

  if (alt.includes('|')) {
    const parts = alt.split('|').map(p => p.trim()).filter(Boolean);
    parts.forEach(part => {
      const capMatch = part.match(/^caption:\s*["']?(.*?)["']?$/i);
      if (capMatch) {
        caption = capMatch[1];
      } else if (/^\d+(?:\.\d+)?%$/.test(part)) {
        width = part;
      } else if (/^\d+(?:x\d+)?$/i.test(part)) {
        const sizeMatch = part.match(/^(\d+)(?:x(\d+))?$/i);
        if (sizeMatch) {
          width = sizeMatch[1] + 'px';
          if (sizeMatch[2]) height = sizeMatch[2] + 'px';
        }
      } else if (/^(?:width=)?(\d+(?:\.\d+)?(?:px|cm|mm|in|pt|em|ex)?)$/i.test(part)) {
        const match = part.match(/^(?:width=)?(.*)$/i);
        width = match ? match[1] : part;
      } else {
        caption = part;
      }
    });
  } else if (alt) {
    caption = alt;
  }

  return { caption, width, height };
}

export default function rehypeObsidianImageSize() {
  return (tree) => {
    visit(tree, 'element', (node) => {
      if (!node || node.tagName !== 'img') return;
      if (node.properties && node.properties.__processed) return;

      const props = node.properties || {};
      const parsed = parseImageOptions(props.alt);

      // Set width/height style if found
      let style = props.style || '';
      if (parsed.width) {
        style = `${style}; width: ${parsed.width}; max-width: 100%; height: auto;`.trim();
      }
      if (parsed.height) {
        style = `${style}; height: ${parsed.height};`.trim();
      }
      if (style) {
        props.style = style;
      }

      props.alt = parsed.caption || props.alt;
      props.__processed = true;
      node.properties = props;

      // Wrap in figure if caption is present
      if (parsed.caption) {
        const imgClone = {
          type: 'element',
          tagName: 'img',
          properties: { ...props },
          children: []
        };

        node.tagName = 'figure';
        node.properties = {
          className: ['md-figure'],
          style: 'margin: 1.2em 0; display: flex; flex-direction: column; align-items: center;'
        };
        node.children = [
          imgClone,
          {
            type: 'element',
            tagName: 'figcaption',
            properties: {
              className: ['md-figcaption'],
              style: 'font-size: 11px; color: var(--c-fg-dim); opacity: 0.8; margin-top: 6px; text-align: center; font-style: italic;'
            },
            children: [{ type: 'text', value: parsed.caption }]
          }
        ];
      }
    });
  };
}
