# Recursos Pod (Re) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Re pod — a shared class resource manager with filetree UI, R2 file uploads, auto-captured "compartidos", LiveKit real-time sync, and DB autosave that exports to a `.md` file in the clase folder.

**Architecture:** LiveKit data messages broadcast resource state to all participants in real-time; the DB (`LiveClassResource` table) is the persistence layer written via debounced autosave and `sendBeacon` on close; the `.md` file is an on-demand export via content-admin. The pod controller is an injectable class (same pattern as `SonicAnalyzerController`) receiving `publish`, `getCourseId`, `getRoomName`, and `getIdentity` callbacks from `livekit-room.ts`.

**Tech Stack:** Astro (panel HTML), TypeScript (controller), PostgreSQL via `pool.ts` query helper, Cloudflare R2 via `@aws-sdk/client-s3`, LiveKit data messages, content-admin publish API.

**Spec:** `docs/superpowers/specs/2026-05-04-recursos-pod-design.md`

---

## File Map

**Create:**
- `supabase/migrations/20260504120000_live_class_resources.sql` — table + indexes
- `supabase/migrations/20260504120001_rls_live_class_resources.sql` — RLS policy
- `src/pages/api/room/recursos-upload.ts` — R2 upload endpoint
- `src/pages/api/live/recursos.ts` — GET/POST resource list
- `src/pages/api/live/recursos/resolve-title.ts` — server-side URL title fetch
- `src/pages/api/live/recursos/compartidos-history.ts` — retroactive compartidos data
- `src/scripts/room/recursos/metadata.ts` — Author-year-title extraction (pure)
- `src/scripts/room/recursos/filetree.ts` — tree data ops + DOM render
- `src/scripts/room/recursos/controller.ts` — main pod controller class
- `src/scripts/room/recursos/index.ts` — export
- `src/components/room/panels/recursos/RecursosPanel.astro` — HTML structure
- `src/components/room/panels/recursos/recursos.css` — styles

**Modify:**
- `src/components/room/workspace/PodTemplates.astro` — import + add `<RecursosPanel />`
- `src/scripts/room/workspace/RoomWorkspaceManager.ts` — register pod + `onRecursosInit` callback
- `src/scripts/livekit-room.ts` — wire `RecursosController`, add to workspace init call
- `src/scripts/room/sonic-analyzer/controller.ts` — dispatch `musiki:recursos:sa-uploaded` after upload
- `src/scripts/room/chat/controller.ts` — dispatch `musiki:recursos:chat-url` on URL messages

---

## Task 1: DB Migration — LiveClassResource table

**Files:**
- Create: `supabase/migrations/20260504120000_live_class_resources.sql`
- Create: `supabase/migrations/20260504120001_rls_live_class_resources.sql`

- [ ] **Step 1.1: Write the table migration**

```sql
-- supabase/migrations/20260504120000_live_class_resources.sql
-- Shared class resource list: files uploaded to R2 + links + auto-captured from chat/SA/ME.
-- One flat list per (claseId, roomName) session. Persisted via autosave from the Re pod.

CREATE TYPE "ResourceType" AS ENUM ('pdf', 'img', 'md', 'tex', 'ly', 'audio', 'link', 'other');
CREATE TYPE "ResourceSource" AS ENUM ('upload', 'chat', 'external-media', 'sa', 'sv', 'paste');

CREATE TABLE "LiveClassResource" (
  "id"          uuid              NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  "claseId"     text,
  "roomName"    text              NOT NULL,
  "url"         text              NOT NULL,
  "name"        text              NOT NULL DEFAULT '',
  "type"        "ResourceType"    NOT NULL DEFAULT 'other',
  "folder"      text              NOT NULL DEFAULT '',
  "source"      "ResourceSource"  NOT NULL DEFAULT 'upload',
  "createdBy"   text              NOT NULL DEFAULT '',
  "sortOrder"   integer           NOT NULL DEFAULT 0,
  "createdAt"   timestamptz       NOT NULL DEFAULT now()
);

CREATE INDEX "LiveClassResource_room_idx"
  ON "LiveClassResource" ("roomName", "claseId");
```

- [ ] **Step 1.2: Write the RLS migration**

```sql
-- supabase/migrations/20260504120001_rls_live_class_resources.sql
BEGIN;

ALTER TABLE public."LiveClassResource" ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public."LiveClassResource" FROM anon, authenticated;
GRANT ALL ON TABLE public."LiveClassResource" TO service_role;

DROP POLICY IF EXISTS "service_role_only" ON public."LiveClassResource";
CREATE POLICY "service_role_only"
  ON public."LiveClassResource"
  AS PERMISSIVE FOR ALL TO service_role
  USING (true) WITH CHECK (true);

COMMIT;
```

- [ ] **Step 1.3: Apply migrations**

```bash
cd /Users/zztt/projects/26-musiki/framework
supabase db push
```

Expected: migrations apply without error. If Supabase CLI is not set up locally, apply via Supabase dashboard SQL editor.

- [ ] **Step 1.4: Verify**

```bash
supabase db diff
```

Expected: no diff (migrations applied). Or confirm table exists in DB:
```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'LiveClassResource' ORDER BY ordinal_position;
```

- [ ] **Step 1.5: Commit**

```bash
git add supabase/migrations/20260504120000_live_class_resources.sql \
        supabase/migrations/20260504120001_rls_live_class_resources.sql
git commit -m "feat(db): add LiveClassResource table for Re pod"
```

---

## Task 2: R2 Upload API

**Files:**
- Create: `src/pages/api/room/recursos-upload.ts`

- [ ] **Step 2.1: Create the upload endpoint**

```typescript
// src/pages/api/room/recursos-upload.ts
import type { APIRoute } from 'astro';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { json } from '../../../lib/forum-server';
import { getR2BucketName, getR2Client, getR2PublicObjectUrl } from '../../../lib/r2';

const MAX_BYTES = 24 * 1024 * 1024;

// Block obviously dangerous executables; everything else is allowed
const BLOCKED_EXTS = new Set(['exe', 'sh', 'bat', 'cmd', 'msi', 'ps1', 'vbs', 'js', 'php']);

function guessExt(file: File): string {
  const m = String(file.name || '').match(/\.([a-z0-9]+)$/i);
  return m ? m[1].toLowerCase() : 'bin';
}

function guessType(ext: string): string {
  if (['pdf'].includes(ext)) return 'application/pdf';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) return 'image/' + (ext === 'jpg' ? 'jpeg' : ext);
  if (['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'].includes(ext)) return 'audio/' + ext;
  if (['md', 'tex', 'ly', 'txt'].includes(ext)) return 'text/plain';
  return file.type || 'application/octet-stream';
}

function buildKey(file: File, identity: string): string {
  const now = new Date();
  const y = String(now.getUTCFullYear());
  const mo = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  const ext = guessExt(file);
  const safe = String(identity || 'anon')
    .toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'anon';
  return `room/recursos/${y}/${mo}/${d}/${safe}-${crypto.randomUUID()}.${ext}`;
}

export const POST: APIRoute = async ({ request, locals }) => {
  const session = (locals as any).session;
  const email = typeof session?.user?.email === 'string' ? session.user.email.trim() : '';
  if (!email) return json({ error: 'Not authenticated' }, 401);

  try {
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return json({ error: 'No file provided.' }, 400);
    if (file.size <= 0) return json({ error: 'File is empty.' }, 400);
    if (file.size > MAX_BYTES) return json({ error: 'File exceeds 24 MB limit.' }, 413);

    const ext = guessExt(file);
    if (BLOCKED_EXTS.has(ext)) return json({ error: 'File type not allowed.' }, 415);

    const key = buildKey(file, email);
    const contentType = guessType(ext);

    await getR2Client().send(new PutObjectCommand({
      Bucket: getR2BucketName(),
      Key: key,
      Body: new Uint8Array(await file.arrayBuffer()),
      ContentType: contentType,
      CacheControl: 'public, max-age=31536000, immutable',
    }));

    return json({ success: true, url: getR2PublicObjectUrl(key), key, ext });
  } catch (e: any) {
    console.error('[recursos-upload]', e);
    if (String(e?.message || '').includes('R2_NOT_CONFIGURED'))
      return json({ error: 'R2 not configured.' }, 503);
    return json({ error: e?.message || 'Upload failed.' }, 500);
  }
};
```

- [ ] **Step 2.2: Test with curl**

```bash
# From project root, with dev server running:
curl -X POST http://localhost:4321/api/room/recursos-upload \
  -F "file=@/path/to/test.pdf" \
  -H "Cookie: <session-cookie>"
```

Expected: `{"success":true,"url":"https://...","key":"room/recursos/...","ext":"pdf"}`

- [ ] **Step 2.3: Commit**

```bash
git add src/pages/api/room/recursos-upload.ts
git commit -m "feat(api): add recursos-upload R2 endpoint"
```

---

## Task 3: Resources CRUD API

**Files:**
- Create: `src/pages/api/live/recursos.ts`

- [ ] **Step 3.1: Create GET + POST handlers**

```typescript
// src/pages/api/live/recursos.ts
import type { APIRoute } from 'astro';
import { cleanString, ensureDbUserFromSession, json } from '../../../lib/forum-server';
import { query } from '../../../lib/db/pool';

// GET /api/live/recursos?roomName=...&claseId=...
export const GET: APIRoute = async ({ request, locals, url }) => {
  const session = (locals as any).session;
  const user = await ensureDbUserFromSession(session);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  const roomName = cleanString(url.searchParams.get('roomName') ?? '', 120);
  const claseId  = cleanString(url.searchParams.get('claseId')  ?? '', 240) || null;
  if (!roomName) return json({ error: 'roomName required' }, 400);

  const params: any[] = [roomName];
  let sql = `SELECT id, "claseId", "roomName", url, name, type, folder, source, "createdBy", "sortOrder", "createdAt"
             FROM "LiveClassResource" WHERE "roomName" = $1`;
  if (claseId !== null) {
    params.push(claseId);
    sql += ` AND "claseId" = $${params.length}`;
  } else {
    sql += ` AND "claseId" IS NULL`;
  }
  sql += ` ORDER BY "sortOrder" ASC, "createdAt" ASC`;

  const result = await query(sql, params);
  if (result.error) return json({ error: result.error.message }, 500);
  return json({ items: result.data ?? [] });
};

// POST /api/live/recursos  body: { roomName, claseId, items: ResourceItem[] }
// Full replace: deletes all current items for (roomName, claseId), inserts new list.
export const POST: APIRoute = async ({ request, locals }) => {
  const session = (locals as any).session;
  const user = await ensureDbUserFromSession(session);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  let body: any = null;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const roomName = cleanString(String(body?.roomName ?? ''), 120);
  const claseId  = cleanString(String(body?.claseId  ?? ''), 240) || null;
  const items    = Array.isArray(body?.items) ? body.items : [];

  if (!roomName) return json({ error: 'roomName required' }, 400);

  // Delete existing for this room+clase, then bulk insert
  const deleteParams: any[] = [roomName];
  const deleteWhere = claseId === null
    ? `"roomName" = $1 AND "claseId" IS NULL`
    : `"roomName" = $1 AND "claseId" = $2`;
  if (claseId !== null) deleteParams.push(claseId);

  const delResult = await query(`DELETE FROM "LiveClassResource" WHERE ${deleteWhere}`, deleteParams);
  if (delResult.error) return json({ error: delResult.error.message }, 500);

  if (items.length === 0) return json({ ok: true, count: 0 });

  // Build bulk insert
  const VALID_TYPES   = ['pdf','img','md','tex','ly','audio','link','other'];
  const VALID_SOURCES = ['upload','chat','external-media','sa','sv','paste'];

  const rows = items.map((item: any, i: number) => ({
    id:          String(item.id || crypto.randomUUID()),
    claseId:     claseId,
    roomName:    roomName,
    url:         cleanString(String(item.url ?? ''), 2000),
    name:        cleanString(String(item.name ?? ''), 500) || 'recurso',
    type:        VALID_TYPES.includes(item.type) ? item.type : 'other',
    folder:      cleanString(String(item.folder ?? ''), 120),
    source:      VALID_SOURCES.includes(item.source) ? item.source : 'upload',
    createdBy:   cleanString(String(item.createdBy ?? ''), 120),
    sortOrder:   typeof item.sortOrder === 'number' ? item.sortOrder : i,
    createdAt:   item.createdAt ? new Date(item.createdAt).toISOString() : new Date().toISOString(),
  }));

  const cols = Object.keys(rows[0]);
  const colSql = cols.map(c => `"${c}"`).join(', ');
  let placeholderIdx = 1;
  const rowPlaceholders = rows.map(row => {
    const ph = cols.map(() => `$${placeholderIdx++}`).join(', ');
    return `(${ph})`;
  }).join(', ');
  const vals = rows.flatMap(row => Object.values(row));

  const insertResult = await query(
    `INSERT INTO "LiveClassResource" (${colSql}) VALUES ${rowPlaceholders}`,
    vals,
  );
  if (insertResult.error) return json({ error: insertResult.error.message }, 500);

  return json({ ok: true, count: rows.length });
};
```

- [ ] **Step 3.2: Test GET**

```bash
curl "http://localhost:4321/api/live/recursos?roomName=musiki-stage&claseId=i1/02-ac%C3%BAstica" \
  -H "Cookie: <session-cookie>"
```

Expected: `{"items":[]}`

- [ ] **Step 3.3: Test POST**

```bash
curl -X POST http://localhost:4321/api/live/recursos \
  -H "Content-Type: application/json" \
  -H "Cookie: <session-cookie>" \
  -d '{"roomName":"musiki-stage","claseId":"i1/test","items":[{"url":"https://example.com/test.pdf","name":"test","type":"pdf","folder":"","source":"upload","createdBy":"test@test.com","sortOrder":0}]}'
```

Expected: `{"ok":true,"count":1}`. Follow with GET to verify item exists.

- [ ] **Step 3.4: Commit**

```bash
git add src/pages/api/live/recursos.ts
git commit -m "feat(api): add /api/live/recursos GET+POST for Re pod"
```

---

## Task 4: Resolve Title API

**Files:**
- Create: `src/pages/api/live/recursos/resolve-title.ts`

- [ ] **Step 4.1: Create the endpoint**

```typescript
// src/pages/api/live/recursos/resolve-title.ts
// Server-side URL fetch to extract <title> and basic metadata.
// Used by the metadata.ts client module for CORS-blocked URLs.
import type { APIRoute } from 'astro';
import { json } from '../../../../lib/forum-server';

const TIMEOUT_MS = 6000;

function extractTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([^<]{1,300})<\/title>/i);
  return m ? m[1].trim().replace(/\s+/g, ' ') : null;
}

function extractOgTitle(html: string): string | null {
  const m = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']{1,300})["']/i)
         ?? html.match(/<meta[^>]+content=["']([^"']{1,300})["'][^>]+property=["']og:title["']/i);
  return m ? m[1].trim() : null;
}

export const GET: APIRoute = async ({ url, locals }) => {
  const session = (locals as any).session;
  if (!session?.user?.email) return json({ error: 'Not authenticated' }, 401);

  const targetUrl = url.searchParams.get('url') ?? '';
  if (!targetUrl.startsWith('http')) return json({ error: 'Invalid URL' }, 400);

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const resp = await fetch(targetUrl, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Musiki/1.0 (title-resolver)' },
    });
    clearTimeout(timer);

    if (!resp.ok) return json({ title: null, reason: `HTTP ${resp.status}` });

    const contentType = resp.headers.get('content-type') ?? '';
    if (!contentType.includes('text/html')) return json({ title: null, reason: 'not html' });

    // Read only first 32 KB — enough for <head>
    const reader = resp.body?.getReader();
    if (!reader) return json({ title: null, reason: 'no body' });
    let html = '';
    let done = false;
    while (!done && html.length < 32768) {
      const { value, done: d } = await reader.read();
      done = d;
      if (value) html += new TextDecoder().decode(value);
    }
    reader.cancel();

    const title = extractOgTitle(html) ?? extractTitle(html);
    return json({ title });
  } catch (e: any) {
    return json({ title: null, reason: e?.message ?? 'fetch failed' });
  }
};
```

- [ ] **Step 4.2: Test**

```bash
curl "http://localhost:4321/api/live/recursos/resolve-title?url=https://en.wikipedia.org/wiki/Acoustic_ecology" \
  -H "Cookie: <session-cookie>"
```

Expected: `{"title":"Acoustic ecology - Wikipedia"}`

- [ ] **Step 4.3: Commit**

```bash
git add src/pages/api/live/recursos/resolve-title.ts
git commit -m "feat(api): add resolve-title endpoint for Re pod metadata"
```

---

## Task 5: Compartidos History API

**Files:**
- Create: `src/pages/api/live/recursos/compartidos-history.ts`

- [ ] **Step 5.1: Create the endpoint**

This aggregates chat URLs and SA/SV uploads from the current session for retroactive `compartidos` population.

```typescript
// src/pages/api/live/recursos/compartidos-history.ts
import type { APIRoute } from 'astro';
import { cleanString, ensureDbUserFromSession, json } from '../../../../lib/forum-server';
import { query } from '../../../../lib/db/pool';

const URL_REGEX = /https?:\/\/[^\s"'<>(){}|\\^`\[\]]{4,}/gi;

export const GET: APIRoute = async ({ url, locals }) => {
  const session = (locals as any).session;
  const user = await ensureDbUserFromSession(session);
  if (!user) return json({ error: 'Not authenticated' }, 401);

  const roomName = cleanString(url.searchParams.get('roomName') ?? '', 120);
  if (!roomName) return json({ error: 'roomName required' }, 400);

  // 1. Chat messages with URLs from current session
  // LiveClassNote stores notes but not chat. Chat is ephemeral (LiveKit only).
  // We can only look at LiveClassResource items already saved with source='chat'|'sa'|'sv'|'external-media'.
  // This endpoint returns those existing items so the client can bootstrap compartidos.
  const result = await query(
    `SELECT id, url, name, type, folder, source, "createdBy", "sortOrder", "createdAt"
     FROM "LiveClassResource"
     WHERE "roomName" = $1
       AND source IN ('chat', 'sa', 'sv', 'external-media')
     ORDER BY "createdAt" ASC`,
    [roomName],
  );

  if (result.error) return json({ error: result.error.message }, 500);
  return json({ items: result.data ?? [] });
};
```

> **Note on chat URL history:** Chat messages are ephemeral (LiveKit data packets only, not persisted to DB). The `musiki:recursos:chat-url` event fires in real-time during the session; the Re controller saves those URLs immediately to the session state, which gets autosaved to `LiveClassResource`. The `compartidos-history` endpoint therefore serves only items already recorded in DB — a rejoining user gets what was saved, not a full chat replay. This is the correct behavior: chat history is not stored server-side.

- [ ] **Step 5.2: Test**

```bash
curl "http://localhost:4321/api/live/recursos/compartidos-history?roomName=musiki-stage" \
  -H "Cookie: <session-cookie>"
```

Expected: `{"items":[]}` (empty for fresh room, or list of previously captured compartidos items).

- [ ] **Step 5.3: Commit**

```bash
git add src/pages/api/live/recursos/compartidos-history.ts
git commit -m "feat(api): add compartidos-history endpoint for Re pod bootstrap"
```

---

## Task 6: metadata.ts — Author-year-title extraction

**Files:**
- Create: `src/scripts/room/recursos/metadata.ts`

- [ ] **Step 6.1: Write the module**

```typescript
// src/scripts/room/recursos/metadata.ts
// Pure functions for extracting Author-year-title display names from URLs and filenames.

export type ResourceType = 'pdf' | 'img' | 'md' | 'tex' | 'ly' | 'audio' | 'link' | 'other';

const EXT_TYPE_MAP: Record<string, ResourceType> = {
  pdf: 'pdf', jpg: 'img', jpeg: 'img', png: 'img', gif: 'img', webp: 'img', svg: 'img',
  md: 'md', markdown: 'md', tex: 'tex', ly: 'ly',
  mp3: 'audio', wav: 'audio', ogg: 'audio', m4a: 'audio', aac: 'audio', flac: 'audio',
};

export function typeFromExt(ext: string): ResourceType {
  return EXT_TYPE_MAP[ext.toLowerCase()] ?? 'other';
}

export function typeFromUrl(url: string): ResourceType {
  const ext = url.split('?')[0].split('#')[0].match(/\.([a-z0-9]+)$/i)?.[1] ?? '';
  if (ext) return typeFromExt(ext);
  if (/youtu\.be|youtube\.com|vimeo\.com/.test(url)) return 'link';
  return 'link';
}

export function slugify(text: string): string {
  return text
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/** Extract filename stem from a URL path */
export function stemFromUrl(url: string): string {
  const path = url.split('?')[0].split('#')[0];
  const parts = path.split('/');
  const last = parts[parts.length - 1] || parts[parts.length - 2] || '';
  return last.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]/g, ' ').trim();
}

/** Format a name candidate into Author-year-title slug.
 *  If parts cannot be inferred, returns a slugified version of the raw input. */
export function formatCandidateName(raw: string): string {
  return slugify(raw) || 'recurso';
}

/** Given a raw <title> from a page, produce Author-year-title if possible.
 *  Heuristic: look for year patterns like (2012) or - 2012 - */
export function nameFromPageTitle(title: string): string {
  const yearMatch = title.match(/\b(19|20)\d{2}\b/);
  const year = yearMatch ? yearMatch[0] : '';
  const clean = title.replace(/\s*[-|–—]\s*[^-|–—]*$/, '').trim(); // strip trailing site name
  const slug = slugify(year ? clean.replace(year, '').trim() : clean);
  return year ? `${slug}-${year}` : slug;
}

/** Detect DOI in a URL or text */
export function extractDoi(input: string): string | null {
  const m = input.match(/\b10\.\d{4,}\/[^\s"'<>]+/i);
  return m ? m[0] : null;
}

/** Detect arXiv ID in a URL */
export function extractArxivId(url: string): string | null {
  const m = url.match(/arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5}(?:v\d+)?)/i);
  return m ? m[1] : null;
}

/** Detect YouTube/Vimeo */
export function isVideoUrl(url: string): boolean {
  return /youtu\.be|youtube\.com|vimeo\.com/.test(url);
}

/** Detect Open Library / Google Books */
export function isBookUrl(url: string): boolean {
  return /openlibrary\.org|books\.google\.com/.test(url);
}

/**
 * Best-effort synchronous name from a URL alone (no network).
 * Used as immediate placeholder while async resolution is in flight.
 */
export function quickNameFromUrl(url: string): string {
  const stem = stemFromUrl(url);
  if (stem && stem.length > 3) return formatCandidateName(stem);
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return formatCandidateName(host);
  } catch {
    return 'recurso';
  }
}

/**
 * Fetch metadata for a URL via the server proxy and return a resolved name.
 * Falls back to quickNameFromUrl if fetch fails.
 */
export async function resolveNameFromUrl(url: string): Promise<string> {
  // Fast path: known URL shapes
  const doi = extractDoi(url);
  if (doi) {
    try {
      const resp = await fetch(`https://doi.org/${doi}`, {
        headers: { Accept: 'application/vnd.citationstyles.csl+json' },
      });
      if (resp.ok) {
        const data = await resp.json();
        const author = (data?.author?.[0]?.family ?? '').slice(0, 30);
        const year   = String(data?.issued?.['date-parts']?.[0]?.[0] ?? '');
        const title  = slugify((data?.title ?? '').slice(0, 60));
        if (author && title) return `${slugify(author)}-${year}-${title}`;
      }
    } catch { /* fall through */ }
  }

  const arxiv = extractArxivId(url);
  if (arxiv) {
    try {
      const resp = await fetch(`https://export.arxiv.org/abs/${arxiv}`, { headers: { Accept: 'application/atom+xml' } });
      if (resp.ok) {
        const xml = await resp.text();
        const title = xml.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() ?? '';
        const year  = arxiv.slice(0, 2); // "2312" → year hint
        const fullYear = Number(year) > 50 ? `19${year}` : `20${year}`;
        if (title) return slugify(title.slice(0, 60)) + (fullYear ? `-${fullYear}` : '');
      }
    } catch { /* fall through */ }
  }

  // Generic: ask server to fetch <title>
  try {
    const resp = await fetch(`/api/live/recursos/resolve-title?url=${encodeURIComponent(url)}`);
    if (resp.ok) {
      const data = await resp.json();
      if (data.title) return nameFromPageTitle(data.title);
    }
  } catch { /* fall through */ }

  return quickNameFromUrl(url);
}

/**
 * Name a file from its File object.
 * Tries to extract readable stem; applies Author-year-title slugging.
 */
export function nameFromFile(file: File): string {
  const stem = file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
  return formatCandidateName(stem);
}
```

- [ ] **Step 6.2: Verify module compiles**

```bash
cd /Users/zztt/projects/26-musiki/framework
npx tsc --noEmit src/scripts/room/recursos/metadata.ts 2>&1 | head -20
```

Expected: no errors (or only "cannot find module" for missing files — those come later).

- [ ] **Step 6.3: Commit**

```bash
git add src/scripts/room/recursos/metadata.ts
git commit -m "feat(recursos): add Author-year-title metadata extraction"
```

---

## Task 7: filetree.ts — Tree data model + DOM render

**Files:**
- Create: `src/scripts/room/recursos/filetree.ts`

- [ ] **Step 7.1: Write the module**

```typescript
// src/scripts/room/recursos/filetree.ts
import { type ResourceType } from './metadata';

export type ResourceItem = {
  id: string;
  url: string;
  name: string;
  type: ResourceType | 'other';
  folder: string;   // '' = root, 'compartidos' = auto folder, 'foo' = user folder
  source: 'upload' | 'chat' | 'external-media' | 'sa' | 'sv' | 'paste';
  createdBy: string;
  sortOrder: number;
  createdAt: string;
};

/** Icon character + CSS color for each resource type */
const TYPE_ICON: Record<string, { char: string; color: string }> = {
  pdf:   { char: '■', color: '#e06666' },
  img:   { char: '▪', color: '#76d3ff' },
  md:    { char: '■', color: '#45d384' },
  tex:   { char: '■', color: '#f6b26b' },
  ly:    { char: '♩', color: '#ffd966' },
  audio: { char: '♪', color: '#93c47d' },
  link:  { char: '⬡', color: '#8e7cc3' },
  other: { char: '·', color: '#666'    },
};

function iconFor(type: string): { char: string; color: string } {
  return TYPE_ICON[type] ?? TYPE_ICON.other;
}

/** Return unique folder names, with 'compartidos' always first */
export function foldersFromItems(items: ResourceItem[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  // compartidos first if it has items or exists
  if (items.some(i => i.folder === 'compartidos')) {
    seen.add('compartidos');
    result.push('compartidos');
  }
  for (const item of items) {
    if (item.folder && item.folder !== 'compartidos' && !seen.has(item.folder)) {
      seen.add(item.folder);
      result.push(item.folder);
    }
  }
  return result;
}

/** Items belonging to a specific folder (or root if folder === '') */
export function itemsInFolder(items: ResourceItem[], folder: string): ResourceItem[] {
  return items
    .filter(i => i.folder === folder)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt));
}

/** Move item to a different folder, reassigning sortOrder to end of target folder */
export function moveItem(items: ResourceItem[], id: string, targetFolder: string): ResourceItem[] {
  const targetItems = items.filter(i => i.folder === targetFolder);
  const maxOrder = targetItems.reduce((m, i) => Math.max(m, i.sortOrder), -1);
  return items.map(item =>
    item.id === id
      ? { ...item, folder: targetFolder, sortOrder: maxOrder + 1 }
      : item
  );
}

/** Remove item by id */
export function removeItem(items: ResourceItem[], id: string): ResourceItem[] {
  return items.filter(i => i.id !== id);
}

/** Add item, deduplicating by URL */
export function addItem(items: ResourceItem[], item: ResourceItem): ResourceItem[] {
  if (items.some(i => i.url === item.url)) return items;
  return [...items, item];
}

/** Render the full filetree into the container element */
export function renderFiletree(
  container: HTMLElement,
  items: ResourceItem[],
  collapsedFolders: Set<string>,
  options: {
    onItemClick: (item: ResourceItem) => void;
    onItemContextMenu: (item: ResourceItem, e: MouseEvent) => void;
    onFolderContextMenu: (folder: string, e: MouseEvent) => void;
    onFolderToggle: (folder: string) => void;
    onDragStart: (id: string) => void;
    onDragOverFolder: (folder: string) => void;
    onDrop: (targetFolder: string) => void;
  },
) {
  container.innerHTML = '';

  const folders = foldersFromItems(items);

  // Render each folder
  for (const folder of folders) {
    const isCollapsed = collapsedFolders.has(folder);
    const isAuto = folder === 'compartidos';
    const folderEl = document.createElement('div');
    folderEl.className = 're-folder';
    folderEl.dataset.folder = folder;

    const rowEl = document.createElement('div');
    rowEl.className = 're-folder-row';
    rowEl.innerHTML = `
      <span class="re-caret">${isCollapsed ? '▸' : '▾'}</span>
      <span class="re-folder-icon">${isAuto ? '📂' : '📁'}</span>
      <span class="re-folder-name${isAuto ? ' re-folder-name--auto' : ''}">${escHtml(folder)}</span>
    `;
    rowEl.addEventListener('click', () => options.onFolderToggle(folder));
    rowEl.addEventListener('contextmenu', (e) => { e.preventDefault(); options.onFolderContextMenu(folder, e); });
    rowEl.addEventListener('dragover', (e) => { e.preventDefault(); options.onDragOverFolder(folder); });
    rowEl.addEventListener('drop', (e) => { e.preventDefault(); options.onDrop(folder); });
    folderEl.appendChild(rowEl);

    if (!isCollapsed) {
      const childrenEl = document.createElement('div');
      childrenEl.className = 're-folder-items';
      const folderItems = itemsInFolder(items, folder);
      for (const item of folderItems) {
        childrenEl.appendChild(buildItemEl(item, options));
      }
      folderEl.appendChild(childrenEl);
    }

    container.appendChild(folderEl);
  }

  // Root-level items (folder === '')
  const rootItems = itemsInFolder(items, '');
  for (const item of rootItems) {
    container.appendChild(buildItemEl(item, options));
  }

  // Drop zone hint (always visible at bottom)
  const hint = document.createElement('div');
  hint.className = 're-drop-hint';
  hint.textContent = 'drop files · toda el área es drop zone';
  container.appendChild(hint);
}

function buildItemEl(
  item: ResourceItem,
  options: Parameters<typeof renderFiletree>[3],
): HTMLElement {
  const { char, color } = iconFor(item.type);
  const el = document.createElement('div');
  el.className = 're-item';
  el.dataset.itemId = item.id;
  el.draggable = true;
  el.innerHTML = `
    <span class="re-item-icon" style="color:${color}">${char}</span>
    <span class="re-item-name" title="${escHtml(item.url)}">${escHtml(item.name)}</span>
  `;
  el.addEventListener('click', () => options.onItemClick(item));
  el.addEventListener('contextmenu', (e) => { e.preventDefault(); options.onItemContextMenu(item, e); });
  el.addEventListener('dragstart', () => options.onDragStart(item.id));
  return el;
}

function escHtml(s: string): string {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
```

- [ ] **Step 7.2: Verify compiles**

```bash
npx tsc --noEmit src/scripts/room/recursos/filetree.ts 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 7.3: Commit**

```bash
git add src/scripts/room/recursos/filetree.ts
git commit -m "feat(recursos): add filetree data model and DOM render"
```

---

## Task 8: RecursosPanel.astro + recursos.css

**Files:**
- Create: `src/components/room/panels/recursos/RecursosPanel.astro`
- Create: `src/components/room/panels/recursos/recursos.css`

- [ ] **Step 8.1: Create the Astro panel**

```astro
---
// src/components/room/panels/recursos/RecursosPanel.astro
import './recursos.css';
---
<div class="musiki-pod" data-pod="recursos" data-pod-title="Re" data-re-dropzone>

  <div class="re-pod">

    <!-- Toolbar -->
    <div class="musiki-pod-toolbar re-toolbar">
      <span class="re-label">Re</span>
      <span class="re-clase-name" data-re-clase-name></span>
    </div>

    <!-- Drop overlay (visible on dragenter) -->
    <div class="re-drop-overlay" data-re-drop-overlay aria-hidden="true">
      <span class="re-drop-label">soltar archivos aquí</span>
    </div>

    <!-- Context menu -->
    <div class="re-ctx-menu" data-re-ctx-menu hidden>
      <button type="button" class="re-ctx-item" data-re-ctx-rename>Renombrar</button>
      <button type="button" class="re-ctx-item" data-re-ctx-move>Mover a…</button>
      <button type="button" class="re-ctx-item re-ctx-item--danger" data-re-ctx-delete>Borrar</button>
    </div>

    <!-- Rename input (inline) -->
    <div class="re-rename-bar" data-re-rename-bar hidden>
      <input type="text" class="re-rename-input" data-re-rename-input autocomplete="off" />
      <button type="button" class="musiki-pod-btn re-rename-ok" data-re-rename-ok>✓</button>
      <button type="button" class="musiki-pod-btn re-rename-cancel" data-re-rename-cancel>✕</button>
    </div>

    <!-- Filetree -->
    <div class="re-content" data-re-content></div>

    <!-- Export popover -->
    <div class="re-export-popover" data-re-export-popover hidden>
      <span class="re-export-label">guardar como</span>
      <input type="text" class="re-export-input" data-re-export-input autocomplete="off" />
      <button type="button" class="musiki-pod-btn musiki-pod-btn--accent" data-re-export-ok>Guardar</button>
      <button type="button" class="musiki-pod-btn" data-re-export-cancel>✕</button>
    </div>

    <!-- Bottom bar -->
    <div class="musiki-pod-toolbar re-bottombar">
      <button type="button" class="musiki-pod-btn re-bb-btn" data-re-fold title="Plegar/desplegar todo">⊟</button>
      <button type="button" class="musiki-pod-btn re-bb-btn" data-re-new-folder title="Nueva carpeta">+ folder</button>
      <button type="button" class="musiki-pod-btn re-bb-btn" data-re-paste title="Pegar clipboard">⎘</button>
      <div style="flex:1;"></div>
      <!-- Teacher-only collab toggle -->
      <button
        type="button"
        class="musiki-pod-btn re-bb-btn re-collab-btn"
        data-re-collab
        data-active="false"
        data-teacher-only
        title="Permitir a estudiantes agregar recursos (desactivado)"
        style="display:none;"
      >
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" width="13" height="13" aria-hidden="true">
          <path d="M5.5 5.5a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5ZM1.5 14.5c0-2 1.5-3.5 3.5-3.5h1c2 0 3.5 1.5 3.5 3.5M10.5 5.5a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5Z"/>
        </svg>
      </button>
      <button type="button" class="musiki-pod-btn re-bb-btn re-export-btn" data-re-export title="Exportar / renombrar .md">E</button>
    </div>

  </div>
</div>
```

- [ ] **Step 8.2: Create the CSS**

```css
/* src/components/room/panels/recursos/recursos.css */

.musiki-pod[data-pod="recursos"] {
  height: 100%;
  display: flex;
  flex-direction: column;
  position: relative;
}

.re-pod {
  display: flex;
  flex-direction: column;
  height: 100%;
  position: relative;
}

/* Toolbar */
.re-toolbar {
  flex-shrink: 0;
}

.re-label {
  font-weight: bold;
  color: var(--musiki-accent, #45d384);
  font-size: 11px;
  letter-spacing: 0.05em;
}

.re-clase-name {
  font-size: 10px;
  color: var(--musiki-muted, #555);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 160px;
}

/* Drop overlay */
.re-drop-overlay {
  position: absolute;
  inset: 0;
  background: rgba(69,211,132,.08);
  border: 1px dashed #45d384;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 20;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.1s;
}

.re-drop-overlay[data-active="true"] {
  opacity: 1;
}

.re-drop-label {
  font-size: 11px;
  color: #45d384;
}

/* Filetree content */
.re-content {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}

/* Folders */
.re-folder-row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  cursor: pointer;
  user-select: none;
}

.re-folder-row:hover {
  background: rgba(255,255,255,.04);
}

.re-folder-row[data-drag-over="true"] {
  background: rgba(69,211,132,.12);
}

.re-caret {
  color: #555;
  font-size: 9px;
  width: 8px;
  flex-shrink: 0;
}

.re-folder-icon {
  font-size: 11px;
  flex-shrink: 0;
}

.re-folder-name {
  font-size: 11px;
  color: #aaa;
}

.re-folder-name--auto {
  color: #6fa8dc;
  font-style: italic;
}

.re-folder-items {
  margin-left: 20px;
}

/* Items */
.re-item {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 2px 8px;
  cursor: pointer;
  border-radius: 2px;
}

.re-item:hover {
  background: rgba(255,255,255,.04);
}

.re-item-icon {
  font-size: 10px;
  width: 14px;
  text-align: center;
  flex-shrink: 0;
}

.re-item-name {
  font-size: 11px;
  color: #bbb;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 200px;
}

.re-drop-hint {
  font-size: 9px;
  color: #2e2e2e;
  text-align: center;
  padding: 8px;
  margin: 4px 8px;
  border: 1px dashed #222;
  border-radius: 3px;
}

/* Context menu */
.re-ctx-menu {
  position: fixed;
  background: #1a1a1a;
  border: 1px solid #333;
  border-radius: 4px;
  z-index: 100;
  min-width: 140px;
  padding: 2px 0;
  box-shadow: 0 4px 16px rgba(0,0,0,.5);
}

.re-ctx-item {
  display: block;
  width: 100%;
  padding: 5px 12px;
  font-size: 11px;
  color: #ccc;
  background: none;
  border: none;
  text-align: left;
  cursor: pointer;
  font-family: inherit;
}

.re-ctx-item:hover {
  background: rgba(255,255,255,.06);
}

.re-ctx-item--danger {
  color: #e06666;
}

/* Rename bar */
.re-rename-bar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-top: 1px solid #2a2a2a;
  flex-shrink: 0;
}

.re-rename-input {
  flex: 1;
  background: #111;
  border: 1px solid #333;
  border-radius: 3px;
  color: #ccc;
  font-size: 11px;
  padding: 2px 6px;
  font-family: inherit;
}

/* Export popover */
.re-export-popover {
  position: absolute;
  bottom: 36px;
  right: 0;
  left: 0;
  background: #1a1a1a;
  border: 1px solid #333;
  border-radius: 4px;
  padding: 8px;
  display: flex;
  align-items: center;
  gap: 6px;
  z-index: 30;
}

.re-export-label {
  font-size: 10px;
  color: #666;
  white-space: nowrap;
}

.re-export-input {
  flex: 1;
  background: #111;
  border: 1px solid #333;
  border-radius: 3px;
  color: #ccc;
  font-size: 11px;
  padding: 2px 6px;
  font-family: inherit;
}

/* Bottom bar */
.re-bottombar {
  flex-shrink: 0;
  border-top: 1px solid #2a2a2a;
}

.re-bb-btn {
  font-size: 10px;
}

.re-collab-btn[data-active="true"] {
  color: #45d384;
  border-color: #2a4a38;
}

/* Drag state */
[data-re-dropzone][data-dragging="true"] .re-drop-overlay {
  opacity: 1;
  pointer-events: auto;
}
```

- [ ] **Step 8.3: Commit**

```bash
git add src/components/room/panels/recursos/RecursosPanel.astro \
        src/components/room/panels/recursos/recursos.css
git commit -m "feat(recursos): add RecursosPanel HTML and CSS"
```

---

## Task 9: controller.ts — Main pod controller

**Files:**
- Create: `src/scripts/room/recursos/controller.ts`

- [ ] **Step 9.1: Scaffold class + types**

```typescript
// src/scripts/room/recursos/controller.ts
import {
  type ResourceItem,
  renderFiletree,
  addItem,
  removeItem,
  moveItem,
  foldersFromItems,
  itemsInFolder,
} from './filetree';
import {
  typeFromUrl,
  nameFromFile,
  quickNameFromUrl,
  resolveNameFromUrl,
} from './metadata';

type RecursosOptions = {
  container: HTMLElement;
  isTeacher: boolean;
  getCourseId: () => string | null;
  getRoomName: () => string | null;
  getIdentity: () => string;
  publish: (msg: RecursosMessage) => void;
};

type RecursosMessage =
  | { type: 'recursos:sync'; items: ResourceItem[]; allowStudents: boolean }
  | { type: 'recursos:allow-students'; allow: boolean };

export class RecursosController {
  private container: HTMLElement;
  private isTeacher: boolean;
  private getCourseId: () => string | null;
  private getRoomName: () => string | null;
  private getIdentity: () => string;
  private publish: (msg: RecursosMessage) => void;

  private items: ResourceItem[] = [];
  private allowStudents = false;
  private collapsedFolders = new Set<string>();
  private draggedItemId: string | null = null;
  private autosaveTimer: ReturnType<typeof setTimeout> | null = null;
  private longPressTimer: ReturnType<typeof setTimeout> | null = null;
  private ctxTargetItem: ResourceItem | null = null;
  private ctxTargetFolder: string | null = null;

  // DOM elements
  private contentEl!: HTMLElement;
  private claseNameEl!: HTMLElement;
  private dropOverlayEl!: HTMLElement;
  private ctxMenuEl!: HTMLElement;
  private ctxRenameBtn!: HTMLButtonElement;
  private ctxMoveBtn!: HTMLButtonElement;
  private ctxDeleteBtn!: HTMLButtonElement;
  private renameBarEl!: HTMLElement;
  private renameInputEl!: HTMLInputElement;
  private exportPopoverEl!: HTMLElement;
  private exportInputEl!: HTMLInputElement;
  private collabBtn!: HTMLButtonElement;
  private foldBtn!: HTMLButtonElement;
  private newFolderBtn!: HTMLButtonElement;
  private pasteBtn!: HTMLButtonElement;
  private exportBtn!: HTMLButtonElement;

  constructor(opts: RecursosOptions) {
    this.container = opts.container;
    this.isTeacher = opts.isTeacher;
    this.getCourseId = opts.getCourseId;
    this.getRoomName = opts.getRoomName;
    this.getIdentity = opts.getIdentity;
    this.publish = opts.publish;
    this.bindElements();
    this.bindEvents();
    void this.bootstrap();
  }
```

- [ ] **Step 9.2: Add bindElements + bootstrap**

Append to `controller.ts` (inside class, before closing `}`):

```typescript
  private bindElements() {
    const q = <T extends HTMLElement>(sel: string) =>
      this.container.querySelector<T>(sel)!;

    this.contentEl      = q('[data-re-content]');
    this.claseNameEl    = q('[data-re-clase-name]');
    this.dropOverlayEl  = q('[data-re-drop-overlay]');
    this.ctxMenuEl      = q('[data-re-ctx-menu]');
    this.ctxRenameBtn   = q('[data-re-ctx-rename]');
    this.ctxMoveBtn     = q('[data-re-ctx-move]');
    this.ctxDeleteBtn   = q('[data-re-ctx-delete]');
    this.renameBarEl    = q('[data-re-rename-bar]');
    this.renameInputEl  = q('[data-re-rename-input]');
    this.exportPopoverEl = q('[data-re-export-popover]');
    this.exportInputEl  = q('[data-re-export-input]');
    this.collabBtn      = q('[data-re-collab]');
    this.foldBtn        = q('[data-re-fold]');
    this.newFolderBtn   = q('[data-re-new-folder]');
    this.pasteBtn       = q('[data-re-paste]');
    this.exportBtn      = q('[data-re-export]');

    // Show collab btn to teacher only
    if (this.isTeacher) this.collabBtn.style.display = '';
  }

  private async bootstrap() {
    const roomName = this.getRoomName() ?? '';
    const claseId  = this.getCourseId();
    if (!roomName) return;

    try {
      const params = new URLSearchParams({ roomName });
      if (claseId) params.set('claseId', claseId);
      else params.set('claseId', '');

      const resp = await fetch(`/api/live/recursos?${params}`);
      if (!resp.ok) return;
      const data = await resp.json();
      this.items = Array.isArray(data.items) ? data.items : [];
    } catch { /* network error — start empty */ }

    // Also load compartidos history
    try {
      const resp = await fetch(`/api/live/recursos/compartidos-history?roomName=${encodeURIComponent(roomName)}`);
      if (resp.ok) {
        const data = await resp.json();
        for (const item of (data.items ?? [])) {
          this.items = addItem(this.items, item);
        }
      }
    } catch { /* non-fatal */ }

    this.render();
  }
```

- [ ] **Step 9.3: Add bindEvents (LiveKit receive, clase change, autosave)**

```typescript
  private bindEvents() {
    // LiveKit incoming
    window.addEventListener('musiki:recursos:receive', (e: Event) => {
      const ev = e as CustomEvent<RecursosMessage>;
      this.applyRemoteMessage(ev.detail);
    });

    // Clase context change
    window.addEventListener('musiki:clase-presentation-changed', (e: Event) => {
      const ev = e as CustomEvent<{ lessonId: string | null }>;
      const name = ev.detail?.lessonId?.split('/').slice(-2).join(' / ') ?? '';
      this.claseNameEl.textContent = name;
    });

    // Autosave on page hide/close
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.flushSave();
    });
    window.addEventListener('beforeunload', () => this.flushSave());

    // compartidos: SA upload
    window.addEventListener('musiki:recursos:sa-uploaded', (e: Event) => {
      const ev = e as CustomEvent<{ url: string; name: string }>;
      this.addCompartido(ev.detail.url, ev.detail.name, 'sa');
    });

    // compartidos: chat URL
    window.addEventListener('musiki:recursos:chat-url', (e: Event) => {
      const ev = e as CustomEvent<{ url: string }>;
      this.addCompartido(ev.detail.url, quickNameFromUrl(ev.detail.url), 'chat');
      // async resolve better name
      void resolveNameFromUrl(ev.detail.url).then(name => {
        this.items = this.items.map(i => i.url === ev.detail.url ? { ...i, name } : i);
        this.render();
        this.scheduleAutosave();
      });
    });

    // compartidos: external-media
    window.addEventListener('musiki:recursos:external-media', (e: Event) => {
      const ev = e as CustomEvent<{ url: string; name: string }>;
      this.addCompartido(ev.detail.url, ev.detail.name || quickNameFromUrl(ev.detail.url), 'external-media');
    });

    // Bottom bar buttons
    this.foldBtn.addEventListener('click', () => this.toggleFoldAll());
    this.newFolderBtn.addEventListener('click', () => this.createFolder());
    this.pasteBtn.addEventListener('click', () => void this.pasteClipboard());
    this.exportBtn.addEventListener('click', () => this.toggleExportPopover());
    this.collabBtn.addEventListener('click', () => this.toggleAllowStudents());

    // Export popover
    this.exportInputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void this.doExport();
      if (e.key === 'Escape') this.closeExportPopover();
    });
    this.container.querySelector('[data-re-export-ok]')!.addEventListener('click', () => void this.doExport());
    this.container.querySelector('[data-re-export-cancel]')!.addEventListener('click', () => this.closeExportPopover());

    // Context menu buttons
    this.ctxRenameBtn.addEventListener('click', () => this.startRename());
    this.ctxDeleteBtn.addEventListener('click', () => this.deleteCtxTarget());
    this.ctxMoveBtn.addEventListener('click', () => this.showMoveSubmenu());

    // Rename bar
    this.renameInputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.confirmRename();
      if (e.key === 'Escape') this.closeRename();
    });
    this.container.querySelector('[data-re-rename-ok]')!.addEventListener('click', () => this.confirmRename());
    this.container.querySelector('[data-re-rename-cancel]')!.addEventListener('click', () => this.closeRename());

    // Close ctx menu on outside click
    document.addEventListener('click', (e) => {
      if (!this.ctxMenuEl.contains(e.target as Node)) this.closeCtxMenu();
    });

    // Drag-and-drop file upload (whole pod is drop zone)
    this.container.addEventListener('dragenter', (e) => {
      if (e.dataTransfer?.types.includes('Files')) {
        e.preventDefault();
        this.dropOverlayEl.dataset.active = 'true';
      }
    });
    this.container.addEventListener('dragleave', (e) => {
      if (!this.container.contains(e.relatedTarget as Node)) {
        this.dropOverlayEl.dataset.active = 'false';
      }
    });
    this.container.addEventListener('dragover', (e) => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
    });
    this.container.addEventListener('drop', (e) => {
      e.preventDefault();
      this.dropOverlayEl.dataset.active = 'false';
      const files = Array.from(e.dataTransfer?.files ?? []);
      for (const file of files) void this.uploadFile(file);
    });

    // Touch long-press for context menu
    this.contentEl.addEventListener('touchstart', (e) => {
      const el = (e.target as Element).closest('[data-item-id]');
      if (!el) return;
      this.longPressTimer = setTimeout(() => {
        const id = (el as HTMLElement).dataset.itemId!;
        const item = this.items.find(i => i.id === id);
        if (item) this.openItemCtxMenu(item, { clientX: e.touches[0].clientX, clientY: e.touches[0].clientY } as MouseEvent);
      }, 500);
    }, { passive: true });
    this.contentEl.addEventListener('touchend', () => {
      if (this.longPressTimer) { clearTimeout(this.longPressTimer); this.longPressTimer = null; }
    }, { passive: true });
  }
```

- [ ] **Step 9.4: Add action methods (upload, paste, sync, export)**

```typescript
  private canEdit(): boolean {
    return this.isTeacher || this.allowStudents;
  }

  private addCompartido(url: string, name: string, source: ResourceItem['source']) {
    if (!url) return;
    const newItem: ResourceItem = {
      id: crypto.randomUUID(),
      url,
      name,
      type: typeFromUrl(url),
      folder: 'compartidos',
      source,
      createdBy: this.getIdentity(),
      sortOrder: Date.now(),
      createdAt: new Date().toISOString(),
    };
    this.items = addItem(this.items, newItem);
    this.render();
    this.scheduleAutosave();
    this.broadcastSync();
  }

  private async uploadFile(file: File) {
    if (!this.canEdit()) return;
    const form = new FormData();
    form.append('file', file);
    try {
      const resp = await fetch('/api/room/recursos-upload', { method: 'POST', body: form });
      if (!resp.ok) { console.error('[Re] upload failed', resp.status); return; }
      const data = await resp.json();
      const name = nameFromFile(file);
      const newItem: ResourceItem = {
        id: crypto.randomUUID(),
        url: data.url,
        name,
        type: typeFromUrl(data.url),
        folder: '',
        source: 'upload',
        createdBy: this.getIdentity(),
        sortOrder: Date.now(),
        createdAt: new Date().toISOString(),
      };
      this.items = addItem(this.items, newItem);
      this.render();
      this.scheduleAutosave();
      this.broadcastSync();
      // Async: resolve better name
      void resolveNameFromUrl(data.url).then(resolved => {
        this.items = this.items.map(i => i.id === newItem.id ? { ...i, name: resolved } : i);
        this.render();
        this.scheduleAutosave();
      });
    } catch (e) { console.error('[Re] upload error', e); }
  }

  private async pasteClipboard() {
    if (!this.canEdit()) return;
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) return;
      if (/^https?:\/\//i.test(text.trim())) {
        const url = text.trim();
        const name = quickNameFromUrl(url);
        const item: ResourceItem = {
          id: crypto.randomUUID(),
          url,
          name,
          type: typeFromUrl(url),
          folder: '',
          source: 'paste',
          createdBy: this.getIdentity(),
          sortOrder: Date.now(),
          createdAt: new Date().toISOString(),
        };
        this.items = addItem(this.items, item);
        this.render();
        this.scheduleAutosave();
        this.broadcastSync();
        void resolveNameFromUrl(url).then(resolved => {
          this.items = this.items.map(i => i.id === item.id ? { ...i, name: resolved } : i);
          this.render();
          this.scheduleAutosave();
        });
      }
    } catch { /* clipboard read denied */ }
  }

  private broadcastSync() {
    this.publish({ type: 'recursos:sync', items: this.items, allowStudents: this.allowStudents });
  }

  applyRemoteMessage(msg: RecursosMessage) {
    if (msg.type === 'recursos:sync') {
      this.items = msg.items;
      this.allowStudents = msg.allowStudents;
      this.updateCollabBtn();
      this.render();
    } else if (msg.type === 'recursos:allow-students') {
      this.allowStudents = msg.allow;
      this.updateCollabBtn();
    }
  }

  private scheduleAutosave() {
    if (this.autosaveTimer) clearTimeout(this.autosaveTimer);
    this.autosaveTimer = setTimeout(() => void this.save(), 5000);
  }

  private async save() {
    const roomName = this.getRoomName() ?? '';
    if (!roomName) return;
    const claseId = this.getCourseId();
    try {
      await fetch('/api/live/recursos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomName, claseId, items: this.items }),
      });
    } catch { /* non-fatal */ }
  }

  private flushSave() {
    const roomName = this.getRoomName() ?? '';
    if (!roomName) return;
    const payload = JSON.stringify({ roomName, claseId: this.getCourseId(), items: this.items });
    navigator.sendBeacon('/api/live/recursos', new Blob([payload], { type: 'application/json' }));
  }

  private async doExport() {
    const filename = this.exportInputEl.value.trim() || this.defaultExportFilename();
    const claseId = this.getCourseId();
    const md = this.buildMarkdown(filename, claseId);
    const courseId = claseId?.split('/')?.[0] ?? '';
    const targetPath = claseId
      ? `${claseId}/${filename}`
      : `public/recursos/${filename}`;
    try {
      const resp = await fetch('/api/content-admin/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseId, targetPath, content: md, mode: 'create', editSummary: 'Re pod export' }),
      });
      if (!resp.ok) console.error('[Re] export failed', resp.status);
    } catch (e) { console.error('[Re] export error', e); }
    this.closeExportPopover();
  }

  private defaultExportFilename(): string {
    const claseId = this.getCourseId();
    if (claseId) {
      const slug = claseId.split('/').pop() ?? 'clase';
      return `recursos-${slug}.md`;
    }
    const date = new Date().toISOString().slice(0, 10);
    return `recursos-${date}.md`;
  }

  private buildMarkdown(filename: string, claseId: string | null): string {
    const title = filename.replace(/\.md$/, '').replace(/-/g, ' ');
    const folders = ['compartidos', ...foldersFromItems(this.items).filter(f => f !== 'compartidos')];
    const rootItems = itemsInFolder(this.items, '');

    // ASCII filetree
    const treeLines: string[] = ['recursos/'];
    const folderLines = folders.filter(f => itemsInFolder(this.items, f).length > 0);
    folderLines.forEach((folder, fi) => {
      const items = itemsInFolder(this.items, folder);
      const isLast = fi === folderLines.length - 1 && rootItems.length === 0;
      treeLines.push(`${isLast ? '└──' : '├──'} ${folder}/`);
      items.forEach((item, ii) => {
        const isLastItem = ii === items.length - 1;
        treeLines.push(`${isLast ? '    ' : '│   '}${isLastItem ? '└──' : '├──'} [${item.type}] ${item.name}`);
      });
    });
    rootItems.forEach((item, ii) => {
      treeLines.push(`${ii === rootItems.length - 1 ? '└──' : '├──'} ${item.name}`);
    });

    let md = `---\ntitle: Recursos — ${title}\n${claseId ? `claseId: ${claseId}\n` : ''}updatedAt: ${new Date().toISOString()}\n---\n\n## Recursos — ${title}\n\n\`\`\`\n${treeLines.join('\n')}\n\`\`\`\n`;

    for (const folder of folderLines) {
      const items = itemsInFolder(this.items, folder);
      md += `\n## ${folder}\n\n`;
      for (const item of items) {
        md += `- [${item.name}](${item.url}) — *${item.source}*\n`;
      }
    }
    if (rootItems.length > 0) {
      md += `\n## raíz\n\n`;
      for (const item of rootItems) {
        md += `- [${item.name}](${item.url}) — *${item.source}*\n`;
      }
    }
    return md;
  }
```

- [ ] **Step 9.5: Add UI helpers (render, fold, folder, ctx menu, rename)**

```typescript
  private render() {
    renderFiletree(this.contentEl, this.items, this.collapsedFolders, {
      onItemClick: (item) => window.open(item.url, '_blank', 'noopener'),
      onItemContextMenu: (item, e) => this.openItemCtxMenu(item, e),
      onFolderContextMenu: (folder, e) => this.openFolderCtxMenu(folder, e),
      onFolderToggle: (folder) => this.toggleFolder(folder),
      onDragStart: (id) => { this.draggedItemId = id; },
      onDragOverFolder: (folder) => {
        this.contentEl.querySelectorAll('[data-folder]').forEach(el => {
          (el.querySelector('.re-folder-row') as HTMLElement)?.removeAttribute('data-drag-over');
        });
        const folderRow = this.contentEl.querySelector<HTMLElement>(`[data-folder="${folder}"] .re-folder-row`);
        if (folderRow) folderRow.dataset.dragOver = 'true';
      },
      onDrop: (targetFolder) => {
        if (this.draggedItemId) {
          this.items = moveItem(this.items, this.draggedItemId, targetFolder);
          this.draggedItemId = null;
          this.render();
          this.scheduleAutosave();
          this.broadcastSync();
        }
      },
    });
  }

  private toggleFolder(folder: string) {
    if (this.collapsedFolders.has(folder)) this.collapsedFolders.delete(folder);
    else this.collapsedFolders.add(folder);
    this.persistCollapsedState();
    this.render();
  }

  private persistCollapsedState() {
    const key = `re:collapsed:${this.getCourseId() ?? '_'}`;
    localStorage.setItem(key, JSON.stringify([...this.collapsedFolders]));
  }

  private toggleFoldAll() {
    const folders = foldersFromItems(this.items);
    const allCollapsed = folders.every(f => this.collapsedFolders.has(f));
    if (allCollapsed) this.collapsedFolders.clear();
    else folders.forEach(f => this.collapsedFolders.add(f));
    this.persistCollapsedState();
    this.render();
  }

  private createFolder() {
    if (!this.canEdit()) return;
    const name = prompt('Nombre de la carpeta:')?.trim();
    if (!name) return;
    // Folders are implicit — just add a placeholder? No: re-render will show it if items exist.
    // For an empty folder, we add a visual placeholder item that is immediately deleted on the next change.
    // Simpler: just alert the user to drop/paste files into the folder name via move.
    // Best UX: directly open rename to assign folder to next-added item.
    // Decision: store the folder name as a pending folder, render a ghost folder row.
    // Implementation: we keep a separate pendingFolders set.
    (this as any)._pendingFolders ??= new Set();
    (this as any)._pendingFolders.add(name);
    this.render();
  }

  private openItemCtxMenu(item: ResourceItem, e: MouseEvent) {
    this.ctxTargetItem = item;
    this.ctxTargetFolder = null;
    this.ctxMoveBtn.style.display = '';
    this.positionCtxMenu(e);
  }

  private openFolderCtxMenu(folder: string, e: MouseEvent) {
    if (folder === 'compartidos') return; // immutable
    this.ctxTargetFolder = folder;
    this.ctxTargetItem = null;
    this.ctxMoveBtn.style.display = 'none';
    this.positionCtxMenu(e);
  }

  private positionCtxMenu(e: MouseEvent) {
    this.ctxMenuEl.removeAttribute('hidden');
    this.ctxMenuEl.style.left = `${e.clientX}px`;
    this.ctxMenuEl.style.top  = `${e.clientY}px`;
  }

  private closeCtxMenu() {
    this.ctxMenuEl.setAttribute('hidden', '');
    this.ctxTargetItem = null;
    this.ctxTargetFolder = null;
  }

  private startRename() {
    const current = this.ctxTargetItem?.name ?? this.ctxTargetFolder ?? '';
    this.closeCtxMenu();
    this.renameBarEl.removeAttribute('hidden');
    this.renameInputEl.value = current;
    this.renameInputEl.focus();
    this.renameInputEl.select();
  }

  private confirmRename() {
    const newName = this.renameInputEl.value.trim();
    if (!newName) { this.closeRename(); return; }
    if (this.ctxTargetItem) {
      const id = this.ctxTargetItem.id;
      this.items = this.items.map(i => i.id === id ? { ...i, name: newName } : i);
    } else if (this.ctxTargetFolder) {
      const old = this.ctxTargetFolder;
      this.items = this.items.map(i => i.folder === old ? { ...i, folder: newName } : i);
    }
    this.closeRename();
    this.render();
    this.scheduleAutosave();
    this.broadcastSync();
  }

  private closeRename() {
    this.renameBarEl.setAttribute('hidden', '');
    this.ctxTargetItem = null;
    this.ctxTargetFolder = null;
  }

  private deleteCtxTarget() {
    this.closeCtxMenu();
    if (this.ctxTargetItem) {
      this.items = removeItem(this.items, this.ctxTargetItem.id);
    } else if (this.ctxTargetFolder) {
      // Move children to root
      const folder = this.ctxTargetFolder;
      this.items = this.items.map(i => i.folder === folder ? { ...i, folder: '' } : i);
    }
    this.render();
    this.scheduleAutosave();
    this.broadcastSync();
  }

  private showMoveSubmenu() {
    const folders = foldersFromItems(this.items).filter(f => f !== this.ctxTargetItem?.folder);
    const target = prompt(`Mover a carpeta:\n${['(raíz)', ...folders].join('\n')}`);
    if (target === null) return;
    const folder = target === '(raíz)' ? '' : target.trim();
    if (this.ctxTargetItem) {
      this.items = moveItem(this.items, this.ctxTargetItem.id, folder);
      this.render();
      this.scheduleAutosave();
      this.broadcastSync();
    }
    this.closeCtxMenu();
  }

  private toggleAllowStudents() {
    if (!this.isTeacher) return;
    this.allowStudents = !this.allowStudents;
    this.updateCollabBtn();
    this.broadcastSync();
  }

  private updateCollabBtn() {
    this.collabBtn.dataset.active = String(this.allowStudents);
    this.collabBtn.title = this.allowStudents
      ? 'Alumnos pueden agregar recursos (activo)'
      : 'Alumnos pueden agregar recursos (desactivado)';
  }

  private toggleExportPopover() {
    const hidden = this.exportPopoverEl.hasAttribute('hidden');
    if (hidden) {
      this.exportInputEl.value = this.defaultExportFilename();
      this.exportPopoverEl.removeAttribute('hidden');
      this.exportInputEl.focus();
      this.exportInputEl.select();
    } else {
      this.closeExportPopover();
    }
  }

  private closeExportPopover() {
    this.exportPopoverEl.setAttribute('hidden', '');
  }

  dispose() {
    if (this.autosaveTimer) clearTimeout(this.autosaveTimer);
    if (this.longPressTimer) clearTimeout(this.longPressTimer);
  }
}
```

- [ ] **Step 9.6: Commit**

```bash
git add src/scripts/room/recursos/controller.ts
git commit -m "feat(recursos): add RecursosController with LiveKit sync, autosave, filetree UX"
```

---

## Task 10: index.ts — Export

**Files:**
- Create: `src/scripts/room/recursos/index.ts`

- [ ] **Step 10.1: Write the export file**

```typescript
// src/scripts/room/recursos/index.ts
export { RecursosController } from './controller';
export type { ResourceItem } from './filetree';
```

- [ ] **Step 10.2: Commit**

```bash
git add src/scripts/room/recursos/index.ts
git commit -m "feat(recursos): add index.ts export"
```

---

## Task 11: Register pod in workspace

**Files:**
- Modify: `src/components/room/workspace/PodTemplates.astro`
- Modify: `src/scripts/room/workspace/RoomWorkspaceManager.ts`
- Modify: `src/scripts/livekit-room.ts`

- [ ] **Step 11.1: Add RecursosPanel to PodTemplates.astro**

Open `src/components/room/workspace/PodTemplates.astro`. Add the import at the top of the frontmatter block (after the last existing import):

```astro
import RecursosPanel from '../panels/recursos/RecursosPanel.astro';
```

Then add the panel in the template, after `<!-- SV: SONIC VISUALIZER -->` (or at the end before `</div>`):

```astro
  <!-- Re: RECURSOS -->
  <RecursosPanel />
```

- [ ] **Step 11.2: Register pod in RoomWorkspaceManager.ts**

Open `src/scripts/room/workspace/RoomWorkspaceManager.ts`.

Add pod entry to the `PODS` array at line 49 (after `sonic-visualizer`):
```typescript
{ id: 'recursos', title: 'RECURSOS', icon: 'Re', atomic: 21, color: '#6fa8dc', cat: 'comm' },
```

Add `onRecursosInit` callback to class declaration (add after `onSonicVisualizerInit` property around line 19):
```typescript
private onRecursosInit?: (element: HTMLElement) => void;
```

Add parameter to constructor signature (after `onSonicVisualizerInit` around line 66):
```typescript
onRecursosInit?: (element: HTMLElement) => void,
```

Assign in constructor body (after `this.onSonicVisualizerInit` around line 81):
```typescript
this.onRecursosInit = onRecursosInit;
```

Add dispatch in the panel init switch block (after sonic-visualizer check around line 166):
```typescript
if (id === 'recursos' && this.onRecursosInit) {
  this.onRecursosInit(element);
}
```

- [ ] **Step 11.3: Wire RecursosController in livekit-room.ts**

Open `src/scripts/livekit-room.ts`.

Add import near the top (after sonic-visualizer import, around line 29):
```typescript
import { RecursosController } from './room/recursos';
```

Add controller variable (after `sonicVisualizerController` declaration around line 10684):
```typescript
let recursosController: RecursosController | null = null;
```

Add a variable to track the current lesson ID (add near the `sonicAnalyzerController` declaration, around line 10683):
```typescript
let recursosCurrentLessonId: string | null = null;
```

Hook it to the clase change event (add near the other `musiki:clase-presentation-changed` listeners in the same init block):
```typescript
window.addEventListener('musiki:clase-presentation-changed', (e: Event) => {
  const ev = e as CustomEvent<{ lessonId: string | null }>;
  recursosCurrentLessonId = ev.detail?.lessonId ?? null;
});
```

Add init function (after `onSonicVisualizerInit` function, around line 10935):
```typescript
const onRecursosInit = (container: HTMLElement) => {
  recursosController?.dispose();
  recursosController = new RecursosController({
    container,
    isTeacher: canLeadSession(),
    getCourseId: () => recursosCurrentLessonId,  // full lesson path e.g. "i1/02-acústica"
    getRoomName: () => roomInput.value.trim() || null,
    getIdentity: () => room.localParticipant?.identity ?? '',
    publish: (msg) => void publishMessage(msg as any),
  });
};
```

Add `onRecursosInit` to workspace manager constructor call (after `onSonicVisualizerInit` argument around line 10965):
```typescript
onRecursosInit,
```

Add incoming message handler in the data message receive block (after the SV message handlers around line 12413):
```typescript
if (message.type === 'recursos:sync' || message.type === 'recursos:allow-students') {
  window.dispatchEvent(new CustomEvent('musiki:recursos:receive', { detail: message }));
}
```

- [ ] **Step 11.4: Verify build compiles**

```bash
cd /Users/zztt/projects/26-musiki/framework
npm run build 2>&1 | tail -30
```

Expected: build succeeds with no TypeScript errors.

- [ ] **Step 11.5: Commit**

```bash
git add src/components/room/workspace/PodTemplates.astro \
        src/scripts/room/workspace/RoomWorkspaceManager.ts \
        src/scripts/livekit-room.ts
git commit -m "feat(recursos): register Re pod in workspace, wire LiveKit + controller"
```

---

## Task 12: Dispatch compartidos events from SA + chat

**Files:**
- Modify: `src/scripts/room/sonic-analyzer/controller.ts`
- Modify: `src/scripts/room/chat/controller.ts`

- [ ] **Step 12.1: Dispatch from SA after successful upload**

Open `src/scripts/room/sonic-analyzer/controller.ts`. Find the upload success block (around line 192, after `const res = await fetch('/api/room/sa-upload', ...)` succeeds and `url` is set).

After the line that sets the status (e.g. `this.setStatus('...')` after getting the url), add:

```typescript
window.dispatchEvent(new CustomEvent('musiki:recursos:sa-uploaded', {
  detail: { url: data.url, name: file.name.replace(/\.[^.]+$/, '') },
}));
```

Find the exact location — it's after `return json({ success: true, url: ... })` is received client-side. Look for `data.url` being used in the SA controller to confirm upload success. The addition goes right after `this.setStatus(...)` or `this.saveBtn`:

```typescript
// In SonicAnalyzerController, inside the upload success branch:
// (existing code) this.setStatus('ready · ' + file.name);
// ADD after ↓
window.dispatchEvent(new CustomEvent('musiki:recursos:sa-uploaded', {
  detail: { url: data.url, name: file.name.replace(/\.[^.]+$/, '') },
}));
```

- [ ] **Step 12.2: Find the exact line in SA controller**

```bash
grep -n "setStatus\|data\.url\|file\.name\|uploadError\|upload error" \
  src/scripts/room/sonic-analyzer/controller.ts | head -20
```

Use the output to locate the exact line where upload succeeds and `data.url` is first available, then insert the dispatch there.

- [ ] **Step 12.3: Dispatch from chat on incoming URL messages**

Open `src/scripts/room/chat/controller.ts`. Find where incoming chat messages are processed (look for the function that renders a chat message to the DOM, around where `anchor.className = 'conference-chat-link'` is set).

After any URL is detected in an incoming chat message, add:

```typescript
const URL_REGEX_RE = /https?:\/\/[^\s"'<>(){}|\\^`\[\]]{4,}/gi;
const foundUrls = (messageText || '').match(URL_REGEX_RE) ?? [];
for (const url of foundUrls) {
  window.dispatchEvent(new CustomEvent('musiki:recursos:chat-url', { detail: { url } }));
}
```

Find the exact location:

```bash
grep -n "conference-chat-link\|anchor\|renderMessage\|addMessage\|chatText\|message\.text\|msg\.text" \
  src/scripts/room/chat/controller.ts | head -20
```

Insert the dispatch after the URL is identified in the message text, before or after the anchor element is created.

- [ ] **Step 12.4: Build and verify no TypeScript errors**

```bash
npm run build 2>&1 | grep -E "error|Error" | head -20
```

Expected: no errors.

- [ ] **Step 12.5: Commit**

```bash
git add src/scripts/room/sonic-analyzer/controller.ts \
        src/scripts/room/chat/controller.ts
git commit -m "feat(recursos): dispatch compartidos events from SA upload and chat"
```

---

## Task 13: Manual smoke test

- [ ] **Step 13.1: Start dev server**

```bash
npm run dev
```

- [ ] **Step 13.2: Verify pod appears in gallery**

Open the room as teacher. In the PODS gallery, confirm `Re` appears with icon `Re` and color `#6fa8dc`.

- [ ] **Step 13.3: Open Re pod and verify layout**

Add Re to workspace. Confirm:
- Toolbar shows `Re` label
- Bottom bar has `⊟`, `+ folder`, `⎘`, personas button (teacher only), `E`
- Content area is empty with drop hint
- Personas button visible (teacher mode)

- [ ] **Step 13.4: Test file upload**

Drag a PDF onto the pod. Confirm:
- Drop overlay appears on dragenter
- File uploads to R2
- Item appears in filetree with red `■` icon and slugified name
- After ~2s name resolves async (if title extractable)

- [ ] **Step 13.5: Test paste clipboard**

Copy `https://arxiv.org/abs/2312.00752` to clipboard. Click `⎘`. Confirm:
- Item appears in root with quick name
- After ~3s name resolves to `arxiv-slug-2023` style

- [ ] **Step 13.6: Test compartidos auto-capture**

Send a URL in chat (e.g. `https://www.youtube.com/watch?v=dQw4w9WgXcQ`). Confirm:
- Item appears in `compartidos` folder automatically
- Folder is blue-italic

- [ ] **Step 13.7: Test right-click menu**

Right-click an item. Confirm menu shows Renombrar / Mover a… / Borrar. Test rename.

- [ ] **Step 13.8: Test E export**

Click `E`. Confirm popover shows filename input pre-filled with `recursos-<clase-slug>.md`. Click Guardar. Verify content-admin publish is called (check network tab for POST to `/api/content-admin/publish`).

- [ ] **Step 13.9: Test student toggle**

As teacher, click the personas button. Confirm `data-active` toggles to `true` (button turns green). Open a second browser window as student — verify student can now drop files.

- [ ] **Step 13.10: Test autosave**

Add an item, wait 6 seconds. Verify GET `/api/live/recursos?roomName=...` returns the item. Reload the page, open Re pod — confirm item is restored from DB.

- [ ] **Step 13.11: Final commit**

```bash
git add -A
git commit -m "feat(room): complete Recursos (Re) pod implementation"
```

---

## Constraints Reminder

- No nested subfolders (one level only)
- No in-pod file preview (items open externally via click)
- `compartidos` folder cannot be renamed or deleted
- Drag-drop reordering is client-authoritative (no conflict resolution)
- Max file size: 24 MB
- DB autosave: debounced 5 s + `sendBeacon` on close
