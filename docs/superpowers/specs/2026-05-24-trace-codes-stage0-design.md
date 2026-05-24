# Trace Codes — Stage 0 Design

**Date:** 2026-05-24  
**Status:** Approved  
**Ref:** `docs/notas-tc-analysis.md` §14  
**Approach:** A — modularized (`trace-margin.ts` owns all trace logic)

---

## 1. Scope

Stage 0 implements **manual Trace Code annotation** in the NOTAS db-note editor — no AI, no NLP. It validates the unified TraceCode data model and proves the margin UI is useful before any AI exists.

**In scope:**
- `⊕` toggle button in db-note panel header
- Intra-shell CSS flex split (65 / 35, editor / margin)
- Paragraph segmenter (double-newline split, stable index)
- Manual code tagger: click → input → Enter → saves to DB
- Chain highlight: click a code label → CM6 line decorations on all matching paragraphs
- Orphan badge `⚠`: code label appears on exactly 1 paragraph
- Basic SVG graph: paragraph nodes colored by code density, no edges
- DB migration + GET/POST/DELETE API

**Out of scope (Stage 1+):**
- Rhetorical role dropdown (renders `—`, not interactive)
- LLM analysis
- Paragraph relations / DAG edges
- Version diff

---

## 2. Files

| Action | Path |
|--------|------|
| CREATE | `src/scripts/course/notes/trace-margin.ts` |
| CREATE | `src/pages/api/live/notes/trace.ts` |
| CREATE | `postgres-patches/migrations/20260524120000_live_class_note_code.sql` |
| MODIFY | `src/scripts/course/dockview-shell.ts` |
| MODIFY | `src/scripts/course/dockview-workspace.ts` |

---

## 3. DB Migration

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

---

## 4. API — `/api/live/notes/trace.ts`

Auth: `ensureDbUserFromSession` (same as live/notes.ts). All operations are scoped to the authenticated user via a JOIN to `LiveClassNote`.

**`GET ?noteId=<uuid>`**
- Returns `{ codes: TraceCode[] }` sorted by `para_index ASC, created_at ASC`
- 400 if no noteId; 403 if note doesn't belong to user

**`POST { noteId, paraIndex, label, dimension? }`**
- Validates: noteId (uuid, 36), paraIndex (integer ≥ 0), label (text, max 120 chars, trimmed), dimension (one of `thematic|rhetorical|emergent|manual`, defaults to `manual`)
- Inserts with `ON CONFLICT (note_id, para_index, label) DO UPDATE SET created_at = now()`
- Returns `{ code: TraceCode }`

**`DELETE ?id=<uuid>`**
- Deletes the code row only if the parent note belongs to the authenticated user (JOIN check)
- Returns `{ ok: true }`

---

## 5. Client Type

```typescript
// in trace-margin.ts
type TraceCode = {
  id: string;
  noteId: string;
  paraIndex: number;
  label: string;
  dimension: 'thematic' | 'rhetorical' | 'emergent' | 'manual';
  source: 'manual' | 'local_nlp' | 'ai_suggested' | 'ai_confirmed';
  confidence: number;
};
```

---

## 6. Paragraph Segmenter

```typescript
type Paragraph = { index: number; text: string; id: string };

function segmentParagraphs(markdown: string): Paragraph[] {
  // split on blank line (\n\n) or HR (\n---\n)
  // filter empty segments
  // id = btoa(index + ':' + text.slice(0, 40)).replace(/=/g,'')
  // returns array sorted by index
}
```

`id` is used only as SVG node key. `para_index` (integer) is the persistence key in the DB.

---

## 7. `dockview-shell.ts` Changes

`buildShell()` gains one new element:
- A `traceBtn: HTMLButtonElement` (the `⊕` icon) added to the header, after `pencilBtn`

No `addExtension()` helper — the CM extension is injected entirely inside `trace-margin.ts` using the `editorView` passed directly from `dockview-workspace.ts`.

The `⊕` SVG: two crossing lines forming a grid — or a simple `⊕` Unicode character at `font-size: 11px`.

`buildShell` signature change (backward-compatible — new field added to return object):
```typescript
return { shell, bodyEl, statusDot, pencilBtn, splitRightBtn, splitBelowBtn, traceBtn };
```

---

## 8. `trace-margin.ts` Public API

```typescript
interface TraceMarginHandle {
  destroy(): void;
}

function mountTraceMargin(
  editorView: EditorView,
  noteId: string,
  panelBodyEl: HTMLElement,  // the .cnw-body element
): TraceMarginHandle
```

`mountTraceMargin`:
1. Fetches `GET /api/live/notes/trace?noteId=` → loads existing codes
2. Injects CM6 extension via `StateEffect.appendConfig` (chain highlight StateField + ViewPlugin) — extension stays in the view permanently; `destroy()` clears highlights by dispatching `setHighlightEffect(new Set())`
3. Switches `panelBodyEl` to `display: flex`; appends `.cnw-trace-col` as a new sibling inside it (CM editor stays in its existing container, now `.cnw-editor-col` via a class added to the existing body child)
4. Renders margin DOM: paragraph rows + SVG graph
5. Wires add/delete/chain-click event handlers
6. Returns `{ destroy() }` that removes `.cnw-trace-col`, restores `panelBodyEl` to `display: block`, clears chain highlights

---

## 9. Margin Panel DOM

```
.cnw-trace-col
  .tc-list                    ← scrollable paragraph list
    .tc-row[data-para=N]
      .tc-row-head
        span.tc-para-label    ← "P0"
        span.tc-role-chip     ← "—" (inactive Stage 0)
        button.tc-add-btn     ← ⊕
      .tc-codes               ← code chips
        .tc-chip[data-label="X"]
          span.tc-chip-label  ← "X" (clickable → chain highlight)
          button.tc-chip-del  ← ×
      .tc-orphan-badge        ← "⚠" if label count === 1 across note
      .tc-add-input (hidden)  ← appears on ⊕ click
  .tc-graph                   ← collapsible SVG graph
    summary "estructura"
    svg.tc-svg
```

---

## 10. CM6 Chain Highlight

```typescript
// StateEffect to update highlighted paragraph indices
const setHighlightEffect = StateEffect.define<Set<number>>();

// StateField holds currently highlighted paragraph set
const highlightField = StateField.define<Set<number>>({
  create: () => new Set(),
  update: (val, tr) => {
    for (const e of tr.effects) if (e.is(setHighlightEffect)) return e.value;
    return val;
  },
});

// ViewPlugin maps field → Decoration.line on all lines within each highlighted para
// Uses segmentParagraphs(view.state.doc.toString()) to find char ranges
const highlightPlugin = ViewPlugin.fromClass(...);

// CSS injected once:
// .cnw-trace-hl { border-left: 3px solid var(--c-link); padding-left: 4px; }
```

Clicking a code label dispatches `setHighlightEffect` with the set of para indices sharing that label. Clicking the same label again dispatches with an empty set.

---

## 11. SVG Graph

- Vertical column layout, one circle per paragraph (r = 9px, spacing = 38px)
- Node fill: `color-mix(in srgb, var(--c-link) <pct>%, var(--c-bg-mute))` where `<pct>` = `min(80, codeCount * 20)`
- Node label: `P0`, `P1`, … inside the circle (font-size 8px)
- No edges in Stage 0 (relations are empty)
- Wrapped in a `<details>` element with `<summary>estructura</summary>`, collapsed by default
- SVG viewBox auto-sized to `40 × (paragraphs * 38 + 20)`

---

## 12. Orphan Detection

Pure client-side. After any add/delete, compute:

```typescript
const labelCounts = new Map<string, number>();
for (const c of allCodes) labelCounts.set(c.label, (labelCounts.get(c.label) ?? 0) + 1);
// orphan = label where count === 1
```

Show `⚠` badge on any `.tc-row` that has at least one orphan label. Badge tooltip: `"'<label>' solo aparece aquí"`.

---

## 13. `dockview-workspace.ts` Changes

In the db-note panel builder (where `pencilBtn` is already wired):

```typescript
let traceHandle: TraceMarginHandle | null = null;

traceBtn.addEventListener('click', async () => {
  if (traceHandle) {
    traceHandle.destroy();
    traceHandle = null;
    traceBtn.classList.remove('is-active');
  } else {
    const { mountTraceMargin } = await import('./notes/trace-margin');
    traceHandle = mountTraceMargin(editorView, noteId, bodyEl);
    traceBtn.classList.add('is-active');
  }
});
```

The dynamic import keeps trace-margin.ts out of the initial bundle.

---

## 14. Error Handling

- API errors (save/delete): show a transient red border on the affected chip for 1.5s, then restore
- Load failure (GET on mount): show `[error cargando códigos]` in the margin col, margin still renders empty
- Empty note (no paragraphs): margin shows `[sin párrafos]` placeholder

---

## 15. Estimated Size

| File | Approx lines |
|------|-------------|
| `trace-margin.ts` | ~280 |
| `trace.ts` (API) | ~90 |
| migration SQL | ~15 |
| dockview-shell.ts delta | ~15 |
| dockview-workspace.ts delta | ~20 |
| **Total** | **~420** |
