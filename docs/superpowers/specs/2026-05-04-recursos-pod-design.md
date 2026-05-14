# Recursos Pod (Re) — Design Spec

**Date:** 2026-05-04  
**Status:** Implemented legacy design / superseded for future work

> 2026-05-14 update: this document describes the first `RECURSOS` pod implementation. It remains useful as implementation history, but it is no longer the target architecture. New work should follow [Musiki Class Workspace Refactor](../../architecture/class-workspace-refactor.md): Postgres authority, R2 for blobs, shared `ResourceWorkspace` mounted in both room and normal course view, LiveKit operation sync, snapshot-aware pod state, mobile/touch support, and Markdown/YAML as an Obsidian mirror rather than runtime truth.

---

## Overview

The **Re** pod aggregates class resources: uploaded files (stored in Cloudflare R2), pasted links, and auto-captured shared items from chat, External Media (ME), and SA/SV uploads. It lives in the workspace alongside other pods. Its first implementation shared working state in real time via LiveKit data messages, persisted to DB with autosave, and exported on demand as an ASCII-filetree `.md` file saved in the active clase's content folder.

Future direction: the pod should become a host for the shared `ResourceWorkspace`. Postgres owns nodes, metadata, permissions, revisions, and snapshot references. R2 owns media/document bytes. LiveKit broadcasts idempotent operations, not full arrays. Markdown export remains a compatibility/import-export surface.

If no clase is active, resources are associated with `public/recursos`.

---

## Audience & Permissions

- **Visible to:** all participants (teacher + students)
- **Edit by default:** teacher only
- **Student contributions:** teacher toggles via a collab button in the bottom bar (same SVG icon as LilyCode's `data-lilypond-collab` button). Toggle state is broadcast via LiveKit so all clients reflect it immediately.

---

## Architecture

```
LiveKit data messages  ──▶  all clients (real-time broadcast)
        │
        ▼
DB (ResourceItem table)  ◀──  autosave (debounced 5 s, on every state change)
        │                     + beforeunload / visibilitychange flush
        │
        ▼ (on demand, teacher action)
content-admin publish  ──▶  recursos-<clase-slug>.md  in clase folder
                            or  public/recursos/recursos-<slug>.md  if no clase
```

**Bootstrap on join:** when the pod initializes, it fetches the current session's resource list from DB (`GET /api/live/recursos?claseId=...&roomName=...`). Late joiners always get full state.

**Legacy broadcast format:** LiveKit data message `{ type: 'recursos:sync', items: ResourceItem[], allowStudents: boolean }` — full replace on every change.

**Target broadcast format:** LiveKit should transmit small domain operations with revision ids, for example `node.created`, `node.moved`, `node.renamed`, `asset.ready`, and `snapshot.restored`. The API/Postgres state is the authority, and clients patch local state in place to avoid flicker.

---

## Data Model

### `ResourceItem` (DB table: `LiveClassResource`)

| field        | type      | notes |
|-------------|-----------|-------|
| `id`         | uuid      | primary key |
| `claseId`    | string    | lesson path slug (nullable — null = public/recursos) |
| `roomName`   | string    | LiveKit room |
| `url`        | string    | R2 public URL or external URL |
| `name`       | string    | display name (auto-extracted or manual) |
| `type`       | enum      | `pdf` `img` `md` `tex` `ly` `audio` `link` `other` |
| `folder`     | string    | virtual folder path (e.g. `"compartidos"`, `"bibliografía"`) — empty string = root |
| `source`     | enum      | `upload` `chat` `external-media` `sa` `sv` `paste` |
| `createdBy`  | string    | participant identity |
| `createdAt`  | timestamp | |
| `sortOrder`  | integer   | for drag-drop reordering within folder |

### Session state (in-memory, broadcast via LiveKit)

```ts
type RecursosState = {
  items: ResourceItem[];
  allowStudents: boolean;
};
```

---

## Naming Strategy: Author-year-title

On every resource addition, the controller attempts to extract structured metadata before assigning a display name. Priority order:

1. **DOI / arXiv URL** → fetch metadata from CrossRef or arXiv API → `Apellido-año-titulo-corto`
2. **Open Library / Google Books URL** → fetch metadata → same format
3. **YouTube / Vimeo URL** → use oEmbed title → `canal-año-título`
4. **PDF file with XMP/Dublin Core metadata** → extract client-side → `Apellido-año-titulo`
5. **Any URL** → attempt `<title>` scrape via `/api/live/recursos/resolve-title` (server proxies fetch to avoid CORS) → slug the title
6. **Fallback** → use original filename or domain+path slug

If extraction fails or yields low-confidence results, the name is set to the raw filename/URL and flagged for manual rename. The right-click context menu always offers "Renombrar" for manual correction.

The resolved name is stored in `ResourceItem.name` and can be edited at any time.

---

## UI Components

### Pod wrapper
```
data-pod="recursos"  data-pod-title="Re"
```

### Toolbar (top)
- Label `Re` (green, same style as `sA`)  
- Active clase name (muted, truncated): `i1 / 02-acústica` — updates on `musiki:clase-presentation-changed`

### Filetree (main content area)
- Entire pod body is a **drag-and-drop file zone** (same pattern as SA's `data-sa-dropzone`)
- Drop overlay appears on dragenter, hides on dragleave/drop
- Folders are collapsible; state stored in localStorage per claseId
- **`compartidos`** folder: auto-created, styled in blue italic, always first, cannot be deleted or renamed
- User folders: sorted alphabetically after `compartidos`
- Root-level items appear after all folders
- Items within a folder sorted by `sortOrder`; drag-drop reordering updates `sortOrder` and broadcasts sync

### File type icons (flat, inline SVG or character)
| type   | color      |
|--------|-----------|
| pdf    | `#e06666` |
| img    | `#76d3ff` |
| md     | `#45d384` |
| tex    | `#f6b26b` |
| ly     | `#ffd966` |
| audio  | `#93c47d` |
| link   | `#8e7cc3` |
| other  | `#666`    |

### Bottom bar (left → right)
1. `⊟` — fold/unfold all folders toggle  
2. `+ folder` — create new virtual folder (prompts inline for name)  
3. `⎘` — paste clipboard (reads `navigator.clipboard`, detects URL vs file, adds to active folder or root)  
4. *(spacer)*  
5. **Collab toggle** (personas SVG, same as LilyCode) — teacher-only visible; toggles `allowStudents`  
6. `E` — export/rename: opens a small inline popover with the target filename pre-filled (`recursos-{clase-slug}.md` or `recursos-{date}.md` if no clase). User can edit the name and confirm to trigger content-admin publish. If no clase is active, the file goes to `public/recursos/`.

### Right-click context menu
Available on any item or folder row. On touch: long-press triggers the menu.

**On item:**
- Renombrar (edits `name` field inline)
- Borrar
- Mover a carpeta… (submenu of existing folders)

**On folder:**
- Renombrar
- Borrar (moves children to root)

Items can also be **dragged** to another folder row to move them.

---

## `compartidos` Auto-Capture

The controller subscribes to window events and retroactively bootstraps on init.

### Real-time capture (event listeners)

These events **do not exist yet** — they must be dispatched as part of this implementation by their respective controllers. Each dispatch is a `window.dispatchEvent(new CustomEvent(...))`.

| Event | Dispatched by | Payload | What's captured |
|-------|--------------|---------|----------------|
| `musiki:recursos:chat-url` | chat controller (on each received message) | `{ url, sender }` | URLs found via regex in message text |
| `musiki:recursos:sa-uploaded` | SA controller (after successful R2 upload) | `{ url, name }` | R2 URL of uploaded audio |
| `musiki:recursos:sv-uploaded` | SV controller (if/when it supports upload) | `{ url, name }` | same |
| `musiki:recursos:external-media` | ME pod (on media add) | `{ url, name }` | URL of external media item |

### Retroactive bootstrap
On pod init (after DB fetch), call `GET /api/live/recursos/compartidos-history?claseId=...` which returns:
- Recent chat messages with URLs (from `ChatMessage` history in DB)
- SA/SV uploads for this session (from `LiveResourceItem` with `source=sa|sv`)
- External-media items for this session

De-duplicated by URL, added to `compartidos` folder with `source` tag.

### Deduplication
Before adding any item to `compartidos`, check `items.find(i => i.url === url)`. Skip if already present.

---

## `.md` Export Format

The exported file uses an ASCII filetree header followed by a resource list:

```markdown
---
title: Recursos — 02-acústica
claseId: i1/02-acústica
updatedAt: 2026-05-04T18:00:00Z
---

## Recursos — 02-acústica

\`\`\`
recursos/
├── compartidos/
│   ├── [link] youtu.be/dQw4w9WgXcQ
│   ├── [audio] Sala-2025-grabacion.wav
│   └── [img] espectro-captura.png
├── bibliografía/
│   ├── [pdf] Schafer-1977-El-Paisaje-Sonoro.pdf
│   └── [md] notas-schafer.md
└── etude-01.ly
\`\`\`

## compartidos

- [youtu.be/dQw4w9WgXcQ](https://youtu.be/dQw4w9WgXcQ) — *chat*
- [Sala-2025-grabacion.wav](https://r2.musiki.org/...) — *sa upload*

## bibliografía

- [Schafer-1977-El-Paisaje-Sonoro.pdf](https://r2.musiki.org/...) — *upload*
- [notas-schafer.md](https://r2.musiki.org/...) — *upload*

## raíz

- [etude-01.ly](https://r2.musiki.org/...) — *upload*
```

Saved to:
- `{courseFolder}/{claseFolder}/recursos-{clase-slug}.md` when a clase is active
- `public/recursos/recursos-{date}.md` when no clase is active

---

## File Upload to R2

Follows the same pattern as `sa-upload.ts`:

**Endpoint:** `POST /api/room/recursos-upload`

- Accepts any file type (no MIME restriction beyond safety)
- Key pattern: `room/recursos/{year}/{month}/{day}/{identity-slug}-{uuid}.{ext}`
- Max size: 24 MB (same as SA)
- Returns `{ url, key }`
- After upload, controller adds `ResourceItem` with `source: 'upload'`, triggers autosave + LiveKit broadcast

---

## API Routes

| Route | Method | Description |
|-------|--------|-------------|
| `/api/room/recursos-upload` | POST | Upload file to R2 |
| `/api/live/recursos` | GET | Fetch ResourceItem list for claseId + roomName |
| `/api/live/recursos` | POST | Upsert full ResourceItem list (autosave) |
| `/api/live/recursos/resolve-title` | GET | Server-side title/metadata fetch for a URL |
| `/api/live/recursos/compartidos-history` | GET | Retroactive compartidos data for session |

---

## File Structure

```
src/
  components/room/panels/recursos/
    RecursosPanel.astro
    recursos.css
  scripts/room/recursos/
    controller.ts       # main pod controller
    index.ts            # export + init
    metadata.ts         # Author-year-title extraction logic
    filetree.ts         # tree render + drag-drop
  pages/api/
    room/recursos-upload.ts
    live/recursos.ts
    live/recursos/
      resolve-title.ts
      compartidos-history.ts
```

Pod registered in `RoomWorkspaceManager.ts`:
```ts
{ id: 'recursos', title: 'RECURSOS', icon: 'Re', atomic: 21, color: '#6fa8dc', cat: 'comm' }
```

---

## Persistence & Autosave

- **Autosave:** debounced 5 s after any state change → `POST /api/live/recursos`
- **Flush on close:** `visibilitychange` (hidden) + `beforeunload` → synchronous `navigator.sendBeacon('/api/live/recursos', payload)`
- `sendBeacon` is fire-and-forget but survives page unload reliably
- On rejoin: bootstrap from DB, merge with any LiveKit broadcast received

---

## Constraints & Non-Goals

- No real-time collaborative folder rename (one editor at a time via manual action)
- No file preview in-pod (items are links that open externally)
- No version history for the `.md` file (content-admin handles that via git)
- No nested subfolders (one level only; path like `"bibliografía"` — no `"a/b"`)
- Drag-drop reordering is client-authoritative: the dragging user's sort is broadcast and accepted by all
