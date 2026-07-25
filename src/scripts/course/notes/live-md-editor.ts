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
import { EditorState, RangeSetBuilder, StateEffect, StateField } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import { markdown } from '@codemirror/lang-markdown';
import { history, historyKeymap, defaultKeymap, cursorDocStart, cursorDocEnd, selectDocStart, selectDocEnd } from '@codemirror/commands';
import { markdownFormattingKeymap } from './markdown-shortcuts.ts';
import { seshatCitationAutocomplete } from '../../seshat-citations.ts';

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
    fontSize: '16.1px',
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

export const setAnnotationsEffect = StateEffect.define<Array<{ id: string; from: number; to: number; color?: string }>>();

export const annotationsField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(value, tr) {
    value = value.map(tr.changes);
    for (const effect of tr.effects) {
      if (effect.is(setAnnotationsEffect)) {
        const builder = new RangeSetBuilder<Decoration>();
        const sorted = [...effect.value].sort((a, b) => a.from - b.from);
        for (const ann of sorted) {
          if (ann.from < ann.to) {
            const colorClass = ann.color ? ` annotation-highlight--${ann.color}` : '';
            builder.add(ann.from, ann.to, Decoration.mark({
              class: `annotation-highlight${colorClass}`,
              attributes: { 'data-annotation-id': ann.id }
            }));
          }
        }
        value = builder.finish();
      }
    }
    return value;
  },
  provide: f => EditorView.decorations.from(f)
});

export interface LiveMdEditor {
  getContent(): string;
  setContent(content: string): void;
  focus(): void;
  destroy(): void;
  getView(): EditorView;
  setAnnotations(annotations: Array<{ id: string; from: number; to: number; color?: string }>): void;
}

export function createLiveMdEditor(
  container: HTMLElement,
  initialContent: string,
  onSave: (content: string) => void | Promise<void>,
  options?: { readOnly?: boolean }
): LiveMdEditor {
  injectCss();
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  const flushSave = (content: string) => {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    void onSave(content);
  };

  const scheduleSave = (content: string) => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      void onSave(content);
    }, 900);
  };

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
        { key: 'Mod-s', run: v => { flushSave(v.state.doc.toString()); return true; } },
      ]),
      markdown(),
      seshatCitationAutocomplete(),
      markdownFormattingKeymap(),
      EditorView.lineWrapping,
      blockPlugin,
      inlinePlugin,
      liveMdTheme,
      annotationsField,
      options?.readOnly ? EditorState.readOnly.of(true) : [],
      options?.readOnly ? EditorView.editable.of(false) : [],
      EditorView.domEventHandlers({
        click(event, view) {
          const target = event.target as HTMLElement;
          const highlight = target.closest('.annotation-highlight');
          if (highlight) {
            const annotationId = highlight.getAttribute('data-annotation-id');
            if (annotationId) {
              view.dom.dispatchEvent(new CustomEvent('annotation-clicked', {
                detail: { annotationId },
                bubbles: true
              }));
              return true;
            }
          }
          return false;
        },
        paste(event, view) {
          const items = (event as ClipboardEvent).clipboardData?.items;
          if (!items) return false;
          const imageItem = Array.from(items).find(i => i.type.startsWith('image/'));
          if (!imageItem) return false;
          const file = imageItem.getAsFile();
          if (!file) return false;
          event.preventDefault();

          const selection = view.state.selection.main;
          const placeholder = `![Subiendo imagen...](${file.name || 'image.png'})`;

          view.dispatch({
            changes: { from: selection.from, to: selection.to, insert: placeholder },
            selection: { anchor: selection.from + placeholder.length }
          });

          const formData = new FormData();
          formData.append('file', file, file.name || 'image.png');

          fetch('/api/forum/upload-image', { method: 'POST', body: formData })
            .then(res => {
              if (!res.ok) throw new Error('Upload failed');
              return res.json();
            })
            .then(data => {
              const url = data.url || '';
              if (!url) throw new Error('No URL in response');

              const currentDoc = view.state.doc.toString();
              const idx = currentDoc.indexOf(placeholder);
              if (idx !== -1) {
                view.dispatch({
                  changes: { from: idx, to: idx + placeholder.length, insert: `![](${url})` }
                });
              } else {
                const sel = view.state.selection.main;
                view.dispatch({
                  changes: { from: sel.from, to: sel.to, insert: `![](${url})` }
                });
              }
            })
            .catch(err => {
              console.error('Image paste upload failed:', err);
              const currentDoc = view.state.doc.toString();
              const idx = currentDoc.indexOf(placeholder);
              if (idx !== -1) {
                view.dispatch({
                  changes: { from: idx, to: idx + placeholder.length, insert: `![Error al subir imagen](${file.name || 'image.png'})` }
                });
              }
            });
          return true;
        }
      }),
      EditorView.updateListener.of(u => {
        if (u.docChanged) scheduleSave(u.view.state.doc.toString());
        if (u.focusChanged && !u.view.hasFocus) flushSave(u.view.state.doc.toString());
        if (u.selectionSet) {
          u.view.dom.dispatchEvent(new CustomEvent('editor-selection-changed', {
            bubbles: true
          }));
        }
      }),
    ],
  });

  const view = new EditorView({ state, parent: container });

  return {
    getContent:  () => view.state.doc.toString(),
    setContent: (c) => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: c } }),
    focus:      () => view.focus(),
    destroy:    () => {
      if (saveTimer) flushSave(view.state.doc.toString());
      view.destroy();
    },
    getView:    () => view,
    setAnnotations: (anns) => view.dispatch({ effects: setAnnotationsEffect.of(anns) })
  };
}
