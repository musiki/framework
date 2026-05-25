import {
  Compartment, StateEffect, StateField, RangeSetBuilder,
} from '@codemirror/state';
import {
  EditorView, ViewPlugin, Decoration,
  type DecorationSet, type ViewUpdate,
} from '@codemirror/view';
import { computeFrequency, computeKwic, computeZipfProfile } from '../../notas/qa-analyzer-logic';

// ── Types ──────────────────────────────────────────────────────────────────

export type TraceCode = {
  id: string;
  noteId: string;
  paraIndex: number;
  label: string;
  dimension: 'thematic' | 'rhetorical' | 'emergent' | 'manual';
  source: 'manual' | 'local_nlp' | 'ai_suggested' | 'ai_confirmed';
  confidence: number;
};

type Paragraph = {
  index: number;
  text: string;
  id: string;
  from: number;
  to: number;
};

export interface TraceMarginHandle {
  destroy(): void;
}

type MonitorSectionKey = 'trace' | 'lexico' | 'zipf' | 'qa';

type MonitorState = {
  open: Record<MonitorSectionKey, boolean>;
  lexicalQuery: string;
  activeParagraph: number | null;
  visibleParagraphs: Set<number>;
};

// ── Pure functions (mirrored in trace-utils.mjs for testing) ───────────────

export function segmentParagraphs(markdown: string): Paragraph[] {
  const result: Paragraph[] = [];
  let index = 0;
  let last = 0;
  const regex = /\n[ \t]*\n|\n---\n/g;
  let match: RegExpExecArray | null;

  const processPart = (rawPart: string, partFrom: number) => {
    const trimmed = rawPart.trim();
    if (!trimmed) return;
    const leadingSpace = rawPart.indexOf(trimmed);
    const from = partFrom + leadingSpace;
    const to = from + trimmed.length;
    const id = btoa(`${index}:${trimmed.slice(0, 40)}`).replace(/=/g, '');
    result.push({ index, text: trimmed, id, from, to });
    index++;
  };

  while ((match = regex.exec(markdown)) !== null) {
    processPart(markdown.slice(last, match.index), last);
    last = match.index + match[0].length;
  }
  processPart(markdown.slice(last), last);
  return result;
}

export function computeOrphanLabels(codes: TraceCode[]): Set<string> {
  const counts = new Map<string, number>();
  for (const c of codes) counts.set(c.label, (counts.get(c.label) ?? 0) + 1);
  return new Set([...counts.entries()].filter(([, n]) => n === 1).map(([l]) => l));
}

export function resolveParagraphIndex(paras: Paragraph[], position: number): number | null {
  if (!paras.length) return null;
  let nearest = paras[0];
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const para of paras) {
    if (position >= para.from && position <= para.to) return para.index;
    const distance = position < para.from ? para.from - position : position - para.to;
    if (distance < nearestDistance) {
      nearest = para;
      nearestDistance = distance;
    }
  }
  return nearest.index;
}

export function collectParagraphIndicesInRange(paras: Paragraph[], from: number, to: number): Set<number> {
  return new Set(paras
    .filter(para => para.to >= from && para.from <= to)
    .map(para => para.index));
}

// ── NLP auto-suggestions ───────────────────────────────────────────────────

export type TraceSuggestion = { label: string; paraIndex: number };

const MIN_KEYWORD_LEN = 4;
const TOP_KEYWORDS_PER_PARA = 5;

const STOPWORDS = new Set([
  'para', 'como', 'pero', 'más', 'con', 'que', 'una', 'uno', 'los', 'las',
  'del', 'este', 'esta', 'esto', 'desde', 'hasta', 'sobre', 'entre', 'cuando',
  'donde', 'puede', 'tiene', 'también', 'además', 'porque', 'aunque', 'según',
  'todos', 'todas', 'todo', 'bien', 'hacer', 'tener', 'haber', 'siendo', 'están',
  'estar', 'había', 'será', 'mismo', 'misma', 'mismos', 'mismas', 'ante', 'bajo',
  'cada', 'casi', 'cierto', 'contra', 'cual', 'cuya', 'dado', 'debe', 'deben',
  'ella', 'ellas', 'ellos', 'embargo', 'esas', 'esos', 'gran', 'hacia', 'incluso',
  'junto', 'lado', 'largo', 'lugar', 'manera', 'mayor', 'mediante', 'mejor',
  'menor', 'menos', 'mientras', 'modo', 'ninguna', 'ninguno', 'otras', 'otros',
  'otra', 'otro', 'pues', 'parte', 'poco', 'primer', 'primera', 'propio', 'propia',
  'sino', 'solo', 'sola', 'tanto', 'tipo', 'toda', 'tras', 'unos', 'unas',
  'varios', 'veces', 'forma', 'nivel', 'dicho', 'dicha', 'aquí', 'allí', 'ahora',
  'antes', 'después', 'siempre', 'nunca', 'algo', 'algún', 'alguna', 'algunos',
  'algunas', 'nada', 'nadie', 'mucho', 'bastante', 'demasiado', 'través',
  'that', 'with', 'this', 'have', 'from', 'they', 'will', 'been', 'were',
  'said', 'each', 'which', 'their', 'there', 'when', 'what', 'make', 'like',
  'time', 'just', 'know', 'take', 'into', 'year', 'your', 'good', 'some',
  'could', 'them', 'then', 'than', 'more', 'only', 'come', 'over', 'also',
  'back', 'after', 'first', 'well', 'most', 'about', 'would', 'very', 'these',
  'those', 'such', 'other', 'being', 'both', 'here', 'many', 'does', 'where',
  'through', 'because', 'between', 'without', 'during', 'before', 'should',
  'might', 'while', 'since', 'until', 'whether',
]);

function extractKeywords(text: string): string[] {
  const tokens = text
    .toLowerCase()
    .replace(/[^\p{L}]/gu, ' ')
    .split(/\s+/)
    .filter(t => t.length >= MIN_KEYWORD_LEN && !STOPWORDS.has(t));
  const freq = new Map<string, number>();
  for (const t of tokens) freq.set(t, (freq.get(t) ?? 0) + 1);
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_KEYWORDS_PER_PARA)
    .map(([t]) => t);
}

function detectChains(paragraphsWithKeywords: { index: number; keywords: string[] }[]): Map<string, number[]> {
  const labelToParas = new Map<string, number[]>();
  for (const { index, keywords } of paragraphsWithKeywords) {
    for (const kw of keywords) {
      if (!labelToParas.has(kw)) labelToParas.set(kw, []);
      if (!labelToParas.get(kw)!.includes(index)) labelToParas.get(kw)!.push(index);
    }
  }
  return new Map([...labelToParas.entries()].filter(([, indices]) => indices.length >= 2));
}

export function computeSuggestions(paras: Paragraph[], codes: TraceCode[]): TraceSuggestion[] {
  const withKeywords = paras.map(p => ({ index: p.index, keywords: extractKeywords(p.text) }));
  const chains = detectChains(withKeywords);
  const existingSet = new Set(codes.map(c => `${c.paraIndex}:${c.label}`));
  const suggestions: TraceSuggestion[] = [];
  for (const [label, paraIndices] of chains) {
    for (const paraIndex of paraIndices) {
      if (!existingSet.has(`${paraIndex}:${label}`)) {
        suggestions.push({ label, paraIndex });
      }
    }
  }
  return suggestions;
}

async function materializeEmergentCodes(paras: Paragraph[], codes: TraceCode[], noteId: string): Promise<TraceCode[]> {
  const created = await Promise.all(computeSuggestions(paras, codes).map(async suggestion => {
    try {
      const res = await fetch('/api/live/notes/trace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          noteId,
          paraIndex: suggestion.paraIndex,
          label: suggestion.label,
          dimension: 'emergent',
          source: 'local_nlp',
          confidence: 0.65,
        }),
      });
      if (!res.ok) return null;
      const data = await res.json() as { code?: TraceCode };
      return data.code ?? null;
    } catch {
      return null;
    }
  }));
  const byId = new Map(codes.map(code => [code.id, code]));
  for (const code of created) {
    if (code) byId.set(code.id, code);
  }
  return [...byId.values()];
}

// ── Label color utility ────────────────────────────────────────────────────

function labelHue(label: string): number {
  let h = 0;
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) & 0x7fffffff;
  return h % 360;
}

// ── CM6 chain highlight extension ──────────────────────────────────────────

export const setHighlight = StateEffect.define<Set<number>>();

export const highlightField = StateField.define<Set<number>>({
  create: () => new Set<number>(),
  update: (val, tr) => {
    for (const e of tr.effects) if (e.is(setHighlight)) return e.value;
    return val;
  },
});

function buildHighlightDecos(view: EditorView, paras: Paragraph[]): DecorationSet {
  const highlighted = view.state.field(highlightField, false);
  if (!highlighted?.size) return Decoration.none;
  const doc = view.state.doc;
  const builder = new RangeSetBuilder<Decoration>();
  for (const para of paras) {
    if (!highlighted.has(para.index)) continue;
    const safeFrom = Math.min(para.from, doc.length);
    const safeTo   = Math.max(0, Math.min(para.to - 1, doc.length - 1));
    if (safeFrom > doc.length) continue;
    const startLine = doc.lineAt(safeFrom);
    const endLine   = doc.lineAt(safeTo);
    for (let n = startLine.number; n <= endLine.number; n++) {
      const line = doc.line(n);
      builder.add(line.from, line.from, Decoration.line({ class: 'cnw-trace-hl' }));
    }
  }
  return builder.finish();
}

export function makeHighlightPlugin(paras: Paragraph[]) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(v: EditorView) { this.decorations = buildHighlightDecos(v, paras); }
      update(u: ViewUpdate) {
        if (u.docChanged || u.transactions.some(t => t.effects.some(e => e.is(setHighlight)))) {
          this.decorations = buildHighlightDecos(u.view, paras);
        }
      }
    },
    { decorations: v => v.decorations },
  );
}

// ── CM6 code bar extension (permanent colored left borders per paragraph) ──

export const setCodeBars = StateEffect.define<TraceCode[]>();

export const codeBarField = StateField.define<TraceCode[]>({
  create: () => [],
  update: (val, tr) => {
    for (const e of tr.effects) if (e.is(setCodeBars)) return e.value;
    return val;
  },
});

function buildCodeBarDecos(view: EditorView, paras: Paragraph[]): DecorationSet {
  const codes = view.state.field(codeBarField, false);
  if (!codes?.length) return Decoration.none;
  const doc = view.state.doc;
  const builder = new RangeSetBuilder<Decoration>();
  for (const para of paras) {
    const paraCodes = codes.filter(c => c.paraIndex === para.index);
    if (!paraCodes.length) continue;
    const hue = labelHue(paraCodes[0].label);
    const safeFrom = Math.min(para.from, doc.length);
    const safeTo   = Math.max(0, Math.min(para.to - 1, doc.length - 1));
    if (safeFrom > doc.length) continue;
    const startLine = doc.lineAt(safeFrom);
    const endLine   = doc.lineAt(safeTo);
    for (let n = startLine.number; n <= endLine.number; n++) {
      const line = doc.line(n);
      builder.add(
        line.from, line.from,
        Decoration.line({
          attributes: {
            style: `border-left: 3px solid hsl(${hue}, 55%, 55%); padding-left: 4px; box-sizing: border-box;`,
          },
        }),
      );
    }
  }
  return builder.finish();
}

export function makeCodeBarPlugin(paras: Paragraph[]) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(v: EditorView) { this.decorations = buildCodeBarDecos(v, paras); }
      update(u: ViewUpdate) {
        if (u.docChanged || u.transactions.some(t => t.effects.some(e => e.is(setCodeBars)))) {
          this.decorations = buildCodeBarDecos(u.view, paras);
        }
      }
    },
    { decorations: v => v.decorations },
  );
}

function makeTraceDocumentPlugin(onDocumentChange: () => void) {
  return ViewPlugin.fromClass(class {
    update(update: ViewUpdate) {
      if (update.docChanged) onDocumentChange();
    }
  });
}

function makeTraceActivityPlugin(onActivity: (view: EditorView, animate: boolean) => void) {
  return ViewPlugin.fromClass(class {
    update(update: ViewUpdate) {
      if (update.selectionSet || update.viewportChanged || update.docChanged) {
        onActivity(update.view, update.selectionSet || update.viewportChanged);
      }
    }
  });
}

// ── CSS ────────────────────────────────────────────────────────────────────

export function injectTraceCss() {
  if (document.querySelector('[data-trace-css]')) return;
  const s = document.createElement('style');
  s.setAttribute('data-trace-css', '1');
  s.textContent = `
    .cnw-trace-hl { border-left: 3px solid var(--c-link, #3b82f6) !important; padding-left: 4px !important; box-sizing: border-box; }
    .cnw-trace-col {
      flex: 0 0 35%;
      min-width: 180px;
      max-width: 280px;
      border-left: 1px solid var(--c-border, rgba(120,120,140,0.2));
      display: flex;
      flex-direction: column;
      overflow: hidden;
      font-size: 11px;
      color: var(--c-fg);
      background: var(--c-bg);
    }
    .tc-monitor { flex: 1; min-height: 0; overflow-y: auto; }
    .tc-section { border-bottom: 1px solid var(--c-border, rgba(120,120,140,0.15)); }
    .tc-section-summary {
      list-style: none;
      cursor: pointer;
      user-select: none;
      display: flex;
      align-items: center;
      gap: .35rem;
      padding: 6px 8px;
      font-size: 9px;
      letter-spacing: .16em;
      text-transform: uppercase;
      opacity: .7;
    }
    .tc-section-summary::-webkit-details-marker { display: none; }
    .tc-section-summary::before {
      content: "";
      position: relative;
      top: -1px;
      width: .42rem;
      height: .42rem;
      border-right: 1px solid currentColor;
      border-bottom: 1px solid currentColor;
      transform: rotate(-45deg);
      flex-shrink: 0;
      transition: transform 140ms ease, top 140ms ease;
    }
    .tc-section[open] > .tc-section-summary::before { transform: rotate(45deg); top: -2px; }
    .tc-section-body { padding-bottom: 6px; }
    .tc-live-badge {
      margin-left: auto;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 8px;
      letter-spacing: .12em;
      opacity: .6;
    }
    .tc-live-dot {
      width: 5px;
      height: 5px;
      border-radius: 999px;
      background: var(--c-link, #3b82f6);
      opacity: .6;
    }
    .tc-section--trace.is-updating .tc-live-dot,
    .tc-section--trace.is-traversing .tc-live-dot { animation: tc-live-pulse 420ms ease-out; }
    @keyframes tc-live-pulse {
      0% { transform: scale(.85); opacity: .55; }
      35% { transform: scale(2); opacity: 1; }
      100% { transform: scale(1); opacity: .6; }
    }
    .tc-list { padding: 4px 0; }
    .tc-row {
      padding: 4px 8px;
      border-bottom: 1px solid var(--c-border, rgba(120,120,140,0.08));
      transition: background 140ms ease, opacity 140ms ease;
    }
    .tc-row.is-visible { background: color-mix(in srgb, var(--c-link, #3b82f6) 3%, transparent); }
    .tc-row.is-active, .tc-row.is-hovered { background: color-mix(in srgb, var(--c-link, #3b82f6) 11%, transparent); }
    .tc-row.is-entering { animation: tc-row-enter 360ms ease-out; }
    @keyframes tc-row-enter {
      0% { background: color-mix(in srgb, var(--c-link, #3b82f6) 24%, transparent); }
      100% { background: color-mix(in srgb, var(--c-link, #3b82f6) 11%, transparent); }
    }
    .tc-row-head { display: flex; align-items: center; gap: 4px; margin-bottom: 3px; }
    .tc-para-label {
      border: none;
      background: transparent;
      color: inherit;
      cursor: pointer;
      padding: 0;
      font-size: 9px;
      font-family: var(--font-mono, monospace);
      opacity: 0.5;
      flex-shrink: 0;
    }
    .tc-para-label:hover, .tc-row.is-active .tc-para-label { color: var(--c-link, #3b82f6); opacity: 1; }
    .tc-role-chip { font-size: 9px; opacity: 0.35; flex: 1; }
    .tc-add-btn { background: none; border: none; cursor: pointer; font-size: 13px; line-height: 1; color: var(--c-fg-dim); opacity: 0.4; padding: 0 2px; flex-shrink: 0; }
    .tc-add-btn:hover { opacity: 1; color: var(--c-link, #3b82f6); }
    .tc-codes { display: flex; flex-wrap: wrap; gap: 3px; min-height: 4px; }
    .tc-chip { display: inline-flex; align-items: center; gap: 2px; background: var(--c-bg-mute); border-radius: 10px; padding: 1px 4px 1px 6px; cursor: pointer; transition: background 120ms; }
    .tc-chip.is-emergent { outline: 1px dashed color-mix(in srgb, var(--c-link, #3b82f6) 34%, transparent); }
    .tc-chip:hover { background: color-mix(in srgb, var(--c-link, #3b82f6) 15%, var(--c-bg-mute)); }
    .tc-chip.is-highlighted { background: color-mix(in srgb, var(--c-link, #3b82f6) 22%, var(--c-bg-mute)); outline: 1px solid color-mix(in srgb, var(--c-link, #3b82f6) 40%, transparent); }
    .tc-chip-label { font-size: 10px; color: var(--c-fg); }
    .tc-chip-del { background: none; border: none; cursor: pointer; font-size: 11px; line-height: 1; color: var(--c-fg-dim); padding: 0; opacity: 0.45; }
    .tc-chip-del:hover { opacity: 1; color: #c87e7e; }
    .tc-orphan-badge { font-size: 9px; color: #c87e7e; opacity: 0.75; margin-left: auto; }
    .tc-add-input { width: 100%; font-size: 10px; border: 1px solid var(--c-link, #3b82f6); background: var(--c-bg); color: var(--c-fg); border-radius: 3px; padding: 2px 4px; margin-top: 3px; box-sizing: border-box; outline: none; }
    .tc-graph { border-top: 1px solid var(--c-border, rgba(120,120,140,0.15)); flex-shrink: 0; padding-top: 4px; }
    .tc-subhead { font-size: 9px; opacity: .42; padding: 2px 8px 5px; letter-spacing: .09em; text-transform: uppercase; }
    .tc-svg { display: block; margin: 0 auto; padding-bottom: 8px; }
    .tc-graph-link {
      transition: opacity 160ms ease, stroke-width 160ms ease;
    }
    .tc-graph-link.is-active, .tc-graph-link.is-hovered { opacity: .9 !important; stroke-width: 2px; }
    .tc-graph-node {
      cursor: pointer;
      transition: stroke-width 160ms ease, filter 160ms ease, opacity 160ms ease;
    }
    .tc-graph-node.is-visible { opacity: .82; }
    .tc-graph-node.is-active, .tc-graph-node.is-hovered {
      stroke: var(--c-link, #3b82f6);
      stroke-width: 2px;
      filter: drop-shadow(0 0 3px color-mix(in srgb, var(--c-link, #3b82f6) 55%, transparent));
    }
    .tc-graph-node.is-entering { animation: tc-node-enter 360ms ease-out; }
    @keyframes tc-node-enter {
      0% { transform: scale(1.25); transform-origin: center; }
      100% { transform: scale(1); transform-origin: center; }
    }
    .tc-graph-label { pointer-events: none; }
    .tc-chip-suggestion {
      opacity: 0.55;
      border: 1px dashed color-mix(in srgb, var(--c-link, #3b82f6) 60%, transparent);
      background: transparent;
    }
    .tc-chip-suggestion:hover { opacity: 0.9; background: color-mix(in srgb, var(--c-link, #3b82f6) 8%, var(--c-bg)); }
    .tc-empty { margin: 0; padding: 7px 8px; font-size: 10px; opacity: .45; }
    .tc-lexical-tools { padding: 2px 8px 7px; }
    .tc-lexical-input {
      width: 100%;
      box-sizing: border-box;
      border: 1px solid var(--c-border, rgba(120,120,140,.24));
      border-radius: 3px;
      background: transparent;
      color: inherit;
      font: inherit;
      font-size: 10px;
      padding: 3px 5px;
      margin-bottom: 6px;
    }
    .tc-frequency-row { display: flex; align-items: center; gap: 5px; padding: 2px 0; cursor: pointer; }
    .tc-frequency-bar, .tc-zipf-bar {
      height: 6px;
      min-width: 3px;
      max-width: 92px;
      border-radius: 2px;
      background: var(--c-link, #3b82f6);
      opacity: .48;
    }
    .tc-frequency-label, .tc-zipf-label { font-size: 10px; opacity: .72; font-family: var(--font-mono, monospace); }
    .tc-kwic { margin-top: 7px; border-top: 1px solid var(--c-border, rgba(120,120,140,.12)); padding-top: 5px; }
    .tc-kwic-row { font-size: 9px; line-height: 1.45; opacity: .74; font-family: var(--font-mono, monospace); padding: 2px 0; }
    .tc-kwic-row mark { background: color-mix(in srgb, var(--c-link, #3b82f6) 22%, transparent); color: inherit; border-radius: 2px; }
    .tc-zipf-stats, .tc-qa-copy { padding: 2px 8px 7px; font-size: 10px; line-height: 1.5; opacity: .65; }
    .tc-zipf-row { display: grid; grid-template-columns: 21px 1fr auto; gap: 4px; align-items: center; padding: 2px 8px; }
    .tc-zipf-rank { font-size: 9px; opacity: .42; font-family: var(--font-mono, monospace); }
    .tc-zipf-bars { display: flex; align-items: center; gap: 5px; min-width: 0; }
    .tc-qa-metrics { display: flex; gap: 5px; flex-wrap: wrap; padding: 2px 8px 5px; }
    .tc-qa-metric { padding: 2px 5px; border: 1px solid var(--c-border, rgba(120,120,140,.18)); border-radius: 10px; font-size: 9px; opacity: .65; }
  `;
  document.head.appendChild(s);
}

// ── SVG graph ──────────────────────────────────────────────────────────────

function renderTraceGraph(
  paras: Paragraph[],
  codes: TraceCode[],
  onJumpToParagraph: (para: Paragraph) => void,
  onHoverParagraph: (paraIndex: number | null) => void,
): SVGSVGElement {
  const SPACING = 38;
  const R = 9;
  const CX = 16;
  const W = 52;
  const h = paras.length * SPACING + 20;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${h}`);
  svg.setAttribute('width', String(W));
  svg.setAttribute('height', String(h));
  svg.className.baseVal = 'tc-svg';

  // Arcs: paragraphs sharing a code label are related
  const labelToParagraphs = new Map<string, Set<number>>();
  for (const code of codes) {
    if (!labelToParagraphs.has(code.label)) labelToParagraphs.set(code.label, new Set());
    labelToParagraphs.get(code.label)!.add(code.paraIndex);
  }
  const drawnPairs = new Set<string>();
  for (const [, paraSet] of labelToParagraphs) {
    const arr = [...paraSet].sort((a, b) => a - b);
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const key = `${arr[i]},${arr[j]}`;
        if (drawnPairs.has(key)) continue;
        drawnPairs.add(key);
        const y1 = 10 + arr[i] * SPACING;
        const y2 = 10 + arr[j] * SPACING;
        const dist = arr[j] - arr[i];
        const ctrl = Math.min(10 + dist * 6, 30);
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', `M ${CX + R} ${y1} C ${CX + R + ctrl} ${y1}, ${CX + R + ctrl} ${y2}, ${CX + R} ${y2}`);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', 'var(--c-link, #3b82f6)');
        path.setAttribute('stroke-width', '1.2');
        path.setAttribute('opacity', '0.3');
        path.classList.add('tc-graph-link');
        path.dataset.from = String(arr[i]);
        path.dataset.to = String(arr[j]);
        svg.appendChild(path);
      }
    }
  }

  for (const para of paras) {
    const cy = 10 + para.index * SPACING;
    const pct = Math.min(80, codes.filter(c => c.paraIndex === para.index).length * 20);

    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', String(CX));
    circle.setAttribute('cy', String(cy));
    circle.setAttribute('r', String(R));
    circle.setAttribute('fill', `color-mix(in srgb, var(--c-link, #3b82f6) ${pct}%, var(--c-bg-mute, #f0f0f0))`);
    circle.setAttribute('stroke', 'var(--c-border, rgba(120,120,140,0.3))');
    circle.setAttribute('stroke-width', '1');
    circle.setAttribute('role', 'button');
    circle.setAttribute('tabindex', '0');
    circle.setAttribute('aria-label', `Ir al párrafo ${para.index}`);
    circle.classList.add('tc-graph-node');
    circle.dataset.paraIndex = String(para.index);
    circle.addEventListener('mouseenter', () => onHoverParagraph(para.index));
    circle.addEventListener('mouseleave', () => onHoverParagraph(null));
    circle.addEventListener('click', () => onJumpToParagraph(para));
    circle.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onJumpToParagraph(para);
      }
    });
    svg.appendChild(circle);

    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', String(CX));
    text.setAttribute('y', String(cy + 3));
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('font-size', '7');
    text.setAttribute('fill', 'var(--c-fg, currentColor)');
    text.setAttribute('opacity', '0.7');
    text.classList.add('tc-graph-label');
    text.textContent = `P${para.index}`;
    svg.appendChild(text);
  }

  return svg;
}

// ── Margin renderer ────────────────────────────────────────────────────────

function createMonitorSection(
  monitor: HTMLElement,
  key: MonitorSectionKey,
  label: string,
  state: MonitorState,
): HTMLElement {
  const section = document.createElement('details');
  section.className = `tc-section tc-section--${key}`;
  section.open = state.open[key];
  section.addEventListener('toggle', () => { state.open[key] = section.open; });

  const summary = document.createElement('summary');
  summary.className = 'tc-section-summary';
  summary.appendChild(document.createTextNode(label));
  if (key === 'trace') {
    const live = document.createElement('span');
    live.className = 'tc-live-badge';
    const dot = document.createElement('span');
    dot.className = 'tc-live-dot';
    const context = document.createElement('span');
    context.className = 'tc-live-context';
    context.textContent = 'LIVE';
    live.append(dot, context);
    summary.appendChild(live);
  }
  section.appendChild(summary);

  const body = document.createElement('div');
  body.className = 'tc-section-body';
  section.appendChild(body);
  monitor.appendChild(section);
  return body;
}

function setHoveredParagraph(traceCol: HTMLElement, paraIndex: number | null) {
  traceCol.querySelectorAll<HTMLElement>('.tc-row').forEach(row => {
    row.classList.toggle('is-hovered', Number(row.dataset.paraIndex) === paraIndex);
  });
  traceCol.querySelectorAll<SVGElement>('.tc-graph-node').forEach(node => {
    node.classList.toggle('is-hovered', Number(node.dataset.paraIndex) === paraIndex);
  });
  traceCol.querySelectorAll<SVGElement>('.tc-graph-link').forEach(link => {
    link.classList.toggle('is-hovered', paraIndex !== null
      && (Number(link.dataset.from) === paraIndex || Number(link.dataset.to) === paraIndex));
  });
}

function applyMonitorActivity(traceCol: HTMLElement, state: MonitorState, animate: boolean) {
  traceCol.querySelectorAll<HTMLElement>('.tc-row').forEach(row => {
    const index = Number(row.dataset.paraIndex);
    const isActive = index === state.activeParagraph;
    row.classList.toggle('is-visible', state.visibleParagraphs.has(index));
    row.classList.toggle('is-active', isActive);
    if (animate && isActive) {
      row.classList.remove('is-entering');
      void row.offsetWidth;
      row.classList.add('is-entering');
    }
  });
  traceCol.querySelectorAll<SVGElement>('.tc-graph-node').forEach(node => {
    const index = Number(node.dataset.paraIndex);
    const isActive = index === state.activeParagraph;
    node.classList.toggle('is-visible', state.visibleParagraphs.has(index));
    node.classList.toggle('is-active', isActive);
    if (animate && isActive) {
      node.classList.remove('is-entering');
      node.getBoundingClientRect();
      node.classList.add('is-entering');
    }
  });
  traceCol.querySelectorAll<SVGElement>('.tc-graph-link').forEach(link => {
    link.classList.toggle('is-active', state.activeParagraph !== null
      && (Number(link.dataset.from) === state.activeParagraph || Number(link.dataset.to) === state.activeParagraph));
  });
  const context = traceCol.querySelector<HTMLElement>('.tc-live-context');
  if (context) context.textContent = state.activeParagraph === null ? 'LIVE' : `LIVE · P${state.activeParagraph}`;
}

function renderKwicLines(target: HTMLElement, text: string, query: string) {
  target.innerHTML = '';
  const lines = computeKwic(text, query, 30).slice(0, 8);
  if (!query.trim() || lines.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'tc-empty';
    empty.textContent = query.trim() ? 'Sin concordancias' : 'Selecciona una palabra';
    target.appendChild(empty);
    return;
  }
  for (const line of lines) {
    const row = document.createElement('div');
    row.className = 'tc-kwic-row';
    const before = document.createElement('span');
    before.textContent = line.before;
    const mark = document.createElement('mark');
    mark.textContent = line.match;
    const after = document.createElement('span');
    after.textContent = line.after;
    row.append(before, mark, after);
    target.appendChild(row);
  }
}

function appendLexicalSection(monitor: HTMLElement, text: string, state: MonitorState) {
  const body = createMonitorSection(monitor, 'lexico', 'Léxico', state);
  const tools = document.createElement('div');
  tools.className = 'tc-lexical-tools';
  body.appendChild(tools);

  const input = document.createElement('input');
  input.className = 'tc-lexical-input';
  input.placeholder = 'concordancia...';
  const frequencies = computeFrequency(text, 12);
  if (!state.lexicalQuery && frequencies[0]) state.lexicalQuery = frequencies[0].word;
  input.value = state.lexicalQuery;
  tools.appendChild(input);

  const freqHead = document.createElement('div');
  freqHead.className = 'tc-subhead';
  freqHead.textContent = 'Frecuencia';
  tools.appendChild(freqHead);

  if (frequencies.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'tc-empty';
    empty.textContent = 'Sin términos suficientes';
    tools.appendChild(empty);
  }
  for (const entry of frequencies) {
    const row = document.createElement('div');
    row.className = 'tc-frequency-row';
    row.title = 'Ver concordancias';
    const bar = document.createElement('span');
    bar.className = 'tc-frequency-bar';
    bar.style.width = `${Math.max(4, Math.min(entry.pct, 100))}%`;
    const label = document.createElement('span');
    label.className = 'tc-frequency-label';
    label.textContent = `${entry.word} (${entry.count})`;
    row.append(bar, label);
    row.addEventListener('click', () => {
      state.lexicalQuery = entry.word;
      input.value = entry.word;
      renderKwicLines(kwic, text, entry.word);
    });
    tools.appendChild(row);
  }

  const kwicHead = document.createElement('div');
  kwicHead.className = 'tc-subhead';
  kwicHead.textContent = 'KWIC';
  const kwic = document.createElement('div');
  kwic.className = 'tc-kwic';
  tools.append(kwicHead, kwic);
  input.addEventListener('input', () => {
    state.lexicalQuery = input.value.trim();
    renderKwicLines(kwic, text, state.lexicalQuery);
  });
  renderKwicLines(kwic, text, state.lexicalQuery);
}

function appendZipfSection(monitor: HTMLElement, text: string, state: MonitorState) {
  const body = createMonitorSection(monitor, 'zipf', 'Zipf', state);
  const profile = computeZipfProfile(text, 10);
  const stats = document.createElement('div');
  stats.className = 'tc-zipf-stats';
  if (profile.slope === null) {
    stats.textContent = 'Distribución insuficiente para estimar una pendiente.';
  } else {
    stats.textContent = `${profile.tokenCount} tokens · ${profile.vocabularySize} términos · pendiente log-log ${profile.slope.toFixed(2)}`;
  }
  body.appendChild(stats);

  for (const point of profile.points) {
    const row = document.createElement('div');
    row.className = 'tc-zipf-row';
    const rank = document.createElement('span');
    rank.className = 'tc-zipf-rank';
    rank.textContent = `#${point.rank}`;
    const bars = document.createElement('span');
    bars.className = 'tc-zipf-bars';
    const bar = document.createElement('span');
    bar.className = 'tc-zipf-bar';
    bar.style.width = `${Math.max(4, (point.count / (profile.points[0]?.count ?? 1)) * 100)}%`;
    const word = document.createElement('span');
    word.className = 'tc-zipf-label';
    word.textContent = point.word;
    bars.append(bar, word);
    const count = document.createElement('span');
    count.className = 'tc-zipf-label';
    count.title = `Ideal Zipf aproximado: ${point.expected.toFixed(1)}`;
    count.textContent = String(point.count);
    row.append(rank, bars, count);
    body.appendChild(row);
  }
}

function appendQaSection(monitor: HTMLElement, codes: TraceCode[], state: MonitorState) {
  const body = createMonitorSection(monitor, 'qa', 'QA', state);
  const metrics = document.createElement('div');
  metrics.className = 'tc-qa-metrics';
  const emergent = codes.filter(code => code.source === 'local_nlp').length;
  const values = [
    `${codes.length} códigos`,
    `${emergent} emergentes`,
    `${computeOrphanLabels(codes).size} aislados`,
  ];
  for (const value of values) {
    const metric = document.createElement('span');
    metric.className = 'tc-qa-metric';
    metric.textContent = value;
    metrics.appendChild(metric);
  }
  const copy = document.createElement('div');
  copy.className = 'tc-qa-copy';
  copy.textContent = 'Capa cualitativa en preparación: memo analítico, categorías y revisión transversal.';
  body.append(metrics, copy);
}

function renderMargin(
  traceCol: HTMLElement,
  paras: Paragraph[],
  codes: TraceCode[],
  noteId: string,
  editorView: EditorView,
  onCodesChange: (codes: TraceCode[]) => void,
  state: MonitorState,
) {
  traceCol.innerHTML = '';
  const orphans = computeOrphanLabels(codes);
  const monitor = document.createElement('div');
  monitor.className = 'tc-monitor';
  traceCol.appendChild(monitor);
  const traceBody = createMonitorSection(monitor, 'trace', 'Trace', state);
  const jumpToParagraph = (para: Paragraph) => {
    editorView.dispatch({
      selection: { anchor: Math.min(para.from, editorView.state.doc.length) },
      effects: EditorView.scrollIntoView(Math.min(para.from, editorView.state.doc.length), { y: 'center' }),
    });
    editorView.focus();
  };
  const hoverParagraph = (paraIndex: number | null) => setHoveredParagraph(traceCol, paraIndex);

  const list = document.createElement('div');
  list.className = 'tc-list';

  if (paras.length === 0) {
    const msg = document.createElement('p');
    msg.style.cssText = 'padding:8px;opacity:.4;font-size:10px;margin:0';
    msg.textContent = '[sin párrafos]';
    list.appendChild(msg);
  }

  for (const para of paras) {
    const paraCodes = codes.filter(c => c.paraIndex === para.index);
    const row = document.createElement('div');
    row.className = 'tc-row';
    row.dataset.paraIndex = String(para.index);
    row.addEventListener('mouseenter', () => hoverParagraph(para.index));
    row.addEventListener('mouseleave', () => hoverParagraph(null));

    const head = document.createElement('div');
    head.className = 'tc-row-head';

    const paraLabel = document.createElement('button');
    paraLabel.type = 'button';
    paraLabel.className = 'tc-para-label';
    paraLabel.title = 'Ir al párrafo';
    paraLabel.textContent = `P${para.index}`;
    paraLabel.addEventListener('click', () => jumpToParagraph(para));
    head.appendChild(paraLabel);

    const roleChip = document.createElement('span');
    roleChip.className = 'tc-role-chip';
    roleChip.textContent = '—';
    head.appendChild(roleChip);

    const orphanParaCodes = paraCodes.filter(c => orphans.has(c.label));
    if (orphanParaCodes.length > 0) {
      const badge = document.createElement('span');
      badge.className = 'tc-orphan-badge';
      badge.title = orphanParaCodes.map(c => `'${c.label}' solo aparece aquí`).join('; ');
      badge.textContent = '⚠';
      head.appendChild(badge);
    }

    const addBtn = document.createElement('button');
    addBtn.className = 'tc-add-btn';
    addBtn.title = 'Añadir código';
    addBtn.textContent = '⊕';
    head.appendChild(addBtn);

    row.appendChild(head);

    const codesEl = document.createElement('div');
    codesEl.className = 'tc-codes';
    const highlighted = editorView.state.field(highlightField, false) ?? new Set<number>();

    for (const code of paraCodes) {
      const chip = document.createElement('span');
      chip.className = 'tc-chip';
      if (code.source === 'local_nlp') {
        chip.classList.add('is-emergent');
        chip.title = 'Código emergente detectado localmente';
      }
      chip.dataset.label = code.label;
      chip.dataset.codeId = code.id;
      if (highlighted.has(code.paraIndex)) chip.classList.add('is-highlighted');

      const labelEl = document.createElement('span');
      labelEl.className = 'tc-chip-label';
      labelEl.textContent = code.label;
      chip.appendChild(labelEl);

      const delBtn = document.createElement('button');
      delBtn.className = 'tc-chip-del';
      delBtn.title = 'Eliminar';
      delBtn.textContent = '×';
      chip.appendChild(delBtn);

      chip.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.tc-chip-del')) return;
        const matchingParas = codes.filter(c => c.label === code.label).map(c => c.paraIndex);
        const newSet = new Set(matchingParas);
        const current = editorView.state.field(highlightField, false) ?? new Set<number>();
        const alreadyOn = matchingParas.length > 0 && matchingParas.every(p => current.has(p)) && current.size === newSet.size;
        editorView.dispatch({ effects: setHighlight.of(alreadyOn ? new Set<number>() : newSet) });
        traceCol.querySelectorAll<HTMLElement>('.tc-chip').forEach(ch => {
          ch.classList.toggle('is-highlighted', !alreadyOn && ch.dataset.label === code.label);
        });
      });

      delBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const origBg = chip.style.background;
        try {
          const res = await fetch(`/api/live/notes/trace?id=${code.id}`, { method: 'DELETE' });
          if (!res.ok) throw new Error('delete failed');
          onCodesChange(codes.filter(c => c.id !== code.id));
        } catch {
          chip.style.background = 'rgba(200,126,126,0.25)';
          setTimeout(() => { chip.style.background = origBg; }, 1500);
        }
      });

      codesEl.appendChild(chip);
    }

    // Unsaved suggestions remain visible only when automatic persistence failed.
    const suggestions = computeSuggestions(paras, codes);
    const paraSuggestions = suggestions.filter(s => s.paraIndex === para.index);
    for (const suggestion of paraSuggestions) {
      const chip = document.createElement('span');
      chip.className = 'tc-chip tc-chip-suggestion';
      chip.title = 'Código emergente pendiente de guardar';

      const labelEl = document.createElement('span');
      labelEl.className = 'tc-chip-label';
      labelEl.textContent = suggestion.label;
      chip.appendChild(labelEl);

      codesEl.appendChild(chip);
    }

    row.appendChild(codesEl);

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'tc-add-input';
    input.placeholder = 'nombre del código…';
    input.style.display = 'none';
    row.appendChild(input);

    addBtn.addEventListener('click', () => {
      input.style.display = 'block';
      input.focus();
    });

    input.addEventListener('keydown', async (ev) => {
      if (ev.key === 'Enter') {
        const label = input.value.trim();
        input.style.display = 'none';
        input.value = '';
        if (!label) return;
        try {
          const res = await fetch('/api/live/notes/trace', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ noteId, paraIndex: para.index, label }),
          });
          if (!res.ok) throw new Error('save failed');
          const data = await res.json() as { code?: TraceCode };
          if (data.code) onCodesChange([...codes, data.code]);
        } catch {
          input.style.borderColor = '#c87e7e';
          setTimeout(() => { input.style.borderColor = ''; }, 1500);
        }
      } else if (ev.key === 'Escape') {
        input.style.display = 'none';
        input.value = '';
      }
    });

    list.appendChild(row);
  }

  traceBody.appendChild(list);

  const graph = document.createElement('div');
  graph.className = 'tc-graph';
  const graphTitle = document.createElement('div');
  graphTitle.className = 'tc-subhead';
  graphTitle.textContent = 'Estructura';
  graph.appendChild(graphTitle);
  if (paras.length > 0) graph.appendChild(renderTraceGraph(paras, codes, jumpToParagraph, hoverParagraph));
  traceBody.appendChild(graph);

  const text = editorView.state.doc.toString();
  appendLexicalSection(monitor, text, state);
  appendZipfSection(monitor, text, state);
  appendQaSection(monitor, codes, state);
}

// ── Public API ─────────────────────────────────────────────────────────────

export async function mountTraceMargin(
  editorView: EditorView,
  noteId: string,
  panelBodyEl: HTMLElement,
): Promise<TraceMarginHandle> {
  injectTraceCss();

  let codes: TraceCode[] = [];
  try {
    const res = await fetch(`/api/live/notes/trace?noteId=${encodeURIComponent(noteId)}`);
    if (res.ok) {
      const data = await res.json() as { codes?: TraceCode[] };
      codes = data.codes ?? [];
    }
  } catch { /* render empty margin */ }

  const paras = segmentParagraphs(editorView.state.doc.toString());
  codes = await materializeEmergentCodes(paras, codes, noteId);
  let currentCodes = codes;
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  let pulseTimer: ReturnType<typeof setTimeout> | null = null;
  let refreshVersion = 0;
  let active = true;
  const monitorState: MonitorState = {
    open: { trace: true, lexico: false, zipf: false, qa: false },
    lexicalQuery: '',
    activeParagraph: null,
    visibleParagraphs: new Set<number>(),
  };

  const refreshFromDocument = () => {
    if (refreshTimer) clearTimeout(refreshTimer);
    const version = ++refreshVersion;
    refreshTimer = setTimeout(async () => {
      if (!active || version !== refreshVersion) return;
      const nextParas = segmentParagraphs(editorView.state.doc.toString());
      paras.splice(0, paras.length, ...nextParas);
      const nextCodes = await materializeEmergentCodes(paras, currentCodes, noteId);
      if (!active || version !== refreshVersion) return;
      rerender(nextCodes);
    }, 700);
  };

  const editorContainer = panelBodyEl.firstElementChild as HTMLElement | null;
  if (editorContainer) {
    editorContainer.style.flex = '1';
    editorContainer.style.minWidth = '0';
    editorContainer.style.overflow = 'hidden';
  }
  panelBodyEl.style.display = 'flex';
  panelBodyEl.style.overflow = 'hidden';

  const traceCol = document.createElement('div');
  traceCol.className = 'cnw-trace-col';
  panelBodyEl.appendChild(traceCol);

  const syncEditorActivity = (view: EditorView, animate: boolean) => {
    const nextActive = resolveParagraphIndex(paras, view.state.selection.main.head);
    const enteredParagraph = nextActive !== monitorState.activeParagraph;
    monitorState.activeParagraph = nextActive;
    monitorState.visibleParagraphs = collectParagraphIndicesInRange(paras, view.viewport.from, view.viewport.to);
    applyMonitorActivity(traceCol, monitorState, animate && enteredParagraph);
    if (animate && enteredParagraph) {
      const traceSection = traceCol.querySelector<HTMLElement>('.tc-section--trace');
      if (traceSection) {
        traceSection.classList.remove('is-traversing');
        void traceSection.offsetWidth;
        traceSection.classList.add('is-traversing');
      }
    }
  };

  const rerender = (newCodes: TraceCode[]) => {
    currentCodes = newCodes;
    editorView.dispatch({ effects: setCodeBars.of(currentCodes) });
    renderMargin(traceCol, paras, currentCodes, noteId, editorView, rerender, monitorState);
    syncEditorActivity(editorView, false);
    const traceSection = traceCol.querySelector<HTMLElement>('.tc-section--trace');
    if (traceSection) {
      traceSection.classList.remove('is-updating');
      void traceSection.offsetWidth;
      traceSection.classList.add('is-updating');
      if (pulseTimer) clearTimeout(pulseTimer);
      pulseTimer = setTimeout(() => traceSection.classList.remove('is-updating'), 430);
    }
  };

  const traceExtensions = new Compartment();
  editorView.dispatch({
    effects: StateEffect.appendConfig.of(traceExtensions.of([
      highlightField, makeHighlightPlugin(paras),
      codeBarField,   makeCodeBarPlugin(paras),
      makeTraceDocumentPlugin(refreshFromDocument),
      makeTraceActivityPlugin(syncEditorActivity),
    ])),
  });

  rerender(currentCodes);

  return {
    destroy() {
      active = false;
      if (refreshTimer) clearTimeout(refreshTimer);
      if (pulseTimer) clearTimeout(pulseTimer);
      editorView.dispatch({ effects: setHighlight.of(new Set<number>()) });
      editorView.dispatch({ effects: setCodeBars.of([]) });
      editorView.dispatch({ effects: traceExtensions.reconfigure([]) });
      traceCol.remove();
      if (editorContainer) {
        editorContainer.style.flex = '';
        editorContainer.style.minWidth = '';
        editorContainer.style.overflow = '';
      }
      panelBodyEl.style.display = '';
      panelBodyEl.style.overflow = '';
    },
  };
}
