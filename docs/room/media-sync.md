# Media Synchronization Pattern

This document outlines the design pattern used to synchronize external embedded media (specifically YouTube videos) between the teacher's presentation and the students' views in a LiveKit room.

## Overview

The core objective is to ensure that when a teacher plays, pauses, or seeks a video embedded inside a Reveal.js presentation, all connected students experience the exact same playback state in real-time.

This requires bidirectional communication:
1. **Reveal.js ↔ LiveKit Room**: The `RevealSlidesLayout.astro` (running in an `iframe`) communicates via `postMessage` with the parent `livekit-room.ts`.
2. **Teacher's Room ↔ Student's Room**: `livekit-room.ts` broadcasts state changes via LiveKit Data Channels (`RoomEvent.DataReceived`).

## Challenges with Reveal.js and YouTube IFrames

Reveal.js lazy-loads iframes by taking the `data-src` attribute and moving it to `src` only when the slide becomes visible. 

The YouTube IFrame API (`YT.Player`) requires the `iframe` to have `enablejsapi=1` and `origin` parameters in its URL to accept programmatic control. 

A common race condition occurs when setting up `YT.Player`:
If you programmatically change the `src` of an iframe to append `enablejsapi=1`, the iframe starts navigating/reloading. If you immediately call `new YT.Player(iframe)` before the reload finishes, the API binds to the old `Window` context (which is destroyed moments later), meaning the `onReady` event never fires and the player cannot be controlled.

## The Solution Pattern

### 1. Early Normalization (`normalizeSlideEmbeds`)
To prevent the race condition, we parse the DOM as soon as the presentation loads. We look for any `iframe` with a YouTube URL (in either `src` or `data-src`). We then:
- Append `enablejsapi=1` and `origin`.
- Set `data-musiki-reveal-media-provider="youtube"`.
- Extract and set the `mediaId` into `data-musiki-reveal-media-id`.
- Generate a unique `embedId` if one is missing.

This ensures that when Reveal.js eventually lazy-loads the iframe by copying `data-src` to `src`, the URL already contains the correct API parameters.

### 2. Awaiting Iframe Navigation (`prepareRevealIframeForApi`)
When the slide is activated, `ensureRevealEmbeddedPlayer(iframe)` is called. It relies on `prepareRevealIframeForApi` to verify the `src` has the correct API parameters.

If the parameters are missing (e.g. from dynamic modification), `prepareRevealIframeForApi` updates the `src` **and returns a Promise that waits for the `load` event**.
This ensures that `new YT.Player(iframe)` is strictly called only when the iframe is fully loaded and stable.

**Crucial Note on Lazy Loading**: If `prepareRevealIframeForApi` updates a `data-src` attribute instead of `src`, it resolves immediately without waiting for `load`, because the load won't happen until Reveal.js activates the slide.

### 3. Deterministic Session Leadership
Synchronization authority is strictly tied to the **Session Leader**. All participants (teachers and students) must agree on who the leader is to either broadcast (if leader) or accept (if follower) media state updates.

The agreement is reached via a deterministic sorting of all teachers in the room:
1. Primary sort: `joinedAt` timestamp (earliest joiner has priority).
2. Secondary sort: `identity` string comparison (alphabetical).

By removing local-priority from the fallback sorting, we ensure that every peer in the room independently arrives at the exact same leader identity.

### 4. State Broadcasting and Debouncing
When the teacher interacts with the video:
1. The YouTube `onStateChange` event fires in `RevealSlidesLayout.astro`.
2. The current `playbackState` (playing/paused) and `currentTime` are packaged into a snapshot.
3. The snapshot is sent to the parent (`livekit-room.ts`) via `postMessage('musiki:reveal-embedded-media')`.
4. `livekit-room.ts` sends a LiveKit data channel message (`type: 'presentation-media'`).

To ensure robustness, `RevealSlidesLayout.astro` runs a sync loop (`syncRevealEmbeddedMediaLoop`) that periodically (every 800ms) broadcasts the current time while the video is playing.

### 5. Remote State Application and Latency Compensation
When a student receives the `presentation-media` message:
1. `livekit-room.ts` posts `'musiki:reveal-embedded-media-sync'` down to `RevealSlidesLayout.astro`.
2. `getRevealEmbeddedTargetIframe` locates the correct iframe using `embedId` or `mediaId`.
3. `ensureRevealEmbeddedPlayer` initializes the API if it isn't ready yet.
4. `applyRevealEmbeddedMediaState` executes the state change:
   - **Latency Compensation**: The target time is adjusted by calculating the elapsed time since the teacher captured the state (`now - capturedAt`).
   - Compares the adjusted `targetTime` with the actual `currentTime`.
   - If the difference exceeds `REVEAL_EMBEDDED_MEDIA_SEEK_THRESHOLD_S` (0.8s), it triggers `player.seekTo(targetAdjustedTime)`.
   - It matches the `playbackState` by calling `playVideo()` or `pauseVideo()`.

## Summary
The combination of early URL normalization, strict `load` event awaiting before `YT.Player` binding, deterministic leadership agreement, and adjusted latency compensation guarantees that the YouTube IFrame API initializes correctly and playback state remains perfectly synchronized across all peers.
