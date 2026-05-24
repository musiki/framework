import {
  Compartment,
  EditorSelection,
  EditorState,
  Prec,
  RangeSetBuilder,
  StateEffect,
  StateField,
} from '@codemirror/state';
import { basicSetup } from 'codemirror';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  WidgetType,
  keymap,
  type ViewUpdate,
  placeholder as codeMirrorPlaceholder,
} from '@codemirror/view';
import { markdown } from '@codemirror/lang-markdown';
import { cursorDocStart, cursorDocEnd, selectDocStart, selectDocEnd } from '@codemirror/commands';

type EditorTokenSpan = {
  from: number;
  to: number;
  decoration: Decoration;
  priority: number;
};

type FenceLanguage = 'lily' | 'mermaid';

type FenceState = {
  character: '`' | '~';
  length: number;
  language: '' | FenceLanguage;
};

type FenceDiagnosticState = {
  openBraces: Array<{
    char: string;
    from: number;
  }>;
  openStringFrom: number | null;
};

export type MarkdownCodeMirrorSelection = {
  anchor: number;
  head: number;
};

export type MarkdownCodeMirrorSnapshot = {
  docChanged: boolean;
  selectionChanged: boolean;
  selection: MarkdownCodeMirrorSelection;
  value: string;
};

export type MarkdownCodeMirrorBinding = {
  destroy(): void;
  focus(): void;
  getInteractionSurface(): HTMLElement;
  getHost(): HTMLElement;
  getSelection(): MarkdownCodeMirrorSelection;
  getValue(): string;
  onChange(listener: (snapshot: MarkdownCodeMirrorSnapshot) => void): () => void;
  setEditable(editable: boolean): void;
  setRemoteSelections(
    selections: RemoteCursorState[],
    options?: {
      scrollIntoView?: boolean;
    },
  ): void;
  setValue(
    value: string,
    options?: {
      selection?: MarkdownCodeMirrorSelection;
      scrollIntoView?: boolean;
    },
  ): void;
};

const commentDecoration = Decoration.mark({ class: 'cm-musiki-code-comment' });
const stringDecoration = Decoration.mark({ class: 'cm-musiki-code-string' });
const commandDecoration = Decoration.mark({ class: 'cm-musiki-code-command' });
const schemeDecoration = Decoration.mark({ class: 'cm-musiki-code-scheme' });
const numberDecoration = Decoration.mark({ class: 'cm-musiki-code-number' });
const noteDecoration = Decoration.mark({ class: 'cm-musiki-code-note' });
const symbolDecoration = Decoration.mark({ class: 'cm-musiki-code-symbol' });
const braceDecoration = Decoration.mark({ class: 'cm-musiki-code-brace' });
const fenceDecoration = Decoration.mark({ class: 'cm-musiki-code-fence' });
const unmatchedBraceDecoration = Decoration.mark({
  class: 'cm-musiki-code-brace cm-musiki-code-unmatched',
});
const unmatchedStringDecoration = Decoration.mark({
  class: 'cm-musiki-code-string cm-musiki-code-unmatched',
});

export type RemoteCursorState = {
  anchor: number;
  fill?: string;
  head: number;
  id: string;
  name: string;
  color: string;
  shadow?: string;
  text?: string;
};

class RemoteCursorWidget extends WidgetType {
  constructor(
    public color: string,
    public name: string,
    public fill = color,
    public text = '#ffffff',
    public shadow = '',
  ) {
    super();
  }

  override eq(other: RemoteCursorWidget) {
    return (
      this.color === other.color &&
      this.name === other.name &&
      this.fill === other.fill &&
      this.text === other.text &&
      this.shadow === other.shadow
    );
  }

  override toDOM() {
    const cursor = document.createElement('span');
    cursor.className = 'cm-musiki-remote-cursor';
    cursor.setAttribute('aria-hidden', 'true');
    cursor.style.borderLeftColor = this.color;
    
    if (this.name) {
      const label = document.createElement('span');
      label.className = 'cm-musiki-remote-cursor-label';
      label.textContent = this.name;
      label.style.backgroundColor = this.fill;
      label.style.color = this.text;
      if (this.shadow) label.style.boxShadow = this.shadow;
      cursor.appendChild(label);
    }
    
    return cursor;
  }
}

const setRemoteSelectionsEffect = StateEffect.define<RemoteCursorState[]>();

const buildRemoteSelectionDecorations = (
  selections: RemoteCursorState[],
  state: EditorState,
): DecorationSet => {
  if (!selections || selections.length === 0) return Decoration.none;

  const docLength = state.doc.length;
  const builder = new RangeSetBuilder<Decoration>();
  
  const marks: { from: number; to: number; deco: Decoration }[] = [];
  const widgets: { pos: number; deco: Decoration }[] = [];

  for (const sel of selections) {
    const anchor = Math.max(0, Math.min(Number(sel.anchor) || 0, docLength));
    const head = Math.max(0, Math.min(Number(sel.head) || anchor, docLength));
    const from = Math.min(anchor, head);
    const to = Math.max(anchor, head);

    if (from !== to) {
      marks.push({ 
        from, 
        to, 
        deco: Decoration.mark({ 
          class: 'cm-musiki-remote-selection',
          attributes: { style: `background-color: color-mix(in srgb, ${sel.color} 20%, transparent);` }
        }) 
      });
    }

    const line = state.doc.lineAt(head);
    // We add line background too
    marks.push({
      from: line.from,
      to: line.from,
      deco: Decoration.line({ 
        class: 'cm-musiki-remote-line',
      })
    });

    widgets.push({
      pos: head,
      deco: Decoration.widget({
        widget: new RemoteCursorWidget(sel.color, sel.name, sel.fill, sel.text, sel.shadow),
        side: 1,
      })
    });
  }

  // Sort and build
  marks.sort((a, b) => a.from - b.from || a.to - b.to);
  for (const m of marks) {
    builder.add(m.from, m.to, m.deco);
  }
  
  widgets.sort((a, b) => a.pos - b.pos);
  for (const w of widgets) {
    builder.add(w.pos, w.pos, w.deco);
  }

  return builder.finish();
};

const remoteSelectionField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(decorations, transaction) {
    let nextDecorations = decorations.map(transaction.changes);

    for (const effect of transaction.effects) {
      if (effect.is(setRemoteSelectionsEffect)) {
        nextDecorations = buildRemoteSelectionDecorations(effect.value, transaction.state);
      }
    }

    return nextDecorations;
  },
  provide: (field) => EditorView.decorations.from(field),
});

const lilyLanguages = new Set(['lily', 'lilypond', 'ly', 'scheme', 'guile']);
const mermaidLanguages = new Set(['mermaid']);

const markdownEditorTheme = EditorView.theme({
  '&': {
    height: '100%',
    backgroundColor: 'transparent',
    color: 'inherit',
  },
  '.cm-scroller': {
    fontFamily: 'var(--font-family-mono)',
    minHeight: 'inherit',
  },
  '.cm-content': {
    minHeight: 'inherit',
    padding: '0.7rem 0.8rem',
    caretColor: 'currentColor',
  },
  '.cm-line': {
    padding: '0',
  },
  '.cm-cursor': {
    borderLeftColor: 'currentColor',
  },
  '.cm-selectionBackground, ::selection': {
    backgroundColor: 'color-mix(in srgb, currentColor 14%, transparent)',
  },
  '.cm-gutters': {
    backgroundColor: 'transparent',
    color: 'color-mix(in srgb, currentColor 52%, transparent)',
    borderRight: '1px solid color-mix(in srgb, currentColor 12%, transparent)',
  },
  '.cm-activeLine, .cm-activeLineGutter': {
    backgroundColor: 'color-mix(in srgb, currentColor 4%, transparent)',
  },
  '.cm-foldPlaceholder': {
    backgroundColor: 'color-mix(in srgb, currentColor 8%, transparent)',
    border: 'none',
    color: 'inherit',
  },
  '.cm-placeholder': {
    color: 'color-mix(in srgb, currentColor 46%, transparent)',
  },
  '.cm-musiki-code-comment': {
    color: '#75715e',
    fontStyle: 'italic',
  },
  '.cm-musiki-code-string': {
    color: '#e6db74',
  },
  '.cm-musiki-code-command': {
    color: '#f92672',
    fontWeight: '600',
  },
  '.cm-musiki-code-scheme': {
    color: '#a6e22e',
    fontWeight: '600',
  },
  '.cm-musiki-code-number': {
    color: '#ae81ff',
  },
  '.cm-musiki-code-note': {
    color: '#66d9ef',
    fontWeight: '600',
  },
  '.cm-musiki-code-symbol': {
    color: '#fd971f',
    fontWeight: '600',
  },
  '.cm-musiki-code-brace': {
    color: '#f8f8f2',
  },
  '.cm-musiki-code-fence': {
    color: '#666666',
  },
  '.cm-musiki-remote-line': {
    backgroundColor: 'rgba(86, 196, 255, 0.055)',
  },
  '.cm-musiki-remote-selection': {
    backgroundColor: 'rgba(86, 196, 255, 0.18)',
  },
  '.cm-musiki-remote-cursor': {
    position: 'relative',
    display: 'inline-block',
    width: '0',
    height: '1.18em',
    marginLeft: '-1px',
    marginRight: '-1px',
    borderLeft: '2px solid',
    verticalAlign: 'text-bottom',
    pointerEvents: 'none',
  },
  '.cm-musiki-remote-cursor-label': {
    position: 'absolute',
    top: '-1.4em',
    left: '-2px',
    padding: '0.1rem 0.3rem',
    borderRadius: '0.25rem',
    color: '#fff',
    fontSize: '0.65rem',
    fontWeight: 'bold',
    whiteSpace: 'nowrap',
    lineHeight: '1',
    zIndex: '10',
    boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
  },
});

const fencedCodeHighlighter = ViewPlugin.fromClass(class {
  decorations: DecorationSet;

  constructor(view: EditorView) {
    this.decorations = buildFencedCodeDecorations(view);
  }

  update(update: ViewUpdate): void {
    if (update.docChanged || update.viewportChanged) {
      this.decorations = buildFencedCodeDecorations(update.view);
    }
  }
}, {
  decorations: (plugin) => plugin.decorations,
});

function findCommentStart(lineText: string, marker = '%') {
  let escaped = false;

  for (let index = 0; index < lineText.length; index += 1) {
    const char = lineText[index];

    if (char === '\\' && !escaped) {
      escaped = true;
      continue;
    }

    if (char === marker && !escaped) return index;
    escaped = false;
  }

  return -1;
}

function collectMatches(
  spans: EditorTokenSpan[],
  text: string,
  lineStart: number,
  regex: RegExp,
  decoration: Decoration,
  priority: number,
) {
  regex.lastIndex = 0;
  let match: RegExpExecArray | null = null;

  while ((match = regex.exec(text)) !== null) {
    spans.push({
      from: lineStart + match.index,
      to: lineStart + match.index + match[0].length,
      decoration,
      priority,
    });
  }
}

function applyTokenSpans(spans: EditorTokenSpan[], builder: RangeSetBuilder<Decoration>) {
  const ordered = [...spans].sort((left, right) => {
    if (left.from !== right.from) return left.from - right.from;
    if (left.priority !== right.priority) return left.priority - right.priority;
    return (right.to - right.from) - (left.to - left.from);
  });

  let lastTo = -1;
  for (const span of ordered) {
    if (span.to <= span.from) continue;
    if (span.from < lastTo) continue;
    builder.add(span.from, span.to, span.decoration);
    lastTo = span.to;
  }
}

function highlightLilyLine(lineStart: number, lineText: string) {
  const commentIndex = findCommentStart(lineText, '%');
  const codeText = commentIndex === -1 ? lineText : lineText.slice(0, commentIndex);
  const spans: EditorTokenSpan[] = [];

  if (commentIndex !== -1) {
    spans.push({
      from: lineStart + commentIndex,
      to: lineStart + lineText.length,
      decoration: commentDecoration,
      priority: 6,
    });
  }

  collectMatches(spans, codeText, lineStart, /"(?:[^"\\]|\\.)*"?/g, stringDecoration, 0);
  collectMatches(spans, codeText, lineStart, /\\[A-Za-z][\w-]*/g, commandDecoration, 1);
  collectMatches(
    spans,
    codeText,
    lineStart,
    /##?[tf]\b|#'[A-Za-z][\w-]*|#:[A-Za-z][\w-]*|#\(.*?\)/g,
    schemeDecoration,
    2,
  );
  collectMatches(
    spans,
    codeText,
    lineStart,
    /\b(?:[a-g](?:es|is|eh|ih|s|f)?[,']*\d*\.?(?:\*[\d/]+)?|[rs])\b/gi,
    noteDecoration,
    3,
  );
  collectMatches(spans, codeText, lineStart, /\b[A-Za-z][\w-]*(?=\s*=)/g, symbolDecoration, 4);
  collectMatches(spans, codeText, lineStart, /\b-?\d+(?:\.\d+)?\b/g, numberDecoration, 5);
  collectMatches(spans, codeText, lineStart, /[{}<>\[\]()]/g, braceDecoration, 7);
  return spans;
}

function highlightMermaidLine(lineStart: number, lineText: string) {
  const commentIndex = lineText.indexOf('%%');
  const codeText = commentIndex === -1 ? lineText : lineText.slice(0, commentIndex);
  const spans: EditorTokenSpan[] = [];

  if (commentIndex !== -1) {
    spans.push({
      from: lineStart + commentIndex,
      to: lineStart + lineText.length,
      decoration: commentDecoration,
      priority: 6,
    });
  }

  collectMatches(spans, codeText, lineStart, /"(?:[^"\\]|\\.)*"?/g, stringDecoration, 0);
  collectMatches(
    spans,
    codeText,
    lineStart,
    /\b(?:graph|flowchart|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|gantt|journey|pie|mindmap|timeline|gitGraph|subgraph|end|participant|actor|loop|alt|else|opt|par|and|break|critical|option|section|class|style|linkStyle|click)\b/g,
    commandDecoration,
    1,
  );
  collectMatches(
    spans,
    codeText,
    lineStart,
    /(?:-->|<--|---|==>|<==|-.->|<-\.->|==|:::|:\s)/g,
    schemeDecoration,
    2,
  );
  collectMatches(
    spans,
    codeText,
    lineStart,
    /\b[A-Za-z_][\w-]*(?=\s*\[|\s*\(|\s*\{|\s*=)/g,
    symbolDecoration,
    3,
  );
  collectMatches(spans, codeText, lineStart, /\b-?\d+(?:\.\d+)?\b/g, numberDecoration, 4);
  collectMatches(spans, codeText, lineStart, /[{}<>\[\]()]/g, braceDecoration, 7);
  return spans;
}

function parseFence(lineText: string): FenceState | null {
  const match = lineText.match(/^\s*([`~]{3,})(.*)$/);
  if (!match) return null;

  const rawLanguage = String(match[2] || '')
    .trim()
    .split(/\s+/)[0]
    ?.toLowerCase() || '';

  let language: FenceState['language'] = '';
  if (lilyLanguages.has(rawLanguage)) language = 'lily';
  if (mermaidLanguages.has(rawLanguage)) language = 'mermaid';

  return {
    character: match[1][0] as '`' | '~',
    length: match[1].length,
    language,
  };
}

function isClosingFence(lineText: string, fence: FenceState) {
  return new RegExp(`^\\s*${escapeRegExp(fence.character)}{${fence.length},}\\s*$`).test(lineText);
}

function getFenceLanguageForLine(state: EditorState, targetLineNumber: number): FenceLanguage | null {
  let activeFence: FenceState | null = null;

  for (let lineNumber = 1; lineNumber <= state.doc.lines; lineNumber += 1) {
    const line = state.doc.line(lineNumber);
    const lineText = line.text;

    if (activeFence) {
      if (isClosingFence(lineText, activeFence)) {
        if (lineNumber === targetLineNumber) return null;
        activeFence = null;
        continue;
      }

      if (lineNumber === targetLineNumber) {
        return activeFence.language || null;
      }

      continue;
    }

    const nextFence = parseFence(lineText);
    if (nextFence) {
      if (lineNumber === targetLineNumber) return null;
      activeFence = nextFence.language ? nextFence : null;
      continue;
    }

    if (lineNumber === targetLineNumber) return null;
  }

  return null;
}

function collectSelectedLineNumbers(state: EditorState) {
  const selectedLineNumbers = new Set<number>();

  for (const range of state.selection.ranges) {
    const startLine = state.doc.lineAt(range.from).number;
    const effectiveTo = range.empty ? range.to : Math.max(range.from, range.to - 1);
    const endLine = state.doc.lineAt(effectiveTo).number;

    for (let lineNumber = startLine; lineNumber <= endLine; lineNumber += 1) {
      selectedLineNumbers.add(lineNumber);
    }
  }

  return Array.from(selectedLineNumbers).sort((left, right) => left - right);
}

function toggleLilyLineComment(view: EditorView) {
  const lineNumbers = collectSelectedLineNumbers(view.state);
  if (lineNumbers.length === 0) return false;

  const lines = lineNumbers.map((lineNumber) => ({
    number: lineNumber,
    line: view.state.doc.line(lineNumber),
    language: getFenceLanguageForLine(view.state, lineNumber),
  }));

  if (lines.some(({ language }) => language !== 'lily')) {
    return false;
  }

  const nonBlankLines = lines.filter(({ line }) => line.text.trim().length > 0);
  if (nonBlankLines.length === 0) return true;

  const shouldUncomment = nonBlankLines.every(({ line }) => /^\s*%/.test(line.text));
  const changes: Array<{ from: number; to?: number; insert: string }> = [];

  if (shouldUncomment) {
    for (const { line } of nonBlankLines) {
      const match = line.text.match(/^(\s*)%( ?)/);
      if (!match) continue;
      const from = line.from + match[1].length;
      const markerLength = 1 + (match[2] ? match[2].length : 0);
      changes.push({
        from,
        to: from + markerLength,
        insert: '',
      });
    }
  } else {
    for (const { line } of nonBlankLines) {
      const indentLength = (line.text.match(/^\s*/) || [''])[0].length;
      changes.push({
        from: line.from + indentLength,
        insert: '% ',
      });
    }
  }

  if (changes.length === 0) return true;

  view.dispatch({ changes });
  return true;
}

function buildFencedCodeDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const spans: EditorTokenSpan[] = [];
  let activeFence: FenceState | null = null;
  let activeDiagnostics: FenceDiagnosticState | null = null;

  for (let lineNumber = 1; lineNumber <= view.state.doc.lines; lineNumber += 1) {
    const line = view.state.doc.line(lineNumber);
    const lineText = line.text;

    if (activeFence) {
      if (isClosingFence(lineText, activeFence)) {
        spans.push({
          from: line.from,
          to: line.to,
          decoration: fenceDecoration,
          priority: 9,
        });
        flushFenceDiagnostics(activeDiagnostics, spans);
        activeFence = null;
        activeDiagnostics = null;
        continue;
      }

      if (activeFence.language === 'lily') {
        spans.push(...highlightLilyLine(line.from, lineText));
        scanFenceDiagnostics(line.from, lineText, activeFence.language, activeDiagnostics, spans);
      } else if (activeFence.language === 'mermaid') {
        spans.push(...highlightMermaidLine(line.from, lineText));
        scanFenceDiagnostics(line.from, lineText, activeFence.language, activeDiagnostics, spans);
      }
      continue;
    }

    const nextFence = parseFence(lineText);
    if (nextFence) {
      spans.push({
        from: line.from,
        to: line.to,
        decoration: fenceDecoration,
        priority: 9,
      });
      if (nextFence.language) {
        activeFence = nextFence;
        activeDiagnostics = {
          openBraces: [],
          openStringFrom: null,
        };
      } else {
        activeFence = null;
        activeDiagnostics = null;
      }
    }
  }

  flushFenceDiagnostics(activeDiagnostics, spans);
  applyTokenSpans(spans, builder);
  return builder.finish();
}

function scanFenceDiagnostics(
  lineStart: number,
  lineText: string,
  language: FenceLanguage,
  diagnostics: FenceDiagnosticState | null,
  spans: EditorTokenSpan[],
) {
  if (!diagnostics) return;

  const commentMarker = language === 'mermaid' ? '%%' : '%';
  const bracePairs = language === 'lily'
    ? new Map([
      ['{', '}'],
    ])
    : new Map([
      ['(', ')'],
      ['[', ']'],
      ['{', '}'],
    ]);
  const closingBraces = new Map(Array.from(bracePairs.entries()).map(([open, close]) => [close, open]));
  let escaped = false;

  for (let index = 0; index < lineText.length; index += 1) {
    const char = lineText[index];
    const nextComment = lineText.slice(index, index + commentMarker.length);

    if (diagnostics.openStringFrom === null && !escaped && nextComment === commentMarker) {
      break;
    }

    if (char === '\\' && !escaped) {
      escaped = true;
      continue;
    }

    if (char === '"' && !escaped) {
      diagnostics.openStringFrom = diagnostics.openStringFrom === null ? lineStart + index : null;
      continue;
    }

    if (diagnostics.openStringFrom !== null) {
      escaped = false;
      continue;
    }

    if (bracePairs.has(char)) {
      diagnostics.openBraces.push({
        char,
        from: lineStart + index,
      });
      escaped = false;
      continue;
    }

    if (closingBraces.has(char)) {
      const expectedOpen = closingBraces.get(char);
      const lastOpen = diagnostics.openBraces[diagnostics.openBraces.length - 1];
      if (lastOpen && lastOpen.char === expectedOpen) {
        diagnostics.openBraces.pop();
      } else {
        spans.push({
          from: lineStart + index,
          to: lineStart + index + 1,
          decoration: unmatchedBraceDecoration,
          priority: -1,
        });
      }
      escaped = false;
      continue;
    }

    escaped = false;
  }
}

function flushFenceDiagnostics(
  diagnostics: FenceDiagnosticState | null,
  spans: EditorTokenSpan[],
) {
  if (!diagnostics) return;

  if (diagnostics.openStringFrom !== null) {
    spans.push({
      from: diagnostics.openStringFrom,
      to: diagnostics.openStringFrom + 1,
      decoration: unmatchedStringDecoration,
      priority: -1,
    });
  }

  for (const openBrace of diagnostics.openBraces) {
    spans.push({
      from: openBrace.from,
      to: openBrace.from + 1,
      decoration: unmatchedBraceDecoration,
      priority: -1,
    });
  }
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function resolveEditorVariant(textarea: HTMLTextAreaElement) {
  if (textarea.classList.contains('forum-textarea')) return 'forum';
  if (textarea.classList.contains('editor-textarea')) return 'editor';
  return 'default';
}

export function enhanceMarkdownCodeMirror(textarea: HTMLTextAreaElement): MarkdownCodeMirrorBinding | null {
  if (!(textarea instanceof HTMLTextAreaElement)) return null;
  if (textarea.dataset.markdownCodeMirrorEnhanced === 'true') return null;

  const host = document.createElement('div');
  const editabilityCompartment = new Compartment();
  const variant = resolveEditorVariant(textarea);
  const originalClassName = textarea.className;
  const originalHidden = textarea.hidden;
  const changeListeners = new Set<(snapshot: MarkdownCodeMirrorSnapshot) => void>();
  host.className = `musiki-codemirror-host musiki-codemirror-host--${variant}`;
  host.dataset.editorVariant = variant;

  textarea.insertAdjacentElement('afterend', host);

  let isApplyingExternalValue = false;
  let isMirroringToTextarea = false;

  const view = new EditorView({
    state: EditorState.create({
      doc: textarea.value || '',
      extensions: [
        Prec.highest(
          keymap.of([
            {
              key: 'Mod-/',
              run: toggleLilyLineComment,
            },
            {
              key: 'Mod-ArrowUp',
              run: cursorDocStart,
            },
            {
              key: 'Mod-ArrowDown',
              run: cursorDocEnd,
            },
            {
              key: 'Shift-Mod-ArrowUp',
              run: selectDocStart,
            },
            {
              key: 'Shift-Mod-ArrowDown',
              run: selectDocEnd,
            },
          ]),
        ),
        basicSetup,
        markdown(),
        remoteSelectionField,
        editabilityCompartment.of([
          EditorState.readOnly.of(false),
          EditorView.editable.of(true),
        ]),
        EditorView.lineWrapping,
        markdownEditorTheme,
        fencedCodeHighlighter,
        codeMirrorPlaceholder(textarea.getAttribute('placeholder') || ''),
        EditorView.contentAttributes.of({
          spellcheck: 'false',
          autocorrect: 'off',
          autocapitalize: 'off',
          'data-gramm': 'false',
        }),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged || isApplyingExternalValue) return;

          const nextValue = update.state.doc.toString();
          if (textarea.value === nextValue) return;

          isMirroringToTextarea = true;
          textarea.value = nextValue;
          textarea.dispatchEvent(new Event('input', { bubbles: true }));
          queueMicrotask(() => {
            isMirroringToTextarea = false;
          });
        }),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged && !update.selectionSet) return;

          const snapshot: MarkdownCodeMirrorSnapshot = {
            docChanged: update.docChanged,
            selectionChanged: update.selectionSet,
            selection: {
              anchor: update.state.selection.main.anchor,
              head: update.state.selection.main.head,
            },
            value: update.state.doc.toString(),
          };

          changeListeners.forEach((listener) => {
            listener(snapshot);
          });
        }),
      ],
    }),
    parent: host,
  });

  const syncFromTextarea = () => {
    if (isMirroringToTextarea) return;

    const nextValue = textarea.value || '';
    const currentValue = view.state.doc.toString();
    if (nextValue === currentValue) return;

    isApplyingExternalValue = true;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: nextValue },
      selection: EditorSelection.range(
        Math.min(textarea.selectionStart ?? nextValue.length, nextValue.length),
        Math.min(textarea.selectionEnd ?? nextValue.length, nextValue.length),
      ),
    });
    isApplyingExternalValue = false;
  };

  const syncSelectionToCodeMirror = () => {
    if (document.activeElement !== textarea) return;
    const anchor = Math.min(textarea.selectionStart ?? 0, view.state.doc.length);
    const head = Math.min(textarea.selectionEnd ?? anchor, view.state.doc.length);
    view.dispatch({ selection: EditorSelection.range(anchor, head) });
    view.focus();
  };

  textarea.addEventListener('input', syncFromTextarea);
  textarea.addEventListener('focus', syncSelectionToCodeMirror);
  textarea.addEventListener('click', syncSelectionToCodeMirror);
  textarea.addEventListener('keyup', syncSelectionToCodeMirror);

  textarea.dataset.markdownCodeMirrorEnhanced = 'true';
  textarea.classList.remove(
    'forum-textarea',
    'forum-edit-textarea',
    'forum-editor-input',
    'editor-textarea',
    'editor-input',
  );
  textarea.classList.add('is-codemirror-hidden');
  textarea.hidden = true;
  textarea.setAttribute('aria-hidden', 'true');
  textarea.tabIndex = -1;

  return {
    destroy() {
      changeListeners.clear();
      textarea.removeEventListener('input', syncFromTextarea);
      textarea.removeEventListener('focus', syncSelectionToCodeMirror);
      textarea.removeEventListener('click', syncSelectionToCodeMirror);
      textarea.removeEventListener('keyup', syncSelectionToCodeMirror);
      textarea.className = originalClassName;
      textarea.classList.remove('is-codemirror-hidden');
      textarea.hidden = originalHidden;
      textarea.removeAttribute('aria-hidden');
      textarea.tabIndex = 0;
      delete textarea.dataset.markdownCodeMirrorEnhanced;
      view.destroy();
      host.remove();
    },
    focus() {
      view.focus();
    },
    getInteractionSurface() {
      return view.dom;
    },
    getHost() {
      return host;
    },
    getSelection() {
      return {
        anchor: view.state.selection.main.anchor,
        head: view.state.selection.main.head,
      };
    },
    getValue() {
      return view.state.doc.toString();
    },
    onChange(listener) {
      changeListeners.add(listener);
      return () => {
        changeListeners.delete(listener);
      };
    },
    setEditable(editable) {
      host.dataset.readonly = editable ? 'false' : 'true';
      view.dispatch({
        effects: editabilityCompartment.reconfigure([
          EditorState.readOnly.of(!editable),
          EditorView.editable.of(editable),
        ]),
      });
    },
    setRemoteSelections(selections, options = {}) {
      const effects: Array<StateEffect<unknown>> = [
        setRemoteSelectionsEffect.of(selections),
      ];

      if (options.scrollIntoView !== false && selections.length > 0) {
        effects.push(EditorView.scrollIntoView(Math.max(0, Math.min(selections[0].head, view.state.doc.length)), {
          y: 'center',
          yMargin: 48,
        }));
      }

      view.dispatch({ effects });
    },
    setValue(value, options = {}) {
      const nextValue = String(value || '');
      const selection = options.selection ?? {
        anchor: Math.min(view.state.selection.main.anchor, nextValue.length),
        head: Math.min(view.state.selection.main.head, nextValue.length),
      };
      const effects: Array<StateEffect<unknown>> = [];

      if (options.scrollIntoView !== false) {
        effects.push(EditorView.scrollIntoView(Math.max(0, Math.min(selection.head, nextValue.length)), {
          y: 'center',
          yMargin: 48,
        }));
      }

      textarea.value = nextValue;
      textarea.selectionStart = Math.max(0, Math.min(selection.anchor, nextValue.length));
      textarea.selectionEnd = Math.max(0, Math.min(selection.head, nextValue.length));

      isApplyingExternalValue = true;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: nextValue },
        selection: EditorSelection.range(
          Math.max(0, Math.min(selection.anchor, nextValue.length)),
          Math.max(0, Math.min(selection.head, nextValue.length)),
        ),
        effects,
      });
      isApplyingExternalValue = false;
    },
  };
}
