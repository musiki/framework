import type { SAResults } from '../sonic-analyzer/views/text-view';
import type { SAFilePayload } from '../sonic-analyzer/controller';
import type { ConferenceMessage } from '../session';

export type SVOptions = { container: HTMLElement; publish?: (msg: ConferenceMessage) => void };

const ACCEPTED_TYPES = [
  'audio/wav',
  'audio/ogg',
  'audio/mpeg',
  'audio/mp3',
  'audio/wave',
  'audio/x-wav',
  'audio/mp4',
  'audio/aac',
  'audio/flac',
  'video/quicktime',
  'video/mp4',
  'video/webm',
];
const ACCEPTED_EXTS = ['.wav', '.ogg', '.mp3', '.m4a', '.aac', '.flac', '.mov', '.mp4', '.mpv', '.webm'];

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
  private outputGainNode: GainNode | null = null;
  private outputLimiterNode: DynamicsCompressorNode | null = null;
  private isPlaying = false;
  private playOffset = 0;
  private playStartTime = 0;
  private rafId: number | null = null;
  private transportHeartbeatId: ReturnType<typeof setInterval> | null = null;
  private transportHeartbeatPublishesRoom = false;

  // Loop
  private loopEnabled = false;
  private loopIn = 0;
  private loopOut = 0;
  private lastLoopRestartAt = -Infinity;

  // Horizontal viewport
  private zoomX = 1;
  private viewStart = 0;
  private readonly minZoomX = 1;
  private readonly maxZoomX = 256;

  // Ruler
  private rulerEl!: HTMLElement;
  private rulerTicksEl!: HTMLElement;
  private rulerPlayheadEl!: HTMLElement;
  private inMarkerEl!: HTMLElement;
  private outMarkerEl!: HTMLElement;
  private zoomReadoutEl!: HTMLElement;
  private zoomInBtn!: HTMLButtonElement;
  private zoomOutBtn!: HTMLButtonElement;
  private zoomResetBtn!: HTMLButtonElement;

  // Interaction state
  private isDragging = false;
  private isLoopDragging = false;
  private pinchStartDistance = 0;
  private pinchStartZoom = 1;
  private pinchCenterRatio = 0.5;
  private activePointers = new Map<number, PointerEvent>();
  private longPressTimer: ReturnType<typeof setTimeout> | null = null;
  private dragStartX = 0;
  private dragStartAudioPos = 0;
  private seekTarget: number | null = null;

  // Access control
  private localRole: 'teacher' | 'student' = 'student';
  private allowStudents = false;

  // Cleanup
  private domAbort = new AbortController();
  private resizeObserver: ResizeObserver | null = null;
  private refreshLayoutTimers: number[] = [];

  // Bound handlers (for window events cleanup)
  private onFrame: (e: Event) => void;
  private onFileReady: (e: Event) => void;
  private onTargetedFileReady: (e: Event) => void;
  private panelId = '';

  constructor(options: SVOptions) {
    this.container = options.container;
    this.publish   = options.publish;
    this.panelId = this.resolvePanelId();
    this.bindDOM();
    this.bindDropzone();
    this.bindResize();

    this.onFrame     = (e) => this.handleFrame((e as CustomEvent<{ results: SAResults }>).detail);
    this.onFileReady = (e) => this.handleFileReady((e as CustomEvent<SAFilePayload>).detail);
    this.onTargetedFileReady = (e) => {
      const detail = (e as CustomEvent<SAFilePayload & { targetPanelId?: string }>).detail;
      const targetPanelId = String(detail?.targetPanelId || '').trim();
      if (targetPanelId && targetPanelId !== this.panelId) return;
      this.handleFileReady(detail);
    };

    window.addEventListener('sa:frame',      this.onFrame);
    window.addEventListener('sa:file-ready', this.onFileReady);
    window.addEventListener('musiki:sv:load-decoded', this.onTargetedFileReady);
    window.dispatchEvent(new CustomEvent('sv:request-state'));
  }

  private resolvePanelId(): string {
    return this.container.dataset.panelId
      || this.container.closest<HTMLElement>('.pod-diy-shell')?.dataset.panelId
      || '';
  }

  private bindDropzone(): void {
    const pod = this.podEl;
    const sig = this.domAbort.signal;
    pod.addEventListener('dragover', (e) => {
      if (!this.hasDraggingAudio(e)) return;
      e.preventDefault();
      e.dataTransfer!.dropEffect = 'copy';
      pod.classList.add('sv-pod--drag-over');
    }, { signal: sig });
    pod.addEventListener('dragleave', (e) => {
      if (!pod.contains(e.relatedTarget as Node)) pod.classList.remove('sv-pod--drag-over');
    }, { signal: sig });
    pod.addEventListener('drop', (e) => {
      e.preventDefault();
      pod.classList.remove('sv-pod--drag-over');
      const file = this.extractAudioFile(e.dataTransfer);
      if (!file) return;
      window.dispatchEvent(new CustomEvent('musiki:sonic:load-file', { detail: { file, targetPanelId: this.panelId } }));
    }, { signal: sig });
  }

  private hasDraggingAudio(e: DragEvent): boolean {
    if (!e.dataTransfer) return false;
    for (const item of Array.from(e.dataTransfer.items)) {
      if (item.kind === 'file' && (ACCEPTED_TYPES.includes(item.type) || item.type === '')) return true;
    }
    return false;
  }

  private extractAudioFile(dt: DataTransfer | null): File | null {
    if (!dt) return null;
    for (const file of Array.from(dt.files)) {
      const ext = '.' + file.name.split('.').pop()!.toLowerCase();
      if (ACCEPTED_TYPES.includes(file.type) || ACCEPTED_EXTS.includes(ext)) return file;
    }
    return null;
  }

  private bindDOM(): void {
    const sig = this.domAbort.signal;
    const q = <T extends HTMLElement>(sel: string) => this.container.querySelector<T>(sel)!;
    this.podEl      = q('.sv-pod');
    this.statusEl   = q('[data-sv-status]');
    this.mainCanvas = q<HTMLCanvasElement>('[data-sv-main-canvas]');
    this.playBtn         = q<HTMLButtonElement>('[data-sv-play]');
    this.loopBtn         = q<HTMLButtonElement>('[data-sv-loop]');
    this.rulerEl         = q<HTMLElement>('[data-sv-ruler]')!;
    this.rulerTicksEl    = q<HTMLElement>('[data-sv-ruler-ticks]')!;
    this.rulerPlayheadEl = q<HTMLElement>('[data-sv-ruler-playhead]')!;
    this.inMarkerEl      = q<HTMLElement>('[data-sv-in-marker]')!;
    this.outMarkerEl     = q<HTMLElement>('[data-sv-out-marker]')!;
    this.zoomReadoutEl   = q<HTMLElement>('[data-sv-zoom-readout]')!;
    this.zoomInBtn       = q<HTMLButtonElement>('[data-sv-zoom-in]');
    this.zoomOutBtn      = q<HTMLButtonElement>('[data-sv-zoom-out]');
    this.zoomResetBtn    = q<HTMLButtonElement>('[data-sv-zoom-reset]');

    this.container.querySelectorAll<HTMLButtonElement>('[data-sv-layer]').forEach(btn => {
      this.layerBtns.set(btn.dataset.svLayer!, btn);
      btn.addEventListener('click', () => this.toggleLayer(btn.dataset.svLayer!), { signal: sig });
    });

    this.playBtn.addEventListener('click', () => this.togglePlayback(), { signal: sig });
    this.loopBtn.addEventListener('click', () => this.toggleLoop(), { signal: sig });
    this.zoomInBtn.addEventListener('click', () => this.zoomAroundRatio(this.zoomX * 1.45, 0.5, true), { signal: sig });
    this.zoomOutBtn.addEventListener('click', () => this.zoomAroundRatio(this.zoomX / 1.45, 0.5, true), { signal: sig });
    this.zoomResetBtn.addEventListener('click', () => this.resetZoom(true), { signal: sig });
    this.bindMainInteraction();
    this.bindRulerInteraction();
  }

  // ─── Access control ──────────────────────────────────────────────────────────

  public setRole(role: 'teacher' | 'student'): void { this.localRole = role; }
  public setAllowStudents(allow: boolean): void { this.allowStudents = allow; }
  private canControl(): boolean { return this.localRole === 'teacher' || this.allowStudents; }

  // ─── SA events ───────────────────────────────────────────────────────────────

  private handleFrame(_detail: { results: SAResults }): void {
    // Radar is rendered by SA controller; SV ignores realtime frames
  }

  private handleFileReady(payload: SAFilePayload): void {
    this.audioBuffer   = payload.buffer;
    this.waveformPeaks = payload.peaks;
    this.resetZoom(false);
    const bpm = payload.bpm > 0 ? ` · ${payload.bpm.toFixed(0)}bpm` : '';
    const key = payload.key ? ` · ${payload.key} ${payload.scale}` : '';
    this.setStatus(`${payload.fileName}${key}${bpm}`);
    this.refreshLayout();
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
    if (data.requestId !== this.workerRequestId) return;
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
    if (this.rafId === null) {
      requestAnimationFrame(() => this.redrawMainPane());
    }
  }

  private toggleLayer(key: string): void {
    const next = !this.layers[key];
    this.applyLayer(key, next);
    if (this.canControl()) this.publish?.({ type: 'sv-layer', layer: key, visible: next });
  }

  public applyRemoteLayer(layer: string, visible: boolean): void {
    this.applyLayer(layer, visible);
  }

  // ─── Horizontal zoom / viewport ──────────────────────────────────────────────

  private clampZoom(value: number): number {
    return Math.min(this.maxZoomX, Math.max(this.minZoomX, Number.isFinite(value) ? value : 1));
  }

  private visibleDuration(): number {
    if (!this.audioBuffer) return 0;
    return this.audioBuffer.duration / this.zoomX;
  }

  private clampViewStart(value = this.viewStart): number {
    if (!this.audioBuffer) return 0;
    const maxStart = Math.max(0, this.audioBuffer.duration - this.visibleDuration());
    return Math.min(maxStart, Math.max(0, Number.isFinite(value) ? value : 0));
  }

  private visibleEnd(): number {
    if (!this.audioBuffer) return 0;
    return Math.min(this.audioBuffer.duration, this.viewStart + this.visibleDuration());
  }

  private timeToRatio(time: number): number {
    const visible = this.visibleDuration();
    if (!visible) return 0;
    return (time - this.viewStart) / visible;
  }

  private timeToX(time: number, width: number): number {
    return this.timeToRatio(time) * width;
  }

  private xToTime(clientX: number, el: HTMLElement): number {
    if (!this.audioBuffer) return 0;
    const r = el.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - r.left) / Math.max(1, r.width)));
    return Math.max(0, Math.min(this.audioBuffer.duration, this.viewStart + ratio * this.visibleDuration()));
  }

  private zoomAroundRatio(nextZoomRaw: number, anchorRatio: number, publish = false): void {
    if (!this.audioBuffer) return;
    const anchorTime = this.viewStart + Math.max(0, Math.min(1, anchorRatio)) * this.visibleDuration();
    this.zoomX = this.clampZoom(nextZoomRaw);
    this.viewStart = this.clampViewStart(anchorTime - anchorRatio * this.visibleDuration());
    this.updateZoomUI();
    this.updateRulerTicks();
    this.updateRulerMarkers();
    requestAnimationFrame(() => this.redrawMainPane());
    if (publish && this.canControl()) this.publishZoomState();
  }

  private panViewport(deltaRatio: number, publish = false): void {
    if (!this.audioBuffer || this.zoomX <= 1) return;
    this.viewStart = this.clampViewStart(this.viewStart + deltaRatio * this.visibleDuration());
    this.updateRulerTicks();
    this.updateRulerMarkers();
    requestAnimationFrame(() => this.redrawMainPane());
    if (publish && this.canControl()) this.publishZoomState();
  }

  private resetZoom(publish = false): void {
    this.zoomX = 1;
    this.viewStart = 0;
    this.updateZoomUI();
    this.updateRulerTicks();
    this.updateRulerMarkers();
    requestAnimationFrame(() => this.redrawMainPane());
    if (publish && this.canControl()) this.publishZoomState();
  }

  private updateZoomUI(): void {
    if (this.zoomReadoutEl) this.zoomReadoutEl.textContent = `${this.zoomX.toFixed(this.zoomX < 10 ? 2 : 1)}×`;
    if (this.zoomOutBtn) this.zoomOutBtn.disabled = this.zoomX <= this.minZoomX + 0.001;
    if (this.zoomResetBtn) this.zoomResetBtn.disabled = this.zoomX <= this.minZoomX + 0.001 && this.viewStart <= 0.001;
  }

  private publishZoomState(): void {
    this.publish?.({ type: 'sv-zoom', zoomX: this.zoomX, viewStart: this.viewStart });
  }

  private ensureTimeVisible(time: number): void {
    if (!this.audioBuffer || this.zoomX <= 1) return;
    if (time >= this.viewStart && time <= this.visibleEnd()) return;
    this.viewStart = this.clampViewStart(time - this.visibleDuration() * 0.5);
    this.updateRulerTicks();
    this.updateRulerMarkers();
  }

  public applyRemoteZoom(zoomX: number, viewStart: number): void {
    this.zoomX = this.clampZoom(zoomX);
    this.viewStart = this.clampViewStart(viewStart);
    this.updateZoomUI();
    this.updateRulerTicks();
    this.updateRulerMarkers();
    this.refreshLayout();
  }

  // ─── Drawing ─────────────────────────────────────────────────────────────────

  private resizeCanvas(): void {
    const dpr = window.devicePixelRatio || 1;
    const canvas = this.mainCanvas;
    const w = Math.max(1, canvas.clientWidth);
    const h = Math.max(1, canvas.clientHeight);
    canvas.width  = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }

  private redrawMainPane(): void {
    if (!this.audioBuffer) return;
    const canvas = this.mainCanvas;
    const dpr    = window.devicePixelRatio || 1;
    const ctx    = canvas.getContext('2d')!;
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    if (this.layers.seg  && this.formData?.segments)    this.drawSegments(ctx, W, H, dpr);
    if (this.layers.spec && this.spectroOffscreen)       this.drawSpectrogram(ctx, W, H);
    if (this.layers.wav  && this.waveformPeaks.length)  this.drawWaveOverlay(ctx, W, H, dpr);
    if (this.layers.enr  && this.formData?.energy)      this.drawCurve(ctx, this.formData.energy,     CURVE_COLORS.enr, W, H);
    if (this.layers.brt  && this.formData?.brightness)  this.drawCurve(ctx, this.formData.brightness, CURVE_COLORS.brt, W, H);
    if (this.layers.mot  && this.formData?.motion)      this.drawCurve(ctx, this.formData.motion,     CURVE_COLORS.mot, W, H);
    if (this.layers.grv  && this.formData?.gravity)     this.drawCurve(ctx, this.formData.gravity,    CURVE_COLORS.grv, W, H);
    if (this.layers.ten  && this.formData?.tension)     this.drawCurve(ctx, this.formData.tension,    CURVE_COLORS.ten, W, H);
    // show loop overlay during drag (real-time feedback) and when enabled
    if ((this.loopEnabled || this.isLoopDragging) && this.loopOut > this.loopIn) this.drawLoopOverlay(ctx, W, H);
    this.drawPlayhead(ctx, W, H);
  }

  private drawSpectrogram(ctx: CanvasRenderingContext2D, W: number, H: number): void {
    if (!this.spectroOffscreen || !this.audioBuffer) return;
    const dur = this.audioBuffer.duration || 1;
    const sx = (this.viewStart / dur) * this.spectroOffscreen.width;
    const sw = (this.visibleDuration() / dur) * this.spectroOffscreen.width;
    ctx.drawImage(this.spectroOffscreen, sx, 0, Math.max(1, sw), this.spectroOffscreen.height, 0, 0, W, H);
  }

  private drawSegments(ctx: CanvasRenderingContext2D, W: number, H: number, dpr: number): void {
    this.formData!.segments.forEach((seg, idx) => {
      if (!this.audioBuffer) return;
      const start = seg.startRatio * this.audioBuffer.duration;
      const end = seg.endRatio * this.audioBuffer.duration;
      if (end < this.viewStart || start > this.visibleEnd()) return;
      const x     = this.timeToX(start, W);
      const w     = this.timeToX(end, W) - x;
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
      const time = this.viewStart + (i / cssW) * this.visibleDuration();
      const fullRatio = this.audioBuffer ? time / this.audioBuffer.duration : i / cssW;
      const { min, max } = this.waveformPeaks[Math.min(n - 1, Math.max(0, Math.floor(fullRatio * n)))];
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
    const dur = this.audioBuffer?.duration || 1;
    let started = false;
    data.forEach((v, i) => {
      const time = (i / Math.max(1, data.length - 1)) * dur;
      if (time < this.viewStart || time > this.visibleEnd()) return;
      const x = this.timeToX(time, W);
      const y = H - v * H;
      if (!started) { ctx.moveTo(x, y); started = true; }
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  private drawLoopOverlay(ctx: CanvasRenderingContext2D, W: number, H: number): void {
    const lx  = this.timeToX(this.loopIn, W);
    const rx  = this.timeToX(this.loopOut, W);
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
    const pos = this.seekTarget ?? this.getCurrentPosition();
    if (pos < this.viewStart || pos > this.visibleEnd()) return;
    const x = this.timeToX(pos, W);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth   = 1;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }

  // ─── Pointer position helper ──────────────────────────────────────────────────

  private posAt(canvas: HTMLCanvasElement, e: PointerEvent): number {
    return this.xToTime(e.clientX, canvas);
  }

  private pinchDistance(): number {
    const points = [...this.activePointers.values()];
    if (points.length < 2) return 0;
    return Math.abs(points[0].clientX - points[1].clientX);
  }

  private getPinchCenterRatio(el: HTMLElement): number {
    const points = [...this.activePointers.values()];
    if (points.length < 2) return 0.5;
    const r = el.getBoundingClientRect();
    const centerX = (points[0].clientX + points[1].clientX) / 2;
    return Math.max(0, Math.min(1, (centerX - r.left) / Math.max(1, r.width)));
  }

  private beginPinch(el: HTMLElement): void {
    if (this.longPressTimer) { clearTimeout(this.longPressTimer); this.longPressTimer = null; }
    this.isDragging = false;
    this.isLoopDragging = false;
    this.seekTarget = null;
    this.pinchStartDistance = Math.max(1, this.pinchDistance());
    this.pinchStartZoom = this.zoomX;
    this.pinchCenterRatio = this.getPinchCenterRatio(el);
  }

  private updatePinchZoom(el: HTMLElement): void {
    if (this.activePointers.size < 2 || this.pinchStartDistance <= 0) return;
    const nextZoom = this.pinchStartZoom * (this.pinchDistance() / this.pinchStartDistance);
    this.zoomAroundRatio(nextZoom, this.pinchCenterRatio, false);
  }

  private bindWheelZoom(el: HTMLElement): void {
    el.addEventListener('wheel', (e) => {
      if (!this.audioBuffer) return;
      e.preventDefault();
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY) && this.zoomX > 1) {
        this.panViewport(e.deltaX / Math.max(1, el.clientWidth || 400), true);
        return;
      }
      const rect = el.getBoundingClientRect();
      const anchorRatio = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)));
      const multiplier = Math.exp(-e.deltaY * 0.0025);
      this.zoomAroundRatio(this.zoomX * multiplier, anchorRatio, true);
    }, { signal: this.domAbort.signal, passive: false });
  }

  // ─── Main canvas interaction ──────────────────────────────────────────────────
  // click = seek · drag = seek (real-time playhead) · shift+drag = loop region
  // touch long-press+drag = loop region · click on segment = toggle segment loop

  private bindMainInteraction(): void {
    const canvas = this.mainCanvas;
    const sig = this.domAbort.signal;
    this.bindWheelZoom(canvas);

    canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      this.activePointers.set(e.pointerId, e);
      if (this.activePointers.size >= 2) {
        this.beginPinch(canvas);
        return;
      }
      this.dragStartX = e.clientX;
      this.dragStartAudioPos = this.posAt(canvas, e);
      this.isDragging = true;
      this.seekTarget = this.dragStartAudioPos;
      this.startAnimLoop();

      if (e.pointerType === 'touch') {
        this.longPressTimer = setTimeout(() => {
          this.longPressTimer = null;
          this.isDragging = false;
          this.isLoopDragging = true;
          this.loopIn = this.dragStartAudioPos;
          this.loopOut = this.loopIn;
        }, 400);
      }
    }, { signal: sig });

    canvas.addEventListener('pointermove', (e) => {
      if (this.activePointers.has(e.pointerId)) this.activePointers.set(e.pointerId, e);
      if (this.activePointers.size >= 2) {
        this.updatePinchZoom(canvas);
        return;
      }
      if (this.isLoopDragging) {
        const p = this.posAt(canvas, e);
        const anchor = this.dragStartAudioPos;
        if (p < anchor) { this.loopIn = p; this.loopOut = anchor; }
        else            { this.loopIn = anchor; this.loopOut = p; }
        return;
      }
      if (!this.isDragging) return;
      const moved = Math.abs(e.clientX - this.dragStartX) > 5;
      if (!moved) return;

      if (e.shiftKey) {
        // shift+drag → create loop region
        this.isLoopDragging = true;
        this.isDragging = false;
        this.seekTarget = null;
        const p = this.posAt(canvas, e);
        const anchor = this.dragStartAudioPos;
        if (p < anchor) { this.loopIn = p; this.loopOut = anchor; }
        else            { this.loopIn = anchor; this.loopOut = p; }
      } else {
        // plain drag → seek (move playhead)
        this.seekTarget = this.posAt(canvas, e);
      }
    }, { signal: sig });

    canvas.addEventListener('pointerup', (e) => {
      this.activePointers.delete(e.pointerId);
      if (this.pinchStartDistance > 0 && this.activePointers.size < 2) {
        try { canvas.releasePointerCapture(e.pointerId); } catch {}
        this.pinchStartDistance = 0;
        if (this.canControl()) this.publishZoomState();
        return;
      }
      if (this.longPressTimer) { clearTimeout(this.longPressTimer); this.longPressTimer = null; }
      try { canvas.releasePointerCapture(e.pointerId); } catch {}

      if (this.isLoopDragging) {
        this.isLoopDragging = false;
        this.seekTarget = null;
        if (this.loopOut > this.loopIn) {
          this.loopEnabled = true;
          this.updateLoopBtn();
          if (this.canControl()) this.publish?.({ type: 'sv-loop', inPoint: this.loopIn, outPoint: this.loopOut, enabled: true });
        }
        if (!this.isPlaying) this.stopAnimLoop();
        return;
      }

      if (!this.isDragging) return;
      this.isDragging = false;

      const p = this.seekTarget ?? this.posAt(canvas, e);
      this.seekTarget = null;
      const wasDrag = Math.abs(e.clientX - this.dragStartX) > 5;

      if (!wasDrag) {
        // click: check for segment snap → toggle loop; otherwise seek
        if (this.formData?.segments && this.audioBuffer) {
          const ratio = p / this.audioBuffer.duration;
          const seg   = this.formData.segments.find(s => ratio >= s.startRatio && ratio <= s.endRatio);
          if (seg) {
            const segIn  = seg.startRatio * this.audioBuffer.duration;
            const segOut = seg.endRatio   * this.audioBuffer.duration;
            if (this.loopEnabled && Math.abs(this.loopIn - segIn) < 0.01 && Math.abs(this.loopOut - segOut) < 0.01) {
              this.clearLoop();
            } else {
              this.setLoop(segIn, segOut);
            }
            return;
          }
        }
      }

      // seek (click outside segment or drag release)
      this.playOffset = p;
      if (this.isPlaying) this.startPlayback(p, { publishRoom: true });
      else {
        this.stopAnimLoop();
        this.emitTransport('seek', this.playOffset);
        requestAnimationFrame(() => this.redrawMainPane());
      }
      if (this.canControl()) this.publish?.({ type: 'sv-playback', action: this.isPlaying ? 'play' : 'seek', offset: this.playOffset, sentAt: Date.now() });
    }, { signal: sig });

    canvas.addEventListener('pointercancel', (e) => {
      this.activePointers.delete(e.pointerId);
      this.pinchStartDistance = 0;
      if (this.longPressTimer) { clearTimeout(this.longPressTimer); this.longPressTimer = null; }
      this.isDragging = false;
      this.isLoopDragging = false;
      this.seekTarget = null;
    }, { signal: sig });

    canvas.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.clearLoop();
    }, { signal: sig });
  }

  // ─── Playback ─────────────────────────────────────────────────────────────────

  private togglePlayback(): void {
    if (this.isPlaying) {
      this.pausePlayback();
      if (this.canControl()) this.publish?.({ type: 'sv-playback', action: 'pause', offset: this.playOffset, sentAt: Date.now() });
    } else {
      this.startPlayback(undefined, { publishRoom: true });
      if (this.canControl()) this.publish?.({ type: 'sv-playback', action: 'play', offset: this.playOffset, sentAt: Date.now() });
    }
  }

  private ensureOutputChain(): AudioNode {
    const ctx = this.audioCtx!;
    if (!this.outputGainNode || !this.outputLimiterNode) {
      const gain = ctx.createGain();
      gain.gain.value = 0.85;
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -3;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.001;
      limiter.release.value = 0.25;
      gain.connect(limiter);
      limiter.connect(ctx.destination);
      this.outputGainNode = gain;
      this.outputLimiterNode = limiter;
    }
    return this.outputGainNode;
  }

  private startPlayback(offset = this.playOffset, options: { publishRoom?: boolean } = {}): void {
    this.stopPlayback();
    if (!this.audioBuffer) return;
    if (!this.audioCtx) this.audioCtx = new AudioContext();
    const src = this.audioCtx.createBufferSource();
    src.buffer = this.audioBuffer;
    src.connect(this.ensureOutputChain());
    this.playOffset    = Math.max(0, Math.min(offset, this.audioBuffer.duration - 0.01));
    this.playStartTime = this.audioCtx.currentTime;
    src.start(0, this.playOffset);
    src.onended = () => {
      if (this.isPlaying) {
        this.playOffset = this.getCurrentPosition();
        this.isPlaying  = false;
        this.updatePlayBtn();
        this.emitTransport('pause', this.playOffset);
      }
    };
    this.playbackNode = src;
    this.isPlaying    = true;
    this.updatePlayBtn();
    this.startAnimLoop();
    this.startTransportHeartbeat(options.publishRoom ?? true);
    this.emitTransport('play', this.playOffset);
  }

  private pausePlayback(options: { emit?: boolean } = {}): void {
    this.playOffset = this.getCurrentPosition();
    if (this.playbackNode) {
      this.playbackNode.onended = null;
      try { this.playbackNode.stop(); } catch {}
      try { this.playbackNode.disconnect(); } catch {}
      this.playbackNode = null;
    }
    this.isPlaying = false;
    this.updatePlayBtn();
    this.stopAnimLoop();
    this.stopTransportHeartbeat();
    if (options.emit !== false) this.emitTransport('pause', this.playOffset);
  }

  private stopPlayback(): void { this.pausePlayback({ emit: false }); }

  private getCurrentPosition(): number {
    if (!this.audioBuffer || !this.isPlaying || !this.audioCtx) return this.playOffset;
    return Math.min(this.playOffset + (this.audioCtx.currentTime - this.playStartTime), this.audioBuffer.duration);
  }

  private updatePlayBtn(): void { this.playBtn.textContent = this.isPlaying ? '⏸' : '▶'; }

  private emitTransport(action: 'play' | 'pause' | 'seek', offset = this.getCurrentPosition()): void {
    const sentAt = Date.now();
    window.dispatchEvent(new CustomEvent('musiki:sv:transport', {
      detail: {
        action,
        offset: Math.max(0, Number(offset) || 0),
        duration: this.audioBuffer?.duration ?? 0,
        sentAt,
      },
    }));
  }

  private startTransportHeartbeat(publishRoom: boolean): void {
    this.stopTransportHeartbeat();
    this.transportHeartbeatPublishesRoom = publishRoom;
    this.transportHeartbeatId = setInterval(() => {
      if (!this.isPlaying) return;
      const offset = this.getCurrentPosition();
      this.emitTransport('play', offset);
      if (this.transportHeartbeatPublishesRoom && this.canControl()) {
        this.publish?.({ type: 'sv-playback', action: 'play', offset, sentAt: Date.now() });
      }
    }, 1000);
  }

  private stopTransportHeartbeat(): void {
    if (this.transportHeartbeatId !== null) {
      clearInterval(this.transportHeartbeatId);
      this.transportHeartbeatId = null;
    }
    this.transportHeartbeatPublishesRoom = false;
  }

  // ─── Loop ─────────────────────────────────────────────────────────────────────

  private toggleLoop(): void {
    if (this.loopEnabled) {
      this.clearLoop();
    } else if (this.loopOut > this.loopIn) {
      this.loopEnabled = true;
      this.updateLoopBtn();
      if (this.canControl()) this.publish?.({ type: 'sv-loop', inPoint: this.loopIn, outPoint: this.loopOut, enabled: true });
    }
  }

  private setLoop(inPoint: number, outPoint: number): void {
    this.loopIn      = inPoint;
    this.loopOut     = outPoint;
    this.loopEnabled = true;
    this.updateLoopBtn();
    this.updateRulerMarkers();
    if (this.canControl()) this.publish?.({ type: 'sv-loop', inPoint, outPoint, enabled: true });
    if (this.rafId === null) requestAnimationFrame(() => this.redrawMainPane());
  }

  private clearLoop(): void {
    this.loopEnabled = false;
    this.updateLoopBtn();
    this.updateRulerMarkers();
    if (this.canControl()) this.publish?.({ type: 'sv-loop', inPoint: 0, outPoint: 0, enabled: false });
    if (this.rafId === null) requestAnimationFrame(() => this.redrawMainPane());
  }

  private updateLoopBtn(): void {
    this.loopBtn.dataset.active = this.loopEnabled ? 'true' : 'false';
  }

  public applyRemoteLoop(inPoint: number, outPoint: number, enabled: boolean): void {
    this.loopIn      = inPoint;
    this.loopOut     = outPoint;
    this.loopEnabled = enabled;
    this.updateLoopBtn();
    this.updateRulerMarkers();
  }

  // ─── Animation loop (loop restart debounced via lastLoopRestartAt) ────────────

  private startAnimLoop(): void {
    if (this.rafId !== null) return;
    const tick = () => {
      if (this.isPlaying && this.loopEnabled && this.loopOut > this.loopIn) {
        if (this.getCurrentPosition() >= this.loopOut - 0.05) {
          const now = this.audioCtx!.currentTime;
          if (now - this.lastLoopRestartAt >= 0.15) {
            this.lastLoopRestartAt = now;
            if (this.playbackNode) {
              this.playbackNode.onended = null;
              try { this.playbackNode.stop(); } catch {}
              try { this.playbackNode.disconnect(); } catch {}
              this.playbackNode = null;
            }
            if (this.audioBuffer && this.audioCtx) {
              const src = this.audioCtx.createBufferSource();
              src.buffer = this.audioBuffer;
              src.connect(this.ensureOutputChain());
              this.playOffset    = this.loopIn;
              this.playStartTime = this.audioCtx.currentTime;
              src.start(0, this.loopIn);
              this.emitTransport('play', this.loopIn);
              if (this.transportHeartbeatPublishesRoom && this.canControl()) {
                this.publish?.({ type: 'sv-playback', action: 'play', offset: this.loopIn, sentAt: Date.now() });
              }
              src.onended = () => {
                if (this.isPlaying) {
                  this.playOffset = this.getCurrentPosition();
                  this.isPlaying = false;
                  this.updatePlayBtn();
                  this.emitTransport('pause', this.playOffset);
                }
              };
              this.playbackNode = src;
            }
          }
        }
      }
      this.redrawMainPane();
      this.updateRulerMarkers();
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
    this.resizeObserver = new ResizeObserver(() => {
      this.refreshLayout();
    });
    this.resizeObserver.observe(this.podEl);
  }

  // ─── Remote ──────────────────────────────────────────────────────────────────

  public applyRemotePlayback(action: 'play' | 'pause' | 'seek', offset: number): void {
    if (action === 'pause') this.pausePlayback();
    else if (action === 'play') {
      this.ensureTimeVisible(offset);
      this.startPlayback(offset, { publishRoom: false });
    } else {
      this.ensureTimeVisible(offset);
      this.playOffset = Math.max(0, Number(offset) || 0);
      this.emitTransport('seek', this.playOffset);
      this.updateRulerMarkers();
      requestAnimationFrame(() => this.redrawMainPane());
    }
  }

  public publishCurrentState(): void {
    if (!this.canControl()) return;
    for (const [layer, visible] of Object.entries(this.layers)) {
      this.publish?.({ type: 'sv-layer', layer, visible });
    }
    this.publish?.({ type: 'sv-loop', inPoint: this.loopIn, outPoint: this.loopOut, enabled: this.loopEnabled });
    this.publish?.({ type: 'sv-playback', action: this.isPlaying ? 'play' : 'seek', offset: this.getCurrentPosition(), sentAt: Date.now() });
    this.publishZoomState();
  }

  public refreshLayout(): void {
    if (!this.audioBuffer) return;
    this.refreshLayoutTimers.forEach((timer) => window.clearTimeout(timer));
    this.refreshLayoutTimers = [];
    [0, 80, 260, 700].forEach((delay) => {
      const timer = window.setTimeout(() => {
        if (!this.audioBuffer) return;
        this.resizeCanvas();
        this.viewStart = this.clampViewStart();
        this.updateZoomUI();
        this.updateRulerTicks();
        this.updateRulerMarkers();
        if (this.formData && this.spectroOffscreen) requestAnimationFrame(() => this.redrawMainPane());
        else this.runWorker();
      }, delay);
      this.refreshLayoutTimers.push(timer);
    });
  }

  // ─── Ruler ───────────────────────────────────────────────────────────────────

  private updateRulerMarkers(): void {
    if (!this.audioBuffer) return;
    const pos = this.seekTarget ?? this.getCurrentPosition();
    const playheadRatio = this.timeToRatio(pos);
    this.rulerPlayheadEl.hidden = playheadRatio < 0 || playheadRatio > 1;
    this.rulerPlayheadEl.style.left = `${playheadRatio * 100}%`;
    const show = this.loopEnabled && this.loopOut > this.loopIn;
    this.inMarkerEl.hidden  = !show;
    this.outMarkerEl.hidden = !show;
    if (show) {
      const inRatio = this.timeToRatio(this.loopIn);
      const outRatio = this.timeToRatio(this.loopOut);
      this.inMarkerEl.hidden = inRatio < 0 || inRatio > 1;
      this.outMarkerEl.hidden = outRatio < 0 || outRatio > 1;
      this.inMarkerEl.style.left  = `${inRatio * 100}%`;
      this.outMarkerEl.style.left = `${outRatio * 100}%`;
    }
  }

  private updateRulerTicks(): void {
    if (!this.audioBuffer || !this.rulerTicksEl) return;
    const visible = this.visibleDuration();
    if (!visible) return;
    const targetPixels = 84;
    const width = Math.max(1, this.rulerEl.clientWidth || this.mainCanvas.clientWidth || 400);
    const targetStep = visible / Math.max(1, width / targetPixels);
    const bases = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
    const step = bases.find((candidate) => candidate >= targetStep) ?? 600;
    const minorStep = step / 5;
    const start = Math.floor(this.viewStart / minorStep) * minorStep;
    const end = this.visibleEnd();
    const ticks: string[] = [];
    for (let t = start; t <= end + minorStep; t += minorStep) {
      if (t < 0) continue;
      const ratio = this.timeToRatio(t);
      if (ratio < -0.01 || ratio > 1.01) continue;
      const isMajor = Math.abs((t / step) - Math.round(t / step)) < 0.001;
      ticks.push(`<span class="sv-ruler-tick${isMajor ? ' sv-ruler-tick--major' : ''}" style="left:${ratio * 100}%"></span>`);
      if (isMajor) ticks.push(`<span class="sv-ruler-label" style="left:${ratio * 100}%">${this.formatTimeLabel(t, step)}</span>`);
    }
    this.rulerTicksEl.innerHTML = ticks.join('');
  }

  private formatTimeLabel(seconds: number, step: number): string {
    if (step < 1) return `${seconds.toFixed(step < 0.01 ? 3 : 2)}s`;
    const minutes = Math.floor(seconds / 60);
    const secs = seconds - minutes * 60;
    if (minutes > 0) return `${minutes}:${secs.toFixed(step < 10 ? 1 : 0).padStart(step < 10 ? 4 : 2, '0')}`;
    return `${secs.toFixed(step < 10 ? 1 : 0)}s`;
  }

  private bindRulerInteraction(): void {
    const ruler = this.rulerEl;
    const sig   = this.domAbort.signal;
    let seekDragging = false;
    let markerDrag: 'in' | 'out' | null = null;
    this.bindWheelZoom(ruler);

    const posFromX = (clientX: number): number => {
      return this.xToTime(clientX, ruler);
    };

    // Marker drag — IN
    this.inMarkerEl.addEventListener('pointerdown', (e) => {
      e.stopPropagation(); e.preventDefault();
      this.inMarkerEl.setPointerCapture(e.pointerId);
      markerDrag = 'in';
    }, { signal: sig });
    this.inMarkerEl.addEventListener('pointermove', (e) => {
      if (markerDrag !== 'in') return;
      this.loopIn = Math.min(posFromX(e.clientX), this.loopOut - 0.05);
      this.updateRulerMarkers();
      if (this.rafId === null) requestAnimationFrame(() => this.redrawMainPane());
    }, { signal: sig });
    this.inMarkerEl.addEventListener('pointerup', () => {
      if (markerDrag !== 'in') return;
      markerDrag = null;
      if (this.canControl()) this.publish?.({ type: 'sv-loop', inPoint: this.loopIn, outPoint: this.loopOut, enabled: true });
    }, { signal: sig });

    // Marker drag — OUT
    this.outMarkerEl.addEventListener('pointerdown', (e) => {
      e.stopPropagation(); e.preventDefault();
      this.outMarkerEl.setPointerCapture(e.pointerId);
      markerDrag = 'out';
    }, { signal: sig });
    this.outMarkerEl.addEventListener('pointermove', (e) => {
      if (markerDrag !== 'out') return;
      this.loopOut = Math.max(posFromX(e.clientX), this.loopIn + 0.05);
      this.updateRulerMarkers();
      if (this.rafId === null) requestAnimationFrame(() => this.redrawMainPane());
    }, { signal: sig });
    this.outMarkerEl.addEventListener('pointerup', () => {
      if (markerDrag !== 'out') return;
      markerDrag = null;
      if (this.canControl()) this.publish?.({ type: 'sv-loop', inPoint: this.loopIn, outPoint: this.loopOut, enabled: true });
    }, { signal: sig });

    // Ruler seek drag
    ruler.addEventListener('pointerdown', (e) => {
      if (markerDrag) return;
      e.preventDefault();
      ruler.setPointerCapture(e.pointerId);
      seekDragging = true;
      this.seekTarget = posFromX(e.clientX);
      this.updateRulerMarkers();
      this.startAnimLoop();
    }, { signal: sig });

    ruler.addEventListener('pointermove', (e) => {
      if (!seekDragging || markerDrag) return;
      this.seekTarget = posFromX(e.clientX);
      this.updateRulerMarkers();
    }, { signal: sig });

    ruler.addEventListener('pointerup', (e) => {
      if (!seekDragging) return;
      seekDragging = false;
      const p = this.seekTarget ?? posFromX(e.clientX);
      this.seekTarget = null;
      this.playOffset = p;
      if (this.isPlaying) this.startPlayback(p, { publishRoom: true });
      else {
        this.stopAnimLoop();
        this.emitTransport('seek', this.playOffset);
        requestAnimationFrame(() => { this.redrawMainPane(); this.updateRulerMarkers(); });
      }
      if (this.canControl()) this.publish?.({ type: 'sv-playback', action: this.isPlaying ? 'play' : 'seek', offset: this.playOffset, sentAt: Date.now() });
    }, { signal: sig });
  }

  // ─── Misc ─────────────────────────────────────────────────────────────────────

  private setStatus(msg: string): void { if (this.statusEl) this.statusEl.textContent = msg; }

  public dispose(): void {
    this.stopPlayback();
    this.stopAnimLoop();
    this.refreshLayoutTimers.forEach((timer) => window.clearTimeout(timer));
    this.refreshLayoutTimers = [];
    this.domAbort.abort();
    this.resizeObserver?.disconnect();
    window.removeEventListener('sa:frame',      this.onFrame);
    window.removeEventListener('sa:file-ready', this.onFileReady);
    window.removeEventListener('musiki:sv:load-decoded', this.onTargetedFileReady);
    this.worker?.terminate();
    if (this.audioCtx) { try { this.audioCtx.close(); } catch {} this.audioCtx = null; }
    this.outputGainNode = null;
    this.outputLimiterNode = null;
  }
}
