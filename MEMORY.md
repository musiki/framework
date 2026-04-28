# MEMORY.md — Project Activity Log

## Recent Activity (Last 12 Commits)

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
