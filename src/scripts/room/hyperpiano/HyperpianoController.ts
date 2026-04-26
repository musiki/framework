import { createImpulseResponseBuffer } from '../core/helpers';

export type HyperpianoOptions = {
  audioContext: AudioContext;
  container: HTMLElement;
  outputNode: AudioNode;
  onStatusChange?: (status: string) => void;
  onNoteEvent?: (note: number, velocity: number, action: 'on' | 'off') => void;
  getMidiInputId: () => string | null;
};

export class HyperpianoController {
  private audioContext: AudioContext;
  private container: HTMLElement;
  private outputNode: AudioNode;
  private onStatusChange?: (status: string) => void;
  private onNoteEvent?: (note: number, velocity: number, action: 'on' | 'off') => void;
  private getMidiInputId: () => string | null;

  private roots: any[] = [];
  private activeNotes = new Map<number, any>();
  private masterOut: GainNode;
  private analyserNode: AnalyserNode;
  private dryGain: GainNode;
  private wetGain: GainNode;
  private reverbNode: ConvolverNode;
  private wetDryRatio = 0.3;
  private currentOctave = 4;
  private temporaryOctaveShift = 0;
  private sustainedOctaveOffset = 0;
  private activeKeys: Record<string, any> = {};
  private rafId: number | null = null;
  private midiAccess: MIDIAccess | null = null;
  private currentMidiInput: MIDIInput | null = null;
  private isMulticolor = false;
  private octaveColors: string[] = [];
  private isFocused = false;

  private SAMPLE_FILES = ['C1.mp3', 'C2.mp3', 'C3.mp3', 'C4.mp3', 'C5.mp3', 'C6.mp3', 'C7.mp3', 'C8.mp3'];
  private BASE_PATH = '/inc/samples-piano/';
  private NEON_PALETTE = ['#39FF14', '#FF1493', '#14E7FF', '#FF6600', '#FFFF00', '#9D00FF', '#FF0000', '#00FF7F', '#FF4500', '#DA70D6', '#00BFFF', '#ADFF2F'];
  private NOTE_INDEX: Record<string, number> = { 'C':0,'C#':1,'Db':1,'D':2,'D#':3,'Eb':3,'E':4,'Fb':4,'E#':5,'F':5,'F#':6,'Gb':6,'G':7,'G#':8,'Ab':8,'A':9,'A#':10,'Bb':10,'B':11,'Cb':11,'B#':0 };
  private NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

  private keyToNote: Record<string, [number, number]> = {
    // Octave 0 Chromatic (zsxdcvgbhnjm)
    'z': [0, 0], 's': [0, 1], 'x': [0, 2], 'd': [0, 3], 'c': [0, 4], 'v': [0, 5], 
    'g': [0, 6], 'b': [0, 7], 'h': [0, 8], 'n': [0, 9], 'j': [0, 10], 'm': [0, 11],
    // Octave 1 Chromatic (q2w3er5t6y7u)
    'q': [1, 0], '2': [1, 1], 'w': [1, 2], '3': [1, 3], 'e': [1, 4], 'r': [1, 5], 
    '5': [1, 6], 't': [1, 7], '6': [1, 8], 'y': [1, 9], '7': [1, 10], 'u': [1, 11],
    // Octave 2 + half (i9o0p[ - ] = )
    'i': [2, 0], '9': [2, 1], 'o': [2, 2], '0': [2, 3], 'p': [2, 4], '[': [2, 5], 
    '-': [2, 6], ']': [2, 7], '=': [2, 8],
  };

  private resizeObserver: ResizeObserver;

  constructor(options: HyperpianoOptions) {
    this.audioContext = options.audioContext;
    this.container = options.container;
    this.outputNode = options.outputNode;
    this.onStatusChange = options.onStatusChange;
    this.onNoteEvent = options.onNoteEvent;
    this.getMidiInputId = options.getMidiInputId;

    this.masterOut = this.audioContext.createGain();
    this.analyserNode = this.audioContext.createAnalyser();
    this.analyserNode.fftSize = 256;
    this.analyserNode.smoothingTimeConstant = 0.6;
    this.masterOut.connect(this.analyserNode);
    this.masterOut.connect(this.outputNode);

    this.dryGain = this.audioContext.createGain();
    this.wetGain = this.audioContext.createGain();
    this.reverbNode = this.audioContext.createConvolver();
    
    this.dryGain.connect(this.masterOut);
    this.wetGain.connect(this.masterOut);
    this.reverbNode.connect(this.wetGain);

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
  }

  public async init() {
    this.updateReverbMix();
    this.assignRandomColors();
    
    await this.loadRoots();
    
    this.reverbNode.buffer = createImpulseResponseBuffer(this.audioContext, 2.5, 2.8);
    
    this.handleResize();
    this.drawVuMeter();
    this.setupPointerEvents();
    this.setupMIDI();
    this.resizeObserver.observe(this.container);
    this.bindKeyboard();

    this.setStatus(this.roots.length ? '' : 'No samples loaded.');
  }

  private handleResize() {
    const width = this.container.offsetWidth;
    const lower = this.container.querySelector('#lower-octave') as HTMLElement;
    const upper = this.container.querySelector('#upper-octave') as HTMLElement;

    if (width < 500) {
      if (lower) lower.style.display = 'block';
      this.buildPiano(lower, [0]);
      this.buildPiano(upper, [1]);
    } else {
      if (lower) lower.style.display = 'none';
      // 5 octaves to make keys narrower and fill full width
      this.buildPiano(upper, [-1, 0, 1, 2, 3]);
    }
  }

  private setStatus(s: string) {
    if (this.onStatusChange) this.onStatusChange(s);
    const el = this.container.querySelector('#status');
    if (el) el.textContent = s;
  }

  private assignRandomColors() {
    let shuffled = [...this.NEON_PALETTE];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    this.octaveColors = shuffled;
  }

  private async loadRoots() {
    const loads = this.SAMPLE_FILES.map(async (file) => {
      try {
        const res = await fetch(this.BASE_PATH + file);
        if (!res.ok) return;
        const arr = await res.arrayBuffer();
        const buf = await this.audioContext.decodeAudioData(arr);
        const m = /([A-G](?:#|b)?-?\d+)/.exec(file);
        if (!m) return;
        const midi = this.midiFromName(m[1]);
        if (midi == null) return;
        this.roots.push({ name: m[1], midi, buffer: buf });
      } catch (e) { console.warn('Error loading', file, e); }
    });
    await Promise.all(loads);
    this.roots.sort((a, b) => a.midi - b.midi);
  }

  private midiFromName(s: string) {
    const m = /^([A-G](?:#|b)?)(-?\d+)$/.exec(s);
    if (!m) return null;
    const n = this.NOTE_INDEX[m[1]];
    const o = parseInt(m[2], 10);
    return 12 * (o + 1) + n;
  }

  private buildPiano(pianoContainer: HTMLElement, offsets: number[]) {
    if (!pianoContainer) return;
    pianoContainer.innerHTML = '';
    const whiteKeyNotes = [0, 2, 4, 5, 7, 9, 11];
    const blackKeyNotes = [1, 3, 6, 8, 10];
    const blackKeyPositions = [0.65, 1.65, 3.65, 4.65, 5.65];

    const keyCharMap: Record<number, Record<number, string[]>> = {};
    for (const key in this.keyToNote) {
      const [octave, semitone] = this.keyToNote[key];
      if (!keyCharMap[octave]) keyCharMap[octave] = {};
      if (!keyCharMap[octave][semitone]) keyCharMap[octave][semitone] = [];
      keyCharMap[octave][semitone].push(key);
    }

    const whiteKeysContainer = document.createElement('div');
    whiteKeysContainer.className = 'white-keys';
    pianoContainer.appendChild(whiteKeysContainer);

    const totalWhiteKeys = whiteKeyNotes.length * offsets.length;
    // Fill full width
    whiteKeysContainer.style.width = '100%';
    whiteKeysContainer.style.margin = '0';

    offsets.forEach((octaveOffset, octaveIndex) => {
      whiteKeyNotes.forEach(semi => {
        const keyDiv = document.createElement('div');
        keyDiv.className = 'key is-white';
        keyDiv.dataset.semitone = String(semi);
        keyDiv.dataset.octaveOffset = String(octaveOffset);
        keyDiv.style.width = `${100 / totalWhiteKeys}%`;
        if (keyCharMap[octaveOffset] && keyCharMap[octaveOffset][semi]) {
          keyDiv.dataset.keys = keyCharMap[octaveOffset][semi].join(' ');
        }
        whiteKeysContainer.appendChild(keyDiv);
      });

      blackKeyNotes.forEach((semi, i) => {
        const keyDiv = document.createElement('div');
        keyDiv.className = 'key is-black';
        keyDiv.dataset.semitone = String(semi);
        keyDiv.dataset.octaveOffset = String(octaveOffset);
        if (keyCharMap[octaveOffset] && keyCharMap[octaveOffset][semi]) {
          keyDiv.dataset.keys = keyCharMap[octaveOffset][semi].join(' ');
        }
        // Calculate position relative to the 100% width container
        const leftPosition = (octaveIndex * whiteKeyNotes.length + blackKeyPositions[i]) * (100 / totalWhiteKeys);
        keyDiv.style.left = `${leftPosition}%`;
        keyDiv.style.width = `calc(${100 / totalWhiteKeys}% * 0.65)`;
        
        whiteKeysContainer.appendChild(keyDiv);
      });
    });
  }

  private drawVuMeter() {
    const bufferLength = this.analyserNode.fftSize;
    const dataArray = new Uint8Array(bufferLength);
    const vuMeterFill = this.container.querySelector('#vu-meter .fill') as HTMLElement;
    const draw = () => {
      if (!this.container.isConnected) return;
      this.rafId = requestAnimationFrame(draw);
      this.analyserNode.getByteTimeDomainData(dataArray);
      let sumSquares = 0.0;
      for (let i = 0; i < bufferLength; i++) {
        const v = (dataArray[i] / 128.0) - 1.0;
        sumSquares += v * v;
      }
      const rms = Math.sqrt(sumSquares / bufferLength);
      const meterValue = Math.min(1, rms * 2.5);
      if (vuMeterFill) vuMeterFill.style.transform = `scaleY(${meterValue})`;
    };
    draw();
  }

  private setupPointerEvents() {
    const onPointerDown = (e: PointerEvent) => {
      if (this.audioContext.state === 'suspended') this.audioContext.resume();
      const data = this.keyFromEvent(e);
      if (!data) return;
      this.triggerKeyOn(data.keyChar, data.velocity, data.dynamic, data.midiNote);
    };
    const onPointerUp = (e: PointerEvent) => {
      const data = this.keyFromEvent(e);
      if (!data) return;
      this.triggerKeyOff(data.keyChar, data.midiNote);
    };

    const pianos = this.container.querySelectorAll('.piano');
    pianos.forEach(p => {
      p.addEventListener('pointerdown', onPointerDown as any);
      p.addEventListener('pointerup', onPointerUp as any);
      p.addEventListener('pointerleave', onPointerUp as any);
    });
  }

  private keyFromEvent(evt: any) {
    const targetKey = evt.target.closest('.key');
    if (!targetKey) return null;
    const semitone = Number(targetKey.dataset.semitone);
    const octaveOffset = Number(targetKey.dataset.octaveOffset);
    
    const rect = targetKey.getBoundingClientRect();
    const clientY = evt.clientY || (evt.touches && evt.touches[0].clientY);
    const relativeY = clientY - rect.top;
    const keyHeight = rect.height;
    const velocityZone = Math.floor((relativeY / keyHeight) * 4);
    let velocity, dynamic;
    if (velocityZone === 0) { velocity = 0.25; dynamic = 'p'; }
    else if (velocityZone === 1) { velocity = 0.50; dynamic = 'mp'; }
    else if (velocityZone === 2) { velocity = 0.75; dynamic = 'mf'; }
    else { velocity = 1.0; dynamic = 'f'; }

    const keyChar = targetKey.dataset.keys ? targetKey.dataset.keys.split(' ')[0] : null;
    const targetOct = Math.max(0, Math.min(9, this.currentOctave + octaveOffset));
    const midiNote = 12 * (targetOct + 1) + semitone;
    return { keyChar, velocity, dynamic, midiNote };
  }

  public triggerKeyOn(k: string | null, velocity = 1.0, dynamic: string | null = null, midiNote: number | null = null, isRemote = false) {
    if (this.audioContext.state === 'suspended') this.audioContext.resume();
    let targetMIDI: number;
    let semi: number;
    if (k) {
      if (this.activeKeys[k]) return;
      const [octOff, semiIdx] = this.keyToNote[k];
      semi = semiIdx;
      const targetOct = Math.max(0, Math.min(9, this.currentOctave + octOff));
      targetMIDI = 12 * (targetOct + 1) + semi;
      this.activeKeys[k] = { midi: targetMIDI };
    } else if (midiNote !== null) {
      targetMIDI = midiNote;
      semi = midiNote % 12;
    } else return;

    if (this.activeNotes.has(targetMIDI)) return;
    const root = this.pickNearestRoot(targetMIDI);
    if (!root) return;
    const playback = this.playWithRoot(root, targetMIDI, velocity);
    this.activeNotes.set(targetMIDI, playback);
    this.startKeyHighlight(k, playback.adjustedDuration, semi, velocity, targetMIDI);

    if (!isRemote && this.onNoteEvent) {
      this.onNoteEvent(targetMIDI, velocity, 'on');
    }
    
    this.updateStatusDisplay(targetMIDI);
  }

  public triggerKeyOff(k: string | null, midiNote: number | null = null, isRemote = false) {
    let midi: number;
    if (k) {
      if (!this.activeKeys[k]) return;
      midi = this.activeKeys[k].midi;
      delete this.activeKeys[k];
    } else if (midiNote !== null) {
      midi = midiNote;
    } else return;

    const playback = this.activeNotes.get(midi);
    if (!playback) return;
    const now = this.audioContext.currentTime;
    playback.gain.gain.setTargetAtTime(0.0001, now, 0.1);
    this.activeNotes.delete(midi);

    if (!isRemote && this.onNoteEvent) {
      this.onNoteEvent(midi, 0, 'off');
    }
  }

  private updateStatusDisplay(midi: number) {
    const name = this.NAMES[midi % 12];
    const oct = Math.floor(midi / 12) - 1;
    this.setStatus(`${name}${oct} (${midi})`);
  }

  private pickNearestRoot(targetMIDI: number) {
    if (this.roots.length === 0) return null;
    let bestRoot = this.roots[0];
    let minDistance = Math.abs(targetMIDI - bestRoot.midi);
    for (let i = 1; i < this.roots.length; i++) {
      const distance = Math.abs(targetMIDI - this.roots[i].midi);
      if (distance < minDistance) {
        minDistance = distance;
        bestRoot = this.roots[i];
      }
    }
    return bestRoot;
  }

  private playWithRoot(root: any, targetMIDI: number, velocity = 1.0) {
    const diff = targetMIDI - root.midi;
    const rate = Math.pow(2, diff / 12);
    const now = this.audioContext.currentTime;
    const src = this.audioContext.createBufferSource();
    src.buffer = root.buffer;
    src.playbackRate.value = rate;
    const g = this.audioContext.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(velocity, now + 0.01);
    src.connect(g);
    g.connect(this.dryGain);
    g.connect(this.reverbNode);
    src.start(now);
    return { source: src, gain: g, adjustedDuration: root.buffer.duration / rate };
  }

  private startKeyHighlight(key: string | null, duration: number, semitone: number, velocity: number, midi: number) {
    const baseRgb = this.isMulticolor ? this.hexToRgb(this.octaveColors[semitone]) : '0, 255, 0';
    const color = `rgba(${baseRgb}, ${velocity})`;
    const octOff = Math.floor(midi / 12) - 1 - this.currentOctave;
    
    const selector = `.key[data-semitone="${semitone}"][data-octave-offset="${octOff}"]`;
    this.container.querySelectorAll(selector).forEach((el: any) => {
      el.style.transition = 'none';
      el.style.backgroundColor = color;
      void el.offsetWidth;
      el.style.transition = `background-color ${duration}s cubic-bezier(0.1, 0.9, 0.2, 1)`;
      el.style.backgroundColor = 'transparent';
    });
  }

  private hexToRgb(hex: string) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return result ? `${parseInt(result[1], 16)}, ${parseInt(result[2], 16)}, ${parseInt(result[3], 16)}` : '0, 255, 0';
  }

  private updateReverbMix() {
    this.wetGain.gain.value = this.wetDryRatio;
    this.dryGain.gain.value = 1.0 - this.wetDryRatio;
    const fill = this.container.querySelector('#reverb-indicator .fill') as HTMLElement;
    if (fill) fill.style.transform = `scaleY(${this.wetDryRatio})`;
  }

  private async setupMIDI() {
    if (!navigator.requestMIDIAccess) return;
    try {
      this.midiAccess = await navigator.requestMIDIAccess();
      this.midiAccess.onstatechange = () => this.syncMidiInput();
      this.syncMidiInput();
    } catch (e) { console.warn('MIDI access failed', e); }
  }

  private syncMidiInput() {
    if (!this.midiAccess) return;
    const targetId = this.getMidiInputId();
    const inputs = Array.from(this.midiAccess.inputs.values());
    const input = inputs.find(i => i.id === targetId) || inputs[0];

    if (this.currentMidiInput === input) return;
    if (this.currentMidiInput) this.currentMidiInput.onmidimessage = null;
    
    this.currentMidiInput = input || null;
    if (this.currentMidiInput) {
      this.currentMidiInput.onmidimessage = (msg) => this.onMIDIMessage(msg);
      this.setStatus(`MIDI: ${this.currentMidiInput.label}`);
    }
  }

  private onMIDIMessage(message: any) {
    const [command, note, velocity] = message.data;
    if (command === 144 && velocity > 0) this.triggerKeyOn(null, velocity / 127, null, note);
    else if (command === 128 || (command === 144 && velocity === 0)) this.triggerKeyOff(null, note);
  }

  private bindKeyboard() {
    const handleDown = (e: KeyboardEvent) => {
      // Allow shortcuts if this specific container or any child has focus
      const isFocused = this.isFocused || this.container.contains(document.activeElement);
      if (!isFocused) return;
      if (e.repeat) return;
      
      const key = e.key;
      if (key === 'ArrowLeft') {
          e.preventDefault();
          this.currentOctave = Math.max(0, this.currentOctave - 1);
          this.handleResize();
          this.updateStatusDisplayForOctave('LEFT');
          return;
      }
      if (key === 'ArrowRight') {
          e.preventDefault();
          this.currentOctave = Math.min(8, this.currentOctave + 1);
          this.handleResize();
          this.updateStatusDisplayForOctave('RIGHT');
          return;
      }

      const k = key.toLowerCase();
      if (this.keyToNote[k]) {
        e.preventDefault();
        this.triggerKeyOn(k);
      }
    };
    const handleUp = (e: KeyboardEvent) => {
      const isFocused = this.isFocused || this.container.contains(document.activeElement);
      if (!isFocused) return;
      const k = e.key.toLowerCase();
      if (this.keyToNote[k]) {
        e.preventDefault();
        this.triggerKeyOff(k);
      }
    };
    window.addEventListener('keydown', handleDown, { capture: true });
    window.addEventListener('keyup', handleUp, { capture: true });
  }

  private updateStatusDisplayForOctave(dir: string) {
      this.setStatus(`[${dir}] Octava: ${this.currentOctave}`);
      setTimeout(() => this.setStatus(`Octava: ${this.currentOctave}`), 1000);
  }

  public setFocused(focused: boolean) {
    this.isFocused = focused;
    this.container.classList.toggle('is-focused', focused);
  }

  public dispose() {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.resizeObserver.disconnect();
    if (this.currentMidiInput) this.currentMidiInput.onmidimessage = null;
  }
}
