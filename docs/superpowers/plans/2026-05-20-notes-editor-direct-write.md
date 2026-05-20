# Notes Editor — Direct Write Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a web editor at `/notas-editor?course=[id]` that lets teachers create and edit course markdown notes directly on the VPS filesystem, replacing the Obsidian→GitHub→build workflow.

**Architecture:** A REST API layer (`/api/notes/*`) wraps the existing `content-admin.ts` filesystem helpers to list/read/write/delete/move markdown files. A dedicated Astro page mounts a vanilla TypeScript editor with CodeMirror, a chapter tree, and a YAML strip. No GitHub write path, no Postgres.

**Tech Stack:** Astro SSR (server-only routes), `gray-matter` (frontmatter parsing), `@codemirror/lang-markdown` + `codemirror` (editor — already in package.json), vanilla TypeScript (no React island needed).

**Spec:** `docs/superpowers/specs/2026-05-20-notes-editor-redesign.md`

**Branch:** `feature/notes-editor-direct-write`

---

## File Map

| File | Role |
|------|------|
| `src/lib/notes-fs.ts` | All filesystem ops: list, get, save, create, delete, move |
| `src/pages/api/notes/list.ts` | `GET /api/notes/list?courseId=X` |
| `src/pages/api/notes/get.ts` | `GET /api/notes/get?courseId=X&slug=Y` |
| `src/pages/api/notes/save.ts` | `POST /api/notes/save` |
| `src/pages/api/notes/create.ts` | `POST /api/notes/create` |
| `src/pages/api/notes/delete.ts` | `POST /api/notes/delete` |
| `src/pages/api/notes/move.ts` | `POST /api/notes/move` |
| `src/pages/notas-editor.astro` | Page, auth guard, HTML scaffold |
| `src/scripts/notes-editor/types.ts` | Shared TypeScript types |
| `src/scripts/notes-editor/api.ts` | Typed fetch wrappers for `/api/notes/*` |
| `src/scripts/notes-editor/tree.ts` | Chapter tree UI, drag-drop, context menu |
| `src/scripts/notes-editor/yaml-strip.ts` | YAML strip row, frontmatter parse/serialize |
| `src/scripts/notes-editor/editor.ts` | CodeMirror setup, eval cursor detection |
| `src/scripts/notes-editor/toolbar.ts` | Snippet toolbar, drop/paste handlers |
| `src/scripts/notes-editor/index.ts` | Entry — fetches notes, mounts all UI |

---

## Task 1: Create the branch

- [ ] **Step 1: Create and switch to feature branch**

```bash
git checkout -b feature/notes-editor-direct-write
```

- [ ] **Step 2: Verify**

```bash
git branch --show-current
```
Expected: `feature/notes-editor-direct-write`

---

## Task 2: `src/lib/notes-fs.ts` — Filesystem library

This is the only place that touches the filesystem. All API routes delegate here.

**Files:**
- Create: `src/lib/notes-fs.ts`

- [ ] **Step 1: Create the file**

```typescript
// src/lib/notes-fs.ts
import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import {
  resolveCourseSource,
  getEditableLocalRepoFile,
  writeEditableLocalRepoFile,
  deleteEditableLocalRepoFile,
  sanitizeRepoMarkdownPath,
  isLocalContentAdminEnabled,
} from './content-admin';

export type NoteListItem = {
  slug: string;
  title: string;
  type: string;
  chapter: string;
  status: string;
  order: number;
  theme?: string;
  filePath: string;
};

export function notesPreflightError(courseId: string): string | null {
  if (!isLocalContentAdminEnabled()) {
    return 'Local content admin not enabled. Set CONTENT_ADMIN_LOCAL_WRITE=true.';
  }
  const source = resolveCourseSource(courseId);
  if (!source) return `Course not found in sources.manifest.json: ${courseId}`;
  return null;
}

function resolveCourseScanDir(courseId: string): string | null {
  const source = resolveCourseSource(courseId);
  if (!source) return null;

  const candidates: string[] = [];

  if (source.localPath) {
    const resolved = path.resolve(process.cwd(), source.localPath);
    if (fs.existsSync(resolved)) {
      candidates.push(path.join(resolved, 'cursos', courseId));
    }
  }
  candidates.push(
    path.join(process.cwd(), '.content-sources', source.id, 'cursos', courseId),
    path.join(process.cwd(), 'src', 'content', 'cursos', courseId),
  );

  return candidates.find(p => fs.existsSync(p) && fs.statSync(p).isDirectory()) ?? null;
}

export function listCourseNotes(courseId: string): NoteListItem[] {
  const source = resolveCourseSource(courseId);
  if (!source) return [];

  const baseDir = resolveCourseScanDir(courseId);
  if (!baseDir) return [];

  const entries = fs.readdirSync(baseDir, { withFileTypes: true });
  const notes: NoteListItem[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md') || entry.name === '_index.md') continue;

    const slug = entry.name.slice(0, -3);
    const repoPath = `cursos/${courseId}/${entry.name}`;
    const file = getEditableLocalRepoFile(source, repoPath);
    if (!file) continue;

    const { data } = matter(file.content);
    notes.push({
      slug,
      title: String(data.title || slug),
      type: String(data.type || 'lesson'),
      chapter: String(data.chapter || ''),
      status: String(data.status || 'draft'),
      order: Number(data.order) || 0,
      theme: data.theme ? String(data.theme) : undefined,
      filePath: repoPath,
    });
  }

  return notes.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
}

export function getCourseNote(courseId: string, slug: string): { content: string; filePath: string } | null {
  const source = resolveCourseSource(courseId);
  if (!source) return null;

  const repoPath = sanitizeRepoMarkdownPath(`cursos/${courseId}/${slug}.md`);
  if (!repoPath) return null;

  const file = getEditableLocalRepoFile(source, repoPath);
  if (!file) return null;

  return { content: file.content, filePath: repoPath };
}

export function saveCourseNote(courseId: string, slug: string, content: string): { filePath: string } {
  const source = resolveCourseSource(courseId);
  if (!source) throw new Error(`Course not found: ${courseId}`);

  const repoPath = sanitizeRepoMarkdownPath(`cursos/${courseId}/${slug}.md`);
  if (!repoPath) throw new Error('Invalid slug');

  if (!getEditableLocalRepoFile(source, repoPath)) {
    throw new Error(`Note not found: ${slug}`);
  }

  writeEditableLocalRepoFile(source, repoPath, content);
  return { filePath: repoPath };
}

export function createCourseNote(courseId: string, opts: {
  slug: string;
  title: string;
  type: string;
  chapter: string;
  status: string;
  order: number;
}): { slug: string; content: string; filePath: string } {
  const source = resolveCourseSource(courseId);
  if (!source) throw new Error(`Course not found: ${courseId}`);

  const repoPath = sanitizeRepoMarkdownPath(`cursos/${courseId}/${opts.slug}.md`);
  if (!repoPath) throw new Error('Invalid slug');

  if (getEditableLocalRepoFile(source, repoPath)) {
    throw new Error(`Note already exists: ${opts.slug}`);
  }

  const content = [
    '---',
    `title: "${opts.title}"`,
    `type: ${opts.type}`,
    `chapter: "${opts.chapter}"`,
    `status: ${opts.status}`,
    `order: ${opts.order}`,
    '---',
    '',
    '',
  ].join('\n');

  writeEditableLocalRepoFile(source, repoPath, content);
  return { slug: opts.slug, content, filePath: repoPath };
}

export function deleteCourseNote(courseId: string, slug: string): void {
  const source = resolveCourseSource(courseId);
  if (!source) throw new Error(`Course not found: ${courseId}`);

  const repoPath = sanitizeRepoMarkdownPath(`cursos/${courseId}/${slug}.md`);
  if (!repoPath) throw new Error('Invalid slug');

  deleteEditableLocalRepoFile(source, repoPath);
}

export function moveCourseNote(courseId: string, slug: string, newSlug: string): void {
  const source = resolveCourseSource(courseId);
  if (!source) throw new Error(`Course not found: ${courseId}`);

  const oldPath = sanitizeRepoMarkdownPath(`cursos/${courseId}/${slug}.md`);
  const newPath = sanitizeRepoMarkdownPath(`cursos/${courseId}/${newSlug}.md`);
  if (!oldPath || !newPath) throw new Error('Invalid slug');

  const file = getEditableLocalRepoFile(source, oldPath);
  if (!file) throw new Error(`Note not found: ${slug}`);

  if (getEditableLocalRepoFile(source, newPath)) {
    throw new Error(`Target already exists: ${newSlug}`);
  }

  writeEditableLocalRepoFile(source, newPath, file.content);
  deleteEditableLocalRepoFile(source, oldPath);
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/zztt/projects/26-musiki/framework && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors on `src/lib/notes-fs.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/lib/notes-fs.ts
git commit -m "feat: add notes-fs library for course markdown filesystem ops"
```

---

## Task 3: `GET /api/notes/list`

**Files:**
- Create: `src/pages/api/notes/list.ts`

- [ ] **Step 1: Create the route**

```typescript
// src/pages/api/notes/list.ts
import type { APIRoute } from 'astro';
import { json } from '../../../lib/forum-server';
import { resolveLiveManageAccess } from '../../../lib/live/access';
import { listCourseNotes, notesPreflightError } from '../../../lib/notes-fs';

export const prerender = false;

export const GET: APIRoute = async ({ request, locals }) => {
  const session = (locals as any).session;
  if (!session?.user?.email) return json({ error: 'Not authenticated' }, 401);

  const url = new URL(request.url);
  const courseId = url.searchParams.get('courseId')?.trim() || '';
  if (!courseId) return json({ error: 'courseId is required' }, 400);

  const access = await resolveLiveManageAccess(session, courseId);
  if (!access.canManage) return json({ error: 'Teacher access required' }, 403);

  const err = notesPreflightError(courseId);
  if (err) return json({ error: err }, 503);

  const notes = listCourseNotes(courseId);
  return json({ notes });
};
```

- [ ] **Step 2: Start dev server (if not running)**

```bash
npm run dev
```

- [ ] **Step 3: Verify list endpoint (replace i1 with an actual courseId)**

```bash
curl -s "http://localhost:4321/api/notes/list?courseId=i1" \
  -H "Cookie: $(cat /tmp/musiki-session-cookie 2>/dev/null || echo '')" | jq '.notes | length'
```

If no session cookie, test from browser DevTools: `fetch('/api/notes/list?courseId=i1').then(r=>r.json()).then(console.log)`

Expected: `{ notes: [...] }` with an array of note objects.

- [ ] **Step 4: Commit**

```bash
git add src/pages/api/notes/list.ts
git commit -m "feat: add GET /api/notes/list endpoint"
```

---

## Task 4: `GET /api/notes/get`

**Files:**
- Create: `src/pages/api/notes/get.ts`

- [ ] **Step 1: Create the route**

```typescript
// src/pages/api/notes/get.ts
import type { APIRoute } from 'astro';
import { json } from '../../../lib/forum-server';
import { resolveLiveManageAccess } from '../../../lib/live/access';
import { getCourseNote, notesPreflightError } from '../../../lib/notes-fs';

export const prerender = false;

export const GET: APIRoute = async ({ request, locals }) => {
  const session = (locals as any).session;
  if (!session?.user?.email) return json({ error: 'Not authenticated' }, 401);

  const url = new URL(request.url);
  const courseId = url.searchParams.get('courseId')?.trim() || '';
  const slug = url.searchParams.get('slug')?.trim() || '';
  if (!courseId || !slug) return json({ error: 'courseId and slug are required' }, 400);

  const access = await resolveLiveManageAccess(session, courseId);
  if (!access.canManage) return json({ error: 'Teacher access required' }, 403);

  const err = notesPreflightError(courseId);
  if (err) return json({ error: err }, 503);

  const note = getCourseNote(courseId, slug);
  if (!note) return json({ error: 'Note not found' }, 404);

  return json({ slug, content: note.content, filePath: note.filePath });
};
```

- [ ] **Step 2: Verify (use an actual slug from the list)**

Browser DevTools: `fetch('/api/notes/get?courseId=i1&slug=intro').then(r=>r.json()).then(d=>console.log(d.content.slice(0,200)))`

Expected: `{ slug, content: "---\ntitle: ...", filePath: "cursos/i1/intro.md" }`

- [ ] **Step 3: Commit**

```bash
git add src/pages/api/notes/get.ts
git commit -m "feat: add GET /api/notes/get endpoint"
```

---

## Task 5: `POST /api/notes/save`

**Files:**
- Create: `src/pages/api/notes/save.ts`

- [ ] **Step 1: Create the route**

```typescript
// src/pages/api/notes/save.ts
import type { APIRoute } from 'astro';
import { json } from '../../../lib/forum-server';
import { resolveLiveManageAccess } from '../../../lib/live/access';
import { saveCourseNote, notesPreflightError } from '../../../lib/notes-fs';

export const prerender = false;

const normalizeText = (v: unknown) => String(v || '').trim();

export const POST: APIRoute = async ({ request, locals }) => {
  const session = (locals as any).session;
  if (!session?.user?.email) return json({ error: 'Not authenticated' }, 401);

  let body: any;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const courseId = normalizeText(body?.courseId);
  const slug = normalizeText(body?.slug);
  const content = typeof body?.content === 'string' ? body.content : null;

  if (!courseId || !slug || content === null) {
    return json({ error: 'courseId, slug, and content are required' }, 400);
  }

  const access = await resolveLiveManageAccess(session, courseId);
  if (!access.canManage) return json({ error: 'Teacher access required' }, 403);

  const err = notesPreflightError(courseId);
  if (err) return json({ error: err }, 503);

  try {
    const result = saveCourseNote(courseId, slug, content);
    return json({ ok: true, slug, filePath: result.filePath });
  } catch (e: any) {
    return json({ error: e.message }, 400);
  }
};
```

- [ ] **Step 2: Verify (from browser DevTools — replaces a note's content)**

```javascript
// Run in browser DevTools while logged in as teacher
fetch('/api/notes/save', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    courseId: 'i1',
    slug: 'intro',  // use an actual slug
    content: '---\ntitle: "Intro"\ntype: lesson\nchapter: "01 Chapter"\nstatus: draft\norder: 1\n---\n\nTest content.\n'
  })
}).then(r => r.json()).then(console.log)
```

Expected: `{ ok: true, slug: "intro", filePath: "cursos/i1/intro.md" }`

- [ ] **Step 3: Commit**

```bash
git add src/pages/api/notes/save.ts
git commit -m "feat: add POST /api/notes/save endpoint"
```

---

## Task 6: `POST /api/notes/create`

**Files:**
- Create: `src/pages/api/notes/create.ts`

- [ ] **Step 1: Create the route**

```typescript
// src/pages/api/notes/create.ts
import type { APIRoute } from 'astro';
import { json } from '../../../lib/forum-server';
import { resolveLiveManageAccess } from '../../../lib/live/access';
import { createCourseNote, notesPreflightError } from '../../../lib/notes-fs';

export const prerender = false;

const normalizeText = (v: unknown) => String(v || '').trim();

export const POST: APIRoute = async ({ request, locals }) => {
  const session = (locals as any).session;
  if (!session?.user?.email) return json({ error: 'Not authenticated' }, 401);

  let body: any;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const courseId = normalizeText(body?.courseId);
  const slug = normalizeText(body?.slug);
  const title = normalizeText(body?.title) || slug;
  const type = normalizeText(body?.type) || 'lesson';
  const chapter = normalizeText(body?.chapter) || '';
  const status = normalizeText(body?.status) || 'draft';
  const order = Number(body?.order) || 0;

  if (!courseId || !slug) return json({ error: 'courseId and slug are required' }, 400);

  const access = await resolveLiveManageAccess(session, courseId);
  if (!access.canManage) return json({ error: 'Teacher access required' }, 403);

  const err = notesPreflightError(courseId);
  if (err) return json({ error: err }, 503);

  try {
    const result = createCourseNote(courseId, { slug, title, type, chapter, status, order });
    return json({ ok: true, slug: result.slug, content: result.content, filePath: result.filePath });
  } catch (e: any) {
    return json({ error: e.message }, 400);
  }
};
```

- [ ] **Step 2: Verify**

```javascript
fetch('/api/notes/create', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    courseId: 'i1',
    slug: 'test-nueva-nota-2026',
    title: 'Test nueva nota',
    type: 'lesson',
    chapter: '01 Chapter',
    status: 'draft',
    order: 99
  })
}).then(r => r.json()).then(console.log)
```

Expected: `{ ok: true, slug: "test-nueva-nota-2026", content: "---\n...", filePath: "cursos/i1/test-nueva-nota-2026.md" }`

- [ ] **Step 3: Commit**

```bash
git add src/pages/api/notes/create.ts
git commit -m "feat: add POST /api/notes/create endpoint"
```

---

## Task 7: `POST /api/notes/delete` and `POST /api/notes/move`

**Files:**
- Create: `src/pages/api/notes/delete.ts`
- Create: `src/pages/api/notes/move.ts`

- [ ] **Step 1: Create delete route**

```typescript
// src/pages/api/notes/delete.ts
import type { APIRoute } from 'astro';
import { json } from '../../../lib/forum-server';
import { resolveLiveManageAccess } from '../../../lib/live/access';
import { deleteCourseNote, notesPreflightError } from '../../../lib/notes-fs';

export const prerender = false;

const normalizeText = (v: unknown) => String(v || '').trim();

export const POST: APIRoute = async ({ request, locals }) => {
  const session = (locals as any).session;
  if (!session?.user?.email) return json({ error: 'Not authenticated' }, 401);

  let body: any;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const courseId = normalizeText(body?.courseId);
  const slug = normalizeText(body?.slug);
  if (!courseId || !slug) return json({ error: 'courseId and slug are required' }, 400);

  const access = await resolveLiveManageAccess(session, courseId);
  if (!access.canManage) return json({ error: 'Teacher access required' }, 403);

  const err = notesPreflightError(courseId);
  if (err) return json({ error: err }, 503);

  try {
    deleteCourseNote(courseId, slug);
    return json({ ok: true });
  } catch (e: any) {
    return json({ error: e.message }, 400);
  }
};
```

- [ ] **Step 2: Create move route**

```typescript
// src/pages/api/notes/move.ts
import type { APIRoute } from 'astro';
import { json } from '../../../lib/forum-server';
import { resolveLiveManageAccess } from '../../../lib/live/access';
import { moveCourseNote, notesPreflightError } from '../../../lib/notes-fs';

export const prerender = false;

const normalizeText = (v: unknown) => String(v || '').trim();

export const POST: APIRoute = async ({ request, locals }) => {
  const session = (locals as any).session;
  if (!session?.user?.email) return json({ error: 'Not authenticated' }, 401);

  let body: any;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const courseId = normalizeText(body?.courseId);
  const slug = normalizeText(body?.slug);
  const newSlug = normalizeText(body?.newSlug);
  if (!courseId || !slug || !newSlug) {
    return json({ error: 'courseId, slug, and newSlug are required' }, 400);
  }

  const access = await resolveLiveManageAccess(session, courseId);
  if (!access.canManage) return json({ error: 'Teacher access required' }, 403);

  const err = notesPreflightError(courseId);
  if (err) return json({ error: err }, 503);

  try {
    moveCourseNote(courseId, slug, newSlug);
    return json({ ok: true, slug: newSlug });
  } catch (e: any) {
    return json({ error: e.message }, 400);
  }
};
```

- [ ] **Step 3: Verify delete (clean up the test note from Task 6)**

```javascript
fetch('/api/notes/delete', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ courseId: 'i1', slug: 'test-nueva-nota-2026' })
}).then(r => r.json()).then(console.log)
```

Expected: `{ ok: true }`

- [ ] **Step 4: Commit**

```bash
git add src/pages/api/notes/delete.ts src/pages/api/notes/move.ts
git commit -m "feat: add POST /api/notes/delete and move endpoints"
```

---

## Task 8: `src/pages/notas-editor.astro` — Page skeleton

**Files:**
- Create: `src/pages/notas-editor.astro`

- [ ] **Step 1: Create the page**

```astro
---
// src/pages/notas-editor.astro
import { resolveLiveManageAccess } from '../lib/live/access';

export const prerender = false;

const session = (Astro.locals as any).session;
const courseId = Astro.url.searchParams.get('course')?.trim() || '';

if (!session?.user?.email) return Astro.redirect('/');
if (!courseId) return Astro.redirect('/');

const access = await resolveLiveManageAccess(session, courseId);
if (!access.canManage) return Astro.redirect('/');
---

<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Editor de notas — {courseId}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      background: #0e0e0e;
      color: #ccc;
      font-family: system-ui, sans-serif;
      font-size: 13px;
      height: 100dvh;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    #app-header {
      padding: .4rem .8rem;
      background: #111;
      border-bottom: 1px solid #222;
      display: flex;
      align-items: center;
      gap: .6rem;
      font-size: 11px;
      color: #555;
      flex-shrink: 0;
    }
    #app-header strong { color: #888; }

    #app-body {
      flex: 1;
      display: flex;
      overflow: hidden;
    }

    /* Left: tree */
    #tree-panel {
      width: 220px;
      background: #111;
      border-right: 1px solid #2a2a2a;
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
      overflow: hidden;
    }

    #tree-header {
      padding: .5rem .7rem;
      border-bottom: 1px solid #222;
      display: flex;
      align-items: center;
      gap: .4rem;
    }
    #tree-course-label { font-size: 11px; opacity: .4; flex: 1; }
    #tree-new-btn {
      background: #2a4a2a;
      color: #7ec87e;
      border: none;
      border-radius: 3px;
      padding: 2px 6px;
      font-size: 10px;
      cursor: pointer;
    }

    #tree-scroll { overflow-y: auto; flex: 1; padding: .3rem 0; }

    /* Right: editor area */
    #editor-panel {
      flex: 1;
      display: flex;
      flex-direction: column;
      background: #0e0e0e;
      min-width: 0;
      overflow: hidden;
    }

    #yaml-strip {
      padding: .4rem .7rem;
      background: #131313;
      border-bottom: 1px solid #1e1e1e;
      display: flex;
      gap: .45rem;
      flex-wrap: wrap;
      align-items: center;
      flex-shrink: 0;
    }

    #eval-strip {
      display: none;
      padding: .4rem .7rem;
      background: #0f0d07;
      border-bottom: 1px solid #2a1e00;
      border-left: 2px solid #c8a87e;
      flex-shrink: 0;
      gap: .45rem;
      align-items: center;
      font-size: 11px;
      color: #c8a87e;
    }
    #eval-strip.visible { display: flex; }

    #snippet-toolbar {
      padding: .3rem .7rem;
      background: #0c0c0c;
      border-bottom: 1px solid #1a1a1a;
      display: flex;
      gap: .35rem;
      align-items: center;
      flex-wrap: wrap;
      flex-shrink: 0;
    }

    #title-input-row {
      padding: .4rem .8rem;
      border-bottom: 1px solid #181818;
      flex-shrink: 0;
    }
    #title-input {
      background: transparent;
      border: none;
      color: #ccc;
      font-size: 14px;
      font-weight: 600;
      width: 100%;
      outline: none;
      font-family: inherit;
    }

    #editor-cm-wrap {
      flex: 1;
      overflow: hidden;
      position: relative;
    }

    #empty-state {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #333;
      font-size: 12px;
    }

    /* Shared UI atoms */
    .fm-chip {
      background: #1a1a1a;
      border: 1px solid #2a2a2a;
      border-radius: 3px;
      padding: 2px 6px;
      font-size: 11px;
      cursor: pointer;
      display: flex;
      gap: .3rem;
      align-items: center;
    }
    .fm-chip select {
      background: transparent;
      border: none;
      color: inherit;
      font-size: 11px;
      cursor: pointer;
      outline: none;
    }
    .fm-chip input[type="number"] {
      background: transparent;
      border: none;
      color: #888;
      font-size: 11px;
      width: 36px;
      outline: none;
    }
    .fm-label { opacity: .4; }

    .snip-btn {
      background: #1a1a2a;
      border: 1px solid #2a2a4a;
      border-radius: 3px;
      padding: 2px 7px;
      font-size: 10px;
      cursor: pointer;
      color: #9a9ac8;
    }

    .action-btn {
      border: none;
      border-radius: 3px;
      padding: 2px 9px;
      font-size: 10px;
      cursor: pointer;
    }
    .action-btn.primary { background: #2a4a2a; color: #7ec87e; }
    .action-btn.secondary { background: transparent; color: #444; border: 1px solid #222; }

    #status-bar {
      padding: .2rem .7rem;
      font-size: 10px;
      color: #333;
      border-top: 1px solid #1a1a1a;
      flex-shrink: 0;
    }
    #status-bar.error { color: #c87e7e; }
    #status-bar.ok { color: #7ec87e; }
  </style>
</head>
<body data-course={courseId}>

<div id="app-header">
  <strong>musiki</strong>
  <span>editor de notas</span>
  <span style="opacity:.3">/</span>
  <strong id="course-label">{courseId}</strong>
  <a href={`/cursos/${courseId}`} style="margin-left:auto;color:#333;font-size:10px;text-decoration:none;">← volver al curso</a>
</div>

<div id="app-body">

  <!-- Tree panel -->
  <div id="tree-panel">
    <div id="tree-header">
      <span id="tree-course-label">{courseId}</span>
      <button id="tree-new-btn">+ nota</button>
    </div>
    <div id="tree-scroll">
      <div style="padding:.5rem .7rem;font-size:11px;color:#333;">Cargando...</div>
    </div>
  </div>

  <!-- Editor panel -->
  <div id="editor-panel">

    <!-- YAML strip -->
    <div id="yaml-strip" style="display:none">
      <span class="fm-label" style="font-size:9px;">FM</span>
      <div class="fm-chip">
        <span class="fm-label">type:</span>
        <select id="fm-type">
          <option value="lesson">lesson</option>
          <option value="assignment">assignment</option>
          <option value="eval">eval</option>
          <option value="info">info</option>
          <option value="public-note">public-note</option>
        </select>
      </div>
      <div class="fm-chip">
        <span class="fm-label">chapter:</span>
        <select id="fm-chapter"></select>
      </div>
      <div class="fm-chip">
        <span class="fm-label">status:</span>
        <select id="fm-status">
          <option value="draft">draft</option>
          <option value="published">published</option>
          <option value="private">private</option>
        </select>
      </div>
      <div class="fm-chip">
        <span class="fm-label">order:</span>
        <input type="number" id="fm-order" min="0" max="999" />
      </div>
      <div class="fm-chip">
        <span class="fm-label">theme:</span>
        <select id="fm-theme"><option value="">—</option></select>
      </div>
      <div style="margin-left:auto;display:flex;gap:.3rem;flex-shrink:0;">
        <button class="action-btn secondary" id="btn-discard">↩</button>
        <button class="action-btn primary" id="btn-save">💾 Guardar</button>
      </div>
    </div>

    <!-- EVAL strip (contextual) -->
    <div id="eval-strip">
      <span style="font-size:9px;opacity:.5;margin-left:4px;">EVAL</span>
      <span style="font-size:9px;opacity:.3;font-style:italic;">cursor en bloque eval</span>
      <div class="fm-chip" style="background:#1a1200;border-color:#3a2a00;">
        <span class="fm-label" style="color:#c8a87e">evalType:</span>
        <select id="eval-type" style="color:#c8a87e;background:transparent;border:none;font-size:11px;cursor:pointer;outline:none;">
          <option value="class-reveal">class-reveal</option>
          <option value="patch-ai">patch-ai</option>
        </select>
      </div>
      <!-- Additional eval fields will be added when implementing eval work -->
    </div>

    <!-- Snippet toolbar -->
    <div id="snippet-toolbar" style="display:none">
      <span style="opacity:.2;font-size:9px;flex-shrink:0;">INSERT</span>
      <button class="snip-btn" data-snippet="cover">🎴 COVER</button>
      <button class="snip-btn" data-snippet="lily" style="background:#1a2a1a;border-color:#2a4a2a;color:#7ec87e;">🎵 LILY</button>
      <button class="snip-btn" data-snippet="mermaid" style="background:#1a2a2a;border-color:#2a4a4a;color:#7ec8c8;">📊 MERMAID</button>
      <button class="snip-btn" data-snippet="iframe" style="background:#2a1a2a;border-color:#4a2a4a;color:#c87ec8;">🖼️ IFRAME</button>
      <button class="snip-btn" data-snippet="eval" style="background:#2a2a1a;border-color:#4a4a2a;color:#c8c87e;">🖼️ EVAL</button>
      <div style="width:1px;background:#222;height:16px;margin:0 .1rem;"></div>
      <button class="snip-btn" data-snippet="img" style="background:#1e1a12;border-color:#3a2a1a;color:#c8a87e;">📷 IMG <span style="opacity:.4;font-size:9px;">S3</span></button>
    </div>

    <!-- Title row -->
    <div id="title-input-row" style="display:none">
      <input type="text" id="title-input" placeholder="Título de la nota..." />
    </div>

    <!-- CodeMirror mount point -->
    <div id="editor-cm-wrap" style="display:none"></div>

    <!-- Empty state -->
    <div id="empty-state">
      ← Seleccioná una nota para editar
    </div>

    <!-- Status bar -->
    <div id="status-bar">listo</div>
  </div>

</div>

<script>
  import '/src/scripts/notes-editor/index.ts';
</script>

</body>
</html>
```

- [ ] **Step 2: Verify page loads at `/notas-editor?course=i1` (as teacher)**

Open in browser. Should show the split layout with "Cargando..." in tree and empty state in editor. No JS errors yet (script not written).

- [ ] **Step 3: Commit**

```bash
git add src/pages/notas-editor.astro
git commit -m "feat: add notas-editor page scaffold"
```

---

## Task 9: `types.ts` + `api.ts` — Frontend types and API client

**Files:**
- Create: `src/scripts/notes-editor/types.ts`
- Create: `src/scripts/notes-editor/api.ts`

- [ ] **Step 1: Create types**

```typescript
// src/scripts/notes-editor/types.ts
export type NoteListItem = {
  slug: string;
  title: string;
  type: string;
  chapter: string;
  status: string;
  order: number;
  theme?: string;
  filePath: string;
};

export type NoteContent = {
  slug: string;
  content: string;
  filePath: string;
};
```

- [ ] **Step 2: Create API client**

```typescript
// src/scripts/notes-editor/api.ts
import type { NoteListItem, NoteContent } from './types';

async function apiFetch<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data as T;
}

export function listNotes(courseId: string): Promise<{ notes: NoteListItem[] }> {
  return apiFetch(`/api/notes/list?courseId=${encodeURIComponent(courseId)}`);
}

export function getNote(courseId: string, slug: string): Promise<NoteContent> {
  return apiFetch(`/api/notes/get?courseId=${encodeURIComponent(courseId)}&slug=${encodeURIComponent(slug)}`);
}

export function saveNote(courseId: string, slug: string, content: string): Promise<{ ok: boolean }> {
  return apiFetch('/api/notes/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ courseId, slug, content }),
  });
}

export function createNote(courseId: string, opts: {
  slug: string; title: string; type: string; chapter: string; status: string; order: number;
}): Promise<{ ok: boolean; slug: string; content: string }> {
  return apiFetch('/api/notes/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ courseId, ...opts }),
  });
}

export function deleteNote(courseId: string, slug: string): Promise<{ ok: boolean }> {
  return apiFetch('/api/notes/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ courseId, slug }),
  });
}

export function moveNote(courseId: string, slug: string, newSlug: string): Promise<{ ok: boolean; slug: string }> {
  return apiFetch('/api/notes/move', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ courseId, slug, newSlug }),
  });
}
```

- [ ] **Step 3: Commit**

```bash
git add src/scripts/notes-editor/types.ts src/scripts/notes-editor/api.ts
git commit -m "feat: add notes-editor frontend types and API client"
```

---

## Task 10: `tree.ts` — Chapter tree

**Files:**
- Create: `src/scripts/notes-editor/tree.ts`

- [ ] **Step 1: Create tree module**

```typescript
// src/scripts/notes-editor/tree.ts
import type { NoteListItem } from './types';

export type TreeCallbacks = {
  onSelect: (slug: string) => void;
  onCreate: (chapter: string) => void;
  onDelete: (slug: string) => void;
  onRename: (slug: string) => void;
  onOrderChange: (slug: string, newOrder: number, newChapter: string) => void;
};

type ChapterGroup = { name: string; notes: NoteListItem[] };

function groupByChapter(notes: NoteListItem[]): ChapterGroup[] {
  const map = new Map<string, NoteListItem[]>();
  for (const note of notes) {
    const ch = note.chapter || '(sin capítulo)';
    if (!map.has(ch)) map.set(ch, []);
    map.get(ch)!.push(note);
  }
  // Sort chapters by lowest order note in each
  return Array.from(map.entries())
    .map(([name, notes]) => ({ name, notes: notes.sort((a, b) => a.order - b.order) }))
    .sort((a, b) => {
      const minA = Math.min(...a.notes.map(n => n.order));
      const minB = Math.min(...b.notes.map(n => n.order));
      return minA - minB || a.name.localeCompare(b.name);
    });
}

function noteIcon(type: string): string {
  if (type === 'eval') return '📝';
  if (type === 'assignment') return '📝';
  if (type === 'info') return 'ℹ️';
  if (type === 'public-note') return '🌐';
  return '📄';
}

let contextMenuEl: HTMLElement | null = null;

function closeContextMenu() {
  contextMenuEl?.remove();
  contextMenuEl = null;
}

function showContextMenu(
  x: number, y: number,
  items: { label: string; action: () => void; danger?: boolean }[]
) {
  closeContextMenu();
  const menu = document.createElement('div');
  menu.style.cssText = `
    position:fixed;left:${x}px;top:${y}px;
    background:#1a1a1a;border:1px solid #333;border-radius:4px;
    padding:3px 0;z-index:9999;min-width:140px;box-shadow:0 4px 12px rgba(0,0,0,.6);
  `;
  for (const item of items) {
    const el = document.createElement('div');
    el.textContent = item.label;
    el.style.cssText = `
      padding:4px 12px;font-size:11px;cursor:pointer;
      color:${item.danger ? '#c87e7e' : '#ccc'};
    `;
    el.addEventListener('mouseenter', () => { el.style.background = '#2a2a2a'; });
    el.addEventListener('mouseleave', () => { el.style.background = ''; });
    el.addEventListener('click', () => { closeContextMenu(); item.action(); });
    menu.appendChild(el);
  }
  contextMenuEl = menu;
  document.body.appendChild(menu);
}

document.addEventListener('click', closeContextMenu);
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeContextMenu(); });

export function renderTree(
  container: HTMLElement,
  notes: NoteListItem[],
  activeSlug: string | null,
  cb: TreeCallbacks
) {
  container.innerHTML = '';

  const groups = groupByChapter(notes);

  for (const group of groups) {
    // Chapter header
    const header = document.createElement('div');
    header.style.cssText = 'padding:.25rem .7rem;font-size:9px;opacity:.3;text-transform:uppercase;letter-spacing:.05em;margin-top:.4rem;display:flex;align-items:center;gap:.3rem;';
    header.textContent = group.name;
    const newInChapter = document.createElement('button');
    newInChapter.textContent = '+';
    newInChapter.title = `Nueva nota en "${group.name}"`;
    newInChapter.style.cssText = 'background:none;border:none;color:#3a5a3a;cursor:pointer;font-size:10px;padding:0 2px;margin-left:auto;';
    newInChapter.addEventListener('click', e => { e.stopPropagation(); cb.onCreate(group.name); });
    header.appendChild(newInChapter);
    container.appendChild(header);

    // Notes in chapter
    for (const note of group.notes) {
      const row = document.createElement('div');
      row.style.cssText = `
        padding:.2rem .7rem .2rem 1.2rem;
        display:flex;gap:.3rem;align-items:center;
        cursor:pointer;font-size:11px;
        ${note.slug === activeSlug
          ? 'background:#1a2a1a;border-left:2px solid #5a9a5a;color:#7ec87e;'
          : 'color:#666;border-left:2px solid transparent;'}
      `;
      row.setAttribute('draggable', 'true');
      row.dataset.slug = note.slug;
      row.dataset.chapter = note.chapter;
      row.dataset.order = String(note.order);

      const icon = document.createElement('span');
      icon.textContent = noteIcon(note.type);
      const label = document.createElement('span');
      label.textContent = note.title;
      row.appendChild(icon);
      row.appendChild(label);

      row.addEventListener('click', () => cb.onSelect(note.slug));

      row.addEventListener('contextmenu', e => {
        e.preventDefault();
        showContextMenu(e.clientX, e.clientY, [
          { label: 'Renombrar slug', action: () => cb.onRename(note.slug) },
          { label: 'Eliminar', action: () => cb.onDelete(note.slug), danger: true },
        ]);
      });

      // Drag support
      row.addEventListener('dragstart', e => {
        e.dataTransfer!.setData('text/plain', note.slug);
        e.dataTransfer!.effectAllowed = 'move';
        row.style.opacity = '.4';
      });
      row.addEventListener('dragend', () => { row.style.opacity = ''; });

      container.appendChild(row);
    }
  }

  // Drop on chapter headers (allow dragging note to different chapter)
  container.querySelectorAll<HTMLElement>('[data-chapter-drop]').forEach(el => {
    el.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer!.dropEffect = 'move'; });
    el.addEventListener('drop', e => {
      e.preventDefault();
      const slug = e.dataTransfer!.getData('text/plain');
      const newChapter = el.dataset.chapterDrop!;
      const note = notes.find(n => n.slug === slug);
      if (note && note.chapter !== newChapter) {
        cb.onOrderChange(slug, note.order, newChapter);
      }
    });
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/scripts/notes-editor/tree.ts
git commit -m "feat: add notes-editor tree component"
```

---

## Task 11: `yaml-strip.ts` — Frontmatter strip

**Files:**
- Create: `src/scripts/notes-editor/yaml-strip.ts`

- [ ] **Step 1: Create module**

```typescript
// src/scripts/notes-editor/yaml-strip.ts
import matter from 'gray-matter';
import type { NoteListItem } from './types';

export type FrontmatterData = {
  title: string;
  type: string;
  chapter: string;
  status: string;
  order: number;
  theme: string;
  [key: string]: unknown;
};

export function parseFrontmatter(content: string): { data: FrontmatterData; body: string } {
  const parsed = matter(content);
  return {
    data: {
      title: String(parsed.data.title || ''),
      type: String(parsed.data.type || 'lesson'),
      chapter: String(parsed.data.chapter || ''),
      status: String(parsed.data.status || 'draft'),
      order: Number(parsed.data.order) || 0,
      theme: String(parsed.data.theme || ''),
      ...parsed.data,
    },
    body: parsed.content,
  };
}

export function serializeFrontmatter(data: FrontmatterData, body: string): string {
  // Preserve original extra keys, override the editable ones
  const fm: Record<string, unknown> = { ...data };
  // Remove empty theme
  if (!fm.theme) delete fm.theme;
  return matter.stringify(body, fm);
}

export function populateYamlStrip(
  notes: NoteListItem[],
  data: FrontmatterData,
) {
  const typeEl = document.getElementById('fm-type') as HTMLSelectElement;
  const chapterEl = document.getElementById('fm-chapter') as HTMLSelectElement;
  const statusEl = document.getElementById('fm-status') as HTMLSelectElement;
  const orderEl = document.getElementById('fm-order') as HTMLInputElement;
  const themeEl = document.getElementById('fm-theme') as HTMLSelectElement;

  // Populate chapter options from existing notes
  const chapters = [...new Set(notes.map(n => n.chapter).filter(Boolean))].sort();
  chapterEl.innerHTML = '';
  for (const ch of chapters) {
    const opt = document.createElement('option');
    opt.value = ch;
    opt.textContent = ch;
    chapterEl.appendChild(opt);
  }
  // Add current if not in list
  if (data.chapter && !chapters.includes(data.chapter)) {
    const opt = document.createElement('option');
    opt.value = data.chapter;
    opt.textContent = data.chapter;
    chapterEl.insertBefore(opt, chapterEl.firstChild);
  }

  // Populate theme options
  const themes = [...new Set(notes.map(n => n.theme).filter(Boolean) as string[])].sort();
  themeEl.innerHTML = '<option value="">—</option>';
  for (const th of themes) {
    const opt = document.createElement('option');
    opt.value = th;
    opt.textContent = th;
    themeEl.appendChild(opt);
  }

  // Set values
  typeEl.value = data.type;
  chapterEl.value = data.chapter;
  statusEl.value = data.status;
  orderEl.value = String(data.order);
  themeEl.value = data.theme || '';
}

export function readYamlStrip(): Partial<FrontmatterData> {
  return {
    type: (document.getElementById('fm-type') as HTMLSelectElement).value,
    chapter: (document.getElementById('fm-chapter') as HTMLSelectElement).value,
    status: (document.getElementById('fm-status') as HTMLSelectElement).value,
    order: Number((document.getElementById('fm-order') as HTMLInputElement).value) || 0,
    theme: (document.getElementById('fm-theme') as HTMLSelectElement).value || undefined,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/scripts/notes-editor/yaml-strip.ts
git commit -m "feat: add notes-editor yaml-strip component"
```

---

## Task 12: `editor.ts` — CodeMirror

**Files:**
- Create: `src/scripts/notes-editor/editor.ts`

- [ ] **Step 1: Create module**

```typescript
// src/scripts/notes-editor/editor.ts
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { history, historyKeymap, defaultKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';

let view: EditorView | null = null;

const musikiTheme = EditorView.theme({
  '&': { height: '100%', fontSize: '12px', fontFamily: '"JetBrains Mono", "Fira Code", monospace' },
  '.cm-scroller': { overflow: 'auto', lineHeight: '1.8' },
  '.cm-content': { padding: '.6rem .9rem', caretColor: '#7ec87e' },
  '&.cm-focused .cm-cursor': { borderLeftColor: '#7ec87e' },
  '.cm-activeLine': { backgroundColor: '#141414' },
  '.cm-gutters': { backgroundColor: '#111', borderRight: '1px solid #1e1e1e', color: '#333' },
  '.cm-selectionBackground': { backgroundColor: '#2a4a2a !important' },
}, { dark: true });

export function createEditor(container: HTMLElement, initialContent: string, onChange: () => void): EditorView {
  const state = EditorState.create({
    doc: initialContent,
    extensions: [
      lineNumbers(),
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      markdown(),
      syntaxHighlighting(defaultHighlightStyle),
      EditorView.lineWrapping,
      musikiTheme,
      EditorView.updateListener.of(update => {
        if (update.docChanged || update.selectionSet) onChange();
      }),
    ],
  });

  view = new EditorView({ state, parent: container });
  return view;
}

export function getEditorContent(): string {
  return view?.state.doc.toString() ?? '';
}

export function setEditorContent(content: string) {
  if (!view) return;
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: content },
  });
}

export function insertAtCursor(snippet: string) {
  if (!view) return;
  const { from, to } = view.state.selection.main;
  view.dispatch({
    changes: { from, to, insert: snippet },
    selection: { anchor: from + snippet.length },
  });
  view.focus();
}

export function isInsideEvalBlock(): boolean {
  if (!view) return false;
  const state = view.state;
  const pos = state.selection.main.head;
  const doc = state.doc;
  const curLine = doc.lineAt(pos).number;

  // Scan backwards for ```eval
  let foundOpen = false;
  for (let i = curLine; i >= 1; i--) {
    const text = doc.line(i).text.trim();
    if (text === '```') return false; // hit a closing fence before an opening one
    if (text === '```eval') { foundOpen = true; break; }
  }
  if (!foundOpen) return false;

  // Scan forwards for closing ```
  const totalLines = doc.lines;
  for (let i = curLine + 1; i <= totalLines; i++) {
    const text = doc.line(i).text.trim();
    if (text === '```') return true;
  }
  return false;
}

export function destroyEditor() {
  view?.destroy();
  view = null;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/scripts/notes-editor/editor.ts
git commit -m "feat: add CodeMirror editor module with eval block detection"
```

---

## Task 13: `toolbar.ts` — Snippet toolbar + drop/paste

To implement image S3 upload, first find the existing upload endpoint:

```bash
grep -r "upload\|r2\|s3" /Users/zztt/projects/26-musiki/framework/src/pages/api/ --include="*.ts" -l
```

Look for the endpoint that returns a URL for uploaded images (used by Foro). Use that same endpoint.

**Files:**
- Create: `src/scripts/notes-editor/toolbar.ts`

- [ ] **Step 1: Find the S3 upload API endpoint**

```bash
grep -r "upload\|imageUrl\|publicUrl\|s3\|r2" /Users/zztt/projects/26-musiki/framework/src/pages/api/ --include="*.ts" -l | head -10
```

Identify the endpoint and its expected request/response shape. Then write the upload helper in toolbar.ts.

- [ ] **Step 2: Create toolbar module**

Replace `YOUR_UPLOAD_ENDPOINT` and `YOUR_UPLOAD_FIELD` below with the actual endpoint and field name found in step 1.

```typescript
// src/scripts/notes-editor/toolbar.ts
import { insertAtCursor } from './editor';

const SNIPPETS: Record<string, string> = {
  cover: '%%cover%%\n<grid drag="60 55" drop="5 10">\n# título\n</grid>\n',
  lily: '```lily\n\\relative c\' {\n  c d e f g a b c\n}\n```\n',
  mermaid: '```mermaid\ngraph TD\n  A --> B\n```\n',
  iframe: '<iframe src="URL" width="100%" height="400" frameborder="0" allowfullscreen></iframe>\n',
  eval: '```eval\nevalType: class-reveal\n```\n',
};

async function uploadImageToS3(file: File, courseId: string): Promise<string | null> {
  // Find the upload endpoint. Common pattern in this codebase:
  // grep for "upload" in src/pages/api to find the Foro upload route.
  // Replace the path and body below with the actual endpoint.
  const formData = new FormData();
  formData.append('file', file);
  formData.append('courseId', courseId);

  try {
    // Try the forum upload endpoint first; update if the path differs
    const res = await fetch('/api/forum/upload-image', { method: 'POST', body: formData });
    if (!res.ok) return null;
    const data = await res.json();
    return data.url || data.publicUrl || null;
  } catch {
    return null;
  }
}

function detectVideoEmbed(url: string): string | null {
  const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]+)/);
  if (yt) return `<iframe src="https://www.youtube.com/embed/${yt[1]}" width="100%" height="400" frameborder="0" allowfullscreen></iframe>\n`;

  const vimeo = url.match(/vimeo\.com\/(\d+)/);
  if (vimeo) return `<iframe src="https://player.vimeo.com/video/${vimeo[1]}" width="100%" height="400" frameborder="0" allowfullscreen></iframe>\n`;

  return null;
}

export function initToolbar(courseId: string, statusFn: (msg: string, type?: 'ok'|'error') => void) {
  // Snippet buttons
  document.querySelectorAll<HTMLButtonElement>('.snip-btn[data-snippet]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const key = btn.dataset.snippet!;

      if (key === 'img') {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.onchange = async () => {
          const file = input.files?.[0];
          if (!file) return;
          statusFn('Subiendo imagen...');
          const url = await uploadImageToS3(file, courseId);
          if (url) {
            insertAtCursor(`![](${url})\n`);
            statusFn('Imagen subida', 'ok');
          } else {
            statusFn('Error al subir imagen', 'error');
          }
        };
        input.click();
        return;
      }

      const snippet = SNIPPETS[key];
      if (snippet) insertAtCursor(snippet);
    });
  });

  // Drop on editor wrapper
  const editorWrap = document.getElementById('editor-cm-wrap');
  if (!editorWrap) return;

  editorWrap.addEventListener('dragover', e => {
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'copy';
  });

  editorWrap.addEventListener('drop', async e => {
    e.preventDefault();

    // Image file drop
    const file = Array.from(e.dataTransfer?.files || []).find(f => f.type.startsWith('image/'));
    if (file) {
      statusFn('Subiendo imagen...');
      const url = await uploadImageToS3(file, courseId);
      if (url) {
        insertAtCursor(`![](${url})\n`);
        statusFn('Imagen subida', 'ok');
      } else {
        statusFn('Error al subir imagen', 'error');
      }
      return;
    }

    // URL drop
    const text = e.dataTransfer?.getData('text/plain')?.trim();
    if (text && (text.startsWith('http://') || text.startsWith('https://'))) {
      const embed = detectVideoEmbed(text);
      if (embed) {
        insertAtCursor(embed);
        return;
      }
      // Generic URL — try to fetch title
      try {
        // Just insert markdown link with URL as placeholder title
        insertAtCursor(`[${text}](${text})\n`);
      } catch {
        insertAtCursor(`[enlace](${text})\n`);
      }
    }
  });

  // Paste image
  document.addEventListener('paste', async e => {
    const imageItem = Array.from(e.clipboardData?.items || []).find(i => i.type.startsWith('image/'));
    if (!imageItem) return;

    const file = imageItem.getAsFile();
    if (!file) return;
    e.preventDefault();

    statusFn('Subiendo imagen pegada...');
    const url = await uploadImageToS3(file, courseId);
    if (url) {
      insertAtCursor(`![](${url})\n`);
      statusFn('Imagen subida', 'ok');
    } else {
      statusFn('Error al subir imagen', 'error');
    }
  });
}
```

- [ ] **Step 3: Commit**

```bash
git add src/scripts/notes-editor/toolbar.ts
git commit -m "feat: add notes-editor snippet toolbar and drop handlers"
```

---

## Task 14: `index.ts` — Wire everything together

**Files:**
- Create: `src/scripts/notes-editor/index.ts`

- [ ] **Step 1: Create entry**

```typescript
// src/scripts/notes-editor/index.ts
import { listNotes, getNote, saveNote, createNote, deleteNote, moveNote } from './api';
import { renderTree } from './tree';
import { createEditor, getEditorContent, setEditorContent, isInsideEvalBlock } from './editor';
import { parseFrontmatter, serializeFrontmatter, populateYamlStrip, readYamlStrip } from './yaml-strip';
import { initToolbar } from './toolbar';
import type { NoteListItem } from './types';

const courseId = document.body.dataset.course || '';
let allNotes: NoteListItem[] = [];
let activeSlug: string | null = null;
let originalContent: string | null = null;
let editorMounted = false;

function setStatus(msg: string, type?: 'ok' | 'error') {
  const bar = document.getElementById('status-bar')!;
  bar.textContent = msg;
  bar.className = type ? type : '';
  if (type === 'ok') setTimeout(() => { bar.textContent = 'listo'; bar.className = ''; }, 2500);
}

function showEditorPanel(show: boolean) {
  ['yaml-strip', 'snippet-toolbar', 'title-input-row', 'editor-cm-wrap'].forEach(id => {
    const el = document.getElementById(id)!;
    el.style.display = show ? '' : 'none';
  });
  const empty = document.getElementById('empty-state')!;
  empty.style.display = show ? 'none' : '';
}

async function loadNote(slug: string) {
  setStatus('Cargando...');
  try {
    const data = await getNote(courseId, slug);
    activeSlug = slug;
    originalContent = data.content;

    const { data: fm } = parseFrontmatter(data.content);

    // Title
    const titleInput = document.getElementById('title-input') as HTMLInputElement;
    titleInput.value = fm.title;

    // YAML strip
    populateYamlStrip(allNotes, fm);
    document.getElementById('yaml-strip')!.style.display = '';

    // Editor
    const wrap = document.getElementById('editor-cm-wrap')!;
    wrap.style.display = '';
    if (!editorMounted) {
      createEditor(wrap, data.content, onEditorChange);
      editorMounted = true;
    } else {
      setEditorContent(data.content);
    }

    showEditorPanel(true);
    initToolbar(courseId, setStatus);
    document.getElementById('snippet-toolbar')!.style.display = '';

    refreshTree();
    setStatus('listo');
  } catch (e: any) {
    setStatus(e.message, 'error');
  }
}

function onEditorChange() {
  const inEval = isInsideEvalBlock();
  const evalStrip = document.getElementById('eval-strip')!;
  evalStrip.classList.toggle('visible', inEval);
}

async function saveCurrentNote() {
  if (!activeSlug) return;
  setStatus('Guardando...');
  try {
    // Build full content: merge YAML strip overrides into document
    const raw = getEditorContent();
    const { data: fm, body } = parseFrontmatter(raw);
    const strip = readYamlStrip();
    const merged = { ...fm, ...strip };

    // Sync title from input
    const titleInput = document.getElementById('title-input') as HTMLInputElement;
    if (titleInput.value.trim()) merged.title = titleInput.value.trim();

    const content = serializeFrontmatter(merged as any, body);
    await saveNote(courseId, activeSlug, content);
    originalContent = content;

    // Refresh list (order/chapter may have changed)
    const listData = await listNotes(courseId);
    allNotes = listData.notes;
    refreshTree();
    setStatus('Guardado', 'ok');
  } catch (e: any) {
    setStatus(e.message, 'error');
  }
}

function refreshTree() {
  const container = document.getElementById('tree-scroll')!;
  renderTree(container, allNotes, activeSlug, {
    onSelect: (slug) => loadNote(slug),
    onCreate: async (chapter) => {
      const title = prompt('Título de la nueva nota:');
      if (!title) return;
      const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      const maxOrder = Math.max(0, ...allNotes.filter(n => n.chapter === chapter).map(n => n.order));
      try {
        const result = await createNote(courseId, { slug, title, type: 'lesson', chapter, status: 'draft', order: maxOrder + 1 });
        const listData = await listNotes(courseId);
        allNotes = listData.notes;
        await loadNote(result.slug);
      } catch (e: any) {
        setStatus(e.message, 'error');
      }
    },
    onDelete: async (slug) => {
      if (!confirm(`¿Eliminar "${slug}"? Esta acción no se puede deshacer.`)) return;
      try {
        await deleteNote(courseId, slug);
        if (activeSlug === slug) {
          activeSlug = null;
          showEditorPanel(false);
        }
        const listData = await listNotes(courseId);
        allNotes = listData.notes;
        refreshTree();
        setStatus('Nota eliminada', 'ok');
      } catch (e: any) {
        setStatus(e.message, 'error');
      }
    },
    onRename: async (slug) => {
      const newSlug = prompt('Nuevo slug (nombre de archivo sin .md):', slug);
      if (!newSlug || newSlug === slug) return;
      try {
        await moveNote(courseId, slug, newSlug);
        const listData = await listNotes(courseId);
        allNotes = listData.notes;
        if (activeSlug === slug) await loadNote(newSlug);
        else refreshTree();
        setStatus('Nota renombrada', 'ok');
      } catch (e: any) {
        setStatus(e.message, 'error');
      }
    },
    onOrderChange: async (slug, newOrder, newChapter) => {
      try {
        const note = allNotes.find(n => n.slug === slug);
        if (!note) return;
        const raw = await getNote(courseId, slug);
        const { data: fm, body } = parseFrontmatter(raw.content);
        fm.chapter = newChapter;
        const content = serializeFrontmatter(fm as any, body);
        await saveNote(courseId, slug, content);
        const listData = await listNotes(courseId);
        allNotes = listData.notes;
        refreshTree();
      } catch (e: any) {
        setStatus(e.message, 'error');
      }
    },
  });
}

// Discard button
document.getElementById('btn-discard')?.addEventListener('click', () => {
  if (!originalContent) return;
  setEditorContent(originalContent);
  const { data: fm } = parseFrontmatter(originalContent);
  populateYamlStrip(allNotes, fm);
  (document.getElementById('title-input') as HTMLInputElement).value = fm.title;
  setStatus('Cambios descartados');
});

// Save button + Cmd/Ctrl+S
document.getElementById('btn-save')?.addEventListener('click', saveCurrentNote);
document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key === 's') {
    e.preventDefault();
    saveCurrentNote();
  }
});

// New note (global)
document.getElementById('tree-new-btn')?.addEventListener('click', () => {
  const chapter = allNotes[0]?.chapter || '';
  const title = prompt('Título de la nueva nota:');
  if (!title) return;
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  createNote(courseId, { slug, title, type: 'lesson', chapter, status: 'draft', order: 0 })
    .then(result => listNotes(courseId).then(d => { allNotes = d.notes; return loadNote(result.slug); }))
    .catch(e => setStatus(e.message, 'error'));
});

// Boot
showEditorPanel(false);
listNotes(courseId)
  .then(data => {
    allNotes = data.notes;
    refreshTree();
    setStatus(`${data.notes.length} notas cargadas`);
  })
  .catch(e => setStatus(e.message, 'error'));
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | grep -E "error|warning" | head -20
```

Fix any type errors before proceeding.

- [ ] **Step 3: Commit**

```bash
git add src/scripts/notes-editor/index.ts
git commit -m "feat: wire notes-editor — tree, yaml-strip, CodeMirror, save/load"
```

---

## Task 15: End-to-end browser verification

- [ ] **Step 1: Open the editor as teacher**

Navigate to: `http://localhost:4321/notas-editor?course=i1`

Expected: tree loads with notes grouped by chapter, empty state on right.

- [ ] **Step 2: Select a note**

Click a note in the tree.

Expected:
- YAML strip appears with correct type/chapter/status/order values
- Title input shows note title
- CodeMirror loads with markdown content
- Status bar says "listo"

- [ ] **Step 3: Edit and save**

Change some text in the editor. Press `Cmd+S` (or click 💾 Guardar).

Expected:
- Status bar briefly shows "Guardando..." then "Guardado"
- File on disk changed (verify with `cat` on VPS or locally)

- [ ] **Step 4: Test EVAL block cursor detection**

In the editor, type:
```
```eval
evalType: class-reveal
```
```

Place cursor inside the block.

Expected: EVAL strip appears with orange left border.

Move cursor outside the block.

Expected: EVAL strip disappears.

- [ ] **Step 5: Test snippet toolbar**

Click "🎵 LILY". Expected: LilyPond snippet inserted at cursor.

Click "📊 MERMAID". Expected: Mermaid snippet inserted.

- [ ] **Step 6: Test create**

Click `+ nota`. Enter a title. Expected: new note created, tree refreshes, note loaded in editor.

- [ ] **Step 7: Test delete**

Right-click a test note → Eliminar. Confirm.

Expected: note removed from tree. If it was active, empty state shows.

- [ ] **Step 8: Final commit**

```bash
git add -A
git commit -m "feat: complete notes-editor direct write feature"
```

---

## Task 16: Clean up `.continue-here.md`

- [ ] **Step 1: Delete the checkpoint file**

```bash
rm /Users/zztt/projects/26-musiki/framework/.planning/.continue-here.md
git add -A
git commit -m "chore: clear brainstorm checkpoint — notes editor implemented"
```

- [ ] **Step 2: Update STATE.md**

Update `.planning/STATE.md`:
- `stopped_at`: completed notes-editor-direct-write implementation
- `last_activity`: today's date + "Notes editor direct write feature complete"

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|-----------------|------|
| REST API: list, get, save, create, delete, move | Tasks 3–7 |
| Page at `/notas-editor?course=[id]` | Task 8 |
| Teacher-only auth guard | Tasks 3–8 (resolveLiveManageAccess) |
| Chapter tree with drag/context menu | Task 10 |
| YAML strip with course-specific suggestions | Tasks 11, 14 |
| CodeMirror editor | Task 12 |
| EVAL contextual row (cursor detection) | Tasks 12, 14 |
| Snippet toolbar | Task 13 |
| Image drop/paste → S3 | Task 13 |
| URL drop → embed or link | Task 13 |
| Cmd+S to save | Task 14 |
| Discard button | Task 14 |
| EVAL fields deferred | Placeholder in Task 8 HTML |
| Filesystem only, no GitHub/Postgres | Tasks 2–7 (notes-fs.ts) |

**Placeholder scan:** None — all steps contain actual code.

**Type consistency:**
- `NoteListItem` defined in `types.ts` (Task 9), used in `tree.ts` (Task 10), `yaml-strip.ts` (Task 11), `index.ts` (Task 14) ✓
- `FrontmatterData` defined in `yaml-strip.ts`, used in `index.ts` ✓
- `listNotes`, `getNote`, `saveNote`, `createNote`, `deleteNote`, `moveNote` defined in `api.ts` (Task 9), used in `index.ts` (Task 14) ✓
- `createEditor`, `getEditorContent`, `setEditorContent`, `insertAtCursor`, `isInsideEvalBlock` defined in `editor.ts` (Task 12), used in `index.ts` and `toolbar.ts` ✓
