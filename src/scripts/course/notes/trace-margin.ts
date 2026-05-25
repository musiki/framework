import {
  StateEffect, StateField, RangeSetBuilder,
} from '@codemirror/state';
import {
  EditorView, ViewPlugin, Decoration,
  type DecorationSet, type ViewUpdate,
} from '@codemirror/view';

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
    .tc-list { flex: 1; overflow-y: auto; padding: 4px 0; }
    .tc-row { padding: 4px 8px; border-bottom: 1px solid var(--c-border, rgba(120,120,140,0.08)); }
    .tc-row-head { display: flex; align-items: center; gap: 4px; margin-bottom: 3px; }
    .tc-para-label { font-size: 9px; font-family: var(--font-mono, monospace); opacity: 0.5; flex-shrink: 0; }
    .tc-role-chip { font-size: 9px; opacity: 0.35; flex: 1; }
    .tc-add-btn { background: none; border: none; cursor: pointer; font-size: 13px; line-height: 1; color: var(--c-fg-dim); opacity: 0.4; padding: 0 2px; flex-shrink: 0; }
    .tc-add-btn:hover { opacity: 1; color: var(--c-link, #3b82f6); }
    .tc-codes { display: flex; flex-wrap: wrap; gap: 3px; min-height: 4px; }
    .tc-chip { display: inline-flex; align-items: center; gap: 2px; background: var(--c-bg-mute); border-radius: 10px; padding: 1px 4px 1px 6px; cursor: pointer; transition: background 120ms; }
    .tc-chip:hover { background: color-mix(in srgb, var(--c-link, #3b82f6) 15%, var(--c-bg-mute)); }
    .tc-chip.is-highlighted { background: color-mix(in srgb, var(--c-link, #3b82f6) 22%, var(--c-bg-mute)); outline: 1px solid color-mix(in srgb, var(--c-link, #3b82f6) 40%, transparent); }
    .tc-chip-label { font-size: 10px; color: var(--c-fg); }
    .tc-chip-del { background: none; border: none; cursor: pointer; font-size: 11px; line-height: 1; color: var(--c-fg-dim); padding: 0; opacity: 0.45; }
    .tc-chip-del:hover { opacity: 1; color: #c87e7e; }
    .tc-orphan-badge { font-size: 9px; color: #c87e7e; opacity: 0.75; margin-left: auto; }
    .tc-add-input { width: 100%; font-size: 10px; border: 1px solid var(--c-link, #3b82f6); background: var(--c-bg); color: var(--c-fg); border-radius: 3px; padding: 2px 4px; margin-top: 3px; box-sizing: border-box; outline: none; }
    .tc-graph { border-top: 1px solid var(--c-border, rgba(120,120,140,0.15)); flex-shrink: 0; }
    .tc-graph summary { font-size: 9px; opacity: 0.4; padding: 4px 8px; cursor: pointer; user-select: none; letter-spacing: 0.05em; text-transform: uppercase; }
    .tc-svg { display: block; margin: 0 auto; padding-bottom: 8px; }
    .tc-chip-suggestion {
      opacity: 0.55;
      border: 1px dashed color-mix(in srgb, var(--c-link, #3b82f6) 60%, transparent);
      background: transparent;
    }
    .tc-chip-suggestion:hover { opacity: 0.9; background: color-mix(in srgb, var(--c-link, #3b82f6) 8%, var(--c-bg)); }
    .tc-chip-suggest-btn {
      background: none; border: none; cursor: pointer;
      font-size: 12px; line-height: 1;
      color: var(--c-link, #3b82f6);
      padding: 0 1px; opacity: 0.8;
    }
    .tc-chip-suggest-btn:hover { opacity: 1; }
  `;
  document.head.appendChild(s);
}

// ── SVG graph ──────────────────────────────────────────────────────────────

function renderTraceGraph(paras: Paragraph[], codes: TraceCode[]): SVGSVGElement {
  const SPACING = 38;
  const R = 9;
  const CX = 20;
  const h = paras.length * SPACING + 20;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 40 ${h}`);
  svg.setAttribute('width', '40');
  svg.setAttribute('height', String(h));
  svg.className.baseVal = 'tc-svg';

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
    svg.appendChild(circle);

    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', String(CX));
    text.setAttribute('y', String(cy + 3));
    text.setAttribute('text-anchor', 'middle');
    text.setAttribute('font-size', '7');
    text.setAttribute('fill', 'var(--c-fg, currentColor)');
    text.setAttribute('opacity', '0.7');
    text.textContent = `P${para.index}`;
    svg.appendChild(text);
  }

  return svg;
}

// ── Margin renderer ────────────────────────────────────────────────────────

function renderMargin(
  traceCol: HTMLElement,
  paras: Paragraph[],
  codes: TraceCode[],
  noteId: string,
  editorView: EditorView,
  onCodesChange: (codes: TraceCode[]) => void,
) {
  traceCol.innerHTML = '';
  const orphans = computeOrphanLabels(codes);

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

    const head = document.createElement('div');
    head.className = 'tc-row-head';

    const paraLabel = document.createElement('span');
    paraLabel.className = 'tc-para-label';
    paraLabel.textContent = `P${para.index}`;
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

    // NLP suggestion chips
    const suggestions = computeSuggestions(paras, codes);
    const paraSuggestions = suggestions.filter(s => s.paraIndex === para.index);
    for (const suggestion of paraSuggestions) {
      const chip = document.createElement('span');
      chip.className = 'tc-chip tc-chip-suggestion';
      chip.title = `Sugerencia automática (aparece en múltiples párrafos)`;

      const labelEl = document.createElement('span');
      labelEl.className = 'tc-chip-label';
      labelEl.textContent = suggestion.label;
      chip.appendChild(labelEl);

      const confirmBtn = document.createElement('button');
      confirmBtn.className = 'tc-chip-suggest-btn';
      confirmBtn.title = 'Confirmar como código';
      confirmBtn.textContent = '+';
      chip.appendChild(confirmBtn);

      confirmBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          const res = await fetch('/api/live/notes/trace', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ noteId, paraIndex: para.index, label: suggestion.label }),
          });
          if (!res.ok) throw new Error('save failed');
          const data = await res.json() as { code?: TraceCode };
          if (data.code) onCodesChange([...codes, data.code]);
        } catch {
          chip.style.outline = '1px solid #c87e7e';
          setTimeout(() => { chip.style.outline = ''; }, 1500);
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

  traceCol.appendChild(list);

  const graph = document.createElement('details');
  graph.className = 'tc-graph';
  const summary = document.createElement('summary');
  summary.textContent = 'estructura';
  graph.appendChild(summary);
  if (paras.length > 0) graph.appendChild(renderTraceGraph(paras, codes));
  traceCol.appendChild(graph);
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

  editorView.dispatch({
    effects: StateEffect.appendConfig.of([
      highlightField, makeHighlightPlugin(paras),
      codeBarField,   makeCodeBarPlugin(paras),
    ]),
  });

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

  let currentCodes = codes;

  const rerender = (newCodes: TraceCode[]) => {
    currentCodes = newCodes;
    editorView.dispatch({ effects: setCodeBars.of(currentCodes) });
    renderMargin(traceCol, paras, currentCodes, noteId, editorView, rerender);
  };

  rerender(currentCodes);

  return {
    destroy() {
      editorView.dispatch({ effects: setHighlight.of(new Set<number>()) });
      editorView.dispatch({ effects: setCodeBars.of([]) });
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
