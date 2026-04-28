# MEMORY.md — Project Activity Log

## Recent Activity (Last 12 Commits)

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
