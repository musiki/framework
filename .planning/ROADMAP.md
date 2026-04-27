# Roadmap: Musiki Room Workspace Bug Fixes

## Overview

Two-phase bug-fix milestone targeting 5 critical regressions introduced during the DIY Shell integration and Hyperpiano CH4 audio wiring. Phase 1 resolves all HyperpianoController.ts issues (audio and visual). Phase 2 resolves all RoomWorkspaceManager.ts issues (DnD, whiteboard, grid video).

## Phases

- [x] **Phase 1: Hyperpiano Audio & Keys** - AudioContext suspend bug and black key border rendering fixed (2026-04-27)
- [ ] **Phase 2: Workspace Layout** - DIY header drag, whiteboard clone, and grid video remount fixed

## Phase Details

### Phase 1: Hyperpiano Audio & Keys
**Goal**: The Hyperpiano produces sound on first interaction and renders black key borders correctly, with no page reload required.
**Depends on**: Nothing (first phase)
**Requirements**: AUDIO-01, AUDIO-02
**Success Criteria** (what must be TRUE):
  1. Pressing a piano key immediately plays audio the first time without requiring a page reload
  2. Black piano keys display a visible `#333` border that separates each key from adjacent keys
  3. No console errors related to AudioContext state during Hyperpiano initialization
**Key files**:
  - `src/scripts/room/hyperpiano/HyperpianoController.ts`
**Plans**: `01-01-PLAN.md` (Wave 1 — autonomous)
**Status**: Complete (2026-04-27)

### Phase 2: Workspace Layout
**Goal**: Pods can be dragged and arranged freely via DIY headers, duplicate whiteboards are fully functional, and grid video participants display correctly after any panel move.
**Depends on**: Phase 1
**Requirements**: WSPC-01, WSPC-02, WSPC-03
**Success Criteria** (what must be TRUE):
  1. Dragging a DIY pod header shows Dockview's split-preview indicator and drops the panel into the correct target position
  2. Opening a second whiteboard (pizarra) instance creates an independent, drawable canvas — strokes on one do not affect the other
  3. Moving the grid pod via drag-and-drop remounts participant video tracks correctly in all slots — no blank or frozen tiles
**Key files**:
  - `src/scripts/room/workspace/RoomWorkspaceManager.ts`
**Plans**: TBD
**Status**: Pending

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Hyperpiano Audio & Keys | 1/1 | Complete | 2026-04-27 |
| 2. Workspace Layout | 0/TBD | Not started | - |
