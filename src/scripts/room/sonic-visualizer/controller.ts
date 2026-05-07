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
    off.getContext('2d')!.putImageData(new ImageData(data.pixelData as unknown as Uint8ClampedArray<ArrayBuffer>, data.width, data.height), 0, 0);
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
