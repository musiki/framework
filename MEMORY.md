# MEMORY.md — Project Activity Log

<2026-05-01 stabilization-and-graph-fixes> <br>
Resolved critical auth crashes, fixed Graph pod rendering, and completed Supabase cleanup.
- Auth: Fixed `resolveUserIdByEmail` signature mismatch causing 500 errors in Header and admin APIs. Enabled local dev login by disabling origin forcing on localhost.
- Graph: Fixed ForceGraph initialization and resizing for Dockview. Added node search with auto-zoom/center. Expanded default filter to show course nodes.
- Media: Restored External Media search results by refactoring pod layout to flex-column (anchoring toolbar to bottom) and resolving CSS conflicts that hid thumbnails.
- Cleanup: Removed all remaining Supabase client remnants from `Header.astro` and `[...slug].astro`. Migrated wordcloud image generation to Cloudflare R2 public URLs. Simplified library APIs by removing legacy Supabase parameters.

<2026-05-01 orf-pod-agentic-docs-and-mvp> <br>
Indexed the new `docs/agentic` planning branch and started the Orf pod MVP.
- Docs: Added `docs/agentic/README.md`, `local-ai-pod.md`, `ai-service-contracts.md`, and `local-ai-roadmap.md` as the planning set for a transversal Ollama-based assistant.
- Scope: Captures conference room + notes integration, `/api/ai/run` contracts, RAG over controlled vault notes, LilyPond assistance, and guided microevaluations.
- Update: Refined the MVP toward contextual room chat without RAG, with confirmable output proposals for `LILY-CODE`, notes, room chat publication as `Orf-<modelName>`, and MIDI notes for HYPERPIANO.
- Implementation: Added `orf` as a Dockview room pod, reusing chat UI classes, with `/api/ai/run` in Astro and `/api/run` in the Ollama Fastify service.
- Guardrail: Added `docs/agentic/orf-next-steps.md`, blocked vault/RAG claims until retrieval exists, added deterministic LilyPond template output, and hardened JSON parsing so invalid model JSON is not shown raw.
- Naming: Confirmed canonical public corpus path as `public/lilypond`; no `llily` paths were found outside temporary documentation wording.
- Navigation: Added the branch to `AGENTS.md` for future agent orientation.

<2026-04-30 forum-delete-ux-improvement> <br>
Improved UX and fixed stability in the forum.
- UX: Removed `confirm()` calls in `src/pages/foro.astro` for faster message and thread deletion.
- Fix: Resolved a 500 error in `src/pages/api/forum/threads/[threadId]/posts.ts` caused by a missing `useRemoteLilypond` variable and incorrect options passed to `renderForumMarkdown`.
- Stability: Added detailed logging and non-critical error handling for broadcast events during post creation.

<2026-04-29 post-merge-stabilization-and-perf-optimization> <br>
Stabilized the system after the feature/pod-layout-room merge, addressing performance and connection issues.
- Infrastructure: Fixed `DATABASE_URL` in `.env` to use the correct internal Docker IP (`172.18.0.2:5432`) for the VPS environment.
- DB Pool: Increased connection pool size from 3 to 20 in `src/lib/db/pool.ts` to handle production load.
- SSR Optimization: Refactored `src/lib/live/presentation-options.ts` to group content entries by course, reducing complexity from $O(N^2)$ to $O(N)$ during room initialization.
- Cleanup: Migrated wordcloud image storage from Supabase to Cloudflare R2 in `src/pages/api/live/wordcloud-image.ts`.
- Realtime: Removed Supabase Realtime dependencies from `Header.astro` and `[...slug].astro` as part of the transition to a LiveKit-based presence system.

## Recent Activity (Last 12 Commits)


<2026-04-28 supabase-to-postgres-migration> <br>
Major architectural migration from managed Supabase to self-hosted PostgreSQL on Hetzner VPS.
- Database: Created `musiki26` database on VPS (`46.225.154.68`). Successfully migrated all schema and data from Supabase using `pg_dump` and `psql` restore.
- Infrastructure: Configured project-specific database to isolate from dev environment (`musiki-dev`). Connection string updated to use `DATABASE_URL` in `.env`.
- Codebase Refactor: Systematic removal of `@supabase/supabase-js`. Migrated over 50 files (API routes, libraries, components) to use a new connection pool in `src/lib/db/pool.ts` with parameterized raw SQL queries.
- Compatibility: Implemented a `query` wrapper that preserves the `{ data, error }` pattern to minimize disruption during migration.
- Header/Dashboard: Updated complex `.astro` files to remove all remaining Supabase client dependencies. Header presence (real-time) is currently disabled pending a future LiveKit-based implementation.
- Scripts: Updated `src/scripts/sync-eval-assignment-db.mjs` to work with the new PostgreSQL backend.
- Documentation: Detailed migration log created at `docs/migrations/001-supabase-to-postgres.md`.

<2026-04-28 local-dev-ssh-tunnel-and-authentik-setup> <br>
Enabled local development via SSH tunnel and migrated authentication to Authentik OIDC.
- Local Dev: Added `scripts/db-tunnel.sh` (Bash) and `scripts/db-tunnel.fish` (Fish) to securely tunnel PostgreSQL traffic.
- Automation: Added `scripts/musiki-dev.fish` for Fish users, providing a single command to open the DB tunnel, run `npm run dev`, and cleanup the tunnel on exit.
- Environment: Updated `.env` and `.env.example` with instructions for local database connection and new Authentik OIDC variables.
- Auth: Integrated Authentik as the primary OIDC provider in `auth.config.ts`. Maintained direct Google OAuth as a secondary option for now.
- Integration: Aligned auth flow with `musiki-dev` patterns while maintaining project isolation via separate Authentik applications and PostgreSQL databases (`musiki26`).

<2026-04-28 eval-sync-supabase-network-backoff> <br>
Reduced local-dev noise and request churn when Supabase DNS/network is unavailable.
- Root cause: middleware launches eval catalog sync on several page routes. If Supabase DNS fails (`getaddrinfo ENOTFOUND ...supabase.co`), the sync tried each eval entry and logged one `[eval-sync] preguntaN: TypeError: fetch failed` per entry/request. This made unrelated room debugging look broken even though the immediate failure was network/DNS.
- Fix: `src/lib/eval-sync.ts` now normalizes Error/cause/object messages, detects fetch/DNS/network failures, logs one Supabase-network warning, stops the per-entry loop, caches the failed result, and backs off for 5 minutes before retrying.
- Note: this does not make Supabase-backed pages work offline; it prevents eval-sync middleware from flooding logs and repeatedly hammering failed DNS during room debugging. Direct Supabase render reads still need their own fallback if a page must be usable while offline.

<2026-04-28 dockview-workspace-presence-controls> <br>
Third Dockview room repair pass for SPEAKER, workspace Circle state, reactions, hand indicators, Graph, Media, and Chat focus.
- SPEAKER split root cause: presentation routing could send the session leader/presentation-circle identity and the active focused speaker into the same SPEAKER slot. Result: SPEAKER split instead of replacing the single full slot. Solution: in presentation routing, the SPEAKER slot now belongs to the focused participant only; the floating circle uses its own circle slot only when enabled.
- Workspace Circle state: added a duplicate Circle toggle in the WORKSPACES sidebar and synchronized it with the Setup/Session Circle toggle. Custom workspace saves now store `{ settings: { showCircle } }` alongside Dockview layout JSON, and applying a saved workspace restores the Circle state.
- Hand/Reactions: cloned Chat pods were not reliable targets for direct listeners. Raise-hand and reaction clicks now use delegated room-root handling, and all visible hand buttons sync active/disabled state. Roster rows now show a hand marker next to users with `handRaised` metadata, while video cards continue to show the hand overlay.
- Reaction overlay: old reactions depended on the fixed legacy stage overlay. Reactions now create/use a `.conference-reactions-layer` inside the largest visible Dockview view/pod body, so bursts appear above the currently visible workspace area.
- Graph pod: the graph script previously initialized only the original hidden/global ID nodes, so cloned Graph pods could show controls without the ForceGraph canvas. Graph initialization is now exposed as `window.MusikiGraphPodInit()` and called for each cloned Graph pod with root-scoped selectors.
- Media search: cloned External Media pods now retarget status/results/input refs and bind their open button during pod init, so YouTube API search results render in the active pod rather than hidden template nodes.
- Chat shortcut: the bottom-bar Chat action now focuses an existing Chat pod. If no Chat pod exists, it opens one as a right-side column (~20%) instead of replacing the whole workspace.

<2026-04-28 dockview-grid-speaker-routing> <br>
Focused repair for GRID video routing and SPEAKER active-speaker switching after Dockview.
- GRID root cause: Dockview workspaces can display a real `grid-videos` pod while the legacy stage layout value remains `presentation` or `teacher`. Participant routing still sent non-focused users to the old `students` slot, which now often lives hidden inside the roster/template area, so cameras were active but cards/videos mounted into invisible DOM.
- GRID fix: `resolveParticipantTargetSlot()` now checks whether teacher/grid/students/circle slots are real usable runtime elements (connected, not inside `#musiki-pod-templates`, not hidden/display-none). It routes focused users to the visible SPEAKER pod when available and routes secondary participants to the visible GRID pod when the old students slot is hidden or absent.
- SPEAKER root cause: `chooseFocusParticipantIdentity()` kept the current focused identity if that participant appeared anywhere in LiveKit's `activeSpeakers` array. LiveKit can include multiple active speakers, so a previously focused teacher could remain sticky even when another participant became the top active speaker.
- SPEAKER fix: focus now only stays immediately when the current participant is the top live speaker. If another camera-enabled participant becomes top speaker, the existing 1.4s hysteresis prevents jitter, then focus switches to the real top speaker.

<2026-04-28 dockview-room-controller-rebinding> <br>
Second-wave Dockview room repair for participant media, chat, presentation, external media, and whiteboard.
- Root cause: `selectRoomElements(root)` and several controllers still assumed one stable DOM tree. After Dockview, the room contains hidden pod templates plus runtime cloned pods; plain `querySelector()` could bind to hidden templates or stale elements, while cloned pod elements lacked controller bindings.
- Selector fix: added template-aware runtime preference in `src/scripts/room/core/elements.ts` for slots and pod controls (`teacher`, `grid`, `screen`, `students`, presentation iframe/select, chat, external media, concepts, whiteboard). Runtime clones are preferred; hidden templates remain only as fallback for early initialization.
- Speaker/Grid fix: `syncParticipantVideo()` and `syncScreenVideo()` now verify that an existing media wrapper is still connected and inside the current card before skipping reattach. This prevents roster-active/video-blank states after Dockview moves or recreates cards.
- Chat fix: `RoomChatController` now supports `bindElements()` and can rebind to cloned chat pods while preserving chat history. `RoomWorkspaceManager` calls `onChatInit()` when a chat pod is cloned, and workspace changes retarget chat refs.
- Presentation fix: `PresentationController` can retarget iframe/placeholder elements via `setElements()`. Presentation iframe load handling is delegated from the room root so newly cloned presentation iframes still trigger slide/session sync.
- External Media fix: cloned media pod init retargets the active search input/result containers before wiring input/Enter handlers, so pasted YouTube URLs and search share the same active pod state.
- Whiteboard fix: remote whiteboard messages are now fanned out to all active `WhiteboardController` instances instead of only the original controller, so cloned pizarra pods can receive WebRTC/DataChannel strokes/background/clear events.

<2026-04-28 room-audio-lily-regression-fixes> <br>
Fixed live room regressions introduced during the Dockview pod migration, with causes documented for future debugging.
- Hyperpiano no-audio bug: MIDI/WebRTC note events were arriving, samples existed, and `HyperpianoController` could trigger notes, but `ensureIncomingAudioContext()` connected `hpAudioGroupPannerNode` to `incomingAudioMasterGainNode` before the master node was created. Result: HP channel graph was partially wired/invalid, so channel 4 could receive activity without audible output. Solution: create incoming master gain/panner/analyser first, then wire `hpAudioGroupGainNode -> hpAudioGroupPannerNode -> incomingAudioMasterGainNode`, plus HP analyser and FX sends.
- Hyperpiano reconnect cleanup: `cleanupIncomingAudioContext()` cleared incoming mixer nodes but left HP node refs alive. Result: future pod/audio init could hold stale nodes from a closed `AudioContext`. Solution: null all `hpAudio*` refs during incoming audio cleanup.
- Lily Code duplicated CodeMirror: `lilypondLive.init(root, ...)` enhanced the hidden `#musiki-pod-templates` source before Dockview cloned it. Every `lily-code` pod then cloned an already-enhanced template and got enhanced again, producing double CodeMirror/editor UI. Solution: remove root-level Lily init and initialize only cloned pod containers via `onLilypondInit`.
- Lily controller lifecycle: repeated Dockview layout changes and split pod init stacked editor setup, document click listeners, playback listeners, and resizer handlers. Solution: make `LilyPondLiveController.init()` incremental/idempotent with `editorReady`, one-time document/playback listeners, per-container resizer guards, and cleanup of stale CodeMirror/action nodes before a deliberate re-enhance.
- Lily Render pod clearing/play regression: workspace changes called root-level Lily init and `clearPreview()`, so render content could disappear when the workspace moved or when playback caused room events. Solution: stop clearing preview during init; if a new render pod appears, re-render the last published snapshot into it.
- Lily miniplayer play button erasing pod: play clicks could bubble/default into surrounding pod/form/workspace UI. Solution: add `preventDefault()` alongside `stopPropagation()` in the miniplayer click handler.
- Sidebar toggle not toggling: the stored `sidebarToggleButton` reference was fragile after workspace/Dockview DOM churn, and the toggle sat under other layers. Solution: delegate `[data-action="sidebar-toggle"]` clicks from the room root and raise `.conference-sidebar-toggle` z-index.
- Dockview Lily pod ID lesson: timestamped IDs such as `lily-code-...` must be resolved by matching known pod type prefixes, not by `split('-')[0]`, otherwise hyphenated pod IDs collapse to `lily` and templates/controllers are missed.

<2026-04-27 refurbish-workspace-hospital-completed> <br>
Completed "Workspace Hospital" REFURBISH operation. 
- Fixed LilyPond multi-pod conflict by refactoring `LilyPondLiveController` to support incremental initialization across split pods (`lily-code` and `lily-render`).
- Restored visible toolbars for LilyPond and restored Dockview separators to enable workspace splitting (6-dot handle fix).
- Improved `RoomWorkspaceManager` replacement logic to add new pods before closing old ones, maintaining correct layout order and reference panels.
- Restored search functionality in `Concepts` and `Media` pods by adding explicit initialization callbacks (`onConceptInit`, `onMediaInit`) to bind events to cloned DOM elements.

<2026-04-22 mosaic-horizontal-split-and-url-fixes> <br>
Updated `stage-frame.css` to implement a mandatory horizontal split for the "Mosaico" mode (Concept + Presentation), ensuring the **Concept is on top** and the **Presentation (Reveal) is on bottom** to optimize screen real estate. Removed gap (set to 0) and set background to black for a cleaner split. Refined `buildRoomQueryUrl` in `query-state.ts` to properly clean up redundant `presentation` parameters when `slides` is present, avoiding malformed URLs and potential state inconsistencies.

<2026-04-22 concept-whiteboard-shells> <br>
Implemented a "Stage Layout Orchestrator" (Split-View & Overlays) and two new interactive shells: **Concept Shell** (O) and **Whiteboard Shell** (Z). Refactored `layout-controller.ts` and `stage-frame.css` to support side-by-side layouts and floating overlays. Added modular controllers for whiteboard drawing (synchronized via LiveKit Data Channel) and dynamic concept searching/launching.

<2026-04-21 1e7a33a sidebar-fix> <br>
Modified `src/scripts/livekit-room.ts` to automatically open the sidebar when the "layout-full" (Teacher) shortcut is used. This ensures participants moved to the sidebar grid are not hidden by a collapsed sidebar in "FULL F" mode.

<2026-04-21 1e7a33a grid fixed> <br>
Refined the conference grid layout in `stage-frame.css`. Increased `min-width` of grid items to `280px` and set `grid-auto-rows` to `min-content` for better vertical flexibility. Removed restrictive `max-width` on conference tiles.

<2026-04-21 8128fde aling .conference-tile--participant .conference-tile-meta> <br>
Extensive CSS cleanup in `stage-frame.css`. Standardized quotation marks and improved selector nesting for `[data-layout="presentation"]` and `[data-layout="teacher"]`. Focused on aligning participant metadata and handling circular tile visibility.

<2026-04-21 2182a86 passing de conference-media-frame y aspectratio de RevealSlidesLayout> <br>
Improved YouTube IFrame API initialization in `RevealSlidesLayout.astro`. Added `prepareRevealIframeForApi` to ensure JS API is enabled before binding. Added support for `data-src` in iframes and fixed aspect ratio handling for media frames.

<2026-04-21 7477518 media2> <br>
(Minor update/fix related to media sync logic, likely a checkpoint for the media frame changes).

<2026-04-21 eba6e80 media> <br>
Initial work on the media frame and YouTube sync improvements.

<2026-04-21 e07db69 Test> <br>
Configuration updates for deployment. Added `VPS_FRAMEWORK_DIR` to `ecosystem.config.cjs`, updated `PATH` for PM2, and set `prerender = false` for the content-update webhook.

<2026-04-20 174b265 testing scroll grid> <br>
Major sidebar layout refactor in `room-sidebar.css`. Switched sidebar sections to `display: grid` for better scroll management. Refactored chat to use a dedicated scroller (`chatScroller`) in `livekit-room.ts` and `controller.ts` for more reliable auto-scroll.

<2026-04-20 d8870f3 aaa> <br>
Content graph update in `public/graph-data.json`. Added new entries for IA introduction, bibliography, and "Vibecoding" TP.

<2026-04-18 dd15646 padding correct for CONTENT TOC> <br>
UI refinement for the Table of Contents in `[...slug].astro`. Adjusted margins, paddings, and font sizes for a more compact and readable nested list structure.

<2026-04-18 69bf964 solved scroll> <br>
Fixed a critical scrolling issue in the main content area in `[...slug].astro`. Changed `.content-area` from `height: auto` to `height: 100%` with `overflow-y: auto` to ensure the container captures scroll events correctly on mobile and desktop. Added `docs/estrategias de url.md`.

## Known Issues / Pending
- **P0 Self-Assessment:** End-to-end testing of `eval` flow is the next major functional milestone.
- **Sidebar CSS:** Recent grid changes in sidebar are stable but need verification on small mobile screens.
- **Media Sync:** YouTube sync is robust but depends on the IFrame API loading state; added a promise-based preparation loop to mitigate race conditions.
