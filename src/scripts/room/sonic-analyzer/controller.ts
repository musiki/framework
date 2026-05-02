import { renderTextView, hzToNote } from './views/text-view';
import type { SAResults } from './views/text-view';
import { renderSpectrumView } from './views/spectrum-view';
import { renderTimbreView } from './views/timbre-view';
import { LufsHistory } from './views/lufs-view';
import { drawRadar } from './views/radar-view';
import { renderHeatmap, renderPitchContour } from './views/viz-view';

type AudioTapFn = () => { context: AudioContext; masterAnalyser: AnalyserNode } | null;
export type SonicAnalyzerOptions = { container: HTMLElement; getAudioTap: AudioTapFn; };

declare const EssentiaWASM: any;
declare const Essentia: any;

const ACCEPTED_TYPES = ['audio/wav','audio/ogg','audio/mpeg','audio/mp3','audio/wave','audio/x-wav'];
const ACCEPTED_EXTS  = ['.wav','.ogg','.mp3'];

export class SonicAnalyzerController {
  private container: HTMLElement;
  private getAudioTap: AudioTapFn;

  // analysis state
  private active = false;
  private essentia: any = null;
  private analyserNode: AnalyserNode | null = null;
  private sourceNode: AudioBufferSourceNode | MediaStreamAudioSourceNode | null = null;
  private micStream: MediaStream | null = null;
  private fileBuffer: AudioBuffer | null = null;
  private loadedFileName = '';
  private timeDomainBuf: Float32Array<ArrayBuffer> | null = null;
  private freqBuf: Float32Array<ArrayBuffer> | null = null;
  private prevFreqBuf: Float32Array<ArrayBuffer> | null = null;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private fps = 10;
  private activeView = 'text';
  private activeSource = 'master';
  private lufsHistory = new LufsHistory();
  private prevLufsM = -70;
  private lufsIAccum = 0;
  private lufsICount = 0;

  // waveform player
  private waveformContainer!: HTMLElement;
  private waveformCanvas!: HTMLCanvasElement;
  private playBtn!: HTMLButtonElement;
  private isPlaying = false;
  private playOffset = 0;
  private playStartTime = 0;
  private playbackNode: AudioBufferSourceNode | null = null;
  private rafId: number | null = null;
  private isDragging = false;
  private waveformPeaks: { min: number; max: number }[] = [];
  private waveformCache: HTMLCanvasElement | null = null;

  // viz panel
  private radarCanvas!: HTMLCanvasElement;
  private heatmapCanvas!: HTMLCanvasElement;
  private computedWrap!: HTMLElement;
  private vtabBtns: HTMLButtonElement[] = [];
  private activeVTab = 'mel';
  private melspecData: number[][] = [];
  private chromaData: number[][] = [];
  private pitchData: number[] = [];

  // DOM refs
  private podEl!: HTMLElement;
  private powerBtn!: HTMLElement;
  private statusTextEl!: HTMLElement;
  private fileNameEl!: HTMLElement;
  private saveBtnEl!: HTMLButtonElement;
  private sourceSelect!: HTMLSelectElement;
  private fpsSlider!: HTMLInputElement;
  private fpsLabel!: HTMLElement;
  private viewEls: Record<string, HTMLElement> = {};
  private tabBtns: HTMLButtonElement[] = [];

  constructor(options: SonicAnalyzerOptions) {
    this.container = options.container;
    this.getAudioTap = options.getAudioTap;
    this.bindDOM();
    this.bindDropzone();
  }

  private bindDOM(): void {
    const q = <T extends HTMLElement>(sel: string) => this.container.querySelector<T>(sel);
    this.podEl            = q('.sa-pod')!;
    this.powerBtn         = q('[data-sa-power]')!;
    this.statusTextEl     = q('[data-sa-status-text]')!;
    this.fileNameEl       = q('[data-sa-file-name]')!;
    this.saveBtnEl        = q<HTMLButtonElement>('[data-sa-save]')!;
    this.sourceSelect     = q<HTMLSelectElement>('[data-sa-source]')!;
    this.fpsSlider        = q<HTMLInputElement>('[data-sa-fps]')!;
    this.fpsLabel         = q('[data-sa-fps-label]')!;
    this.waveformContainer = q('[data-sa-waveform-container]')!;
    this.waveformCanvas   = q<HTMLCanvasElement>('[data-sa-waveform]')!;
    this.playBtn          = q<HTMLButtonElement>('[data-sa-play]')!;
    this.radarCanvas      = q<HTMLCanvasElement>('[data-sa-radar]')!;
    this.heatmapCanvas    = q<HTMLCanvasElement>('[data-sa-heatmap]')!;
    this.computedWrap     = q('[data-sa-computed]')!;

    for (const v of ['text','spectrum','timbre','lufs']) {
      const el = q<HTMLElement>(`[data-sa-view="${v}"]`);
      if (el) this.viewEls[v] = el;
    }
    this.tabBtns  = Array.from(this.container.querySelectorAll<HTMLButtonElement>('[data-sa-tab]'));
    this.vtabBtns = Array.from(this.container.querySelectorAll<HTMLButtonElement>('[data-sa-vtab]'));

    this.powerBtn.addEventListener('click', () => void this.toggle());
    this.sourceSelect.addEventListener('change', () => {
      this.activeSource = this.sourceSelect.value;
      if (this.active) void this.reconnectSource();
    });
    this.fpsSlider.addEventListener('input', () => {
      this.fps = parseInt(this.fpsSlider.value, 10);
      this.fpsLabel.textContent = `${this.fps}fps`;
      if (this.active) this.restartLoop();
    });
    this.tabBtns.forEach(btn  => btn.addEventListener('click',  () => this.switchView(btn.dataset.saTab!)));
    this.vtabBtns.forEach(btn => btn.addEventListener('click',  () => this.switchVTab(btn.dataset.saVtab!)));
    this.playBtn.addEventListener('click', () => this.togglePlayback());
    this.bindWaveformInteraction();
  }

  // ─── Dropzone ────────────────────────────────────────────────────────────────

  private bindDropzone(): void {
    const pod = this.podEl;
    pod.addEventListener('dragover', (e) => {
      if (!this.hasDraggingAudio(e)) return;
      e.preventDefault(); e.dataTransfer!.dropEffect = 'copy';
      pod.classList.add('sa-pod--drag-over');
    });
    pod.addEventListener('dragleave', (e) => {
      if (!pod.contains(e.relatedTarget as Node)) pod.classList.remove('sa-pod--drag-over');
    });
    pod.addEventListener('drop', (e) => {
      e.preventDefault(); pod.classList.remove('sa-pod--drag-over');
      const file = this.extractAudioFile(e.dataTransfer);
      if (file) void this.loadFile(file);
    });
  }
  private hasDraggingAudio(e: DragEvent): boolean {
    if (!e.dataTransfer) return false;
    for (const item of Array.from(e.dataTransfer.items))
      if (item.kind === 'file' && (ACCEPTED_TYPES.includes(item.type) || item.type === '')) return true;
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
  private async loadFile(file: File): Promise<void> {
    this.setStatus(`decoding ${file.name}…`);
    try {
      const ctx = this.getAudioTap()?.context ?? new AudioContext();
      this.fileBuffer = await ctx.decodeAudioData(await file.arrayBuffer());
      this.loadedFileName = file.name;
      this.addFileOption(file.name);
      this.showFileMeta(file.name);
      if (this.active) { this.sourceSelect.value = 'file'; this.activeSource = 'file'; void this.reconnectSource(); }
      this.computeWaveformPeaks();
      this.showWaveform();
      if (this.essentia) void this.computeVizFeatures();
      else this.setStatus(`file ready · ${file.name}`);
    } catch { this.setStatus('error: could not decode file'); }
  }
  private addFileOption(name: string): void {
    let opt = this.sourceSelect.querySelector<HTMLOptionElement>('option[value="file"]');
    if (!opt) { opt = document.createElement('option'); opt.value = 'file'; this.sourceSelect.appendChild(opt); }
    opt.textContent = `file:${name.length > 14 ? name.slice(0,12)+'…' : name}`;
    this.sourceSelect.value = 'file'; this.activeSource = 'file';
  }
  private showFileMeta(name: string): void {
    this.fileNameEl.textContent = name; this.fileNameEl.hidden = false; this.saveBtnEl.hidden = false;
  }

  // ─── Views ───────────────────────────────────────────────────────────────────

  private switchView(view: string): void {
    this.activeView = view;
    for (const [k, el] of Object.entries(this.viewEls)) el.hidden = k !== view;
    this.tabBtns.forEach(b => { b.dataset.active = b.dataset.saTab === view ? 'true' : 'false'; });
  }
  private switchVTab(tab: string): void {
    this.activeVTab = tab;
    this.vtabBtns.forEach(b => { b.dataset.active = b.dataset.saVtab === tab ? 'true' : 'false'; });
    this.renderCurrentHeatmap();
  }
  private renderCurrentHeatmap(): void {
    if (!this.heatmapCanvas) return;
    if (this.activeVTab === 'mel' && this.melspecData.length) renderHeatmap(this.heatmapCanvas, this.melspecData);
    else if (this.activeVTab === 'chr' && this.chromaData.length) renderHeatmap(this.heatmapCanvas, this.chromaData);
    else if (this.activeVTab === 'pch' && this.pitchData.length) renderPitchContour(this.heatmapCanvas, this.pitchData);
  }

  // ─── Activation ──────────────────────────────────────────────────────────────

  async toggle(): Promise<void> { if (this.active) this.deactivate(); else await this.activate(); }

  private async activate(): Promise<void> {
    this.setStatus('loading essentia…');
    try { await this.loadEssentia(); } catch { this.setStatus('error: essentia failed to load'); return; }
    try { await this.connectSource(); } catch (e) { this.setStatus(`error: ${(e as Error).message}`); return; }
    this.active = true;
    this.powerBtn.dataset.active = 'true'; this.podEl.dataset.active = 'true';
    this.startLoop();
    this.setStatus(`on · ${this.activeSource} · ${this.fps}fps`);
    if (this.fileBuffer && !this.melspecData.length) void this.computeVizFeatures();
  }
  private deactivate(): void {
    this.active = false; this.stopLoop(); this.disconnectSource(); this.stopPlayback();
    this.powerBtn.dataset.active = 'false'; this.podEl.dataset.active = 'false';
    this.setStatus('off');
  }
  private async loadEssentia(): Promise<void> {
    if (this.essentia) return;
    const hadExports = typeof (window as any).exports !== 'undefined';
    if (!hadExports) (window as any).exports = {};
    await loadScript('/lib/essentia/essentia-wasm.umd.js');
    if (!hadExports) delete (window as any).exports;
    await loadScript('/lib/essentia/essentia.js-core.umd.js');
    this.essentia = new Essentia(EssentiaWASM);
  }

  private async connectSource(): Promise<void> {
    this.disconnectSource();
    const tap = this.getAudioTap();
    if (!tap) throw new Error('audio context not ready');
    const { context, masterAnalyser } = tap;
    const analyser = context.createAnalyser();
    analyser.fftSize = 4096; analyser.smoothingTimeConstant = 0.5;
    if (this.activeSource === 'master') {
      masterAnalyser.connect(analyser);
    } else if (this.activeSource === 'mic') {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      this.micStream = stream;
      context.createMediaStreamSource(stream).connect(analyser);
    } else if (this.activeSource === 'file') {
      if (!this.fileBuffer) throw new Error('no file loaded');
      const src = context.createBufferSource();
      src.buffer = this.fileBuffer; src.loop = true; src.connect(analyser); src.start();
      this.sourceNode = src;
    }
    this.analyserNode  = analyser;
    this.timeDomainBuf = new Float32Array(analyser.fftSize);
    this.freqBuf       = new Float32Array(analyser.frequencyBinCount);
    this.prevFreqBuf   = new Float32Array(analyser.frequencyBinCount);
  }
  private async reconnectSource(): Promise<void> { this.disconnectSource(); await this.connectSource(); }
  private disconnectSource(): void {
    try { this.analyserNode?.disconnect(); } catch {}
    try { this.sourceNode?.disconnect(); } catch {}
    if (this.sourceNode instanceof AudioBufferSourceNode) { try { this.sourceNode.stop(); } catch {} }
    this.micStream?.getTracks().forEach(t => t.stop());
    this.analyserNode = null; this.sourceNode = null; this.micStream = null;
    this.timeDomainBuf = null; this.freqBuf = null; this.prevFreqBuf = null;
  }
  private startLoop(): void { this.stopLoop(); this.intervalId = setInterval(() => this.tick(), 1000 / this.fps); }
  private stopLoop(): void { if (this.intervalId !== null) { clearInterval(this.intervalId); this.intervalId = null; } }
  private restartLoop(): void { if (this.active) this.startLoop(); }

  // ─── Analysis ────────────────────────────────────────────────────────────────

  private tick(): void {
    if (!this.analyserNode || !this.timeDomainBuf || !this.freqBuf || !this.essentia) return;
    this.analyserNode.getFloatTimeDomainData(this.timeDomainBuf);
    this.analyserNode.getFloatFrequencyData(this.freqBuf);
    this.render(this.analyze());
  }
  private analyze(): SAResults {
    const E = this.essentia, buf = this.timeDomainBuf!, freq = this.freqBuf!;
    const audioVector = E.arrayToVector(buf);
    const rms   = Math.sqrt(buf.reduce((s,v) => s+v*v, 0) / buf.length);
    const rmsDb = rms > 1e-9 ? 20*Math.log10(rms) : -96;
    let pitch = 0;
    try { pitch = E.PitchYin(audioVector).pitch; } catch {}
    const lufsM = rmsDb + 0.3;
    const lufsS = lufsM * 0.7 + this.prevLufsM * 0.3;
    this.prevLufsM = lufsM; this.lufsIAccum += lufsM; this.lufsICount++;
    const lufsI = this.lufsIAccum / this.lufsICount;
    this.lufsHistory.push(lufsM);
    const magBuf = new Float32Array(freq.length);
    for (let i=0;i<freq.length;i++) magBuf[i] = Math.pow(10, freq[i]/20);
    const magVector = E.arrayToVector(magBuf);
    let centroid=0,spread=0,skewness=0,kurtosis=0,slope=0,flux=0,hnr=0,zcr=0;
    let tristimulus:[number,number,number]=[0,0,0];
    let mfcc:number[]=new Array(13).fill(0);
    try { centroid = E.SpectralCentroidTime(audioVector).centroid; } catch {}
    try { const d=E.DistributionShape(E.CentralMoments(magVector).centralMoments); spread=d.spread;skewness=d.skewness;kurtosis=d.kurtosis; } catch {}
    try { slope = E.SpectralSlope(magVector).spectralSlope; } catch {}
    try {
      if (this.prevFreqBuf) {
        const pm = new Float32Array(this.prevFreqBuf.length);
        for (let i=0;i<pm.length;i++) pm[i]=Math.pow(10,this.prevFreqBuf[i]/20);
        flux = E.Flux(magVector, E.arrayToVector(pm)).flux;
      }
      this.prevFreqBuf!.set(freq);
    } catch {}
    try { const t=E.Tristimulus(magVector).tristimulus; tristimulus=[t.get(0),t.get(1),t.get(2)]; } catch {}
    try { const pv=new Float32Array([pitch]); hnr=E.HarmonicPeaks(magVector,E.arrayToVector(pv))?.harmonicMagnitudes?.get(0)??0; } catch {}
    try { const m=E.MFCC(magVector).mfcc; mfcc=Array.from({length:13},(_,i)=>m.get(i)); } catch {}
    try { zcr=E.ZeroCrossingRate(audioVector).zeroCrossingRate; } catch {}
    return {pitch,pitchNote:hzToNote(pitch),rmsDb,lufsM,lufsS,lufsI,zcr,centroid,spread,skewness,kurtosis,slope,flux,tristimulus,hnr,mfcc};
  }
  private render(r: SAResults): void {
    const viewEl = this.viewEls[this.activeView];
    if (!viewEl) return;
    switch (this.activeView) {
      case 'text': {
        const inner = viewEl.querySelector<HTMLElement>('[data-sa-text-inner]');
        if (inner) renderTextView(inner, r);
        drawRadar(this.radarCanvas, r);
        break;
      }
      case 'spectrum': renderSpectrumView(viewEl, this.freqBuf!); break;
      case 'timbre':   renderTimbreView(viewEl, r); break;
      case 'lufs':     this.lufsHistory.render(viewEl, r.lufsM, r.lufsS, r.lufsI); break;
    }
  }

  // ─── Computed viz features ───────────────────────────────────────────────────

  private async computeVizFeatures(): Promise<void> {
    if (!this.fileBuffer || !this.essentia) return;
    const E = this.essentia;
    const data       = this.fileBuffer.getChannelData(0);
    const sampleRate = this.fileBuffer.sampleRate;
    const fftSize    = 1024;
    const hopSize    = 2048; // 2048-step → fewer frames, faster

    this.setStatus('computing features…');
    await tick();

    // Mel spectrogram
    try {
      const frames: number[][] = [];
      for (let i = 0; i + fftSize <= data.length; i += hopSize) {
        const frame = new Float32Array(fftSize);
        frame.set(data.subarray(i, i + fftSize));
        const fv       = E.arrayToVector(frame);
        const windowed = E.Windowing(fv);
        const spectrum = E.Spectrum(windowed.frame);
        const bands    = E.MelBands(spectrum.spectrum);
        const row: number[] = [];
        for (let b = 0; b < bands.bands.size(); b++) row.push(Math.log10(Math.max(1e-10, bands.bands.get(b))));
        frames.push(row);
        if (frames.length % 200 === 0) await tick();
      }
      this.melspecData = frames;
    } catch (e) { console.warn('[sA] mel spec', e); }

    await tick();

    // HPCP chroma (lower resolution — every 4 hops)
    try {
      const frames: number[][] = [];
      for (let i = 0; i + fftSize <= data.length; i += hopSize * 4) {
        const frame = new Float32Array(fftSize);
        frame.set(data.subarray(i, i + fftSize));
        const fv       = E.arrayToVector(frame);
        const windowed = E.Windowing(fv);
        const spectrum = E.Spectrum(windowed.frame);
        const peaks    = E.SpectralPeaks(spectrum.spectrum);
        const hpcp     = E.HPCP(peaks.frequencies, peaks.magnitudes);
        const row: number[] = [];
        for (let b = 0; b < hpcp.hpcp.size(); b++) row.push(hpcp.hpcp.get(b));
        frames.push(row);
        if (frames.length % 100 === 0) await tick();
      }
      this.chromaData = frames;
    } catch (e) { console.warn('[sA] hpcp', e); }

    await tick();

    // Pitch melodia (full signal)
    try {
      const audioVec = E.arrayToVector(data);
      const melodia  = E.PitchMelodia(audioVec);
      this.pitchData = Array.from({ length: melodia.pitch.size() }, (_, i) => melodia.pitch.get(i));
    } catch (e) { console.warn('[sA] pitch melodia', e); }

    this.computedWrap.hidden = false;
    this.renderCurrentHeatmap();
    this.setStatus(`on · ${this.activeSource} · ${this.fps}fps`);
  }

  // ─── Waveform player ─────────────────────────────────────────────────────────

  private computeWaveformPeaks(): void {
    if (!this.fileBuffer) return;
    const data  = this.fileBuffer.getChannelData(0);
    const N     = 800;
    const step  = Math.ceil(data.length / N);
    const inner = Math.max(1, Math.floor(step / 400));
    this.waveformPeaks = [];
    for (let i = 0; i < N; i++) {
      let min = 0, max = 0;
      for (let j = i * step; j < Math.min((i+1)*step, data.length); j += inner) {
        const v = data[j]; if (v < min) min = v; if (v > max) max = v;
      }
      this.waveformPeaks.push({ min, max });
    }
  }

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
    const mid  = cssH / 2;
    const n    = this.waveformPeaks.length;

    ctx.strokeStyle = 'rgba(69,211,132,0.65)';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    for (let i = 0; i < cssW; i++) {
      const { min, max } = this.waveformPeaks[Math.min(n-1, Math.floor((i/cssW)*n))];
      ctx.moveTo(i + 0.5, mid - max * mid);
      ctx.lineTo(i + 0.5, Math.max(mid - min * mid, mid - max * mid + 1));
    }
    ctx.stroke();
    this.waveformCache = off;
  }

  private redrawWaveform(): void {
    if (!this.waveformCanvas || !this.waveformCache || !this.fileBuffer) return;
    const canvas = this.waveformCanvas;
    const dpr    = window.devicePixelRatio || 1;
    const cssW   = canvas.width / dpr;
    const cssH   = canvas.height / dpr;
    const ctx    = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(this.waveformCache, 0, 0);

    const pos = this.getCurrentPosition();
    const x   = (pos / this.fileBuffer.duration) * canvas.width;

    // Played region tint
    ctx.fillStyle = 'rgba(69,211,132,0.07)';
    ctx.fillRect(0, 0, x, canvas.height);

    // Playhead line
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth   = 1;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();

    // Time label
    const secs = pos | 0;
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font      = `${10 * dpr}px monospace`;
    ctx.fillText(`${String(secs/60|0).padStart(2,'0')}:${String(secs%60).padStart(2,'0')}`, 4*dpr, 12*dpr);
  }

  private bindWaveformInteraction(): void {
    const canvas = this.waveformCanvas;
    const pos = (e: PointerEvent) => {
      if (!this.fileBuffer) return 0;
      const r = canvas.getBoundingClientRect();
      return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * this.fileBuffer.duration;
    };
    canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault(); canvas.setPointerCapture(e.pointerId);
      this.isDragging = true;
      const p = pos(e); this.playOffset = p;
      if (this.isPlaying) this.startPlayback(p);
      this.startPlayheadAnim();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.isDragging) return;
      const p = pos(e);
      if (this.isPlaying) this.startPlayback(p); else { this.playOffset = p; this.redrawWaveform(); }
    });
    canvas.addEventListener('pointerup', (e) => {
      this.isDragging = false; canvas.releasePointerCapture(e.pointerId);
      if (!this.isPlaying) this.stopPlayheadAnim();
    });
  }

  // Playback
  private togglePlayback(): void { if (this.isPlaying) this.pausePlayback(); else this.startPlayback(); }
  private startPlayback(offset = this.playOffset): void {
    this.stopPlayback();
    if (!this.fileBuffer) return;
    const tap = this.getAudioTap();
    const ctx = tap?.context ?? new AudioContext();
    const src = ctx.createBufferSource();
    src.buffer  = this.fileBuffer;
    src.connect(ctx.destination);
    this.playOffset   = Math.max(0, Math.min(offset, this.fileBuffer.duration - 0.01));
    this.playStartTime = ctx.currentTime;
    src.start(0, this.playOffset);
    src.onended = () => { if (this.isPlaying) { this.isPlaying=false; this.playOffset=0; this.updatePlayBtn(); this.redrawWaveform(); } };
    this.playbackNode = src; this.isPlaying = true;
    this.updatePlayBtn(); this.startPlayheadAnim();
  }
  private pausePlayback(): void {
    if (this.playbackNode) {
      try { this.playbackNode.stop(); } catch {}
      try { this.playbackNode.disconnect(); } catch {}
      this.playbackNode = null;
    }
    if (this.isPlaying) { this.playOffset = this.getCurrentPosition(); this.isPlaying = false; }
    this.updatePlayBtn(); this.stopPlayheadAnim();
  }
  private stopPlayback(): void { this.pausePlayback(); }
  private getCurrentPosition(): number {
    if (!this.fileBuffer || !this.isPlaying) return this.playOffset;
    const tap = this.getAudioTap();
    if (!tap) return this.playOffset;
    return Math.min(this.playOffset + (tap.context.currentTime - this.playStartTime), this.fileBuffer.duration);
  }
  private updatePlayBtn(): void { this.playBtn.textContent = this.isPlaying ? '⏸' : '▶'; }
  private startPlayheadAnim(): void {
    if (this.rafId !== null) return;
    const tick = () => { this.redrawWaveform(); this.rafId = (this.isPlaying || this.isDragging) ? requestAnimationFrame(tick) : null; };
    this.rafId = requestAnimationFrame(tick);
  }
  private stopPlayheadAnim(): void { if (this.rafId!==null) { cancelAnimationFrame(this.rafId); this.rafId=null; } }

  // ─── Misc ────────────────────────────────────────────────────────────────────

  private setStatus(msg: string): void { if (this.statusTextEl) this.statusTextEl.textContent = msg; }

  public addParticipantSource(id: string, label: string): void {
    if (!this.sourceSelect || this.sourceSelect.querySelector(`option[value="participant:${id}"]`)) return;
    const opt = document.createElement('option'); opt.value=`participant:${id}`; opt.textContent=`ptcp:${label}`;
    this.sourceSelect.appendChild(opt);
  }
  public removeParticipantSource(id: string): void { this.sourceSelect?.querySelector(`option[value="participant:${id}"]`)?.remove(); }
  public dispose(): void { this.deactivate(); }
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script'); s.src = src;
    s.onload = () => resolve(); s.onerror = () => reject(new Error(`Failed to load: ${src}`));
    document.head.appendChild(s);
  });
}

function tick(): Promise<void> { return new Promise(r => setTimeout(r, 0)); }
