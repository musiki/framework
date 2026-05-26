import {
  Compartment, StateEffect, StateField, RangeSetBuilder,
} from '@codemirror/state';
import {
  EditorView, ViewPlugin, Decoration,
  type DecorationSet, type ViewUpdate,
} from '@codemirror/view';
import { computeKwic, computeZipfProfile } from '../../notas/qa-analyzer-logic';

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

type TraceMode = 'borrador' | 'seminario' | 'tesis' | 'artistico' | 'entrega';
type RhetoricalRole =
  | 'afirmacion' | 'definicion' | 'contexto' | 'literatura'
  | 'ejemplo' | 'analisis' | 'contraste' | 'transicion'
  | 'sintesis' | 'metodo' | 'reflexion' | 'conclusion';
type ConceptMention = {
  etiqueta: string;
  estado: 'introducido' | 'reutilizado' | 'transformado' | 'abandonado' | 'sintetizado';
  confianza: number;
};
type ParagraphRelation = {
  indiceObjetivo: number;
  tipo: 'retoma';
  evidencia: string;
  confianza: number;
};
type Diagnostic = {
  severidad: 'baja' | 'media' | 'alta';
  tipo: 'concepto_huerfano';
  etiqueta?: string;
  mensaje?: string;
};
type ParagraphTrace = {
  id?: string;
  noteId?: string;
  paraIndex: number;
  textHash: string;
  temaPrincipal: string | null;
  conceptos: ConceptMention[];
  rolRetorico: RhetoricalRole | null;
  relaciones: ParagraphRelation[];
  diagnosticos: Diagnostic[];
  modo: TraceMode;
  updatedAt?: string;
};

export interface TraceMarginHandle {
  destroy(): void;
}

type MonitorSectionKey = 'trace' | 'estructura' | 'zipf' | 'qa';

type MonitorState = {
  open: Record<MonitorSectionKey, boolean>;
  lexicalQuery: string;
  activeParagraph: number | null;
  visibleParagraphs: Set<number>;
  mode: TraceMode;
};

const ROLE_PRESENTATION: Record<RhetoricalRole, { label: string; short: string; hue: number }> = {
  afirmacion: { label: 'afirmación', short: 'AFI', hue: 15 },
  definicion: { label: 'definición', short: 'DEF', hue: 205 },
  contexto: { label: 'contexto', short: 'CTX', hue: 220 },
  literatura: { label: 'literatura', short: 'LIT', hue: 275 },
  ejemplo: { label: 'ejemplo', short: 'EJE', hue: 142 },
  analisis: { label: 'análisis', short: 'ANA', hue: 185 },
  contraste: { label: 'contraste', short: 'CON', hue: 2 },
  transicion: { label: 'transición', short: 'TRA', hue: 38 },
  sintesis: { label: 'síntesis', short: 'SIN', hue: 300 },
  metodo: { label: 'método', short: 'MET', hue: 170 },
  reflexion: { label: 'reflexión', short: 'REF', hue: 258 },
  conclusion: { label: 'conclusión', short: 'CIE', hue: 330 },
};
const RHETORICAL_ROLES = Object.keys(ROLE_PRESENTATION) as RhetoricalRole[];
const MODE_LABELS: Record<TraceMode, string> = {
  borrador: 'Borrador',
  seminario: 'Seminario',
  tesis: 'Tesis',
  artistico: 'Lit Art (Literatura y Arte)',
  entrega: 'Entrega',
};
const LEGACY_ROLES: Record<string, RhetoricalRole> = {
  claim: 'afirmacion', definition: 'definicion', context: 'contexto', literature: 'literatura',
  example: 'ejemplo', analysis: 'analisis', contrast: 'contraste', transition: 'transicion',
  synthesis: 'sintesis', method: 'metodo', reflection: 'reflexion', conclusion: 'conclusion',
};

function analyticalCodes(codes: TraceCode[]): TraceCode[] {
  // Older Stage 1 builds materialized local NLP as index-only codes. They are
  // intentionally ignored now: derived concepts live in hash-keyed traces.
  return codes.filter(code => code.dimension !== 'rhetorical' && code.source !== 'local_nlp');
}

function roleValue(code: TraceCode | undefined): RhetoricalRole | '' {
  const value = code?.label.replace(/^(role|rol):/, '') ?? '';
  return (LEGACY_ROLES[value] ?? value) as RhetoricalRole | '';
}

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
    const id = `p-${index}`;
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

const LIT_ART_APPROX_CHARS_PER_LINE = 64;

function approximateParagraphLines(text: string): number {
  return text.split('\n').reduce(
    (count, line) => count + Math.max(1, Math.ceil(line.trim().length / LIT_ART_APPROX_CHARS_PER_LINE)),
    0,
  );
}

export function paragraphsForAnalysis(paras: Paragraph[], mode: TraceMode): Paragraph[] {
  if (mode !== 'artistico') return paras;
  return paras.filter(para => approximateParagraphLines(para.text) > 2);
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
    .map(lemmatizeToken)
    .filter(t => t.length >= MIN_KEYWORD_LEN && !STOPWORDS.has(t));
  const freq = new Map<string, number>();
  for (const t of tokens) freq.set(t, (freq.get(t) ?? 0) + 1);
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_KEYWORDS_PER_PARA)
    .map(([t]) => t);
}

function lemmatizeToken(token: string): string {
  if (token.length > 8 && token.endsWith('ciones')) return `${token.slice(0, -6)}ción`;
  if (token.length > 8 && token.endsWith('idades')) return `${token.slice(0, -6)}idad`;
  if (token.length > 6 && !token.endsWith('sis') && /[aeiouáéíóú]s$/u.test(token)) return token.slice(0, -1);
  return token;
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

async function paragraphTextHash(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-1', bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function computeLocalTraces(
  paras: Paragraph[],
  codes: TraceCode[],
  mode: TraceMode,
): Promise<ParagraphTrace[]> {
  const analyzedParas = paragraphsForAnalysis(paras, mode);
  const keywordsByParagraph = analyzedParas.map(para => ({
    index: para.index,
    keywords: extractKeywords(para.text),
  }));
  const occurrences = new Map<string, number[]>();
  for (const para of keywordsByParagraph) {
    for (const keyword of para.keywords) {
      const positions = occurrences.get(keyword) ?? [];
      positions.push(para.index);
      occurrences.set(keyword, positions);
    }
  }
  const hashValues = await Promise.all(analyzedParas.map(para => paragraphTextHash(para.text)));
  return analyzedParas.map((para, offset) => {
    const keywords = keywordsByParagraph[offset].keywords;
    const role = roleValue(codes.find(code => code.paraIndex === para.index && code.dimension === 'rhetorical')) || null;
    const conceptos: ConceptMention[] = keywords.map(etiqueta => {
      const positions = occurrences.get(etiqueta) ?? [];
      return {
        etiqueta,
        estado: positions[0] === para.index ? 'introducido' : 'reutilizado',
        confianza: positions.length > 1 ? 0.72 : 0.45,
      };
    });
    const relationTargets = new Map<number, string[]>();
    for (const keyword of keywords) {
      const previous = (occurrences.get(keyword) ?? []).filter(index => index < para.index).pop();
      if (previous === undefined) continue;
      relationTargets.set(previous, [...(relationTargets.get(previous) ?? []), keyword]);
    }
    const relaciones: ParagraphRelation[] = [...relationTargets.entries()].map(([indiceObjetivo, labels]) => ({
      indiceObjetivo,
      tipo: 'retoma',
      evidencia: labels.join(', '),
      confianza: 0.68,
    }));
    const diagnosticos: Diagnostic[] = mode === 'artistico'
      ? []
      : keywords
        .filter(keyword => (occurrences.get(keyword) ?? []).length === 1)
        .map(keyword => ({
          severidad: 'baja',
          tipo: 'concepto_huerfano',
          etiqueta: keyword,
        }));
    return {
      paraIndex: para.index,
      textHash: hashValues[offset],
      temaPrincipal: keywords[0] ?? null,
      conceptos,
      rolRetorico: role,
      relaciones,
      diagnosticos,
      modo: mode,
    };
  });
}

async function persistLocalTraces(noteId: string, traces: ParagraphTrace[]): Promise<ParagraphTrace[]> {
  if (!traces.length) return [];
  try {
    const res = await fetch('/api/live/notes/trace', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ noteId, traces }),
    });
    if (!res.ok) return traces;
    const data = await res.json() as { traces?: ParagraphTrace[] };
    return data.traces ?? traces;
  } catch {
    return traces;
  }
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
  const codes = analyticalCodes(view.state.field(codeBarField, false) ?? []);
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
      flex: 0 0 clamp(178px, 22%, 224px);
      min-width: 178px;
      max-width: 252px;
      border-left: 1px solid var(--c-border, rgba(120,120,140,0.2));
      display: flex;
      flex-direction: column;
      overflow: hidden;
      font-size: 12.65px;
      color: var(--c-fg);
      background: var(--c-bg);
    }
    .cnw-trace-rail { flex-basis: clamp(178px, 23%, 226px); }
    .cnw-analysis-col { flex-basis: clamp(192px, 25%, 254px); }
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
      font-size: 10.35px;
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
      font-size: 9.2px;
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
    .cnw-trace-rail .tc-monitor,
    .cnw-trace-rail .tc-section--trace,
    .cnw-trace-rail .tc-section--trace[open] .tc-section-body {
      height: 100%;
      min-height: 0;
      position: relative;
      overflow: hidden;
    }
    .cnw-trace-rail .tc-section--trace { border-bottom: none; }
    .cnw-trace-rail .tc-section-summary {
      position: absolute;
      z-index: 4;
      top: 0;
      left: 0;
      right: 0;
      padding: 3px 6px;
      background: color-mix(in srgb, var(--c-bg) 86%, transparent);
    }
    .cnw-trace-rail .tc-list {
      position: absolute;
      inset: 0;
      padding: 0;
    }
    .cnw-trace-rail .tc-row {
      position: absolute;
      left: 0;
      right: 0;
      box-sizing: border-box;
      min-height: var(--tc-para-height, 34px);
      max-height: var(--tc-para-height, 34px);
      overflow: hidden;
      z-index: 1;
    }
    .cnw-trace-rail .tc-row:is(.is-active, .is-hovered, :focus-within) {
      max-height: none;
      overflow: visible;
      z-index: 3;
      background: var(--c-bg);
      box-shadow: 0 2px 8px color-mix(in srgb, var(--c-fg) 10%, transparent);
    }
    .tc-row {
      position: relative;
      padding: 4px 8px;
      padding-left: 20px;
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
    .tc-role-rail {
      position: absolute;
      top: 5px;
      bottom: 5px;
      left: 5px;
      width: 10px;
      border-left: 3px solid var(--tc-role-color, transparent);
      color: var(--tc-role-color, transparent);
      display: flex;
      justify-content: center;
      align-items: flex-start;
      font: 8.05px/1 var(--font-mono, monospace);
      letter-spacing: .08em;
      writing-mode: vertical-rl;
      opacity: .78;
    }
    .tc-para-label {
      border: none;
      background: transparent;
      color: inherit;
      cursor: pointer;
      padding: 0;
      font-size: 10.35px;
      font-family: var(--font-mono, monospace);
      opacity: 0.5;
      flex-shrink: 0;
    }
    .tc-para-label:hover, .tc-row.is-active .tc-para-label { color: var(--c-link, #3b82f6); opacity: 1; }
    .tc-role-select {
      flex: 1;
      min-width: 0;
      border: none;
      background: transparent;
      color: var(--c-fg-dim, currentColor);
      font: inherit;
      font-size: 10.35px;
      opacity: .62;
      outline: none;
    }
    .tc-role-select:focus, .tc-role-select:hover { opacity: 1; color: var(--c-fg); }
    .tc-role-select.is-error { color: #c87e7e; }
    .tc-add-btn { background: none; border: none; cursor: pointer; font-size: 15px; line-height: 1; color: var(--c-fg-dim); opacity: 0.4; padding: 0 2px; flex-shrink: 0; }
    .tc-add-btn:hover { opacity: 1; color: var(--c-link, #3b82f6); }
    .tc-codes { display: flex; flex-wrap: wrap; gap: 3px; min-height: 4px; }
    .tc-concepts { display: flex; flex-wrap: wrap; gap: 3px; margin-bottom: 3px; }
    .tc-concept {
      font-size: 10.35px;
      padding: 1px 5px;
      border-radius: 10px;
      color: var(--c-fg-dim, currentColor);
      border: 1px dashed color-mix(in srgb, var(--c-link, #3b82f6) 28%, transparent);
    }
    .tc-concept.is-reused {
      border-style: solid;
      color: var(--c-fg, currentColor);
      background: color-mix(in srgb, var(--c-link, #3b82f6) 8%, transparent);
    }
    .tc-concept.is-orphan::after, .tc-chip.is-orphan::after {
      content: "";
      width: 3px;
      height: 3px;
      border-radius: 50%;
      background: #c34848;
      flex-shrink: 0;
    }
    .tc-chip { display: inline-flex; align-items: center; gap: 2px; background: var(--c-bg-mute); border-radius: 10px; padding: 1px 4px 1px 6px; cursor: pointer; transition: background 120ms; }
    .tc-chip.is-emergent { outline: 1px dashed color-mix(in srgb, var(--c-link, #3b82f6) 34%, transparent); }
    .tc-chip:hover { background: color-mix(in srgb, var(--c-link, #3b82f6) 15%, var(--c-bg-mute)); }
    .tc-chip.is-highlighted { background: color-mix(in srgb, var(--c-link, #3b82f6) 22%, var(--c-bg-mute)); outline: 1px solid color-mix(in srgb, var(--c-link, #3b82f6) 40%, transparent); }
    .tc-chip-label { font-size: 11.5px; color: var(--c-fg); }
    .tc-chip-del { background: none; border: none; cursor: pointer; font-size: 12.65px; line-height: 1; color: var(--c-fg-dim); padding: 0; opacity: 0.45; }
    .tc-chip-del:hover { opacity: 1; color: #c87e7e; }
    .tc-add-input { width: 100%; font-size: 11.5px; border: 1px solid var(--c-link, #3b82f6); background: var(--c-bg); color: var(--c-fg); border-radius: 3px; padding: 2px 4px; margin-top: 3px; box-sizing: border-box; outline: none; }
    .tc-mode-row { display:flex; align-items:center; gap:6px; padding: 1px 8px 6px; font-size:10.35px; opacity:.76; }
    .tc-mode-select { margin-left:auto; min-width:88px; border:1px solid var(--c-border, rgba(120,120,140,.22)); border-radius:3px; background:transparent; color:inherit; font:inherit; }
    .tc-graph { flex-shrink: 0; padding-top: 4px; }
    .tc-subhead { font-size: 10.35px; opacity: .42; padding: 2px 8px 5px; letter-spacing: .09em; text-transform: uppercase; }
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
    .tc-empty { margin: 0; padding: 7px 8px; font-size: 11.5px; opacity: .45; }
    .tc-lexical-tools { padding: 2px 8px 7px; }
    .tc-lexical-input {
      width: 100%;
      box-sizing: border-box;
      border: 1px solid var(--c-border, rgba(120,120,140,.24));
      border-radius: 3px;
      background: transparent;
      color: inherit;
      font: inherit;
      font-size: 11.5px;
      padding: 3px 5px;
      margin-bottom: 6px;
    }
    .tc-frequency-row { display: grid; grid-template-columns: 21px 1fr auto; align-items: center; gap: 5px; padding: 2px 0; cursor: pointer; }
    .tc-frequency-bar, .tc-zipf-bar {
      height: 6px;
      min-width: 3px;
      max-width: 92px;
      border-radius: 2px;
      background: var(--c-link, #3b82f6);
      opacity: .48;
    }
    .tc-frequency-label, .tc-zipf-label { font-size: 11.5px; opacity: .72; font-family: var(--font-mono, monospace); }
    .tc-kwic { margin-top: 7px; border-top: 1px solid var(--c-border, rgba(120,120,140,.12)); padding-top: 5px; }
    .tc-kwic-row { font-size: 10.35px; line-height: 1.45; opacity: .74; font-family: var(--font-mono, monospace); padding: 2px 0; }
    .tc-kwic-row mark { background: color-mix(in srgb, var(--c-link, #3b82f6) 22%, transparent); color: inherit; border-radius: 2px; }
    .tc-zipf-stats, .tc-qa-copy { padding: 2px 8px 7px; font-size: 11.5px; line-height: 1.5; opacity: .65; }
    .tc-zipf-row { display: grid; grid-template-columns: 21px 1fr auto; gap: 4px; align-items: center; padding: 2px 8px; }
    .tc-zipf-rank { font-size: 10.35px; opacity: .42; font-family: var(--font-mono, monospace); }
    .tc-zipf-bars { display: flex; align-items: center; gap: 5px; min-width: 0; }
    .tc-qa-metrics { display: flex; gap: 5px; flex-wrap: wrap; padding: 2px 8px 5px; }
    .tc-qa-metric { padding: 2px 5px; border: 1px solid var(--c-border, rgba(120,120,140,.18)); border-radius: 10px; font-size: 10.35px; opacity: .65; }
  `;
  document.head.appendChild(s);
}

// ── SVG graph ──────────────────────────────────────────────────────────────

function renderTraceGraph(
  paras: Paragraph[],
  traces: ParagraphTrace[],
  onJumpToParagraph: (para: Paragraph) => void,
  onHoverParagraph: (paraIndex: number | null) => void,
): SVGSVGElement {
  const SPACING = 38;
  const R = 9;
  const CX = 16;
  const W = 52;
  const h = paras.length * SPACING + 20;
  const graphPositions = new Map(paras.map((para, position) => [para.index, position]));

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${h}`);
  svg.setAttribute('width', String(W));
  svg.setAttribute('height', String(h));
  svg.className.baseVal = 'tc-svg';

  const drawnPairs = new Set<string>();
  for (const trace of traces) {
    for (const relation of trace.relaciones) {
        const sourcePosition = graphPositions.get(relation.indiceObjetivo);
        const targetPosition = graphPositions.get(trace.paraIndex);
        if (sourcePosition === undefined || targetPosition === undefined) continue;
        const key = `${relation.indiceObjetivo},${trace.paraIndex}`;
        if (drawnPairs.has(key)) continue;
        drawnPairs.add(key);
        const y1 = 10 + sourcePosition * SPACING;
        const y2 = 10 + targetPosition * SPACING;
        const dist = targetPosition - sourcePosition;
        const ctrl = Math.min(10 + dist * 6, 30);
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', `M ${CX + R} ${y1} C ${CX + R + ctrl} ${y1}, ${CX + R + ctrl} ${y2}, ${CX + R} ${y2}`);
        path.setAttribute('fill', 'none');
        path.setAttribute('stroke', 'var(--c-link, #3b82f6)');
        path.setAttribute('stroke-width', '1.2');
        path.setAttribute('opacity', '0.3');
        path.setAttribute('aria-label', `P${trace.paraIndex} retoma P${relation.indiceObjetivo}: ${relation.evidencia}`);
        path.classList.add('tc-graph-link');
        path.dataset.from = String(relation.indiceObjetivo);
        path.dataset.to = String(trace.paraIndex);
        svg.appendChild(path);
    }
  }

  for (const [position, para] of paras.entries()) {
    const cy = 10 + position * SPACING;
    const trace = traces.find(item => item.paraIndex === para.index);
    const role = trace?.rolRetorico ? ROLE_PRESENTATION[trace.rolRetorico] : null;
    const fill = role
      ? `hsl(${role.hue}, 48%, 62%)`
      : `color-mix(in srgb, var(--c-link, #3b82f6) ${Math.min(80, (trace?.conceptos.length ?? 0) * 12)}%, var(--c-bg-mute, #f0f0f0))`;

    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', String(CX));
    circle.setAttribute('cy', String(cy));
    circle.setAttribute('r', String(R));
    circle.setAttribute('fill', fill);
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
    text.setAttribute('font-size', '8.05');
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

function restartAnimation(element: Element, className: string) {
  element.classList.remove(className);
  requestAnimationFrame(() => {
    if (element.isConnected) element.classList.add(className);
  });
}

function applyMonitorActivity(traceCol: HTMLElement, state: MonitorState, animate: boolean) {
  traceCol.querySelectorAll<HTMLElement>('.tc-row').forEach(row => {
    const index = Number(row.dataset.paraIndex);
    const isActive = index === state.activeParagraph;
    row.classList.toggle('is-visible', state.visibleParagraphs.has(index));
    row.classList.toggle('is-active', isActive);
    if (animate && isActive) {
      restartAnimation(row, 'is-entering');
    }
  });
  traceCol.querySelectorAll<SVGElement>('.tc-graph-node').forEach(node => {
    const index = Number(node.dataset.paraIndex);
    const isActive = index === state.activeParagraph;
    node.classList.toggle('is-visible', state.visibleParagraphs.has(index));
    node.classList.toggle('is-active', isActive);
    if (animate && isActive) {
      restartAnimation(node, 'is-entering');
    }
  });
  traceCol.querySelectorAll<SVGElement>('.tc-graph-link').forEach(link => {
    link.classList.toggle('is-active', state.activeParagraph !== null
      && (Number(link.dataset.from) === state.activeParagraph || Number(link.dataset.to) === state.activeParagraph));
  });
  const context = traceCol.querySelector<HTMLElement>('.tc-live-context');
  if (context) context.textContent = state.activeParagraph === null ? 'LIVE' : `LIVE · P${state.activeParagraph}`;
}

type TraceRowMeasurement = {
  row: HTMLElement;
  hidden: boolean;
  top?: number;
  height?: number;
};

function requestTraceRowsSync(traceCol: HTMLElement, paras: Paragraph[], editorView: EditorView) {
  editorView.requestMeasure<TraceRowMeasurement[]>({
    key: traceCol,
    read: () => {
      const list = traceCol.querySelector<HTMLElement>('.tc-list');
      if (!list || !traceCol.isConnected) return [];
      const listTop = list.getBoundingClientRect().top;
      const listHeight = list.clientHeight;
      const docLength = editorView.state.doc.length;
      const measurements: TraceRowMeasurement[] = [];
      for (const para of paras) {
        const row = list.querySelector<HTMLElement>(`.tc-row[data-para-index="${para.index}"]`);
        if (!row) continue;
        const from = Math.min(para.from, docLength);
        const to = Math.max(from, Math.min(para.to, docLength));
        const start = editorView.coordsAtPos(from);
        const end = editorView.coordsAtPos(to, -1);
        if (!start || !end) {
          measurements.push({ row, hidden: true });
          continue;
        }
        const visualHeight = Math.max(start.bottom - start.top, end.bottom - start.top);
        const compactShift = visualHeight < 34 ? 2 : 0;
        const top = start.top - listTop + compactShift;
        const height = Math.max(34, visualHeight - compactShift);
        measurements.push({
          row,
          hidden: top + height < 0 || top > listHeight,
          top: Math.round(top),
          height: Math.round(height),
        });
      }
      return measurements;
    },
    write: measurements => {
      for (const measurement of measurements) {
        measurement.row.hidden = measurement.hidden;
        if (measurement.top === undefined || measurement.height === undefined) continue;
        measurement.row.style.top = `${measurement.top}px`;
        measurement.row.style.setProperty('--tc-para-height', `${measurement.height}px`);
      }
    },
  });
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

function appendFreqZipfSection(monitor: HTMLElement, text: string, state: MonitorState) {
  const body = createMonitorSection(monitor, 'zipf', 'Freq · Zipf', state);
  const tools = document.createElement('div');
  tools.className = 'tc-lexical-tools';
  body.appendChild(tools);

  const profile = computeZipfProfile(text, 12);
  const stats = document.createElement('div');
  stats.className = 'tc-zipf-stats';
  stats.textContent = profile.slope === null
    ? 'Distribución insuficiente para estimar una pendiente.'
    : `${profile.tokenCount} tokens · ${profile.vocabularySize} términos · pendiente log-log ${profile.slope.toFixed(2)}`;
  tools.appendChild(stats);

  const input = document.createElement('input');
  input.className = 'tc-lexical-input';
  input.placeholder = 'concordancia...';
  if (!state.lexicalQuery && profile.points[0]) state.lexicalQuery = profile.points[0].word;
  input.value = state.lexicalQuery;
  tools.appendChild(input);

  const freqHead = document.createElement('div');
  freqHead.className = 'tc-subhead';
  freqHead.textContent = 'Rango · frecuencia observada';
  tools.appendChild(freqHead);

  if (profile.points.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'tc-empty';
    empty.textContent = 'Sin términos suficientes';
    tools.appendChild(empty);
  }
  for (const point of profile.points) {
    const row = document.createElement('div');
    row.className = 'tc-frequency-row';
    row.title = 'Ver concordancias';
    const rank = document.createElement('span');
    rank.className = 'tc-zipf-rank';
    rank.textContent = `#${point.rank}`;
    const bars = document.createElement('span');
    bars.className = 'tc-zipf-bars';
    const bar = document.createElement('span');
    bar.className = 'tc-frequency-bar';
    bar.style.width = `${Math.max(4, (point.count / (profile.points[0]?.count ?? 1)) * 100)}%`;
    const label = document.createElement('span');
    label.className = 'tc-frequency-label';
    label.textContent = point.word;
    bars.append(bar, label);
    const count = document.createElement('span');
    count.className = 'tc-frequency-label';
    count.title = `Ideal Zipf aproximado: ${point.expected.toFixed(1)}`;
    count.textContent = String(point.count);
    row.append(rank, bars, count);
    row.addEventListener('click', () => {
      state.lexicalQuery = point.word;
      input.value = point.word;
      renderKwicLines(kwic, text, point.word);
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

function appendQaSection(
  monitor: HTMLElement,
  codes: TraceCode[],
  traces: ParagraphTrace[],
  state: MonitorState,
  analyzedParas: Paragraph[],
) {
  const body = createMonitorSection(monitor, 'qa', 'QA', state);
  const analyzedIndices = new Set(analyzedParas.map(para => para.index));
  const traceCodes = analyticalCodes(codes).filter(code => analyzedIndices.has(code.paraIndex));
  const metrics = document.createElement('div');
  metrics.className = 'tc-qa-metrics';
  const emergent = traces.reduce(
    (total, trace) => total + trace.conceptos.filter(concept => concept.estado === 'reutilizado').length,
    0,
  );
  const roles = traces.filter(trace => trace.rolRetorico).length;
  const warnings = traces.reduce((total, trace) => total + trace.diagnosticos.length, 0);
  const values = [
    `${traceCodes.length} códigos`,
    `${emergent} emergentes`,
    `${roles} roles`,
    `${warnings} indicios`,
  ];
  for (const value of values) {
    const metric = document.createElement('span');
    metric.className = 'tc-qa-metric';
    metric.textContent = value;
    metrics.appendChild(metric);
  }
  const copy = document.createElement('div');
  copy.className = 'tc-qa-copy';
  copy.textContent = state.mode === 'artistico'
    ? 'Lit Art: se omiten párrafos breves de una o dos líneas.'
    : 'Indicios locales de cohesión: no califican la calidad del argumento.';
  body.append(metrics, copy);
}

function renderMargin(
  traceCol: HTMLElement,
  analysisCol: HTMLElement,
  paras: Paragraph[],
  codes: TraceCode[],
  traces: ParagraphTrace[],
  noteId: string,
  editorView: EditorView,
  onCodesChange: (codes: TraceCode[]) => void,
  onModeChange: (mode: TraceMode) => void,
  state: MonitorState,
) {
  traceCol.innerHTML = '';
  analysisCol.innerHTML = '';
  const analyzedParas = paragraphsForAnalysis(paras, state.mode);
  const traceCodes = analyticalCodes(codes);
  const orphans = computeOrphanLabels(traceCodes);
  const traceMonitor = document.createElement('div');
  traceMonitor.className = 'tc-monitor';
  traceCol.appendChild(traceMonitor);
  const analysisMonitor = document.createElement('div');
  analysisMonitor.className = 'tc-monitor';
  analysisCol.appendChild(analysisMonitor);
  const traceBody = createMonitorSection(traceMonitor, 'trace', 'Trace', state);
  const modeRow = document.createElement('label');
  modeRow.className = 'tc-mode-row';
  modeRow.textContent = 'Modo';
  const modeSelect = document.createElement('select');
  modeSelect.className = 'tc-mode-select';
  modeSelect.title = 'Modo del análisis estructural';
  for (const [value, label] of Object.entries(MODE_LABELS) as [TraceMode, string][]) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    modeSelect.appendChild(option);
  }
  modeSelect.value = state.mode;
  modeSelect.addEventListener('change', () => onModeChange(modeSelect.value as TraceMode));
  modeRow.appendChild(modeSelect);
  const jumpToParagraph = (para: Paragraph) => {
    editorView.dispatch({
      selection: { anchor: Math.min(para.from, editorView.state.doc.length) },
      effects: EditorView.scrollIntoView(Math.min(para.from, editorView.state.doc.length), { y: 'center' }),
    });
    editorView.focus();
  };
  const hoverParagraph = (paraIndex: number | null) => {
    setHoveredParagraph(traceCol, paraIndex);
    setHoveredParagraph(analysisCol, paraIndex);
  };

  const list = document.createElement('div');
  list.className = 'tc-list';

  if (analyzedParas.length === 0) {
    const msg = document.createElement('p');
    msg.style.cssText = 'padding:8px;opacity:.4;font-size:10px;margin:0';
    msg.textContent = state.mode === 'artistico'
      ? '[sin párrafos extensos para analizar]'
      : '[sin párrafos]';
    list.appendChild(msg);
  }

  for (const para of analyzedParas) {
    const paraCodes = traceCodes.filter(c => c.paraIndex === para.index);
    const rhetoricalCode = codes.find(c => c.paraIndex === para.index && c.dimension === 'rhetorical');
    const localTrace = traces.find(trace => trace.paraIndex === para.index);
    const currentRole = localTrace?.rolRetorico ?? (roleValue(rhetoricalCode) || null);
    const diagnosticLabels = new Set((localTrace?.diagnosticos ?? [])
      .map(diagnostic => diagnostic.etiqueta ?? diagnostic.mensaje?.match(/^"(.+?)"/)?.[1])
      .filter((label): label is string => Boolean(label)));
    const row = document.createElement('div');
    row.className = 'tc-row';
    row.dataset.paraIndex = String(para.index);
    row.addEventListener('mouseenter', () => hoverParagraph(para.index));
    row.addEventListener('mouseleave', () => hoverParagraph(null));

    const roleRail = document.createElement('span');
    roleRail.className = 'tc-role-rail';
    if (currentRole) {
      const roleStyle = ROLE_PRESENTATION[currentRole];
      roleRail.textContent = roleStyle.short;
      roleRail.style.setProperty('--tc-role-color', `hsl(${roleStyle.hue}, 55%, 55%)`);
      roleRail.title = roleStyle.label;
    }
    row.appendChild(roleRail);

    const head = document.createElement('div');
    head.className = 'tc-row-head';

    const paraLabel = document.createElement('button');
    paraLabel.type = 'button';
    paraLabel.className = 'tc-para-label';
    paraLabel.title = 'Ir al párrafo';
    paraLabel.textContent = `P${para.index}`;
    paraLabel.addEventListener('click', () => jumpToParagraph(para));
    head.appendChild(paraLabel);

    const roleSelect = document.createElement('select');
    roleSelect.className = 'tc-role-select';
    roleSelect.title = 'Rol retórico del párrafo';
    roleSelect.setAttribute('aria-label', `Rol retórico de P${para.index}`);
    const emptyRole = document.createElement('option');
    emptyRole.value = '';
    emptyRole.textContent = '— rol';
    roleSelect.appendChild(emptyRole);
    for (const role of RHETORICAL_ROLES) {
      const option = document.createElement('option');
      option.value = role;
      option.textContent = ROLE_PRESENTATION[role].label;
      roleSelect.appendChild(option);
    }
    roleSelect.value = currentRole ?? '';
    roleSelect.addEventListener('change', async () => {
      const previousValue = currentRole ?? '';
      const nextValue = roleSelect.value;
      roleSelect.disabled = true;
      try {
        if (!nextValue) {
          if (!rhetoricalCode) return;
          const res = await fetch(`/api/live/notes/trace?id=${rhetoricalCode.id}`, { method: 'DELETE' });
          if (!res.ok) throw new Error('delete failed');
          onCodesChange(codes.filter(code => code.id !== rhetoricalCode.id));
          return;
        }
        const res = await fetch('/api/live/notes/trace', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            noteId,
            paraIndex: para.index,
            label: `rol:${nextValue}`,
            dimension: 'rhetorical',
          }),
        });
        if (!res.ok) throw new Error('save failed');
        const data = await res.json() as { code?: TraceCode };
        if (data.code) {
          onCodesChange([
            ...codes.filter(code => !(code.paraIndex === para.index && code.dimension === 'rhetorical')),
            data.code,
          ]);
        }
      } catch {
        roleSelect.value = previousValue;
        roleSelect.classList.add('is-error');
        setTimeout(() => roleSelect.classList.remove('is-error'), 1500);
      } finally {
        roleSelect.disabled = false;
      }
    });
    head.appendChild(roleSelect);

    const addBtn = document.createElement('button');
    addBtn.className = 'tc-add-btn';
    addBtn.title = 'Añadir código';
    addBtn.textContent = '⊕';
    head.appendChild(addBtn);

    row.appendChild(head);

    const conceptsEl = document.createElement('div');
    conceptsEl.className = 'tc-concepts';
    for (const concept of localTrace?.conceptos ?? []) {
      const chip = document.createElement('span');
      chip.className = 'tc-concept';
      if (concept.estado === 'reutilizado') chip.classList.add('is-reused');
      if (diagnosticLabels.has(concept.etiqueta)) {
        chip.classList.add('is-orphan');
      }
      chip.textContent = concept.etiqueta;
      chip.title = `${concept.estado} · confianza local ${Math.round(concept.confianza * 100)}%`;
      conceptsEl.appendChild(chip);
    }
    row.appendChild(conceptsEl);

    const codesEl = document.createElement('div');
    codesEl.className = 'tc-codes';
    const highlighted = editorView.state.field(highlightField, false) ?? new Set<number>();

    for (const code of paraCodes) {
      const chip = document.createElement('span');
      chip.className = 'tc-chip';
      if (orphans.has(code.label)) chip.classList.add('is-orphan');
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
        const matchingParas = traceCodes.filter(c => c.label === code.label).map(c => c.paraIndex);
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

  const structureBody = createMonitorSection(analysisMonitor, 'estructura', 'Estructura', state);
  structureBody.appendChild(modeRow);
  const graph = document.createElement('div');
  graph.className = 'tc-graph';
  if (analyzedParas.length > 0) {
    graph.appendChild(renderTraceGraph(analyzedParas, traces, jumpToParagraph, hoverParagraph));
  }
  structureBody.appendChild(graph);

  const text = state.mode === 'artistico'
    ? analyzedParas.map(para => para.text).join('\n\n')
    : editorView.state.doc.toString();
  appendFreqZipfSection(analysisMonitor, text, state);
  appendQaSection(analysisMonitor, codes, traces, state, analyzedParas);
}

// ── Public API ─────────────────────────────────────────────────────────────

export async function mountTraceMargin(
  editorView: EditorView,
  noteId: string,
  panelBodyEl: HTMLElement,
): Promise<TraceMarginHandle> {
  injectTraceCss();

  const paras = segmentParagraphs(editorView.state.doc.toString());
  let currentCodes: TraceCode[] = [];
  let currentTraces: ParagraphTrace[] = [];
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  let pulseTimer: ReturnType<typeof setTimeout> | null = null;
  let refreshVersion = 0;
  let active = true;
  const monitorState: MonitorState = {
    open: { trace: true, estructura: true, zipf: false, qa: false },
    lexicalQuery: '',
    activeParagraph: null,
    visibleParagraphs: new Set<number>(),
    mode: 'borrador',
  };

  const refreshFromDocument = () => {
    if (refreshTimer) clearTimeout(refreshTimer);
    const version = ++refreshVersion;
    refreshTimer = setTimeout(async () => {
      if (!active || version !== refreshVersion) return;
      const nextParas = segmentParagraphs(editorView.state.doc.toString());
      paras.splice(0, paras.length, ...nextParas);
      if (!active || version !== refreshVersion) return;
      await analyzeAndRender(currentCodes);
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
  traceCol.className = 'cnw-trace-col cnw-trace-rail';
  const analysisCol = document.createElement('div');
  analysisCol.className = 'cnw-trace-col cnw-analysis-col';
  panelBodyEl.append(traceCol, analysisCol);

  const syncEditorActivity = (view: EditorView, animate: boolean) => {
    const nextActive = resolveParagraphIndex(paras, view.state.selection.main.head);
    const enteredParagraph = nextActive !== monitorState.activeParagraph;
    monitorState.activeParagraph = nextActive;
    monitorState.visibleParagraphs = collectParagraphIndicesInRange(paras, view.viewport.from, view.viewport.to);
    applyMonitorActivity(traceCol, monitorState, animate && enteredParagraph);
    applyMonitorActivity(analysisCol, monitorState, animate && enteredParagraph);
    requestTraceRowsSync(traceCol, paras, view);
    if (animate && enteredParagraph) {
      const traceSection = traceCol.querySelector<HTMLElement>('.tc-section--trace');
      if (traceSection) {
        restartAnimation(traceSection, 'is-traversing');
      }
    }
  };

  const rerender = (newCodes: TraceCode[], newTraces: ParagraphTrace[]) => {
    currentCodes = newCodes;
    currentTraces = newTraces;
    editorView.dispatch({ effects: setCodeBars.of(currentCodes) });
    renderMargin(
      traceCol,
      analysisCol,
      paras,
      currentCodes,
      currentTraces,
      noteId,
      editorView,
      nextCodes => { void analyzeAndRender(nextCodes); },
      nextMode => {
        monitorState.mode = nextMode;
        void analyzeAndRender(currentCodes);
      },
      monitorState,
    );
    syncEditorActivity(editorView, false);
    const traceSection = traceCol.querySelector<HTMLElement>('.tc-section--trace');
    if (traceSection) {
      restartAnimation(traceSection, 'is-updating');
      if (pulseTimer) clearTimeout(pulseTimer);
      pulseTimer = setTimeout(() => traceSection.classList.remove('is-updating'), 430);
    }
  };

  const analyzeAndRender = async (nextCodes: TraceCode[]) => {
    const locallyAnalyzed = await computeLocalTraces(paras, nextCodes, monitorState.mode);
    if (!active) return;
    const storedTraces = await persistLocalTraces(noteId, locallyAnalyzed);
    if (!active) return;
    rerender(nextCodes, storedTraces);
  };

  const loadStoredTraceData = async () => {
    try {
      const res = await fetch(`/api/live/notes/trace?noteId=${encodeURIComponent(noteId)}`);
      if (res.ok) {
        const data = await res.json() as { codes?: TraceCode[]; traces?: ParagraphTrace[] };
        currentCodes = data.codes ?? [];
        currentTraces = data.traces ?? [];
        monitorState.mode = currentTraces[0]?.modo ?? monitorState.mode;
        if (!active) return;
        rerender(currentCodes, currentTraces);
      }
    } catch { /* keep locally rendered empty monitor */ }
    if (active) await analyzeAndRender(currentCodes);
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

  const onEditorScroll = () => requestTraceRowsSync(traceCol, paras, editorView);
  editorView.scrollDOM.addEventListener('scroll', onEditorScroll, { passive: true });
  const resizeObserver = typeof ResizeObserver !== 'undefined'
    ? new ResizeObserver(() => requestTraceRowsSync(traceCol, paras, editorView))
    : null;
  resizeObserver?.observe(panelBodyEl);

  rerender(currentCodes, currentTraces);
  void loadStoredTraceData();

  return {
    destroy() {
      active = false;
      if (refreshTimer) clearTimeout(refreshTimer);
      if (pulseTimer) clearTimeout(pulseTimer);
      editorView.scrollDOM.removeEventListener('scroll', onEditorScroll);
      resizeObserver?.disconnect();
      editorView.dispatch({ effects: setHighlight.of(new Set<number>()) });
      editorView.dispatch({ effects: setCodeBars.of([]) });
      editorView.dispatch({ effects: traceExtensions.reconfigure([]) });
      traceCol.remove();
      analysisCol.remove();
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
