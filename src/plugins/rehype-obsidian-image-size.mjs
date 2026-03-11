import { visit } from 'unist-util-visit';

function parseImageSizeFromAlt(rawAlt) {
  const alt = String(rawAlt ?? '');
  const match = alt.match(/^(.*?)(?:\|\s*(\d+)(?:x(\d+))?\s*)$/i);
  if (!match) return null;

  const cleanAlt = String(match[1] ?? '').trim();
  const width = Number(match[2] ?? '');
  const height = match[3] ? Number(match[3]) : null;

  if (!Number.isFinite(width) || width <= 0) return null;
  if (height !== null && (!Number.isFinite(height) || height <= 0)) return null;

  return {
    alt: cleanAlt,
    width: Math.round(width),
    height: height === null ? null : Math.round(height),
  };
}

export default function rehypeObsidianImageSize() {
  return (tree) => {
    visit(tree, 'element', (node) => {
      if (!node || node.tagName !== 'img') return;

      const props = node.properties || {};
      const parsed = parseImageSizeFromAlt(props.alt);
      if (!parsed) return;

      props.alt = parsed.alt;
      props.width = String(parsed.width);

      if (parsed.height) {
        props.height = String(parsed.height);
      } else if (props.height) {
        delete props.height;
      }

      node.properties = props;
    });
  };
}
