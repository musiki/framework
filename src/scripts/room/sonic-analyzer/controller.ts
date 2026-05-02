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

const ACCEPTED_TYPES = ['audio/wav', 'audio/ogg', 'audio/mpeg', 'audio/mp3', 'audio/wave', 'audio/x-wav'];
const ACCEPTED_EXTS = ['.wav', '.ogg', '.mp3'];

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
  private fps = 10;
  private activeView = 'text';
  private activeSource = 'master';

  private lufsHistory = new LufsHistory();
  private prevLufsM = -70;
  private lufsIAccum = 0;
  private lufsICount = 0;

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

    this.podEl        = q('.sa-pod')!;
    this.powerBtn     = q('[data-sa-power]')!;
    this.statusTextEl = q('[data-sa-status-text]')!;
    this.fileNameEl   = q('[data-sa-file-name]')!;
    this.saveBtnEl    = q<HTMLButtonElement>('[data-sa-save]')!;
    this.sourceSelect = q<HTMLSelectElement>('[data-sa-source]')!;
    this.fpsSlider    = q<HTMLInputElement>('[data-sa-fps]')!;
    this.fpsLabel     = q('[data-sa-fps-label]')!;

    for (const view of ['text', 'spectrum', 'timbre', 'lufs']) {
      const el = q<HTMLElement>(`[data-sa-view="${view}"]`);
      if (el) this.viewEls[view] = el;
    }

    this.tabBtns = Array.from(this.container.querySelectorAll<HTMLButtonElement>('[data-sa-tab]'));

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

    this.tabBtns.forEach(btn => {
      btn.addEventListener('click', () => this.switchView(btn.dataset.saTab!));
    });
  }

  private bindDropzone(): void {
    const pod = this.podEl;

    pod.addEventListener('dragover', (e) => {
      if (!this.hasDraggingAudio(e)) return;
      e.preventDefault();
      e.dataTransfer!.dropEffect = 'copy';
      pod.classList.add('sa-pod--drag-over');
    });

    pod.addEventListener('dragleave', (e) => {
      if (!pod.contains(e.relatedTarget as Node)) {
        pod.classList.remove('sa-pod--drag-over');
      }
    });

    pod.addEventListener('drop', (e) => {
      e.preventDefault();
      pod.classList.remove('sa-pod--drag-over');
      const file = this.extractAudioFile(e.dataTransfer);
      if (file) void this.loadFile(file);
    });
  }

  private hasDraggingAudio(e: DragEvent): boolean {
    if (!e.dataTransfer) return false;
    for (const item of Array.from(e.dataTransfer.items)) {
      if (item.kind === 'file') {
        if (ACCEPTED_TYPES.includes(item.type)) return true;
        // type may be empty — accept anyway, we'll validate on drop
        if (item.type === '') return true;
      }
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

  private async loadFile(file: File): Promise<void> {
    this.setStatus(`decoding ${file.name}…`);
    try {
      const tap = this.getAudioTap();
      const ctx = tap?.context ?? new AudioContext();
      const arrayBuffer = await file.arrayBuffer();
      this.fileBuffer = await ctx.decodeAudioData(arrayBuffer);
      this.loadedFileName = file.name;
      this.addFileOption(file.name);
      this.setStatus(`file ready · ${file.name}`);
      this.showFileMeta(file.name);
      if (this.active) {
        this.sourceSelect.value = 'file';
        this.activeSource = 'file';
        void this.reconnectSource();
      }
    } catch {
      this.setStatus('error: could not decode file');
    }
  }

  private addFileOption(name: string): void {
    let opt = this.sourceSelect.querySelector<HTMLOptionElement>('option[value="file"]');
    if (!opt) {
      opt = document.createElement('option');
      opt.value = 'file';
      this.sourceSelect.appendChild(opt);
    }
    const short = name.length > 16 ? name.slice(0, 14) + '…' : name;
    opt.textContent = `file:${short}`;
    this.sourceSelect.value = 'file';
    this.activeSource = 'file';
  }

  private showFileMeta(name: string): void {
    this.fileNameEl.textContent = name;
    this.fileNameEl.hidden = false;
    this.saveBtnEl.hidden = false;
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
    if (this.active) this.deactivate();
    else await this.activate();
  }

  private async activate(): Promise<void> {
    this.setStatus('loading essentia…');
    try {
      await this.loadEssentia();
    } catch {
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
    this.podEl.dataset.active = 'true';
    this.startLoop();
    this.setStatus(`on · ${this.activeSource} · ${this.fps}fps`);
  }

  private deactivate(): void {
    this.active = false;
    this.stopLoop();
    this.disconnectSource();
    this.powerBtn.dataset.active = 'false';
    this.podEl.dataset.active = 'false';
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

    const tap = this.getAudioTap();
    if (!tap) throw new Error('audio context not ready');
    const { context, masterAnalyser } = tap;

    const analyser = context.createAnalyser();
    analyser.fftSize = 4096;
    analyser.smoothingTimeConstant = 0.5;

    if (this.activeSource === 'master') {
      masterAnalyser.connect(analyser);

    } else if (this.activeSource === 'mic') {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      this.micStream = stream;
      const src = context.createMediaStreamSource(stream);
      src.connect(analyser);
      this.sourceNode = src;

    } else if (this.activeSource === 'file') {
      if (!this.fileBuffer) throw new Error('no file loaded');
      const src = context.createBufferSource();
      src.buffer = this.fileBuffer;
      src.loop = true;
      src.connect(analyser);
      src.start();
      this.sourceNode = src;

    } else if (this.activeSource.startsWith('participant:')) {
      // participant streams are attached externally via addParticipantSource
      throw new Error('participant source not yet connected');
    }

    this.analyserNode = analyser;
    this.timeDomainBuf = new Float32Array(analyser.fftSize);
    this.freqBuf       = new Float32Array(analyser.frequencyBinCount);
    this.prevFreqBuf   = new Float32Array(analyser.frequencyBinCount);
  }

  private async reconnectSource(): Promise<void> {
    this.disconnectSource();
    await this.connectSource();
  }

  private disconnectSource(): void {
    try { this.analyserNode?.disconnect(); } catch {}
    try { this.sourceNode?.disconnect(); } catch {}
    if (this.sourceNode instanceof AudioBufferSourceNode) {
      try { this.sourceNode.stop(); } catch {}
    }
    this.micStream?.getTracks().forEach(t => t.stop());
    this.analyserNode = null;
    this.sourceNode   = null;
    this.micStream    = null;
    this.timeDomainBuf = null;
    this.freqBuf       = null;
    this.prevFreqBuf   = null;
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
    const E   = this.essentia;
    const buf  = this.timeDomainBuf!;
    const freq = this.freqBuf!;
    const audioVector = E.arrayToVector(buf);

    // RMS → dBFS
    const rms   = Math.sqrt(buf.reduce((s, v) => s + v * v, 0) / buf.length);
    const rmsDb = rms > 1e-9 ? 20 * Math.log10(rms) : -96;

    // Pitch
    let pitch = 0;
    try { pitch = E.PitchYin(audioVector).pitch; } catch {}

    // LUFS (momentary ≈ RMS + K-weight offset)
    const lufsM = rmsDb + 0.3;
    const lufsS = lufsM * 0.7 + this.prevLufsM * 0.3;
    this.prevLufsM = lufsM;
    this.lufsIAccum += lufsM;
    this.lufsICount += 1;
    const lufsI = this.lufsIAccum / this.lufsICount;
    this.lufsHistory.push(lufsM);

    // Spectral — convert dBFS → linear magnitudes
    const magBuf    = Float32Array.from(freq, db => Math.pow(10, db / 20));
    const magVector = E.arrayToVector(magBuf);

    let centroid = 0, spread = 0, skewness = 0, kurtosis = 0, slope = 0, flux = 0;
    let tristimulus: [number, number, number] = [0, 0, 0];
    let hnr = 0;
    let mfcc: number[] = new Array(13).fill(0);
    let zcr = 0;

    try { centroid = E.SpectralCentroidTime(audioVector).centroid; } catch {}

    try {
      const desc = E.DistributionShape(E.CentralMoments(magVector).centralMoments);
      spread   = desc.spread;
      skewness = desc.skewness;
      kurtosis = desc.kurtosis;
    } catch {}

    try { slope = E.SpectralSlope(magVector).spectralSlope; } catch {}

    try {
      if (this.prevFreqBuf) {
        const prevMag = new Float32Array(this.prevFreqBuf.length);
        for (let i = 0; i < prevMag.length; i++) prevMag[i] = Math.pow(10, this.prevFreqBuf[i] / 20);
        flux = E.Flux(magVector, E.arrayToVector(prevMag)).flux;
      }
      this.prevFreqBuf!.set(freq);
    } catch {}

    try {
      const t = E.Tristimulus(magVector).tristimulus;
      tristimulus = [t.get(0), t.get(1), t.get(2)];
    } catch {}

    try {
      const pitchVec = new Float32Array([pitch]);
      const hp = E.HarmonicPeaks(magVector, E.arrayToVector(pitchVec));
      hnr = hp?.harmonicMagnitudes?.get(0) ?? 0;
    } catch {}

    try {
      const m = E.MFCC(magVector).mfcc;
      mfcc = Array.from({ length: 13 }, (_, i) => m.get(i));
    } catch {}

    try { zcr = E.ZeroCrossingRate(audioVector).zeroCrossingRate; } catch {}

    return { pitch, pitchNote: hzToNote(pitch), rmsDb, lufsM, lufsS, lufsI,
             zcr, centroid, spread, skewness, kurtosis, slope, flux,
             tristimulus, hnr, mfcc };
  }

  private render(results: SAResults): void {
    const viewEl = this.viewEls[this.activeView];
    if (!viewEl) return;
    switch (this.activeView) {
      case 'text':     renderTextView(viewEl, results); break;
      case 'spectrum': renderSpectrumView(viewEl, this.freqBuf!); break;
      case 'timbre':   renderTimbreView(viewEl, results); break;
      case 'lufs':     this.lufsHistory.render(viewEl, results.lufsM, results.lufsS, results.lufsI); break;
    }
  }

  private setStatus(msg: string): void {
    if (this.statusTextEl) this.statusTextEl.textContent = msg;
  }

  public addParticipantSource(id: string, label: string): void {
    if (!this.sourceSelect) return;
    if (!this.sourceSelect.querySelector(`option[value="participant:${id}"]`)) {
      const opt = document.createElement('option');
      opt.value = `participant:${id}`;
      opt.textContent = `ptcp:${label}`;
      this.sourceSelect.appendChild(opt);
    }
  }

  public removeParticipantSource(id: string): void {
    this.sourceSelect?.querySelector(`option[value="participant:${id}"]`)?.remove();
  }

  public dispose(): void {
    this.deactivate();
  }
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load: ${src}`));
    document.head.appendChild(s);
  });
}
