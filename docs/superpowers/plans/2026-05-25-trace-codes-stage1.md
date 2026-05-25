# Trace Codes Stage 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Local NLP auto-suggestions (keyword chains across paragraphs) + permanent colored code bars in the editor margin per paragraph.

**Architecture:** Three additions to the existing Stage 0 infrastructure. (1) Three new pure functions (`extractKeywords`, `detectChains`, `computeSuggestions`) added to both `trace-utils.mjs` (Node-testable) and `trace-margin.ts` (browser). (2) A new CM6 extension (`codeBarField` + `makeCodeBarPlugin`) that draws a permanent colored `border-left` on each line of paragraphs that have codes — color derived deterministically from the label string. (3) Suggestion chips rendered after existing chips in each margin row: faint dashed chips with a `+` confirm button that calls the existing POST API.

**Tech Stack:** Node `node:test` for unit tests. CodeMirror 6 (`@codemirror/state`, `@codemirror/view`). No new npm dependencies. No new API endpoints.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| MODIFY | `src/scripts/course/notes/trace-utils.mjs` | Add `STOPWORDS`, `extractKeywords`, `detectChains`, `computeSuggestions` |
| MODIFY | `src/scripts/course/notes/trace-utils.test.mjs` | Add 12 new tests for the three functions |
| MODIFY | `src/scripts/course/notes/trace-margin.ts` | Mirror NLP functions in TS; add `TraceSuggestion` type, `labelHue`, `setCodeBars`/`codeBarField`/`makeCodeBarPlugin`; update `injectTraceCss`, `renderMargin`, `mountTraceMargin`, `destroy` |

---

## Task 1: NLP Pure Functions + Tests (TDD)

**Files:**
- Modify: `src/scripts/course/notes/trace-utils.mjs`
- Modify: `src/scripts/course/notes/trace-utils.test.mjs`

### Step-by-step

- [ ] **Step 1: Write the failing tests first**

Append these tests to `src/scripts/course/notes/trace-utils.test.mjs` (after the existing `computeOrphanLabels` describe block):

```javascript
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  segmentParagraphs, computeOrphanLabels,
  extractKeywords, detectChains, computeSuggestions,
} from './trace-utils.mjs';

// existing tests above…

describe('extractKeywords', () => {
  test('returns top keywords by frequency', () => {
    const kws = extractKeywords('síntesis síntesis contrapunto contrapunto contrapunto melodía');
    assert.ok(kws.includes('contrapunto'));
    assert.ok(kws.includes('síntesis'));
  });

  test('filters tokens shorter than MIN_KEYWORD_LEN', () => {
    const kws = extractKeywords('si no es tan muy bien');
    assert.deepEqual(kws, []);
  });

  test('filters stopwords', () => {
    const kws = extractKeywords('través también además cuando donde forma lugar');
    assert.deepEqual(kws, []);
  });

  test('returns at most 5 keywords', () => {
    const text = 'alpha beta gamma delta epsilon zeta theta iota';
    assert.ok(extractKeywords(text).length <= 5);
  });

  test('returns empty array for empty string', () => {
    assert.deepEqual(extractKeywords(''), []);
  });

  test('handles accented unicode letters', () => {
    const kws = extractKeywords('armonía armonía tonalidad tonalidad');
    assert.ok(kws.includes('armonía'));
    assert.ok(kws.includes('tonalidad'));
  });
});

describe('detectChains', () => {
  test('returns label → paraIndices for keywords in ≥2 paras', () => {
    const paras = [
      { index: 0, keywords: ['contrapunto', 'melodía'] },
      { index: 1, keywords: ['contrapunto', 'armonía'] },
    ];
    const chains = detectChains(paras);
    assert.ok(chains.has('contrapunto'));
    assert.deepEqual(chains.get('contrapunto'), [0, 1]);
  });

  test('does NOT return keywords appearing in only one paragraph', () => {
    const paras = [
      { index: 0, keywords: ['única'] },
      { index: 1, keywords: ['otra'] },
    ];
    const chains = detectChains(paras);
    assert.equal(chains.size, 0);
  });

  test('returns empty Map for empty input', () => {
    assert.equal(detectChains([]).size, 0);
  });
});

describe('computeSuggestions', () => {
  test('returns suggestion when chain keyword not yet coded', () => {
    const paras = [
      { index: 0, text: 'contrapunto contrapunto melodía' },
      { index: 1, text: 'contrapunto armonía armonía' },
    ];
    const suggestions = computeSuggestions(paras, []);
    assert.ok(suggestions.some(s => s.label === 'contrapunto' && s.paraIndex === 0));
    assert.ok(suggestions.some(s => s.label === 'contrapunto' && s.paraIndex === 1));
  });

  test('does NOT suggest a label already coded on that paragraph', () => {
    const paras = [
      { index: 0, text: 'contrapunto contrapunto melodía' },
      { index: 1, text: 'contrapunto armonía armonía' },
    ];
    const codes = [{ label: 'contrapunto', paraIndex: 0 }];
    const suggestions = computeSuggestions(paras, codes);
    assert.ok(!suggestions.some(s => s.label === 'contrapunto' && s.paraIndex === 0));
    assert.ok(suggestions.some(s => s.label === 'contrapunto' && s.paraIndex === 1));
  });

  test('returns empty array for single paragraph (no chains possible)', () => {
    const paras = [{ index: 0, text: 'contrapunto melodía armonía síntesis' }];
    assert.deepEqual(computeSuggestions(paras, []), []);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm test 2>&1 | grep -E "trace-utils|extractKeywords|detectChains|computeSuggestions|✖" | head -20
```

Expected: `SyntaxError` or `ReferenceError: extractKeywords is not defined` (or similar — functions not exported yet).

- [ ] **Step 3: Implement the three functions in trace-utils.mjs**

Replace the full contents of `src/scripts/course/notes/trace-utils.mjs` with:

```javascript
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

// ── NLP ────────────────────────────────────────────────────────────────────

export const MIN_KEYWORD_LEN = 4;
export const TOP_KEYWORDS_PER_PARA = 5;

export const STOPWORDS = new Set([
  // Spanish function words and very common content words
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
  // English function words (texts may be bilingual)
  'that', 'with', 'this', 'have', 'from', 'they', 'will', 'been', 'were',
  'said', 'each', 'which', 'their', 'there', 'when', 'what', 'make', 'like',
  'time', 'just', 'know', 'take', 'into', 'year', 'your', 'good', 'some',
  'could', 'them', 'then', 'than', 'more', 'only', 'come', 'over', 'also',
  'back', 'after', 'first', 'well', 'most', 'about', 'would', 'very', 'these',
  'those', 'such', 'other', 'being', 'both', 'here', 'many', 'does', 'where',
  'through', 'because', 'between', 'without', 'during', 'before', 'should',
  'might', 'while', 'since', 'until', 'whether',
]);

/**
 * Extract top keywords from a paragraph.
 * paras: plain text string
 * Returns: array of up to TOP_KEYWORDS_PER_PARA lowercase token strings
 */
export function extractKeywords(text, stopwords = STOPWORDS) {
  const tokens = text
    .toLowerCase()
    .replace(/[^\p{L}]/gu, ' ')
    .split(/\s+/)
    .filter(t => t.length >= MIN_KEYWORD_LEN && !stopwords.has(t));

  const freq = new Map();
  for (const t of tokens) freq.set(t, (freq.get(t) ?? 0) + 1);

  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_KEYWORDS_PER_PARA)
    .map(([t]) => t);
}

/**
 * Detect keyword chains across paragraphs.
 * Input: Array<{ index: number, keywords: string[] }>
 * Returns: Map<string, number[]> — label → para indices where it appears (only labels in ≥2 paras)
 */
export function detectChains(paragraphsWithKeywords) {
  const labelToParas = new Map();
  for (const { index, keywords } of paragraphsWithKeywords) {
    for (const kw of keywords) {
      if (!labelToParas.has(kw)) labelToParas.set(kw, []);
      if (!labelToParas.get(kw).includes(index)) labelToParas.get(kw).push(index);
    }
  }
  return new Map([...labelToParas.entries()].filter(([, indices]) => indices.length >= 2));
}

/**
 * Compute NLP-derived code suggestions for all paragraphs.
 * paras: Array<{ index: number, text: string }>
 * codes: Array<{ label: string, paraIndex: number }>
 * Returns: Array<{ label: string, paraIndex: number }> — only unsatisfied suggestions
 */
export function computeSuggestions(paras, codes) {
  const withKeywords = paras.map(p => ({ index: p.index, keywords: extractKeywords(p.text) }));
  const chains = detectChains(withKeywords);
  const existingSet = new Set(codes.map(c => `${c.paraIndex}:${c.label}`));
  const suggestions = [];
  for (const [label, paraIndices] of chains) {
    for (const paraIndex of paraIndices) {
      if (!existingSet.has(`${paraIndex}:${label}`)) {
        suggestions.push({ label, paraIndex });
      }
    }
  }
  return suggestions;
}
```

- [ ] **Step 4: Run tests and verify all pass**

```bash
npm test 2>&1 | grep -E "extractKeywords|detectChains|computeSuggestions|✔|✖|pass|fail" | head -30
```

Expected: all existing tests still pass + all 12 new NLP tests pass. Zero failures.

- [ ] **Step 5: Commit**

```bash
git add src/scripts/course/notes/trace-utils.mjs src/scripts/course/notes/trace-utils.test.mjs
git commit -m "feat: add NLP functions to trace-utils — extractKeywords, detectChains, computeSuggestions (12 tests)"
```

---

## Task 2: Mirror NLP Functions + Code Bar CM6 Extension in trace-margin.ts

**Files:**
- Modify: `src/scripts/course/notes/trace-margin.ts`

The code bar extension draws a permanent colored `border-left` on every editor line that belongs to a paragraph with at least one code. Color is deterministically derived from the first code's label string (hash → HSL hue). The chain-click blue highlight (`.cnw-trace-hl` with `!important`) visually overrides the code bar when active.

- [ ] **Step 1: Add NLP constants and types after the `computeOrphanLabels` function**

In `src/scripts/course/notes/trace-margin.ts`, find the line:

```typescript
export function computeOrphanLabels(codes: TraceCode[]): Set<string> {
  const counts = new Map<string, number>();
  for (const c of codes) counts.set(c.label, (counts.get(c.label) ?? 0) + 1);
  return new Set([...counts.entries()].filter(([, n]) => n === 1).map(([l]) => l));
}
```

Append immediately after (before the `// ── CM6 chain highlight extension` comment):

```typescript
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
```

- [ ] **Step 2: Add the `labelHue` helper and code bar CM6 extension**

Find the line:

```typescript
// ── CM6 chain highlight extension ──────────────────────────────────────────
```

Insert immediately before it:

```typescript
// ── Label color utility ────────────────────────────────────────────────────

function labelHue(label: string): number {
  let h = 0;
  for (let i = 0; i < label.length; i++) h = (h * 31 + label.charCodeAt(i)) & 0x7fffffff;
  return h % 360;
}
```

Then find the end of the `// ── CM6 chain highlight extension ──` section (after the `makeHighlightPlugin` function closing brace). Insert the code bar extension immediately after:

```typescript
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
```

- [ ] **Step 3: Update `injectTraceCss` to add suggestion chip and code bar CSS**

Find the line in `injectTraceCss`:

```typescript
    .tc-svg { display: block; margin: 0 auto; padding-bottom: 8px; }
  `;
```

Replace with:

```typescript
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
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit --skipLibCheck 2>&1 | grep "trace-margin" | head -10
```

Expected: no output (no errors from this file).

- [ ] **Step 5: Commit**

```bash
git add src/scripts/course/notes/trace-margin.ts
git commit -m "feat: add NLP functions + code bar CM6 extension to trace-margin

extractKeywords/detectChains/computeSuggestions (mirrors trace-utils.mjs).
labelHue: deterministic HSL hue from label string.
setCodeBars + codeBarField + makeCodeBarPlugin: permanent colored left borders
per coded paragraph — color per first code label, overridable by chain-click highlight."
```

---

## Task 3: Suggestion Chips in renderMargin + Wire Code Bars in mountTraceMargin

**Files:**
- Modify: `src/scripts/course/notes/trace-margin.ts`

- [ ] **Step 1: Update `renderMargin` to show suggestion chips**

Find the end of the `for (const code of paraCodes)` loop in `renderMargin` (right after `codesEl.appendChild(chip);` inside the loop, before `row.appendChild(codesEl)`):

```typescript
    row.appendChild(codesEl);
```

Replace with:

```typescript
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
```

- [ ] **Step 2: Wire `codeBarField` + `makeCodeBarPlugin` into `mountTraceMargin`**

Find in `mountTraceMargin`:

```typescript
  editorView.dispatch({
    effects: StateEffect.appendConfig.of([highlightField, makeHighlightPlugin(paras)]),
  });
```

Replace with:

```typescript
  editorView.dispatch({
    effects: StateEffect.appendConfig.of([
      highlightField, makeHighlightPlugin(paras),
      codeBarField,   makeCodeBarPlugin(paras),
    ]),
  });
```

- [ ] **Step 3: Dispatch `setCodeBars` from `rerender` and clear on `destroy`**

Find in `mountTraceMargin`:

```typescript
  const rerender = (newCodes: TraceCode[]) => {
    currentCodes = newCodes;
    renderMargin(traceCol, paras, currentCodes, noteId, editorView, rerender);
  };
```

Replace with:

```typescript
  const rerender = (newCodes: TraceCode[]) => {
    currentCodes = newCodes;
    editorView.dispatch({ effects: setCodeBars.of(currentCodes) });
    renderMargin(traceCol, paras, currentCodes, noteId, editorView, rerender);
  };
```

Find in the `destroy()` method:

```typescript
    destroy() {
      editorView.dispatch({ effects: setHighlight.of(new Set<number>()) });
```

Replace with:

```typescript
    destroy() {
      editorView.dispatch({ effects: setHighlight.of(new Set<number>()) });
      editorView.dispatch({ effects: setCodeBars.of([]) });
```

- [ ] **Step 4: Seed code bars on initial mount**

Find in `mountTraceMargin`, after `rerender(currentCodes);`:

```typescript
  rerender(currentCodes);
```

Replace with:

```typescript
  rerender(currentCodes); // also dispatches setCodeBars.of(currentCodes) via rerender
```

(No code change needed — `rerender` already dispatches `setCodeBars` now. This step is a verification that the initial dispatch is covered.)

- [ ] **Step 5: Verify TypeScript compiles**

```bash
npx tsc --noEmit --skipLibCheck 2>&1 | grep "trace-margin" | head -10
```

Expected: no output.

- [ ] **Step 6: Run full test suite**

```bash
npm test 2>&1 | tail -10
```

Expected:
```
ℹ tests 41
ℹ pass 41
ℹ fail 0
```

(29 existing + 12 new NLP tests)

- [ ] **Step 7: Integration smoke test (manual)**

Start or confirm dev/prod server is running. Open a db-note with ≥2 paragraphs that share a keyword. Click `⊕` to open the trace margin.

Verify:
1. Suggestion chips (faint dashed border) appear in paragraph rows for the shared keyword
2. Click `+` on a suggestion → chip turns solid (confirmed code) and the colored code bar appears in the editor for that paragraph
3. Code bar color is consistent across page reload (same label → same color)
4. Chain-click (click a solid chip) still overlays the blue `cnw-trace-hl` highlight on top of the code bar color

- [ ] **Step 8: Commit**

```bash
git add src/scripts/course/notes/trace-margin.ts
git commit -m "feat: trace Stage 1 — NLP suggestion chips + colored code bars in editor

renderMargin: suggestion chips (dashed, faint) appear for chain keywords
not yet coded on a paragraph. Confirm with + → saves via POST API.

mountTraceMargin: injects codeBarField + makeCodeBarPlugin alongside
existing highlight extension. rerender() dispatches setCodeBars to keep
bars in sync with code list. destroy() clears bars."
```

---

## Self-Review

**Spec coverage:**
- [x] Lemmatize/extract keywords per paragraph → `extractKeywords` (uses token frequency + stopword filter + min-length)
- [x] Detect keyword chains (same keyword in ≥2 paragraphs) → `detectChains`
- [x] Show suggestions with confirm button → suggestion chips with `+` in `renderMargin`
- [x] Confirming a suggestion saves it as a regular code → POST to existing `/api/live/notes/trace`
- [x] Colored vertical bars per paragraph in editor → `codeBarField` + `makeCodeBarPlugin`
- [x] Color per label (deterministic) → `labelHue`
- [x] Chain-click highlight overrides code bar → `!important` on `.cnw-trace-hl` beats inline style

**Placeholder scan:** None found. All steps include complete code.

**Type consistency:**
- `TraceSuggestion = { label: string; paraIndex: number }` — used in `computeSuggestions` return, `renderMargin` call
- `setCodeBars` typed as `StateEffect.define<TraceCode[]>()` — used in `codeBarField`, `rerender`, `destroy`
- `makeCodeBarPlugin(paras: Paragraph[])` — injected alongside `makeHighlightPlugin(paras)` with same `paras` reference ✓
