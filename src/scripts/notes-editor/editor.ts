import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { history, historyKeymap, defaultKeymap, cursorDocStart, cursorDocEnd, selectDocStart, selectDocEnd } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
import { markdownFormattingKeymap } from '../course/notes/markdown-shortcuts.ts';

let view: EditorView | null = null;

const musikiTheme = EditorView.theme({
  '&': { height: '100%', fontSize: '12px', fontFamily: '"JetBrains Mono", "Fira Code", monospace', background: 'var(--c-bg)' },
  '.cm-scroller': { overflow: 'auto', lineHeight: '1.8' },
  '.cm-content': { padding: '.6rem .9rem', caretColor: 'var(--c-link)', color: 'var(--c-fg)' },
  '&.cm-focused .cm-cursor': { borderLeftColor: 'var(--c-link)' },
  '.cm-activeLine': { backgroundColor: 'var(--c-bg-alt,var(--c-bg-mute))' },
  '.cm-gutters': { backgroundColor: 'var(--c-bg-surface,var(--c-bg-mute))', borderRight: '1px solid var(--c-border)', color: 'var(--c-fg-subtle)' },
  '.cm-lineNumbers .cm-gutterElement': { color: 'var(--c-fg-subtle)', minWidth: '2.5em' },
  '.cm-selectionBackground': { backgroundColor: 'var(--c-bg-alt,var(--c-bg-mute)) !important' },
});

export function createEditor(container: HTMLElement, initialContent: string, onChange: () => void): EditorView {
  const state = EditorState.create({
    doc: initialContent,
    extensions: [
      lineNumbers(),
      history(),
      markdownFormattingKeymap(),
      keymap.of([
        { key: 'Mod-ArrowUp', run: cursorDocStart },
        { key: 'Mod-ArrowDown', run: cursorDocEnd },
        { key: 'Shift-Mod-ArrowUp', run: selectDocStart },
        { key: 'Shift-Mod-ArrowDown', run: selectDocEnd },
        ...defaultKeymap, 
        ...historyKeymap,
      ]),
      markdown(),
      syntaxHighlighting(defaultHighlightStyle),
      EditorView.lineWrapping,
      musikiTheme,
      EditorView.updateListener.of(update => {
        if (update.docChanged || update.selectionSet) onChange();
      }),
    ],
  });

  view = new EditorView({ state, parent: container });
  return view;
}

export function getEditorContent(): string {
  return view?.state.doc.toString() ?? '';
}

export function setEditorContent(content: string) {
  if (!view) return;
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: content },
  });
}

export function insertAtCursor(snippet: string) {
  if (!view) return;
  const { from, to } = view.state.selection.main;
  view.dispatch({
    changes: { from, to, insert: snippet },
    selection: { anchor: from + snippet.length },
  });
  view.focus();
}

export function isInsideEvalBlock(): boolean {
  if (!view) return false;
  const state = view.state;
  const pos = state.selection.main.head;
  const doc = state.doc;
  const curLine = doc.lineAt(pos).number;

  let foundOpen = false;
  for (let i = curLine; i >= 1; i--) {
    const text = doc.line(i).text.trim();
    if (text === '```') return false;
    if (text === '```eval') { foundOpen = true; break; }
  }
  if (!foundOpen) return false;

  const totalLines = doc.lines;
  for (let i = curLine + 1; i <= totalLines; i++) {
    const text = doc.line(i).text.trim();
    if (text === '```') return true;
  }
  return false;
}

export function destroyEditor() {
  view?.destroy();
  view = null;
}
