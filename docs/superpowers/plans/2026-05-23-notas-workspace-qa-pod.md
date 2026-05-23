# NOTAS Workspace + QA Pod Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `/notas` standalone page with a pod-based personal notes system across course sidebar, ribbon overlay, and live room; add a QA Analyzer pod with word-frequency and KWIC concordance analysis.

**Architecture:** Approach B — separate `personal-notes-workspace.ts` module for the ribbon overlay; `dockview-workspace.ts` and `RoomWorkspaceManager` both gain a `db-note` panel kind that reads the shared `LiveClassNote` DB. `buildShell` is extracted to a shared module first so all three consumers can use it.

**Tech Stack:** TypeScript, Dockview Core v5, Node.js built-in test runner (`node --test`), PostgreSQL via `src/lib/db/pool.ts`, existing `enhanceMarkdownTextarea` from `src/scripts/markdown-editor-tools.ts`.

**Spec:** `docs/superpowers/specs/2026-05-23-notas-workspace-qa-pod-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/scripts/course/dockview-shell.ts` | **Create** | Shared `buildShell`, `injectWorkspaceCss`, CSS string |
| `src/scripts/notas/qa-analyzer-logic.ts` | **Create** | Pure functions: `computeFrequency`, `computeKwic`, `STOPWORDS` |
| `src/scripts/notas/qa-analyzer-logic.test.mjs` | **Create** | Unit tests for both pure functions |
| `src/scripts/notas/personal-notes-workspace.ts` | **Create** | Dockview workspace for the ribbon overlay (user-global) |
| `src/scripts/course/notes-sidebar.ts` | **Create** | Course sidebar NOTAS section: fetch tree, CRUD, drag |
| `src/components/notas/PersonalNotesOverlay.astro` | **Create** | Fixed overlay container; toggles on `musiki:open-notas` |
| `src/pages/api/note-folders.ts` | **Create** | Folder CRUD API (GET tree, POST, PATCH, DELETE) |
| `src/pages/notas.ts` | **Create** | Redirect `/notas` → `/dashboard` |
| `src/scripts/course/dockview-workspace.ts` | **Modify** | Import from dockview-shell; add `db-note`+`qa-analyzer` kinds; remove open-notas handler |
| `src/pages/api/live/notes.ts` | **Modify** | Add `folderId` to GET filter + POST/PATCH body |
| `src/pages/[...slug].astro` | **Modify** | Add `notas` sidebar entry; import `PersonalNotesOverlay` |
| `src/components/room/workspace/PodTemplates.astro` | **Modify** | Add `data-pod="db-note"` template |
| `src/scripts/room/workspace/RoomWorkspaceManager.ts` | **Modify** | Add `db-note` to `POD_TYPES` + `createComponent` handler |
| `src/pages/notas.astro` | **Delete** | Replaced by overlay + redirect |

---

## Task 1: DB Migration — add `folderId` to `LiveClassNote`

**Files:**
- Modify: `src/pages/api/live/notes.ts`

- [ ] **Step 1: Run migration SQL against the DB**

```bash
# Connect via the DB tunnel then run:
psql -h localhost -p 5433 -U musiki -d musiki26 -c "
ALTER TABLE \"LiveClassNote\"
  ADD COLUMN IF NOT EXISTS \"folderId\" uuid;
"
```

Expected output: `ALTER TABLE`

- [ ] **Step 2: Verify column exists**

```bash
psql -h localhost -p 5433 -U musiki -d musiki26 -c "
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'LiveClassNote' AND column_name = 'folderId';
"
```

Expected: one row with `column_name = folderId`, `data_type = uuid`

- [ ] **Step 3: Extend GET handler in `src/pages/api/live/notes.ts` to accept `folderId` filter**

After the existing `if (roomName)` block (around line 50), add:

```ts
  const folderId = cleanString(url.searchParams.get('folderId') ?? '', 36) || null;
  // …existing code…
  if (folderId) {
    params.push(folderId);
    sql += ` AND "folderId" = $${params.length}`;
  }
```

Also update the SELECT to include `folderId` and `courseId`:

```ts
  let sql = `SELECT id, title, body, "renderedHtml", "noteDate", "courseId", "folderId", "createdAt", "updatedAt"
             FROM "LiveClassNote" WHERE "userId" = $1`;
```

- [ ] **Step 4: Extend POST/PATCH to accept `folderId`**

In the POST handler, find where `cleanString` sanitizes incoming fields. Add:

```ts
const folderId = cleanString(String(body?.folderId ?? ''), 36) || null;
```

Then include `folderId` in the INSERT column list and in the allowed PATCH columns. Locate the section that builds `cols` / `setSql` and add:

```ts
if (folderId !== undefined) cols.push(['folderId', folderId]);
```

- [ ] **Step 5: Commit**

```bash
git add src/pages/api/live/notes.ts
git commit -m "feat: add folderId column to LiveClassNote + API filter/write support"
```

---

## Task 2: New `/api/live/note-folders` endpoint

**Files:**
- Create: `src/pages/api/note-folders.ts`

- [ ] **Step 1: Create the file**

```ts
// src/pages/api/note-folders.ts
import type { APIRoute } from 'astro';
import { cleanString, ensureDbUserFromSession, json } from '../lib/forum-server';
import { query } from '../lib/db/pool';

// Run once at app startup — idempotent
async function ensureFolderTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS "LiveClassNoteFolder" (
      "id"        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "name"      varchar(200) NOT NULL,
      "parentId"  uuid REFERENCES "LiveClassNoteFolder"("id") ON DELETE CASCADE,
      "userId"    integer NOT NULL,
      "courseId"  varchar(200),
      "createdAt" timestamptz DEFAULT now()
    )
  `, []);
}
void ensureFolderTable();

export const GET: APIRoute = async ({ locals, url }) => {
  const user = await ensureDbUserFromSession((locals as any).session);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  const courseId = cleanString(url.searchParams.get('courseId') ?? '', 120) || null;

  const params: any[] = [user.id];
  let sql = `SELECT id, name, "parentId", "courseId", "createdAt"
             FROM "LiveClassNoteFolder" WHERE "userId" = $1`;
  if (courseId) { params.push(courseId); sql += ` AND "courseId" = $${params.length}`; }
  sql += ' ORDER BY name ASC';

  const { data: folders } = await query(sql, params);
  return json({ folders: folders ?? [] });
};

export const POST: APIRoute = async ({ request, locals }) => {
  const user = await ensureDbUserFromSession((locals as any).session);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  const body = await request.json().catch(() => null);
  const name     = cleanString(String(body?.name ?? ''), 200);
  const parentId = cleanString(String(body?.parentId ?? ''), 36) || null;
  const courseId = cleanString(String(body?.courseId ?? ''), 120) || null;

  if (!name) return json({ error: 'name required' }, 400);

  const { data } = await query(
    `INSERT INTO "LiveClassNoteFolder" (name, "parentId", "userId", "courseId")
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [name, parentId, user.id, courseId],
  );
  return json({ folder: data?.[0] ?? null });
};

export const PATCH: APIRoute = async ({ request, locals }) => {
  const user = await ensureDbUserFromSession((locals as any).session);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  const body = await request.json().catch(() => null);
  const id       = cleanString(String(body?.id ?? ''), 36);
  const name     = body?.name != null ? cleanString(String(body.name), 200) : undefined;
  const parentId = body?.parentId !== undefined
    ? (cleanString(String(body.parentId), 36) || null)
    : undefined;

  if (!id) return json({ error: 'id required' }, 400);

  const sets: string[] = [];
  const params: any[] = [];
  if (name !== undefined)     { params.push(name);     sets.push(`"name" = $${params.length}`); }
  if (parentId !== undefined) { params.push(parentId); sets.push(`"parentId" = $${params.length}`); }
  if (!sets.length) return json({ error: 'nothing to update' }, 400);

  params.push(id, user.id);
  const { data } = await query(
    `UPDATE "LiveClassNoteFolder" SET ${sets.join(', ')}
     WHERE "id" = $${params.length - 1} AND "userId" = $${params.length} RETURNING *`,
    params,
  );
  return json({ folder: data?.[0] ?? null });
};

export const DELETE: APIRoute = async ({ locals, url }) => {
  const user = await ensureDbUserFromSession((locals as any).session);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  const id = cleanString(url.searchParams.get('id') ?? '', 36);
  if (!id) return json({ error: 'id required' }, 400);

  // Nullify notes inside this folder before deleting
  await query(`UPDATE "LiveClassNote" SET "folderId" = NULL WHERE "folderId" = $1 AND "userId" = $2`, [id, user.id]);
  await query(`DELETE FROM "LiveClassNoteFolder" WHERE "id" = $1 AND "userId" = $2`, [id, user.id]);
  return json({ ok: true });
};
```

- [ ] **Step 2: Verify endpoint responds**

Start dev server (`npm run dev`) then:

```bash
curl -s http://localhost:4321/api/note-folders?courseId=test \
  -H "Cookie: <your session cookie>" | jq .
```

Expected: `{ "folders": [] }` (or 401 if no cookie).

- [ ] **Step 3: Commit**

```bash
git add src/pages/api/note-folders.ts
git commit -m "feat: /api/note-folders CRUD endpoint"
```

---

## Task 3: Extract `buildShell` to shared `dockview-shell.ts`

**Files:**
- Create: `src/scripts/course/dockview-shell.ts`
- Modify: `src/scripts/course/dockview-workspace.ts`

- [ ] **Step 1: Create `src/scripts/course/dockview-shell.ts`**

Copy `buildShell` (lines 316–396) and `injectWorkspaceCss` (lines 145–315) verbatim, plus the CSS string, and export both:

```ts
// src/scripts/course/dockview-shell.ts
import { type DockviewComponent } from 'dockview-core';

export function injectWorkspaceCss(containerId: string) {
  if (document.querySelector('[data-cnw-ws-css]')) return;
  const style = document.createElement('style');
  style.setAttribute('data-cnw-ws-css', '1');
  // === PASTE the full CSS string from dockview-workspace.ts lines 149–314 here ===
  style.textContent = `/* paste content of injectWorkspaceCss style.textContent verbatim */`;
  document.head.appendChild(style);
}

export function buildShell(
  panelId: string,
  slug: string,
  title: string,
  dockview: DockviewComponent,
): { shell: HTMLElement; bodyEl: HTMLElement; statusDot: HTMLElement; pencilBtn: HTMLButtonElement } {
  // === PASTE the full buildShell body from dockview-workspace.ts lines 322–396 verbatim ===
}
```

> **Note:** Copy the complete function bodies verbatim — do not paraphrase. The CSS string is ~160 lines.

- [ ] **Step 2: Replace `buildShell` and `injectWorkspaceCss` in `dockview-workspace.ts` with imports**

At the top of `dockview-workspace.ts`, add:

```ts
import { buildShell, injectWorkspaceCss } from './dockview-shell';
```

Then delete the `function injectWorkspaceCss(...)` body (lines 145–315) and the `function buildShell(...)` body (lines 316–396) from `dockview-workspace.ts`. Keep all other code untouched.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors related to `buildShell` or `injectWorkspaceCss`.

- [ ] **Step 4: Commit**

```bash
git add src/scripts/course/dockview-shell.ts src/scripts/course/dockview-workspace.ts
git commit -m "refactor: extract buildShell + injectWorkspaceCss to dockview-shell.ts"
```

---

## Task 4: QA Analyzer pure logic + unit tests

**Files:**
- Create: `src/scripts/notas/qa-analyzer-logic.ts`
- Create: `src/scripts/notas/qa-analyzer-logic.test.mjs`

- [ ] **Step 1: Create `src/scripts/notas/qa-analyzer-logic.ts`**

```ts
// src/scripts/notas/qa-analyzer-logic.ts

export const STOPWORDS = new Set([
  // Spanish
  'de','la','el','en','y','a','que','del','los','las','un','una','por','con',
  'no','su','se','es','al','lo','más','pero','ya','fue','ser','ha','si','como',
  'hasta','me','mi','bien','cual','cuando','sin','sobre','también','entre',
  'uno','todo','esta','este','estos','estas','son','hay','está','para','nos',
  'muy','sus','así','aquí','porque','él','ella','ellos','les','eso','esto',
  'eran','era','estar','tiene','han','ni','le','te','tu','yo','eres','él',
  'nos','vos','tan','o','e','u','ante','bajo','cabe','contra','desde','durante',
  'hacia','mediante','salvo','según','tras','versus',
  // English
  'the','be','to','of','and','in','that','have','it','for','not','on','with',
  'he','as','you','do','at','this','but','his','by','from','they','we','say',
  'her','she','or','an','will','my','one','all','would','there','their','what',
  'so','up','out','if','about','who','get','which','go','me','when','make',
  'can','like','time','just','him','know','take','into','your','some','could',
  'them','see','other','than','then','now','look','only','come','its','over',
  'think','also','back','after','use','two','how','our','work','first','well',
  'way','even','new','want','because','any','these','give','day','most','us',
  'am','are','was','were','been','being','did','does','had','has','having',
  'is','than','then','too','very','s','t','don','should','now','ll','re','ve',
]);

export interface FrequencyEntry {
  word: string;
  count: number;
  pct: number; // count / maxCount * 100
}

/** Returns top-N words by frequency, excluding stopwords and short tokens. */
export function computeFrequency(text: string, topN = 20): FrequencyEntry[] {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-záéíóúüñàèìòùâêîôûäëïöü'\w\s-]/gi, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOPWORDS.has(w));

  const freq = new Map<string, number>();
  for (const w of tokens) freq.set(w, (freq.get(w) ?? 0) + 1);

  const sorted = [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN);

  const max = sorted[0]?.[1] ?? 1;
  return sorted.map(([word, count]) => ({ word, count, pct: (count / max) * 100 }));
}

export interface KwicLine {
  before: string;
  match: string;
  after: string;
}

/** Returns all KWIC (Key Word In Context) lines for a word in text. */
export function computeKwic(text: string, word: string, contextChars = 40): KwicLine[] {
  if (!word.trim()) return [];
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(escaped, 'gi');
  const lines: KwicLine[] = [];
  let m: RegExpExecArray | null;

  while ((m = re.exec(text)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    lines.push({
      before: text.slice(Math.max(0, start - contextChars), start),
      match:  m[0],
      after:  text.slice(end, Math.min(text.length, end + contextChars)),
    });
  }
  return lines;
}
```

- [ ] **Step 2: Create `src/scripts/notas/qa-analyzer-logic.test.mjs`**

```js
// src/scripts/notas/qa-analyzer-logic.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

// Import compiled output — run tsc first or use ts-node equivalent
// For this project, we import the TS file directly via --import flag
import { computeFrequency, computeKwic, STOPWORDS } from './qa-analyzer-logic.ts';

test('computeFrequency returns top words excluding stopwords', () => {
  const text = 'música ritmo música tiempo ritmo música la la la el el';
  const result = computeFrequency(text, 5);
  assert.equal(result[0].word, 'música');
  assert.equal(result[0].count, 3);
  assert.equal(result[1].word, 'ritmo');
  assert.equal(result[1].count, 2);
  // Stopwords 'la' and 'el' must not appear
  assert.ok(!result.find(r => r.word === 'la'));
  assert.ok(!result.find(r => r.word === 'el'));
});

test('computeFrequency pct: top word is always 100', () => {
  const text = 'abc abc abc xyz xyz';
  const result = computeFrequency(text, 10);
  assert.equal(result[0].pct, 100);
  assert.ok(result[1].pct < 100);
});

test('computeKwic finds all occurrences with context', () => {
  const text = 'la música es bella. Sin música no hay vida. Música everywhere.';
  const lines = computeKwic(text, 'música', 10);
  assert.equal(lines.length, 3);
  assert.ok(lines[0].match.toLowerCase() === 'música');
  assert.ok(lines[0].before.length <= 10);
  assert.ok(lines[0].after.length <= 10);
});

test('computeKwic returns empty for missing word', () => {
  const lines = computeKwic('hello world', 'xyz');
  assert.deepEqual(lines, []);
});

test('computeKwic is case-insensitive', () => {
  const lines = computeKwic('Música y musica y MÚSICA', 'música');
  assert.equal(lines.length, 3);
});
```

- [ ] **Step 3: Run the tests**

```bash
node --test --experimental-strip-types "src/scripts/notas/qa-analyzer-logic.test.mjs"
```

Expected: `✔ computeFrequency returns top words excluding stopwords`, all 5 tests pass.

If `--experimental-strip-types` is not available (Node < 22.6), compile first:
```bash
npx tsc --outDir dist/test src/scripts/notas/qa-analyzer-logic.ts && \
  node --test "src/scripts/notas/qa-analyzer-logic.test.mjs"
```

- [ ] **Step 4: Commit**

```bash
git add src/scripts/notas/
git commit -m "feat: QA analyzer pure logic (frequency + KWIC) with unit tests"
```

---

## Task 5: `db-note` + `qa-analyzer` panel kinds in `dockview-workspace.ts`

**Files:**
- Modify: `src/scripts/course/dockview-workspace.ts`

- [ ] **Step 1: Extend `PanelParams` union type**

Find the `PanelParams` type (around line 22) and replace it:

```ts
type PanelParams =
  | { kind?: 'note'; slug: string; courseId: string; mode: NoteMode }
  | { kind: 'media'; url: string; title: string }
  | { kind: 'db-note'; noteId: string; title: string; courseId?: string }
  | { kind: 'qa-analyzer'; noteId?: string; noteTitle?: string };
```

- [ ] **Step 2: Add `db-note` handler in `createComponent`**

Inside the `createComponent` callback, after the existing `if (params.kind === 'media')` block (around line 637), add:

```ts
      if (params.kind === 'db-note') {
        const { shell, bodyEl, pencilBtn, statusDot } = buildShell(
          panelId, params.noteId, params.title, dockview,
        );
        const state: DbNotePanelState = {
          noteId: params.noteId,
          mode: 'preview',
          bodyEl,
          statusDot,
          pencilBtn,
        };
        dbNotePanelStates.set(panelId, state);
        pencilBtn.addEventListener('click', () => {
          if (state.mode === 'preview') enterDbNoteEditMode(state);
          else void enterDbNotePreviewMode(state);
        });
        void loadDbNotePreview(state);
        return { element: shell, init: () => {} };
      }

      if (params.kind === 'qa-analyzer') {
        const shell = buildQaShell(panelId, params.noteTitle ?? '', dockview);
        qaShells.set(panelId, shell);
        if (params.noteId) {
          const noteState = [...dbNotePanelStates.values()].find(s => s.noteId === params.noteId);
          if (noteState?.bodyEl.textContent) {
            void activateQaNote(shell, params.noteId, params.noteTitle ?? '', noteState.bodyEl.textContent);
          }
        }
        return { element: shell.root, init: () => {} };
      }
```

- [ ] **Step 3: Add `DbNotePanelState` type and state map near the top of the file (after `PanelState`)**

```ts
type DbNotePanelState = {
  noteId: string;
  mode: NoteMode;
  bodyEl: HTMLElement;
  statusDot: HTMLElement;
  pencilBtn: HTMLButtonElement;
  cmDestroy?: () => void;
};

const dbNotePanelStates = new Map<string, DbNotePanelState>();
```

Also add near the module-level declarations:

```ts
const qaShells = new Map<string, QaShell>();
let _activeQaPanelId: string | null = null;
```

- [ ] **Step 4: Add `loadDbNotePreview` and `enterDbNoteEditMode` helper functions**

Add after the existing `enterPreviewMode` function (around line 593):

```ts
async function loadDbNotePreview(state: DbNotePanelState) {
  state.mode = 'preview';
  state.bodyEl.innerHTML = '<p style="padding:1rem;opacity:.4;font-size:.85rem;">Cargando…</p>';
  try {
    const r = await fetch(`/api/live/notes?id=${state.noteId}`);
    if (!r.ok) throw new Error('fetch failed');
    const d = await r.json() as { notes?: any[] };
    const note = d.notes?.[0];
    if (!note) { state.bodyEl.innerHTML = '<p style="padding:1rem;opacity:.4;">Nota no encontrada</p>'; return; }
    configureMarked();
    injectMdCss();
    const html = String(marked.parse(note.body ?? '', { async: false }));
    state.bodyEl.innerHTML = `<div class="cnw-md" style="padding:1.2rem 1.5rem;font-size:var(--font-size-base,1rem);line-height:1.72">${html}</div>`;
    updateDbNoteHud(state, note.body ?? '');
  } catch {
    state.bodyEl.innerHTML = '<p style="padding:1rem;color:#c87e7e;font-size:.85rem;">Error al cargar</p>';
  }
}

function enterDbNoteEditMode(state: DbNotePanelState) {
  state.mode = 'edit';
  state.pencilBtn.title = 'Vista previa';
  state.bodyEl.innerHTML = '';

  const form = document.createElement('div');
  form.style.cssText = 'display:flex;flex-direction:column;height:100%;padding:.6rem;gap:.4rem;box-sizing:border-box';

  const ta = document.createElement('textarea');
  ta.style.cssText = 'flex:1;font-family:var(--font-mono,monospace);font-size:.9rem;padding:.5rem;border:1px solid var(--c-border,rgba(120,120,140,.2));border-radius:3px;background:transparent;color:inherit;resize:none;line-height:1.6';
  form.appendChild(ta);
  state.bodyEl.appendChild(form);

  // Load raw body for editing
  fetch(`/api/live/notes?id=${state.noteId}`)
    .then(r => r.json())
    .then((d: any) => { ta.value = d.notes?.[0]?.body ?? ''; ta.focus(); })
    .catch(() => {});

  const saveNote = async () => {
    state.statusDot.className = 'cnw-status cnw-status--saving';
    const res = await fetch('/api/live/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: state.noteId, body: ta.value }),
    }).catch(() => null);
    state.statusDot.className = res?.ok ? 'cnw-status cnw-status--saved' : 'cnw-status cnw-status--error';
    setTimeout(() => { state.statusDot.className = 'cnw-status'; }, 2000);
    updateDbNoteHud(state, ta.value);
  };

  ta.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); void saveNote(); }
  });
  ta.addEventListener('blur', () => void saveNote());
}

async function enterDbNotePreviewMode(state: DbNotePanelState) {
  state.pencilBtn.title = 'Editar';
  await loadDbNotePreview(state);
}

function updateDbNoteHud(state: DbNotePanelState, text: string) {
  const hud = state.bodyEl.closest('.cnw-shell')?.querySelector<HTMLElement>('.cnw-hud');
  if (!hud) return;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const chars = text.length;
  const sentences = text.split(/[.!?]+/).filter(s => s.trim()).length;
  hud.querySelector<HTMLElement>('.cnw-hud-stats')!.textContent =
    `${words} palabras · ${chars.toLocaleString()} caracteres · ${sentences} oraciones`;
}
```

- [ ] **Step 5: Add `QaShell` type and `buildQaShell` + `activateQaNote` helpers**

Add after `updateDbNoteHud`:

```ts
type QaShell = {
  root: HTMLElement;
  titleEl: HTMLSpanElement;
  freqList: HTMLElement;
  kwicInput: HTMLInputElement;
  kwicList: HTMLElement;
  activeText: string;
};

function buildQaShell(panelId: string, initialTitle: string, dockview: DockviewComponent): QaShell {
  const { shell } = buildShell(panelId, 'qa', 'QA', dockview);
  shell.querySelector<HTMLElement>('.cnw-title')!.textContent = 'QA';

  const titleEl = document.createElement('span');
  titleEl.className = 'cnw-qa-source';
  titleEl.style.cssText = 'font-size:.7rem;opacity:.5;padding-left:.4rem;';
  titleEl.textContent = initialTitle;
  shell.querySelector('.cnw-header')!.insertBefore(titleEl, shell.querySelector('.cnw-mode-btn'));

  const body = shell.querySelector<HTMLElement>('.cnw-body')!;
  body.style.cssText = 'display:flex;height:100%;overflow:hidden';

  const freqPane = document.createElement('div');
  freqPane.style.cssText = 'width:200px;flex-shrink:0;overflow-y:auto;padding:.5rem;border-right:1px solid var(--c-border,rgba(120,120,140,.15))';
  const freqLabel = document.createElement('div');
  freqLabel.style.cssText = 'font-size:.58rem;letter-spacing:.1em;text-transform:uppercase;opacity:.4;margin-bottom:.4rem';
  freqLabel.textContent = 'Frecuencia';
  freqPane.appendChild(freqLabel);
  const freqList = document.createElement('div');
  freqPane.appendChild(freqList);

  const kwicPane = document.createElement('div');
  kwicPane.style.cssText = 'flex:1;overflow-y:auto;padding:.5rem;display:flex;flex-direction:column;gap:.4rem';
  const kwicLabel = document.createElement('div');
  kwicLabel.style.cssText = 'font-size:.58rem;letter-spacing:.1em;text-transform:uppercase;opacity:.4;margin-bottom:.2rem';
  kwicLabel.textContent = 'Concordancia';
  const kwicInput = document.createElement('input');
  kwicInput.type = 'text';
  kwicInput.placeholder = 'Buscar palabra…';
  kwicInput.style.cssText = 'font:inherit;font-size:.8rem;padding:.2rem .4rem;border:1px solid var(--c-border,rgba(120,120,140,.2));border-radius:2px;background:transparent;color:inherit;width:100%;box-sizing:border-box;margin-bottom:.3rem';
  const kwicList = document.createElement('div');
  kwicPane.appendChild(kwicLabel);
  kwicPane.appendChild(kwicInput);
  kwicPane.appendChild(kwicList);

  body.appendChild(freqPane);
  body.appendChild(kwicPane);

  const empty = document.createElement('div');
  empty.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;opacity:.3;font-size:.85rem;pointer-events:none';
  empty.textContent = 'Arrastra una nota aquí para analizar';
  empty.className = 'cnw-qa-empty';
  body.style.position = 'relative';
  body.appendChild(empty);

  return { root: shell, titleEl, freqList, kwicList, kwicInput, activeText: '' };
}

async function activateQaNote(qa: QaShell, noteId: string, title: string, textOverride?: string) {
  let text = textOverride ?? '';
  if (!text) {
    const r = await fetch(`/api/live/notes?id=${noteId}`).catch(() => null);
    const d = r ? await r.json().catch(() => null) : null;
    text = d?.notes?.[0]?.body ?? '';
  }
  qa.activeText = text;
  qa.titleEl.textContent = title;
  qa.root.querySelector<HTMLElement>('.cnw-qa-empty')!.style.display = 'none';

  const { computeFrequency, computeKwic } = await import('../notas/qa-analyzer-logic');
  const freq = computeFrequency(text, 20);

  qa.freqList.innerHTML = '';
  for (const { word, count, pct } of freq) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:.3rem;margin-bottom:.18rem;cursor:pointer';
    row.addEventListener('click', () => { qa.kwicInput.value = word; renderKwic(qa, word); });
    const bar = document.createElement('div');
    bar.style.cssText = `height:8px;border-radius:2px;background:var(--c-link,#2337ff);opacity:.55;width:${pct}%;flex-shrink:0;min-width:4px;max-width:80px`;
    const label = document.createElement('span');
    label.style.cssText = 'font-size:.7rem;opacity:.7;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100px';
    label.textContent = `${word} (${count})`;
    row.appendChild(bar);
    row.appendChild(label);
    qa.freqList.appendChild(row);
  }

  qa.kwicInput.addEventListener('input', () => renderKwic(qa, qa.kwicInput.value));
  if (freq[0]) renderKwic(qa, freq[0].word);
}

function renderKwic(qa: QaShell, word: string) {
  const { computeKwic } = (window as any).__qaLogic as typeof import('../notas/qa-analyzer-logic');
  const lines = computeKwic(qa.activeText, word, 40);
  qa.kwicList.innerHTML = '';
  for (const { before, match, after } of lines) {
    const row = document.createElement('div');
    row.style.cssText = 'font-size:.78rem;line-height:1.5;padding:.15rem 0;opacity:.8;font-family:var(--font-mono,monospace)';
    row.innerHTML = `<span style="opacity:.5">${escHtml(before)}</span><mark style="background:rgba(255,200,0,.3);border-radius:1px">${escHtml(match)}</mark><span style="opacity:.5">${escHtml(after)}</span>`;
    qa.kwicList.appendChild(row);
  }
  if (!lines.length) {
    qa.kwicList.innerHTML = `<div style="opacity:.3;font-size:.78rem">Sin resultados</div>`;
  }
}
```

> **Note on `renderKwic` import:** The dynamic import in `activateQaNote` is async. For `renderKwic` (called synchronously on input), cache the module on `window.__qaLogic` inside `activateQaNote` after the dynamic import resolves:
> ```ts
> (window as any).__qaLogic = { computeFrequency, computeKwic };
> ```

- [ ] **Step 6: Add Writing Analytics HUD to `buildShell` in `dockview-shell.ts`**

In `dockview-shell.ts`, after `shell.appendChild(body)` and before the `return`, add:

```ts
  const hud = document.createElement('div');
  hud.className = 'cnw-hud';
  hud.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:0 .6rem;height:20px;flex-shrink:0;border-top:none';

  const stats = document.createElement('span');
  stats.className = 'cnw-hud-stats';
  stats.style.cssText = 'font-size:.62rem;opacity:.4;font-family:var(--font-mono,monospace)';
  hud.appendChild(stats);

  const qaBtn = document.createElement('button');
  qaBtn.className = 'cnw-hud-qa-btn';
  qaBtn.title = 'Enviar al QA Analyzer';
  qaBtn.style.cssText = 'border:none;background:none;font-size:.62rem;opacity:.55;cursor:pointer;padding:0;color:inherit;display:none';
  qaBtn.textContent = 'QA ↗';
  hud.appendChild(qaBtn);

  shell.appendChild(hud);
```

The `qaBtn` is shown and wired in `enterDbNoteEditMode`/`loadDbNotePreview` — see Task 7.

- [ ] **Step 7: Fix `onDidDrop` to recognise `text/x-musiki-note`**

In `dockview-workspace.ts`, find `dockview.onDidDrop` (around line 756). Add handling for the new drag type:

```ts
  dockview.onDidDrop(event => {
    const slug = event.nativeEvent.dataTransfer?.getData('text/plain')?.trim();
    const noteId = event.nativeEvent.dataTransfer?.getData('text/x-musiki-note')?.trim();

    if (noteId) {
      const title = event.nativeEvent.dataTransfer?.getData('text/x-musiki-note-title') ?? noteId;
      const newId = `db-note-${noteId}-${Date.now()}`;
      pendingParams.set(newId, { kind: 'db-note', noteId, title });
      const referencePanel = dockview.panels[dockview.panels.length - 1] ?? undefined;
      dockview.addPanel({ id: newId, component: 'note-panel', position: referencePanel ? { referencePanel: referencePanel.id, direction: 'right' } : undefined });
      return;
    }

    if (slug && slug.startsWith('cursos/')) {
      // … existing slug handling unchanged …
    }
  });
```

- [ ] **Step 8: Remove the `musiki:open-notas` handler from `dockview-workspace.ts`**

Delete lines 782–789 (the `window.addEventListener('musiki:open-notas', ...)` block):

```ts
  // DELETE this entire block:
  window.addEventListener('musiki:open-notas', () => {
    if (dockview.panels.length > 0) {
      dockview.panels[0].api.setActive();
    } else if (initialSlug) {
      openNote(initialSlug, 'preview');
    }
  }, { signal });
```

- [ ] **Step 9: Register `musiki:send-to-qa` listener**

In `initDockviewWorkspace`, after the DnD handlers, add:

```ts
  window.addEventListener('musiki:send-to-qa', async (e: Event) => {
    const ev = e as CustomEvent<{ noteId: string; content: string; title: string }>;
    // Find existing QA panel or open a new one
    const existingQaId = _activeQaPanelId ?? [...qaShells.keys()][0];
    const qa = existingQaId ? qaShells.get(existingQaId) : null;

    if (qa) {
      await activateQaNote(qa, ev.detail.noteId, ev.detail.title, ev.detail.content);
    } else {
      const newId = `qa-${Date.now()}`;
      pendingParams.set(newId, { kind: 'qa-analyzer', noteId: ev.detail.noteId, noteTitle: ev.detail.title });
      const refPanel = dockview.panels[dockview.panels.length - 1] ?? undefined;
      dockview.addPanel({ id: newId, component: 'note-panel', position: refPanel ? { referencePanel: refPanel.id, direction: 'right' } : undefined });
      // activateQaNote will be called from createComponent via pendingParams
    }
  }, { signal });
```

Also in `dockview.onDidRemovePanel`:

```ts
  dockview.onDidRemovePanel(event => {
    qaShells.delete(event.id);
    if (_activeQaPanelId === event.id) _activeQaPanelId = null;
    // … existing panelStates cleanup unchanged …
  });
```

- [ ] **Step 10: Wire QA button in HUD after note loads**

In `loadDbNotePreview`, after setting `state.bodyEl.innerHTML`, add:

```ts
    const qaBtn = state.bodyEl.closest('.cnw-shell')?.querySelector<HTMLButtonElement>('.cnw-hud-qa-btn');
    if (qaBtn) {
      qaBtn.style.display = 'inline';
      qaBtn.onclick = () => window.dispatchEvent(new CustomEvent('musiki:send-to-qa', {
        detail: { noteId: state.noteId, content: note.body ?? '', title: note.title ?? '' },
      }));
    }
```

- [ ] **Step 11: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

- [ ] **Step 12: Commit**

```bash
git add src/scripts/course/dockview-workspace.ts src/scripts/course/dockview-shell.ts
git commit -m "feat: db-note + qa-analyzer panel kinds in course dockview"
```

---

## Task 6: NOTAS sidebar section in `[...slug].astro`

**Files:**
- Create: `src/scripts/course/notes-sidebar.ts`
- Modify: `src/pages/[...slug].astro`

- [ ] **Step 1: Create `src/scripts/course/notes-sidebar.ts`**

```ts
// src/scripts/course/notes-sidebar.ts

export interface NoteFolder {
  id: string; name: string; parentId: string | null; courseId: string | null;
}
export interface NoteItem {
  id: string; title: string; folderId: string | null; updatedAt: string;
}

export async function loadNotesTree(courseId: string): Promise<{ folders: NoteFolder[]; notes: NoteItem[] }> {
  const [fRes, nRes] = await Promise.all([
    fetch(`/api/note-folders?courseId=${encodeURIComponent(courseId)}`),
    fetch(`/api/live/notes?courseId=${encodeURIComponent(courseId)}&limit=200`),
  ]);
  const fData = fRes.ok ? await fRes.json() : { folders: [] };
  const nData = nRes.ok ? await nRes.json() : { notes: [] };
  return { folders: fData.folders ?? [], notes: nData.notes ?? [] };
}

export function renderNotesTree(
  container: HTMLElement,
  folders: NoteFolder[],
  notes: NoteItem[],
  courseId: string,
) {
  container.innerHTML = '';

  // Build folder children map
  const children = new Map<string | null, NoteFolder[]>();
  for (const f of folders) {
    const key = f.parentId ?? null;
    if (!children.has(key)) children.set(key, []);
    children.get(key)!.push(f);
  }

  const notesByFolder = new Map<string | null, NoteItem[]>();
  for (const n of notes) {
    const key = n.folderId ?? null;
    if (!notesByFolder.has(key)) notesByFolder.set(key, []);
    notesByFolder.get(key)!.push(n);
  }

  function renderFolder(parentId: string | null, indent: number): HTMLElement {
    const frag = document.createElement('div');

    // Subfolders
    for (const folder of (children.get(parentId) ?? [])) {
      const details = document.createElement('details');
      details.open = true;
      details.style.cssText = `padding-left:${indent * 8}px`;
      const summary = document.createElement('summary');
      summary.className = 'notas-sb-folder';
      summary.style.cssText = 'font-size:.72rem;cursor:pointer;list-style:none;padding:.15rem .3rem;display:flex;align-items:center;gap:.25rem;opacity:.7';
      summary.innerHTML = `<span>📁</span><span class="notas-sb-folder-name">${escHtml(folder.name)}</span>`;
      details.appendChild(summary);

      // Folder context menu (rename/delete) on right-click
      summary.addEventListener('contextmenu', e => { e.preventDefault(); showFolderMenu(e, folder, container, courseId); });

      const inner = renderFolder(folder.id, indent + 1);
      details.appendChild(inner);
      frag.appendChild(details);
    }

    // Notes in this folder
    for (const note of (notesByFolder.get(parentId) ?? [])) {
      frag.appendChild(makeNoteItem(note, indent));
    }

    return frag;
  }

  container.appendChild(renderFolder(null, 0));
}

function makeNoteItem(note: NoteItem, indent: number): HTMLElement {
  const el = document.createElement('div');
  el.className = 'notas-sb-item';
  el.draggable = true;
  el.dataset.noteId = note.id;
  el.style.cssText = `padding:.18rem .4rem .18rem ${indent * 8 + 4}px;font-size:.73rem;cursor:pointer;display:flex;align-items:center;gap:.25rem;border-left:2px solid transparent;opacity:.75;transition:opacity 100ms,border-color 100ms`;
  el.title = note.title || '(sin título)';
  el.innerHTML = `<span style="opacity:.5">🗒</span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(note.title || '(sin título)')}</span>`;

  el.addEventListener('mouseenter', () => { el.style.opacity = '1'; });
  el.addEventListener('mouseleave', () => { el.style.opacity = '.75'; });

  el.addEventListener('dragstart', e => {
    if (!e.dataTransfer) return;
    e.dataTransfer.setData('text/x-musiki-note', note.id);
    e.dataTransfer.setData('text/x-musiki-note-title', note.title || '');
    e.dataTransfer.effectAllowed = 'copy';
  });

  el.addEventListener('contextmenu', e => { e.preventDefault(); showNoteMenu(e, note); });
  return el;
}

function showNoteMenu(e: MouseEvent, note: NoteItem) {
  const existing = document.querySelector('.notas-sb-ctx');
  existing?.remove();
  const menu = document.createElement('div');
  menu.className = 'notas-sb-ctx';
  menu.style.cssText = `position:fixed;left:${e.clientX}px;top:${e.clientY}px;background:var(--c-bg);border:1px solid var(--c-border,rgba(120,120,140,.2));border-radius:4px;box-shadow:0 2px 8px rgba(0,0,0,.15);z-index:9999;min-width:120px;padding:.25rem 0;font-size:.75rem`;
  const items: [string, () => void][] = [
    ['Renombrar', () => renameNote(note)],
    ['Eliminar', () => deleteNote(note)],
  ];
  for (const [label, action] of items) {
    const btn = document.createElement('button');
    btn.style.cssText = 'display:block;width:100%;text-align:left;padding:.3rem .7rem;border:none;background:none;cursor:pointer;color:inherit;font:inherit;font-size:.75rem';
    btn.textContent = label;
    btn.addEventListener('click', () => { menu.remove(); action(); });
    menu.appendChild(btn);
  }
  document.body.appendChild(menu);
  const dismiss = () => menu.remove();
  setTimeout(() => document.addEventListener('click', dismiss, { once: true }), 0);
}

function showFolderMenu(e: MouseEvent, folder: NoteFolder, container: HTMLElement, courseId: string) {
  const existing = document.querySelector('.notas-sb-ctx');
  existing?.remove();
  const menu = document.createElement('div');
  menu.className = 'notas-sb-ctx';
  menu.style.cssText = `position:fixed;left:${e.clientX}px;top:${e.clientY}px;background:var(--c-bg);border:1px solid var(--c-border,rgba(120,120,140,.2));border-radius:4px;box-shadow:0 2px 8px rgba(0,0,0,.15);z-index:9999;min-width:120px;padding:.25rem 0;font-size:.75rem`;
  const items: [string, () => void][] = [
    ['Renombrar', () => renameFolder(folder, container, courseId)],
    ['Eliminar', () => deleteFolder(folder, container, courseId)],
  ];
  for (const [label, action] of items) {
    const btn = document.createElement('button');
    btn.style.cssText = 'display:block;width:100%;text-align:left;padding:.3rem .7rem;border:none;background:none;cursor:pointer;color:inherit;font:inherit;font-size:.75rem';
    btn.textContent = label;
    btn.addEventListener('click', () => { menu.remove(); action(); });
    menu.appendChild(btn);
  }
  document.body.appendChild(menu);
  setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 0);
}

async function renameNote(note: NoteItem) {
  const name = prompt('Nuevo nombre:', note.title);
  if (!name?.trim() || name === note.title) return;
  await fetch('/api/live/notes', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: note.id, title: name.trim() }),
  });
  document.querySelector<HTMLElement>(`[data-note-id="${note.id}"] span:last-child`)!.textContent = name.trim();
}

async function deleteNote(note: NoteItem) {
  if (!confirm('¿Eliminar esta nota?')) return;
  await fetch(`/api/live/notes?id=${note.id}`, { method: 'DELETE' });
  document.querySelector(`[data-note-id="${note.id}"]`)?.remove();
}

async function renameFolder(folder: NoteFolder, container: HTMLElement, courseId: string) {
  const name = prompt('Nuevo nombre:', folder.name);
  if (!name?.trim() || name === folder.name) return;
  await fetch('/api/note-folders', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: folder.id, name: name.trim() }),
  });
  await refreshTree(container, courseId);
}

async function deleteFolder(folder: NoteFolder, container: HTMLElement, courseId: string) {
  if (!confirm('¿Eliminar carpeta? Las notas dentro quedarán sin carpeta.')) return;
  await fetch(`/api/note-folders?id=${folder.id}`, { method: 'DELETE' });
  await refreshTree(container, courseId);
}

async function refreshTree(container: HTMLElement, courseId: string) {
  const { folders, notes } = await loadNotesTree(courseId);
  renderNotesTree(container, folders, notes, courseId);
}

function escHtml(s: string) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
```

- [ ] **Step 2: Extend `sidebarChapterEntries` type in `[...slug].astro`**

Find the type declaration around line 369:

```ts
const sidebarChapterEntries: Array<
  { kind: 'chapter'; chapterName: string; lessons: ... }
  | { kind: 'recursos' }
>
```

Add `| { kind: 'notas'; courseId: string }` to the union.

- [ ] **Step 3: Push NOTAS entry after recursos entries**

After all the `sidebarChapterEntries.push({ kind: 'recursos' })` calls, add:

```ts
if (session?.user && (canonicalCourseId || courseSlug)) {
  sidebarChapterEntries.push({ kind: 'notas', courseId: canonicalCourseId || courseSlug || '' });
}
```

- [ ] **Step 4: Render the NOTAS section in the sidebar template**

In the sidebar rendering loop (around line 3648 where `sidebarChapterEntries.map` is called), add a handler after the recursos block:

```astro
if (entry.kind === 'notas') {
  return (
    <div class="chapter" data-notas-sidebar data-notas-course-id={entry.courseId}>
      <details class="chapter-details" open={false}>
        <summary class="chapter-title">
          <span class="chapter-title-main">
            <span class="chapter-title-text">NOTAS</span>
            <button
              type="button"
              class="chapter-editor-link notas-sb-new-btn"
              title="Nueva nota"
              onclick="event.stopPropagation()"
              style="border:none;background:none;cursor:pointer;padding:0 2px;opacity:.6;font-size:.8rem"
            >+</button>
          </span>
          <span class="chapter-caret">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </span>
        </summary>
        <div class="notas-sb-tree" style="padding:.3rem 0"></div>
      </details>
    </div>
  );
}
```

- [ ] **Step 5: Add client script to boot NOTAS sidebar**

At the bottom of `[...slug].astro`, after the existing sidebar scripts, add:

```astro
{session?.user && (
  <script>
    import { loadNotesTree, renderNotesTree } from '../scripts/course/notes-sidebar';

    async function bootNotasSidebar() {
      const sidebarEl = document.querySelector<HTMLElement>('[data-notas-sidebar]');
      if (!sidebarEl) return;
      const courseId = sidebarEl.dataset.notasCourseId ?? '';
      if (!courseId) return;

      const treeEl = sidebarEl.querySelector<HTMLElement>('.notas-sb-tree');
      if (!treeEl) return;

      const details = sidebarEl.querySelector('details');
      // Lazy-load: only fetch when expanded
      let loaded = false;
      details?.addEventListener('toggle', async () => {
        if (!details.open || loaded) return;
        loaded = true;
        const { folders, notes } = await loadNotesTree(courseId);
        renderNotesTree(treeEl, folders, notes, courseId);
      });

      // New note button
      sidebarEl.querySelector<HTMLButtonElement>('.notas-sb-new-btn')?.addEventListener('click', async () => {
        const title = prompt('Nombre de la nueva nota:');
        if (!title?.trim()) return;
        const res = await fetch('/api/live/notes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: title.trim(), body: '', courseId }),
        });
        if (!res.ok) return;
        if (!details?.open) { details!.open = true; return; }
        // Refresh tree
        const { folders, notes } = await loadNotesTree(courseId);
        renderNotesTree(treeEl, folders, notes, courseId);
      });
    }

    bootNotasSidebar();
    document.addEventListener('astro:page-load', bootNotasSidebar);
  </script>
)}
```

- [ ] **Step 6: Verify sidebar appears and expands**

Start dev server and navigate to a course page. Confirm:
1. "NOTAS" section appears in sidebar below RECURSOS
2. Expanding it fetches and renders the tree (empty initially)
3. "+ " button creates a note via prompt

- [ ] **Step 7: Commit**

```bash
git add src/scripts/course/notes-sidebar.ts src/pages/\[...slug\].astro
git commit -m "feat: NOTAS sidebar section on course pages (folder tree + CRUD + drag)"
```

---

## Task 7: `PersonalNotesOverlay.astro` + `personal-notes-workspace.ts`

**Files:**
- Create: `src/components/notas/PersonalNotesOverlay.astro`
- Create: `src/scripts/notas/personal-notes-workspace.ts`
- Modify: `src/pages/[...slug].astro`
- Modify: `src/components/Ribbon.astro`

- [ ] **Step 1: Create `src/scripts/notas/personal-notes-workspace.ts`**

```ts
// src/scripts/notas/personal-notes-workspace.ts
import { DockviewComponent } from 'dockview-core';
import { buildShell, injectWorkspaceCss } from '../course/dockview-shell';

export interface PersonalNotesWorkspace {
  destroy(): void;
}

interface BrowserPanelState {
  courseId: string | null;
  searchQuery: string;
}

const pendingParams = new Map<string, any>();
let _workspace: PersonalNotesWorkspace | null = null;
let _ctrl: AbortController | null = null;

export function initPersonalNotesWorkspace(
  container: HTMLElement,
): PersonalNotesWorkspace {
  if (_workspace) { _ctrl?.abort(); _workspace = null; }
  _ctrl = new AbortController();
  const { signal } = _ctrl;

  const containerId = 'pnw-root';
  container.id = containerId;
  injectWorkspaceCss(containerId);

  const dockview = new DockviewComponent(container, {
    createComponent: (options) => {
      const params = pendingParams.get(options.id);
      pendingParams.delete(options.id);

      if (!params || params.kind === 'browser') {
        return { element: buildBrowserPanel(options.id, dockview, signal), init: () => {} };
      }

      if (params.kind === 'db-note') {
        // Reuse same db-note rendering as dockview-workspace
        const { shell, bodyEl, pencilBtn, statusDot } = buildShell(options.id, params.noteId, params.title, dockview);
        void loadDbNoteContent(bodyEl, statusDot, pencilBtn, params.noteId);
        return { element: shell, init: () => {} };
      }

      return { element: document.createElement('div'), init: () => {} };
    },
  });

  const ro = new ResizeObserver(entries => {
    for (const e of entries) dockview.layout(e.contentRect.width, e.contentRect.height);
  });
  ro.observe(container);

  // Open browser panel on init
  pendingParams.set('pnw-browser', { kind: 'browser' });
  dockview.addPanel({ id: 'pnw-browser', component: 'note-panel' });

  _workspace = {
    destroy: () => {
      _ctrl?.abort();
      ro.disconnect();
      dockview.dispose();
      _workspace = null;
    },
  };
  return _workspace;
}

// ── Browser panel ──────────────────────────────────────────────────────────

function buildBrowserPanel(panelId: string, dockview: DockviewComponent, signal: AbortSignal): HTMLElement {
  const el = document.createElement('div');
  el.style.cssText = 'display:flex;flex-direction:column;height:100%;background:var(--c-bg);border-right:1px solid var(--c-border,rgba(120,120,140,.15))';
  el.style.minWidth = '200px';

  const search = document.createElement('input');
  search.type = 'search';
  search.placeholder = '🔍 Buscar notas…';
  search.style.cssText = 'margin:.5rem;padding:.3rem .5rem;border:1px solid var(--c-border,rgba(120,120,140,.2));border-radius:3px;background:transparent;color:inherit;font:inherit;font-size:.8rem';

  const tree = document.createElement('div');
  tree.style.cssText = 'flex:1;overflow-y:auto;padding:.2rem 0';

  const footer = document.createElement('div');
  footer.style.cssText = 'padding:.4rem .5rem;border-top:1px solid var(--c-border,rgba(120,120,140,.1))';
  const newBtn = document.createElement('button');
  newBtn.textContent = '+ nueva nota';
  newBtn.style.cssText = 'font:inherit;font-size:.72rem;border:1px solid rgba(60,140,80,.5);color:rgba(40,120,60,.9);background:none;border-radius:2px;padding:.2rem .5rem;cursor:pointer;width:100%';
  footer.appendChild(newBtn);

  el.appendChild(search);
  el.appendChild(tree);
  el.appendChild(footer);

  // Load all notes (global, all courses)
  let allNotes: any[] = [];
  let allFolders: any[] = [];

  async function loadAll() {
    const [nRes, fRes] = await Promise.all([
      fetch('/api/live/notes?limit=200'),
      fetch('/api/note-folders'),
    ]);
    allNotes = nRes.ok ? (await nRes.json()).notes ?? [] : [];
    allFolders = fRes.ok ? (await fRes.json()).folders ?? [] : [];
    render('');
  }

  function render(query: string) {
    tree.innerHTML = '';
    const filtered = query
      ? allNotes.filter(n => (n.title ?? '').toLowerCase().includes(query.toLowerCase()))
      : allNotes;

    // Group by courseId with faint separator
    const byCourse = new Map<string, any[]>();
    for (const n of filtered) {
      const k = n.courseId ?? '__global';
      if (!byCourse.has(k)) byCourse.set(k, []);
      byCourse.get(k)!.push(n);
    }

    let first = true;
    for (const [courseKey, notes] of byCourse) {
      if (!first) {
        const sep = document.createElement('div');
        sep.style.cssText = 'height:1px;background:var(--c-border,rgba(120,120,140,.1));margin:.3rem .5rem';
        tree.appendChild(sep);
      }
      first = false;

      for (const note of notes) {
        const item = document.createElement('div');
        item.style.cssText = 'padding:.22rem .7rem;font-size:.75rem;cursor:pointer;opacity:.75;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;transition:opacity 100ms';
        item.title = note.title || '(sin título)';
        item.textContent = note.title || '(sin título)';
        item.addEventListener('mouseenter', () => { item.style.opacity = '1'; });
        item.addEventListener('mouseleave', () => { item.style.opacity = '.75'; });
        item.addEventListener('click', () => openNotePanel(note.id, note.title ?? '', dockview));
        tree.appendChild(item);
      }
    }

    if (!filtered.length) {
      const empty = document.createElement('div');
      empty.style.cssText = 'padding:.5rem .7rem;font-size:.78rem;opacity:.35';
      empty.textContent = query ? 'Sin resultados' : 'Sin notas aún';
      tree.appendChild(empty);
    }
  }

  search.addEventListener('input', () => render(search.value));

  newBtn.addEventListener('click', async () => {
    const title = prompt('Nombre de la nueva nota:');
    if (!title?.trim()) return;
    const res = await fetch('/api/live/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: title.trim(), body: '' }),
    });
    if (!res.ok) return;
    await loadAll();
  });

  void loadAll();
  return el;
}

function openNotePanel(noteId: string, title: string, dockview: DockviewComponent) {
  const newId = `pnw-note-${noteId}`;
  const existing = dockview.getGroupPanel(newId);
  if (existing) { existing.api.setActive(); return; }
  pendingParams.set(newId, { kind: 'db-note', noteId, title });
  const refPanel = dockview.panels[dockview.panels.length - 1] ?? undefined;
  dockview.addPanel({ id: newId, component: 'note-panel', position: refPanel ? { referencePanel: refPanel.id, direction: 'right' } : undefined });
}

// ── Shared db-note loading (duplicated from dockview-workspace for isolation) ──

async function loadDbNoteContent(
  bodyEl: HTMLElement,
  statusDot: HTMLElement,
  pencilBtn: HTMLButtonElement,
  noteId: string,
) {
  bodyEl.innerHTML = '<p style="padding:1rem;opacity:.4;font-size:.85rem;">Cargando…</p>';
  const r = await fetch(`/api/live/notes?id=${noteId}`).catch(() => null);
  const d = r ? await r.json().catch(() => null) : null;
  const note = d?.notes?.[0];
  if (!note) { bodyEl.innerHTML = '<p style="padding:1rem;opacity:.4">Nota no encontrada</p>'; return; }
  const { marked } = await import('marked');
  const html = String(marked.parse(note.body ?? '', { async: false }));
  bodyEl.innerHTML = `<div style="padding:1.2rem 1.5rem;font-size:var(--font-size-base,1rem);line-height:1.72">${html}</div>`;
}
```

- [ ] **Step 2: Create `src/components/notas/PersonalNotesOverlay.astro`**

```astro
---
// src/components/notas/PersonalNotesOverlay.astro
---

<div class="pnw-overlay" id="personal-notes-overlay" aria-hidden="true">
  <div id="pnw-root" class="dockview-theme-light"></div>
</div>

<style>
  .pnw-overlay {
    position: fixed;
    inset: 0 0 0 var(--ribbon-width, 44px);
    z-index: 30;
    background: var(--c-bg);
    pointer-events: none;
    transform: translateY(100%);
    transition: transform 0.25s ease;
    display: flex;
    flex-direction: column;
  }
  .pnw-overlay.is-open {
    transform: translateY(0);
    pointer-events: auto;
  }
  #pnw-root {
    flex: 1;
    min-height: 0;
    --dv-sash-color: var(--c-border, rgba(120,120,140,.35));
  }
  @media (max-width: 500px) {
    .pnw-overlay { inset: 0 0 var(--ribbon-bottom-height, 60px) 0; }
  }
</style>

<script>
  import { initPersonalNotesWorkspace } from '../../scripts/notas/personal-notes-workspace';

  let workspace: ReturnType<typeof initPersonalNotesWorkspace> | null = null;

  function boot() {
    const overlay = document.getElementById('personal-notes-overlay');
    const root    = document.getElementById('pnw-root') as HTMLElement | null;
    if (!overlay || !root) return;

    let open = false;

    window.addEventListener('musiki:open-notas', () => {
      open = !open;
      overlay.classList.toggle('is-open', open);
      overlay.setAttribute('aria-hidden', String(!open));
      if (open && !workspace) workspace = initPersonalNotesWorkspace(root!);
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && open) {
        open = false;
        overlay.classList.remove('is-open');
        overlay.setAttribute('aria-hidden', 'true');
      }
    });
  }

  boot();
  document.addEventListener('astro:page-load', boot);
</script>
```

- [ ] **Step 3: Add `PersonalNotesOverlay` to `[...slug].astro`**

At the top of `[...slug].astro`, import:
```ts
import PersonalNotesOverlay from '../components/notas/PersonalNotesOverlay.astro';
```

Just before `</body>`, add (scoped to logged-in users):
```astro
{session?.user && <PersonalNotesOverlay />}
```

- [ ] **Step 4: Verify the overlay opens**

In the browser: navigate to a course page, click the Notas ribbon button. Confirm the overlay slides up from the bottom. Confirm the notes browser panel appears on the left with the search box and `+ nueva nota` button.

- [ ] **Step 5: Commit**

```bash
git add src/scripts/notas/personal-notes-workspace.ts \
        src/components/notas/PersonalNotesOverlay.astro \
        src/pages/\[...slug\].astro
git commit -m "feat: PersonalNotesOverlay + personal-notes-workspace (ribbon overlay)"
```

---

## Task 8: Room workspace — register `db-note` pod type

**Files:**
- Modify: `src/scripts/room/workspace/RoomWorkspaceManager.ts`
- Modify: `src/components/room/workspace/PodTemplates.astro`

- [ ] **Step 1: Add `db-note` to `POD_TYPES` in `RoomWorkspaceManager.ts`**

Find the `private POD_TYPES = [` array (line 33) and append:

```ts
    {
      id: "db-note",
      title: "NOTA",
      icon: "No",
      atomic: 23,
      color: "#93C47D",
      cat: "comm",
    },
```

- [ ] **Step 2: Add `db-note` handler in `createComponent`**

In the `createComponent` callback (around line 328), after the `if (id === "recursos" ...)` block, add:

```ts
              if (id === "db-note") {
                // noteId is passed via data attribute on the template element
                const noteId = element?.dataset?.noteId ?? '';
                const noteTitle = element?.dataset?.noteTitle ?? 'Nota';
                if (noteId) {
                  element!.innerHTML = '<p style="padding:1rem;opacity:.4;font-size:.85rem;">Cargando…</p>';
                  fetch(`/api/live/notes?id=${noteId}`)
                    .then(r => r.json())
                    .then((d: any) => {
                      const note = d?.notes?.[0];
                      if (note && element) {
                        import('marked').then(({ marked }) => {
                          const html = String(marked.parse(note.body ?? '', { async: false }));
                          element!.innerHTML = `<div style="padding:1rem;font-size:.9rem;line-height:1.7;overflow-y:auto;height:100%">${html}</div>`;
                        });
                      }
                    })
                    .catch(() => {
                      if (element) element.innerHTML = '<p style="padding:1rem;color:#c87e7e">Error al cargar</p>';
                    });
                }
              }
```

- [ ] **Step 3: Add `db-note` template to `PodTemplates.astro`**

In `src/components/room/workspace/PodTemplates.astro`, after the last `<div class="musiki-pod" ...>` block (before the closing `</div>` of `#musiki-pod-templates`), add:

```astro
  <!-- db-note pod: noteId and noteTitle are set dynamically before addPanel() -->
  <div class="musiki-pod" data-pod="db-note" data-pod-title="NOTA" hidden>
    <div style="height:100%;overflow-y:auto;padding:.5rem;font-size:.9rem;line-height:1.7">
      <!-- content injected by RoomWorkspaceManager createComponent handler -->
    </div>
  </div>
```

- [ ] **Step 4: Add a helper on RoomWorkspaceManager to open a db-note pod**

In `RoomWorkspaceManager.ts`, add a public method after `togglePod`:

```ts
  public openDbNote(noteId: string, title: string): void {
    if (!this.dockview) return;
    const panelId = `db-note-${noteId}`;
    const existing = this.dockview.getGroupPanel(panelId);
    if (existing) { existing.api.setActive(); return; }

    // Inject data into the template element before cloneNode
    const templateDiv = document.getElementById('musiki-pod-templates');
    const tpl = templateDiv?.querySelector<HTMLElement>('[data-pod="db-note"]');
    if (tpl) { tpl.dataset.noteId = noteId; tpl.dataset.noteTitle = title; }

    this.dockview.addPanel({ id: panelId, component: panelId.split('-')[0] + '-' + panelId.split('-')[1] });
  }
```

> **Note:** `addPanel` with `component: 'db-note'` — the `createComponent` handler resolves `id = 'db-note'` from `rawId` via `POD_TYPES.find`. The template `data-pod="db-note"` is then cloned. The `noteId` and `noteTitle` are set on the template before cloning, so they survive the `cloneNode(true)`.

- [ ] **Step 5: Verify compilation**

```bash
npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add src/scripts/room/workspace/RoomWorkspaceManager.ts \
        src/components/room/workspace/PodTemplates.astro
git commit -m "feat: db-note pod type registered in RoomWorkspaceManager"
```

---

## Task 9: Remove `/notas` standalone page

**Files:**
- Delete: `src/pages/notas.astro`
- Create: `src/pages/notas.ts`

- [ ] **Step 1: Delete `src/pages/notas.astro`**

```bash
git rm src/pages/notas.astro
```

- [ ] **Step 2: Create redirect at `src/pages/notas.ts`**

```ts
// src/pages/notas.ts
import type { APIRoute } from 'astro';

export const GET: APIRoute = () =>
  new Response(null, { status: 302, headers: { Location: '/dashboard' } });

export const prerender = false;
```

- [ ] **Step 3: Verify redirect**

```bash
curl -I http://localhost:4321/notas
```

Expected:
```
HTTP/1.1 302 Found
Location: /dashboard
```

- [ ] **Step 4: Search for any remaining links to `/notas` in the codebase**

```bash
grep -r '"/notas"' src/ --include="*.astro" --include="*.ts" | grep -v "notas.ts"
```

Update any found links to point to `/dashboard` or remove them.

- [ ] **Step 5: Commit**

```bash
git add src/pages/notas.ts
git commit -m "feat: remove /notas page; redirect to /dashboard"
```

---

## Task 10: Final integration test + `package.json` test update

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add QA test file to test script**

In `package.json`, update the `"test"` script to include the new test file:

```json
"test": "node --test \"src/lib/live/*.test.mjs\" \"src/scripts/course/sidebar/*.test.mjs\" \"src/scripts/notas/*.test.mjs\""
```

- [ ] **Step 2: Run full test suite**

```bash
npm test
```

Expected: all tests pass including the 5 new QA analyzer tests.

- [ ] **Step 3: Manual integration walkthrough**

Open the dev server and verify:

1. `/notas` → redirects to `/dashboard` ✓
2. Course page sidebar: "NOTAS" section appears, expands, fetches empty tree ✓
3. Create a note via `+` button in NOTAS section ✓
4. Drag note from NOTAS sidebar into the course dockview workspace → db-note pod appears ✓
5. db-note pod: loads note content in preview mode ✓
6. db-note pod: pencil button switches to edit mode (textarea) ✓
7. Cmd+S in edit mode saves to API ✓
8. HUD shows word/char/sentence count ✓
9. `QA ↗` button in HUD dispatches `musiki:send-to-qa` → QA analyzer pod opens ✓
10. QA pod: word frequency list renders with bars ✓
11. Click word in frequency list → concordance list populates ✓
12. Ribbon Notas button → PersonalNotesOverlay slides up ✓
13. PersonalNotesOverlay: search box filters notes ✓
14. PersonalNotesOverlay: click note → db-note pod opens in overlay ✓
15. Room page: `db-note` pod type is available in pod palette ✓

- [ ] **Step 4: Commit**

```bash
git add package.json
git commit -m "chore: add notas test files to test suite + integration verification"
```

---

## Self-Review Notes

**Spec coverage check:**
- ✓ DB migration (Task 1)
- ✓ `/api/note-folders` (Task 2)
- ✓ `buildShell` extraction (Task 3)
- ✓ `db-note` panel in course dockview (Task 5)
- ✓ `musiki:open-notas` removed from dockview-workspace (Task 5, Step 8)
- ✓ NOTAS sidebar section (Task 6)
- ✓ Personal notes overlay + workspace (Task 7)
- ✓ Writing analytics HUD + Send to QA (Task 5, Steps 6+10)
- ✓ QA analyzer pod (Task 5, Steps 5+9)
- ✓ Room workspace db-note registration (Task 8)
- ✓ `/notas` removal (Task 9)
- ✓ QA unit tests (Task 4)

**Known simplification from spec:** db-note edit mode uses `<textarea>` rather than full CodeMirror — consistent with YAGNI; CodeMirror can be added once the pod type is working.

**`renderKwic` window cache:** Task 5 Step 5 notes that `(window as any).__qaLogic` must be set inside `activateQaNote` after the dynamic import resolves, before `renderKwic` is first called from the input listener.
