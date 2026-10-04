const LANG_OPEN_RE = /^<!--\s*l?lang:([a-z]{2})\s*(?:-*[-→]?>|→)$/i;
const LANG_CLOSE_RE = /^<!--\s*\/lang\s*(?:-*[-→]?>|→)$/i;
const SHARED_MEDIA_HTML_RE = /^<(iframe|img|video|audio|figure)\b/i;

function getOpenLang(node) {
  if (node?.type !== 'html' || typeof node.value !== 'string') return null;
  const match = node.value.trim().match(LANG_OPEN_RE);
  return match?.[1]?.toLowerCase() ?? null;
}

function isClose(node) {
  return node?.type === 'html' &&
    typeof node.value === 'string' &&
    LANG_CLOSE_RE.test(node.value.trim());
}

function isSharedPrologueNode(node) {
  if (!node) return false;

  if (node.type === 'html' && typeof node.value === 'string') {
    return SHARED_MEDIA_HTML_RE.test(node.value.trim());
  }

  if (node.type === 'paragraph' && Array.isArray(node.children)) {
    return node.children.length > 0 &&
      node.children.every((child) => child.type === 'image');
  }

  return false;
}

function wrapBlock(nodes, lang, { hidden = false, isDefault = false } = {}) {
  const className = isDefault
    ? 'musiki-i18n-block musiki-i18n-default'
    : 'musiki-i18n-block';

  return [
    {
      type: 'html',
      value: `<div class="${className}" data-translation-block="${lang}"${
        hidden ? ' hidden' : ''
      }>`,
    },
    ...nodes,
    {
      type: 'html',
      value: '</div>',
    },
  ];
}

function splitHtmlNode(node) {
  if (node.type !== 'html' || typeof node.value !== 'string') {
    return [node];
  }

  const lines = node.value.split('\n');
  const result = [];
  let currentHtml = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (LANG_OPEN_RE.test(trimmed) || LANG_CLOSE_RE.test(trimmed)) {
      if (currentHtml.length > 0) {
        const value = currentHtml.join('\n');
        if (value.trim()) {
          result.push({ type: 'html', value });
        }
        currentHtml = [];
      }
      result.push({ type: 'html', value: trimmed });
    } else {
      currentHtml.push(line);
    }
  }

  if (currentHtml.length > 0) {
    const value = currentHtml.join('\n');
    if (value.trim()) {
      result.push({ type: 'html', value });
    }
  }

  return result;
}

export default function remarkLanguageBlocks() {
  return (tree) => {
    if (!tree || tree.type !== 'root' || !Array.isArray(tree.children)) return;

    const children = [];
    for (const child of tree.children) {
      if (child.type === 'html') {
        children.push(...splitHtmlNode(child));
      } else {
        children.push(child);
      }
    }

    const firstOpenIndex = children.findIndex((node) => getOpenLang(node));
    if (firstOpenIndex === -1) return;

    let closeIndex = firstOpenIndex + 1;
    while (closeIndex < children.length && !isClose(children[closeIndex])) {
      closeIndex += 1;
    }
    if (closeIndex >= children.length) return;

    const explicitLanguages = new Set();
    for (let index = firstOpenIndex; index < children.length; index += 1) {
      const lang = getOpenLang(children[index]);
      if (lang) explicitLanguages.add(lang);
    }

    // With two explicit translations, everything before the first marker is
    // shared prologue rather than an implicit/default-language block.
    let defaultStartIndex = explicitLanguages.size > 1 ? firstOpenIndex : 0;
    while (
      defaultStartIndex < firstOpenIndex &&
      isSharedPrologueNode(children[defaultStartIndex])
    ) {
      defaultStartIndex += 1;
    }

    const transformed = [];
    transformed.push(...children.slice(0, defaultStartIndex));

    if (defaultStartIndex < firstOpenIndex) {
      transformed.push(
        ...wrapBlock(children.slice(defaultStartIndex, firstOpenIndex), 'default', {
          isDefault: true,
        }),
      );
    }

    let cursor = firstOpenIndex;
    while (cursor < children.length) {
      const lang = getOpenLang(children[cursor]);
      if (!lang) break;

      let nextCloseIndex = cursor + 1;
      while (nextCloseIndex < children.length && !isClose(children[nextCloseIndex])) {
        nextCloseIndex += 1;
      }
      if (nextCloseIndex >= children.length) break;

      transformed.push(
        ...wrapBlock(children.slice(cursor + 1, nextCloseIndex), lang, {
          hidden: true,
        }),
      );

      cursor = nextCloseIndex + 1;
    }

    transformed.push(...children.slice(cursor));
    tree.children = transformed;
  };
}
