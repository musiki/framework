---
status: resolved
trigger: "Students can move pods/open files and cannot reliably upload files to Recursos or Chat; opening an image causes the room UI to flicker."
created: 2026-06-29
updated: 2026-06-29
---

## Symptoms

- Expected: only the session lead teacher can move pods, reconfigure the screen, or open files.
- Expected: students can upload files only through Recursos and Chat.
- Actual: student-originated workspace/media/resource messages can mutate the shared room.
- Actual: Recursos student uploads use the full-state synchronization/save path.
- Reproduction: connect teacher and student, then open an image or alter a pod from the student client.

## Current Focus

- hypothesis: upload permission was conflated with resource/media/layout control, and authoritative incoming message types lack a teacher-leader check.
- test: split the upload-only path and reject non-leader control messages, then typecheck/build.
- expecting: student uploads remain possible without allowing pod/layout/media control.
- next_action: resolved; monitor a real teacher/student LiveKit session after deploy.

## Evidence

- timestamp: 2026-06-29
  finding: RecursosController canEdit/canSendSonic/canSendVisual all return true.
- timestamp: 2026-06-29
  finding: session-workspace, layout-split, layout-overlay, VS and SA messages are handled before the shared teacher-leader gate.
- timestamp: 2026-06-29
  finding: Recursos uploads call full-state broadcast and replacement persistence.

## Eliminated

- hypothesis: room.astro itself performs the live permission checks.
  reason: it only resolves and passes the initial participant role; live authority is implemented in livekit-room.ts and the pod controllers.

## Resolution

- root_cause: student upload permission had been implemented by globally enabling resource editing/media control, while several workspace/layout/media messages were accepted before teacher-leader authorization.
- fix: separated append-only uploads from room control, restricted full resource replacement and all pod/layout/media authority to the session lead teacher, and prevented workspace-level DnD from intercepting file drops.
- verification: production Astro build passes; 76 automated tests pass; local student render reports a locked Dockview, disabled pod handles/close buttons, present Recursos and Chat dropzones, and no browser console errors.
- files_changed: src/pages/api/live/recursos.ts, src/pages/api/room/re-store.ts, src/scripts/livekit-room.ts, src/scripts/room/recursos/controller.ts, src/scripts/room/session/messages.ts, src/scripts/room/workspace/RoomWorkspaceManager.ts
