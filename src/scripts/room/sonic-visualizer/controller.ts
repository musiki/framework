import { drawRadar } from '../sonic-analyzer/views/radar-view';
import { renderHeatmap, renderPitchContour } from '../sonic-analyzer/views/viz-view';
import type { SAResults } from '../sonic-analyzer/views/text-view';
import type { SAFilePayload } from '../sonic-analyzer/controller';
import type { ConferenceMessage } from '../session';

export type SVOptions = { container: HTMLElement; publish?: (msg: ConferenceMessage) => void };

export class SonicVisualizerController {
  private container: HTMLElement;

  // DOM
  private podEl!: HTMLElement;
  private statusEl!: HTMLElement;
  private radarCanvas!: HTMLCanvasElement;
  private heatmapCanvas!: HTMLCanvasElement;
  private waveformContainer!: HTMLElement;
  private waveformCanvas!: HTMLCanvasElement;
  private playBtn!: HTMLButtonElement;
  private vtabBtns: HTMLButtonElement[] = [];

  // viz state
  private activeVTab = 'mel';
  private melspecData: number[][] = [];
  private chromaData: number[][] = [];
  private pitchData: number[] = [];

  // waveform / playback
  private audioBuffer: AudioBuffer | null = null;
  private waveformPeaks: { min: number; max: number }[] = [];
  private waveformCache: HTMLCanvasElement | null = null;
  private isPlaying = false;
  private playOffset = 0;
  private playStartTime = 0;
  private audioCtx: AudioContext | null = null;
  private playbackNode: AudioBufferSourceNode | null = null;
  private rafId: number | null = null;
  private isDragging = false;
  private publish?: (msg: ConferenceMessage) => void;

  // bound event handlers (for cleanup)
  private onFrame:      (e: Event) => void;
  private onFileReady:  (e: Event) => void;
  private onSAActive:   (e: Event) => void;

  constructor(options: SVOptions) {
    this.container = options.container;
    this.publish = options.publish;
    this.bindDOM();

    this.onFrame     = (e) => this.handleFrame((e as CustomEvent<{ results: SAResults }>).detail);
    this.onFileReady = (e) => this.handleFileReady((e as CustomEvent<SAFilePayload>).detail);
    this.onSAActive  = (e) => this.handleSAActive((e as CustomEvent<{ active: boolean }>).detail);

    window.addEventListener('sa:frame',      this.onFrame);
    window.addEventListener('sa:file-ready', this.onFileReady);
    window.addEventListener('sa:active',     this.onSAActive);

    this.bindResize();
    // Request current SA state in case SA was already running before SV opened
    window.dispatchEvent(new CustomEvent('sv:request-state'));
  }

  private bindDOM(): void {
    const q = <T extends HTMLElement>(sel: string) => this.container.querySelector<T>(sel);
    this.podEl           = q('.sv-pod')!;
    this.statusEl        = q('[data-sv-status]')!;
    this.radarCanvas     = q<HTMLCanvasElement>('[data-sv-radar]')!;
    this.heatmapCanvas   = q<HTMLCanvasElement>('[data-sv-heatmap]')!;
    this.waveformContainer = q('[data-sv-waveform-container]')!;
    this.waveformCanvas  = q<HTMLCanvasElement>('[data-sv-waveform]')!;
    this.playBtn         = q<HTMLButtonElement>('[data-sv-play]')!;
    this.vtabBtns        = Array.from(this.container.querySelectorAll<HTMLButtonElement>('[data-sv-vtab]'));

    this.vtabBtns.forEach(btn => btn.addEventListener('click', () => this.switchVTab(btn.dataset.svVtab!)));
    this.playBtn.addEventListener('click', () => this.togglePlayback());
    this.bindWaveformInteraction();
  }

  // ─── SA event handlers ───────────────────────────────────────────────────────

  private handleFrame(detail: { results: SAResults }): void {
    drawRadar(this.radarCanvas, detail.results);
  }

  private handleFileReady(payload: SAFilePayload): void {
    this.audioBuffer   = payload.buffer;
    this.waveformPeaks = payload.peaks;
    this.melspecData   = payload.melspec;
    this.chromaData    = payload.chroma;
    this.pitchData     = payload.pitches;
    const bpmStr = payload.bpm > 0 ? ` · ${payload.bpm.toFixed(0)}bpm` : '';
    const keyStr = payload.key ? ` · ${payload.key} ${payload.scale}` : '';
    this.setStatus(`${payload.fileName}${keyStr}${bpmStr}`);
    this.showWaveform();
    this.renderCurrentHeatmap();
  }

  private handleSAActive(detail: { active: boolean }): void {
    if (!detail.active && !this.audioBuffer) this.setStatus('waiting for sA…');
  }

  // ─── Vtab / heatmap ──────────────────────────────────────────────────────────

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

  private renderCurrentHeatmap(): void {
    if (this.activeVTab === 'mel' && this.melspecData.length) renderHeatmap(this.heatmapCanvas, this.melspecData);
    else if (this.activeVTab === 'chr' && this.chromaData.length) renderHeatmap(this.heatmapCanvas, this.chromaData);
    else if (this.activeVTab === 'pch' && this.pitchData.length) renderPitchContour(this.heatmapCanvas, this.pitchData);
  }

  // ─── Waveform ────────────────────────────────────────────────────────────────

  private showWaveform(): void {
    this.waveformContainer.hidden = false;
    this.playBtn.hidden = false;
    requestAnimationFrame(() => { this.buildWaveformCache(); this.redrawWaveform(); });
  }

  private buildWaveformCache(): void {
    const dpr  = window.devicePixelRatio || 1;
    const cssW = Math.max(1, this.waveformCanvas.clientWidth);
    const cssH = Math.max(1, this.waveformCanvas.clientHeight);
    this.waveformCanvas.width  = Math.round(cssW * dpr);
    this.waveformCanvas.height = Math.round(cssH * dpr);

    const off = document.createElement('canvas');
    off.width  = Math.round(cssW * dpr);
    off.height = Math.round(cssH * dpr);
    const ctx  = off.getContext('2d')!;
    ctx.scale(dpr, dpr);
    const mid = cssH / 2;
    const n   = this.waveformPeaks.length;

    ctx.strokeStyle = 'rgba(69,211,132,0.65)';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    for (let i = 0; i < cssW; i++) {
      const { min, max } = this.waveformPeaks[Math.min(n - 1, Math.floor((i / cssW) * n))];
      ctx.moveTo(i + 0.5, mid - max * mid);
      ctx.lineTo(i + 0.5, Math.max(mid - min * mid, mid - max * mid + 1));
    }
    ctx.stroke();
    this.waveformCache = off;
  }

  private redrawWaveform(): void {
    if (!this.waveformCanvas || !this.waveformCache || !this.audioBuffer) return;
    const canvas = this.waveformCanvas;
    const dpr    = window.devicePixelRatio || 1;
    const ctx    = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(this.waveformCache, 0, 0);

    const pos = this.getCurrentPosition();
    const x   = (pos / this.audioBuffer.duration) * canvas.width;

    ctx.fillStyle = 'rgba(69,211,132,0.07)';
    ctx.fillRect(0, 0, x, canvas.height);
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth   = 1;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();

    const secs = this.getCurrentPosition() | 0;
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font      = `${10 * dpr}px monospace`;
    ctx.fillText(`${String(secs / 60 | 0).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`, 4 * dpr, 12 * dpr);
  }

  private bindWaveformInteraction(): void {
    const canvas = this.waveformCanvas;
    const posAt = (e: PointerEvent) => {
      if (!this.audioBuffer) return 0;
      const r = canvas.getBoundingClientRect();
      return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * this.audioBuffer.duration;
    };
    canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault(); canvas.setPointerCapture(e.pointerId);
      this.isDragging = true;
      const p = posAt(e); this.playOffset = p;
      if (this.isPlaying) this.startPlayback(p);
      this.startPlayheadAnim();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.isDragging) return;
      const p = posAt(e);
      if (this.isPlaying) this.startPlayback(p); else { this.playOffset = p; this.redrawWaveform(); }
    });
    canvas.addEventListener('pointerup', (e) => {
      this.isDragging = false; canvas.releasePointerCapture(e.pointerId);
      if (!this.isPlaying) this.stopPlayheadAnim();
      this.publish?.({
        type: 'sv-playback',
        action: this.isPlaying ? 'play' : 'seek',
        offset: this.playOffset,
      });
    });
  }

  // ─── Playback ────────────────────────────────────────────────────────────────

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
    src.onended = () => { if (this.isPlaying) { this.isPlaying = false; this.playOffset = 0; this.updatePlayBtn(); this.redrawWaveform(); } };
    this.playbackNode = src; this.isPlaying = true;
    this.updatePlayBtn(); this.startPlayheadAnim();
  }

  private pausePlayback(): void {
    if (this.playbackNode) { try { this.playbackNode.stop(); } catch {} try { this.playbackNode.disconnect(); } catch {} this.playbackNode = null; }
    if (this.isPlaying) { this.playOffset = this.getCurrentPosition(); this.isPlaying = false; }
    this.updatePlayBtn(); this.stopPlayheadAnim();
  }

  private stopPlayback(): void { this.pausePlayback(); }

  private getCurrentPosition(): number {
    if (!this.audioBuffer || !this.isPlaying || !this.audioCtx) return this.playOffset;
    return Math.min(this.playOffset + (this.audioCtx.currentTime - this.playStartTime), this.audioBuffer.duration);
  }

  private updatePlayBtn(): void { this.playBtn.textContent = this.isPlaying ? '⏸' : '▶'; }

  private startPlayheadAnim(): void {
    if (this.rafId !== null) return;
    const loop = () => { this.redrawWaveform(); this.rafId = (this.isPlaying || this.isDragging) ? requestAnimationFrame(loop) : null; };
    this.rafId = requestAnimationFrame(loop);
  }

  private stopPlayheadAnim(): void { if (this.rafId !== null) { cancelAnimationFrame(this.rafId); this.rafId = null; } }

  // ─── Resize ──────────────────────────────────────────────────────────────────

  private bindResize(): void {
    const ro = new ResizeObserver(() => {
      if (this.audioBuffer && this.waveformPeaks.length) { this.buildWaveformCache(); this.redrawWaveform(); }
      this.renderCurrentHeatmap();
    });
    ro.observe(this.podEl);
  }

  // ─── Misc ────────────────────────────────────────────────────────────────────

  private setStatus(msg: string): void { if (this.statusEl) this.statusEl.textContent = msg; }

  public applyRemotePlayback(action: 'play' | 'pause' | 'seek', offset: number): void {
    if (action === 'pause') {
      this.pausePlayback();
    } else {
      this.startPlayback(offset);
    }
  }

  public dispose(): void {
    this.stopPlayback();
    window.removeEventListener('sa:frame',      this.onFrame);
    window.removeEventListener('sa:file-ready', this.onFileReady);
    window.removeEventListener('sa:active',     this.onSAActive);
    if (this.audioCtx) { try { this.audioCtx.close(); } catch {} this.audioCtx = null; }
  }
}
