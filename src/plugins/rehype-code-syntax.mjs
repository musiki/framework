import { visit } from 'unist-util-visit';

function getNodeText(node) {
  if (!node) return '';
  if (node.type === 'text') return String(node.value || '');
  if (!Array.isArray(node.children)) return '';
  return node.children.map((child) => getNodeText(child)).join('');
}

function normalizeClassNames(value) {
  if (Array.isArray(value)) return value.map((entry) => String(entry || ''));
  if (typeof value === 'string') return value.split(/\s+/).filter(Boolean);
  return [];
}

function createTextNode(value) {
  return { type: 'text', value };
}

function createSpanNode(className, value) {
  return {
    type: 'element',
    tagName: 'span',
    properties: { className: [className] },
    children: [createTextNode(value)],
  };
}

function findCommentStart(lineText, marker = '%') {
  let escaped = false;

  for (let index = 0; index < lineText.length; index += 1) {
    const char = lineText[index];

    if (char === '\\' && !escaped) {
      escaped = true;
      continue;
    }

    if (char === marker && !escaped) {
      return index;
    }

    escaped = false;
  }

  return -1;
}

function collectMatches(spans, text, regex, className, priority) {
  let match;
  regex.lastIndex = 0;

  while ((match = regex.exec(text)) !== null) {
    spans.push({
      from: match.index,
      to: match.index + match[0].length,
      className,
      priority,
    });
  }
}

function selectNonOverlappingSpans(spans) {
  const ordered = [...spans].sort((left, right) => {
    if (left.from !== right.from) return left.from - right.from;
    if (left.priority !== right.priority) return left.priority - right.priority;
    return (right.to - right.from) - (left.to - left.from);
  });

  const selected = [];
  let lastTo = -1;

  for (const span of ordered) {
    if (span.to <= span.from) continue;
    if (span.from < lastTo) continue;
    selected.push(span);
    lastTo = span.to;
  }

  return selected;
}

function buildLineNodes(lineText, spans) {
  const nodes = [];
  let cursor = 0;

  for (const span of spans) {
    if (span.from > cursor) {
      nodes.push(createTextNode(lineText.slice(cursor, span.from)));
    }

    nodes.push(createSpanNode(span.className, lineText.slice(span.from, span.to)));
    cursor = span.to;
  }

  if (cursor < lineText.length) {
    nodes.push(createTextNode(lineText.slice(cursor)));
  }

  if (nodes.length === 0) {
    nodes.push(createTextNode(''));
  }

  return nodes;
}

function highlightLilyLine(lineText) {
  const commentIndex = findCommentStart(lineText, '%');
  const codeText = commentIndex === -1 ? lineText : lineText.slice(0, commentIndex);
  const spans = [];

  if (commentIndex !== -1) {
    spans.push({
      from: commentIndex,
      to: lineText.length,
      className: 'musiki-code-comment',
      priority: 6,
    });
  }

  collectMatches(spans, codeText, /"(?:[^"\\]|\\.)*"?/g, 'musiki-code-string', 0);
  collectMatches(spans, codeText, /\\[A-Za-z][\w-]*/g, 'musiki-code-command', 1);
  collectMatches(spans, codeText, /##?[tf]\b|#'[A-Za-z][\w-]*|#:[A-Za-z][\w-]*/g, 'musiki-code-scheme', 2);
  collectMatches(spans, codeText, /\b[a-g](?:es|is|eh|ih|s|f)?[,']*\d*\.?(?:\*[\d/]+)?\b/gi, 'musiki-code-note', 3);
  collectMatches(spans, codeText, /\b[A-Za-z][\w-]*(?=\s*=)/g, 'musiki-code-symbol', 4);
  collectMatches(spans, codeText, /\b-?\d+(?:\.\d+)?\b/g, 'musiki-code-number', 5);
  collectMatches(spans, codeText, /[{}<>\[\]()]/g, 'musiki-code-brace', 7);

  return buildLineNodes(lineText, selectNonOverlappingSpans(spans));
}

function highlightMermaidLine(lineText) {
  const commentIndex = lineText.indexOf('%%');
  const codeText = commentIndex === -1 ? lineText : lineText.slice(0, commentIndex);
  const spans = [];

  if (commentIndex !== -1) {
    spans.push({
      from: commentIndex,
      to: lineText.length,
      className: 'musiki-code-comment',
      priority: 6,
    });
  }

  collectMatches(spans, codeText, /"(?:[^"\\]|\\.)*"?/g, 'musiki-code-string', 0);
  collectMatches(
    spans,
    codeText,
    /\b(?:graph|flowchart|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|gantt|journey|pie|mindmap|timeline|gitGraph|subgraph|end|participant|actor|loop|alt|else|opt|par|and|break|critical|option|section|class|style|linkStyle|click)\b/g,
    'musiki-code-command',
    1,
  );
  collectMatches(spans, codeText, /(?:-->|<--|---|==>|<==|-.->|<-\.->|==|:::|:\s)/g, 'musiki-code-scheme', 2);
  collectMatches(spans, codeText, /\b[A-Za-z_][\w-]*(?=\s*\[|\s*\(|\s*\{|\s*=)/g, 'musiki-code-symbol', 3);
  collectMatches(spans, codeText, /\b-?\d+(?:\.\d+)?\b/g, 'musiki-code-number', 4);
  collectMatches(spans, codeText, /[{}<>\[\]()/|]/g, 'musiki-code-brace', 7);

  return buildLineNodes(lineText, selectNonOverlappingSpans(spans));
}

function highlightCodeText(source, language) {
  const lines = String(source || '').split('\n');
  const nodes = [];

  lines.forEach((lineText, index) => {
    const lineNodes =
      language === 'mermaid'
        ? highlightMermaidLine(lineText)
        : highlightLilyLine(lineText);
    nodes.push(...lineNodes);
    if (index < lines.length - 1) {
      nodes.push(createTextNode('\n'));
    }
  });

  return nodes;
}

function resolveCodeLanguage(codeNode) {
  const classNames = normalizeClassNames(codeNode?.properties?.className);
  for (const className of classNames) {
    if (['language-lily', 'language-lilypond', 'language-ly'].includes(className)) return 'lily';
    if (['language-mermaid', 'lang-mermaid'].includes(className)) return 'mermaid';
  }
  return '';
}

export default function rehypeCodeSyntax() {
  return (tree) => {
    visit(tree, 'element', (node, index, parent) => {
      if (!parent || typeof index !== 'number') return;
      if (node.tagName !== 'pre') return;

      const codeNode = Array.isArray(node.children)
        ? node.children.find((child) => child?.type === 'element' && child.tagName === 'code')
        : null;
      if (!codeNode || codeNode.type !== 'element') return;

      const language = resolveCodeLanguage(codeNode);
      if (!language) return;

      const source = getNodeText(codeNode);
      codeNode.children = highlightCodeText(source, language);

      const preClasses = new Set(normalizeClassNames(node.properties?.className));
      preClasses.add('musiki-code-block');
      preClasses.add(`musiki-code-block--${language}`);
      node.properties = {
        ...(node.properties || {}),
        className: Array.from(preClasses),
      };
    });
  };
}
