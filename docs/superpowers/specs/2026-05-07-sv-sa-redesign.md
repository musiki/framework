# SV / SA Redesign — Sonic Visualiser Layer System

**Date:** 2026-05-07  
**Status:** Approved

---

## Scope

Four coordinated changes:

1. **SA pod** — add radar as 5th panel, adjust grid layout
2. **SV pod** — full redesign as horizontal timeline viewer with Sonic Visualiser-style layer system
3. **SV waveform** — loop in/out by drag and segment click, accurate seek, looped playback
4. **GRID SIZE** — segmented horizontal control replacing the `<select>` in SetupModal

---

## 1. SA Pod — Radar Integration

### Goal
Move the radar canvas from SV into SA so that SV becomes a pure timeline visualizer.

### HTML (`SonicAnalyzerPanel.astro`)
Add a fifth panel `sa-panel--radar` with `<canvas data-sa-radar>` inside `sa-content`.

### CSS (`sonic-analyzer.css`)

**Narrow layout** (default, 2-col × 4-row):
```
grid-template-columns: 2fr 1fr;
grid-template-rows: minmax(0, 1.5fr) repeat(3, 1fr);
```
- `sa-panel--text`: col 1, rows 1–4
- `sa-panel--radar`: col 2, row 1 (gets extra height, roughly square)
- `sa-panel--spectrum`: col 2, row 2
- `sa-panel--timbre`: col 2, row 3
- `sa-panel--lufs`: col 2, row 4

**Wide layout** (≥640px, 5 equal columns, 1 row):
```
grid-template-columns: repeat(5, 1fr);
grid-template-rows: 1fr;
```
- All panels `grid-column: auto; grid-row: auto`

### Controller (`sonic-analyzer/controller.ts`)
- Add `private radarCanvas: HTMLCanvasElement` DOM binding (`[data-sa-radar]`)
- Import `drawRadar` from `./views/radar-view`
- Call `drawRadar(this.radarCanvas, r)` inside `render(r)` on every tick
- No changes to radar-view.ts itself

### SV Controller (`sonic-visualizer/controller.ts`)
- Remove `radarCanvas`, `data-sv-radar` DOM binding, `drawRadar` import and call
- Remove `sv-radar-wrap` HTML from `SonicVisualizerPanel.astro`

---

## 2. SV Pod — Layer System

### Architecture

Two fixed panes stacked vertically:

```
sv-pod
  sv-toolbar
    [sV label] [status] [layer toggles] [▶/⏸] [loop btn]
  sv-panes  (flex column, flex:1)
    sv-pane--wave  (fixed ~48px)   ← waveform + loop region + playhead
    sv-pane--main  (flex:1)        ← spectrogram + curves + segments + playhead
```

### Worker

File: `public/scripts/waveform-analyzer.worker.js`  
Content: the worker code as provided (FFT, 5 feature curves, segment detection).

**Invocation**: triggered on `sa:file-ready`. Channel data is copied (not transferred) so the AudioBuffer stays intact for playback.

```ts
const copy = new Float32Array(buffer.getChannelData(0));
worker.postMessage({ channelData: copy, width, height, sampleRate, duration }, [copy.buffer]);
```

Worker returns `{ pixelData, width, height, requestId, formData }` where `formData` contains:
- `energy`, `brightness`, `motion`, `gravity`, `tension` — normalized series (96–200 points each)
- `segments` — auto-detected regions with `startRatio`, `endRatio`, `energy`, `brightness`, `motion`, `gravity`, `tension`

The `pixelData` (spectrogram ImageData) is drawn once to an offscreen canvas and cached.

### Layers

Eight toggleable layers, shown as compact buttons in the toolbar:

| Key  | Label | Default | Description |
|------|-------|---------|-------------|
| spec | SPEC  | on      | Spectrogram (worker pixelData) |
| wav  | WAV   | on      | Waveform peak overlay on main pane |
| enr  | ENR   | on      | Energy envelope curve |
| brt  | BRT   | off     | Brightness (centroid) curve |
| mot  | MOT   | off     | Motion (flux) curve |
| grv  | GRV   | off     | Gravity (low-freq) curve |
| ten  | TEN   | off     | Tension composite curve |
| seg  | SEG   | on      | Segment color frames |

Each curve layer draws its normalized series as a colored envelope over the full pane width.

Curve tint colors:
- ENR: `rgba(69, 211, 132, 0.7)` (green)
- BRT: `rgba(255, 217, 102, 0.7)` (amber)
- MOT: `rgba(118, 211, 255, 0.7)` (cyan)
- GRV: `rgba(180, 120, 255, 0.7)` (purple)
- TEN: `rgba(255, 100, 100, 0.7)` (red)

### Segment Color Formula (SEG layer)

Each segment is drawn as a filled rectangle spanning its time range, full pane height, beneath all other layers.

```
normalizedHNR  = segment.energy   // proxy; actual HNR not in formData — see note
hue            = 220 − segment.energy × 190       // warm (tonal) → cool (noisy)
lightness      = 35% + segment.brightness × 30%   // Newton centroid axis
saturation     = 70%
alpha          = 0.12 + segment.tension × 0.28

fill = hsla(hue, 70%, lightness, alpha)
```

> **Note on HNR**: the worker `formData.segments` does not carry HNR directly — it carries `energy`, `brightness`, `motion`, `gravity`, `tension`. Until SA exposes per-segment HNR, `energy` is used as the warm/cool proxy. This can be upgraded later when SA emits HNR in `sa:file-ready`.

A small monospace label (segment index, e.g. `#0`, `#1`) is drawn at the top-left corner of each rect at `font-size: 9px`, opacity 0.45.

Clicking inside a segment region sets the loop in/out to that segment's `startTime`/`endTime`.

### Drawing Order (main pane, per frame)

1. Clear canvas
2. SEG frames (colored rects, if layer active)
3. SPEC (spectrogram ImageData blit, if layer active)
4. WAV overlay (waveform peaks, semi-transparent, if layer active)
5. Active curve layers (ENR/BRT/MOT/GRV/TEN), each as a path
6. Loop region overlay (translucent white fill between loopIn/loopOut)
7. Playhead (sharp white vertical line)

### WebRTC Sync

New message types published via `this.publish()`:

```ts
// Layer visibility toggle
{ type: 'sv-layer', layer: 'enr', visible: true }

// Loop region update
{ type: 'sv-loop', inPoint: 12.5, outPoint: 28.3, enabled: true }
```

Existing `sv-playback` messages remain unchanged. The old `sv-vtab` message type (MEL/CHR/PCH tabs) is **removed** — those views are replaced by the layer system. Remote peers receiving a `sv-vtab` message should ignore it gracefully.

`applyRemoteLayer(layer, visible)` and `applyRemoteLoop(inPoint, outPoint, enabled)` methods handle incoming remote state.

---

## 3. SV Waveform — Loop, Seek & Playback

### Seek
- Click or drag on **either pane** seeks to that time position (no modifier needed)
- While playing: `startPlayback(seekTime)` immediately
- While paused: updates `playOffset`, redraws — does **not** auto-start playback

### Loop in/out — two input methods

**Method A — Shift+drag on wave pane:**
- Shift+pointerdown: sets `loopIn` to cursor position, enables drag mode
- Pointermove: extends `loopOut` (or contracts if dragging leftward — min always < max)
- Pointerup: confirms region, enables loop mode, publishes `sv-loop`

**Method B — Segment click:**
- Clicking anywhere within a segment rect (either pane) sets `loopIn = segment.startTime`, `loopOut = segment.endTime`, enables loop mode
- Publishes `sv-loop`

**Clearing loop:** clicking the loop button again (or Escape key) clears the region and disables loop mode.

> **Touch note**: on touch devices there is no shift key. Touch loop selection uses a long-press (~400ms) on the wave pane to enter loop-draw mode, then drag extends the region. Tapping outside any segment clears the loop.

### Looped Playback
On every animation frame tick:
```ts
if (this.loopEnabled && this.loopOut > this.loopIn) {
  const pos = this.getCurrentPosition();
  if (pos >= this.loopOut) this.startPlayback(this.loopIn);
}
```

### Playback Accuracy Fixes
- Pause stores exact `getCurrentPosition()` — resume from that position
- Natural end (no loop): pause at final position, do not reset to 0
- Play button state updates on: start, pause, seek, end

---

## 4. GRID SIZE Segmented Control

### HTML (`SetupModal.astro`)

Replace:
```html
<select id="modal-grid-size" data-grid-size-input>
  <option value="normal">Normal (Automático)</option>
  ...
</select>
```

With:
```html
<div class="conference-segmented" id="modal-grid-size" data-grid-size-input data-value="normal">
  <button type="button" class="conference-seg-btn" data-value="normal"    data-active="true">Normal</button>
  <button type="button" class="conference-seg-btn" data-value="compact"                    >Compact</button>
  <button type="button" class="conference-seg-btn" data-value="avatar"                     >Avatar</button>
  <button type="button" class="conference-seg-btn" data-value="small"                      >Small</button>
  <button type="button" class="conference-seg-btn" data-value="usable"                     >Usable</button>
  <button type="button" class="conference-seg-btn" data-value="comfortable"                >Comfy</button>
  <button type="button" class="conference-seg-btn" data-value="speaker"                    >Speaker</button>
</div>
```

### CSS (`room-sidebar.css` or SetupModal scoped)
```css
.conference-segmented {
  display: flex; flex-wrap: wrap; gap: 2px;
}
.conference-seg-btn {
  /* inherits musiki-pod-btn base */
  font-size: 0.52rem; padding: 1px 5px; height: 1.3rem;
  text-transform: uppercase; letter-spacing: 0.07em;
}
.conference-seg-btn[data-active="true"] {
  color: #45D384; border-color: rgba(69,211,132,0.4);
}
```

### JS (`livekit-room.ts`)

Update `applyGridSize` to work with the new element type:

```ts
// Read value:
const getValue = (el: HTMLElement) =>
  el.dataset.value ?? (el as HTMLSelectElement).value ?? 'normal';

// Set value:
const setValue = (el: HTMLElement, size: string) => {
  if (el.tagName === 'SELECT') {
    (el as HTMLSelectElement).value = size;
  } else {
    el.dataset.value = size;
    el.querySelectorAll<HTMLElement>('[data-value]').forEach(btn => {
      btn.dataset.active = btn.dataset.value === size ? 'true' : 'false';
    });
  }
};
```

Delegated click listener on the segmented div fires `applyGridSize` directly. The `data-grid-size-input` and `data-grid-size-workspace-input` selectors are unchanged.

---

## Files Changed

| File | Change |
|------|--------|
| `src/components/room/panels/sonic-analyzer/SonicAnalyzerPanel.astro` | Add `sa-panel--radar` |
| `src/components/room/panels/sonic-analyzer/sonic-analyzer.css` | New grid layout (4-row narrow, 5-col wide) |
| `src/scripts/room/sonic-analyzer/controller.ts` | Bind radar canvas, call drawRadar |
| `src/components/room/panels/sonic-visualizer/SonicVisualizerPanel.astro` | Full redesign (2 panes, layer buttons) |
| `src/components/room/panels/sonic-visualizer/sonic-visualizer.css` | New pane/layer styles |
| `src/scripts/room/sonic-visualizer/controller.ts` | Worker integration, layer system, loop/seek |
| `src/components/room/panels/setup/SetupModal.astro` | Segmented grid size control |
| `src/scripts/livekit-room.ts` | Update grid size read/write/listen |
| `public/scripts/waveform-analyzer.worker.js` | New — worker code |
