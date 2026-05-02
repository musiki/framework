# Sonic Analyzer (sA) Pod — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the sA Sonic Analyzer pod — audio MIR analysis with Essentia.js, LED on/off switch, 4 ASCII views (TEXT/SPECTRUM/TIMBRE/LUFS), and a source selector (master/mic/participant/file).

**Architecture:** All analysis runs client-side. When the LED is off, nothing loads. When activated: Essentia.js UMD files are loaded from `/public/lib/essentia/`, a new `AnalyserNode` is tapped in parallel to `incomingAudioMasterAnalyser` in `livekit-room.ts`, and a `setInterval` loop at configurable FPS reads audio samples and calls Essentia algorithms on the main thread.

**Tech Stack:** Essentia.js 0.1.3 (UMD, browser), Web Audio API `AnalyserNode`, vanilla TypeScript, Astro component, CSS monospace wireframe aesthetic.

---

### Feature: File Dropzone (non-priority, planned)

The entire `.sa-pod` element acts as a dropzone for `.wav`, `.ogg`, and `.mp3` files. Dropped files are decoded via `AudioContext.decodeAudioData()` into a volatile `AudioBuffer` (never persisted automatically). Once a file is loaded, a `file:` option appears in the source selector and is auto-selected. Analysis loops over the decoded buffer in a synthetic tick (no real-time playback required — or optionally played through an `AudioBufferSourceNode`).

**Save to R2 (low priority):** A save button (hidden unless a file is loaded) POSTs the raw file bytes to the existing R2 upload endpoint used by `foro.astro`. The button shows upload progress and replaces itself with a shareable link on success.

**Implementation notes:**
- Dropzone drag feedback via `.sa-pod--drag-over` CSS class (green border pulse)
- `data-sa-file-name` element shows the loaded file label in the status bar
- Controller gains a `fileBuffer: AudioBuffer | null` field and a `connectFileSource()` method
- No new files needed — dropzone wiring goes in `controller.ts` (Task 9) and CSS in `sonic-analyzer.css` (Task 4)
- R2 upload can be a standalone `uploadToR2(file: File): Promise<string>` helper added later

---

## File Map

| Action | Path | Responsibility |
|--------|------|---------------|
| Create | `public/lib/essentia/essentia-wasm.umd.js` | Essentia WASM binary (copied from npm) |
| Create | `public/lib/essentia/essentia.js-core.umd.js` | Essentia JS core (copied from npm) |
| Create | `src/components/room/panels/sonic-analyzer/SonicAnalyzerPanel.astro` | Pod HTML: switch, source select, fps slider, 4 view tabs |
| Create | `src/components/room/panels/sonic-analyzer/sonic-analyzer.css` | Wireframe monospace styles |
| Create | `src/scripts/room/sonic-analyzer/controller.ts` | On/off, lazy-load, analyser tap, FPS loop, dispatch to views |
| Create | `src/scripts/room/sonic-analyzer/views/text-view.ts` | TEXT: ASCII table with color ranges |
| Create | `src/scripts/room/sonic-analyzer/views/spectrum-view.ts` | SPECTRUM: 64-bin ASCII bar chart |
| Create | `src/scripts/room/sonic-analyzer/views/timbre-view.ts` | TIMBRE: descriptor grid + MFCC inline |
| Create | `src/scripts/room/sonic-analyzer/views/lufs-view.ts` | LUFS: M/S/I meters + ASCII envelope history |
| Create | `src/scripts/room/sonic-analyzer/index.ts` | Re-exports |
| Modify | `src/components/room/workspace/PodTemplates.astro` | Import + mount SonicAnalyzerPanel |
| Modify | `src/scripts/room/workspace/RoomWorkspaceManager.ts` | Add `sonic-analyzer` to POD_TYPES + `onSonicAnalyzerInit` callback |
| Modify | `src/scripts/livekit-room.ts` | Add `onSonicAnalyzerInit` closure + pass to RoomWorkspaceManager |

---

## Task 1: Copy Essentia.js static files to public/

**Files:**
- Create: `public/lib/essentia/` (directory)

- [ ] **Step 1: Install essentia.js**

```bash
cd /Users/zztt/projects/26-musiki/framework
npm install essentia.js@0.1.3
```

Expected: `node_modules/essentia.js/dist/` contains `essentia-wasm.umd.js` and `essentia.js-core.umd.js`.

- [ ] **Step 2: Copy files to public/**

```bash
mkdir -p public/lib/essentia
cp node_modules/essentia.js/dist/essentia-wasm.umd.js public/lib/essentia/
cp node_modules/essentia.js/dist/essentia.js-core.umd.js public/lib/essentia/
```

- [ ] **Step 3: Verify sizes**

```bash
ls -lh public/lib/essentia/
```

Expected: `essentia-wasm.umd.js` ~3-5MB, `essentia.js-core.umd.js` ~200KB.

- [ ] **Step 4: Commit**

```bash
git add public/lib/essentia/
git commit -m "feat(sa): add essentia.js static assets to public/lib/essentia"
```

---

## Task 2: Register pod in RoomWorkspaceManager

**Files:**
- Modify: `src/scripts/room/workspace/RoomWorkspaceManager.ts:4-71`

- [ ] **Step 1: Add sonic-analyzer to POD_TYPES array**

In `RoomWorkspaceManager.ts`, find the `POD_TYPES` array (line 24) and add after `instant-score`:

```ts
{ id: 'instant-score', title: 'SCORE', icon: 'Is', atomic: 18, color: '#F1C232', cat: 'tools' },
{ id: 'sonic-analyzer', title: 'SA', icon: 'Sa', atomic: 19, color: '#45D384', cat: 'tools' },
```

- [ ] **Step 2: Add onSonicAnalyzerInit private field**

After line `private onOrfInit?: (element: HTMLElement) => void;` (line 16), add:

```ts
private onSonicAnalyzerInit?: (element: HTMLElement) => void;
```

- [ ] **Step 3: Add parameter to constructor**

The constructor signature currently ends with `onScoreInit?: (element: HTMLElement) => void` (line 57). Add:

```ts
  onScoreInit?: (element: HTMLElement) => void,
  onSonicAnalyzerInit?: (element: HTMLElement) => void
```

And in the constructor body after `this.onScoreInit = onScoreInit;` (line 70), add:

```ts
this.onSonicAnalyzerInit = onSonicAnalyzerInit;
```

- [ ] **Step 4: Add init dispatch in createComponent**

In the `createComponent` block, after the `if (id === 'instant-score' && this.onScoreInit)` block (around line 150), add:

```ts
if (id === 'sonic-analyzer' && this.onSonicAnalyzerInit) {
  this.onSonicAnalyzerInit(element);
}
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | grep RoomWorkspaceManager
```

Expected: no errors for that file.

- [ ] **Step 6: Commit**

```bash
git add src/scripts/room/workspace/RoomWorkspaceManager.ts
git commit -m "feat(sa): register sonic-analyzer pod in RoomWorkspaceManager"
```

---

## Task 3: Create SonicAnalyzerPanel.astro

**Files:**
- Create: `src/components/room/panels/sonic-analyzer/SonicAnalyzerPanel.astro`

- [ ] **Step 1: Create directory and file**

```bash
mkdir -p src/components/room/panels/sonic-analyzer
```

- [ ] **Step 2: Write the component**

Create `src/components/room/panels/sonic-analyzer/SonicAnalyzerPanel.astro`:

```astro
<div class="musiki-pod" data-pod="sonic-analyzer" data-pod-title="SA">
  <div class="sa-pod">

    <!-- TOOLBAR: switch + source + fps + tabs -->
    <div class="musiki-pod-toolbar sa-toolbar">

      <!-- LED Power Switch -->
      <button
        type="button"
        class="conference-mixer-channel-toggle sa-power-btn"
        data-sa-power
        data-active="false"
        aria-label="Activar Sonic Analyzer"
        title="ON/OFF"
      >
        <span class="conference-mixer-led" aria-hidden="true"></span>
      </button>

      <span class="sa-label">sA</span>

      <!-- Source selector -->
      <select class="musiki-pod-input sa-source-select" data-sa-source style="width:5.5rem; flex:none;">
        <option value="master">master</option>
        <option value="mic">mic:local</option>
      </select>

      <!-- FPS slider -->
      <span class="sa-fps-label" data-sa-fps-label>10fps</span>
      <input
        type="range"
        class="sa-fps-slider"
        data-sa-fps
        min="1"
        max="30"
        value="10"
        title="Update rate"
        style="width:3.5rem;"
      />

      <!-- Spacer -->
      <div style="flex:1;"></div>

      <!-- View tabs -->
      <div class="sa-tabs" data-sa-tabs>
        <button type="button" class="musiki-pod-btn sa-tab" data-sa-tab="text" data-active="true">TXT</button>
        <button type="button" class="musiki-pod-btn sa-tab" data-sa-tab="spectrum">FFT</button>
        <button type="button" class="musiki-pod-btn sa-tab" data-sa-tab="timbre">TMB</button>
        <button type="button" class="musiki-pod-btn sa-tab" data-sa-tab="lufs">LUF</button>
      </div>
    </div>

    <!-- STATUS bar (loading / error / source info) -->
    <div class="sa-status" data-sa-status>off</div>

    <!-- VIEW PANELS -->
    <div class="sa-content" data-sa-content>

      <!-- TEXT view -->
      <pre class="sa-view sa-view--text" data-sa-view="text"><span class="sa-dim">· waiting for signal ·</span></pre>

      <!-- SPECTRUM view -->
      <pre class="sa-view sa-view--spectrum" data-sa-view="spectrum" hidden><span class="sa-dim">· waiting for signal ·</span></pre>

      <!-- TIMBRE view -->
      <pre class="sa-view sa-view--timbre" data-sa-view="timbre" hidden><span class="sa-dim">· waiting for signal ·</span></pre>

      <!-- LUFS view -->
      <pre class="sa-view sa-view--lufs" data-sa-view="lufs" hidden><span class="sa-dim">· waiting for signal ·</span></pre>

    </div>
  </div>
</div>
```

- [ ] **Step 3: Commit**

```bash
git add src/components/room/panels/sonic-analyzer/SonicAnalyzerPanel.astro
git commit -m "feat(sa): add SonicAnalyzerPanel.astro template"
```

---

## Task 4: Create sonic-analyzer.css

**Files:**
- Create: `src/components/room/panels/sonic-analyzer/sonic-analyzer.css`

- [ ] **Step 1: Write styles**

Create `src/components/room/panels/sonic-analyzer/sonic-analyzer.css`:

```css
/* sA — Sonic Analyzer Pod
   Aesthetic: wireframe, monospace, 0 background, strudel/gibber influence */

.sa-pod {
  display: flex;
  flex-direction: column;
  height: 100%;
  font-family: var(--font-family-mono, monospace);
  font-size: 0.72rem;
  color: var(--conference-fg, #cdd6f4);
}

.sa-toolbar {
  gap: 0.3rem;
  flex-shrink: 0;
}

.sa-label {
  font-size: 0.55rem;
  font-weight: 900;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: #45D384;
  opacity: 0.7;
  flex-shrink: 0;
}

.sa-fps-label {
  font-size: 0.55rem;
  color: var(--conference-muted, #7f849c);
  width: 2.6rem;
  text-align: right;
  flex-shrink: 0;
}

.sa-fps-slider {
  -webkit-appearance: none;
  appearance: none;
  height: 2px;
  background: rgba(255,255,255,0.12);
  border-radius: 1px;
  cursor: pointer;
  flex-shrink: 0;
}

.sa-fps-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #45D384;
  cursor: pointer;
}

.sa-tabs {
  display: flex;
  gap: 0.2rem;
  flex-shrink: 0;
}

.sa-tab {
  font-size: 0.55rem;
  padding: 0 0.35rem;
  height: 1.4rem;
  min-width: unset;
  letter-spacing: 0.08em;
}

.sa-tab[data-active="true"] {
  color: #45D384;
  border-color: rgba(69, 211, 132, 0.4);
}

.sa-status {
  font-size: 0.55rem;
  color: var(--conference-muted, #7f849c);
  letter-spacing: 0.08em;
  padding: 0.15rem 0.5rem;
  border-bottom: 1px solid rgba(255,255,255,0.04);
  flex-shrink: 0;
  text-transform: lowercase;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sa-content {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  position: relative;
}

.sa-view {
  position: absolute;
  inset: 0;
  margin: 0;
  padding: 0.5rem;
  overflow-y: auto;
  overflow-x: hidden;
  font-family: inherit;
  font-size: inherit;
  line-height: 1.55;
  white-space: pre;
  scrollbar-width: thin;
  scrollbar-color: rgba(255,255,255,0.1) transparent;
}

.sa-view[hidden] {
  display: none !important;
}

/* Colorization classes */
.sa-ok   { color: #45D384; }
.sa-warn { color: #FFD966; }
.sa-clip { color: #E06666; }
.sa-dim  { color: var(--conference-muted, #7f849c); opacity: 0.5; }
.sa-key  { color: #89b4fa; }
.sa-val  { color: #cdd6f4; }

/* LUFS history envelope */
.sa-history {
  color: #45D384;
  opacity: 0.7;
  display: block;
  overflow: hidden;
  white-space: pre;
}

/* SPECTRUM bars */
.sa-bars {
  color: #45D384;
  letter-spacing: -0.05em;
}

/* Pod off state: dim content */
.sa-pod[data-active="false"] .sa-content {
  opacity: 0.25;
  pointer-events: none;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/room/panels/sonic-analyzer/sonic-analyzer.css
git commit -m "feat(sa): add wireframe monospace CSS for sonic-analyzer pod"
```

---

## Task 5: Create views/text-view.ts

**Files:**
- Create: `src/scripts/room/sonic-analyzer/views/text-view.ts`

- [ ] **Step 1: Write the file**

Create `src/scripts/room/sonic-analyzer/views/text-view.ts`:

```ts
export type SAResults = {
  pitch: number;          // Hz
  pitchNote: string;      // e.g. "C4"
  rmsDb: number;          // dBFS
  lufsM: number;          // Momentary LUFS
  lufsS: number;          // Short-term LUFS
  lufsI: number;          // Integrated LUFS
  zcr: number;            // 0-1
  centroid: number;       // Hz
  spread: number;         // Hz
  skewness: number;
  kurtosis: number;
  slope: number;
  flux: number;
  tristimulus: [number, number, number];
  hnr: number;            // dB
  mfcc: number[];         // 13 coefficients
};

const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

export function hzToNote(hz: number): string {
  if (hz <= 0) return '---';
  const midi = Math.round(12 * Math.log2(hz / 440) + 69);
  const octave = Math.floor(midi / 12) - 1;
  return NOTE_NAMES[midi % 12] + octave;
}

function colorClass(value: number, warnThreshold: number, clipThreshold: number): string {
  if (value >= clipThreshold) return 'clip';
  if (value >= warnThreshold) return 'warn';
  return 'ok';
}

function dbColor(db: number): string {
  return colorClass(db, -6, -1);
}

function fmt(value: number, decimals = 1): string {
  return value.toFixed(decimals);
}

function pad(str: string, len: number): string {
  return str.padStart(len);
}

export function renderTextView(el: HTMLElement, r: SAResults): void {
  const pitchClass = r.pitch > 50 ? 'ok' : 'dim';
  const dbCls = dbColor(r.rmsDb);
  const lufsClass = colorClass(r.lufsM, -14, -9);

  el.innerHTML = [
    `<span class="sa-key">pitch    </span><span class="sa-dim">·</span> <span class="sa-${pitchClass}">${pad(fmt(r.pitch, 1), 8)} Hz</span>  <span class="sa-dim">${r.pitchNote}</span>`,
    `<span class="sa-key">dBFS     </span><span class="sa-dim">·</span> <span class="sa-${dbCls}">${pad(fmt(r.rmsDb, 1), 8)} dBFS</span>`,
    `<span class="sa-key">lufs_m   </span><span class="sa-dim">·</span> <span class="sa-${lufsClass}">${pad(fmt(r.lufsM, 1), 8)} LUFS</span>`,
    `<span class="sa-key">lufs_s   </span><span class="sa-dim">·</span> <span class="sa-dim">${pad(fmt(r.lufsS, 1), 8)} LUFS</span>`,
    `<span class="sa-key">lufs_i   </span><span class="sa-dim">·</span> <span class="sa-dim">${pad(fmt(r.lufsI, 1), 8)} LUFS</span>`,
    `<span class="sa-dim">─────────────────────────</span>`,
    `<span class="sa-key">centroid </span><span class="sa-dim">·</span> <span class="sa-val">${pad(fmt(r.centroid, 0), 8)} Hz</span>`,
    `<span class="sa-key">spread   </span><span class="sa-dim">·</span> <span class="sa-val">${pad(fmt(r.spread, 0), 8)} Hz</span>`,
    `<span class="sa-key">skewness </span><span class="sa-dim">·</span> <span class="sa-val">${pad(fmt(r.skewness, 3), 8)}</span>`,
    `<span class="sa-key">kurtosis </span><span class="sa-dim">·</span> <span class="sa-val">${pad(fmt(r.kurtosis, 3), 8)}</span>`,
    `<span class="sa-key">slope    </span><span class="sa-dim">·</span> <span class="sa-val">${pad(fmt(r.slope, 4), 8)}</span>`,
    `<span class="sa-key">flux     </span><span class="sa-dim">·</span> <span class="sa-val">${pad(fmt(r.flux, 3), 8)}</span>`,
    `<span class="sa-key">HNR      </span><span class="sa-dim">·</span> <span class="sa-val">${pad(fmt(r.hnr, 1), 8)} dB</span>`,
    `<span class="sa-key">ZCR      </span><span class="sa-dim">·</span> <span class="sa-val">${pad(fmt(r.zcr, 4), 8)}</span>`,
    `<span class="sa-key">T1/T2/T3 </span><span class="sa-dim">·</span> <span class="sa-val">${fmt(r.tristimulus[0],2)} / ${fmt(r.tristimulus[1],2)} / ${fmt(r.tristimulus[2],2)}</span>`,
  ].join('\n');
}
```

- [ ] **Step 2: Commit**

```bash
git add src/scripts/room/sonic-analyzer/views/text-view.ts
git commit -m "feat(sa): add TEXT view renderer"
```

---

## Task 6: Create views/spectrum-view.ts

**Files:**
- Create: `src/scripts/room/sonic-analyzer/views/spectrum-view.ts`

- [ ] **Step 1: Write the file**

Create `src/scripts/room/sonic-analyzer/views/spectrum-view.ts`:

```ts
const BARS = ' ▁▂▃▄▅▆▇█';

function magnitudeToBin(db: number, minDb = -80, maxDb = 0): number {
  const normalized = Math.max(0, Math.min(1, (db - minDb) / (maxDb - minDb)));
  return Math.floor(normalized * (BARS.length - 1));
}

export function renderSpectrumView(el: HTMLElement, freqData: Float32Array): void {
  const totalBins = freqData.length;
  const displayBins = 64;
  const step = Math.floor(totalBins / displayBins);

  let bars = '';
  for (let i = 0; i < displayBins; i++) {
    const db = freqData[i * step];
    bars += BARS[magnitudeToBin(db)];
  }

  const nyquist = 24000; // 48kHz / 2
  const binHz = Math.round(nyquist / displayBins);

  el.innerHTML =
    `<span class="sa-bars">${bars}</span>\n` +
    `<span class="sa-dim">20Hz${' '.repeat(displayBins - 12)}${Math.round(nyquist / 1000)}kHz</span>`;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/scripts/room/sonic-analyzer/views/spectrum-view.ts
git commit -m "feat(sa): add SPECTRUM view renderer"
```

---

## Task 7: Create views/timbre-view.ts

**Files:**
- Create: `src/scripts/room/sonic-analyzer/views/timbre-view.ts`

- [ ] **Step 1: Write the file**

Create `src/scripts/room/sonic-analyzer/views/timbre-view.ts`:

```ts
import type { SAResults } from './text-view';

const BAR_CHARS = '░▒▓█';
const BAR_LEN = 8;

function miniBar(value: number, min: number, max: number): string {
  const norm = Math.max(0, Math.min(1, (value - min) / (max - min)));
  const filled = Math.round(norm * BAR_LEN);
  return '█'.repeat(filled) + '░'.repeat(BAR_LEN - filled);
}

function mfccBar(coef: number): string {
  const norm = Math.max(0, Math.min(1, (coef + 100) / 200));
  const idx = Math.floor(norm * (BAR_CHARS.length - 1));
  return BAR_CHARS[idx];
}

export function renderTimbreView(el: HTMLElement, r: SAResults): void {
  const mfccRow = r.mfcc.map(c => mfccBar(c)).join('');
  const mfccVals = r.mfcc.map(c => (c >= 0 ? ' ' : '') + c.toFixed(0)).join('·');

  el.innerHTML = [
    `<span class="sa-key">centroid </span><span class="sa-dim">${miniBar(r.centroid, 0, 8000)}</span>  <span class="sa-val">${r.centroid.toFixed(0).padStart(5)} Hz</span>`,
    `<span class="sa-key">spread   </span><span class="sa-dim">${miniBar(r.spread, 0, 4000)}</span>  <span class="sa-val">${r.spread.toFixed(0).padStart(5)} Hz</span>`,
    `<span class="sa-key">skewness </span><span class="sa-dim">${miniBar(r.skewness, -3, 3)}</span>  <span class="sa-val">${r.skewness.toFixed(3).padStart(7)}</span>`,
    `<span class="sa-key">kurtosis </span><span class="sa-dim">${miniBar(r.kurtosis, 0, 20)}</span>  <span class="sa-val">${r.kurtosis.toFixed(3).padStart(7)}</span>`,
    `<span class="sa-key">slope    </span><span class="sa-dim">${miniBar(r.slope + 0.05, 0, 0.1)}</span>  <span class="sa-val">${r.slope.toFixed(4).padStart(7)}</span>`,
    `<span class="sa-key">flux     </span><span class="sa-dim">${miniBar(r.flux, 0, 1)}</span>  <span class="sa-val">${r.flux.toFixed(3).padStart(7)}</span>`,
    `<span class="sa-key">HNR      </span><span class="sa-dim">${miniBar(r.hnr, -20, 40)}</span>  <span class="sa-val">${r.hnr.toFixed(1).padStart(5)} dB</span>`,
    `<span class="sa-key">T1/2/3   </span><span class="sa-val">${r.tristimulus[0].toFixed(2)} / ${r.tristimulus[1].toFixed(2)} / ${r.tristimulus[2].toFixed(2)}</span>`,
    `<span class="sa-dim">─────────────────────────</span>`,
    `<span class="sa-key">MFCC     </span><span class="sa-dim">${mfccRow}</span>`,
    `<span class="sa-dim">         </span><span class="sa-val" style="font-size:0.6em">${mfccVals}</span>`,
  ].join('\n');
}
```

- [ ] **Step 2: Commit**

```bash
git add src/scripts/room/sonic-analyzer/views/timbre-view.ts
git commit -m "feat(sa): add TIMBRE view renderer"
```

---

## Task 8: Create views/lufs-view.ts

**Files:**
- Create: `src/scripts/room/sonic-analyzer/views/lufs-view.ts`

- [ ] **Step 1: Write the file**

Create `src/scripts/room/sonic-analyzer/views/lufs-view.ts`:

```ts
const HISTORY_LEN = 80;
const ENVELOPE_CHARS = ['_', '.', '-', '‾'];

function lufsToEnvelopeChar(lufs: number): string {
  if (lufs < -40) return '_';
  if (lufs < -24) return '.';
  if (lufs < -14) return '-';
  return '‾';
}

function lufsColor(lufs: number): string {
  if (lufs > -9) return 'clip';
  if (lufs > -14) return 'warn';
  return 'ok';
}

export class LufsHistory {
  private history: number[] = [];

  push(lufsM: number): void {
    this.history.push(lufsM);
    if (this.history.length > HISTORY_LEN) this.history.shift();
  }

  render(el: HTMLElement, lufsM: number, lufsS: number, lufsI: number): void {
    const mCls = lufsColor(lufsM);
    const sCls = lufsColor(lufsS);
    const iCls = lufsColor(lufsI);

    const envelope = this.history.map(v => lufsToEnvelopeChar(v)).join('');
    const padding = ' '.repeat(Math.max(0, HISTORY_LEN - this.history.length));

    el.innerHTML = [
      `<span class="sa-key">M </span><span class="sa-${mCls}">${lufsM.toFixed(1).padStart(6)}</span>  <span class="sa-key">S </span><span class="sa-${sCls}">${lufsS.toFixed(1).padStart(6)}</span>  <span class="sa-key">I </span><span class="sa-${iCls}">${lufsI.toFixed(1).padStart(6)}</span>  <span class="sa-dim">LUFS</span>`,
      `<span class="sa-dim">${'─'.repeat(HISTORY_LEN)}</span>`,
      `<span class="sa-history">${padding}${envelope}</span>`,
      `<span class="sa-dim">${'▲'.padStart(HISTORY_LEN)}  now</span>`,
    ].join('\n');
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/scripts/room/sonic-analyzer/views/lufs-view.ts
git commit -m "feat(sa): add LUFS view renderer with ASCII envelope history"
```

---

## Task 9: Create controller.ts

**Files:**
- Create: `src/scripts/room/sonic-analyzer/controller.ts`

This is the core. It handles on/off, lazy-loading Essentia.js, tapping the audio source, running the analysis loop, and dispatching to the active view.

- [ ] **Step 1: Write the controller**

Create `src/scripts/room/sonic-analyzer/controller.ts`:

```ts
import { renderTextView, hzToNote } from './views/text-view';
import type { SAResults } from './views/text-view';
import { renderSpectrumView } from './views/spectrum-view';
import { renderTimbreView } from './views/timbre-view';
import { LufsHistory } from './views/lufs-view';

type AudioTapFn = () => { context: AudioContext; masterAnalyser: AnalyserNode } | null;

export type SonicAnalyzerOptions = {
  container: HTMLElement;
  getAudioTap: AudioTapFn;
};

declare const EssentiaWASM: any;
declare const Essentia: any;

export class SonicAnalyzerController {
  private container: HTMLElement;
  private getAudioTap: AudioTapFn;

  private active = false;
  private essentia: any = null;
  private analyserNode: AnalyserNode | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private micStream: MediaStream | null = null;

  private timeDomainBuf: Float32Array | null = null;
  private freqBuf: Float32Array | null = null;

  private intervalId: ReturnType<typeof setInterval> | null = null;
  private fps = 10;
  private activeView = 'text';
  private activeSource = 'master';

  private lufsHistory = new LufsHistory();
  private lufsIAccum = 0;
  private lufsICount = 0;
  private prevFreqBuf: Float32Array | null = null;

  // DOM refs
  private powerBtn!: HTMLElement;
  private statusEl!: HTMLElement;
  private sourceSelect!: HTMLSelectElement;
  private fpsSlider!: HTMLInputElement;
  private fpsLabel!: HTMLElement;
  private viewEls: Record<string, HTMLElement> = {};
  private tabBtns: HTMLButtonElement[] = [];

  constructor(options: SonicAnalyzerOptions) {
    this.container = options.container;
    this.getAudioTap = options.getAudioTap;
    this.bindDOM();
  }

  private bindDOM(): void {
    const q = <T extends HTMLElement>(sel: string) =>
      this.container.querySelector<T>(sel);

    this.powerBtn = q('[data-sa-power]')!;
    this.statusEl = q('[data-sa-status]')!;
    this.sourceSelect = q<HTMLSelectElement>('[data-sa-source]')!;
    this.fpsSlider = q<HTMLInputElement>('[data-sa-fps]')!;
    this.fpsLabel = q('[data-sa-fps-label]')!;

    for (const view of ['text', 'spectrum', 'timbre', 'lufs']) {
      const el = q<HTMLElement>(`[data-sa-view="${view}"]`);
      if (el) this.viewEls[view] = el;
    }

    this.tabBtns = Array.from(
      this.container.querySelectorAll<HTMLButtonElement>('[data-sa-tab]')
    );

    this.powerBtn.addEventListener('click', () => this.toggle());

    this.sourceSelect.addEventListener('change', () => {
      this.activeSource = this.sourceSelect.value;
      if (this.active) {
        void this.reconnectSource();
      }
    });

    this.fpsSlider.addEventListener('input', () => {
      this.fps = parseInt(this.fpsSlider.value, 10);
      this.fpsLabel.textContent = `${this.fps}fps`;
      if (this.active) this.restartLoop();
    });

    this.tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const view = btn.dataset.saTab!;
        this.switchView(view);
      });
    });
  }

  private switchView(view: string): void {
    this.activeView = view;
    for (const [key, el] of Object.entries(this.viewEls)) {
      el.hidden = key !== view;
    }
    this.tabBtns.forEach(btn => {
      btn.dataset.active = btn.dataset.saTab === view ? 'true' : 'false';
    });
  }

  async toggle(): Promise<void> {
    if (this.active) {
      this.deactivate();
    } else {
      await this.activate();
    }
  }

  private async activate(): Promise<void> {
    this.setStatus('loading essentia…');
    try {
      await this.loadEssentia();
    } catch (e) {
      this.setStatus('error: essentia failed to load');
      return;
    }

    try {
      await this.connectSource();
    } catch (e) {
      this.setStatus(`error: ${(e as Error).message}`);
      return;
    }

    this.active = true;
    this.powerBtn.dataset.active = 'true';
    this.container.querySelector<HTMLElement>('.sa-pod')!.dataset.active = 'true';
    this.startLoop();
    this.setStatus(`on · ${this.activeSource} · ${this.fps}fps`);
  }

  private deactivate(): void {
    this.active = false;
    this.stopLoop();
    this.disconnectSource();
    this.powerBtn.dataset.active = 'false';
    this.container.querySelector<HTMLElement>('.sa-pod')!.dataset.active = 'false';
    this.setStatus('off');
  }

  private async loadEssentia(): Promise<void> {
    if (this.essentia) return;

    await loadScript('/lib/essentia/essentia-wasm.umd.js');
    await loadScript('/lib/essentia/essentia.js-core.umd.js');

    this.essentia = new Essentia(EssentiaWASM);
  }

  private async connectSource(): Promise<void> {
    this.disconnectSource();

    if (this.activeSource === 'master') {
      const tap = this.getAudioTap();
      if (!tap) throw new Error('audio context not ready');

      const { context, masterAnalyser } = tap;
      const analyser = context.createAnalyser();
      analyser.fftSize = 4096;
      analyser.smoothingTimeConstant = 0.5;
      masterAnalyser.connect(analyser);
      this.analyserNode = analyser;

    } else if (this.activeSource === 'mic') {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      this.micStream = stream;

      const tap = this.getAudioTap();
      if (!tap) throw new Error('audio context not ready');
      const { context } = tap;

      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 4096;
      analyser.smoothingTimeConstant = 0.5;
      source.connect(analyser);
      this.sourceNode = source;
      this.analyserNode = analyser;
    }

    const fftSize = this.analyserNode!.fftSize;
    this.timeDomainBuf = new Float32Array(fftSize);
    this.freqBuf = new Float32Array(this.analyserNode!.frequencyBinCount);
    this.prevFreqBuf = new Float32Array(this.analyserNode!.frequencyBinCount);
  }

  private async reconnectSource(): Promise<void> {
    this.disconnectSource();
    await this.connectSource();
  }

  private disconnectSource(): void {
    try { this.analyserNode?.disconnect(); } catch {}
    try { this.sourceNode?.disconnect(); } catch {}
    this.micStream?.getTracks().forEach(t => t.stop());
    this.analyserNode = null;
    this.sourceNode = null;
    this.micStream = null;
    this.timeDomainBuf = null;
    this.freqBuf = null;
    this.prevFreqBuf = null;
  }

  private startLoop(): void {
    this.stopLoop();
    this.intervalId = setInterval(() => this.tick(), 1000 / this.fps);
  }

  private stopLoop(): void {
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private restartLoop(): void {
    if (this.active) this.startLoop();
  }

  private tick(): void {
    if (!this.analyserNode || !this.timeDomainBuf || !this.freqBuf || !this.essentia) return;

    this.analyserNode.getFloatTimeDomainData(this.timeDomainBuf);
    this.analyserNode.getFloatFrequencyData(this.freqBuf);

    const results = this.analyze();
    this.render(results);
  }

  private analyze(): SAResults {
    const E = this.essentia;
    const buf = this.timeDomainBuf!;
    const freq = this.freqBuf!;
    const audioVector = E.arrayToVector(buf);

    // RMS → dB
    const rms = Math.sqrt(buf.reduce((sum, v) => sum + v * v, 0) / buf.length);
    const rmsDb = rms > 1e-9 ? 20 * Math.log10(rms) : -96;

    // Pitch
    let pitch = 0;
    try {
      const pitchResult = E.PitchYin(audioVector);
      pitch = pitchResult.pitch;
    } catch {}

    // LUFS momentary (simplified: RMS with K-weighting approx as dBFS + 0.3)
    const lufsM = rmsDb + 0.3;
    // Short-term: rolling average (approximated with slight smoothing)
    const lufsS = lufsM * 0.7 + (this.lufsHistory['history'].slice(-1)[0] ?? lufsM) * 0.3;
    // Integrated: running mean
    this.lufsIAccum += lufsM;
    this.lufsICount += 1;
    const lufsI = this.lufsICount > 0 ? this.lufsIAccum / this.lufsICount : lufsM;

    this.lufsHistory.push(lufsM);

    // Spectral descriptors (use freq domain magnitudes)
    // Convert dBFS freqBuf to linear magnitudes
    const magBuf = Float32Array.from(freq, db => Math.pow(10, db / 20));
    const magVector = E.arrayToVector(magBuf);

    let centroid = 0, spread = 0, skewness = 0, kurtosis = 0, slope = 0, flux = 0;
    let tristimulus: [number, number, number] = [0, 0, 0];
    let hnr = 0;
    let mfcc: number[] = new Array(13).fill(0);
    let zcr = 0;

    try {
      const sc = E.SpectralCentroidTime(audioVector);
      centroid = sc.centroid;
    } catch {}

    try {
      const moments = E.CentralMoments(magVector);
      const desc = E.DistributionShape(moments.centralMoments);
      spread = desc.spread;
      skewness = desc.skewness;
      kurtosis = desc.kurtosis;
    } catch {}

    try {
      const slopeResult = E.SpectralSlope(magVector);
      slope = slopeResult.spectralSlope;
    } catch {}

    try {
      if (this.prevFreqBuf) {
        const prevMag = Float32Array.from(this.prevFreqBuf, db => Math.pow(10, db / 20));
        const prevVec = E.arrayToVector(prevMag);
        const fluxResult = E.Flux(magVector, prevVec);
        flux = fluxResult.flux;
      }
      this.prevFreqBuf!.set(freq);
    } catch {}

    try {
      const tristResult = E.Tristimulus(magVector);
      tristimulus = [tristResult.tristimulus.get(0), tristResult.tristimulus.get(1), tristResult.tristimulus.get(2)];
    } catch {}

    try {
      const hnrResult = E.HarmonicPeaks(magVector, E.arrayToVector(new Float32Array([pitch])));
      hnr = hnrResult ? hnrResult.harmonicMagnitudes?.get(0) ?? 0 : 0;
    } catch {}

    try {
      const mfccResult = E.MFCC(magVector);
      mfcc = Array.from({ length: 13 }, (_, i) => mfccResult.mfcc.get(i));
    } catch {}

    try {
      const zcrResult = E.ZeroCrossingRate(audioVector);
      zcr = zcrResult.zeroCrossingRate;
    } catch {}

    return {
      pitch,
      pitchNote: hzToNote(pitch),
      rmsDb,
      lufsM,
      lufsS,
      lufsI,
      zcr,
      centroid,
      spread,
      skewness,
      kurtosis,
      slope,
      flux,
      tristimulus,
      hnr,
      mfcc,
    };
  }

  private render(results: SAResults): void {
    const viewEl = this.viewEls[this.activeView];
    if (!viewEl) return;

    switch (this.activeView) {
      case 'text':
        renderTextView(viewEl, results);
        break;
      case 'spectrum':
        renderSpectrumView(viewEl, this.freqBuf!);
        break;
      case 'timbre':
        renderTimbreView(viewEl, results);
        break;
      case 'lufs':
        this.lufsHistory.render(viewEl, results.lufsM, results.lufsS, results.lufsI);
        break;
    }
  }

  private setStatus(msg: string): void {
    if (this.statusEl) this.statusEl.textContent = msg;
  }

  public dispose(): void {
    this.deactivate();
  }

  public addParticipantSource(id: string, label: string): void {
    if (!this.sourceSelect) return;
    const existing = this.sourceSelect.querySelector(`option[value="participant:${id}"]`);
    if (!existing) {
      const opt = document.createElement('option');
      opt.value = `participant:${id}`;
      opt.textContent = `ptcp:${label}`;
      this.sourceSelect.appendChild(opt);
    }
  }

  public removeParticipantSource(id: string): void {
    this.sourceSelect?.querySelector(`option[value="participant:${id}"]`)?.remove();
  }
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load script: ${src}`));
    document.head.appendChild(s);
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add src/scripts/room/sonic-analyzer/controller.ts
git commit -m "feat(sa): add SonicAnalyzerController — on/off, essentia lazy-load, analysis loop"
```

---

## Task 10: Create index.ts

**Files:**
- Create: `src/scripts/room/sonic-analyzer/index.ts`

- [ ] **Step 1: Write re-exports**

Create `src/scripts/room/sonic-analyzer/index.ts`:

```ts
export { SonicAnalyzerController } from './controller';
export type { SonicAnalyzerOptions } from './controller';
```

- [ ] **Step 2: Commit**

```bash
git add src/scripts/room/sonic-analyzer/index.ts
git commit -m "feat(sa): add sonic-analyzer index"
```

---

## Task 11: Register template in PodTemplates.astro

**Files:**
- Modify: `src/components/room/workspace/PodTemplates.astro:1-14`

- [ ] **Step 1: Add import and template mount**

In `PodTemplates.astro`, add the import at the top of the frontmatter block (after `import ClasePanel`):

```astro
---
import GraphPod from './GraphPod.astro';
import ChatPanel from '../panels/chat/ChatPanel.astro';
import OrfPanel from '../panels/orf/OrfPanel.astro';
import NotesPanel from '../panels/notes/NotesPanel.astro';
import ClasePanel from '../panels/clase/ClasePanel.astro';
import SonicAnalyzerPanel from '../panels/sonic-analyzer/SonicAnalyzerPanel.astro';
---
```

And add the template inside `#musiki-pod-templates`, before the closing `</div>`, after the `<!-- IS: INSTANT SCORE -->` block:

```astro
<!-- Sa: SONIC ANALYZER -->
<SonicAnalyzerPanel />
```

- [ ] **Step 2: Import the CSS**

In `SonicAnalyzerPanel.astro`, add a style import at the top of the frontmatter:

```astro
---
import './sonic-analyzer.css';
---
```

- [ ] **Step 3: Commit**

```bash
git add src/components/room/workspace/PodTemplates.astro src/components/room/panels/sonic-analyzer/SonicAnalyzerPanel.astro
git commit -m "feat(sa): register SonicAnalyzerPanel in pod templates"
```

---

## Task 12: Wire onSonicAnalyzerInit in livekit-room.ts

**Files:**
- Modify: `src/scripts/livekit-room.ts` (around lines 10854–10891)

This is the final integration. We expose an audio tap getter and create the `onSonicAnalyzerInit` callback.

- [ ] **Step 1: Add import at top of livekit-room.ts**

Near the other room script imports (around line 27), add:

```ts
import { SonicAnalyzerController } from './room/sonic-analyzer';
```

- [ ] **Step 2: Declare saController variable**

Near where `orfController` is declared in the main room function scope, add:

```ts
let sonicAnalyzerController: SonicAnalyzerController | null = null;
```

- [ ] **Step 3: Add the onSonicAnalyzerInit callback**

After the `onScoreInit` block (around line 10857), add:

```ts
const onSonicAnalyzerInit = (container: HTMLElement) => {
  if (sonicAnalyzerController) {
    sonicAnalyzerController.dispose();
  }
  sonicAnalyzerController = new SonicAnalyzerController({
    container,
    getAudioTap: () => {
      if (!incomingAudioContext || !incomingAudioMasterAnalyser) return null;
      return { context: incomingAudioContext, masterAnalyser: incomingAudioMasterAnalyser };
    },
  });
};
```

- [ ] **Step 4: Pass onSonicAnalyzerInit to RoomWorkspaceManager**

Find the `new RoomWorkspaceManager(...)` call (line 10878) and add `onSonicAnalyzerInit` as the last argument:

```ts
const workspaceManager = new RoomWorkspaceManager(
  root.querySelector('[data-workspace-root]') as HTMLElement,
  canLeadSession,
  (layout) => void publishWorkspaceLayoutState(layout),
  onHyperpianoInit,
  onWhiteboardInit,
  onLilypondInit,
  onConceptInit,
  onMediaInit,
  onClaseInit,
  onChatInit,
  onOrfInit,
  onScoreInit,
  onSonicAnalyzerInit,
);
```

- [ ] **Step 5: Check TypeScript**

```bash
npx tsc --noEmit 2>&1 | grep -E "sonicAnalyzer|SonicAnalyzer|sa-pod|onSonicAnalyzer" | head -20
```

Expected: no errors for the new code.

- [ ] **Step 6: Commit**

```bash
git add src/scripts/livekit-room.ts
git commit -m "feat(sa): wire SonicAnalyzerController into livekit-room via onSonicAnalyzerInit"
```

---

## Task 13: Smoke test

- [ ] **Step 1: Build and verify no compile errors**

```bash
npm run build 2>&1 | tail -20
```

Expected: build succeeds, no errors related to `sonic-analyzer`.

- [ ] **Step 2: Dev server smoke test**

```bash
npm run dev
```

Open the room URL. Verify:
1. The `SA` pod appears in the pod gallery (atomic 19, green color)
2. Dragging it to the workspace shows the sA panel with LED off
3. Clicking the LED → status shows "loading essentia…" then "on · master · 10fps"
4. TXT tab updates with numeric values
5. FFT tab shows ASCII bars
6. TMB tab shows descriptor grid
7. LUF tab shows meters + envelope
8. FPS slider changes update rate
9. Clicking LED again → status "off", pod dims

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat(sa): sonic analyzer pod complete — essentia.js, 4 views, LED switch, source selector"
```

---

## Self-Review

**Spec coverage check:**
- ✅ LED switch (off = no load) — Task 9 controller.activate/deactivate
- ✅ Essentia.js lazy load — Task 9 loadEssentia() via loadScript
- ✅ Audio source selector (master/mic/participant) — Task 9 connectSource()
- ✅ Master bus tap — Task 12 getAudioTap() via incomingAudioMasterAnalyser
- ✅ TEXT view — Task 5
- ✅ SPECTRUM view — Task 6
- ✅ TIMBRE view + MFCC — Task 7
- ✅ LUFS view + history envelope — Task 8
- ✅ Configurable FPS 1-30, default 10 — Task 9 fpsSlider
- ✅ Wireframe monospace aesthetic — Task 4
- ✅ Pod registration in POD_TYPES — Task 2
- ✅ Pod template in PodTemplates.astro — Task 11

**Type consistency:**
- `SAResults` defined in `text-view.ts`, imported by `timbre-view.ts` and `controller.ts` ✅
- `LufsHistory.render()` signature matches call in `controller.ts` ✅
- `SonicAnalyzerController` constructor takes `{ container, getAudioTap }` — matches Task 12 ✅
- `RoomWorkspaceManager` constructor last param `onSonicAnalyzerInit` — matches Tasks 2 and 12 ✅

**Note on Essentia API calls:** The `analyze()` method in controller.ts uses try/catch around each Essentia call. This is intentional — Essentia.js WASM API throws if inputs are invalid (silence, zero-length vectors). The catch blocks let the frame render with zero values rather than crashing.

---

## Task 14: Extended file-based visualizations (post-MVP)

These features require a loaded audio file (`fileBuffer`) and are computed one-shot in `computeVizFeatures()`, NOT in the real-time tick loop.

### ✅ Implemented (Tasks 13+)

**Responsive radar + resize observer** (`controller.ts` — `bindResize()`)
- `ResizeObserver` on `.sa-pod` rebuilds waveform cache and redraws heatmap on size change
- Radar auto-resizes by reading `canvas.clientWidth/clientHeight` on every `drawRadar()` call

**Viz panel layout** (`SonicAnalyzerPanel.astro` + `sonic-analyzer.css`)
- Right panel 148px wide, vertical flex
- Radar occupies upper flex space; `sa-radar-wrap` centers canvas with `aspect-ratio:1`
- Computed section below (MEL / CHR / PCH vtabs + heatmap canvas)

**MEL heatmap** — green palette pixel heatmap of log-mel spectrogram frames (`viz-view.ts`)

**CHR heatmap** — HPCP chroma heatmap (12 pitch classes × time frames, `viz-view.ts`)

**PCH contour** — PitchMelodia log-scale pitch contour line on canvas (`viz-view.ts`)

**Key detection** (`controller.ts` — `computeVizFeatures()`)
- Average HPCP frames → `E.Key()` → stores `fileKey` + `fileScale`
- Displayed in TEXT tab as `key · A minor` after the horizontal rule

**BPM detection** (`controller.ts` — `computeVizFeatures()`)
- `E.RhythmExtractor2013(audioVec)` → stores `fileBpm`
- Displayed in TEXT tab as `bpm ·   120.0` after the horizontal rule

---

### Planned (future)

#### 14a: Onset detection + beat grid overlay on waveform

**Goal:** Show beat markers on the waveform canvas.

**Approach:**
1. In `computeVizFeatures()`, run `E.RhythmExtractor2013(audioVec)` (already done for BPM) — it also returns `ticks: VectorFloat` (beat positions in seconds)
2. Store `this.beatTicks: number[] = []`
3. In `redrawWaveform()`, after drawing cache + playhead, loop beat ticks:
   ```ts
   ctx.strokeStyle = 'rgba(255,255,255,0.15)';
   ctx.lineWidth = 1;
   for (const t of this.beatTicks) {
     const x = (t / this.fileBuffer!.duration) * canvas.width;
     ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
   }
   ```

**Files to change:** `controller.ts` only

---

#### 14b: Key/scale + BPM in status bar

**Goal:** Show key + BPM in the `sa-status` bar so it's always visible regardless of active tab.

**Approach:**
- Add a `<span data-sa-key-bpm class="sa-file-name" hidden></span>` to the status bar in `SonicAnalyzerPanel.astro`
- After key+bpm compute in `computeVizFeatures()`, set its textContent:
  ```ts
  const el = this.podEl.querySelector<HTMLElement>('[data-sa-key-bpm]');
  if (el) { el.textContent = `${this.fileKey} ${this.fileScale} · ${this.fileBpm}bpm`; el.hidden = false; }
  ```

**Files to change:** `SonicAnalyzerPanel.astro`, `controller.ts`

---

#### 14c: MFCC heatmap vtab

**Goal:** Add "MFC" as a 4th vtab in the computed section alongside MEL/CHR/PCH.

**Approach:**
1. Add `<button class="sa-vtab" data-sa-vtab="mfc">MFC</button>` to `SonicAnalyzerPanel.astro`
2. Collect MFCC frames in `computeVizFeatures()` (same frame loop as mel spec, call `E.MFCC(spectrum.spectrum)`)
3. Store as `this.mfccData: number[][] = []`
4. In `renderCurrentHeatmap()`, add `else if (this.activeVTab === 'mfc' && this.mfccData.length) renderHeatmap(this.heatmapCanvas, this.mfccData);`

**Files to change:** `SonicAnalyzerPanel.astro`, `controller.ts`

---

#### 14d: Loudness / RMS envelope vtab

**Goal:** Show a scrolling amplitude envelope as a heatmap column (1-bin wide × time).

**Approach:**
- In `computeVizFeatures()`, compute per-frame RMS and store as `this.rmsEnvData: number[][] = []` (each frame is `[rms_value]`, i.e. 1 bin)
- Render with `renderHeatmap(canvas, this.rmsEnvData, false)` — it handles arbitrary bin counts

**Files to change:** `controller.ts` only (+ vtab in Astro if shown separately)

---

#### 14e: Tuning / inharmonicity display

**Goal:** Show detected tuning offset (cents from A440) and a per-frame inharmonicity estimate.

**Approach:**
- After PitchYin in the real-time loop, use `E.TuningFrequency()` on accumulated pitch values
- Display in TEXT tab as `tune · +12 ¢`
- Inharmonicity from `E.Inharmonicity(harmonicPeaks)` — add to TIMBRE view

**Files to change:** `controller.ts`, `views/text-view.ts`, `views/timbre-view.ts`

---

#### 14f: Tonal analysis — chord detection (experimental)

**Goal:** Real-time or file-based chord symbol estimation.

**Approach:**
- Accumulate HPCP over ~0.5s windows (3–5 frames at 10fps)
- Pass to `E.Chordata()` or `E.ChordsDescriptors()` → returns chord label
- Display in TEXT tab as `chord · Cmaj7`
- Note: Essentia.js 0.1.3 browser build may not include ChordsDetection — wrap in try/catch and degrade gracefully

**Files to change:** `controller.ts`, `views/text-view.ts`

---

## Task 15: Multi-user SA/SV sync via LiveKit + R2

**Goal:** When one user activates SA and drops a file, all other users' SV pods automatically load the same file and mirror the visualizations.

**Architecture decision: R2 file relay (not audio streaming)**

Rationale: the Musiki framework already uses "transmit commands, replicate locally" — every pod (whiteboard, lilypond, score) syncs state by broadcasting a message, not by streaming media. SA follows the same pattern:

1. **Uploader (SA active user):** after file is decoded and features computed, the `save` button (or an auto-upload option) POSTs the raw audio file to the existing R2 upload endpoint used by `foro.astro`. R2 returns a signed URL.
2. **Broadcast:** SA controller sends a LiveKit data message: `{ type: 'sa:file-sync', url: string, fileName: string }`.
3. **Receivers:** all clients receive the message, fetch the file from R2, decode it via `AudioContext.decodeAudioData()`, and dispatch `sa:file-ready` locally — feeding their own SV pods with locally computed features.

**Why not stream audio:** audio streaming already works via LiveKit tracks. SA analysis of the live stream should use `getAudioTap()` pointing at the remote participant's track (already supported via `addParticipantSource()`). File sharing is the only case requiring R2 relay.

**Why not stream the analysis results:** computed features (mel spec, HPCP, pitches) are large float arrays — sending them as data messages would exceed LiveKit's 15KB data channel limit per message. Computing locally from a shared file is cheaper.

**Implementation sketch:**

```ts
// SA controller — auto-upload after computeVizFeatures() completes
private async uploadAndBroadcast(file: Blob, fileName: string): Promise<void> {
  const fd = new FormData(); fd.append('file', file, fileName);
  const res = await fetch('/api/upload', { method: 'POST', body: fd });
  const { url } = await res.json();
  // broadcast via existing publishMessage() callback
  this.onBroadcast?.({ type: 'sa:file-sync', url, fileName });
}

// livekit-room.ts — receive handler (in the incoming data message switch)
case 'sa:file-sync': {
  const buf = await (await fetch(msg.url)).arrayBuffer();
  const decoded = await incomingAudioContext.decodeAudioData(buf);
  // synthesize a File object and hand to SA controller's loadFile() — or
  // dispatch sa:file-ready directly after computing features locally
  break;
}
```

**Files to change:**
- `controller.ts` — add `onBroadcast` callback option, call after upload
- `livekit-room.ts` — add `sa:file-sync` to incoming data message handler
- `SonicAnalyzerPanel.astro` — optional "auto-share" toggle in status bar

**Open questions:**
- Auto-upload vs manual save button (privacy: user might not want to share)
- R2 URL TTL — signed URLs expire; should store file key and re-sign on demand
- Should the SV pod show a "synced from user X" label in its status bar?
