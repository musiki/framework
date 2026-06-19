import type { Extension } from '@codemirror/state';
import { keymap, type KeyBinding, type EditorView } from '@codemirror/view';

function expandEmptySelectionToWord(view: EditorView, from: number, to: number): { from: number; to: number } {
  if (from !== to) return { from, to };
  const doc = view.state.doc.toString();
  let start = from;
  let end = to;
  while (start > 0 && /[\p{L}\p{N}_-]/u.test(doc.slice(start - 1, start))) start -= 1;
  while (end < doc.length && /[\p{L}\p{N}_-]/u.test(doc.slice(end, end + 1))) end += 1;
  return { from: start, to: end };
}

function toggleSurround(marker: '*' | '**') {
  return (view: EditorView): boolean => {
    const doc = view.state.doc;
    const markerLength = marker.length;
    const ranges = view.state.selection.ranges
      .map(range => expandEmptySelectionToWord(view, range.from, range.to))
      .sort((a, b) => b.from - a.from);
    const changes: { from: number; to: number; insert: string }[] = [];

    for (const range of ranges) {
      const selected = doc.sliceString(range.from, range.to);
      const before = range.from >= markerLength ? doc.sliceString(range.from - markerLength, range.from) : '';
      const after = range.to + markerLength <= doc.length ? doc.sliceString(range.to, range.to + markerLength) : '';

      if (selected.startsWith(marker) && selected.endsWith(marker) && selected.length >= markerLength * 2) {
        changes.push({
          from: range.from,
          to: range.to,
          insert: selected.slice(markerLength, selected.length - markerLength),
        });
        continue;
      }

      if (before === marker && after === marker) {
        changes.push({ from: range.to, to: range.to + markerLength, insert: '' });
        changes.push({ from: range.from - markerLength, to: range.from, insert: '' });
        continue;
      }

      changes.push({
        from: range.from,
        to: range.to,
        insert: `${marker}${selected}${marker}`,
      });
    }

    if (!changes.length) return false;
    view.dispatch({ changes });
    return true;
  };
}

function headingText(lineText: string, level: 1 | 2 | 3 | 4, remove: boolean): string {
  const indent = lineText.match(/^\s*/)?.[0] ?? '';
  const withoutIndent = lineText.slice(indent.length);
  const content = withoutIndent.replace(/^#{1,6}\s+/, '');
  if (remove) return `${indent}${content}`;
  return `${indent}${'#'.repeat(level)} ${content}`;
}

function toggleHeading(level: 1 | 2 | 3 | 4) {
  return (view: EditorView): boolean => {
    const doc = view.state.doc;
    const ranges = view.state.selection.ranges;
    const lineNumbers = new Set<number>();
    for (const range of ranges) {
      const startLine = doc.lineAt(range.from);
      const endLine = doc.lineAt(Math.max(range.from, range.to - 1));
      for (let lineNo = startLine.number; lineNo <= endLine.number; lineNo += 1) {
        lineNumbers.add(lineNo);
      }
    }

    const lines = [...lineNumbers].sort((a, b) => a - b).map(lineNo => doc.line(lineNo));
    if (!lines.length) return false;
    const prefixRe = new RegExp(`^\\s*#{${level}}\\s+`);
    const remove = lines.every(line => prefixRe.test(line.text));
    const changes = lines
      .map(line => ({
        from: line.from,
        to: line.to,
        insert: headingText(line.text, level, remove),
      }))
      .filter(change => doc.sliceString(change.from, change.to) !== change.insert);

    if (!changes.length) return false;
    view.dispatch({ changes });
    return true;
  };
}

export function markdownFormattingKeymap(): Extension {
  const bindings: KeyBinding[] = [
    { key: 'Mod-b', run: toggleSurround('**') },
    { key: 'Mod-i', run: toggleSurround('*') },
    { key: 'Mod-Alt-1', run: toggleHeading(1) },
    { key: 'Mod-Alt-2', run: toggleHeading(2) },
    { key: 'Mod-Alt-3', run: toggleHeading(3) },
    { key: 'Mod-Alt-4', run: toggleHeading(4) },
  ];
  return keymap.of(bindings);
}
