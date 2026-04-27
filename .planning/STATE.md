# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-27)

**Core value:** Teachers and students can interact in a fully functional live room — pods arrange freely, Hyperpiano plays, whiteboard draws, and video participants appear correctly.
**Current focus:** Phase 1 — Hyperpiano Audio & Keys

## Current Position

Phase: 1 of 2 (Hyperpiano Audio & Keys)
Plan: 1 of 1 in current phase
Status: Ready to execute
Last activity: 2026-04-27 — Phase 1 planned (1 plan, verification passed)

Progress: [░░░░░░░░░░] 0% (planning complete, execution pending)

## Performance Metrics

**Velocity:**
- Total plans completed: 0
- Average duration: -
- Total execution time: -

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Coarse granularity chosen — fixes split by file, 2 phases only
- No researcher agent — domain well-understood from handoff + code review

### Pending Todos

None yet.

### Blockers / Open Issues

- AUDIO-01: AudioContext may be suspended on first user interaction (browser autoplay policy) — must resume before `loadRoots` in HyperpianoController.ts
- AUDIO-02: Black key border `#333` not applied consistently — key separation not visible
- WSPC-01: DIY header drag triggers Dockview split-preview incorrectly — drops land in wrong position
- WSPC-02: `cloneNode(true)` copies DOM but not canvas context or listeners — cloned whiteboard is broken
- WSPC-03: `musiki:workspace:changed` handler holds stale `gridSlot` DOM reference after Dockview panel move

## Session Continuity

Last session: 2026-04-27
Stopped at: Roadmap and STATE initialized — no plans written yet
Resume file: None
