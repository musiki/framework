// Pure functions mirrored from trace-margin.ts for Node test runner.

export function segmentParagraphs(markdown) {
  const text = typeof markdown === 'string' ? markdown : '';
  const result = [];
  let index = 0;
  let last = 0;
  const regex = /\n[ \t]*\n|\n---\n/g;
  let match;

  const processPart = (rawPart, partFrom) => {
    const trimmed = rawPart.trim();
    if (!trimmed) return;
    const leadingSpace = rawPart.indexOf(trimmed);
    const from = partFrom + leadingSpace;
    const to = from + trimmed.length;
    const id = btoa(`${index}:${trimmed.slice(0, 40)}`).replace(/=/g, '');
    result.push({ index, text: trimmed, id, from, to });
    index++;
  };

  while ((match = regex.exec(text)) !== null) {
    processPart(text.slice(last, match.index), last);
    last = match.index + match[0].length;
  }
  processPart(text.slice(last), last);
  return result;
}

export function computeOrphanLabels(codes) {
  const counts = new Map();
  for (const c of codes) counts.set(c.label, (counts.get(c.label) ?? 0) + 1);
  return new Set([...counts.entries()].filter(([, n]) => n === 1).map(([l]) => l));
}
