# Stage 15 — SA/SV Remote File Sync + Live State Broadcast Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Broadcast SA file uploads to all room participants via R2 + LiveKit, and sync SV playback position, play/pause, heatmap tab, and SA active state in real-time.

**Architecture:** SA controller uploads audio to a dedicated R2 folder (`room/sa/`), broadcasts a `sa-file-sync` LiveKit message; receivers fetch, decode, and compute features locally. Interactive SV state (play/pause/seek, vtab) and SA on/off are broadcast as lightweight LiveKit messages handled by new public `applyRemote*` methods on both controllers.

**Tech Stack:** Astro API routes, `@aws-sdk/client-s3`, LiveKit `publishData` (RELIABLE), Web Audio API (`AudioContext.decodeAudioData`), TypeScript.

---

## File Map

| Action | File |
|---|---|
| Create | `src/pages/api/room/sa-upload.ts` |
| Modify | `src/scripts/room/session/messages.ts` |
| Modify | `src/scripts/room/sonic-analyzer/controller.ts` |
| Modify | `src/scripts/room/sonic-visualizer/controller.ts` |
| Modify | `src/scripts/livekit-room.ts` |

---

### Task 1: New R2 upload endpoint for SA audio

**Files:**
- Create: `src/pages/api/room/sa-upload.ts`

- [ ] **Step 1: Create the endpoint file**

```typescript
// src/pages/api/room/sa-upload.ts
import type { APIRoute } from 'astro';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { json } from '../../../lib/forum-server';
import { getR2BucketName, getR2Client, getR2PublicObjectUrl } from '../../../lib/r2';

const AUDIO_MIME: Record<string, string> = {
  'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav',
  'audio/wave': 'wav', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a',
  'audio/aac': 'aac', 'audio/flac': 'flac', 'audio/x-flac': 'flac',
};
const AUDIO_EXTS = new Set(['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac']);
const MAX_BYTES = 24 * 1024 * 1024;

function guessExt(file: File): string {
  const mime = String(file.type || '').toLowerCase();
  if (AUDIO_MIME[mime]) return AUDIO_MIME[mime];
  const m = String(file.name || '').match(/\.([a-z0-9]+)$/i);
  return m ? m[1].toLowerCase() : 'bin';
}

function buildKey(file: File, owner: string): string {
  const now = new Date();
  const y = String(now.getUTCFullYear());
  const mo = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  const ext = guessExt(file);
  const safe = String(owner || 'anon')
    .toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'anon';
  return `room/sa/${y}/${mo}/${d}/${safe}-${crypto.randomUUID()}.${ext}`;
}

export const POST: APIRoute = async ({ request, locals }) => {
  const session = (locals as any).session;
  const email = typeof session?.user?.email === 'string' ? session.user.email.trim() : '';
  if (!email) return json({ error: 'Not authenticated' }, 401);

  try {
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return json({ error: 'No audio file provided.' }, 400);

    const mime = String(file.type || '').toLowerCase();
    const ext = guessExt(file);
    if (!mime.startsWith('audio/') && !AUDIO_EXTS.has(ext))
      return json({ error: 'Only audio files are accepted.' }, 415);
    if (file.size <= 0) return json({ error: 'File is empty.' }, 400);
    if (file.size > MAX_BYTES) return json({ error: 'Audio exceeds 24 MB limit.' }, 413);

    const key = buildKey(file, email);
    await getR2Client().send(new PutObjectCommand({
      Bucket: getR2BucketName(),
      Key: key,
      Body: new Uint8Array(await file.arrayBuffer()),
      ContentType: file.type || 'audio/octet-stream',
      CacheControl: 'public, max-age=31536000, immutable',
    }));

    return json({ success: true, url: getR2PublicObjectUrl(key), key });
  } catch (e: any) {
    console.error('[sa-upload]', e);
    if (String(e?.message || '').includes('R2_NOT_CONFIGURED'))
      return json({ error: 'R2 not configured.' }, 503);
    return json({ error: e?.message || 'Upload failed.' }, 500);
  }
};
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/zztt/projects/26-musiki/framework && npx tsc --noEmit 2>&1 | grep sa-upload
```

Expected: no output (no errors).

- [ ] **Step 3: Commit**

```bash
git add src/pages/api/room/sa-upload.ts
git commit -m "feat(stage15): add /api/room/sa-upload endpoint for SA audio files"
```

---

### Task 2: Add 4 new message types to ConferenceMessage

**Files:**
- Modify: `src/scripts/room/session/messages.ts`

- [ ] **Step 1: Add 4 new types to the ConferenceMessage union**

In `src/scripts/room/session/messages.ts`, find the last entry in the `ConferenceMessage` union (the `external-media` `action: 'open' | 'sync'` variant ending with `};`) and append after the closing `};`:

```typescript
  | {
      type: 'sa-file-sync';
      url: string;
      fileName: string;
      senderName: string;
      key: string;
      scale: string;
      bpm: number;
    }
  | {
      type: 'sa-state';
      active: boolean;
    }
  | {
      type: 'sv-playback';
      action: 'play' | 'pause' | 'seek';
      offset: number;
    }
  | {
      type: 'sv-vtab';
      tab: string;
    };
```

Note: remove the existing `};` at the end of the union and replace with these four variants ending in `};`.

- [ ] **Step 2: Add 4 parse branches in `parseConferenceMessage`**

In `src/scripts/room/session/messages.ts`, find the last `return null;` at the end of `parseConferenceMessage` (just before the closing `} catch` block) and insert these branches before it:

```typescript
    if (parsed.type === 'sa-file-sync') {
      const url = normalizeText((parsed as { url?: string }).url);
      if (!url) return null;
      return {
        type: 'sa-file-sync',
        url,
        fileName: normalizeText((parsed as { fileName?: string }).fileName) || 'audio',
        senderName: normalizeText((parsed as { senderName?: string }).senderName) || 'Participant',
        key: normalizeText((parsed as { key?: string }).key) || '',
        scale: normalizeText((parsed as { scale?: string }).scale) || '',
        bpm: Math.max(0, Number((parsed as { bpm?: number }).bpm) || 0),
      };
    }

    if (parsed.type === 'sa-state') {
      return {
        type: 'sa-state',
        active: Boolean((parsed as { active?: boolean }).active),
      };
    }

    if (parsed.type === 'sv-playback') {
      const action = normalizeText((parsed as { action?: string }).action);
      if (action !== 'play' && action !== 'pause' && action !== 'seek') return null;
      return {
        type: 'sv-playback',
        action,
        offset: Math.max(0, Number((parsed as { offset?: number }).offset) || 0),
      };
    }

    if (parsed.type === 'sv-vtab') {
      return {
        type: 'sv-vtab',
        tab: normalizeText((parsed as { tab?: string }).tab) || 'mel',
      };
    }
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /Users/zztt/projects/26-musiki/framework && npx tsc --noEmit 2>&1 | grep messages
```

Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add src/scripts/room/session/messages.ts
git commit -m "feat(stage15): add sa-file-sync, sa-state, sv-playback, sv-vtab message types"
```

---

### Task 3: SA controller — save upload, file sync broadcast, remote state

**Files:**
- Modify: `src/scripts/room/sonic-analyzer/controller.ts`

- [ ] **Step 1: Add imports and extend SonicAnalyzerOptions**

At the top of `src/scripts/room/sonic-analyzer/controller.ts`, add the ConferenceMessage import after the existing imports:

```typescript
import type { ConferenceMessage } from '../session';
```

Change `SonicAnalyzerOptions` from:
```typescript
export type SonicAnalyzerOptions = { container: HTMLElement; getAudioTap: AudioTapFn; };
```
to:
```typescript
export type SonicAnalyzerOptions = {
  container: HTMLElement;
  getAudioTap: AudioTapFn;
  publish?: (msg: ConferenceMessage) => void;
  getSenderName?: () => string;
};
```

- [ ] **Step 2: Export `computeWaveformPeaks` and add private fields**

Change `function computeWaveformPeaks` (near bottom of file) from:
```typescript
function computeWaveformPeaks(buffer: AudioBuffer): { min: number; max: number }[] {
```
to:
```typescript
export function computeWaveformPeaks(buffer: AudioBuffer): { min: number; max: number }[] {
```

In the `SonicAnalyzerController` class, add two private fields after `private lastFilePayload: SAFilePayload | null = null;`:
```typescript
  private publish?: (msg: ConferenceMessage) => void;
  private getSenderName: () => string;
```

- [ ] **Step 3: Store options in constructor and wire save button**

In the constructor, after `this.container = options.container;`:
```typescript
    this.publish = options.publish;
    this.getSenderName = options.getSenderName ?? (() => '');
```

In `bindDOM()`, after `this.saveBtnEl     = q<HTMLButtonElement>('[data-sa-save]')!;`, add:
```typescript
    this.saveBtnEl.addEventListener('click', () => void this.handleSave());
```

- [ ] **Step 4: Add `handleSave` method**

Add this method after `showFileMeta`:
```typescript
  private async handleSave(): Promise<void> {
    if (!this.fileBuffer || !this.loadedFileName) return;
    this.setStatus('uploading…');
    try {
      const blob = await audioBufferToWav(this.fileBuffer);
      const formData = new FormData();
      formData.append('file', new File([blob], this.loadedFileName, { type: 'audio/wav' }));
      const res = await fetch('/api/room/sa-upload', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok || !data.url) throw new Error(data.error || 'Upload failed');
      this.publish?.({
        type: 'sa-file-sync',
        url: data.url,
        fileName: this.loadedFileName,
        senderName: this.getSenderName(),
        key: this.fileKey,
        scale: this.fileScale,
        bpm: this.fileBpm,
      });
      this.setStatus(`shared ✓ · ${this.activeSource} · ${this.fps}fps`);
    } catch (e: any) {
      console.error('[sA] upload error', e);
      this.setStatus('upload failed');
    }
  }
```

Also add this helper function at the bottom of the file (after `tick`):
```typescript
function audioBufferToWav(buffer: AudioBuffer): Promise<Blob> {
  const numChannels = 1;
  const sampleRate = buffer.sampleRate;
  const data = buffer.getChannelData(0);
  const byteRate = sampleRate * numChannels * 2;
  const blockAlign = numChannels * 2;
  const dataLen = data.length * 2;
  const ab = new ArrayBuffer(44 + dataLen);
  const view = new DataView(ab);
  const w = (off: number, val: number, bytes: number) => {
    if (bytes === 4) view.setUint32(off, val, true);
    else if (bytes === 2) view.setUint16(off, val, true);
  };
  const ws = (off: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  ws(0, 'RIFF'); w(4, 36 + dataLen, 4); ws(8, 'WAVE');
  ws(12, 'fmt '); w(16, 16, 4); w(20, 1, 2); w(22, numChannels, 2);
  w(24, sampleRate, 4); w(28, byteRate, 4); w(32, blockAlign, 2); w(34, 16, 2);
  ws(36, 'data'); w(40, dataLen, 4);
  const samples = new Int16Array(ab, 44);
  for (let i = 0; i < data.length; i++) samples[i] = Math.max(-32768, Math.min(32767, data[i] * 32767));
  return Promise.resolve(new Blob([ab], { type: 'audio/wav' }));
}
```

- [ ] **Step 5: Broadcast `sa-state` on toggle**

In `activate()`, after `window.dispatchEvent(new CustomEvent('sa:active', { detail: { active: true } }));`, add:
```typescript
    this.publish?.({ type: 'sa-state', active: true });
```

In `deactivate()`, after `window.dispatchEvent(new CustomEvent('sa:active', { detail: { active: false } }));`, add:
```typescript
    this.publish?.({ type: 'sa-state', active: false });
```

- [ ] **Step 6: Add `loadFileFromRemote` and `applyRemoteState` public methods**

Add after `removeParticipantSource`:
```typescript
  public loadFileFromRemote(
    buffer: AudioBuffer,
    fileName: string,
    senderName: string,
    key = '',
    scale = '',
    bpm = 0,
  ): void {
    this.fileBuffer = buffer;
    this.loadedFileName = fileName;
    this.fileKey = key;
    this.fileScale = scale;
    this.fileBpm = bpm;
    this.addFileOption(fileName);
    this.showFileMeta(fileName);
    const peaks = computeWaveformPeaks(buffer);
    const payload: SAFilePayload = { buffer, fileName, peaks, melspec: [], chroma: [], pitches: [], key, scale, bpm };
    this.lastFilePayload = payload;
    window.dispatchEvent(new CustomEvent('sa:file-ready', { detail: payload }));
    this.setStatus(`synced · ${senderName}`);
    if (this.essentia) void this.computeVizFeatures();
  }

  public applyRemoteState(active: boolean): void {
    this.setStatus(active ? 'remote · on' : 'remote · off');
  }
```

- [ ] **Step 7: Verify TypeScript compiles**

```bash
cd /Users/zztt/projects/26-musiki/framework && npx tsc --noEmit 2>&1 | grep "sonic-analyzer"
```

Expected: no output.

- [ ] **Step 8: Commit**

```bash
git add src/scripts/room/sonic-analyzer/controller.ts
git commit -m "feat(stage15): SA save button uploads to R2, broadcasts sa-file-sync and sa-state"
```

---

### Task 4: SV controller — playback/vtab broadcast + remote apply methods

**Files:**
- Modify: `src/scripts/room/sonic-visualizer/controller.ts`

- [ ] **Step 1: Add import and extend SVOptions**

At the top of `src/scripts/room/sonic-visualizer/controller.ts`, add after existing imports:
```typescript
import type { ConferenceMessage } from '../session';
```

Change `SVOptions` from:
```typescript
export type SVOptions = { container: HTMLElement };
```
to:
```typescript
export type SVOptions = { container: HTMLElement; publish?: (msg: ConferenceMessage) => void };
```

- [ ] **Step 2: Add private `publish` field and store in constructor**

Add after `private isDragging = false;`:
```typescript
  private publish?: (msg: ConferenceMessage) => void;
```

In the constructor, after `this.container = options.container;`:
```typescript
    this.publish = options.publish;
```

- [ ] **Step 3: Extract internal vtab method and publish on switch**

Replace the existing `switchVTab` method:
```typescript
  private switchVTab(tab: string): void {
    this.activeVTab = tab;
    this.vtabBtns.forEach(b => { b.dataset.active = b.dataset.svVtab === tab ? 'true' : 'false'; });
    this.renderCurrentHeatmap();
  }
```
with:
```typescript
  private applyVTab(tab: string): void {
    this.activeVTab = tab;
    this.vtabBtns.forEach(b => { b.dataset.active = b.dataset.svVtab === tab ? 'true' : 'false'; });
    this.renderCurrentHeatmap();
  }

  private switchVTab(tab: string): void {
    this.applyVTab(tab);
    this.publish?.({ type: 'sv-vtab', tab });
  }

  public applyRemoteVTab(tab: string): void {
    this.applyVTab(tab);
  }
```

- [ ] **Step 4: Publish on play/pause and seek**

Replace the existing `togglePlayback` method:
```typescript
  private togglePlayback(): void { if (this.isPlaying) this.pausePlayback(); else this.startPlayback(); }
```
with:
```typescript
  private togglePlayback(): void {
    if (this.isPlaying) {
      this.pausePlayback();
      this.publish?.({ type: 'sv-playback', action: 'pause', offset: this.playOffset });
    } else {
      this.startPlayback();
      this.publish?.({ type: 'sv-playback', action: 'play', offset: this.playOffset });
    }
  }
```

In `bindWaveformInteraction`, replace the `pointerup` handler:
```typescript
    canvas.addEventListener('pointerup', (e) => {
      this.isDragging = false; canvas.releasePointerCapture(e.pointerId);
      if (!this.isPlaying) this.stopPlayheadAnim();
    });
```
with:
```typescript
    canvas.addEventListener('pointerup', (e) => {
      this.isDragging = false; canvas.releasePointerCapture(e.pointerId);
      if (!this.isPlaying) this.stopPlayheadAnim();
      this.publish?.({
        type: 'sv-playback',
        action: this.isPlaying ? 'play' : 'seek',
        offset: this.playOffset,
      });
    });
```

- [ ] **Step 5: Add `applyRemotePlayback` public method**

Add after `applyRemoteVTab`:
```typescript
  public applyRemotePlayback(action: 'play' | 'pause' | 'seek', offset: number): void {
    if (action === 'pause') {
      this.pausePlayback();
    } else {
      this.startPlayback(offset);
    }
  }
```

- [ ] **Step 6: Verify TypeScript compiles**

```bash
cd /Users/zztt/projects/26-musiki/framework && npx tsc --noEmit 2>&1 | grep "sonic-visualizer"
```

Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add src/scripts/room/sonic-visualizer/controller.ts
git commit -m "feat(stage15): SV broadcasts sv-playback and sv-vtab, adds applyRemote* methods"
```

---

### Task 5: Wire callbacks and handle 4 new messages in livekit-room.ts

**Files:**
- Modify: `src/scripts/livekit-room.ts`

- [ ] **Step 1: Import `computeWaveformPeaks`**

At the top of `src/scripts/livekit-room.ts`, find the existing SA import:
```typescript
import { SonicAnalyzerController } from './room/sonic-analyzer';
```
and replace with:
```typescript
import { SonicAnalyzerController, computeWaveformPeaks } from './room/sonic-analyzer';
```

- [ ] **Step 2: Pass `publish` and `getSenderName` to SA controller**

Find the `onSonicAnalyzerInit` callback (around line 10870):
```typescript
    const onSonicAnalyzerInit = (container: HTMLElement) => {
      sonicAnalyzerController?.dispose();
      sonicAnalyzerController = new SonicAnalyzerController({
        container,
        getAudioTap: () => {
          if (!incomingAudioContext || !incomingAudioMasterAnalyser) return null;
          return { context: incomingAudioContext, masterAnalyser: incomingAudioMasterAnalyser };
        },
      });
    };
```
and replace with:
```typescript
    const onSonicAnalyzerInit = (container: HTMLElement) => {
      sonicAnalyzerController?.dispose();
      sonicAnalyzerController = new SonicAnalyzerController({
        container,
        getAudioTap: () => {
          if (!incomingAudioContext || !incomingAudioMasterAnalyser) return null;
          return { context: incomingAudioContext, masterAnalyser: incomingAudioMasterAnalyser };
        },
        publish: (msg) => void publishMessage(msg),
        getSenderName: () => nameInput.value.trim() || room.localParticipant?.name || '',
      });
    };
```

- [ ] **Step 3: Pass `publish` to SV controller**

Find the `onSonicVisualizerInit` callback:
```typescript
    const onSonicVisualizerInit = (container: HTMLElement) => {
      sonicVisualizerController?.dispose();
      sonicVisualizerController = new SonicVisualizerController({ container });
    };
```
and replace with:
```typescript
    const onSonicVisualizerInit = (container: HTMLElement) => {
      sonicVisualizerController?.dispose();
      sonicVisualizerController = new SonicVisualizerController({
        container,
        publish: (msg) => void publishMessage(msg),
      });
    };
```

- [ ] **Step 4: Handle 4 new message types in DataReceived**

Find the last message handler in the `DataReceived` block. It ends with a handler like:
```typescript
      if (message.type === 'lilypond-live') {
        ...
        return;
      }
```
After the last `return;` in the block, before the closing `}` of the `DataReceived` handler, add:

```typescript
      if (message.type === 'sa-file-sync') {
        const audioCtx = incomingAudioContext ?? new AudioContext();
        fetch(message.url)
          .then(r => r.arrayBuffer())
          .then(ab => audioCtx.decodeAudioData(ab))
          .then(buffer => {
            if (sonicAnalyzerController) {
              sonicAnalyzerController.loadFileFromRemote(
                buffer,
                message.fileName,
                message.senderName,
                message.key,
                message.scale,
                message.bpm,
              );
            } else {
              const peaks = computeWaveformPeaks(buffer);
              window.dispatchEvent(new CustomEvent('sa:file-ready', {
                detail: {
                  buffer,
                  fileName: message.fileName,
                  peaks,
                  melspec: [],
                  chroma: [],
                  pitches: [],
                  key: message.key,
                  scale: message.scale,
                  bpm: message.bpm,
                },
              }));
            }
          })
          .catch(e => console.warn('[room] sa-file-sync fetch error', e));
        return;
      }

      if (message.type === 'sa-state') {
        sonicAnalyzerController?.applyRemoteState(message.active);
        return;
      }

      if (message.type === 'sv-playback') {
        sonicVisualizerController?.applyRemotePlayback(message.action, message.offset);
        return;
      }

      if (message.type === 'sv-vtab') {
        sonicVisualizerController?.applyRemoteVTab(message.tab);
        return;
      }
```

- [ ] **Step 5: Verify TypeScript compiles cleanly**

```bash
cd /Users/zztt/projects/26-musiki/framework && npx tsc --noEmit 2>&1
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/scripts/livekit-room.ts
git commit -m "feat(stage15): wire SA/SV publish callbacks and handle remote sync messages"
```

---

### Task 6: Re-export `computeWaveformPeaks` from the SA index

**Files:**
- Modify: `src/scripts/room/sonic-analyzer/index.ts`

- [ ] **Step 1: Check the current SA index**

```bash
cat src/scripts/room/sonic-analyzer/index.ts
```

- [ ] **Step 2: Add re-export if `computeWaveformPeaks` is not already exported**

If the index just re-exports from `./controller`, add `computeWaveformPeaks` to the export:

```typescript
export { SonicAnalyzerController, computeWaveformPeaks } from './controller';
```

If the index already exports `*` from `./controller`, no change needed.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /Users/zztt/projects/26-musiki/framework && npx tsc --noEmit 2>&1
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/scripts/room/sonic-analyzer/index.ts
git commit -m "feat(stage15): re-export computeWaveformPeaks from SA index"
```

---

### Task 7: Smoke test

- [ ] **Step 1: Start the dev server**

```bash
cd /Users/zztt/projects/26-musiki/framework && npm run dev
```

- [ ] **Step 2: Open two browser tabs in the same conference room**

Open two browser windows, both logged in with different users, both joining the same LiveKit room.

- [ ] **Step 3: Test file sync**

In Tab A (teacher): open the SA pod, drop a WAV/MP3 file onto it. Wait for "file ready" status. Click "↑ save". Expect status to change to "uploading…" then "shared ✓".

In Tab B (student): the SV pod should automatically receive the file and show the waveform + heatmap within a few seconds.

- [ ] **Step 4: Test playback sync**

In Tab A: click play (▶) in the SV waveform. Check that Tab B's SV also starts playing at the same offset.

In Tab A: click pause (⏸). Check that Tab B's SV also pauses.

In Tab A: drag the waveform to a new position and release. Check that Tab B's playhead jumps to the same position.

- [ ] **Step 5: Test vtab sync**

In Tab A: click MEL / CHR / PCH tabs in SV. Verify Tab B's heatmap switches to the same tab.

- [ ] **Step 6: Test SA state sync**

In Tab A: toggle the SA LED on. Check Tab B's SA status shows "remote · on".

Toggle off. Check Tab B shows "remote · off".

- [ ] **Step 7: Test with no SA pod open on receiver**

In Tab B: close the SA pod (keep SV open). In Tab A: share a new file. Check Tab B's SV still populates (via direct `sa:file-ready` dispatch path).

---

## Self-Review

**Spec coverage:**
- ✅ New `/api/room/sa-upload` endpoint (Task 1)
- ✅ `sa-file-sync` message: upload → broadcast → receivers fetch + decode (Tasks 2, 3, 5)
- ✅ `sa-state` broadcast on SA toggle (Tasks 2, 3, 5)
- ✅ `sv-playback` on play/pause/seek (Tasks 2, 4, 5)
- ✅ `sv-vtab` on tab switch (Tasks 2, 4, 5)
- ✅ `loadFileFromRemote` public method (Task 3)
- ✅ `applyRemoteState` public method (Task 3)
- ✅ `applyRemotePlayback` public method (Task 4)
- ✅ `applyRemoteVTab` public method (Task 4)
- ✅ No-SA-controller fallback dispatches `sa:file-ready` directly with computed peaks (Task 5)
- ✅ `computeWaveformPeaks` exported for use in livekit-room (Tasks 3, 6)
- ✅ `key`, `scale`, `bpm` included in `sa-file-sync` so receivers get metadata without running essentia (Tasks 2, 3, 5)
- ✅ Remote actions do not re-broadcast (applyRemote* methods bypass publish calls)
- ✅ Manual save = explicit consent, no auto-upload

**Type consistency check:**
- `computeWaveformPeaks` defined in Task 3, exported in Task 6, imported in Task 5 ✅
- `loadFileFromRemote(buffer, fileName, senderName, key, scale, bpm)` — defined Task 3, called Task 5 ✅
- `applyRemoteState(active: boolean)` — defined Task 3, called Task 5 ✅
- `applyRemotePlayback(action, offset)` — defined Task 4, called Task 5 ✅
- `applyRemoteVTab(tab)` — defined Task 4, called Task 5 ✅
- `ConferenceMessage` import added to both SA and SV controllers (Tasks 3, 4) ✅
- `publish?: (msg: ConferenceMessage) => void` field in both controllers ✅
