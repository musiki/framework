// remark-def-callout.mjs
// If a note's frontmatter has `def:`, inject it at the top of the body as an
// Obsidian-style `[!def]` callout. The existing rehype-obsidian-callouts plugin
// then turns the blockquote into <aside class="callout callout-def">.
// Applies to every render path that uses the Astro markdown pipeline
// (server <Content/> and the Dockview panel via /api/get-note-content).

export default function remarkDefCallout() {
  return (tree, file) => {
    const frontmatter = file?.data?.astro?.frontmatter || {};
    const raw = frontmatter.def;
    const def = (typeof raw === 'string' ? raw : (raw == null ? '' : String(raw))).trim();
    if (!def) return;

    // Idempotency guard: skip if the body already opens with a [!def] callout.
    const first = Array.isArray(tree.children) ? tree.children[0] : null;
    if (first && first.type === 'blockquote') {
      const firstPara = (first.children || []).find((n) => n.type === 'paragraph');
      const text = firstPara && (firstPara.children || [])
        .map((c) => (c.type === 'text' ? c.value : ''))
        .join('');
      if (text && /^\s*\[!def\]/i.test(text)) return;
    }

    // Blockquote with two paragraphs: the [!def] header (no inline title) and
    // the definition text as the callout body.
    const calloutNode = {
      type: 'blockquote',
      children: [
        { type: 'paragraph', children: [{ type: 'text', value: '[!def]' }] },
        { type: 'paragraph', children: [{ type: 'text', value: def }] },
      ],
    };

    tree.children.unshift(calloutNode);
  };
}
