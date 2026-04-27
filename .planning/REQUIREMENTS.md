# Requirements: Musiki Room Workspace Bug Fixes

**Defined:** 2026-04-27
**Core Value:** Teachers and students can interact in a fully functional live room — pods arrange freely, Hyperpiano plays, whiteboard draws, video participants appear correctly.

## v1 Requirements

### Audio (Hyperpiano CH4)

- [ ] **AUDIO-01**: Hyperpiano produces sound on first load without requiring page reload — AudioContext resumed before `loadRoots`
- [ ] **AUDIO-02**: Black piano keys display visible border separation (`#333`) matching key width

### Workspace Layout (Dockview + DIY Shell)

- [ ] **WSPC-01**: Dragging a DIY header triggers Dockview's split-preview visualization and drops the panel into the correct split position
- [ ] **WSPC-02**: Opening a second whiteboard (pizarra) instance creates a fully functional independent canvas with its own `WhiteboardController`
- [ ] **WSPC-03**: Grid pod remounts participant video tracks correctly after the panel is moved via Dockview drag-and-drop

## v2 Requirements

### Polish

- **POL-01**: Drag ghost image for DIY header shows pod title and color during drag
- **POL-02**: Workspace save uses inline input field instead of `window.prompt()`
- **POL-03**: Pod picker menu accessible via keyboard (arrow keys + enter)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Redesigning DIY Shell header visuals | Aesthetic is correct — behavior bugs only |
| Refactoring livekit-room.ts beyond grid slot fix | File >10k lines — surgical changes only |
| New pod types | Not part of this bug-fix milestone |
| CSS design system changes beyond black key border | Out of scope for this milestone |
| WhiteboardController state sync between multiple instances | Complex feature — v2+ |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| AUDIO-01 | Phase 1 | Pending |
| AUDIO-02 | Phase 1 | Pending |
| WSPC-01 | Phase 2 | Pending |
| WSPC-02 | Phase 2 | Pending |
| WSPC-03 | Phase 2 | Pending |

**Coverage:**
- v1 requirements: 5 total
- Mapped to phases: 5
- Unmapped: 0 ✓

---
*Requirements defined: 2026-04-27*
*Last updated: 2026-04-27 — phase assignments confirmed after roadmap creation*
