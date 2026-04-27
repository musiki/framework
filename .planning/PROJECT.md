# Musiki LMS — Room Workspace Bug Fixes (v1)

## What This Is

Musiki is an Astro-based music education LMS with a real-time collaborative Room powered by LiveKit. The Room uses Dockview Core for a dynamic pod-based workspace — panels for video, whiteboard, piano, presentation, and more — with custom DIY Shell headers replacing native Dockview tabs. This milestone fixes 5 critical bugs introduced during the DIY Shell integration and Hyperpiano CH4 audio wiring.

## Core Value

Teachers and students can interact in a fully functional live room: pods arrange freely, the Hyperpiano plays, the whiteboard draws, and video participants appear correctly.

## Requirements

### Validated

- ✓ Dockview-based pod workspace initialized with `hideTabs: true` — existing
- ✓ DIY Shell headers (`.pod-diy-header`) wrapping each pod panel — existing
- ✓ Pod gallery with HTML5 drag-and-drop and click-to-toggle — existing
- ✓ Hyperpiano wired to CH4 (`hpAudioGroupGainNode → mixerHPGain → masterOut`) — existing
- ✓ Multi-octave keyboard shortcuts (`zsxdcvgbhnjm`, `q2w3er5t6y7u`, `i9o0p[]`) — existing
- ✓ Whiteboard multi-instance via `cloneNode(true)` in `createComponent` — existing (broken)
- ✓ Grid videos pod receiving LiveKit participant tracks — existing (broken)
- ✓ Workspace preset save/load via `localStorage` — existing
- ✓ LiveKit layout sync: teacher layout JSON → students via `session-workspace` message — existing

### Active

- [ ] Fix drag-and-drop: DIY headers trigger Dockview split-preview logic
- [ ] Fix audio: AudioContext resumed before `loadRoots` in Hyperpiano
- [ ] Fix whiteboard: cloned panels reinitialize `WhiteboardController` instead of sharing broken canvas context
- [ ] Fix grid: participant video slots remount correctly after Dockview panel move
- [ ] Fix black keys: border `#333` applied consistently, key separation visible

### Out of Scope

- Redesigning the DIY Shell header visual style — aesthetic is correct, only behavior bugs
- Refactoring `livekit-room.ts` beyond the grid slot remount fix — file is >10k lines, scope creep risk
- Adding new pod types or workspace presets — not part of this fix milestone
- CSS/design system changes beyond the black key border fix

## Context

- **Files affected**: `src/scripts/room/workspace/RoomWorkspaceManager.ts`, `src/scripts/room/hyperpiano/HyperpianoController.ts`
- **Architecture docs**: `docs/room/pod-layout.md` (pod system), `docs/room/roomMermaid.md` (component map), `docs/room/media-sync.md` (playback sync)
- **Agent rules**: Log all changes in `MEMORY.md`. CSS vars from `src/styles/theme.css`. Avoid `any` types.
- **Dockview version**: `dockview-core`, initialized with `disableProportionalLayout: true`, `hideTabs: true`
- **Audio chain**: Hyperpiano → `hpAudioGroupGainNode` → `mixerHPGain` → `masterOut`. AudioContext may be suspended on first user interaction (browser autoplay policy).
- **Whiteboard**: `cloneNode(true)` copies DOM but not canvas 2D context or event listeners. Every cloned instance needs a fresh `WhiteboardController`.
- **Grid sync**: `musiki:workspace:changed` event fires on layout change, but DOM re-selection of `gridSlot` uses stale reference after Dockview moves the panel.

## Constraints

- **Tech stack**: Astro + TypeScript + Dockview Core + LiveKit — no framework changes
- **Modularization**: `livekit-room.ts` is >10k lines. Changes should be surgical — no broad refactors
- **Types**: No `any` additions. Existing `any` in `createComponent` params is acceptable (Dockview API), don't propagate
- **MEMORY.md**: All changes must be logged in `MEMORY.md` with date and description

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Coarse granularity: 2 phases | Fixes split naturally by file — Phase 1 = HyperpianoController.ts, Phase 2 = RoomWorkspaceManager.ts | — Pending |
| No researcher agent | Domain is well-understood from handoff + code review; Dockview/WebAudio APIs are stable | — Pending |
| Plan Check enabled | DnD hit-testing and whiteboard re-init are non-trivial; plan verification prevents wrong approaches | — Pending |
| `disableProportionalLayout: true` | Prevents fractional size drift after layout restore | — Pending |

---

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition:**
1. Requirements fixed? → Move to Validated with phase reference
2. New bugs discovered? → Add to Active
3. Decisions to log? → Add to Key Decisions
4. "What This Is" still accurate? → Update if drifted

**After milestone:**
1. Full review of all sections
2. Log changes in `MEMORY.md`
3. Update `docs/room/pod-layout.md` if architecture changed

---
*Last updated: 2026-04-27 after initialization*
