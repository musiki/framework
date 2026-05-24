// src/scripts/course/notes/live-md-editor.ts
// Live-styled markdown editor for db-note panels.
// Keeps markdown marks visible but applies font-size/weight/style decorations in real-time.
// Two separate ViewPlugins (block + inline) so their DecorationSets never conflict.

import {
  EditorView,
  ViewPlugin,
  Decoration,
  type DecorationSet,
  type ViewUpdate,
  keymap,
} from '@codemirror/view';
import { EditorState, RangeSetBuilder } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { markdown } from '@codemirror/lang-markdown';
import { history, historyKeymap, defaultKeymap, cursorDocStart, cursorDocEnd, selectDocStart, selectDocEnd } from '@codemirror/commands';

// ── CSS ───────────────────────────────────────────────────────────────────────

function injectCss() {
  if (document.querySelector('[data-live-md-css]')) return;
  const s = document.createElement('style');
  s.setAttribute('data-live-md-css', '1');
  s.textContent = `
    .cm-lmd-h1  { font-size: 1.55em; font-weight: 700; }
    .cm-lmd-h2  { font-size: 1.28em; font-weight: 700; }
    .cm-lmd-h3  { font-size: 1.1em;  font-weight: 600; }
    .cm-lmd-h46 { font-weight: 600; }
    .cm-lmd-bold   { font-weight: 700; }
    .cm-lmd-italic { font-style: italic; }
    .cm-lmd-code {
      font-family: var(--font-mono, "JetBrains Mono", monospace);
      background: var(--c-bg-mute);
      border-radius: 2px;
      padding: 0 .22em;
      font-size: .88em;
    }
    .cm-lmd-hr    { opacity: .22; letter-spacing: .25em; }
    .cm-lmd-quote { opacity: .62; }
  `;
  document.head.appendChild(s);
}

// ── Decoration maps ───────────────────────────────────────────────────────────

// Block-level nodes — always on distinct lines so never overlap within this set
const BLOCK_NODES: Record<string, string> = {
  ATXHeading1:    'cm-lmd-h1',
  ATXHeading2:    'cm-lmd-h2',
  ATXHeading3:    'cm-lmd-h3',
  ATXHeading4:    'cm-lmd-h46',
  ATXHeading5:    'cm-lmd-h46',
  ATXHeading6:    'cm-lmd-h46',
  SetextHeading1: 'cm-lmd-h1',
  SetextHeading2: 'cm-lmd-h2',
  Blockquote:     'cm-lmd-quote',
  HorizontalRule: 'cm-lmd-hr',
};

// Inline nodes — may nest (e.g. bold inside italic); first-wins on overlap
const INLINE_NODES: Record<string, string> = {
  StrongEmphasis: 'cm-lmd-bold',
  Emphasis:       'cm-lmd-italic',
  InlineCode:     'cm-lmd-code',
};

// ── Plugin factory ────────────────────────────────────────────────────────────

function buildDecos(view: EditorView, nodeClass: Record<string, string>): DecorationSet {
  const { from, to } = view.viewport;
  const marks: { from: number; to: number; cls: string }[] = [];

  syntaxTree(view.state).iterate({
    from, to,
    enter: node => {
      const cls = nodeClass[node.type.name];
      if (cls) marks.push({ from: node.from, to: node.to, cls });
    },
  });

  marks.sort((a, b) => a.from - b.from || a.to - b.to);

  const builder = new RangeSetBuilder<Decoration>();
  let lastTo = -1;
  for (const { from, to, cls } of marks) {
    if (from >= lastTo) {
      builder.add(from, to, Decoration.mark({ class: cls }));
      lastTo = to;
    }
  }
  return builder.finish();
}

function makeDecoPlugin(nodeClass: Record<string, string>) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) { this.decorations = buildDecos(view, nodeClass); }
      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged) this.decorations = buildDecos(u.view, nodeClass);
      }
    },
    { decorations: v => v.decorations },
  );
}

const blockPlugin  = makeDecoPlugin(BLOCK_NODES);
const inlinePlugin = makeDecoPlugin(INLINE_NODES);

// ── Theme ─────────────────────────────────────────────────────────────────────

const liveMdTheme = EditorView.theme({
  '&': { height: '100%', background: 'var(--c-bg)' },
  '.cm-scroller': {
    overflow: 'auto',
    lineHeight: '1.78',
    fontFamily: 'var(--font-sans, system-ui, -apple-system, sans-serif)',
    fontSize: '14px',
  },
  '.cm-content': {
    padding: '1rem 1.2rem',
    caretColor: 'var(--c-link)',
    color: 'var(--c-fg)',
    maxWidth: '72ch',
    margin: '0 auto',
    wordBreak: 'break-word',
  },
  '&.cm-focused .cm-cursor': { borderLeftColor: 'var(--c-link)' },
  '.cm-activeLine': { backgroundColor: 'var(--c-bg-alt, rgba(128,128,128,.04))' },
  '.cm-selectionBackground': { backgroundColor: 'rgba(59,130,246,.14) !important' },
  '&.cm-focused .cm-selectionBackground': { backgroundColor: 'rgba(59,130,246,.22) !important' },
});

// ── Public API ────────────────────────────────────────────────────────────────

export interface LiveMdEditor {
  getContent(): string;
  setContent(content: string): void;
  focus(): void;
  destroy(): void;
  getView(): EditorView;
}

export function createLiveMdEditor(
  container: HTMLElement,
  initialContent: string,
  onSave: (content: string) => void | Promise<void>,
): LiveMdEditor {
  injectCss();

  const state = EditorState.create({
    doc: initialContent,
    extensions: [
      history(),
      keymap.of([
        { key: 'Mod-ArrowUp', run: cursorDocStart },
        { key: 'Mod-ArrowDown', run: cursorDocEnd },
        { key: 'Shift-Mod-ArrowUp', run: selectDocStart },
        { key: 'Shift-Mod-ArrowDown', run: selectDocEnd },
        ...defaultKeymap,
        ...historyKeymap,
        { key: 'Mod-s', run: v => { void onSave(v.state.doc.toString()); return true; } },
      ]),
      markdown(),
      EditorView.lineWrapping,
      blockPlugin,
      inlinePlugin,
      liveMdTheme,
      EditorView.updateListener.of(u => {
        if (u.focusChanged && !u.view.hasFocus) void onSave(u.view.state.doc.toString());
      }),
    ],
  });

  const view = new EditorView({ state, parent: container });

  return {
    getContent:  () => view.state.doc.toString(),
    setContent: (c) => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: c } }),
    focus:      () => view.focus(),
    destroy:    () => view.destroy(),
    getView:    () => view,
  };
}
