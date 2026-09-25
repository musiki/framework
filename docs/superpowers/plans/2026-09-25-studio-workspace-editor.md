# Studio Workspace & Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the so.zztt.org studio an OKA writing workspace (GTX / Output / Private) with musiki's notes editor, comments, versions and tracer, governed by the role × visibility matrix, and a shared tree with manual ordering used by both so and musiki — without duplicating the notes engine.

**Architecture:** `getNoteAccess` becomes the single, tenant-aware gate (course branch = today's logic; space branch = role × effective visibility). Note-id based handlers (annotations, versions, trace, preview, upload) are reused by thin `/api/studio/*` re-exports. Space-specific listing/CRUD/folders live in a q-injected core (unit-tested with a fake query) plus thin DB-bound wrappers. The editor, tracer and tree are configured by options (`apiBase`, `labels`, `contentLang`) whose defaults reproduce musiki exactly.

**Tech Stack:** Astro 6 SSR, Postgres via `src/lib/db/pool.ts` `query()` (returns `{ data, error }`), CodeMirror 6, Node 24 `node --test`.

**Spec:** `docs/superpowers/specs/2026-09-25-studio-workspace-editor-design.md`

**Execution order:** 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12.

**Implementation refinements vs spec (intentional, design unchanged):**
- `mountDbNoteEditor` (lines 591–1701 of `personal-notes-workspace.ts`) is **not moved**; it gains an `options` parameter with musiki defaults, and `src/lib/writing/editor/index.ts` re-exports it as the stable entry point. Physical move is sub-project F.
- musiki's course list/CRUD routes (`api/live/notes.ts`, `api/note-folders.ts`) keep their course-specific SQL (groups, `ResourceSession`, `Submission` have no space meaning). Sharing happens at the access gate and the note-id handlers; space listing/CRUD is new code, not a copy of course code.
- The spec's "two overlapping musiki trees" is corrected: `src/scripts/course/notes-sidebar.ts` is the DB-notes tree (replaced by the shared tree in Task 11); `src/scripts/course/sidebar/notes-sidebar.ts` is the file-based course-notes tree (untouched; its `computeNewOrders` in `notes-sidebar-utils.mjs` is prior art).

## Global Constraints

- musiki behavior must not change except: tree ordering becomes manual once a user reorders (positions NULL → alphabetical as today).
- Role × visibility matrix (spec §3) is authoritative: author edit all; supervisor comment on `supervision`, view on `committee`/`public`; coordinator view on `committee`/`public`; reviewer versions-only on `committee`, view on `public`; guest view on `public`; everything else `null`.
- Effective visibility = `note.visibility ?? nearest ancestor folder.visibility ?? 'private'`.
- Folder operations and visibility changes: author only. In so, `LiveClassNoteShare` is ignored.
- A note/folder has `courseId` XOR `spaceId` (both may be NULL for musiki personal notes).
- `getNoteAccess(noteId, userId, { tenantId })`: space notes only for their space's tenant; non-space notes only for tenant `musiki`.
- Everything user-visible via `t()`; so shows English; musiki Spanish strings byte-identical to today; nothing in so mentions "musiki".
- Pure modules (`src/lib/writing/**/…-core.ts`, `visibility.ts`, `space-access.ts`, `tree/model.ts`) must not import `astro:*`, `auth-astro`, or `src/lib/db/*`; relative imports between them use `.ts`. Tests: `node:test` + `node:assert/strict`, `*.test.mjs` next to code, registered in `package.json` `test`.
- Never `git add -A`/`git add .` (node_modules may be a symlink in worktrees), never `git stash`, never read or print `.env`.
- Remote shells are fish: use uploaded scripts or `bash -c`. Postgres container `authentik-postgresql`, role `app`, DBs `musiki26` (prod) / `musiki_staging`.
- Commits end with a blank line + `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Fake query helper (used by core tests)

Core modules take `q: QueryFn` where `type QueryFn = (text: string, params?: unknown[]) => Promise<{ data: any[] | null; error: any }>`. Tests use:

```js
// src/lib/writing/notes/fake-query.test-helper.mjs
export function fakeQuery(routes) {
  // routes: array of [substringOrRegex, (params) => rows]
  const calls = [];
  const q = async (text, params = []) => {
    calls.push({ text, params });
    for (const [match, handler] of routes) {
      const hit = typeof match === 'string' ? text.includes(match) : match.test(text);
      if (hit) return { data: handler(params, text) ?? [], error: null };
    }
    return { data: [], error: null };
  };
  return { q, calls };
}
```

---

### Task 1: Migration — folder spaces, visibility, ordering, course XOR space

**Files:**
- Create: `postgres-patches/migrations/20260926090000_space_notes_visibility_order.sql`

- [ ] **Step 1: Write the migration**

```sql
-- so studio workspace: folders in spaces, visibility levels, manual ordering, course XOR space.
BEGIN;

ALTER TABLE "LiveClassNoteFolder" ADD COLUMN IF NOT EXISTS "spaceId" uuid NULL REFERENCES "Space"("id") ON DELETE CASCADE;
ALTER TABLE "LiveClassNoteFolder" ADD COLUMN IF NOT EXISTS "visibility" text NULL;
ALTER TABLE "LiveClassNoteFolder" ADD COLUMN IF NOT EXISTS "position" double precision NULL;
ALTER TABLE "LiveClassNote"       ADD COLUMN IF NOT EXISTS "visibility" text NULL;
ALTER TABLE "LiveClassNote"       ADD COLUMN IF NOT EXISTS "position" double precision NULL;

CREATE INDEX IF NOT EXISTS "LiveClassNoteFolder_spaceId_idx" ON "LiveClassNoteFolder" ("spaceId") WHERE "spaceId" IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LiveClassNoteFolder_visibility_check') THEN
    ALTER TABLE "LiveClassNoteFolder" ADD CONSTRAINT "LiveClassNoteFolder_visibility_check"
      CHECK ("visibility" IN ('private','supervision','committee','public'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LiveClassNote_visibility_check') THEN
    ALTER TABLE "LiveClassNote" ADD CONSTRAINT "LiveClassNote_visibility_check"
      CHECK ("visibility" IN ('private','supervision','committee','public'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LiveClassNote_course_xor_space') THEN
    ALTER TABLE "LiveClassNote" ADD CONSTRAINT "LiveClassNote_course_xor_space"
      CHECK ("courseId" IS NULL OR "spaceId" IS NULL);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LiveClassNoteFolder_course_xor_space') THEN
    ALTER TABLE "LiveClassNoteFolder" ADD CONSTRAINT "LiveClassNoteFolder_course_xor_space"
      CHECK ("courseId" IS NULL OR "spaceId" IS NULL);
  END IF;
END
$$;

COMMIT;
```

- [ ] **Step 2: Commit**

```bash
git add postgres-patches/migrations/20260926090000_space_notes_visibility_order.sql
git commit -m "feat(db): note/folder visibility, manual position, folder spaceId, course XOR space"
```
(Applied to staging/prod in Task 12.)

---

### Task 2: Pure visibility + space access matrix

**Files:**
- Create: `src/lib/writing/notes/visibility.ts`, `src/lib/writing/notes/space-access.ts`
- Test: `src/lib/writing/notes/visibility.test.mjs`
- Modify: `package.json` (`test`: add `"src/lib/writing/notes/*.test.mjs"`)

**Interfaces — Produces:**
- `VISIBILITIES = ['private','supervision','committee','public'] as const`, `type Visibility`, `isVisibility(v)`
- `effectiveVisibility(note: { visibility?: string|null; folderId?: string|null }, foldersById: Map<string, { id: string; parentId: string|null; visibility?: string|null }>): Visibility`
- `type NoteAccess = 'edit' | 'comment' | 'view' | null`
- `resolveSpaceAccess(role: SpaceRole, visibility: Visibility): { access: NoteAccess; versionsOnly: boolean }`
- `canManageSpace(role: SpaceRole): boolean` (author only)

- [ ] **Step 1: Failing test** `src/lib/writing/notes/visibility.test.mjs`

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { effectiveVisibility } from './visibility.ts';
import { resolveSpaceAccess, canManageSpace } from './space-access.ts';

const folders = new Map([
  ['gtx', { id: 'gtx', parentId: null, visibility: 'supervision' }],
  ['ch1', { id: 'ch1', parentId: 'gtx', visibility: null }],
  ['out', { id: 'out', parentId: null, visibility: 'committee' }],
  ['loop', { id: 'loop', parentId: 'loop', visibility: null }],
]);

test('note override wins', () => {
  assert.equal(effectiveVisibility({ visibility: 'private', folderId: 'gtx' }, folders), 'private');
});
test('inherits nearest ancestor', () => {
  assert.equal(effectiveVisibility({ visibility: null, folderId: 'ch1' }, folders), 'supervision');
  assert.equal(effectiveVisibility({ folderId: 'out' }, folders), 'committee');
});
test('root and unknown default to private; cycles terminate', () => {
  assert.equal(effectiveVisibility({ folderId: null }, folders), 'private');
  assert.equal(effectiveVisibility({ folderId: 'missing' }, folders), 'private');
  assert.equal(effectiveVisibility({ folderId: 'loop' }, folders), 'private');
});

const M = {
  author:      { private: 'edit', supervision: 'edit',    committee: 'edit', public: 'edit' },
  supervisor:  { private: null,   supervision: 'comment', committee: 'view', public: 'view' },
  coordinator: { private: null,   supervision: null,      committee: 'view', public: 'view' },
  reviewer:    { private: null,   supervision: null,      committee: 'view', public: 'view' },
  guest:       { private: null,   supervision: null,      committee: null,   public: 'view' },
};
test('full matrix', () => {
  for (const [role, row] of Object.entries(M)) for (const [vis, access] of Object.entries(row)) {
    assert.equal(resolveSpaceAccess(role, vis).access, access, `${role}/${vis}`);
  }
});
test('reviewer is versions-only on committee', () => {
  assert.equal(resolveSpaceAccess('reviewer', 'committee').versionsOnly, true);
  assert.equal(resolveSpaceAccess('reviewer', 'public').versionsOnly, false);
  assert.equal(resolveSpaceAccess('supervisor', 'committee').versionsOnly, false);
});
test('only author manages', () => {
  assert.equal(canManageSpace('author'), true);
  for (const r of ['supervisor', 'coordinator', 'reviewer', 'guest']) assert.equal(canManageSpace(r), false);
});
```

- [ ] **Step 2: Register glob, run → FAIL** (`node --test src/lib/writing/notes/visibility.test.mjs`).

- [ ] **Step 3: Implement**

`src/lib/writing/notes/visibility.ts`:
```ts
export const VISIBILITIES = ['private', 'supervision', 'committee', 'public'] as const;
export type Visibility = (typeof VISIBILITIES)[number];
export const isVisibility = (v: unknown): v is Visibility =>
  typeof v === 'string' && (VISIBILITIES as readonly string[]).includes(v);

type FolderLike = { id: string; parentId: string | null; visibility?: string | null };

export function effectiveVisibility(
  note: { visibility?: string | null; folderId?: string | null },
  foldersById: Map<string, FolderLike>,
): Visibility {
  if (isVisibility(note.visibility)) return note.visibility;
  const seen = new Set<string>();
  let id = note.folderId ?? null;
  while (id && !seen.has(id)) {
    seen.add(id);
    const folder = foldersById.get(id);
    if (!folder) break;
    if (isVisibility(folder.visibility)) return folder.visibility;
    id = folder.parentId;
  }
  return 'private';
}
```

`src/lib/writing/notes/space-access.ts`:
```ts
import type { SpaceRole } from '../../tenant/space-roles.ts';
import type { Visibility } from './visibility.ts';

export type NoteAccess = 'edit' | 'comment' | 'view' | null;

const MATRIX: Record<SpaceRole, Record<Visibility, NoteAccess>> = {
  author:      { private: 'edit', supervision: 'edit',    committee: 'edit', public: 'edit' },
  supervisor:  { private: null,   supervision: 'comment', committee: 'view', public: 'view' },
  coordinator: { private: null,   supervision: null,      committee: 'view', public: 'view' },
  reviewer:    { private: null,   supervision: null,      committee: 'view', public: 'view' },
  guest:       { private: null,   supervision: null,      committee: null,   public: 'view' },
};

export function resolveSpaceAccess(role: SpaceRole, visibility: Visibility): { access: NoteAccess; versionsOnly: boolean } {
  const access = MATRIX[role]?.[visibility] ?? null;
  return { access, versionsOnly: role === 'reviewer' && visibility === 'committee' };
}

export const canManageSpace = (role: SpaceRole): boolean => role === 'author';
```

- [ ] **Step 4: Run → PASS; `npm test` green.**
- [ ] **Step 5: Commit** `feat(writing): visibility inheritance and space access matrix`

---

### Task 3: Tenant-aware `getNoteAccess` (course branch characterized, space branch added)

**Files:**
- Create: `src/lib/writing/notes/access-core.ts`, `src/lib/writing/notes/access.ts`, `src/lib/writing/notes/fake-query.test-helper.mjs` (content in "Fake query helper" above), `src/lib/writing/notes/access-core.test.mjs`
- Modify: `src/pages/api/live/notes/annotations.ts` (remove local `getNoteAccess` body; `export { getNoteAccess } from '../../../../lib/writing/notes/access';`), every `getNoteAccess(` call site in `src/pages/api/live/notes.ts`, `notes/annotations.ts`, `notes/versions.ts`, `notes/trace.ts` (15 calls) to pass `{ tenantId: (locals as any).tenant?.id ?? 'musiki' }`.

**Interfaces — Produces:**
- `type QueryFn = (text: string, params?: unknown[]) => Promise<{ data: any[] | null; error: any }>`
- `createNoteAccessResolver(q: QueryFn): (noteId: string, userId: string, opts?: { tenantId?: TenantId }) => Promise<NoteAccessResult>`
- `type NoteAccessResult = 'edit' | 'comment' | 'view' | null` (unchanged public type for musiki callers)
- `createNoteAccessDetail(q)`: same inputs, returns `{ access: NoteAccess; versionsOnly: boolean; spaceId: string | null }` (used by studio routes)
- `access.ts`: `export const getNoteAccess = createNoteAccessResolver(query)`; `export const getNoteAccessDetail = createNoteAccessDetail(query)` (binds `query` from `../../db/pool`)

- [ ] **Step 1: Characterize the current course branch.** Read `getNoteAccess` in `src/pages/api/live/notes/annotations.ts` (lines 6–~100) completely. Move its body **verbatim** into `access-core.ts` as `courseAccess(q, note, userId)` (replace `query(` with `q(`). Write `access-core.test.mjs` cases with `fakeQuery` covering, for a note `{ userId: 'owner', courseId: 'c1', spaceId: null }`: owner → `edit`; teacher enrolled in `c1` → `edit`; each share `targetType` branch present in the original code (`user`, `class`, `teachers`, `students`, plus group logic via `Submission.payload.grupo` if present) → its `accessLevel`; stranger → `null`; missing note → `null`. Run → PASS against the moved code (this is the characterization: it documents today's behavior).

- [ ] **Step 2: Add tenant gating + space branch (TDD).** New failing tests:
```js
// space note in so, members by role; folder chain decides visibility
const note = { id: 'n1', userId: 'author', courseId: null, spaceId: 's1', visibility: null, folderId: 'gtx' };
// routes: note row, space tenant, membership role, folders of space
// expectations:
// tenantId 'so', role supervisor, folder gtx(supervision) → 'comment'
// tenantId 'so', role coordinator → null; role author → 'edit'; non-member → null
// tenantId 'musiki' on a space note → null (musiki routes never open so notes)
// tenantId 'so' on a course note (spaceId null) → null (so routes never open musiki notes)
// getNoteAccessDetail: reviewer on committee → { access: 'view', versionsOnly: true }
// shares rows for a space note are ignored (a LiveClassNoteShare row granting 'edit' to a stranger → null)
```
Implement in `access-core.ts`:
```ts
// SELECT "userId","courseId","spaceId","visibility","folderId" FROM "LiveClassNote" WHERE id=$1::uuid
// if spaceId:
//   tenant = SELECT "tenantId" FROM "Space" WHERE id=$1  → must equal opts.tenantId, else null
//   role   = SELECT role FROM "SpaceMember" WHERE "spaceId"=$1 AND "userId"=$2::uuid → none → null
//   folders= SELECT id,"parentId",visibility FROM "LiveClassNoteFolder" WHERE "spaceId"=$1
//   vis    = effectiveVisibility(note, map); return resolveSpaceAccess(role, vis)
// else: if (opts.tenantId ?? 'musiki') !== 'musiki' → null; else courseAccess(...)
```
`createNoteAccessResolver(q)` returns `(…) => detail(…).then(d => d.access)`.

- [ ] **Step 3: Wire call sites.** Replace the local function in `annotations.ts` with the re-export; update the 15 call sites to pass `{ tenantId: (locals as any).tenant?.id ?? 'musiki' }` (each handler already destructures `locals`; add it where missing). No other behavior change.

- [ ] **Step 4:** `npm test` green; `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "src/lib/writing|api/live/notes"` shows no new errors.
- [ ] **Step 5: Commit** `refactor(notes): tenant-aware getNoteAccess with space branch; course branch characterized`

---

### Task 4: Pure tree model with manual ordering

**Files:** Create `src/lib/writing/tree/model.ts`, test `src/lib/writing/tree/model.test.mjs`; `package.json` add `"src/lib/writing/tree/*.test.mjs"`.

**Interfaces — Produces:**
- `type TreeFolder = { id: string; parentId: string | null; name: string; position?: number | null; visibility?: string | null }`
- `type TreeNote = { id: string; folderId: string | null; title: string; position?: number | null; visibility?: string | null; userId?: string | null }`
- `type TreeNode = { kind: 'folder'; folder: TreeFolder; children: TreeNode[] } | { kind: 'note'; note: TreeNote }`
- `buildTree(folders, notes, locale = 'en'): TreeNode[]` (root level; folders before notes at each level, each group via `sortSiblings`; orphans whose parent is missing go to root; cycles broken)
- `sortSiblings<T>(items: T[], key: (t) => { position?: number|null; label: string }, locale): T[]` — positioned first by `position` ASC, then NULL-position items by `label` (`localeCompare(locale, { sensitivity: 'base' })`)
- `positionBetween(prev: number | null, next: number | null): number` — both null → 1024; only next → next − 1024; only prev → prev + 1024; both → (prev + next) / 2
- `needsRenormalize(prev: number | null, next: number | null): boolean` — both non-null and `Math.abs(next - prev) < 1e-9`
- `renormalizedPositions(count: number): number[]` → `[1024, 2048, …]`

- [ ] **Step 1: Failing tests** covering: folders-before-notes; positioned-before-null; alphabetical among nulls with `es` locale (`'árbol' < 'barco'`); nested folders; orphan to root; parent cycle doesn't hang; `positionBetween` four cases; `needsRenormalize` tiny gap; all-null input yields pure alphabetical order (musiki-unchanged guarantee).
- [ ] **Step 2: Run → FAIL. Step 3: Implement (pure TS). Step 4: PASS + `npm test`. Step 5: Commit** `feat(writing): pure tree model with fractional manual ordering`

---

### Task 5: Space notes core (q-injected) + DB wrapper

**Files:** Create `src/lib/writing/notes/space-notes-core.ts`, `src/lib/writing/notes/space-notes.ts` (binds `query`), test `space-notes-core.test.mjs`.

**Interfaces — Consumes:** Task 2 (`effectiveVisibility`, `resolveSpaceAccess`, `canManageSpace`), Task 4 (`positionBetween`, `needsRenormalize`, `renormalizedPositions`).

**Interfaces — Produces** (all take `q` first in core; wrapper exports the same names without `q`):
- `getMemberRole(q, spaceId, userId): Promise<SpaceRole | null>`
- `listSpaceTree(q, { spaceId, userId }): Promise<{ role: SpaceRole; folders: (TreeFolder & { effectiveVisibility: Visibility })[]; notes: (TreeNote & { effectiveVisibility: Visibility; access: NoteAccess; versionsOnly: boolean })[] }>` — loads all folders/notes of the space (no body), computes effective visibility and access per item, **drops notes with access null**, drops folders that contain no visible descendants unless the user is author; `Private` root items only for author.
- `getSpaceNote(q, { spaceId, userId, noteId })` → `{ note (with body unless versionsOnly), accessLevel, versionsOnly } | null` — same response shape the editor expects (`{ notes: [ {...note, accessLevel} ] }` is built by the route).
- `createSpaceNote(q, { spaceId, userId, folderId, title, body, lang })` — author only; `userId` = author; `courseId` NULL; `position = positionBetween(lastSiblingPosition, null)`.
- `updateSpaceNote(q, { spaceId, userId, noteId, patch: { title?, body?, folderId?, position?, visibility? } })` — `body`/`title` need access `edit`; `folderId`/`position`/`visibility` need author; target folder must belong to the same space; renormalize siblings when `needsRenormalize`.
- `deleteSpaceNote(q, …)` author only.
- `createSpaceFolder / renameSpaceFolder / moveSpaceFolder / deleteSpaceFolder / setFolderVisibility` — author only; `moveSpaceFolder` rejects moving into itself or a descendant; `deleteSpaceFolder` detaches its notes to parent (same as musiki: `folderId = NULL` for direct notes) and deletes subfolders (CASCADE semantics of musiki's `note-folders` DELETE).
- `ensureOkaFolders(q, { spaceId, authorId })` — creates root `GTX` (`supervision`, position 1024) and `Output` (`committee`, position 2048) if absent; idempotent.
- Errors: throw `SpaceNotesError` with `status` (403/404/400) so routes map them.

- [ ] **Step 1: Failing tests (fakeQuery)**: supervisor listing sees GTX notes (access comment), not Private, not Output-only-if-committee? (Output is `committee` → supervisor view ✔); coordinator sees only Output; guest sees nothing unless `public`; reviewer gets Output notes with `versionsOnly: true` and no body from `getSpaceNote`; non-author `updateSpaceNote` with `position` → 403; author moving note into a folder of another space → 400; `moveSpaceFolder` into descendant → 400; `ensureOkaFolders` inserts twice only when absent (check calls).
- [ ] **Step 2–4:** implement until green; `npm test` green.
- [ ] **Step 5: Commit** `feat(writing): space notes core (tree listing, CRUD, OKA bootstrap) with matrix enforcement`

---

### Task 6: Studio note APIs

**Files:**
- Create: `src/lib/tenant/studio-space.ts` (`resolveStudioSpace(locals, spaceId): Promise<{ spaceId, userId, role, space: { lang, tenantId } } | Response>` — 404 if studio disabled or space not in `locals.tenant`, 401 no user, 403 non-member; uses `isUuid`)
- Create routes:
  - `src/pages/api/studio/notes.ts` — `GET ?spaceId=` → `{ role, folders, notes }` (listSpaceTree); `GET ?id=&spaceId=` → `{ notes: [ { ...note, accessLevel, versionsOnly } ] }`; `POST` create; `PATCH` update; `DELETE ?id=&spaceId=`. Mutations use `assertSameOriginJson` (existing `src/lib/tenant/studio-http.ts`).
  - `src/pages/api/studio/notes/folders.ts` — `GET ?spaceId=`, `POST`, `PATCH` (rename/move/position/visibility), `DELETE`.
  - `src/pages/api/studio/notes/annotations.ts`, `versions.ts`, `trace.ts` — `export { GET, POST, PUT, PATCH, DELETE } from '../../live/notes/<same>'` (only the methods that file exports) + `export const prerender = false;`. Access is enforced by tenant-aware `getNoteAccess` (Task 3).
  - `src/pages/api/studio/preview-markdown.ts` → re-export from `../live/preview-markdown`; `src/pages/api/studio/upload-image.ts` → re-export from `../forum/upload-image`.
- Test: `src/lib/tenant/routes.test.mjs` sweep must still pass (new files are under `/api/studio`).

- [ ] **Step 1:** Implement `studio-space.ts` + routes (thin; map `SpaceNotesError.status`).
- [ ] **Step 2:** Versions for reviewer: in `versions.ts` musiki handler nothing changes; reviewer has `view` so can list/read versions; `getSpaceNote` hides body when `versionsOnly`.
- [ ] **Step 3:** `npm test` green; tsc grep clean for `src/pages/api/studio|src/lib/tenant`.
- [ ] **Step 4: Commit** `feat(studio): space-scoped note, folder, annotation, version and trace APIs`

---

### Task 7: Editor options and labels (workspace + live-md-editor)

**Files:**
- Modify: `src/scripts/notas/personal-notes-workspace.ts` (`mountDbNoteEditor` signature + hard-coded strings/URLs inside lines 591–1701), `src/scripts/course/notes/live-md-editor.ts` (upload URL option)
- Create: `src/lib/writing/editor/labels.ts`, `src/lib/writing/editor/index.ts`, test `src/lib/writing/editor/labels.test.mjs`
- Modify: `src/lib/i18n/en.ts`, `es.ts` (new `editor.*` keys)

**Interfaces — Produces:**
- `type EditorOptions = { apiBase?: string; previewUrl?: string; uploadUrl?: string; labels?: Partial<EditorLabels>; contentLang?: ContentLang; spaceId?: string }`
- `mountDbNoteEditor(bodyEl, statusDot, traceBtn, noteId, pencilBtn?, downloadBtn?, downloadMenu?, options?: EditorOptions)` — defaults: `apiBase '/api/live/notes'`, `previewUrl '/api/live/preview-markdown'`, `uploadUrl '/api/forum/upload-image'`, `labels` = Spanish = today's literal strings, `contentLang 'es'`. When `spaceId` is set, it is appended as `&spaceId=` to note GET/PATCH calls.
- `EditorLabels` = one field per user-visible string currently hard-coded in `mountDbNoteEditor` (e.g. `loading: 'Cargando…'`, `notFound: 'Nota no encontrada'`, `viewRender: 'Ver render Markdown (Alt+Shift+E)'`, `backToEdit: 'Volver a live edit (Alt+Shift+E)'`, …). Enumerate them by grepping string literals in lines 591–1701 that reach the DOM (`innerHTML`, `textContent`, `title`, `placeholder`, `aria-label`, `confirm(`, `alert(`).
- `buildEditorLabels(locale: Locale): EditorLabels` via `t('editor.<key>')`.
- `src/lib/writing/editor/index.ts`: `export { mountDbNoteEditor } from '../../../scripts/notas/personal-notes-workspace';` and `export type { EditorOptions, EditorLabels }`.

- [ ] **Step 1: Test first**: `labels.test.mjs` asserts `buildEditorLabels('es')` deep-equals the `DEFAULT_ES_LABELS` constant exported from `labels.ts` (which holds today's literal strings verbatim) and that `buildEditorLabels('en')` has no empty values and no Spanish-only characters in a spot-check set (`loading`, `notFound`).
- [ ] **Step 2:** Replace literals/URLs in `mountDbNoteEditor` with `labels.x` / `options.*`; callers in `personal-notes-workspace.ts:51` and `dockview-workspace.ts:1103` stay unchanged (defaults).
- [ ] **Step 3:** `npm test` green; tsc grep clean; manually diff that musiki strings are identical (`git diff` shows only indirection).
- [ ] **Step 4: Commit** `refactor(editor): options (apiBase, labels, contentLang) with musiki defaults; en/es editor labels`

---

### Task 8: Trace margin options and labels

**Files:** Modify `src/scripts/course/notes/trace-margin.ts` (public mount function signature; 7 `/api/live/notes/trace` URLs; ~53 hard-coded UI strings), `src/lib/i18n/en.ts`/`es.ts` (`trace.ui.*` keys), `src/lib/writing/editor/labels.ts` (add `TraceLabels`, `DEFAULT_ES_TRACE_LABELS`, `buildTraceLabels(locale)`), test extends `labels.test.mjs`.

**Interfaces — Produces:** the trace-margin mount accepts `{ apiBase?: string (default '/api/live/notes'); contentLang?: ContentLang (default 'es'); labels?: Partial<TraceLabels> }`; uses `${apiBase}/trace`; passes `contentLang` to `startsWithConnector(text, lang)` and uses `traceStopwords(contentLang)`; rhetorical role display labels via `labels.role[key]` (keys unchanged: `afirmacion`, …). `mountDbNoteEditor` forwards its `apiBase`/`contentLang`/trace labels. AI suggestion calls (`/api/ai/*`) are disabled when `contentLang !== 'es'` (hide the AI action; Spanish prompts would be wrong) — note for sub-project with AI.

- [ ] Steps: failing labels test (es deep-equals today's literals) → implement → `npm test` (existing `trace-utils.test.mjs` unchanged) → commit `refactor(tracer): configurable apiBase, content language and labels`.

---

### Task 9: Shared tree renderer

**Files:** Create `src/lib/writing/tree/render.ts`, `src/lib/writing/tree/tree.css`.

**Interfaces — Produces:**
```ts
export type TreeRenderOptions = {
  container: HTMLElement;
  labels: TreeLabels;                         // newNote, newFolder, rename, delete, visibility, private, supervision, committee, public, confirmDelete, empty
  locale: string;                             // for sortSiblings
  canManage: boolean;                          // author (so) / owner (musiki)
  showVisibility: boolean;                     // so true, musiki false
  selectedNoteId?: string | null;
  load(): Promise<{ folders: TreeFolder[]; notes: TreeNote[] }>;
  onOpenNote(noteId: string): void;
  actions: {
    createNote(folderId: string | null): Promise<void>;
    createFolder(parentId: string | null, name: string): Promise<void>;
    renameNote(id: string, title: string): Promise<void>;
    renameFolder(id: string, name: string): Promise<void>;
    deleteNote(id: string): Promise<void>;
    deleteFolder(id: string): Promise<void>;
    moveNote(id: string, folderId: string | null, position: number): Promise<void>;
    moveFolderPosition(id: string, position: number): Promise<void>;   // reorder among siblings (phase 2 adds reparenting)
    setVisibility?(kind: 'note' | 'folder', id: string, v: Visibility | null): Promise<void>;
  };
};
export function renderTree(opts: TreeRenderOptions): { refresh(): Promise<void>; destroy(): void };
```
Behavior: `buildTree` from the model; folders as `<details>` (roles `tree`/`treeitem`, `aria-expanded`); drag a note onto a gap between siblings → `positionBetween(prev, next)` → `moveNote`; drop onto a folder header → move into folder at end; drag folder between sibling folders → `moveFolderPosition`; context menu (only when `canManage`) with rename/delete/visibility; visibility badge when `showVisibility`; styles only via CSS variables with fallbacks (`--tree-fg`, `--tree-muted`, `--tree-accent`, `--tree-border`) so musiki (`--c-*`) and so themes both map onto them.

- [ ] Steps: implement; unit-test the pure drop-target → position helper if extracted (`dropPosition(siblings, index)` in `model.ts` with a test); `npm test`; commit `feat(writing): shared tree renderer with drag reordering and visibility badges`.

---

### Task 10: Studio UI — sidebar tree, editor, structure

**Files:** Modify `src/layouts/StudioLayout.astro` (sidebar gets a tree mount point per space), `src/pages/studio/editor.astro`, `src/pages/studio/structure.astro`, `src/pages/studio/index.astro` (author visit calls `ensureOkaFolders` for authored spaces); Create `src/scripts/studio/workspace.ts` (client: mounts `renderTree` with `/api/studio/notes*` actions and English labels; opens notes at `/studio/editor?note=<id>&space=<spaceId>`), `src/scripts/studio/editor-page.ts` (client: `mountDbNoteEditor(…, { apiBase: '/api/studio/notes', previewUrl: '/api/studio/preview-markdown', uploadUrl: '/api/studio/upload-image', labels, contentLang, spaceId })`); i18n keys `studio.tree.*`, `studio.visibility.*`.

- Labels passed from Astro to client scripts via `data-*` attributes (JSON), not by importing `t()` client-side.
- `structure.astro`: server-rendered overview (per visibility counts) + the same tree with `showVisibility` and visibility menus (author).
- Editor page with no `note` param: empty state with "Select or create a note".
- Nothing mentions musiki; all strings via `t()`.

- [ ] Steps: implement; route sweep + `npm test` green; `TENANT=so npx astro dev --port 4399` smoke for `/studio/login`, `/studio/editor` (302 to login when anonymous), no "musiki" in HTML; commit `feat(studio): workspace tree in sidebar, editor and structure pages`.

---

### Task 11: musiki DB-notes tree on the shared renderer + manual ordering

**Files:** Modify `src/scripts/course/notes-sidebar.ts` (`renderNotesTree` delegates to `renderTree` with musiki labels in Spanish, `showVisibility: false`, actions mapped to existing musiki endpoints), `src/pages/api/live/notes.ts` (`PATCH` accepts `position` for owner), `src/pages/api/note-folders.ts` (`PATCH` accepts `position` for owner). Keep every exported function name/signature of `notes-sidebar.ts` used by `ClassWorkspacePanel.astro`, `livekit-room.ts`, `inline-editor.ts`, `notes-editor/index.ts`, `room/session/messages.ts`, `[...slug].astro` (grep them first). Shared-with-me notes section and share button stay as they are (musiki feature).

- [ ] Steps: grep consumers; implement delegation; with all positions NULL the rendered order must equal today's alphabetical order (assert via `buildTree` test on a fixture captured from current sorting code: folders `localeCompare(…, 'es', {sensitivity:'base'})`, notes by title); `npm test`; commit `feat(notes): musiki notes tree on shared renderer with manual ordering`.

---

### Task 12: Staging, production, verification (ops — confirm with user before each remote write)

- [ ] Apply Task 1 migration to `musiki_staging` twice (idempotent), and prove the XOR constraint rejects a row with both `courseId` and `spaceId` (then roll back that test row).
- [ ] Back up `musiki26` (`pg_dump -Fc` to `/home/zz/backups/musiki26-pre-studio-<ts>.dump`), apply migration.
- [ ] Merge to `main`, push (runner deploys), watch the run.
- [ ] musiki checks (as a signed-in teacher in the browser, by the user): NOTES sidebar shows the same order; drag reorder persists; open note, comment, trace, versions work.
- [ ] so checks: author opens `/studio` → GTX/Output appear; create a GTX note; invite a test account as supervisor → can comment, cannot edit, does not see Private; coordinator sees only Output; no "musiki"/Spanish in studio HTML.
- [ ] Update `MEMORY.md` and `AGENTS.md`.

## Known limitations

- Tree phase 2 (move folders into folders, remembered state + search, keyboard + multi-select) is the next plan.
- AI trace suggestions are hidden for non-Spanish content until the AI prompts are localized.
- Dockview in the studio is a later sub-project.
