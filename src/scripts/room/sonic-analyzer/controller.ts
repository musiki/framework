import { renderTextView, hzToNote } from './views/text-view';
import type { SAResults } from './views/text-view';
import { renderSpectrumView } from './views/spectrum-view';
import { renderTimbreView } from './views/timbre-view';
import { LufsHistory } from './views/lufs-view';
import { drawRadar } from './views/radar-view';
import type { ConferenceMessage } from '../session';

type AudioTapFn = () => { context: AudioContext; masterAnalyser: AnalyserNode } | null;
export type SonicAnalyzerOptions = {
  container: HTMLElement;
  getAudioTap: AudioTapFn;
  publish?: (msg: ConferenceMessage) => void;
  getSenderName?: () => string;
};

declare const EssentiaWASM: any;
declare const Essentia: any;

const ACCEPTED_TYPES = ['audio/wav','audio/ogg','audio/mpeg','audio/mp3','audio/wave','audio/x-wav'];
const ACCEPTED_EXTS  = ['.wav','.ogg','.mp3'];

export type SAFilePayload = {
  buffer: AudioBuffer;
  fileName: string;
  peaks: { min: number; max: number }[];
  melspec: number[][];
  chroma: number[][];
  pitches: number[];
  key: string;
  scale: string;
  bpm: number;
};

export class SonicAnalyzerController {
  private container: HTMLElement;
  private getAudioTap: AudioTapFn;

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
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private fps = 10;
  private activeSource = 'master';
  private lufsHistory = new LufsHistory();
  private prevLufsM = -70;
  private lufsIAccum = 0;
  private lufsICount = 0;

  private fileKey = '';
  private fileScale = '';
  private fileBpm = 0;
  private lastFilePayload: SAFilePayload | null = null;
  private publish?: (msg: ConferenceMessage) => void;
  private getSenderName: () => string = () => '';

  // DOM refs
  private podEl!: HTMLElement;
  private powerBtn!: HTMLElement;
  private statusTextEl!: HTMLElement;
  private fileNameEl!: HTMLElement;
  private saveBtnEl!: HTMLButtonElement;
  private sourceSelect!: HTMLSelectElement;
  private fpsSlider!: HTMLInputElement;
  private fpsLabel!: HTMLElement;
  private textInner!: HTMLElement;
  private spectrumInner!: HTMLElement;
  private timbreInner!: HTMLElement;
  private lufsInner!: HTMLElement;
  private radarCanvas!: HTMLCanvasElement;

  private onSVRequest: () => void;
  private onLoadUrl: (e: Event) => void;

  constructor(options: SonicAnalyzerOptions) {
    this.container = options.container;
    this.getAudioTap = options.getAudioTap;
    this.publish = options.publish;
    this.getSenderName = options.getSenderName ?? (() => '');
    this.bindDOM();
    this.bindDropzone();
    this.onSVRequest = () => this.emitCurrentState();
    window.addEventListener('sv:request-state', this.onSVRequest);
    this.onLoadUrl = (e: Event) => {
      const { url, name } = (e as CustomEvent<{ url: string; name: string }>).detail;
      void this.loadFileFromUrl(url, name);
    };
    window.addEventListener('musiki:sa:load-url', this.onLoadUrl);
  }

  private emitCurrentState(): void {
    window.dispatchEvent(new CustomEvent('sa:active', { detail: { active: this.active } }));
    if (this.lastFilePayload) {
      window.dispatchEvent(new CustomEvent('sa:file-ready', { detail: this.lastFilePayload }));
    }
  }

  private bindDOM(): void {
    const q = <T extends HTMLElement>(sel: string) => this.container.querySelector<T>(sel);
    this.podEl         = q('.sa-pod')!;
    this.powerBtn      = q('[data-sa-power]')!;
    this.statusTextEl  = q('[data-sa-status-text]')!;
    this.fileNameEl    = q('[data-sa-file-name]')!;
    this.saveBtnEl     = q<HTMLButtonElement>('[data-sa-save]')!;
    this.saveBtnEl.addEventListener('click', () => void this.handleSave());
    this.sourceSelect  = q<HTMLSelectElement>('[data-sa-source]')!;
    this.fpsSlider     = q<HTMLInputElement>('[data-sa-fps]')!;
    this.fpsLabel      = q('[data-sa-fps-label]')!;
    this.textInner     = q('[data-sa-text-inner]')!;
    this.spectrumInner = q('[data-sa-spectrum-inner]')!;
    this.timbreInner   = q('[data-sa-timbre-inner]')!;
    this.lufsInner     = q('[data-sa-lufs-inner]')!;
    this.radarCanvas   = q<HTMLCanvasElement>('[data-sa-radar]')!;

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
      if (this.essentia) void this.computeVizFeatures();
      else this.setStatus(`file ready · ${file.name}`);
      if (this.publish) void this.handleSave();
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
  private async handleSave(): Promise<void> {
    if (!this.fileBuffer || !this.loadedFileName) return;
    this.setStatus('uploading…');
    try {
      const blob = await audioBufferToWav(this.fileBuffer);
      const formData = new FormData();
      formData.append('file', new File([blob], this.loadedFileName, { type: 'audio/wav' }));
      const res = await fetch('/api/room/sa-upload', { method: 'POST', body: formData });
      const text = await res.text();
      let data: any = {};
      try { data = JSON.parse(text); } catch { /* non-JSON response */ }
      if (!res.ok || !data.url) {
        console.error('[sA] upload failed', res.status, text);
        throw new Error(data.error || `HTTP ${res.status}`);
      }
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
      window.dispatchEvent(new CustomEvent('musiki:recursos:sa-uploaded', {
        detail: { url: data.url, name: this.loadedFileName?.replace(/\.[^.]+$/, '') ?? '' },
      }));
    } catch (e: any) {
      console.error('[sA] upload error', e);
      const msg = e instanceof Error ? e.message : String(e);
      this.setStatus(`upload error: ${msg.slice(0, 60)}`);
    }
  }

  // ─── Activation ──────────────────────────────────────────────────────────────

  async toggle(): Promise<void> { if (this.active) this.deactivate(); else await this.activate(); }

  private async activate(): Promise<void> {
    this.setStatus('loading essentia…');
    try { await this.loadEssentia(); } catch { this.setStatus('error: essentia failed to load'); return; }
    this.active = true;
    this.powerBtn.dataset.active = 'true'; this.podEl.dataset.active = 'true';
    window.dispatchEvent(new CustomEvent('sa:active', { detail: { active: true } }));
    this.publish?.({ type: 'sa-state', active: true });
    await this.tryConnectAndStart();
  }
  private async tryConnectAndStart(): Promise<void> {
    if (!this.active) return;
    try {
      await this.connectSource();
      this.startLoop();
      this.setStatus(`on · ${this.activeSource} · ${this.fps}fps`);
      if (this.fileBuffer && !this.lastFilePayload) void this.computeVizFeatures();
      else if (this.lastFilePayload) window.dispatchEvent(new CustomEvent('sa:file-ready', { detail: this.lastFilePayload }));
    } catch (e) {
      const msg = (e as Error).message;
      if (this.active && msg === 'audio context not ready') {
        this.setStatus('waiting for audio…');
        this.reconnectTimer = setTimeout(() => void this.tryConnectAndStart(), 2000);
      } else {
        this.setStatus(`error: ${msg}`);
      }
    }
  }
  private deactivate(): void {
    if (this.reconnectTimer !== null) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    this.active = false; this.stopLoop(); this.disconnectSource();
    this.powerBtn.dataset.active = 'false'; this.podEl.dataset.active = 'false';
    this.setStatus('off');
    window.dispatchEvent(new CustomEvent('sa:active', { detail: { active: false } }));
    this.publish?.({ type: 'sa-state', active: false });
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
      if (context.state !== 'running') await context.resume().catch(() => {});
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
    const r = this.analyze();
    this.render(r);
    window.dispatchEvent(new CustomEvent('sa:frame', { detail: { results: r, freqBuf: this.freqBuf } }));
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
    renderTextView(this.textInner, r);
    if (this.fileKey || this.fileBpm > 0) {
      const keyStr = this.fileKey ? `${this.fileKey} ${this.fileScale}` : '---';
      const bpmStr = this.fileBpm > 0 ? this.fileBpm.toFixed(1) : '---';
      this.textInner.innerHTML +=
        '\n<span class="sa-dim">─────────────────────────</span>' +
        `\n<span class="sa-key">key      </span><span class="sa-dim">·</span> <span class="sa-ok">${keyStr.padStart(8)}</span>` +
        `\n<span class="sa-key">bpm      </span><span class="sa-dim">·</span> <span class="sa-ok">${bpmStr.padStart(8)}</span>`;
    }
    renderSpectrumView(this.spectrumInner, this.freqBuf!);
    renderTimbreView(this.timbreInner, r);
    this.lufsHistory.render(this.lufsInner, r.lufsM, r.lufsS, r.lufsI);
    drawRadar(this.radarCanvas, r);
  }

  // ─── Computed viz features (dispatched to SV) ────────────────────────────────

  private async computeVizFeatures(): Promise<void> {
    if (!this.fileBuffer || !this.essentia) return;
    const E = this.essentia;
    const data    = this.fileBuffer.getChannelData(0);
    const fftSize = 1024;
    const hopSize = 2048;

    this.setStatus('computing features…');
    await tick();

    const peaks = computeWaveformPeaks(this.fileBuffer);

    const melspec: number[][] = [];
    try {
      for (let i = 0; i + fftSize <= data.length; i += hopSize) {
        const frame = new Float32Array(fftSize);
        frame.set(data.subarray(i, i + fftSize));
        const fv       = E.arrayToVector(frame);
        const windowed = E.Windowing(fv);
        const spectrum = E.Spectrum(windowed.frame);
        const bands    = E.MelBands(spectrum.spectrum);
        const row: number[] = [];
        for (let b = 0; b < bands.bands.size(); b++) row.push(Math.log10(Math.max(1e-10, bands.bands.get(b))));
        melspec.push(row);
        if (melspec.length % 200 === 0) await tick();
      }
    } catch (e) { console.warn('[sA] mel', e); }
    await tick();

    const chroma: number[][] = [];
    try {
      for (let i = 0; i + fftSize <= data.length; i += hopSize * 4) {
        const frame = new Float32Array(fftSize);
        frame.set(data.subarray(i, i + fftSize));
        const fv            = E.arrayToVector(frame);
        const windowed      = E.Windowing(fv);
        const spectrum      = E.Spectrum(windowed.frame);
        const spectralPeaks = E.SpectralPeaks(spectrum.spectrum);
        const hpcp          = E.HPCP(spectralPeaks.frequencies, spectralPeaks.magnitudes);
        const row: number[] = [];
        for (let b = 0; b < hpcp.hpcp.size(); b++) row.push(hpcp.hpcp.get(b));
        chroma.push(row);
        if (chroma.length % 100 === 0) await tick();
      }
    } catch (e) { console.warn('[sA] hpcp', e); }
    await tick();

    let pitches: number[] = [];
    try {
      const audioVec = E.arrayToVector(data);
      const melodia  = E.PitchMelodia(audioVec);
      pitches = Array.from({ length: melodia.pitch.size() }, (_, i) => melodia.pitch.get(i));
    } catch (e) { console.warn('[sA] pitch', e); }
    await tick();

    let key = '', scale = '';
    try {
      if (chroma.length) {
        const bins = chroma[0].length;
        const avg = new Float32Array(bins);
        for (const frame of chroma) for (let b = 0; b < bins; b++) avg[b] += frame[b];
        for (let b = 0; b < bins; b++) avg[b] /= chroma.length;
        const kr = E.Key(E.arrayToVector(avg));
        key = kr.key ?? ''; scale = kr.scale ?? '';
      }
    } catch (e) { console.warn('[sA] key', e); }
    await tick();

    let bpm = 0;
    try {
      const audioVec = E.arrayToVector(data);
      const rhythm   = E.RhythmExtractor2013(audioVec);
      bpm = Math.round((rhythm.bpm ?? 0) * 10) / 10;
    } catch (e) { console.warn('[sA] bpm', e); }

    this.fileKey = key; this.fileScale = scale; this.fileBpm = bpm;

    const payload: SAFilePayload = { buffer: this.fileBuffer, fileName: this.loadedFileName, peaks, melspec, chroma, pitches, key, scale, bpm };
    this.lastFilePayload = payload;
    window.dispatchEvent(new CustomEvent('sa:file-ready', { detail: payload }));
    this.setStatus(`on · ${this.activeSource} · ${this.fps}fps`);
  }

  // ─── Misc ────────────────────────────────────────────────────────────────────

  private setStatus(msg: string): void { if (this.statusTextEl) this.statusTextEl.textContent = msg; }

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

  public get isActive(): boolean { return this.active; }

  public applyRemoteState(active: boolean): void {
    this.setStatus(active ? 'remote · on' : 'remote · off');
  }

  public addParticipantSource(id: string, label: string): void {
    if (!this.sourceSelect || this.sourceSelect.querySelector(`option[value="participant:${id}"]`)) return;
    const opt = document.createElement('option'); opt.value=`participant:${id}`; opt.textContent=`ptcp:${label}`;
    this.sourceSelect.appendChild(opt);
  }
  public removeParticipantSource(id: string): void { this.sourceSelect?.querySelector(`option[value="participant:${id}"]`)?.remove(); }
  public async loadFileFromUrl(url: string, name: string): Promise<void> {
    this.setStatus(`loading ${name}…`);
    try {
      const fetchUrl = url.startsWith('http') && !url.startsWith(location.origin)
        ? `/api/room/audio-proxy?url=${encodeURIComponent(url)}`
        : url;
      const resp = await fetch(fetchUrl);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const ctx = this.getAudioTap()?.context ?? new AudioContext();
      this.fileBuffer = await ctx.decodeAudioData(await resp.arrayBuffer());
      this.loadedFileName = name;
      this.addFileOption(name);
      this.showFileMeta(name);
      if (this.active) { this.sourceSelect.value = 'file'; this.activeSource = 'file'; void this.reconnectSource(); }
      if (this.essentia) void this.computeVizFeatures();
      else this.setStatus(`file ready · ${name}`);
    } catch (e: any) {
      this.setStatus(`error: ${(e?.message ?? 'could not load').slice(0, 60)}`);
    }
  }

  public dispose(): void {
    this.deactivate();
    window.removeEventListener('sv:request-state', this.onSVRequest);
    window.removeEventListener('musiki:sa:load-url', this.onLoadUrl);
  }
}

export function computeWaveformPeaks(buffer: AudioBuffer): { min: number; max: number }[] {
  const data  = buffer.getChannelData(0);
  const N     = 800;
  const step  = Math.ceil(data.length / N);
  const inner = Math.max(1, Math.floor(step / 400));
  const peaks: { min: number; max: number }[] = [];
  for (let i = 0; i < N; i++) {
    let min = 0, max = 0;
    for (let j = i * step; j < Math.min((i+1)*step, data.length); j += inner) {
      const v = data[j]; if (v < min) min = v; if (v > max) max = v;
    }
    peaks.push({ min, max });
  }
  return peaks;
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

function audioBufferToWav(buffer: AudioBuffer): Promise<Blob> {
  const sampleRate = buffer.sampleRate;
  const data = buffer.getChannelData(0);
  const dataLen = data.length * 2;
  const ab = new ArrayBuffer(44 + dataLen);
  const view = new DataView(ab);
  const w = (off: number, val: number, bytes: number) => {
    if (bytes === 4) view.setUint32(off, val, true);
    else if (bytes === 2) view.setUint16(off, val, true);
  };
  const ws = (off: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  ws(0, 'RIFF'); w(4, 36 + dataLen, 4); ws(8, 'WAVE');
  ws(12, 'fmt '); w(16, 16, 4); w(20, 1, 2); w(22, 1, 2);
  w(24, sampleRate, 4); w(28, sampleRate * 2, 4); w(32, 2, 2); w(34, 16, 2);
  ws(36, 'data'); w(40, dataLen, 4);
  const samples = new Int16Array(ab, 44);
  for (let i = 0; i < data.length; i++) samples[i] = Math.max(-32768, Math.min(32767, data[i] * 32767));
  return Promise.resolve(new Blob([ab], { type: 'audio/wav' }));
}
