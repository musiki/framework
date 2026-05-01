import { Renderer, Stave, StaveNote, Formatter, Accidental, Voice } from 'vexflow';

export class InstantScoreController {
  private container: HTMLElement;
  private renderer: any;
  private context: any;
  private activeNotes = new Set<number>();
  private resizeObserver: ResizeObserver;
  private boundOnNoteOn = (e: any) => this.addNote(e.detail.note);
  private boundOnNoteOff = (e: any) => this.removeNote(e.detail.note);

  constructor(container: HTMLElement) {
    this.container = container;
    this.resizeObserver = new ResizeObserver(() => this.render());
    this.resizeObserver.observe(this.container);
    
    window.addEventListener('musiki:note:on', this.boundOnNoteOn);
    window.addEventListener('musiki:note:off', this.boundOnNoteOff);
    
    this.render();
  }

  public addNote(midiNote: number) {
    this.activeNotes.add(midiNote);
    this.render();
  }

  public removeNote(midiNote: number) {
    this.activeNotes.delete(midiNote);
    this.render();
  }

  public clear() {
    this.activeNotes.clear();
    this.render();
  }

  private render() {
    if (!this.container) return;
    this.container.innerHTML = '';
    
    const width = this.container.offsetWidth || 300;
    const height = this.container.offsetHeight || 150;
    
    this.renderer = new Renderer(this.container, Renderer.Backends.SVG);
    this.renderer.resize(width, height);
    this.context = this.renderer.getContext();

    // Force white ink for the score pod (on dark background)
    const inkColor = '#fff';
    
    // Reactive scale
    const scale = Math.min(width / 250, height / 180, 3.5); 
    this.context.scale(scale, scale);
    this.context.setFillStyle(inkColor);
    this.context.setStrokeStyle(inkColor);

    const scaledWidth = width / scale;
    const scaledHeight = height / scale;
    
    const staveWidth = Math.max(140, scaledWidth / 1.5);
    const x = (scaledWidth - staveWidth) / 2;
    const centerY = scaledHeight / 2;

    const topStave = new Stave(x, centerY - 80, staveWidth);
    topStave.addClef('treble');
    topStave.setStyle({ fillStyle: inkColor, strokeStyle: inkColor });
    topStave.setContext(this.context).draw();

    const bottomStave = new Stave(x, centerY + 0, staveWidth);
    bottomStave.addClef('bass');
    bottomStave.setStyle({ fillStyle: inkColor, strokeStyle: inkColor });
    bottomStave.setContext(this.context).draw();

    if (this.activeNotes.size === 0) return;

    // Split notes
    const trebleKeys: string[] = [];
    const bassKeys: string[] = [];
    
    Array.from(this.activeNotes).sort((a,b) => a-b).forEach(midi => {
      const vexName = this.midiToVex(midi);
      if (midi >= 60) trebleKeys.push(vexName);
      else bassKeys.push(vexName);
    });

    // Render Treble Voice
    if (trebleKeys.length > 0) {
        const chord = new StaveNote({ clef: 'treble', keys: trebleKeys, duration: 'w' });
        chord.setStyle({ fillStyle: inkColor, strokeStyle: inkColor });
        this.addAccidentals(chord, trebleKeys, inkColor);
        
        const voice = new Voice({ num_beats: 4, beat_value: 4 });
        voice.addTickables([chord]);
        new Formatter().joinVoices([voice]).format([voice], staveWidth - 40);
        voice.draw(this.context, topStave);
    }

    // Render Bass Voice
    if (bassKeys.length > 0) {
        const chord = new StaveNote({ clef: 'bass', keys: bassKeys, duration: 'w' });
        chord.setStyle({ fillStyle: inkColor, strokeStyle: inkColor });
        this.addAccidentals(chord, bassKeys, inkColor);

        const voice = new Voice({ num_beats: 4, beat_value: 4 });
        voice.addTickables([chord]);
        new Formatter().joinVoices([voice]).format([voice], staveWidth - 40);
        voice.draw(this.context, bottomStave);
    }
  }

  private addAccidentals(note: StaveNote, keys: string[], color: string) {
    keys.forEach((key, i) => {
        // Correct check: B natural (b/4) vs accidental flat (bb/4)
        // Note part is before '/', Accidental is everything after index 0
        const noteNamePart = key.split('/')[0];
        const accidental = noteNamePart.slice(1); // will be '#' or '' in current mapping
        
        if (accidental === '#') {
            const acc = new Accidental('#');
            acc.setStyle({ fillStyle: color, strokeStyle: color });
            note.addModifier(acc, i);
        } else if (accidental === 'b') {
            const acc = new Accidental('b');
            acc.setStyle({ fillStyle: color, strokeStyle: color });
            note.addModifier(acc, i);
        }
    });
  }

  private midiToVex(midi: number): string {
    // Standard sharp-based mapping for now
    const NAMES = ['c', 'c#', 'd', 'd#', 'e', 'f', 'f#', 'g', 'g#', 'a', 'a#', 'b'];
    const octave = Math.floor(midi / 12) - 1;
    const name = NAMES[midi % 12];
    return `${name}/${octave}`;
  }

  public dispose() {
    this.resizeObserver.disconnect();
    window.removeEventListener('musiki:note:on', this.boundOnNoteOn);
    window.removeEventListener('musiki:note:off', this.boundOnNoteOff);
  }
}
