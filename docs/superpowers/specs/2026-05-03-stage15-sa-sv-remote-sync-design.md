# Stage 15 — SA/SV Remote File Sync + Live State Broadcast

## Overview

When a user loads an audio file into the Sonic Analyzer (SA) pod and clicks Save, the file is uploaded to R2 and a LiveKit data message broadcasts the public URL to all conference participants. Each receiver fetches the audio, computes features locally, and dispatches `sa:file-ready` — automatically populating their Sonic Visualizer (SV) pod.

Additionally, SA on/off state and SV interactive state (playback position, play/pause, heatmap tab) are broadcast in real-time so all participants mirror the teacher's view.

## Architecture

### File sync (one-time, on Save)

Three-step flow triggered by the SA save button:

1. **Upload** — SA controller POSTs the audio file to `/api/room/sa-upload`. Keys land under `room/sa/YYYY/MM/DD/<owner>-<uuid>.<ext>` to keep room audio separate from forum uploads. Returns a public R2 URL.
2. **Broadcast** — SA controller calls a `publish` callback (injected at construction, same pattern as `WhiteboardController`) with `{ type: 'sa-file-sync', url, fileName, senderName }` over the existing LiveKit RELIABLE data channel on `MESSAGE_TOPIC`.
3. **Receive & compute** — Receivers hear `sa-file-sync` in the `DataReceived` handler, fetch the audio from R2, decode via `AudioContext.decodeAudioData()`, and call `sonicAnalyzerController.loadFileFromRemote(buffer, fileName, senderName)`. If no SA controller is active, dispatch `sa:file-ready` directly so SV still populates.

### Live state sync (continuous, on user interaction)

| Trigger | Message | Receiver action |
|---|---|---|
| SA LED toggled on/off | `sa-state { active }` | `saCtrl.applyRemoteState(active)` — updates LED visual only, no analysis |
| SV play/pause button | `sv-playback { action: 'play'\|'pause', offset }` | `svCtrl.applyRemotePlayback(action, offset)` |
| SV waveform drag (on pointerup) | `sv-playback { action: 'seek', offset }` | `svCtrl.applyRemotePlayback('seek', offset)` |
| SV vtab button (mel/chr/pch) | `sv-vtab { tab }` | `svCtrl.applyRemoteVTab(tab)` |

Remote-triggered actions do **not** re-broadcast (no echo loop).

## Components

### New: `src/pages/api/room/sa-upload.ts`

- Audio-only endpoint (wav, ogg, mp3, m4a, aac, flac).
- 24 MB limit.
- Requires authenticated session.
- R2 key pattern: `room/sa/YYYY/MM/DD/<owner>-<uuid>.<ext>`
- Returns `{ success, url, key }`.

### Modified: `src/scripts/room/session/messages.ts`

Add to `ConferenceMessage` union:

```ts
| { type: 'sa-file-sync'; url: string; fileName: string; senderName: string }
| { type: 'sa-state'; active: boolean }
| { type: 'sv-playback'; action: 'play' | 'pause' | 'seek'; offset: number }
| { type: 'sv-vtab'; tab: string }
```

Add all four branches in `parseConferenceMessage`.

### Modified: `src/scripts/room/sonic-analyzer/controller.ts`

- Constructor accepts optional `publish: (msg: ConferenceMessage) => void` and `senderName: string`.
- Save button click handler: `setStatus('uploading…')` → POST to `/api/room/sa-upload` → on success publish `sa-file-sync` + `setStatus('shared ✓')` → on error `setStatus('upload failed')`.
- `activate()` / `deactivate()` → also call `publish({ type: 'sa-state', active })`.
- New public `loadFileFromRemote(buffer, fileName, senderName)`: loads buffer, `computeVizFeatures()`, status shows `synced · <senderName>`.
- New public `applyRemoteState(active: boolean)`: updates LED/button data-attrs visually only, no essentia load.

### Modified: `src/scripts/room/sonic-visualizer/controller.ts`

- Constructor accepts optional `publish: (msg: ConferenceMessage) => void`.
- `togglePlayback()` / `startPlayback()` / `pausePlayback()` → after state change, publish `sv-playback`.
- `bindWaveformInteraction()` on `pointerup` → publish `sv-playback { action: 'seek', offset }`.
- `switchVTab(tab)` → publish `sv-vtab { tab }`.
- New public `applyRemotePlayback(action, offset)`: calls `startPlayback(offset)` or `pausePlayback()`, no re-broadcast.
- New public `applyRemoteVTab(tab)`: calls `switchVTab(tab)`, no re-broadcast.

### Modified: `src/scripts/livekit-room.ts`

- Pass `publishMessage` + local participant name into both `SonicAnalyzerController` and `SonicVisualizerController`.
- In `DataReceived`, add four new branches:
  - `sa-file-sync` → fetch → decode → `loadFileFromRemote` or dispatch `sa:file-ready`
  - `sa-state` → `sonicAnalyzerController?.applyRemoteState(active)`
  - `sv-playback` → `sonicVisualizerController?.applyRemotePlayback(action, offset)`
  - `sv-vtab` → `sonicVisualizerController?.applyRemoteVTab(tab)`

### Unchanged: `src/scripts/room/sonic-visualizer/controller.ts` (event subscriptions)

SV already subscribes to `sa:file-ready`, `sa:frame`, `sa:active` — no changes to that wiring.

## Data Flow

```
Teacher drops file → SA computes → sa:file-ready locally → SV populates
                  ↓ clicks Save
              POST /api/room/sa-upload → R2 (room/sa/...)
                  ↓
              publishData sa-file-sync (LiveKit RELIABLE)
                  ↓ all participants
              fetch → decodeAudioData → loadFileFromRemote → sa:file-ready → SV populates

Teacher toggles SA  → sa-state (LiveKit) → students see LED state
Teacher plays SV    → sv-playback play/offset → students' SV starts at same offset
Teacher seeks SV    → sv-playback seek/offset → students' SV jumps to position
Teacher switches tab→ sv-vtab → students' SV switches heatmap
```

## Error Handling

- Upload failure: log + show `upload failed` in SA status; no broadcast.
- Fetch failure on receiver: log warning, silent fail.
- No SA controller on receiver for `sa-file-sync`: dispatch `sa:file-ready` with `{ buffer, fileName, peaks:[], melspec:[], chroma:[], pitches:[], key:'', scale:'', bpm:0 }` so SV waveform renders.
- No SV controller on receiver for playback/vtab messages: silently ignore.

## Privacy & Consent

- File uploaded only on explicit Save click — no auto-upload on drop.
- Public R2 URL (no expiry, same policy as forum uploads).
- Live state messages (play/seek/tab) are ephemeral — no persistence.

## Out of Scope

- Streaming real-time SA analysis frames over the network.
- Signed URL TTL management.
- Participant audio stream as remote SA source.
- Loop region UI (start/end markers) — current sync covers playhead position only.
