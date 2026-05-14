# Musiki Class Workspace Refactor

Date: 2026-05-14
Status: Proposed / next architecture direction

## Purpose

Musiki is moving from several partially overlapping storage and UI surfaces toward a single class workspace model. The immediate driver is the `RECURSOS` refactor, but the same architecture must also support snapshots, session recordings, pod state, future course-text migration, Obsidian sync, LilyPond blocks, lessons, assignments, and student/teacher ownership.

This document supersedes older resource-pod assumptions where:

- LiveKit broadcasts full resource arrays as the source of truth.
- Markdown files are treated as the canonical resource/course state.
- The room `RECURSOS` pod and the normal course `80 RECURSOS` editor evolve as separate interfaces.
- Snapshots persist only the Dockview layout without a stable pod-content payload.

## Core Decisions

### 1. Postgres is the canonical authority

Postgres owns identity, structure, permissions, versions, snapshots, text content, and relationships.

R2/S3 stores binary payloads and derived artifacts:

- audio and video files;
- images and original media;
- PDF, PPTX, DOC/DOCX, archives and large uploads;
- rendered LilyPond output;
- thumbnails, posters, waveform images, and other heavy derived previews.

Markdown, YAML, GitHub, and Obsidian are portable mirrors and authoring surfaces. They are not the runtime authority once a course or workspace object has been imported into Postgres.

### 2. Use a hybrid storage model

Small, highly transactional data belongs in Postgres:

- resource tree metadata;
- lesson and assignment metadata;
- Markdown bodies;
- YAML/frontmatter mirror fields;
- snapshots and pod payload references;
- notes, concepts, and LilyPond source blocks;
- ownership, visibility, permissions, revisions, and audit events.

Large or streamable bytes belong in R2:

- files larger than roughly 1 MB;
- audio/video/image originals;
- PDF/PPTX/DOC/DOCX assets;
- generated preview artifacts;
- downloadable exports.

Postgres rows may reference R2 object keys, signed URL state, preview status, and content hashes. R2 object listings must not be treated as the canonical tree.

### 3. One workspace model, two UI hosts

The live room `RECURSOS` pod and the normal course `80 RECURSOS` sidebar/editor must mount the same Resource Workspace implementation.

The host changes, but the domain contract does not:

```text
Room pod host
  -> ResourceWorkspace mode="room"

Normal course host
  -> ResourceWorkspace mode="course"
```

The room host adds LiveKit sync and conference ergonomics. The course host adds preparation, cleanup, and broader course navigation. Both read and write the same Postgres-backed workspace nodes.

### 4. LiveKit transmits operations, not truth

LiveKit remains the real-time transport for conference synchronization. It should broadcast idempotent domain operations, not full replacement state.

Examples:

```ts
type WorkspaceLiveEvent =
  | { type: 'node.created'; nodeId: string; parentId: string | null; revision: number }
  | { type: 'node.moved'; nodeIds: string[]; targetParentId: string; sortKeys: Record<string, string>; revision: number }
  | { type: 'node.renamed'; nodeId: string; name: string; revision: number }
  | { type: 'node.deleted'; nodeIds: string[]; revision: number }
  | { type: 'asset.ready'; nodeId: string; assetId: string; revision: number }
  | { type: 'snapshot.created'; snapshotId: string; revision: number }
  | { type: 'snapshot.restored'; snapshotId: string; revision: number }
  | { type: 'pod-state.updated'; podId: string; stateRef: string; revision: number };
```

Late join flow:

1. Fetch the canonical workspace state from the API.
2. Subscribe to LiveKit operations.
3. Apply only operations with a newer revision/event id.

This prevents flicker caused by remounting pods, replacing whole arrays, or replaying stale state.

## Canonical Domain Model

The first migration does not need to rename every existing table. It should introduce an adapter layer that lets current tables keep working while new tables become the canonical model.

Target entities:

```ts
type WorkspaceNodeKind =
  | 'course'
  | 'module'
  | 'lesson'
  | 'assignment'
  | 'session'
  | 'folder'
  | 'resource'
  | 'snapshot'
  | 'note'
  | 'concept'
  | 'lily_block';

type WorkspaceNode = {
  id: string;
  courseId: string;
  roomName?: string | null;
  kind: WorkspaceNodeKind;
  parentId: string | null;
  name: string;
  slug?: string | null;
  sortKey: string;
  ownerUserId: string;
  createdByUserId: string;
  visibility: 'teacher' | 'class' | 'private';
  source: 'musiki' | 'room' | 'obsidian' | 'import' | 'student';
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
};

type ResourceAsset = {
  id: string;
  nodeId: string;
  mime: string;
  resourceType:
    | 'link'
    | 'pdf'
    | 'pptx'
    | 'doc'
    | 'txt'
    | 'markdown'
    | 'image'
    | 'video'
    | 'audio'
    | 'lilypond'
    | 'other';
  objectKey?: string | null;
  externalUrl?: string | null;
  sizeBytes?: number | null;
  sha256?: string | null;
  previewStatus: 'pending' | 'ready' | 'failed' | 'none';
  uploadStatus: 'pending' | 'uploading' | 'ready' | 'failed';
};
```

Existing `ResourceSession`, `LiveClassResource`, and `RoomSnapshot` can be bridged into this shape during migration.

## Resource Organization

Resources are organized by course, lesson/chapter, session/day, folder, and object.

Required folders may be created automatically but should still be represented as nodes:

- `media`;
- `docs`;
- `compartidos`;
- teacher-defined custom folders;
- optional session/day folders.

Supported resource types include:

- links;
- PDF;
- PPTX;
- MP3, WAV, OGG;
- MP4, MOV;
- PNG, JPG/JPEG;
- TXT, MD;
- DOC/DOCX;
- LilyPond source and rendered artifacts.

The same node tree powers:

- room `RECURSOS`;
- normal `80 RECURSOS`;
- future course outline organization;
- future Obsidian vault export/import.

## Snapshots

Snapshots must capture both workspace layout and pod content references.

```ts
type WorkspaceSnapshot = {
  id: string;
  courseId: string;
  roomName: string;
  sessionId?: string | null;
  name: string;
  layout: unknown;
  podState: SnapshotPodState;
  createdByUserId: string;
  createdAt: string;
};

type SnapshotPodState = {
  sa?: unknown;
  sv?: unknown;
  vs?: {
    kind?: 'pdf' | 'pptx' | 'image' | 'video' | null;
    resourceNodeId?: string | null;
    assetId?: string | null;
    url?: string | null;
    page?: number;
    zoom?: number;
  };
  conceptos?: unknown;
  notas?: {
    documentId?: string;
    version?: number;
    selection?: unknown;
  };
  lilycode?: {
    documentId?: string;
    version?: number;
    activeBlockId?: string;
    cursor?: unknown;
    scroll?: unknown;
  };
  recursos?: {
    selectedNodeIds?: string[];
    activeFolderId?: string | null;
  };
};
```

Each pod that participates in snapshots should implement:

```ts
interface SnapshotAwarePod {
  getSnapshotPayload(): unknown;
  applySnapshotPayload(payload: unknown): Promise<void> | void;
}
```

Snapshots should store references to versioned documents and assets rather than duplicating every binary or Markdown body.

## Permissions And Ownership

Teacher authority:

- Teachers can manage all class materials.
- Teachers can move, rename, hide, delete, or publish student-contributed material.
- Teachers own course-level and class-level structure.

Student authority:

- Students can manage their own uploads while permitted.
- Students cannot mutate teacher-owned resources unless explicitly allowed.
- Student-contributed material must retain uploader attribution.

The permission model should be enforced by APIs, not only by hidden UI controls.

Current implementation rule:

- `teacher`/manager can execute every workspace command.
- enrolled `student`/participant can read the workspace, create folders, upload resources, create snapshots, and rename/move/delete only nodes they own or created.
- `snapshot.restore` and `document.update` remain teacher-only in the first pass because they affect shared class state or canonical course text.
- the normal `80 RECURSOS` page shows the new workspace panel to contributors, while the old dense R2/legacy panels stay teacher-only during the bridge period.
- student byte uploads are allowed only through the class-workspace R2 prefix (`class-workspace/<course>/<room>/`); raw R2 browsing, folder markers, and deletes remain teacher-only.

Suggested visibility:

```ts
type WorkspaceVisibility = 'teacher' | 'class' | 'private';
```

Suggested operations:

```ts
type WorkspaceCommand =
  | { type: 'folder.create'; parentId: string; name: string }
  | { type: 'node.move'; nodeIds: string[]; targetParentId: string }
  | { type: 'node.rename'; nodeId: string; name: string }
  | { type: 'node.delete'; nodeIds: string[] }
  | { type: 'resource.link.create'; parentId: string | null; url: string; name?: string }
  | { type: 'resource.upload.prepare'; parentId: string; files: UploadIntent[] }
  | { type: 'resource.upload.complete'; uploadId: string; objectKey: string }
  | { type: 'snapshot.create'; sessionId?: string | null; name?: string }
  | { type: 'snapshot.restore'; snapshotId: string }
  | { type: 'document.update'; documentId: string; baseVersion: number; bodyMd: string };
```

## UI Direction

The target interface is closer to Google Photos plus Finder than to a dense admin table.

Visible by default:

- search;
- upload;
- create folder;
- breadcrumb;
- grid/list switch.

Hidden until context:

- rename;
- delete;
- move;
- permissions;
- metadata;
- versions;
- advanced filters.

Expected interactions:

- single click/tap selects or previews;
- double click/enter opens;
- drag moves objects between sessions and folders;
- multi-select enables a bulk-action bar;
- right click opens context menu;
- long press opens mobile actions;
- `Cmd/Ctrl+K` opens command palette;
- space opens quick preview where appropriate.

## Mobile And Touch Contract

Mobile support is not a later polish step. The first Resource Workspace implementation must work on touch devices.

Requirements:

- 44px minimum practical touch targets;
- no required hover-only action;
- long-press or explicit `...` button for context actions;
- bottom sheet for bulk actions and item actions on small screens;
- tree/sidebar becomes a drawer on mobile;
- grid remains the primary mobile surface;
- drag handles or activation constraints prevent scroll conflicts;
- `Move to...` remains a non-drag fallback for accessibility and reliability;
- upload supports mobile file pickers and camera/media sources where the browser allows it;
- preview can open fullscreen on small screens.

Library guidance:

- `@dnd-kit` for grid/card movement, touch sensors, overlays, and custom activation constraints.
- `react-arborist` for the desktop tree if it stays simple and reliable.
- Consider React Aria Tree/DnD if tree accessibility, keyboard drag/drop, and screen-reader support become the dominant requirement.
- Radix UI for desktop context menus, dialogs, dropdowns, and popovers; pair with mobile bottom sheets for touch-first actions.

## Upload Flow

Uploads should avoid UI stalls:

1. API creates a pending resource node and upload intent.
2. UI renders the pending node immediately.
3. Client uploads bytes directly to R2 using Uppy or equivalent.
4. Client confirms completion with object key/hash.
5. API marks `ResourceAsset.uploadStatus = ready`.
6. LiveKit broadcasts `asset.ready`.
7. Background processing creates previews as needed.

Cleanup jobs should reconcile:

- pending uploads that never completed;
- R2 objects without database rows;
- database assets whose R2 object is missing;
- failed preview jobs.

## Initial API Surface

The first implementation exposes a read endpoint and a command endpoint that let the new UI consume the workspace contract while existing tables are still active.

Read:

```text
GET /api/class-workspace/resources?courseId=<courseId>
```

Response shape:

```ts
type ClassWorkspaceResourcesResponse = {
  mode: 'legacy-adapter' | 'canonical';
  courseId: string;
  roomName: string;
  canManage: boolean;
  canContribute: boolean;
  currentUserId: string;
  nodes: WorkspaceNode[];
  assets: ResourceAsset[];
  revision: number;
};
```

Commands:

```text
POST /api/class-workspace/command
```

Request shape:

```ts
type ClassWorkspaceCommandRequest = {
  courseId: string;
  roomName?: string;
  command: WorkspaceCommand;
};
```

Supported in the first command API pass:

- `folder.create`: creates a canonical folder node and stores legacy folder metadata for bridge mode.
- `node.rename`: renames canonical nodes, legacy resources, legacy sessions, and legacy-derived folders.
- `node.move`: moves legacy resources into root, session, legacy-derived folder, or canonical folder targets.
- `node.delete`: deletes legacy resources, soft-deletes canonical nodes, and clears legacy folders instead of physically deleting blobs.
- `resource.link.create`: creates a ready canonical resource asset backed by an external URL, mirrors it into `LiveClassResource`, and supports student-owned contributions.
- `resource.upload.prepare`: creates pending canonical resource nodes/assets and returns `uploadId`, `nodeId`, `assetId`, suggested `objectKey`, and `publicUrl`.
- `resource.upload.complete`: marks the asset as ready after the client uploads to R2, stores `objectKey`/URL, mirrors the completed upload into `LiveClassResource`, and emits `asset.ready`.
- `session.create`: creates a legacy `ResourceSession`, immediately mirrors it as a canonical `session` node, and emits `session.created`.
- `snapshot.create`: creates a canonical snapshot node plus `ClassWorkspaceSnapshot` with `layout` and `podState`, and mirrors the layout into legacy `RoomSnapshot`.
- `snapshot.restore`: returns canonical snapshot layout/podState when available, or legacy `RoomSnapshot.layout` as a fallback, and emits `snapshot.restored`.
- `document.update`: creates or updates Postgres-first Markdown text documents, maintains a workspace node identity, stores mirrored frontmatter JSON, checks `baseVersion` when provided, writes `CourseTextDocumentVersion`, and emits `document.updated`.

Every successful command writes a `ClassWorkspaceEvent` row with a revision. LiveKit can later broadcast this event payload rather than recomputing full state.

Bridge UI status:

- `ClassWorkspacePanel.astro` is the first thin interface over these APIs.
- It supports refresh, search, session create, folder create, link create, upload, direct file drop, card previews, rename, delete, desktop drag to tree or folder cards, a `Move` fallback, multi-select, multi-drag, a bulk action bar, a right-click context menu, breadcrumb root/up navigation, and a basic Pointer Events touch-drag gesture from resource cards to tree/folder targets.
- Teacher mode also adapts the old R2/S2 browser into the unified workspace: unlinked bucket objects are rendered as draggable cards, and dropping them onto a session/folder creates a canonical `resource.link.create` mirror instead of exposing a separate storage panel.
- The normal `RecursosEditor` now routes its visible surface through this unified workspace instead of exposing the legacy R2/link/session panels as separate panels. The legacy editor scripts and panes remain as rollback material while the new command API is exercised.
- The interface pass is deliberately austere: session list, a large preview grid, hidden contextual actions, subtle search, and minimal create/upload controls. Radix and dnd-kit are installed and Astro React is enabled; the next pass should replace the vanilla context/bulk/drag adapters with React/Radix/dnd-kit components without changing the command API.
- In bridge mode, the API calls `ensureClassWorkspaceSchema()` before canonical reads/writes so missing additive tables do not block interface testing while migrations are still being rolled out.
- It intentionally remains a temporary vanilla island so the command API can be exercised before the planned React/Radix/Uppy/dnd-kit interface.

## Text Course Migration And Obsidian

The near-future course-content migration should reuse the same workspace tree.

Postgres will become the canonical source for text course content:

- lessons;
- assignments;
- notes;
- concepts;
- LilyPond source blocks;
- evaluation blocks;
- class documents.

Markdown remains the human-readable document format. YAML frontmatter becomes a mirrored manifest of Postgres parameters.

Example Obsidian mirror:

```md
---
musiki_id: lesson_123
course_id: i2
kind: lesson
slug: ritmo-compas-6-8
title: Ritmo y compas 6/8
parent_id: module_12
sort_key: "0004"
visibility: class
owner_role: teacher
version: 18
updated_at: 2026-05-14T12:30:00Z
sync_hash: "sha256:..."
---

# Ritmo y compas 6/8

Contenido editable...
```

YAML should mirror:

- `musiki_id`;
- `kind`;
- `course_id`;
- `parent_id`;
- `slug`;
- `title`;
- `sort_key`;
- `visibility`;
- `owner` or owner role;
- `version`;
- `updated_at`;
- `sync_hash`;
- asset and block references.

YAML should not be the only place for:

- permissions;
- ownership;
- history;
- audit logs;
- live snapshot state;
- assignment submissions;
- LilyPond compilation results;
- conflict state.

An internal Obsidian plugin can later sync down/up per course:

```text
Postgres -> export course vault -> teacher edits in Obsidian -> plugin syncs up -> Musiki validates, versions, and imports.
```

The sync identity is `musiki_id`, not file path. A file may be renamed or moved in Obsidian without losing its canonical database identity.

## LilyPond Blocks

Markdown can remain the authoring shell for LilyPond:

````md
```ly name="escala-do" library="violin/basic"
\relative c' {
  c d e f g a b c
}
```
````

Postgres should index a structured derived view:

```ts
type LilyBlock = {
  id: string;
  documentId: string;
  blockId: string;
  name?: string;
  code: string;
  libraryRefs: string[];
  compiledAssetId?: string | null;
  compileStatus: 'pending' | 'ready' | 'failed';
  diagnostics?: unknown;
};
```

This allows snapshots to restore the active block and lets the room use compiled R2 artifacts without treating local `.md` files as the authority.

## Suggested Libraries

Recommended starting stack:

- React island: shared `ResourceWorkspace`;
- `react-arborist`: desktop tree, rename, reparenting;
- `@dnd-kit`: grid drag/drop, touch gestures, sortable items;
- `Uppy`: robust uploads to R2/S3, progress and multipart support;
- `Radix UI`: context menus, dialogs, dropdowns, popovers;
- `TanStack Query`: server cache, optimistic mutations, invalidation;
- `Zustand`: local UI state such as selection, drawers, view mode;
- `cmdk`: command palette.

Avoid using a full file-manager product as the architecture. The domain is not a filesystem: it is a class workspace with resources, sessions, snapshots, lessons, assignments, permissions, LiveKit sync, and export/import mirrors.

## Migration Plan

### Phase 0: Stabilize current bridge

- Keep current PPTX support.
- Keep emergency fixes for folder creation and delete selection in the old editor.
- Stop expanding `.recursos-editor-panel` beyond compatibility work.

### Phase 1: Domain contract and adapters

- Add canonical workspace-node and asset APIs behind a new service layer.
- Bridge existing `LiveClassResource`, `ResourceSession`, and `RoomSnapshot`.
- Introduce revisions/event ids.
- Preserve existing routes until the new workspace is mounted.

### Phase 2: Snapshot-aware pods

- Add `getSnapshotPayload()` and `applySnapshotPayload()` to SA, SV, VS, CONCEPTOS, NOTAS, LILYCODE, and RECURSOS.
- Persist layout plus pod payload references.
- Add restore-by-reference behavior for assets and text versions.

### Phase 3: ResourceWorkspace React island

- Build shared tree/grid/preview/upload shell.
- Mount first in normal course `80 RECURSOS`.
- Support desktop and mobile/touch from the start.

### Phase 4: Room pod replacement

- Replace the old `RECURSOS` pod internals with the same ResourceWorkspace.
- Add LiveKit operation bridge.
- Remove full-state replacement sync once stable.

### Phase 5: Text and Obsidian foundation

- Add `CourseTextDocument` and versions.
- Import current Markdown into Postgres.
- Export Markdown/YAML mirrors.
- Prepare Obsidian plugin contract.

### Phase 6: Cleanup

- Retire old autosave/full-array assumptions.
- Keep GitHub Actions only as backup/export/deploy support, not as live canonical class state.
- Add reconciliation jobs for R2/Postgres consistency.

## Open Questions

- Exact table names and whether to introduce `WorkspaceNode` directly or use course-specific names.
- Whether thumbnails smaller than a threshold live in Postgres or R2.
- How much document diff history to store: full versions, patches, or hybrid.
- Whether `react-arborist` is sufficient for mobile tree interaction or if React Aria Tree should replace it before production.
- How long to keep Markdown projection routes during the transition.
