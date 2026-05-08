# SV / SA Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the radar canvas from SV into SA as a 5th panel; redesign SV into a horizontal 2-pane timeline viewer with a Sonic Visualiser-style layer system (spectrogram + 5 feature curves + segment color frames), loop-in/out by shift-drag and segment click, accurate looped playback; replace SetupModal grid-size `<select>` with a compact segmented button control.

**Architecture:** Radar migration is a surgical 3-file edit (SA HTML/CSS/controller). SV is a full rewrite of its HTML, CSS and controller — the new controller spawns a Web Worker (`waveform-analyzer.worker.js`) that receives the audio channel data and returns spectrogram pixel data plus 5 normalized feature curves and auto-detected segments. Eight layer toggles composite onto two canvases (wave pane + main pane) per animation frame. The grid-size segmented control uses `data-value` on the container div and `data-active` on each button, replacing the `<select>` value model.

**Tech Stack:** Canvas 2D API, Web Workers (Transferable ArrayBuffer), TypeScript, CSS Container Queries, Astro templates.

---

## File Structure

**Created:**
- `public/scripts/waveform-analyzer.worker.js` — FFT, spectrogram, feature curves, segment detection

**Modified:**
- `src/components/room/panels/sonic-analyzer/SonicAnalyzerPanel.astro` — add `sa-panel--radar`
- `src/components/room/panels/sonic-analyzer/sonic-analyzer.css` — 5-panel grid (4-row narrow, 5-col wide)
- `src/scripts/room/sonic-analyzer/controller.ts` — bind `radarCanvas`, import + call `drawRadar` in `render()`
- `src/components/room/panels/sonic-visualizer/SonicVisualizerPanel.astro` — full rewrite: 2-pane layout, layer buttons, play/loop in toolbar
- `src/components/room/panels/sonic-visualizer/sonic-visualizer.css` — full rewrite: pane styles, layer button styles
- `src/scripts/room/sonic-visualizer/controller.ts` — full rewrite: worker integration, layer system, loop/seek, WebRTC sync
- `src/scripts/room/session/messages.ts` — add `sv-layer` and `sv-loop` to `ConferenceMessage` union + parsers
- `src/scripts/livekit-room.ts` — add `sv-layer`/`sv-loop` handlers; gracefully ignore `sv-vtab`; update `applyGridSize` for segmented div
- `src/components/room/panels/setup/SetupModal.astro` — replace `<select>` with segmented `<div>`
- `src/components/room/panels/room-sidebar.css` — add `.conference-segmented` + `.conference-seg-btn` styles

---

## Task 1: SA HTML — add `sa-panel--radar`

**Files:**
- Modify: `src/components/room/panels/sonic-analyzer/SonicAnalyzerPanel.astro`

- [ ] **Step 1: Insert radar panel as first child of `sa-content`**

The panel wraps a canvas with `data-sa-radar`. It must be the first `sa-panel` inside `sa-content` so CSS grid positions it at column 2, row 1 (the extra-height slot).

Replace:
```html
    <div class="sa-content" data-sa-content>
      <div class="sa-panel sa-panel--text">
```
With:
```html
    <div class="sa-content" data-sa-content>
      <div class="sa-panel sa-panel--radar">
        <canvas class="sa-radar-canvas" data-sa-radar></canvas>
      </div>
      <div class="sa-panel sa-panel--text">
```

- [ ] **Step 2: Commit**

```bash
git add src/components/room/panels/sonic-analyzer/SonicAnalyzerPanel.astro
git commit -m "feat(sa): add radar panel slot to SA pod HTML"
```

---

## Task 2: SA CSS — 5-panel grid (4-row narrow, 5-col wide)

**Files:**
- Modify: `src/components/room/panels/sonic-analyzer/sonic-analyzer.css`

- [ ] **Step 1: Replace the grid block and panel placement rules**

Replace:
```css
/* 4-panel content grid — default narrow: txt wide left, 3 stacked right */
.sa-content {
  flex:1; min-height:0;
  display:grid;
  gap:1px;
  background:rgba(255,255,255,0.04);
  grid-template-columns: 2fr 1fr;
  grid-template-rows: repeat(3, 1fr);
  overflow:hidden;
}
.sa-panel {
  background: #000;
  overflow: hidden;
  display: flex; flex-direction: column;
  min-height: 0; min-width: 0;
}
.sa-panel--text     { grid-column: 1; grid-row: 1 / 4; }
.sa-panel--spectrum { grid-column: 2; grid-row: 1; }
.sa-panel--timbre   { grid-column: 2; grid-row: 2; }
.sa-panel--lufs     { grid-column: 2; grid-row: 3; }

/* Wide: 4 equal columns side by side */
@container sapod (min-width: 640px) {
  .sa-content {
    grid-template-columns: repeat(4, 1fr);
    grid-template-rows: 1fr;
  }
  .sa-panel { grid-column: auto; grid-row: auto; }
}
```
With:
```css
/* 5-panel content grid — narrow: txt wide left, radar+3 stacked right */
.sa-content {
  flex:1; min-height:0;
  display:grid;
  gap:1px;
  background:rgba(255,255,255,0.04);
  grid-template-columns: 2fr 1fr;
  grid-template-rows: minmax(0, 1.5fr) repeat(3, 1fr);
  overflow:hidden;
}
.sa-panel {
  background: #000;
  overflow: hidden;
  display: flex; flex-direction: column;
  min-height: 0; min-width: 0;
}
.sa-panel--text     { grid-column: 1; grid-row: 1 / 5; }
.sa-panel--radar    { grid-column: 2; grid-row: 1; }
.sa-panel--spectrum { grid-column: 2; grid-row: 2; }
.sa-panel--timbre   { grid-column: 2; grid-row: 3; }
.sa-panel--lufs     { grid-column: 2; grid-row: 4; }

.sa-radar-canvas { display: block; width: 100%; height: 100%; }

/* Wide: 5 equal columns side by side */
@container sapod (min-width: 640px) {
  .sa-content {
    grid-template-columns: repeat(5, 1fr);
    grid-template-rows: 1fr;
  }
  .sa-panel { grid-column: auto; grid-row: auto; }
}
```

- [ ] **Step 2: Visual check**

Run: `npm run dev` (if not running).  
Open SA pod. Expected: five panel slots visible — txt spanning full left, four stacked on right (radar slot empty/black for now). No layout breakage.

- [ ] **Step 3: Commit**

```bash
git add src/components/room/panels/sonic-analyzer/sonic-analyzer.css
git commit -m "feat(sa): 5-panel grid layout with radar slot"
```

---

## Task 3: SA Controller — bind `radarCanvas`, call `drawRadar` per frame

**Files:**
- Modify: `src/scripts/room/sonic-analyzer/controller.ts`

- [ ] **Step 1: Add import**

After line 5 (`import { LufsHistory } from './views/lufs-view';`), add:
```typescript
import { drawRadar } from './views/radar-view';
```

- [ ] **Step 2: Add private field**

After the `private lufsInner!: HTMLElement;` line (~line 76), add:
```typescript
  private radarCanvas!: HTMLCanvasElement;
```

- [ ] **Step 3: Bind in `bindDOM()`**

After `this.lufsInner = q('[data-sa-lufs-inner]')!;` (~line 112), add:
```typescript
    this.radarCanvas = q<HTMLCanvasElement>('[data-sa-radar]')!;
```

- [ ] **Step 4: Draw in `render()`**

After `this.lufsHistory.render(this.lufsInner, r.lufsM, r.lufsS, r.lufsI);` (~line 358), add:
```typescript
    drawRadar(this.radarCanvas, r);
```

- [ ] **Step 5: Visual check**

Activate SA with master or mic source. Expected: animated radar spider chart appears in the SA pod's radar panel (top-right).

- [ ] **Step 6: Commit**

```bash
git add src/scripts/room/sonic-analyzer/controller.ts
git commit -m "feat(sa): bind radar canvas and draw per frame tick"
```

---

## Task 4: SV HTML — redesign to 2-pane + layer toolbar

**Files:**
- Modify: `src/components/room/panels/sonic-visualizer/SonicVisualizerPanel.astro`

- [ ] **Step 1: Replace entire file body**

The new layout has a toolbar (label, status, 8 layer buttons, play, loop) and two flex panes (wave on top at fixed height, main fills remainder). The old radar wrap and heatmap canvas are gone. The old vtab buttons are gone.

```astro
---
import './sonic-visualizer.css';
---
<div class="musiki-pod" data-pod="sonic-visualizer" data-pod-title="SV">
  <div class="sv-pod">

    <div class="musiki-pod-toolbar sv-toolbar">
      <span class="sv-label">sV</span>
      <span class="sv-status" data-sv-status>waiting for sA…</span>
      <div class="sv-layers">
        <button type="button" class="musiki-pod-btn sv-layer-btn" data-sv-layer="spec" data-active="true" >SPEC</button>
        <button type="button" class="musiki-pod-btn sv-layer-btn" data-sv-layer="wav"  data-active="true" >WAV</button>
        <button type="button" class="musiki-pod-btn sv-layer-btn" data-sv-layer="enr"  data-active="true" >ENR</button>
        <button type="button" class="musiki-pod-btn sv-layer-btn" data-sv-layer="brt"  data-active="false">BRT</button>
        <button type="button" class="musiki-pod-btn sv-layer-btn" data-sv-layer="mot"  data-active="false">MOT</button>
        <button type="button" class="musiki-pod-btn sv-layer-btn" data-sv-layer="grv"  data-active="false">GRV</button>
        <button type="button" class="musiki-pod-btn sv-layer-btn" data-sv-layer="ten"  data-active="false">TEN</button>
        <button type="button" class="musiki-pod-btn sv-layer-btn" data-sv-layer="seg"  data-active="true" >SEG</button>
      </div>
      <button type="button" class="musiki-pod-btn sv-play-btn"  data-sv-play  title="Play / Pause">▶</button>
      <button type="button" class="musiki-pod-btn sv-loop-btn"  data-sv-loop  data-active="false" title="Loop region">⟳</button>
    </div>

    <div class="sv-panes">
      <div class="sv-pane sv-pane--wave">
        <canvas class="sv-wave-canvas" data-sv-wave></canvas>
      </div>
      <div class="sv-pane sv-pane--main">
        <canvas class="sv-main-canvas" data-sv-main-canvas></canvas>
      </div>
    </div>

  </div>
</div>
```

- [ ] **Step 2: Commit**

```bash
git add src/components/room/panels/sonic-visualizer/SonicVisualizerPanel.astro
git commit -m "feat(sv): redesign HTML — 2-pane layout with layer toolbar"
```

---

## Task 5: SV CSS — new pane and layer styles

**Files:**
- Modify: `src/components/room/panels/sonic-visualizer/sonic-visualizer.css`

- [ ] **Step 1: Replace entire file**

```css
/* sV — Sonic Visualizer Pod */

.sv-pod {
  display: flex; flex-direction: column; height: 100%;
  font-family: var(--font-family-mono, monospace);
  font-size: 0.72rem; color: var(--conference-fg, #cdd6f4);
  container-type: inline-size; container-name: svpod;
}
.sv-toolbar { gap: 0.3rem; flex-shrink: 0; flex-wrap: wrap; }
.sv-label {
  font-size: 0.55rem; font-weight: 900; letter-spacing: 0.18em;
  text-transform: uppercase; color: #45D384; opacity: 0.7; flex-shrink: 0;
}
.sv-status {
  font-size: 0.52rem; color: var(--conference-muted,#7f849c);
  letter-spacing: 0.07em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  flex: 1; min-width: 0;
}

/* Layer toggle row */
.sv-layers { display: flex; gap: 2px; flex-wrap: wrap; flex-shrink: 0; }
.sv-layer-btn {
  font-size: 0.45rem; letter-spacing: 0.06em;
  padding: 1px 4px; height: 1.3rem; min-width: unset;
}
.sv-layer-btn[data-active="true"] { color: #45D384; border-color: rgba(69,211,132,0.4); }

/* Play / Loop in toolbar */
.sv-play-btn, .sv-loop-btn {
  font-size: 0.65rem; padding: 0 0.35rem; height: 1.3rem; min-width: unset; flex-shrink: 0;
}
.sv-loop-btn[data-active="true"] { color: #45D384; border-color: rgba(69,211,132,0.4); }

/* Pane container */
.sv-panes {
  flex: 1; min-height: 0;
  display: flex; flex-direction: column;
  background: rgba(255,255,255,0.04); gap: 1px;
}
.sv-pane { display: flex; overflow: hidden; min-height: 0; }
.sv-pane--wave {
  flex: 0 0 48px;
  border-bottom: 1px solid rgba(255,255,255,0.05);
}
.sv-pane--main { flex: 1; }

.sv-wave-canvas,
.sv-main-canvas {
  display: block; width: 100%; height: 100%;
  cursor: crosshair;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/room/panels/sonic-visualizer/sonic-visualizer.css
git commit -m "feat(sv): new pane and layer button styles"
```

---

## Task 6: Worker — `waveform-analyzer.worker.js`

**Files:**
- Create: `public/scripts/waveform-analyzer.worker.js`

- [ ] **Step 1: Create the file**

```javascript
// public/scripts/waveform-analyzer.worker.js
'use strict';

const FFT_SIZE = 2048;
const HALF_FFT = FFT_SIZE >> 1;

// ─── Iterative Cooley-Tukey FFT (in-place, radix-2) ──────────────────────────
function fft(re, im) {
  const N = re.length;
  for (let i = 1, j = 0; i < N; i++) {
    let bit = N >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= N; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wRe = Math.cos(ang), wIm = Math.sin(ang);
    for (let i = 0; i < N; i += len) {
      let curRe = 1, curIm = 0;
      const half = len >> 1;
      for (let k = 0; k < half; k++) {
        const u = i + k, v = i + k + half;
        const vRe = re[v] * curRe - im[v] * curIm;
        const vIm = re[v] * curIm + im[v] * curRe;
        re[v] = re[u] - vRe; im[v] = im[u] - vIm;
        re[u] += vRe; im[u] += vIm;
        const tmp = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe; curRe = tmp;
      }
    }
  }
}

// ─── Hann window ─────────────────────────────────────────────────────────────
const HANN = new Float32Array(FFT_SIZE);
for (let i = 0; i < FFT_SIZE; i++) HANN[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (FFT_SIZE - 1)));

// ─── Colormap: dark → blue → cyan → yellow → white ───────────────────────────
function colormap(v) {
  const t = Math.max(0, Math.min(1, v));
  const r = Math.round(Math.min(255, Math.max(0, t < 0.5 ? 0 : (t - 0.5) * 4 * 200 + 55)));
  const g = Math.round(Math.min(255, Math.max(0, t < 0.25 ? 0 : (t - 0.25) * 4 * 200)));
  const b = Math.round(Math.min(255, Math.max(0, t < 0.5 ? t * 2 * 255 : (1 - (t - 0.5) * 2) * 255)));
  return [r, g, b];
}

// ─── Spectrogram → Uint8ClampedArray (RGBA, width × height) ──────────────────
function buildSpectrogram(channelData, width, height) {
  const total   = channelData.length;
  const hopSize = Math.max(1, Math.floor(total / width));
  const re = new Float32Array(FFT_SIZE);
  const im = new Float32Array(FFT_SIZE);

  const frames = [];
  let maxMag = 1e-10;
  for (let col = 0; col < width; col++) {
    const offset = col * hopSize;
    re.fill(0); im.fill(0);
    for (let k = 0; k < FFT_SIZE; k++) {
      const idx = offset + k;
      re[k] = idx < total ? channelData[idx] * HANN[k] : 0;
    }
    fft(re, im);
    const frame = new Float32Array(HALF_FFT);
    for (let k = 0; k < HALF_FFT; k++) {
      frame[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      if (frame[k] > maxMag) maxMag = frame[k];
    }
    frames.push(frame);
  }

  // Top row = high freq, bottom = low freq; quadratic bin mapping for log-like scale
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let col = 0; col < width; col++) {
    const frame = frames[col];
    for (let row = 0; row < height; row++) {
      const frac   = 1 - row / height;
      const binIdx = Math.min(HALF_FFT - 1, Math.floor(frac * frac * HALF_FFT));
      const mag    = frame[binIdx] / maxMag;
      const db     = Math.max(0, 1 + Math.log10(Math.max(1e-6, mag)) / 4);
      const [r, g, b] = colormap(db);
      const px = (row * width + col) * 4;
      pixels[px] = r; pixels[px + 1] = g; pixels[px + 2] = b; pixels[px + 3] = 255;
    }
  }
  return pixels;
}

// ─── Feature curves (128 normalized points each) ─────────────────────────────
function computeFeatures(channelData, sampleRate, nPoints) {
  const total      = channelData.length;
  const re = new Float32Array(FFT_SIZE);
  const im = new Float32Array(FFT_SIZE);
  const freqPerBin = sampleRate / FFT_SIZE;
  const cutoffBin  = Math.min(HALF_FFT - 1, Math.floor(500 / freqPerBin));

  const rawEnergy  = new Float32Array(nPoints);
  const rawBright  = new Float32Array(nPoints);
  const rawMotion  = new Float32Array(nPoints);
  const rawGravity = new Float32Array(nPoints);
  let prevMags = new Float32Array(HALF_FFT);

  for (let i = 0; i < nPoints; i++) {
    const offset  = Math.floor((i / nPoints) * total);
    const frameEnd = Math.min(total, offset + FFT_SIZE);
    re.fill(0); im.fill(0);
    for (let k = 0; k < FFT_SIZE; k++) {
      const idx = offset + k;
      re[k] = idx < total ? channelData[idx] * HANN[k] : 0;
    }
    fft(re, im);

    const mags = new Float32Array(HALF_FFT);
    let totalMag = 0, weightedFreq = 0, lowMag = 0, rms = 0;
    for (let k = 0; k < HALF_FFT; k++) {
      mags[k]       = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      totalMag     += mags[k];
      weightedFreq += mags[k] * k * freqPerBin;
      if (k <= cutoffBin) lowMag += mags[k];
    }

    for (let k = offset; k < frameEnd; k++) rms += channelData[k] * channelData[k];
    rawEnergy[i]  = Math.sqrt(rms / (frameEnd - offset));
    rawBright[i]  = totalMag > 0 ? (weightedFreq / totalMag) / (sampleRate / 2) : 0;

    let flux = 0;
    for (let k = 0; k < HALF_FFT; k++) {
      const diff = mags[k] - prevMags[k];
      if (diff > 0) flux += diff;
    }
    rawMotion[i]  = flux;
    rawGravity[i] = totalMag > 0 ? lowMag / totalMag : 0;
    prevMags = mags;
  }

  const normalize = (arr) => {
    let mn = Infinity, mx = -Infinity;
    for (const v of arr) { if (v < mn) mn = v; if (v > mx) mx = v; }
    const range = mx - mn || 1;
    return Array.from(arr, v => (v - mn) / range);
  };

  const energy     = normalize(rawEnergy);
  const brightness = normalize(rawBright);
  const motion     = normalize(rawMotion);
  const gravity    = Array.from(rawGravity);
  const tension    = energy.map((e, i) =>
    Math.max(0, Math.min(1, 0.4 * motion[i] + 0.4 * brightness[i] + 0.2 * (1 - gravity[i]))));

  return { energy, brightness, motion, gravity, tension };
}

// ─── Segment detection ────────────────────────────────────────────────────────
function detectSegments(features) {
  const { energy, brightness, motion, gravity, tension } = features;
  const n      = energy.length;
  const minLen = Math.max(3, Math.floor(n * 0.05));
  const eMean  = energy.reduce((a, b) => a + b, 0) / n;
  const mMean  = motion.reduce((a, b) => a + b, 0) / n;
  const boundaries = [0];

  for (let i = 2; i < n - 2; i++) {
    const trough = energy[i] < energy[i-1] && energy[i] < energy[i+1] && energy[i] < eMean * 0.7;
    const peak   = motion[i] > mMean * 1.5  && motion[i] > motion[i-1] && motion[i] > motion[i+1];
    if ((trough || peak) && i - boundaries[boundaries.length - 1] >= minLen) {
      boundaries.push(i);
    }
  }
  boundaries.push(n);

  return boundaries.slice(0, -1).map((start, s) => {
    const end  = boundaries[s + 1];
    const sl   = (arr) => arr.slice(start, end);
    const mean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
    return {
      startRatio: start / n,
      endRatio:   end   / n,
      energy:     mean(sl(energy)),
      brightness: mean(sl(brightness)),
      motion:     mean(sl(motion)),
      gravity:    mean(sl(gravity)),
      tension:    mean(sl(tension)),
    };
  });
}

// ─── Entry point ──────────────────────────────────────────────────────────────
self.onmessage = (e) => {
  const { channelData, width, height, sampleRate, duration, requestId } = e.data;
  const pixelData = buildSpectrogram(channelData, width, height);
  const formData  = computeFeatures(channelData, sampleRate, 128);
  formData.segments = detectSegments(formData);
  self.postMessage({ pixelData, width, height, requestId, formData }, [pixelData.buffer]);
};
```

- [ ] **Step 2: Smoke-test in browser devtools console**

With dev server running, paste in devtools:
```javascript
const w = new Worker('/scripts/waveform-analyzer.worker.js');
const actx = new AudioContext();
const buf = actx.createBuffer(1, actx.sampleRate * 3, actx.sampleRate);
const ch = buf.getChannelData(0);
for (let i = 0; i < ch.length; i++) ch[i] = Math.sin(i / 50) * 0.5 + (Math.random() - 0.5) * 0.1;
const copy = new Float32Array(ch);
w.onmessage = e => console.log('segments:', e.data.formData.segments.length, 'px size:', e.data.pixelData.byteLength);
w.postMessage({ channelData: copy, width: 300, height: 150, sampleRate: actx.sampleRate, duration: 3, requestId: 1 }, [copy.buffer]);
```

Expected output: `segments: <N> px size: 180000` (300×150×4 = 180000). N ≥ 1.

- [ ] **Step 3: Commit**

```bash
git add public/scripts/waveform-analyzer.worker.js
git commit -m "feat(sv): add waveform-analyzer Web Worker (FFT, features, segments)"
```

---

## Task 7: SV Controller — complete rewrite

**Files:**
- Modify: `src/scripts/room/sonic-visualizer/controller.ts`

- [ ] **Step 1: Replace entire file**

```typescript
import type { SAResults } from '../sonic-analyzer/views/text-view';
import type { SAFilePayload } from '../sonic-analyzer/controller';
import type { ConferenceMessage } from '../session';

export type SVOptions = { container: HTMLElement; publish?: (msg: ConferenceMessage) => void };

const CURVE_COLORS: Record<string, string> = {
  enr: 'rgba(69,211,132,0.7)',
  brt: 'rgba(255,217,102,0.7)',
  mot: 'rgba(118,211,255,0.7)',
  grv: 'rgba(180,120,255,0.7)',
  ten: 'rgba(255,100,100,0.7)',
};

type Segment = {
  startRatio: number; endRatio: number;
  energy: number; brightness: number; motion: number; gravity: number; tension: number;
};
type WorkerFormData = {
  energy: number[]; brightness: number[]; motion: number[];
  gravity: number[]; tension: number[]; segments: Segment[];
};

export class SonicVisualizerController {
  private container: HTMLElement;
  private publish?: (msg: ConferenceMessage) => void;

  // DOM
  private podEl!: HTMLElement;
  private statusEl!: HTMLElement;
  private waveCanvas!: HTMLCanvasElement;
  private mainCanvas!: HTMLCanvasElement;
  private playBtn!: HTMLButtonElement;
  private loopBtn!: HTMLButtonElement;
  private layerBtns = new Map<string, HTMLButtonElement>();

  // Layer visibility
  private layers: Record<string, boolean> = {
    spec: true, wav: true, enr: true, brt: false,
    mot: false, grv: false, ten: false, seg: true,
  };

  // Worker / cached data
  private worker: Worker | null = null;
  private workerRequestId = 0;
  private spectroOffscreen: HTMLCanvasElement | null = null;
  private waveformPeaks: { min: number; max: number }[] = [];
  private formData: WorkerFormData | null = null;

  // Playback
  private audioBuffer: AudioBuffer | null = null;
  private audioCtx: AudioContext | null = null;
  private playbackNode: AudioBufferSourceNode | null = null;
  private isPlaying = false;
  private playOffset = 0;
  private playStartTime = 0;
  private rafId: number | null = null;

  // Loop
  private loopEnabled = false;
  private loopIn = 0;
  private loopOut = 0;

  // Interaction state
  private isDragging = false;
  private isLoopDragging = false;
  private longPressTimer: ReturnType<typeof setTimeout> | null = null;

  // Bound handlers (for cleanup)
  private onFrame: (e: Event) => void;
  private onFileReady: (e: Event) => void;
  private onSAActive: (e: Event) => void;

  constructor(options: SVOptions) {
    this.container = options.container;
    this.publish   = options.publish;
    this.bindDOM();
    this.bindResize();

    this.onFrame     = (e) => this.handleFrame((e as CustomEvent<{ results: SAResults }>).detail);
    this.onFileReady = (e) => this.handleFileReady((e as CustomEvent<SAFilePayload>).detail);
    this.onSAActive  = (e) => this.handleSAActive((e as CustomEvent<{ active: boolean }>).detail);

    window.addEventListener('sa:frame',      this.onFrame);
    window.addEventListener('sa:file-ready', this.onFileReady);
    window.addEventListener('sa:active',     this.onSAActive);
    window.dispatchEvent(new CustomEvent('sv:request-state'));
  }

  private bindDOM(): void {
    const q = <T extends HTMLElement>(sel: string) => this.container.querySelector<T>(sel)!;
    this.podEl      = q('.sv-pod');
    this.statusEl   = q('[data-sv-status]');
    this.waveCanvas = q<HTMLCanvasElement>('[data-sv-wave]');
    this.mainCanvas = q<HTMLCanvasElement>('[data-sv-main-canvas]');
    this.playBtn    = q<HTMLButtonElement>('[data-sv-play]');
    this.loopBtn    = q<HTMLButtonElement>('[data-sv-loop]');

    this.container.querySelectorAll<HTMLButtonElement>('[data-sv-layer]').forEach(btn => {
      this.layerBtns.set(btn.dataset.svLayer!, btn);
      btn.addEventListener('click', () => this.toggleLayer(btn.dataset.svLayer!));
    });

    this.playBtn.addEventListener('click', () => this.togglePlayback());
    this.loopBtn.addEventListener('click', () => this.toggleLoop());
    this.bindWaveInteraction();
    this.bindMainInteraction();
  }

  // ─── SA events ───────────────────────────────────────────────────────────────

  private handleFrame(_detail: { results: SAResults }): void {
    // Radar is now rendered by SA controller; SV ignores realtime frames
  }

  private handleFileReady(payload: SAFilePayload): void {
    this.audioBuffer   = payload.buffer;
    this.waveformPeaks = payload.peaks;
    const bpm = payload.bpm > 0 ? ` · ${payload.bpm.toFixed(0)}bpm` : '';
    const key = payload.key ? ` · ${payload.key} ${payload.scale}` : '';
    this.setStatus(`${payload.fileName}${key}${bpm}`);
    this.resizeCanvases();
    this.runWorker();
  }

  private handleSAActive(detail: { active: boolean }): void {
    if (!detail.active && !this.audioBuffer) this.setStatus('waiting for sA…');
  }

  // ─── Worker ──────────────────────────────────────────────────────────────────

  private runWorker(): void {
    if (!this.audioBuffer) return;
    if (!this.worker) {
      this.worker = new Worker('/scripts/waveform-analyzer.worker.js');
      this.worker.onmessage = (e) => this.handleWorkerResult(e.data);
    }
    const requestId = ++this.workerRequestId;
    const w    = Math.max(1, this.mainCanvas.clientWidth  || 400);
    const h    = Math.max(1, this.mainCanvas.clientHeight || 200);
    const copy = new Float32Array(this.audioBuffer.getChannelData(0));
    this.worker.postMessage(
      { channelData: copy, width: w, height: h,
        sampleRate: this.audioBuffer.sampleRate, duration: this.audioBuffer.duration, requestId },
      [copy.buffer],
    );
  }

  private handleWorkerResult(data: {
    pixelData: Uint8ClampedArray; width: number; height: number;
    requestId: number; formData: WorkerFormData;
  }): void {
    if (data.requestId !== this.workerRequestId) return; // stale result
    this.formData = data.formData;
    const off = document.createElement('canvas');
    off.width = data.width; off.height = data.height;
    off.getContext('2d')!.putImageData(new ImageData(data.pixelData, data.width, data.height), 0, 0);
    this.spectroOffscreen = off;
    this.startAnimLoop();
  }

  // ─── Layer system ─────────────────────────────────────────────────────────────

  private applyLayer(key: string, visible: boolean): void {
    this.layers[key] = visible;
    const btn = this.layerBtns.get(key);
    if (btn) btn.dataset.active = visible ? 'true' : 'false';
  }

  private toggleLayer(key: string): void {
    const next = !this.layers[key];
    this.applyLayer(key, next);
    this.publish?.({ type: 'sv-layer', layer: key, visible: next });
  }

  public applyRemoteLayer(layer: string, visible: boolean): void {
    this.applyLayer(layer, visible);
  }

  // ─── Drawing ─────────────────────────────────────────────────────────────────

  private resizeCanvases(): void {
    const dpr = window.devicePixelRatio || 1;
    for (const canvas of [this.waveCanvas, this.mainCanvas]) {
      const w = Math.max(1, canvas.clientWidth);
      const h = Math.max(1, canvas.clientHeight);
      canvas.width  = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
  }

  private redrawWavePane(): void {
    if (!this.audioBuffer || !this.waveformPeaks.length) return;
    const canvas = this.waveCanvas;
    const dpr    = window.devicePixelRatio || 1;
    const ctx    = canvas.getContext('2d')!;
    const W = canvas.width, H = canvas.height, dur = this.audioBuffer.duration;
    const cssW = W / dpr;
    ctx.clearRect(0, 0, W, H);

    if (this.loopEnabled && this.loopOut > this.loopIn) {
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      ctx.fillRect((this.loopIn / dur) * W, 0, ((this.loopOut - this.loopIn) / dur) * W, H);
    }

    const n = this.waveformPeaks.length, mid = H / 2;
    ctx.strokeStyle = 'rgba(69,211,132,0.65)';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    for (let i = 0; i < cssW; i++) {
      const { min, max } = this.waveformPeaks[Math.min(n - 1, Math.floor((i / cssW) * n))];
      ctx.moveTo((i + 0.5) * dpr, mid - max * mid);
      ctx.lineTo((i + 0.5) * dpr, Math.max(mid - min * mid, mid - max * mid + 1));
    }
    ctx.stroke();

    const x = (this.getCurrentPosition() / dur) * W;
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth   = 1;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }

  private redrawMainPane(): void {
    if (!this.audioBuffer) return;
    const canvas = this.mainCanvas;
    const dpr    = window.devicePixelRatio || 1;
    const ctx    = canvas.getContext('2d')!;
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    if (this.layers.seg  && this.formData?.segments)    this.drawSegments(ctx, W, H, dpr);
    if (this.layers.spec && this.spectroOffscreen)       ctx.drawImage(this.spectroOffscreen, 0, 0, W, H);
    if (this.layers.wav  && this.waveformPeaks.length)  this.drawWaveOverlay(ctx, W, H, dpr);
    if (this.layers.enr  && this.formData?.energy)      this.drawCurve(ctx, this.formData.energy,     CURVE_COLORS.enr, W, H);
    if (this.layers.brt  && this.formData?.brightness)  this.drawCurve(ctx, this.formData.brightness, CURVE_COLORS.brt, W, H);
    if (this.layers.mot  && this.formData?.motion)      this.drawCurve(ctx, this.formData.motion,     CURVE_COLORS.mot, W, H);
    if (this.layers.grv  && this.formData?.gravity)     this.drawCurve(ctx, this.formData.gravity,    CURVE_COLORS.grv, W, H);
    if (this.layers.ten  && this.formData?.tension)     this.drawCurve(ctx, this.formData.tension,    CURVE_COLORS.ten, W, H);
    if (this.loopEnabled && this.loopOut > this.loopIn) this.drawLoopOverlay(ctx, W, H);
    this.drawPlayhead(ctx, W, H);
  }

  private drawSegments(ctx: CanvasRenderingContext2D, W: number, H: number, dpr: number): void {
    this.formData!.segments.forEach((seg, idx) => {
      const x     = seg.startRatio * W;
      const w     = (seg.endRatio - seg.startRatio) * W;
      const hue   = 220 - seg.energy * 190;
      const light = 35 + seg.brightness * 30;
      const alpha = 0.12 + seg.tension * 0.28;
      ctx.fillStyle = `hsla(${hue},70%,${light}%,${alpha})`;
      ctx.fillRect(x, 0, w, H);
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.font = `${9 * dpr}px monospace`;
      ctx.fillText(`#${idx}`, x + 3 * dpr, 12 * dpr);
    });
  }

  private drawWaveOverlay(ctx: CanvasRenderingContext2D, W: number, H: number, dpr: number): void {
    const n    = this.waveformPeaks.length;
    const mid  = H / 2;
    const cssW = W / dpr;
    ctx.strokeStyle = 'rgba(69,211,132,0.3)';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    for (let i = 0; i < cssW; i++) {
      const { min, max } = this.waveformPeaks[Math.min(n - 1, Math.floor((i / cssW) * n))];
      ctx.moveTo((i + 0.5) * dpr, mid - max * mid);
      ctx.lineTo((i + 0.5) * dpr, Math.max(mid - min * mid, mid - max * mid + 1));
    }
    ctx.stroke();
  }

  private drawCurve(ctx: CanvasRenderingContext2D, data: number[], color: string, W: number, H: number): void {
    if (!data.length) return;
    ctx.strokeStyle = color;
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    data.forEach((v, i) => {
      const x = (i / (data.length - 1)) * W;
      const y = H - v * H;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  private drawLoopOverlay(ctx: CanvasRenderingContext2D, W: number, H: number): void {
    const dur = this.audioBuffer!.duration;
    const lx  = (this.loopIn  / dur) * W;
    const rx  = (this.loopOut / dur) * W;
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.fillRect(lx, 0, rx - lx, H);
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(lx, 0); ctx.lineTo(lx, H);
    ctx.moveTo(rx, 0); ctx.lineTo(rx, H);
    ctx.stroke();
  }

  private drawPlayhead(ctx: CanvasRenderingContext2D, W: number, H: number): void {
    if (!this.audioBuffer) return;
    const x = (this.getCurrentPosition() / this.audioBuffer.duration) * W;
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth   = 1;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }

  // ─── Pointer position helper ──────────────────────────────────────────────────

  private posAt(canvas: HTMLCanvasElement, e: PointerEvent): number {
    if (!this.audioBuffer) return 0;
    const r = canvas.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * this.audioBuffer.duration;
  }

  // ─── Wave pane interaction (seek + shift-drag loop + touch long-press loop) ───

  private bindWaveInteraction(): void {
    const canvas = this.waveCanvas;

    canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);

      if (e.shiftKey) {
        this.isLoopDragging = true;
        this.loopIn = this.posAt(canvas, e);
        this.loopOut = this.loopIn;
        return;
      }

      if (e.pointerType === 'touch') {
        const snapPos = this.posAt(canvas, e);
        this.longPressTimer = setTimeout(() => {
          this.longPressTimer = null;
          this.isDragging = false;
          this.isLoopDragging = true;
          this.loopIn = snapPos;
          this.loopOut = snapPos;
        }, 400);
      }

      this.isDragging = true;
      const p = this.posAt(canvas, e);
      this.playOffset = p;
      if (this.isPlaying) this.startPlayback(p);
      this.startAnimLoop();
    });

    canvas.addEventListener('pointermove', (e) => {
      if (this.isLoopDragging) {
        const p = this.posAt(canvas, e);
        if (p < this.loopIn) { this.loopOut = this.loopIn; this.loopIn = p; }
        else this.loopOut = p;
        return;
      }
      if (!this.isDragging) return;
      const p = this.posAt(canvas, e);
      if (this.isPlaying) this.startPlayback(p);
      else this.playOffset = p;
    });

    canvas.addEventListener('pointerup', (e) => {
      if (this.longPressTimer) { clearTimeout(this.longPressTimer); this.longPressTimer = null; }
      canvas.releasePointerCapture(e.pointerId);

      if (this.isLoopDragging) {
        this.isLoopDragging = false;
        if (this.loopOut > this.loopIn) {
          this.loopEnabled = true;
          this.updateLoopBtn();
          this.publish?.({ type: 'sv-loop', inPoint: this.loopIn, outPoint: this.loopOut, enabled: true });
        }
        return;
      }

      this.isDragging = false;
      if (!this.isPlaying) this.stopAnimLoop();
      this.publish?.({ type: 'sv-playback', action: this.isPlaying ? 'play' : 'seek', offset: this.playOffset });
    });

    canvas.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.clearLoop();
    });
  }

  // ─── Main pane interaction (seek + segment click) ─────────────────────────────

  private bindMainInteraction(): void {
    const canvas = this.mainCanvas;

    canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      const p = this.posAt(canvas, e);

      if (this.formData?.segments && this.audioBuffer) {
        const ratio = p / this.audioBuffer.duration;
        const seg   = this.formData.segments.find(s => ratio >= s.startRatio && ratio <= s.endRatio);
        if (seg) {
          this.setLoop(seg.startRatio * this.audioBuffer.duration, seg.endRatio * this.audioBuffer.duration);
          return;
        }
      }

      this.isDragging = true;
      this.playOffset = p;
      if (this.isPlaying) this.startPlayback(p);
      this.startAnimLoop();
    });

    canvas.addEventListener('pointermove', (e) => {
      if (!this.isDragging) return;
      const p = this.posAt(canvas, e);
      if (this.isPlaying) this.startPlayback(p);
      else this.playOffset = p;
    });

    canvas.addEventListener('pointerup', (e) => {
      canvas.releasePointerCapture(e.pointerId);
      this.isDragging = false;
      if (!this.isPlaying) this.stopAnimLoop();
      this.publish?.({ type: 'sv-playback', action: this.isPlaying ? 'play' : 'seek', offset: this.playOffset });
    });
  }

  // ─── Playback ─────────────────────────────────────────────────────────────────

  private togglePlayback(): void {
    if (this.isPlaying) {
      this.pausePlayback();
      this.publish?.({ type: 'sv-playback', action: 'pause', offset: this.playOffset });
    } else {
      this.startPlayback();
      this.publish?.({ type: 'sv-playback', action: 'play', offset: this.playOffset });
    }
  }

  private startPlayback(offset = this.playOffset): void {
    this.stopPlayback();
    if (!this.audioBuffer) return;
    if (!this.audioCtx) this.audioCtx = new AudioContext();
    const src = this.audioCtx.createBufferSource();
    src.buffer = this.audioBuffer;
    src.connect(this.audioCtx.destination);
    this.playOffset    = Math.max(0, Math.min(offset, this.audioBuffer.duration - 0.01));
    this.playStartTime = this.audioCtx.currentTime;
    src.start(0, this.playOffset);
    src.onended = () => {
      if (this.isPlaying) {
        this.isPlaying  = false;
        this.playOffset = this.getCurrentPosition();
        this.updatePlayBtn();
      }
    };
    this.playbackNode = src;
    this.isPlaying    = true;
    this.updatePlayBtn();
    this.startAnimLoop();
  }

  private pausePlayback(): void {
    this.playOffset = this.getCurrentPosition();
    if (this.playbackNode) {
      try { this.playbackNode.stop(); } catch {}
      try { this.playbackNode.disconnect(); } catch {}
      this.playbackNode = null;
    }
    this.isPlaying = false;
    this.updatePlayBtn();
    this.stopAnimLoop();
  }

  private stopPlayback(): void { this.pausePlayback(); }

  private getCurrentPosition(): number {
    if (!this.audioBuffer || !this.isPlaying || !this.audioCtx) return this.playOffset;
    return Math.min(this.playOffset + (this.audioCtx.currentTime - this.playStartTime), this.audioBuffer.duration);
  }

  private updatePlayBtn(): void { this.playBtn.textContent = this.isPlaying ? '⏸' : '▶'; }

  // ─── Loop ─────────────────────────────────────────────────────────────────────

  private toggleLoop(): void {
    if (this.loopEnabled) {
      this.clearLoop();
    } else if (this.loopOut > this.loopIn) {
      this.loopEnabled = true;
      this.updateLoopBtn();
    }
  }

  private setLoop(inPoint: number, outPoint: number): void {
    this.loopIn      = inPoint;
    this.loopOut     = outPoint;
    this.loopEnabled = true;
    this.updateLoopBtn();
    this.publish?.({ type: 'sv-loop', inPoint, outPoint, enabled: true });
  }

  private clearLoop(): void {
    this.loopEnabled = false;
    this.updateLoopBtn();
    this.publish?.({ type: 'sv-loop', inPoint: 0, outPoint: 0, enabled: false });
  }

  private updateLoopBtn(): void {
    this.loopBtn.dataset.active = this.loopEnabled ? 'true' : 'false';
  }

  public applyRemoteLoop(inPoint: number, outPoint: number, enabled: boolean): void {
    this.loopIn      = inPoint;
    this.loopOut     = outPoint;
    this.loopEnabled = enabled;
    this.updateLoopBtn();
  }

  // ─── Animation loop ──────────────────────────────────────────────────────────

  private startAnimLoop(): void {
    if (this.rafId !== null) return;
    const tick = () => {
      if (this.isPlaying && this.loopEnabled && this.loopOut > this.loopIn) {
        if (this.getCurrentPosition() >= this.loopOut) this.startPlayback(this.loopIn);
      }
      this.redrawWavePane();
      this.redrawMainPane();
      this.rafId = (this.isPlaying || this.isDragging || this.isLoopDragging)
        ? requestAnimationFrame(tick)
        : null;
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private stopAnimLoop(): void {
    if (this.rafId !== null) { cancelAnimationFrame(this.rafId); this.rafId = null; }
  }

  // ─── Resize ──────────────────────────────────────────────────────────────────

  private bindResize(): void {
    const ro = new ResizeObserver(() => {
      if (!this.audioBuffer) return;
      this.resizeCanvases();
      this.runWorker();
    });
    ro.observe(this.podEl);
  }

  // ─── Remote ──────────────────────────────────────────────────────────────────

  public applyRemotePlayback(action: 'play' | 'pause' | 'seek', offset: number): void {
    if (action === 'pause') this.pausePlayback();
    else this.startPlayback(offset);
  }

  // ─── Misc ─────────────────────────────────────────────────────────────────────

  private setStatus(msg: string): void { if (this.statusEl) this.statusEl.textContent = msg; }

  public dispose(): void {
    this.stopPlayback();
    this.stopAnimLoop();
    window.removeEventListener('sa:frame',      this.onFrame);
    window.removeEventListener('sa:file-ready', this.onFileReady);
    window.removeEventListener('sa:active',     this.onSAActive);
    this.worker?.terminate();
    if (this.audioCtx) { try { this.audioCtx.close(); } catch {} this.audioCtx = null; }
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | grep -i error | head -20
```

Expected: no errors referencing `sonic-visualizer/controller.ts`.

- [ ] **Step 3: Visual check — file loaded in SV**

Drop an audio file into SA pod. Expected:
- SV status bar updates to `filename · key · BPM`
- Wave pane (top 48px) draws waveform peaks
- Main pane draws spectrogram once worker finishes (may take 1–3s for large files)
- ENR curve (green) overlays the spectrogram
- SEG color frames visible beneath the spectrogram
- Segment labels `#0`, `#1` etc. at top of each segment

- [ ] **Step 4: Visual check — playback and loop**

1. Click ▶ in toolbar → playhead moves in both panes, audio plays
2. Shift+drag on wave pane → loop region highlights; loop button turns green
3. ▶ plays within the loop region and wraps back
4. Click ⟳ → loop cleared, loop button dims
5. Click inside a segment in main pane → loop snaps to segment bounds

- [ ] **Step 5: Commit**

```bash
git add src/scripts/room/sonic-visualizer/controller.ts
git commit -m "feat(sv): complete rewrite — layer system, worker, loop/seek/playback"
```

---

## Task 8: session/messages.ts — add `sv-layer` and `sv-loop` types

**Files:**
- Modify: `src/scripts/room/session/messages.ts`

- [ ] **Step 1: Extend the `ConferenceMessage` union**

After the `sv-vtab` variant (the block ending at line ~233), insert:
```typescript
  | {
      type: 'sv-layer';
      layer: string;
      visible: boolean;
    }
  | {
      type: 'sv-loop';
      inPoint: number;
      outPoint: number;
      enabled: boolean;
    }
```

- [ ] **Step 2: Add parsers in `parseConferenceMessage`**

After the `sv-vtab` parser block (ending at line ~703), insert:
```typescript
    if (parsed.type === 'sv-layer') {
      return {
        type:    'sv-layer',
        layer:   normalizeText((parsed as { layer?: string }).layer) || '',
        visible: Boolean((parsed as { visible?: boolean }).visible),
      };
    }

    if (parsed.type === 'sv-loop') {
      return {
        type:     'sv-loop',
        inPoint:  Math.max(0, Number((parsed as { inPoint?: number }).inPoint)  || 0),
        outPoint: Math.max(0, Number((parsed as { outPoint?: number }).outPoint) || 0),
        enabled:  Boolean((parsed as { enabled?: boolean }).enabled),
      };
    }
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | grep -i error | head -20
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/scripts/room/session/messages.ts
git commit -m "feat(sv): add sv-layer and sv-loop to ConferenceMessage union"
```

---

## Task 9: livekit-room.ts — handle `sv-layer`, `sv-loop`; gracefully ignore `sv-vtab`

**Files:**
- Modify: `src/scripts/livekit-room.ts`

- [ ] **Step 1: Replace the `sv-vtab` handler block**

Find (around line 12438):
```typescript
      if (message.type === 'sv-vtab') {
        sonicVisualizerController?.applyRemoteVTab(message.tab);
        return;
      }
```

Replace with:
```typescript
      if (message.type === 'sv-vtab') {
        // removed in layer system redesign — ignore gracefully
        return;
      }

      if (message.type === 'sv-layer') {
        sonicVisualizerController?.applyRemoteLayer(message.layer, message.visible);
        return;
      }

      if (message.type === 'sv-loop') {
        sonicVisualizerController?.applyRemoteLoop(message.inPoint, message.outPoint, message.enabled);
        return;
      }
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | grep -i error | head -20
```

Expected: no errors (the new `sv-layer` / `sv-loop` message shapes satisfy the types added in Task 8; `applyRemoteLayer` and `applyRemoteLoop` are defined on the new controller from Task 7).

- [ ] **Step 3: Commit**

```bash
git add src/scripts/livekit-room.ts
git commit -m "feat(sv): add remote sv-layer/sv-loop handlers; gracefully ignore sv-vtab"
```

---

## Task 10: SetupModal — replace `<select>` with segmented control

**Files:**
- Modify: `src/components/room/panels/setup/SetupModal.astro`

- [ ] **Step 1: Replace the select element**

Find (around line 155):
```html
                <select id="modal-grid-size" data-grid-size-input>
                  <option value="normal">Normal (Automático)</option>
                  <option value="compact">Compacto (2 por fila)</option>
                  <option value="avatar">Avatar (120x90)</option>
                  <option value="small">Pequeño (160x120)</option>
                  <option value="usable">Usable (200x150)</option>
                  <option value="comfortable">Cómodo (240x180)</option>
                  <option value="speaker">Speaker (320x240)</option>
                </select>
```

Replace with:
```html
                <div class="conference-segmented" id="modal-grid-size" data-grid-size-input data-value="normal">
                  <button type="button" class="conference-seg-btn" data-value="normal"      data-active="true" >Normal</button>
                  <button type="button" class="conference-seg-btn" data-value="compact"     data-active="false">Compact</button>
                  <button type="button" class="conference-seg-btn" data-value="avatar"      data-active="false">Avatar</button>
                  <button type="button" class="conference-seg-btn" data-value="small"       data-active="false">Small</button>
                  <button type="button" class="conference-seg-btn" data-value="usable"      data-active="false">Usable</button>
                  <button type="button" class="conference-seg-btn" data-value="comfortable" data-active="false">Comfy</button>
                  <button type="button" class="conference-seg-btn" data-value="speaker"     data-active="false">Speaker</button>
                </div>
```

- [ ] **Step 2: Commit**

```bash
git add src/components/room/panels/setup/SetupModal.astro
git commit -m "feat(grid): replace grid-size select with segmented control HTML"
```

---

## Task 11: room-sidebar.css — segmented control styles

**Files:**
- Modify: `src/components/room/panels/room-sidebar.css`

- [ ] **Step 1: Append segmented control styles at end of file**

```css
/* Grid-size segmented control */
.conference-segmented {
  display: flex; flex-wrap: wrap; gap: 2px;
}
.conference-seg-btn {
  background: none;
  border: 1px solid rgba(255,255,255,0.15);
  color: var(--conference-fg, #cdd6f4);
  font-family: var(--font-family-mono, monospace);
  font-size: 0.52rem; padding: 1px 5px; height: 1.3rem;
  text-transform: uppercase; letter-spacing: 0.07em;
  cursor: pointer; border-radius: 2px; flex-shrink: 0;
}
.conference-seg-btn:hover { background: rgba(255,255,255,0.06); }
.conference-seg-btn[data-active="true"] {
  color: #45D384; border-color: rgba(69,211,132,0.4);
}
```

- [ ] **Step 2: Visual check**

Open SetupModal (as teacher). Expected:
- "Tamaño de GRID" field shows 7 compact buttons in a wrapping flex row
- "Normal" is green-accented (active); others are dim

- [ ] **Step 3: Commit**

```bash
git add src/components/room/panels/room-sidebar.css
git commit -m "feat(grid): segmented control CSS"
```

---

## Task 12: livekit-room.ts — update `applyGridSize` and event listeners for segmented div

**Files:**
- Modify: `src/scripts/livekit-room.ts`

- [ ] **Step 1: Update `getGridSizeInputs` return type**

Replace (around line 4077):
```typescript
  const getGridSizeInputs = () =>
    Array.from(
      root.querySelectorAll<HTMLSelectElement>('[data-grid-size-input], [data-grid-size-workspace-input]'),
    ).filter((input) => !input.closest('#musiki-pod-templates'));
```
With:
```typescript
  const getGridSizeInputs = () =>
    Array.from(
      root.querySelectorAll<HTMLElement>('[data-grid-size-input], [data-grid-size-workspace-input]'),
    ).filter((el) => !el.closest('#musiki-pod-templates'));
```

- [ ] **Step 2: Update `applyGridSize` to write value to both select and div**

Replace the `getGridSizeInputs().forEach` block inside `applyGridSize` (around lines 4092–4094):
```typescript
    getGridSizeInputs().forEach((input) => {
      input.value = gridSize || 'normal';
    });
```
With:
```typescript
    getGridSizeInputs().forEach((el) => {
      if (el.tagName === 'SELECT') {
        (el as HTMLSelectElement).value = gridSize || 'normal';
      } else {
        el.dataset.value = gridSize || 'normal';
        el.querySelectorAll<HTMLElement>('[data-value]').forEach(btn => {
          btn.dataset.active = btn.dataset.value === (gridSize || 'normal') ? 'true' : 'false';
        });
      }
    });
```

- [ ] **Step 3: Replace the event-listener block (around line 13243)**

Replace:
```typescript
  getGridSizeInputs().forEach((input) => {
    input.value = gridSize || 'normal';
    input.addEventListener('change', () => {
      applyGridSize(input.value as any);
      persistSetupState();
      void publishWorkspaceLayoutState().catch(() => undefined);
    });
  });
```
With:
```typescript
  getGridSizeInputs().forEach((el) => {
    if (el.tagName === 'SELECT') {
      (el as HTMLSelectElement).value = gridSize || 'normal';
      el.addEventListener('change', () => {
        applyGridSize((el as HTMLSelectElement).value as any);
        persistSetupState();
        void publishWorkspaceLayoutState().catch(() => undefined);
      });
    } else {
      el.dataset.value = gridSize || 'normal';
      el.querySelectorAll<HTMLElement>('[data-value]').forEach(btn => {
        btn.dataset.active = btn.dataset.value === (gridSize || 'normal') ? 'true' : 'false';
      });
      el.addEventListener('click', (e) => {
        const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-value]');
        if (!btn) return;
        applyGridSize(btn.dataset.value as any);
        persistSetupState();
        void publishWorkspaceLayoutState().catch(() => undefined);
      });
    }
  });
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | grep -i error | head -20
```

Expected: no errors.

- [ ] **Step 5: E2E test**

1. Open SetupModal → click "Compact" → close modal → conference grid switches to compact layout
2. Open SetupModal again → "Compact" button is green-accented
3. Reload page → grid size is restored from persisted state → correct button is active

- [ ] **Step 6: Commit**

```bash
git add src/scripts/livekit-room.ts
git commit -m "feat(grid): update applyGridSize and event listeners for segmented control"
```

---

## Self-Review Notes

**Spec coverage:**
- SA radar as 5th panel ✓ (Tasks 1–3)
- SV 2-pane layout ✓ (Tasks 4–5)
- 8 toggleable layers + drawing order ✓ (Task 7: `redrawMainPane`)
- Segment color formula ✓ (Task 7: `drawSegments`)
- Worker with FFT + 5 curves + segment detection ✓ (Task 6)
- Loop by shift-drag on wave pane ✓ (Task 7: `bindWaveInteraction`)
- Loop by segment click ✓ (Task 7: `bindMainInteraction`)
- Touch long-press loop ✓ (Task 7: `bindWaveInteraction`)
- Loop button clears loop ✓ (Task 7: `toggleLoop` / `clearLoop`)
- Escape key clears loop ✓ (Task 7: keydown handler)
- Looped playback enforcement per frame ✓ (Task 7: `startAnimLoop` tick)
- Seek on both panes ✓ (Tasks 7: both `bindWaveInteraction` and `bindMainInteraction`)
- Accurate pause (stores `getCurrentPosition()`) ✓ (Task 7: `pausePlayback`)
- Natural end stops at final position, does not reset to 0 ✓ (Task 7: `src.onended`)
- WebRTC: sv-layer + sv-loop publish ✓ (Task 7); parse + dispatch ✓ (Tasks 8–9)
- sv-vtab gracefully ignored ✓ (Task 9)
- Remove radar from SV HTML ✓ (Task 4); controller no longer imports/calls `drawRadar` ✓ (Task 7)
- Grid size segmented control ✓ (Tasks 10–12)
