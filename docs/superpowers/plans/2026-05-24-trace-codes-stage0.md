# Trace Codes Stage 0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Manual Trace Code annotation margin panel inside db-note panels — code tagging, chain highlighting, orphan detection, basic SVG graph.

**Architecture:** Approach A — `trace-margin.ts` owns all trace logic (CM6 extension, DOM, API calls). `dockview-shell.ts` adds `traceBtn`. `dockview-workspace.ts` wires the button via dynamic import. Pure functions mirrored in `trace-utils.mjs` for Node testing.

**Tech Stack:** CodeMirror 6 (`@codemirror/state`, `@codemirror/view`), Astro API routes, PostgreSQL via `query()` from `src/lib/db/pool`, `node:test` for unit tests.

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| CREATE | `postgres-patches/migrations/20260524120000_live_class_note_code.sql` | DB schema |
| CREATE | `src/scripts/course/notes/trace-utils.mjs` | Pure functions for Node testing |
| CREATE | `src/scripts/course/notes/trace-utils.test.mjs` | Unit tests |
| CREATE | `src/pages/api/live/notes/trace.ts` | GET/POST/DELETE API |
| CREATE | `src/scripts/course/notes/trace-margin.ts` | All trace UI logic + CM6 extension |
| MODIFY | `src/scripts/course/notes/live-md-editor.ts` | Add `getView()` to interface |
| MODIFY | `src/scripts/course/dockview-shell.ts` | Add `traceBtn` to `buildShell` |
| MODIFY | `src/scripts/course/dockview-workspace.ts` | Wire `traceBtn` → `mountTraceMargin` |
| MODIFY | `package.json` | Add notes test glob |

---

## Task 1: DB Migration

**Files:**
- Create: `postgres-patches/migrations/20260524120000_live_class_note_code.sql`

- [ ] **Step 1: Write the migration file**

```sql
-- postgres-patches/migrations/20260524120000_live_class_note_code.sql
CREATE TABLE IF NOT EXISTS "LiveClassNoteCode" (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id     uuid NOT NULL REFERENCES "LiveClassNote"(id) ON DELETE CASCADE,
  para_index  integer NOT NULL,
  label       text NOT NULL,
  dimension   text NOT NULL DEFAULT 'manual',
  source      text NOT NULL DEFAULT 'manual',
  confidence  real NOT NULL DEFAULT 1.0,
  created_at  timestamptz DEFAULT now(),
  UNIQUE (note_id, para_index, label)
);

CREATE INDEX IF NOT EXISTS "LiveClassNoteCode_note_id_idx"
  ON "LiveClassNoteCode" (note_id);
```

- [ ] **Step 2: Apply to dev database**

The DB connection string is in `.env` as `DATABASE_URL`. Run:
```bash
psql "$DATABASE_URL" -f postgres-patches/migrations/20260524120000_live_class_note_code.sql
```
Expected output:
```
CREATE TABLE
CREATE INDEX
```

- [ ] **Step 3: Verify table exists**

```bash
psql "$DATABASE_URL" -c '\d "LiveClassNoteCode"'
```
Expected: table description with columns `id, note_id, para_index, label, dimension, source, confidence, created_at`.

- [ ] **Step 4: Commit**

```bash
git add postgres-patches/migrations/20260524120000_live_class_note_code.sql
git commit -m "feat: add LiveClassNoteCode table for trace annotations"
```

---

## Task 2: Pure Utility Functions + Tests

**Files:**
- Create: `src/scripts/course/notes/trace-utils.mjs`
- Create: `src/scripts/course/notes/trace-utils.test.mjs`
- Modify: `package.json`

These are mirrors of pure functions in `trace-margin.ts` (same pattern as `notes-sidebar-utils.mjs`). The `.mjs` version is tested in Node; the `.ts` version runs in the browser.

- [ ] **Step 1: Write the failing tests**

```javascript
// src/scripts/course/notes/trace-utils.test.mjs
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { segmentParagraphs, computeOrphanLabels } from './trace-utils.mjs';

describe('segmentParagraphs', () => {
  test('splits on double newline', () => {
    const result = segmentParagraphs('First.\n\nSecond.');
    assert.equal(result.length, 2);
    assert.equal(result[0].text, 'First.');
    assert.equal(result[0].index, 0);
    assert.equal(result[1].text, 'Second.');
    assert.equal(result[1].index, 1);
  });

  test('from/to positions slice correctly', () => {
    const md = 'Hello\n\nWorld';
    const [a, b] = segmentParagraphs(md);
    assert.equal(md.slice(a.from, a.to), 'Hello');
    assert.equal(md.slice(b.from, b.to), 'World');
  });

  test('filters empty segments', () => {
    const result = segmentParagraphs('\n\nOnly one.\n\n\n');
    assert.equal(result.length, 1);
    assert.equal(result[0].text, 'Only one.');
  });

  test('splits on HR separator', () => {
    const result = segmentParagraphs('Before\n---\nAfter');
    assert.equal(result.length, 2);
    assert.equal(result[0].text, 'Before');
    assert.equal(result[1].text, 'After');
  });

  test('each segment has a unique string id', () => {
    const [a, b] = segmentParagraphs('Hello world\n\nFoo bar');
    assert.equal(typeof a.id, 'string');
    assert.notEqual(a.id, b.id);
  });

  test('returns empty array for empty string', () => {
    assert.deepEqual(segmentParagraphs(''), []);
  });
});

describe('computeOrphanLabels', () => {
  test('label on only one paragraph is an orphan', () => {
    const codes = [
      { label: 'identity', paraIndex: 0 },
      { label: 'claim',    paraIndex: 1 },
      { label: 'identity', paraIndex: 2 },
    ];
    const orphans = computeOrphanLabels(codes);
    assert.ok(orphans.has('claim'));
    assert.ok(!orphans.has('identity'));
  });

  test('all labels are orphans when each appears once', () => {
    const codes = [{ label: 'a', paraIndex: 0 }, { label: 'b', paraIndex: 1 }];
    assert.equal(computeOrphanLabels(codes).size, 2);
  });

  test('returns empty set for no codes', () => {
    assert.equal(computeOrphanLabels([]).size, 0);
  });
});
```

- [ ] **Step 2: Add test glob to package.json**

In `package.json`, update the `"test"` script to add the notes glob:

Old:
```json
"test": "node --test \"src/lib/live/*.test.mjs\" \"src/scripts/course/sidebar/*.test.mjs\" \"src/scripts/notas/*.test.mjs\""
```

New:
```json
"test": "node --test \"src/lib/live/*.test.mjs\" \"src/scripts/course/sidebar/*.test.mjs\" \"src/scripts/notas/*.test.mjs\" \"src/scripts/course/notes/*.test.mjs\""
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npm test 2>&1 | grep -A3 "trace-utils"
```
Expected: `ReferenceError: Cannot find module './trace-utils.mjs'` (the file doesn't exist yet).

- [ ] **Step 4: Write the utility functions**

```javascript
// src/scripts/course/notes/trace-utils.mjs
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
```

- [ ] **Step 5: Run tests and verify they pass**

```bash
npm test 2>&1 | grep -A3 "trace-utils"
```
Expected: all `segmentParagraphs` and `computeOrphanLabels` tests pass (✓).

- [ ] **Step 6: Commit**

```bash
git add src/scripts/course/notes/trace-utils.mjs src/scripts/course/notes/trace-utils.test.mjs package.json
git commit -m "feat: add trace-utils pure functions with tests"
```

---

## Task 3: API Endpoint

**Files:**
- Create: `src/pages/api/live/notes/trace.ts`

Uses the same auth/query pattern as `src/pages/api/live/notes.ts`.

- [ ] **Step 1: Write the API file**

```typescript
// src/pages/api/live/notes/trace.ts
import type { APIRoute } from 'astro';
import { cleanString, ensureDbUserFromSession, json } from '../../../../lib/forum-server';
import { query } from '../../../../lib/db/pool';

const LABEL_MAX = 120;
const VALID_DIMENSIONS = new Set(['thematic', 'rhetorical', 'emergent', 'manual']);

export const GET: APIRoute = async ({ locals, url }) => {
  const session = (locals as any).session;
  const user = await ensureDbUserFromSession(session);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  const noteId = cleanString(url.searchParams.get('noteId') ?? '', 36);
  if (!noteId) return json({ error: 'noteId required' }, 400);

  const { data: noteCheck } = await query(
    `SELECT id FROM "LiveClassNote" WHERE id = $1 AND "userId" = $2`,
    [noteId, user.id],
  );
  if (!noteCheck?.length) return json({ error: 'Not found' }, 403);

  const { data, error } = await query(
    `SELECT id, note_id AS "noteId", para_index AS "paraIndex", label,
            dimension, source, confidence, created_at AS "createdAt"
     FROM "LiveClassNoteCode"
     WHERE note_id = $1
     ORDER BY para_index ASC, created_at ASC`,
    [noteId],
  );
  if (error) return json({ error: error.message }, 500);
  return json({ codes: data ?? [] });
};

export const POST: APIRoute = async ({ request, locals }) => {
  const session = (locals as any).session;
  const user = await ensureDbUserFromSession(session);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  const body       = await request.json().catch(() => ({}));
  const noteId     = cleanString(body?.noteId ?? '', 36);
  const paraIndex  = parseInt(String(body?.paraIndex ?? '-1'), 10);
  const label      = cleanString(String(body?.label ?? '').trim(), LABEL_MAX);
  const dimension  = VALID_DIMENSIONS.has(body?.dimension) ? String(body.dimension) : 'manual';

  if (!noteId || !label || paraIndex < 0) return json({ error: 'noteId, paraIndex ≥ 0, label required' }, 400);

  const { data: noteCheck } = await query(
    `SELECT id FROM "LiveClassNote" WHERE id = $1 AND "userId" = $2`,
    [noteId, user.id],
  );
  if (!noteCheck?.length) return json({ error: 'Not found' }, 403);

  const { data, error } = await query(
    `INSERT INTO "LiveClassNoteCode" (id, note_id, para_index, label, dimension, source, confidence)
     VALUES ($1, $2, $3, $4, $5, 'manual', 1.0)
     ON CONFLICT (note_id, para_index, label) DO UPDATE SET created_at = now()
     RETURNING id, note_id AS "noteId", para_index AS "paraIndex",
               label, dimension, source, confidence`,
    [crypto.randomUUID(), noteId, paraIndex, label, dimension],
  );
  if (error) return json({ error: error.message }, 500);
  return json({ code: data?.[0] });
};

export const DELETE: APIRoute = async ({ locals, url }) => {
  const session = (locals as any).session;
  const user = await ensureDbUserFromSession(session);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  const id = cleanString(url.searchParams.get('id') ?? '', 36);
  if (!id) return json({ error: 'id required' }, 400);

  const { error } = await query(
    `DELETE FROM "LiveClassNoteCode" nc
     USING "LiveClassNote" n
     WHERE nc.id = $1 AND nc.note_id = n.id AND n."userId" = $2`,
    [id, user.id],
  );
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true });
};
```

- [ ] **Step 2: Smoke-test GET (dev server must be running)**

```bash
# GET with no noteId → 400
curl -s "http://localhost:4321/api/live/notes/trace" | jq .
# Expected: {"error":"noteId required"}
```

- [ ] **Step 3: Commit**

```bash
git add src/pages/api/live/notes/trace.ts
git commit -m "feat: add /api/live/notes/trace GET/POST/DELETE"
```

---

## Task 4: Expose EditorView from LiveMdEditor

**Files:**
- Modify: `src/scripts/course/notes/live-md-editor.ts`

`mountTraceMargin` needs the raw `EditorView` to inject CM6 extensions. Add `getView()` to the interface and implementation.

- [ ] **Step 1: Add `getView` to the interface**

In `src/scripts/course/notes/live-md-editor.ts`, find the interface:

```typescript
export interface LiveMdEditor {
  getContent(): string;
  setContent(content: string): void;
  focus(): void;
  destroy(): void;
}
```

Replace with:

```typescript
export interface LiveMdEditor {
  getContent(): string;
  setContent(content: string): void;
  focus(): void;
  destroy(): void;
  getView(): EditorView;
}
```

- [ ] **Step 2: Add `getView` to the returned object**

Find the `return {` block at the end of `createLiveMdEditor`:

```typescript
  return {
    getContent:  () => view.state.doc.toString(),
    setContent: (c) => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: c } }),
    focus:      () => view.focus(),
    destroy:    () => view.destroy(),
  };
```

Replace with:

```typescript
  return {
    getContent:  () => view.state.doc.toString(),
    setContent: (c) => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: c } }),
    focus:      () => view.focus(),
    destroy:    () => view.destroy(),
    getView:    () => view,
  };
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx astro check 2>&1 | grep -i "live-md-editor\|trace" | head -20
```
Expected: no errors for this file.

- [ ] **Step 4: Commit**

```bash
git add src/scripts/course/notes/live-md-editor.ts
git commit -m "feat: expose getView() on LiveMdEditor for extension injection"
```

---

## Task 5: Add traceBtn to dockview-shell

**Files:**
- Modify: `src/scripts/course/dockview-shell.ts`

- [ ] **Step 1: Add the button element and CSS**

In `src/scripts/course/dockview-shell.ts`, inside `injectWorkspaceCss`, add after the `.cnw-close-btn:hover` rule:

```typescript
    .cnw-mode-btn.is-active { opacity: 1 !important; color: var(--c-link, #3b82f6) !important; }
```

- [ ] **Step 2: Add `traceBtn` to `buildShell`**

Inside `buildShell`, after the `splitBelowBtn` block and before `closeBtn`:

```typescript
  const traceBtn = document.createElement('button');
  traceBtn.className = 'cnw-mode-btn';
  traceBtn.title = 'Trace Codes';
  traceBtn.textContent = '⊕';
  traceBtn.style.fontSize = '13px';
  header.insertBefore(traceBtn, closeBtn);
```

- [ ] **Step 3: Add `traceBtn` to the return type and value**

Find the function signature:
```typescript
): { shell: HTMLElement; bodyEl: HTMLElement; statusDot: HTMLElement; pencilBtn: HTMLButtonElement; splitRightBtn: HTMLButtonElement; splitBelowBtn: HTMLButtonElement }
```
Replace with:
```typescript
): { shell: HTMLElement; bodyEl: HTMLElement; statusDot: HTMLElement; pencilBtn: HTMLButtonElement; splitRightBtn: HTMLButtonElement; splitBelowBtn: HTMLButtonElement; traceBtn: HTMLButtonElement }
```

Find the `return {` at the end of `buildShell`:
```typescript
  return { shell, bodyEl: body, statusDot, pencilBtn, splitRightBtn, splitBelowBtn };
```
Replace with:
```typescript
  return { shell, bodyEl: body, statusDot, pencilBtn, splitRightBtn, splitBelowBtn, traceBtn };
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx astro check 2>&1 | grep -i "dockview-shell" | head -10
```
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/scripts/course/dockview-shell.ts
git commit -m "feat: add traceBtn to dockview-shell buildShell"
```

---

## Task 6: trace-margin.ts — CM6 Extension + CSS

**Files:**
- Create: `src/scripts/course/notes/trace-margin.ts` (first part)

This task creates the file with types, pure functions, CM6 extension, and CSS injection. The DOM mounting logic comes in Task 7.

- [ ] **Step 1: Write the file**

```typescript
// src/scripts/course/notes/trace-margin.ts
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
  `;
  document.head.appendChild(s);
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx astro check 2>&1 | grep "trace-margin" | head -10
```
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/scripts/course/notes/trace-margin.ts
git commit -m "feat: trace-margin types, pure functions, CM6 highlight extension"
```

---

## Task 7: trace-margin.ts — Mount Logic, DOM, API Calls

**Files:**
- Modify: `src/scripts/course/notes/trace-margin.ts` (append)

- [ ] **Step 1: Append the SVG graph renderer to trace-margin.ts**

Add after the `injectTraceCss` function:

```typescript
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
```

- [ ] **Step 2: Append the margin renderer to trace-margin.ts**

```typescript
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

    // Row header
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

    // Code chips
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

      // Chain highlight on chip click
      chip.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.tc-chip-del')) return;
        const matchingParas = codes.filter(c => c.label === code.label).map(c => c.paraIndex);
        const newSet = new Set(matchingParas);
        const current = editorView.state.field(highlightField, false) ?? new Set<number>();
        const alreadyOn = matchingParas.length > 0 && matchingParas.every(p => current.has(p)) && current.size === newSet.size;
        editorView.dispatch({ effects: setHighlight.of(alreadyOn ? new Set<number>() : newSet) });
        // Update chip `.is-highlighted` classes without full re-render
        traceCol.querySelectorAll<HTMLElement>('.tc-chip').forEach(ch => {
          ch.classList.toggle('is-highlighted', !alreadyOn && ch.dataset.label === code.label);
        });
      });

      // Delete
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

    // Add input (hidden until ⊕ clicked)
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

  // SVG graph in a collapsible details element
  const graph = document.createElement('details');
  graph.className = 'tc-graph';
  const summary = document.createElement('summary');
  summary.textContent = 'estructura';
  graph.appendChild(summary);
  if (paras.length > 0) graph.appendChild(renderTraceGraph(paras, codes));
  traceCol.appendChild(graph);
}
```

- [ ] **Step 3: Append the public mountTraceMargin function to trace-margin.ts**

```typescript
// ── Public API ─────────────────────────────────────────────────────────────

export async function mountTraceMargin(
  editorView: EditorView,
  noteId: string,
  panelBodyEl: HTMLElement,
): Promise<TraceMarginHandle> {
  injectTraceCss();

  // Load existing codes
  let codes: TraceCode[] = [];
  try {
    const res = await fetch(`/api/live/notes/trace?noteId=${encodeURIComponent(noteId)}`);
    if (res.ok) {
      const data = await res.json() as { codes?: TraceCode[] };
      codes = data.codes ?? [];
    }
  } catch { /* render empty margin */ }

  // Segment paragraphs from current editor content
  const paras = segmentParagraphs(editorView.state.doc.toString());

  // Inject CM6 extension into live editor
  editorView.dispatch({
    effects: StateEffect.appendConfig.of([highlightField, makeHighlightPlugin(paras)]),
  });

  // Split panelBodyEl into editor + margin columns using flex
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
    renderMargin(traceCol, paras, currentCodes, noteId, editorView, rerender);
  };

  rerender(currentCodes);

  return {
    destroy() {
      editorView.dispatch({ effects: setHighlight.of(new Set<number>()) });
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
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx astro check 2>&1 | grep "trace-margin" | head -20
```
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/scripts/course/notes/trace-margin.ts
git commit -m "feat: trace-margin SVG graph, DOM renderer, mountTraceMargin"
```

---

## Task 8: Wire traceBtn in dockview-workspace.ts

**Files:**
- Modify: `src/scripts/course/dockview-workspace.ts`

- [ ] **Step 1: Add import type and update `DbNotePanelState`**

In `src/scripts/course/dockview-workspace.ts`, after the import on line 14:
```typescript
import { createLiveMdEditor, type LiveMdEditor } from './notes/live-md-editor';
```
Add:
```typescript
import type { TraceMarginHandle } from './notes/trace-margin';
```

Then find the `DbNotePanelState` type definition:

```typescript
type DbNotePanelState = {
  noteId: string;
  mode: NoteMode;
  bodyEl: HTMLElement;
  statusDot: HTMLElement;
  pencilBtn: HTMLButtonElement;
  liveEditor: LiveMdEditor | null;
};
```

Replace with:

```typescript
type DbNotePanelState = {
  noteId: string;
  mode: NoteMode;
  bodyEl: HTMLElement;
  statusDot: HTMLElement;
  pencilBtn: HTMLButtonElement;
  traceBtn: HTMLButtonElement;
  liveEditor: LiveMdEditor | null;
  traceHandle: TraceMarginHandle | null;
};
```

- [ ] **Step 2: Add `traceBtn` and `traceHandle` to the state initializer**

Find the block inside the dockview `createComponent` callback where `DbNotePanelState` is constructed. It destructures `buildShell`:

```typescript
        const { shell, bodyEl, statusDot, pencilBtn } = buildShell(
          panelId, params.noteId, params.title, dockview, true,
        );
```

Replace with:

```typescript
        const { shell, bodyEl, statusDot, pencilBtn, traceBtn } = buildShell(
          panelId, params.noteId, params.title, dockview, true,
        );
```

Then find the state object construction immediately after:

```typescript
        const state: DbNotePanelState = {
          noteId: params.noteId,
          mode: 'preview',
          bodyEl,
          statusDot,
          pencilBtn,
          liveEditor: null,
        };
```

Replace with:

```typescript
        const state: DbNotePanelState = {
          noteId: params.noteId,
          mode: 'preview',
          bodyEl,
          statusDot,
          pencilBtn,
          traceBtn,
          liveEditor: null,
          traceHandle: null,
        };
```

- [ ] **Step 3: Wire the traceBtn click handler**

After the existing `pencilBtn.addEventListener('click', ...)` block for the db-note panel, add:

```typescript
        traceBtn.addEventListener('click', async () => {
          if (state.traceHandle) {
            state.traceHandle.destroy();
            state.traceHandle = null;
            traceBtn.classList.remove('is-active');
            return;
          }
          // Trace requires edit mode
          if (!state.liveEditor || state.mode !== 'edit') {
            // Trigger edit mode; user can click ⊕ again once editor is ready
            pencilBtn.click();
            return;
          }
          traceBtn.disabled = true;
          try {
            const { mountTraceMargin } = await import('./notes/trace-margin');
            state.traceHandle = await mountTraceMargin(
              state.liveEditor.getView(),
              state.noteId,
              state.bodyEl,
            );
            traceBtn.classList.add('is-active');
          } finally {
            traceBtn.disabled = false;
          }
        });
```

- [ ] **Step 4: Destroy traceHandle on mode switch**

Find `enterDbNotePreviewMode` (~line 620):
```typescript
async function enterDbNotePreviewMode(state: DbNotePanelState) {
  state.liveEditor?.destroy();
  state.liveEditor = null;
  state.pencilBtn.title = 'Editar';
  await loadDbNotePreview(state);
}
```
Replace with:
```typescript
async function enterDbNotePreviewMode(state: DbNotePanelState) {
  state.liveEditor?.destroy();
  state.liveEditor = null;
  if (state.traceHandle) {
    state.traceHandle.destroy();
    state.traceHandle = null;
    state.traceBtn.classList.remove('is-active');
  }
  state.pencilBtn.title = 'Editar';
  await loadDbNotePreview(state);
}
```

Find `enterDbNoteEditMode` (~line 584):
```typescript
function enterDbNoteEditMode(state: DbNotePanelState) {
  state.liveEditor?.destroy();
  state.liveEditor = null;
  state.mode = 'edit';
```
Replace with:
```typescript
function enterDbNoteEditMode(state: DbNotePanelState) {
  state.liveEditor?.destroy();
  state.liveEditor = null;
  if (state.traceHandle) {
    state.traceHandle.destroy();
    state.traceHandle = null;
    state.traceBtn.classList.remove('is-active');
  }
  state.mode = 'edit';
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
npx astro check 2>&1 | grep -i "workspace\|trace" | head -20
```
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/scripts/course/dockview-workspace.ts
git commit -m "feat: wire traceBtn to mountTraceMargin in dockview-workspace"
```

---

## Task 9: Integration Smoke Test

No new files — manual verification in the browser.

- [ ] **Step 1: Start dev server**

```bash
npm run dev
```

- [ ] **Step 2: Open a course note in edit mode**

Navigate to a course page, open a db-note panel, switch to edit mode (pencil icon). Write a note with at least 3 paragraphs separated by blank lines:

```
Este es el primer párrafo. Introduce el tema central.

Este es el segundo párrafo. Desarrolla la idea principal con ejemplos concretos.

Este es el tercero. Sintetiza lo anterior y añade una conclusión.
```

- [ ] **Step 3: Toggle the trace margin**

Click the `⊕` button in the panel header. Verify:
- The panel splits into editor (left ~65%) and margin (right ~35%)
- The margin shows rows P0, P1, P2 each with `—` role and an `⊕` add button
- The SVG graph (collapsed) shows 3 circles

- [ ] **Step 4: Add codes**

Click `⊕` on P0 → type `contexto` → Enter. Click `⊕` on P1 → type `desarrollo` → Enter. Click `⊕` on P2 → type `contexto` → Enter.

Verify:
- `contexto` chip appears on P0 and P2
- `desarrollo` chip appears on P1 with `⚠` orphan badge (appears only once)
- SVG graph updates: P0 and P2 circles are colored, P1 circle less so

- [ ] **Step 5: Chain highlight**

Click the `contexto` chip on P0. Verify:
- P0 and P2 in the editor get a left blue border
- Both `contexto` chips show `.is-highlighted` styling
- Clicking `contexto` again clears the highlight

- [ ] **Step 6: Delete a code**

Click `×` on the `desarrollo` chip. Verify:
- Chip disappears
- `⚠` badge on P1 disappears (no codes = no orphan check)

- [ ] **Step 7: Toggle off**

Click `⊕` again. Verify:
- Margin col disappears
- Editor takes full width
- No left-border highlights remain

- [ ] **Step 8: Persist check**

Re-open the margin on the same note. Verify the previously saved codes are loaded back from the API.

- [ ] **Step 9: Commit integration tag**

```bash
git tag trace-stage0-smoke-pass
git commit --allow-empty -m "chore: trace stage 0 smoke tests pass"
```
