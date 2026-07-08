import { parseTuningInput } from '../../../lib/tuning/parseTuningInput';
import { buildMidiTuningTable } from '../../../lib/tuning/buildMidiTuningTable';
import { exportTun } from '../../../lib/tuning/exportTun';
import type { TuningSpec, MidiTuningRow } from '../../../types/tuning';

type CentauroControllerOptions = {
  container: HTMLElement;
  getAudioContext?: () => AudioContext | null | Promise<AudioContext | null>;
  getOutputNode?: () => AudioNode | null;
  // Collaboration callbacks
  onNoteEvent?: (note: number, velocity: number, action: 'on' | 'off') => void;
  onTuningChange?: (expr: string) => void;
  onEngineChange?: (engine: string) => void;
  onMapModeChange?: (mapMode: 'chromatic' | 'isomorphic') => void;
  onDroneToggle?: (active: boolean, midi: number) => void;
};

type Point = { x: number; y: number };

function clipPolygon(poly: Point[], xm: number, ym: number, nx: number, ny: number): Point[] {
  const result: Point[] = [];
  if (poly.length === 0) return result;

  const isInside = (p: Point) => {
    return (p.x - xm) * nx + (p.y - ym) * ny <= 0;
  };

  const getIntersection = (p1: Point, p2: Point) => {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const denom = dx * nx + dy * ny;
    if (Math.abs(denom) < 0.000001) return p1;
    const t = ((xm - p1.x) * nx + (ym - p1.y) * ny) / denom;
    return { x: p1.x + t * dx, y: p1.y + t * dy };
  };

  let s = poly[poly.length - 1];
  for (const p of poly) {
    if (isInside(p)) {
      if (isInside(s)) {
        result.push(p);
      } else {
        result.push(getIntersection(s, p));
        result.push(p);
      }
    } else if (isInside(s)) {
      result.push(getIntersection(s, p));
    }
    s = p;
  }
  return result;
}

// Generate a synthetic plate reverb impulse response buffer (exponentially decayed white noise)
function createPlateReverbBuffer(ctx: AudioContext, duration: number, decay: number): AudioBuffer {
  const sampleRate = ctx.sampleRate;
  const len = Math.floor(sampleRate * duration);
  const buffer = ctx.createBuffer(2, len, sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < len; i++) {
      const percent = i / len;
      // White noise with exponential decay curve
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - percent, decay);
    }
  }
  return buffer;
}

interface SpellingOption {
  name: string;
  baseChar: string; // 'n', 'e', 'v', 'E', 'V'
  pythDev: number;
}

const SPELLING_OPTIONS: SpellingOption[][] = [
  // 0: C
  [{ name: 'C', baseChar: 'n', pythDev: -5.865 }],
  // 1: C# / Db
  [
    { name: 'C#', baseChar: 'v', pythDev: 7.82 },
    { name: 'Db', baseChar: 'e', pythDev: -9.775 }
  ],
  // 2: D
  [{ name: 'D', baseChar: 'n', pythDev: -1.955 }],
  // 3: D# / Eb
  [
    { name: 'D#', baseChar: 'v', pythDev: 11.73 },
    { name: 'Eb', baseChar: 'e', pythDev: -11.73 }
  ],
  // 4: E
  [{ name: 'E', baseChar: 'n', pythDev: 1.955 }],
  // 5: F
  [{ name: 'F', baseChar: 'n', pythDev: -7.82 }],
  // 6: F# / Gb
  [
    { name: 'F#', baseChar: 'v', pythDev: 5.865 },
    { name: 'Gb', baseChar: 'e', pythDev: -13.68 }
  ],
  // 7: G
  [{ name: 'G', baseChar: 'n', pythDev: -3.910 }],
  // 8: G# / Ab
  [
    { name: 'G#', baseChar: 'v', pythDev: 9.775 },
    { name: 'Ab', baseChar: 'e', pythDev: -13.68 }
  ],
  // 9: A
  [{ name: 'A', baseChar: 'n', pythDev: 0.0 }],
  // 10: A# / Bb
  [
    { name: 'A#', baseChar: 'v', pythDev: 13.68 },
    { name: 'Bb', baseChar: 'e', pythDev: -9.775 }
  ],
  // 11: B
  [{ name: 'B', baseChar: 'n', pythDev: 3.910 }]
];

function getSyntonicBaseChar(baseChar: string, S: number): string {
  if (baseChar === 'n') {
    if (S === -2) return 'l';
    if (S === -1) return 'm';
    if (S === 0) return 'n';
    if (S === 1) return 'o';
    if (S === 2) return 'p';
  } else if (baseChar === 'e') {
    if (S === -2) return 'c';
    if (S === -1) return 'd';
    if (S === 0) return 'e';
    if (S === 1) return 'f';
    if (S === 2) return 'g';
  } else if (baseChar === 'v') {
    if (S === -2) return 't';
    if (S === -1) return 'u';
    if (S === 0) return 'v';
    if (S === 1) return 'w';
    if (S === 2) return 'x';
  } else if (baseChar === 'E') {
    if (S === -2) return 'C';
    if (S === -1) return 'D';
    if (S === 0) return 'E';
    if (S === 1) return 'F';
    if (S === 2) return 'G';
  } else if (baseChar === 'V') {
    if (S === -2) return 'T';
    if (S === -1) return 'U';
    if (S === 0) return 'V';
    if (S === 1) return 'W';
    if (S === 2) return 'X';
  }
  return baseChar;
}

export class CentauroController {
  private container: HTMLElement;
  private getAudioContext?: CentauroControllerOptions['getAudioContext'];
  private getOutputNode?: CentauroControllerOptions['getOutputNode'];

  // Collaboration callbacks
  private onNoteEvent?: CentauroControllerOptions['onNoteEvent'];
  private onTuningChange?: CentauroControllerOptions['onTuningChange'];
  private onEngineChange?: CentauroControllerOptions['onEngineChange'];
  private onMapModeChange?: CentauroControllerOptions['onMapModeChange'];
  private onDroneToggle?: CentauroControllerOptions['onDroneToggle'];

  private spec!: TuningSpec;
  private midiTable!: MidiTuningRow[];
  private activeMidiNotes = new Set<number>();
  private currentDroneMidi = 60; // C4 default drone
  
  // Audio state
  private audioCtx: AudioContext | null = null;
  private destination: AudioNode | null = null;
  private activeVoices = new Map<number, { osc: OscillatorNode | AudioBufferSourceNode; gain: GainNode }>();
  private droneOsc: OscillatorNode | AudioBufferSourceNode | null = null;
  private droneGain: GainNode | null = null;
  private droneActive = false;

  // Reverb Send Effect
  private reverbNode: ConvolverNode | null = null;
  private reverbGain: GainNode | null = null;

  // Piano samples state
  private roots: Array<{ midi: number; buffer: AudioBuffer }> = [];
  private loadingPiano = false;
  private pianoLoaded = false;

  // Keyboard active & map modes (Chromatic vs Isomorphic QWERTY)
  private kbActive = true; // default ON as requested
  private mapMode: 'chromatic' | 'isomorphic' = 'chromatic';
  private octaveOffset = 0; // Transposition in semitones (in units of 12)

  private keyToMidiOffset: Record<string, number> = {
    // Row 1 Chromatic (zsxdcvgbhnjm) -> offsets 0 to 11
    'z': 0, 's': 1, 'x': 2, 'd': 3, 'c': 4, 'v': 5, 'g': 6, 'b': 7, 'h': 8, 'n': 9, 'j': 10, 'm': 11,
    // Row 2 Chromatic (q2w3er5t6y7u) -> offsets 12 to 23
    'q': 12, '2': 13, 'w': 14, '3': 15, 'e': 16, 'r': 17, '5': 18, 't': 19, '6': 20, 'y': 21, '7': 22, 'u': 23,
    // Row 3 + half (i9o0p[ - ] = ) -> offsets 24+
    'i': 24, '9': 25, 'o': 26, '0': 27, 'p': 28, '[': 29, '-': 30, ']': 31, '=': 32
  };

  private qwertyToGrid: Record<string, { dx: number; dy: number }> = {
    // Numbers row (dy = -2)
    '1': { dx: -5, dy: -2 }, '2': { dx: -4, dy: -2 }, '3': { dx: -3, dy: -2 }, '4': { dx: -2, dy: -2 }, '5': { dx: -1, dy: -2 }, '6': { dx: 0, dy: -2 }, '7': { dx: 1, dy: -2 }, '8': { dx: 2, dy: -2 }, '9': { dx: 3, dy: -2 }, '0': { dx: 4, dy: -2 }, '-': { dx: 5, dy: -2 }, '=': { dx: 6, dy: -2 },
    // Top row (dy = -1)
    'q': { dx: -5, dy: -1 }, 'w': { dx: -4, dy: -1 }, 'e': { dx: -3, dy: -1 }, 'r': { dx: -2, dy: -1 }, 't': { dx: -1, dy: -1 }, 'y': { dx: 0, dy: -1 }, 'u': { dx: 1, dy: -1 }, 'i': { dx: 2, dy: -1 }, 'o': { dx: 3, dy: -1 }, 'p': { dx: 4, dy: -1 }, '[': { dx: 5, dy: -1 }, ']': { dx: 6, dy: -1 },
    // Home row (dy = 0)
    'a': { dx: -5, dy: 0 },  's': { dx: -4, dy: 0 },  'd': { dx: -3, dy: 0 },  'f': { dx: -2, dy: 0 },  'g': { dx: -1, dy: 0 },  'h': { dx: 0, dy: 0 },  'j': { dx: 1, dy: 0 },  'k': { dx: 2, dy: 0 },  'l': { dx: 3, dy: 0 },  ';': { dx: 4, dy: 0 },  "'": { dx: 5, dy: 0 },
    // Bottom row (dy = 1)
    'z': { dx: -5, dy: 1 },  'x': { dx: -4, dy: 1 },  'c': { dx: -3, dy: 1 },  'v': { dx: -2, dy: 1 },  'b': { dx: -1, dy: 1 },  'n': { dx: 0, dy: 1 },  'm': { dx: 1, dy: 1 },  ',': { dx: 2, dy: 1 },  '.': { dx: 3, dy: 1 },  '/': { dx: 4, dy: 1 }
  };

  private activeKeyboardNotes = new Set<number>();
  private isMouseDown = false;
  private activeTouchMidi: number | null = null;

  // DOM bindings
  private inputExpr!: HTMLInputElement;
  private statusNote!: HTMLElement;
  private tableBody!: HTMLElement;
  private keyboardWrapper!: HTMLElement;
  private touchStrip!: HTMLElement;
  private pitchMonitor!: HTMLElement;
  private droneBtn!: HTMLButtonElement;
  private kbToggleBtn!: HTMLButtonElement;
  private mapModeBtn!: HTMLButtonElement;
  private resetBtn!: HTMLButtonElement;
  private viewTunBtn!: HTMLButtonElement;
  private downloadTunBtn!: HTMLButtonElement;
  private engineSelect!: HTMLSelectElement;
  private helpBtn!: HTMLButtonElement;
  private shareCopyBtn!: HTMLButtonElement;
  private shareOpenLink!: HTMLAnchorElement;

  // Modal bindings
  private modal!: HTMLDialogElement;
  private modalTextArea!: HTMLTextAreaElement;
  private modalCopyBtn!: HTMLButtonElement;
  private modalDownloadBtn!: HTMLButtonElement;
  private modalRegenBtn!: HTMLButtonElement;
  private modalCloseBtn!: HTMLButtonElement;

  private helpModal!: HTMLDialogElement;
  private helpCloseBtn!: HTMLButtonElement;

  // Keyboard mouse/touch tracking
  private activePointerNotes = new Set<number>();

  constructor(options: CentauroControllerOptions) {
    this.container = options.container;
    this.getAudioContext = options.getAudioContext;
    this.getOutputNode = options.getOutputNode;
    
    // Assign collaboration callbacks
    this.onNoteEvent = options.onNoteEvent;
    this.onTuningChange = options.onTuningChange;
    this.onEngineChange = options.onEngineChange;
    this.onMapModeChange = options.onMapModeChange;
    this.onDroneToggle = options.onDroneToggle;

    this.bindDOM();

    // Read tuning expression from URL query parameters
    let initialTuning = 'u31';
    try {
      const decodedSearch = decodeURIComponent(window.location.search).trim();
      const params = new URLSearchParams(window.location.search);
      const scaleParam = params.get('scale') || params.get('tuning');
      
      if (scaleParam) {
        initialTuning = scaleParam;
      } else if (decodedSearch.startsWith('?u')) {
        initialTuning = decodedSearch.slice(1);
      }
    } catch (e) {
      console.warn('[Centauro] Failed to parse URL parameters:', e);
    }

    if (this.inputExpr) {
      this.inputExpr.value = initialTuning;
    }

    this.initTuning(initialTuning);
    this.setupListeners();
    this.setupMidi();
    this.setupMaxBridge();

    // ResizeObserver to handle dynamic height & width updates smoothly
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(() => {
        this.renderKeyboard();
      });
      observer.observe(this.keyboardWrapper);
    }
  }

  private bindDOM() {
    this.inputExpr = this.container.querySelector('[data-centauro-input]') as HTMLInputElement;
    this.statusNote = this.container.querySelector('[data-centauro-status]') as HTMLElement;
    this.tableBody = this.container.querySelector('[data-centauro-table-body]') as HTMLElement;
    this.keyboardWrapper = this.container.querySelector('[data-centauro-keyboard-wrapper]') as HTMLElement;
    this.touchStrip = this.container.querySelector('[data-centauro-touch-strip]') as HTMLElement;
    this.pitchMonitor = this.container.querySelector('[data-centauro-pitch-monitor]') as HTMLElement;
    this.droneBtn = this.container.querySelector('[data-centauro-drone]') as HTMLButtonElement;
    this.kbToggleBtn = this.container.querySelector('[data-centauro-kb-toggle]') as HTMLButtonElement;
    this.mapModeBtn = this.container.querySelector('[data-centauro-map-mode]') as HTMLButtonElement;
    this.resetBtn = this.container.querySelector('[data-centauro-reset]') as HTMLButtonElement;
    this.viewTunBtn = this.container.querySelector('[data-centauro-view-tun]') as HTMLButtonElement;
    this.downloadTunBtn = this.container.querySelector('[data-centauro-download-tun]') as HTMLButtonElement;
    this.engineSelect = this.container.querySelector('[data-centauro-engine]') as HTMLSelectElement;
    this.helpBtn = this.container.querySelector('[data-centauro-help-btn]') as HTMLButtonElement;
    this.shareCopyBtn = this.container.querySelector('[data-centauro-share-copy]') as HTMLButtonElement;
    this.shareOpenLink = this.container.querySelector('[data-centauro-share-open]') as HTMLAnchorElement;

    // Modals
    this.modal = this.container.querySelector('[data-centauro-modal]') as HTMLDialogElement;
    this.modalTextArea = this.container.querySelector('[data-centauro-modal-text]') as HTMLTextAreaElement;
    this.modalCopyBtn = this.container.querySelector('[data-centauro-modal-copy]') as HTMLButtonElement;
    this.modalDownloadBtn = this.container.querySelector('[data-centauro-modal-download]') as HTMLButtonElement;
    this.modalRegenBtn = this.container.querySelector('[data-centauro-modal-regen]') as HTMLButtonElement;
    this.modalCloseBtn = this.container.querySelector('[data-centauro-modal-close]') as HTMLDialogElement;

    this.helpModal = this.container.querySelector('[data-centauro-help-modal]') as HTMLDialogElement;
    this.helpCloseBtn = this.container.querySelector('[data-centauro-help-close]') as HTMLButtonElement;
  }

  private initTuning(expr: string) {
    try {
      this.spec = parseTuningInput(expr);
      this.midiTable = buildMidiTuningTable(this.spec);
      this.precalculateHejiAccidentals();
      this.statusNote.textContent = `Afinación cargada: ${this.spec.name}`;
      this.statusNote.className = 'centauro-status centauro-status--info';
      this.renderTable();
      this.renderKeyboard();
      if (this.shareOpenLink) {
        this.shareOpenLink.href = this.getShareUrl(expr);
      }
      if (this.droneActive) {
        this.startDrone();
      }
    } catch (error: any) {
      this.statusNote.textContent = error?.message || 'Error al procesar la afinación.';
      this.statusNote.className = 'centauro-status centauro-status--error';
    }
  }

  private setupListeners() {
    // Input listener
    this.inputExpr.addEventListener('change', () => {
      const val = this.inputExpr.value;
      this.initTuning(val);
      if (this.onTuningChange) {
        this.onTuningChange(val);
      }
    });
    this.inputExpr.addEventListener('keyup', (e) => {
      if (e.key === 'Enter') {
        const val = this.inputExpr.value;
        this.initTuning(val);
        if (this.onTuningChange) {
          this.onTuningChange(val);
        }
        this.inputExpr.blur();
      }
    });

    // Action buttons
    this.droneBtn.addEventListener('click', () => {
      void this.toggleDrone(false);
    });

    this.kbToggleBtn.addEventListener('click', () => {
      this.kbActive = !this.kbActive;
      this.kbToggleBtn.setAttribute('aria-pressed', this.kbActive.toString());
      this.kbToggleBtn.classList.toggle('centauro-btn--primary', this.kbActive);
    });

    this.mapModeBtn.addEventListener('click', () => {
      this.mapMode = this.mapMode === 'chromatic' ? 'isomorphic' : 'chromatic';
      this.mapModeBtn.textContent = `Mapa: ${this.mapMode === 'chromatic' ? 'Cromático' : 'Isomórfico'}`;
      this.renderKeyboard(); // Re-render keyboard to update layout labels
      if (this.onMapModeChange) {
        this.onMapModeChange(this.mapMode);
      }
    });

    this.resetBtn.addEventListener('click', () => {
      this.inputExpr.value = 'u12';
      this.initTuning('u12');
      if (this.onTuningChange) {
        this.onTuningChange('u12');
      }
    });

    this.viewTunBtn.addEventListener('click', () => {
      this.openTunModal();
    });

    this.downloadTunBtn.addEventListener('click', () => {
      this.downloadTunFile();
    });

    if (this.shareCopyBtn) {
      this.shareCopyBtn.addEventListener('click', () => {
        const shareUrl = this.getShareUrl();
        void navigator.clipboard.writeText(shareUrl);
        
        // Temporarily change SVG/title to show copy success
        const originalTitle = this.shareCopyBtn.getAttribute('title') || '';
        this.shareCopyBtn.setAttribute('title', '¡Enlace Copiado!');
        this.shareCopyBtn.style.color = '#34d399'; // green success color
        setTimeout(() => {
          this.shareCopyBtn.setAttribute('title', originalTitle);
          this.shareCopyBtn.style.color = '';
        }, 1500);
      });
    }

    this.engineSelect.addEventListener('change', () => {
      const val = this.engineSelect.value;
      if (val === 'piano') {
        void this.ensurePianoLoaded().then(() => {
          if (this.onEngineChange) {
            this.onEngineChange(val);
          }
        });
      } else {
        if (this.onEngineChange) {
          this.onEngineChange(val);
        }
      }
    });

    this.helpBtn.addEventListener('click', () => {
      this.helpModal.showModal();
    });

    // Modal action buttons
    this.modalCloseBtn.addEventListener('click', () => {
      this.modal.close();
    });

    this.modalCopyBtn.addEventListener('click', () => {
      void navigator.clipboard.writeText(this.modalTextArea.value);
      const originalText = this.modalCopyBtn.textContent;
      this.modalCopyBtn.textContent = '¡Copiado!';
      setTimeout(() => {
        this.modalCopyBtn.textContent = originalText;
      }, 1000);
    });

    this.modalDownloadBtn.addEventListener('click', () => {
      this.downloadTextAsFile(this.modalTextArea.value, 'centauro_edited.tun');
    });

    this.modalRegenBtn.addEventListener('click', () => {
      const generated = exportTun(this.spec, this.midiTable);
      this.modalTextArea.value = generated;
    });

    this.helpCloseBtn.addEventListener('click', () => {
      this.helpModal.close();
    });

    // Global QWERTY events
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keyup', this.handleKeyUp);

    // Global mouse state listeners for glissando
    window.addEventListener('mousedown', () => {
      this.isMouseDown = true;
    });
    window.addEventListener('mouseup', () => {
      this.isMouseDown = false;
      this.activePointerNotes.clear();
    });

    // Touch/click strip listeners for mobile octave transposition
    if (this.touchStrip) {
      const handleTouchStrip = (clientY: number) => {
        const rect = this.touchStrip.getBoundingClientRect();
        const relativeY = (clientY - rect.top) / rect.height;
        if (relativeY < 0.35) {
          this.shiftOctave(12);
        } else if (relativeY > 0.65) {
          this.shiftOctave(-12);
        } else {
          this.resetOctave();
        }
      };

      this.touchStrip.addEventListener('click', (e) => {
        handleTouchStrip(e.clientY);
      });

      this.touchStrip.addEventListener('touchstart', (e) => {
        e.preventDefault();
        if (e.touches.length > 0) {
          handleTouchStrip(e.touches[0].clientY);
        }
      }, { passive: false });
    }
  }

  public shiftOctave(semitones: number) {
    // Release active notes
    for (const midi of this.activeVoices.keys()) {
      this.noteOff(midi, false);
    }
    this.octaveOffset += semitones;
    // Cap octave offset to a reasonable range (-48 to +48 MIDI notes)
    this.octaveOffset = Math.max(-48, Math.min(48, this.octaveOffset));
    this.renderKeyboard();
    
    // Show a user-friendly status toast or text update
    this.statusNote.textContent = `Octava transpuesta: ${this.octaveOffset > 0 ? '+' : ''}${this.octaveOffset / 12}`;
    this.statusNote.className = 'centauro-status centauro-status--info';
  }

  public resetOctave() {
    for (const midi of this.activeVoices.keys()) {
      this.noteOff(midi, false);
    }
    this.octaveOffset = 0;
    this.renderKeyboard();
    this.statusNote.textContent = `Octava restablecida`;
    this.statusNote.className = 'centauro-status centauro-status--info';
  }

  private handleKeyDown = (e: KeyboardEvent) => {
    if (!this.kbActive) return;
    if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;
    if (e.repeat) return;

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.shiftOctave(12);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.shiftOctave(-12);
      return;
    }

    if (this.mapMode === 'chromatic') {
      const offset = this.keyToMidiOffset[e.key.toLowerCase()];
      if (offset !== undefined) {
        const midi = 60 + offset + this.octaveOffset;
        if (midi >= 0 && midi <= 127) {
          this.activeKeyboardNotes.add(midi);
          this.noteOn(midi, 0.5, false);
        }
      }
    } else {
      // Isomorphic grid mapping
      const coord = this.qwertyToGrid[e.key.toLowerCase()];
      if (coord) {
        const degreeCount = this.spec.degrees.length;
        let stepX = 1;
        let stepY = 2;
        if (this.spec.source === 'edo') {
          stepX = Math.round(degreeCount * Math.log2(1.5));
          stepY = Math.round(degreeCount * Math.log2(1.25));
        } else {
          stepX = 1;
          stepY = Math.max(2, Math.round(degreeCount / 3));
        }
        const pitch = coord.dx * stepX + coord.dy * stepY;
        let midi = 60 + pitch + this.octaveOffset;
        midi = ((midi % 128) + 128) % 128; // safe wrap
        this.activeKeyboardNotes.add(midi);
        this.noteOn(midi, 0.5, false);
      }
    }
  };

  private handleKeyUp = (e: KeyboardEvent) => {
    if (!this.kbActive) return;
    
    if (this.mapMode === 'chromatic') {
      const offset = this.keyToMidiOffset[e.key.toLowerCase()];
      if (offset !== undefined) {
        const midi = 60 + offset + this.octaveOffset;
        if (this.activeKeyboardNotes.has(midi)) {
          this.activeKeyboardNotes.delete(midi);
          this.noteOff(midi, false);
        }
      }
    } else {
      const coord = this.qwertyToGrid[e.key.toLowerCase()];
      if (coord) {
        const degreeCount = this.spec.degrees.length;
        let stepX = 1;
        let stepY = 2;
        if (this.spec.source === 'edo') {
          stepX = Math.round(degreeCount * Math.log2(1.5));
          stepY = Math.round(degreeCount * Math.log2(1.25));
        } else {
          stepX = 1;
          stepY = Math.max(2, Math.round(degreeCount / 3));
        }
        const pitch = coord.dx * stepX + coord.dy * stepY;
        let midi = 60 + pitch + this.octaveOffset;
        midi = ((midi % 128) + 128) % 128; // safe wrap
        if (this.activeKeyboardNotes.has(midi)) {
          this.activeKeyboardNotes.delete(midi);
          this.noteOff(midi, false);
        }
      }
    }
  };

  // --- AUDIO ENGINE ---
  private async ensureAudio() {
    if (this.audioCtx) return;
    if (this.getAudioContext) {
      const ctx = await this.getAudioContext();
      if (ctx) {
        this.audioCtx = ctx;
      }
    }
    if (!this.audioCtx) {
      this.audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (this.getOutputNode) {
      const node = this.getOutputNode();
      if (node) {
        this.destination = node;
      }
    }
    if (!this.destination && this.audioCtx) {
      this.destination = this.audioCtx.destination;
    }

    // Initialize plate reverb convolver & dry/wet mix node
    if (this.audioCtx && !this.reverbNode && this.destination) {
      this.reverbNode = this.audioCtx.createConvolver();
      this.reverbNode.buffer = createPlateReverbBuffer(this.audioCtx, 1.0, 4.0);
      this.reverbGain = this.audioCtx.createGain();
      this.reverbGain.gain.setValueAtTime(0.24, this.audioCtx.currentTime); // subtle plate reverb mix

      this.reverbNode.connect(this.reverbGain);
      this.reverbGain.connect(this.destination);
    }
  }

  private async ensurePianoLoaded() {
    if (this.pianoLoaded || this.loadingPiano) return;
    this.loadingPiano = true;
    this.statusNote.textContent = 'Cargando piano...';
    this.statusNote.className = 'centauro-status centauro-status--info';

    try {
      await this.ensureAudio();
      if (!this.audioCtx) throw new Error('Contexto de Audio no inicializado.');
      
      const files = ['C1.mp3', 'C2.mp3', 'C3.mp3', 'C4.mp3', 'C5.mp3', 'C6.mp3', 'C7.mp3', 'C8.mp3'];
      const basePath = '/inc/samples-piano/';
      
      const loads = files.map(async (file) => {
        try {
          const res = await fetch(basePath + file);
          if (!res.ok) return;
          const arr = await res.arrayBuffer();
          if (!this.audioCtx) return;
          const buf = await this.audioCtx.decodeAudioData(arr);
          const m = /C(\d+)/.exec(file);
          if (!m) return;
          const octave = parseInt(m[1], 10);
          const midi = 12 * (octave + 1);
          if (!this.roots.some(r => r.midi === midi)) {
            this.roots.push({ midi, buffer: buf });
          }
        } catch (e) {
          console.warn('[Centauro] Error al cargar muestra:', file, e);
        }
      });

      await Promise.all(loads);
      this.roots.sort((a, b) => a.midi - b.midi);
      this.pianoLoaded = true;
      this.statusNote.textContent = `Afinación cargada: ${this.spec.name}`;
    } catch (err: any) {
      this.statusNote.textContent = `Error al cargar muestras de piano: ${err.message}`;
      this.statusNote.className = 'centauro-status centauro-status--error';
    } finally {
      this.loadingPiano = false;
    }
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

  public noteOn(midi: number, velocity = 0.5, isRemote = false) {
    void this.ensureAudio().then(() => {
      if (!this.audioCtx || !this.destination) return;
      this.noteOff(midi, isRemote); // polyphonic safety check

      const row = this.midiTable[midi];
      if (!row) return;

      const usePiano = this.engineSelect.value === 'piano' && this.pianoLoaded && this.roots.length > 0;

      if (usePiano) {
        const targetFreq = row.frequency;
        const standardMidiOfFreq = Math.round(12 * Math.log2(targetFreq / 440) + 69);
        const root = this.pickNearestRoot(standardMidiOfFreq);
        if (!root) return;

        const rootFreq = 440 * Math.pow(2, (root.midi - 69) / 12);
        const rate = targetFreq / rootFreq;

        const src = this.audioCtx.createBufferSource();
        src.buffer = root.buffer;
        src.playbackRate.setValueAtTime(rate, this.audioCtx.currentTime);

        const gain = this.audioCtx.createGain();
        gain.gain.setValueAtTime(0, this.audioCtx.currentTime);
        gain.gain.linearRampToValueAtTime(velocity * 0.22, this.audioCtx.currentTime + 0.012);

        src.connect(gain);
        gain.connect(this.destination);
        if (this.reverbNode) {
          gain.connect(this.reverbNode);
        }

        src.start();
        this.activeVoices.set(midi, { osc: src as any, gain });
      } else {
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(row.frequency, this.audioCtx.currentTime);

        gain.gain.setValueAtTime(0, this.audioCtx.currentTime);
        gain.gain.linearRampToValueAtTime(velocity * 0.18, this.audioCtx.currentTime + 0.015);

        osc.connect(gain);
        gain.connect(this.destination);
        if (this.reverbNode) {
          gain.connect(this.reverbNode);
        }

        osc.start();
        this.activeVoices.set(midi, { osc, gain });
      }
      this.highlightKey(midi, true);
      this.updatePitchMonitor();

      if (!isRemote && this.onNoteEvent) {
        this.onNoteEvent(midi, velocity, 'on');
      }
    });
  }

  public noteOff(midi: number, isRemote = false) {
    const voice = this.activeVoices.get(midi);
    if (voice && this.audioCtx) {
      const { osc, gain } = voice;
      const now = this.audioCtx.currentTime;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(0, now + 0.08);
      osc.stop(now + 0.1);
      this.activeVoices.delete(midi);
    }
    this.highlightKey(midi, false);
    this.updatePitchMonitor();

    if (!isRemote && this.onNoteEvent) {
      this.onNoteEvent(midi, 0, 'off');
    }
  }

  private async toggleDrone(isRemote = false) {
    await this.ensureAudio();
    if (!this.audioCtx) return;

    if (this.droneActive) {
      this.stopDrone();
      if (!isRemote && this.onDroneToggle) {
        this.onDroneToggle(false, this.currentDroneMidi);
      }
    } else {
      this.startDrone();
      if (!isRemote && this.onDroneToggle) {
        this.onDroneToggle(true, this.currentDroneMidi);
      }
    }
  }

  private startDrone() {
    if (!this.audioCtx || !this.destination) return;
    this.stopDrone();

    const row = this.midiTable[this.currentDroneMidi];
    if (!row) return;

    const usePiano = this.engineSelect.value === 'piano' && this.pianoLoaded && this.roots.length > 0;

    if (usePiano) {
      const targetFreq = row.frequency;
      const standardMidiOfFreq = Math.round(12 * Math.log2(targetFreq / 440) + 69);
      const root = this.pickNearestRoot(standardMidiOfFreq);
      if (!root) return;

      const rootFreq = 440 * Math.pow(2, (root.midi - 69) / 12);
      const rate = targetFreq / rootFreq;

      const src = this.audioCtx.createBufferSource();
      src.buffer = root.buffer;
      src.playbackRate.setValueAtTime(rate, this.audioCtx.currentTime);
      src.loop = true;

      this.droneGain = this.audioCtx.createGain();
      this.droneGain.gain.setValueAtTime(0, this.audioCtx.currentTime);
      this.droneGain.gain.linearRampToValueAtTime(0.15, this.audioCtx.currentTime + 0.2);

      src.connect(this.droneGain);
      this.droneGain.connect(this.destination);
      if (this.reverbNode) {
        this.droneGain.connect(this.reverbNode);
      }

      src.start();
      this.droneOsc = src as any;
    } else {
      this.droneOsc = this.audioCtx.createOscillator();
      this.droneGain = this.audioCtx.createGain();

      this.droneOsc.type = 'sine';
      this.droneOsc.frequency.setValueAtTime(row.frequency, this.audioCtx.currentTime);

      this.droneGain.gain.setValueAtTime(0, this.audioCtx.currentTime);
      this.droneGain.gain.linearRampToValueAtTime(0.12, this.audioCtx.currentTime + 0.2);

      this.droneOsc.connect(this.droneGain);
      this.droneGain.connect(this.destination);
      if (this.reverbNode) {
        this.droneGain.connect(this.reverbNode);
      }

      this.droneOsc.start();
    }
    this.droneActive = true;
    this.droneBtn.textContent = 'Stop Drone';
    this.droneBtn.classList.add('centauro-btn--primary');
  }

  private stopDrone() {
    if (this.droneOsc && this.audioCtx) {
      const now = this.audioCtx.currentTime;
      this.droneGain?.gain.cancelScheduledValues(now);
      this.droneGain?.gain.setValueAtTime(this.droneGain.gain.value, now);
      this.droneGain?.gain.linearRampToValueAtTime(0, now + 0.15);
      this.droneOsc.stop(now + 0.2);
      this.droneOsc = null;
      this.droneGain = null;
    }
    this.droneActive = false;
    this.droneBtn.textContent = 'Play Drone';
    this.droneBtn.classList.remove('centauro-btn--primary');
  }

  // --- COLLABORATION REMOTE HANDLERS ---
  public setTuningRemote(expr: string) {
    if (this.inputExpr) {
      this.inputExpr.value = expr;
    }
    this.initTuning(expr);
  }

  public setEngineRemote(engine: string) {
    if (this.engineSelect) {
      this.engineSelect.value = engine;
    }
    if (engine === 'piano') {
      void this.ensurePianoLoaded();
    }
  }

  public setMapModeRemote(mapMode: 'chromatic' | 'isomorphic') {
    this.mapMode = mapMode;
    if (this.mapModeBtn) {
      this.mapModeBtn.textContent = `Mapa: ${this.mapMode === 'chromatic' ? 'Cromático' : 'Isomórfico'}`;
    }
    this.renderKeyboard();
  }

  public setDroneRemote(active: boolean, midi: number) {
    this.currentDroneMidi = midi;
    if (active) {
      void this.ensureAudio().then(() => this.startDrone());
    } else {
      this.stopDrone();
    }
  }

  // --- MIDI BINDING ---
  private setupMidi() {
    const handleMidiMessage = (event: WebMidi.MIDIMessageEvent) => {
      const [cmd, note, vel] = event.data;
      const type = cmd & 0xf0;
      
      if (type === 144 && vel > 0) { // Note on
        this.noteOn(note, vel / 127, false);
      } else if (type === 128 || (type === 144 && vel === 0)) { // Note off
        this.noteOff(note, false);
      }
    };

    if (navigator.requestMIDIAccess) {
      navigator.requestMIDIAccess().then((access) => {
        for (const input of access.inputs.values()) {
          input.addEventListener('midimessage', handleMidiMessage);
        }
        access.addEventListener('statechange', (e: any) => {
          if (e.port.type === 'input' && e.port.state === 'connected') {
            e.port.addEventListener('midimessage', handleMidiMessage);
          }
        });
      }).catch(() => undefined);
    }
  }

  // --- MAX / ABLETON LIVE jweb~ BRIDGE ---
  private setupMaxBridge() {
    const max = (window as any).max;
    if (typeof max !== 'undefined') {
      console.log('[Centauro] Max jweb bridge detected. Binding inlets...');

      if (typeof max.bindInlet === 'function') {
        max.bindInlet('noteon', (note: any, vel: any) => {
          const parsedNote = parseInt(note, 10);
          const parsedVel = vel !== undefined ? parseInt(vel, 10) : 100;
          if (!isNaN(parsedNote)) {
            this.noteOn(parsedNote, parsedVel / 127, false);
          }
        });

        max.bindInlet('noteoff', (note: any) => {
          const parsedNote = parseInt(note, 10);
          if (!isNaN(parsedNote)) {
            this.noteOff(parsedNote, false);
          }
        });

        // Bind raw midiin list messages from Ableton: [status, data1, data2]
        max.bindInlet('midiin', (status: any, d1: any, d2: any) => {
          const stat = parseInt(status, 10);
          const note = parseInt(d1, 10);
          const vel = parseInt(d2, 10);
          if (isNaN(stat) || isNaN(note) || isNaN(vel)) return;

          const type = stat & 0xf0;
          if (type === 144 && vel > 0) {
            this.noteOn(note, vel / 127, false);
          } else if (type === 128 || (type === 144 && vel === 0)) {
            this.noteOff(note, false);
          }
        });

        // Allow setting tuning strings programmatically
        max.bindInlet('tuning', (expr: any) => {
          if (typeof expr === 'string' && expr) {
            this.inputExpr.value = expr;
            this.initTuning(expr);
            if (this.onTuningChange) {
              this.onTuningChange(expr);
            }
          }
        });

        // --- STATE MACHINE FOR RAW INTEGER BYTES ---
        // Used when connecting raw [midiin] object directly to [jweb] (which sends individual integers via 'int' or 'float')
        let midiState = 0; // 0: expecting status, 1: expecting data1, 2: expecting data2
        let currentStatus = 0;
        let data1 = 0;

        const handleMidiByte = (byte: number) => {
          if (byte >= 128) {
            // Status byte (e.g. 144 or 128)
            currentStatus = byte;
            midiState = 1;
          } else {
            // Data byte
            if (midiState === 1) {
              data1 = byte;
              const type = currentStatus & 0xf0;
              if (type === 192 || type === 208) { // Program Change, Channel Pressure (only 1 data byte)
                midiState = 0;
              } else {
                midiState = 2; // expect second data byte
              }
            } else if (midiState === 2) {
              const data2 = byte;
              // Running status support: next bytes can be data1 and data2 for the same active status
              midiState = 1;

              // Dispatch note events
              const type = currentStatus & 0xf0;
              if (type === 144 && data2 > 0) {
                this.noteOn(data1, data2 / 127, false);
              } else if (type === 128 || (type === 144 && data2 === 0)) {
                this.noteOff(data1, false);
              }
            }
          }
        };

        max.bindInlet('int', (val: any) => {
          const byte = parseInt(val, 10);
          if (!isNaN(byte)) {
            handleMidiByte(byte);
          }
        });

        max.bindInlet('float', (val: any) => {
          const byte = Math.round(parseFloat(val));
          if (!isNaN(byte)) {
            handleMidiByte(byte);
          }
        });
      }
    }
  }

  // --- RENDERING ---
  private renderTable() {
    this.tableBody.innerHTML = '';
    // Show C4 mapping (MIDI 60) and 24 chromatic degrees around it
    const startMidi = 48; // C3
    const endMidi = 84;   // C6
    
    for (let midi = startMidi; midi <= endMidi; midi++) {
      const row = this.midiTable[midi];
      if (!row) continue;

      const degreeObj = this.spec.degrees[row.degree];
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>MIDI ${midi}</td>
        <td><strong>${degreeObj.label}</strong> (C${row.cycle})</td>
        <td>${row.cents.toFixed(2)}c</td>
        <td>${row.frequency.toFixed(3)} Hz</td>
      `;
      this.tableBody.appendChild(tr);
    }
  }

  private getCellShape(): 'triangle' | 'square' | 'hex' | 'voronoi' {
    const degs = this.spec.degrees.length;
    if (degs === 3) return 'triangle';
    if (degs === 4) return 'square'; // rhombus
    if (degs === 6) return 'hex';
    return 'voronoi';
  }

  private renderKeyboard() {
    this.keyboardWrapper.innerHTML = '';
    // Retain the touch strip and pitch monitor divs during redraws
    if (this.touchStrip) {
      this.keyboardWrapper.appendChild(this.touchStrip);
    }
    if (this.pitchMonitor) {
      this.keyboardWrapper.appendChild(this.pitchMonitor);
    }

    const shape = this.getCellShape();
    const degreeCount = this.spec.degrees.length;

    // Calculate isomorphic grid step parameters
    let stepX = 1;
    let stepY = 2;

    if (this.spec.source === 'edo') {
      stepX = Math.round(degreeCount * Math.log2(1.5)); // fifth
      stepY = Math.round(degreeCount * Math.log2(1.25)); // major third
    } else {
      stepX = 1;
      stepY = Math.max(2, Math.round(degreeCount / 3));
    }

    const cols = degreeCount > 14 ? 20 : 12;
    const rows = degreeCount > 14 ? 8 : 6;
    const centerCol = Math.floor(cols / 2);
    const centerRow = Math.floor(rows / 2);
    const loopCols = shape === 'triangle' ? cols * 2 : cols;

    // Dynamic sizing based on the keyboard panel container dimensions
    let width = this.keyboardWrapper.clientWidth || 1000;
    let height = this.keyboardWrapper.clientHeight || 500;
    if (height === 0) {
      const rect = this.keyboardWrapper.getBoundingClientRect();
      width = rect.width || 1000;
      height = rect.height || 500;
    }
    if (height === 0) {
      height = 500;
    }

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    svg.style.background = 'rgba(0,0,0,0.3)';
    svg.style.borderRadius = '8px';

    const keysGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    svg.appendChild(keysGroup);

    if (shape === 'voronoi' || shape === 'hex') {
      const allPoints: Array<{ x: number; y: number; dx: number; dy: number; midi: number; degreeObj: any; fillColor: string; borderColor: string }> = [];
      
      const spacingX = width / cols;
      const spacingY = height / rows;

      // Hexagons use hex-lattice grid coordinates with tighter spacing
      const hSpacingX = shape === 'hex' ? width / (cols - 0.5) : spacingX;
      const hSpacingY = shape === 'hex' ? height / (rows - 0.25) : spacingY;

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const dx = c - centerCol;
          const dy = r - centerRow;
          const pitch = dx * stepX + dy * stepY;
          
          let midi = 60 + pitch + this.octaveOffset;
          midi = ((midi % 128) + 128) % 128; // safe wrap with octave transpose

          const rowData = this.midiTable[midi];
          const degreeObj = this.spec.degrees[rowData.degree];

          // Deterministic organic perturbation within the cell box boundaries
          // 10% warp factor for hex, slightly larger 18% for organic voronoi
          const warpFactor = shape === 'hex' ? 0.10 : 0.18;
          const perturbX = Math.sin(midi * 73.1) * (hSpacingX * warpFactor);
          const perturbY = Math.cos(midi * 37.7) * (hSpacingY * warpFactor);

          const x = shape === 'hex'
            ? (c + 0.5 * (r % 2)) * hSpacingX + hSpacingX / 2 + perturbX
            : c * spacingX + spacingX / 2 + perturbX;

          const y = shape === 'hex'
            ? r * hSpacingY + hSpacingY / 2 + perturbY
            : r * spacingY + spacingY / 2 + perturbY;

          const centsNormalized = degreeObj.cents % 1200;
          const hue = (centsNormalized / 1200) * 360;
          const fillColor = `hsla(${hue}, 60%, 42%, 0.8)`;
          const borderColor = `hsla(${hue}, 70%, 55%, 0.5)`;

          allPoints.push({ x, y, dx, dy, midi, degreeObj, fillColor, borderColor });
        }
      }

      // Clip cells using the viewport borders [0, width] and [0, height] to tessellate perfectly
      for (const p0 of allPoints) {
        let cell: Point[] = [
          { x: 0, y: 0 },
          { x: width, y: 0 },
          { x: width, y: height },
          { x: 0, y: height }
        ];

        for (const pJ of allPoints) {
          if (pJ === p0) continue;
          const dist = Math.hypot(pJ.x - p0.x, pJ.y - p0.y);
          if (dist > Math.max(hSpacingX, hSpacingY) * 2.5) continue;

          const xm = (p0.x + pJ.x) / 2;
          const ym = (p0.y + pJ.y) / 2;
          const nx = pJ.x - p0.x;
          const ny = pJ.y - p0.y;

          cell = clipPolygon(cell, xm, ym, nx, ny);
        }

        if (cell.length < 3) continue;

        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        g.setAttribute('class', 'centauro-key-group');
        g.setAttribute('data-midi', p0.midi.toString());

        const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
        const pointsStr = cell.map(pt => `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join(' ');
        poly.setAttribute('points', pointsStr);
        poly.setAttribute('class', 'centauro-key');
        poly.setAttribute('fill', p0.fillColor);
        poly.setAttribute('stroke', p0.borderColor);
        poly.setAttribute('stroke-width', '1.5');
        poly.setAttribute('data-midi', p0.midi.toString());
        g.appendChild(poly);

        drawLabels(p0.x, p0.y, p0.degreeObj, this.mapMode, p0.dx, p0.dy, this.qwertyToGrid, g);

        // Mouse hover glissando events
        g.addEventListener('mousedown', (event) => {
          event.preventDefault();
          this.activePointerNotes.add(p0.midi);
          this.noteOn(p0.midi, 0.5, false);
        });
        g.addEventListener('mouseenter', () => {
          if (this.isMouseDown) {
            this.activePointerNotes.add(p0.midi);
            this.noteOn(p0.midi, 0.5, false);
          }
        });
        g.addEventListener('mouseleave', () => {
          if (this.activePointerNotes.has(p0.midi)) {
            this.activePointerNotes.delete(p0.midi);
            this.noteOff(p0.midi, false);
          }
        });
        g.addEventListener('mouseup', () => {
          if (this.activePointerNotes.has(p0.midi)) {
            this.activePointerNotes.delete(p0.midi);
            this.noteOff(p0.midi, false);
          }
        });

        keysGroup.appendChild(g);
      }
    } else {
      // Classic regular layouts stretched to perfectly cover the container
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < loopCols; c++) {
          let dx = 0;
          let dy = r - centerRow;
          let pitch = 0;

          if (shape === 'triangle') {
            dx = Math.floor(c / 2) - centerCol;
            pitch = (c - cols) * stepX + dy * stepY;
          } else {
            dx = c - centerCol;
            pitch = dx * stepX + dy * stepY;
          }
          
          let midi = 60 + pitch + this.octaveOffset;
          midi = ((midi % 128) + 128) % 128; // safe wrap with octave transpose

          const rowData = this.midiTable[midi];
          const degree = rowData.degree;
          const degreeObj = this.spec.degrees[degree];

          const centsNormalized = degreeObj.cents % 1200;
          const hue = (centsNormalized / 1200) * 360;
          const fillColor = `hsla(${hue}, 60%, 42%, 0.8)`;
          const borderColor = `hsla(${hue}, 70%, 55%, 0.5)`;

          const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
          g.setAttribute('class', 'centauro-key-group');
          g.setAttribute('data-midi', midi.toString());

          if (shape === 'square') {
            // Rhombus (rombo) tiling layout covering 100% of available space
            const hSpacingX = width / (cols - 0.5);
            const hSpacingY = height / (rows - 0.5);

            // Warp grid vertices by 10% to make them organic but still gapless
            const getRomboVertex = (k: number, m: number) => {
              const baseX = k * (hSpacingX / 2);
              const baseY = m * hSpacingY;
              const isEdge = k <= 0 || k >= cols * 2 || m <= 0 || m >= rows;
              const perturbX = isEdge ? 0 : Math.sin(k * 13.7 + m * 31.3) * (hSpacingX * 0.10);
              const perturbY = isEdge ? 0 : Math.cos(k * 23.3 + m * 17.9) * (hSpacingY * 0.10);
              return { x: baseX + perturbX, y: baseY + perturbY };
            };

            const kCenter = 2 * c + (r % 2);
            const p0 = getRomboVertex(kCenter, r - 1);
            const p1 = getRomboVertex(kCenter + 1, r);
            const p2 = getRomboVertex(kCenter, r + 1);
            const p3 = getRomboVertex(kCenter - 1, r);

            const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
            poly.setAttribute('points', `${p0.x.toFixed(1)},${p0.y.toFixed(1)} ${p1.x.toFixed(1)},${p1.y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)} ${p3.x.toFixed(1)},${p3.y.toFixed(1)}`);
            poly.setAttribute('class', 'centauro-key');
            poly.setAttribute('fill', fillColor);
            poly.setAttribute('stroke', borderColor);
            poly.setAttribute('stroke-width', '1.5');
            poly.setAttribute('data-midi', midi.toString());
            g.appendChild(poly);

            // Compute center of warped polygon for text label placement
            const cx = (p0.x + p1.x + p2.x + p3.x) / 4;
            const cy = (p0.y + p1.y + p2.y + p3.y) / 4;
            drawLabels(cx, cy, degreeObj, this.mapMode, dx, dy, this.qwertyToGrid, g);

          } else if (shape === 'triangle') {
            // Double-column triangle tiling layout covering 100% of available space
            const tSpacingX = width / (loopCols - 1);
            const tSpacingY = height / rows;

            // Warp grid vertices by 10% to make them organic but still gapless
            const getTriVertex = (k: number, m: number) => {
              const baseX = k * tSpacingX;
              const baseY = m * tSpacingY;
              const isEdge = k <= 0 || k >= loopCols - 1 || m <= 0 || m >= rows;
              const perturbX = isEdge ? 0 : Math.sin(k * 17.3 + m * 29.1) * (tSpacingX * 0.10);
              const perturbY = isEdge ? 0 : Math.cos(k * 21.7 + m * 13.9) * (tSpacingY * 0.10);
              return { x: baseX + perturbX, y: baseY + perturbY };
            };

            const pointingUp = (c + r) % 2 === 0;
            let p0: Point, p1: Point, p2: Point;

            if (pointingUp) {
              p0 = getTriVertex(c, r);
              p1 = getTriVertex(c + 1, r + 1);
              p2 = getTriVertex(c - 1, r + 1);
            } else {
              p0 = getTriVertex(c, r + 1);
              p1 = getTriVertex(c + 1, r);
              p2 = getTriVertex(c - 1, r);
            }

            const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
            poly.setAttribute('points', `${p0.x.toFixed(1)},${p0.y.toFixed(1)} ${p1.x.toFixed(1)},${p1.y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`);
            poly.setAttribute('class', 'centauro-key');
            poly.setAttribute('fill', fillColor);
            poly.setAttribute('stroke', borderColor);
            poly.setAttribute('stroke-width', '1.5');
            poly.setAttribute('data-midi', midi.toString());
            g.appendChild(poly);

            // Compute center of warped triangle
            const cx = (p0.x + p1.x + p2.x) / 3;
            const cy = (p0.y + p1.y + p2.y) / 3;
            const textYOffset = pointingUp ? 3 : -1;
            drawLabels(cx, cy + textYOffset, degreeObj, this.mapMode, dx, dy, this.qwertyToGrid, g);
          }

          // Mouse hover glissando events
          g.addEventListener('mousedown', (event) => {
            event.preventDefault();
            this.activePointerNotes.add(midi);
            this.noteOn(midi, 0.5, false);
          });
          g.addEventListener('mouseenter', () => {
            if (this.isMouseDown) {
              this.activePointerNotes.add(midi);
              this.noteOn(midi, 0.5, false);
            }
          });
          g.addEventListener('mouseleave', () => {
            if (this.activePointerNotes.has(midi)) {
              this.activePointerNotes.delete(midi);
              this.noteOff(midi, false);
            }
          });
          g.addEventListener('mouseup', () => {
            if (this.activePointerNotes.has(midi)) {
              this.activePointerNotes.delete(midi);
              this.noteOff(midi, false);
            }
          });

          keysGroup.appendChild(g);
        }
      }
    }

    // Touch Glissando Listener on the main SVG container
    const handleTouch = (e: TouchEvent) => {
      e.preventDefault();
      if (e.touches.length === 0) return;
      const touch = e.touches[0];
      const elem = document.elementFromPoint(touch.clientX, touch.clientY);
      if (!elem) return;

      const keyEl = elem.closest('.centauro-key') as HTMLElement;
      if (keyEl) {
        const midi = parseInt(keyEl.dataset.midi || '', 10);
        if (!isNaN(midi)) {
          if (this.activeTouchMidi !== midi) {
            if (this.activeTouchMidi !== null) {
              this.noteOff(this.activeTouchMidi, false);
            }
            this.activeTouchMidi = midi;
            this.noteOn(midi, 0.5, false);
          }
        }
      } else {
        if (this.activeTouchMidi !== null) {
          this.noteOff(this.activeTouchMidi, false);
          this.activeTouchMidi = null;
        }
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      e.preventDefault();
      if (this.activeTouchMidi !== null) {
        this.noteOff(this.activeTouchMidi, false);
        this.activeTouchMidi = null;
      }
    };

    svg.addEventListener('touchstart', handleTouch, { passive: false });
    svg.addEventListener('touchmove', handleTouch, { passive: false });
    svg.addEventListener('touchend', handleTouchEnd, { passive: false });
    svg.addEventListener('touchcancel', handleTouchEnd, { passive: false });

    this.keyboardWrapper.appendChild(svg);
  }

  private highlightKey(midi: number, active: boolean) {
    const keys = this.keyboardWrapper.querySelectorAll(`.centauro-key[data-midi="${midi}"]`);
    keys.forEach(key => {
      key.setAttribute('data-active', active ? 'true' : 'false');
    });
  }

  // --- HELMHOLTZ-ELLIS PITCH MONITOR ---
  private precalculateHejiAccidentals() {
    if (!this.midiTable) return;
    for (let midi = 0; midi < this.midiTable.length; midi++) {
      const row = this.midiTable[midi];
      if (!row) continue;

      const pc = midi % 12;
      const dev = row.centsFrom12TET;
      const options = SPELLING_OPTIONS[pc] || [{ name: 'C', baseChar: 'n', pythDev: 0.0 }];

      let bestOption = options[0];
      let bestS = 0;
      let minError = Infinity;

      // Tempered pitch check (bypass microtonal arrow commas if close to 12-TET step)
      const isTempered = Math.abs(dev) < 3.0;

      for (const option of options) {
        // We only test syntonic commas (S from -2 to 2) to get exactly ONE accidental character
        const S_list = isTempered ? [0] : [-2, -1, 0, 1, 2];
        for (const S of S_list) {
          const approx = option.pythDev + S * 21.506;
          const err = Math.abs(dev - approx);
          if (err < minError) {
            minError = err;
            bestOption = option;
            bestS = S;
          }
        }
      }

      // 1. Accidental base character (exactly one HEJI character)
      row.hejiAccidental = getSyntonicBaseChar(bestOption.baseChar, bestS);

      // 2. Cents residual offset as discrete numeric superscript (+ or - cents)
      const remaining = dev - (bestOption.pythDev + bestS * 21.506);
      const offset = Math.round(remaining);
      if (!isTempered && Math.abs(offset) >= 1) {
        row.hejiOffset = offset;
      } else {
        row.hejiOffset = undefined;
      }
    }
  }

  private getHejiAccidental(midi: number): string {
    const row = this.midiTable[midi];
    return row?.hejiAccidental || 'n';
  }

  private updatePitchMonitor() {
    if (!this.pitchMonitor) return;

    // Retrieve sorted MIDI keys in descending order (highest pitches/frequencies at the top)
    const activeMidis = Array.from(this.activeVoices.keys()).sort((a, b) => b - a);

    if (activeMidis.length === 0) {
      this.pitchMonitor.innerHTML = '<div class="centauro-monitor-empty">Monitor listo</div>';
      return;
    }

    let html = '';
    for (const midi of activeMidis) {
      const row = this.midiTable[midi];
      if (!row) continue;

      const accidental = this.getHejiAccidental(midi);
      const freqStr = `${row.frequency.toFixed(2)} Hz`;
      
      const dev = row.centsFrom12TET;
      const devStr = dev === 0 
        ? '0.00c' 
        : `${dev > 0 ? '+' : ''}${dev.toFixed(2)}c`;
      
      const devClass = dev > 0.05 
        ? 'pos' 
        : (dev < -0.05 ? 'neg' : 'zero');

      html += `
        <div class="centauro-monitor-row">
          <div class="centauro-monitor-accidental">
            ${accidental}${row.hejiOffset !== undefined ? `<sup style="font-size: 11px; vertical-align: super; font-family: monospace; color: #ffd966; margin-left: 2px;">${row.hejiOffset > 0 ? '+' : ''}${row.hejiOffset}</sup>` : ''}
          </div>
          <div class="centauro-monitor-freq">${freqStr}</div>
          <div class="centauro-monitor-deviation ${devClass}">${devStr}</div>
        </div>
      `;
    }
    this.pitchMonitor.innerHTML = html;
  }

  // --- MODALS & EXPORTS ---
  private openTunModal() {
    const generated = exportTun(this.spec, this.midiTable);
    this.modalTextArea.value = generated;
    this.modal.showModal();
  }

  private downloadTunFile() {
    const generated = exportTun(this.spec, this.midiTable);
    this.downloadTextAsFile(generated, 'centauro_tuning.tun');
  }

  private downloadTextAsFile(text: string, filename: string) {
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  public dispose() {
    this.stopDrone();
    for (const midi of this.activeVoices.keys()) {
      this.noteOff(midi, true);
    }
    window.removeEventListener('keydown', this.handleKeyDown);
    window.removeEventListener('keyup', this.handleKeyUp);
  }

  private getShareUrl(expr?: string): string {
    const activeExpr = expr || this.inputExpr.value.trim();
    const origin = window.location.origin;
    return `${origin}/centauro?${encodeURIComponent(activeExpr)}`;
  }
}

function p2yDist(y1: number, y2: number): number {
  return y1 - y2;
}

function drawLabels(
  x: number,
  y: number,
  degreeObj: any,
  mapMode: string,
  dx: number,
  dy: number,
  qwertyToGrid: Record<string, { dx: number; dy: number }>,
  g: SVGElement
) {
  // Find QWERTY key mapped to this dx, dy in isomorphic mode
  let qwertyLabel = '';
  if (mapMode === 'isomorphic') {
    const keys = Object.keys(qwertyToGrid);
    const keyFound = keys.find(k => {
      const coord = qwertyToGrid[k];
      return coord.dx === dx && coord.dy === dy;
    });
    if (keyFound) {
      qwertyLabel = ` [${keyFound.toUpperCase()}]`;
    }
  }

  const textDeg = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  textDeg.setAttribute('x', x.toString());
  textDeg.setAttribute('y', (y - 5).toString());
  textDeg.setAttribute('class', 'centauro-key-text');
  textDeg.style.fontSize = '10px';
  textDeg.textContent = degreeObj.label;
  g.appendChild(textDeg);

  const textCents = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  textCents.setAttribute('x', x.toString());
  textCents.setAttribute('y', (y + 8).toString());
  textCents.setAttribute('class', 'centauro-key-subtext');
  textCents.style.fontSize = '8px';
  textCents.textContent = `${Math.round(degreeObj.cents)}c${qwertyLabel}`;
  g.appendChild(textCents);
}
