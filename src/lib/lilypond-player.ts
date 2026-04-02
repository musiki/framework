export interface ParsedMidiEvent {
  ticks: number;
  message: number[];
  channel?: number;
}

export interface TempoEvent {
  ticks: number;
  microsecondsPerQuarter: number;
}

export interface MidiSequence {
  durationMs: number;
  events: Array<{
    timeMs: number;
    message: number[];
    channel?: number;
  }>;
  usedChannels: number[];
}

export interface SvgLocationGroup {
  svgEl: SVGSVGElement;
  elements: SVGElement[];
  centerX: number;
  centerY: number;
  topLineEl: SVGGraphicsElement | null;
  bottomLineEl: SVGGraphicsElement | null;
}

export interface FollowerTimeGroup {
  timeMs: number;
}

export interface SvgSystemRange {
  topLineEl: SVGGraphicsElement;
  bottomLineEl: SVGGraphicsElement;
  topY: number;
  bottomY: number;
  centerY: number;
}

export interface SvgMarkerPosition {
  element: SVGElement;
  svgEl: SVGSVGElement;
  svgIndex: number;
  centerX: number;
  centerY: number;
  topLineEl: SVGGraphicsElement | null;
  bottomLineEl: SVGGraphicsElement | null;
}

interface SvgPointLike {
  x: number;
  y: number;
}

export interface SvgPlaybackFollower {
  update(timeMs: number): void;
  reset(): void;
  destroy(): void;
}

// ---------------------------------------------------------
// MIDI PARSER
// ---------------------------------------------------------
class ByteReader {
  private offset = 0;

  constructor(private readonly data: Uint8Array) {}

  readString(length: number): string {
    const value = this.data.subarray(this.offset, this.offset + length);
    this.offset += length;
    // Using simple ASCII decode for chunk types
    return Array.from(value)
      .map((b) => String.fromCharCode(b))
      .join('');
  }

  readUint8(): number {
    return this.data[this.offset++];
  }

  readUint16(): number {
    const value = (this.data[this.offset] << 8) | this.data[this.offset + 1];
    this.offset += 2;
    return value;
  }

  readUint32(): number {
    const value =
      this.data[this.offset] * 0x1000000 +
      ((this.data[this.offset + 1] << 16) |
        (this.data[this.offset + 2] << 8) |
        this.data[this.offset + 3]);
    this.offset += 4;
    return value >>> 0;
  }

  readBytes(length: number): Uint8Array {
    const value = this.data.subarray(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  readVarInt(): number {
    let value = 0;

    while (true) {
      const byte = this.readUint8();
      value = (value << 7) | (byte & 0x7f);

      if ((byte & 0x80) === 0) {
        return value;
      }
    }
  }

  getPosition(): number {
    return this.offset;
  }

  setPosition(position: number): void {
    this.offset = position;
  }
}

export function parseMidiBuffer(buffer: ArrayBuffer): MidiSequence {
  const reader = new ByteReader(new Uint8Array(buffer));
  const headerChunk = reader.readString(4);

  if (headerChunk !== 'MThd') {
    throw new Error('Invalid MIDI header.');
  }

  const headerLength = reader.readUint32();
  const format = reader.readUint16();
  const trackCount = reader.readUint16();
  const division = reader.readUint16();

  if (format > 2) {
    throw new Error(`Unsupported MIDI format ${format}.`);
  }

  if ((division & 0x8000) !== 0) {
    throw new Error('SMPTE MIDI timing is not supported.');
  }

  const ticksPerQuarterNote = division;
  reader.setPosition(8 + headerLength);

  const tempoEvents: TempoEvent[] = [{ ticks: 0, microsecondsPerQuarter: 500000 }];
  const parsedEvents: ParsedMidiEvent[] = [];

  for (let trackIndex = 0; trackIndex < trackCount; trackIndex += 1) {
    parseTrack(reader, parsedEvents, tempoEvents);
  }

  tempoEvents.sort((left, right) => left.ticks - right.ticks);
  parsedEvents.sort((left, right) => left.ticks - right.ticks);

  let tempoIndex = 0;
  let currentTempo = tempoEvents[tempoIndex].microsecondsPerQuarter;
  let currentTempoTick = tempoEvents[tempoIndex].ticks;
  let currentTimeMs = 0;
  let durationMs = 0;

  const events = parsedEvents.map((event) => {
    while (
      tempoIndex + 1 < tempoEvents.length &&
      tempoEvents[tempoIndex + 1].ticks <= event.ticks
    ) {
      const nextTempo = tempoEvents[tempoIndex + 1];
      currentTimeMs += ticksToMilliseconds(
        nextTempo.ticks - currentTempoTick,
        currentTempo,
        ticksPerQuarterNote
      );
      currentTempo = nextTempo.microsecondsPerQuarter;
      currentTempoTick = nextTempo.ticks;
      tempoIndex += 1;
    }

    const timeMs =
      currentTimeMs +
      ticksToMilliseconds(event.ticks - currentTempoTick, currentTempo, ticksPerQuarterNote);
    durationMs = Math.max(durationMs, timeMs);

    return {
      timeMs,
      message: event.message,
      channel: event.channel,
    };
  });

  const usedChannels = Array.from(
    new Set(events.flatMap((event) => (event.channel === undefined ? [] : [event.channel])))
  ).sort((left, right) => left - right);

  return {
    durationMs,
    events,
    usedChannels,
  };
}

function parseTrack(
  reader: ByteReader,
  parsedEvents: ParsedMidiEvent[],
  tempoEvents: TempoEvent[]
): void {
  const chunkType = reader.readString(4);

  if (chunkType !== 'MTrk') {
    throw new Error('Invalid MIDI track chunk.');
  }

  const trackLength = reader.readUint32();
  const trackEnd = reader.getPosition() + trackLength;
  let absoluteTicks = 0;
  let runningStatus = 0;

  while (reader.getPosition() < trackEnd) {
    absoluteTicks += reader.readVarInt();

    let status = reader.readUint8();

    if (status < 0x80) {
      if (runningStatus === 0) {
        throw new Error('Invalid running status in MIDI track.');
      }

      reader.setPosition(reader.getPosition() - 1);
      status = runningStatus;
    } else if (status < 0xf0) {
      runningStatus = status;
    }

    if (status === 0xff) {
      runningStatus = 0;
      const metaType = reader.readUint8();
      const length = reader.readVarInt();
      const data = reader.readBytes(length);

      if (metaType === 0x51 && length === 3) {
        tempoEvents.push({
          ticks: absoluteTicks,
          microsecondsPerQuarter: (data[0] << 16) | (data[1] << 8) | data[2],
        });
      }

      continue;
    }

    if (status === 0xf0 || status === 0xf7) {
      runningStatus = 0;
      const length = reader.readVarInt();
      reader.readBytes(length);
      continue;
    }

    const eventType = status >> 4;
    const channel = status & 0x0f;

    switch (eventType) {
      case 0x8: {
        const note = reader.readUint8();
        const velocity = reader.readUint8();
        parsedEvents.push({
          ticks: absoluteTicks,
          message: [status, note, velocity],
          channel,
        });
        break;
      }
      case 0x9: {
        const note = reader.readUint8();
        const velocity = reader.readUint8();
        parsedEvents.push({
          ticks: absoluteTicks,
          message: velocity === 0 ? [0x80 | channel, note, 0] : [status, note, velocity],
          channel,
        });
        break;
      }
      case 0xa:
      case 0xb:
      case 0xe: {
        const valueA = reader.readUint8();
        const valueB = reader.readUint8();
        parsedEvents.push({
          ticks: absoluteTicks,
          message: [status, valueA, valueB],
          channel,
        });
        break;
      }
      case 0xc:
      case 0xd: {
        const value = reader.readUint8();
        parsedEvents.push({
          ticks: absoluteTicks,
          message: [status, value],
          channel,
        });
        break;
      }
      default:
        throw new Error(`Unsupported MIDI event type 0x${status.toString(16)}.`);
    }
  }

  reader.setPosition(trackEnd);
}

function ticksToMilliseconds(
  ticks: number,
  microsecondsPerQuarter: number,
  ticksPerQuarterNote: number
): number {
  return (ticks * microsecondsPerQuarter) / ticksPerQuarterNote / 1000;
}

// ---------------------------------------------------------
// AUDIO SAMPLER
// ---------------------------------------------------------

const PIANO_SAMPLES = [
  '/inc/samples-piano/C1.mp3',
  '/inc/samples-piano/C2.mp3',
  '/inc/samples-piano/C3.mp3',
  '/inc/samples-piano/C4.mp3',
  '/inc/samples-piano/C5.mp3',
  '/inc/samples-piano/C6.mp3',
  '/inc/samples-piano/C7.mp3',
  '/inc/samples-piano/C8.mp3',
];

export class MiniSampler {
  private ctx: AudioContext | null = null;
  private buffers: Map<number, AudioBuffer> = new Map();
  private fetching: Map<number, Promise<void>> = new Map();
  private activeVoices: Map<number, Set<{ source: AudioBufferSourceNode; gain: GainNode }>> =
    new Map();
  public initialized = false;

  async init() {
    if (!this.ctx) {
      const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) {
        console.warn('Web Audio API not supported.');
        return;
      }
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
    this.initialized = true;
  }

  async loadSample(octave: number) {
    if (!this.ctx) return;
    if (this.buffers.has(octave)) return;
    if (this.fetching.has(octave)) {
      await this.fetching.get(octave);
      return;
    }
    const idx = Math.max(0, Math.min(PIANO_SAMPLES.length - 1, octave - 1));
    const url = PIANO_SAMPLES[idx];

    const promise = fetch(url)
      .then((res) => res.arrayBuffer())
      .then((buf) => this.ctx!.decodeAudioData(buf))
      .then((audioBuf) => {
        this.buffers.set(octave, audioBuf);
      })
      .catch((err) => {
        console.warn(`Failed to load sample for octave ${octave}:`, err);
      });
    this.fetching.set(octave, promise);
    await promise;
  }

  async preloadUsedOctaves(sequence: MidiSequence) {
    const octavesToFetch = new Set<number>();
    for (const event of sequence.events) {
      const status = event.message[0] & 0xf0;
      if (status === 0x90) {
        const note = event.message[1];
        const { octave } = this.getBestSampleForNote(note);
        octavesToFetch.add(octave);
      }
    }
    const promises = Array.from(octavesToFetch).map((oct) => this.loadSample(oct));
    await Promise.all(promises);
  }

  private getBestSampleForNote(midiNote: number) {
    const rem = midiNote % 12;
    let baseC = midiNote - rem;
    if (rem > 6) {
      baseC += 12; // Snap to the C above if we are G or higher
    }
    let octave = baseC / 12 - 1;
    if (octave < 1) octave = 1;
    if (octave > 8) octave = 8;
    return {
      octave,
      playbackRate: Math.pow(2, (midiNote - (octave + 1) * 12) / 12),
    };
  }

  private mapVelocityToGain(velocity: number) {
    const minVelocity = 20;
    const maxVelocity = 127;
    const minGain = 0.1;
    const maxGain = 1;
    const curveExponent = 1.9;
    const clampedVelocity = Math.max(minVelocity, Math.min(velocity, maxVelocity));
    const normalized = (clampedVelocity - minVelocity) / (maxVelocity - minVelocity);
    const curved = Math.pow(normalized, curveExponent);

    return minGain + curved * (maxGain - minGain);
  }

  playNote(midiNote: number, velocity: number) {
    if (!this.ctx || !this.initialized) return;
    if (velocity === 0) {
      this.stopNote(midiNote);
      return;
    }

    const { octave, playbackRate } = this.getBestSampleForNote(midiNote);

    if (!this.buffers.has(octave)) {
      this.loadSample(octave);
      return;
    }

    const source = this.ctx.createBufferSource();
    source.buffer = this.buffers.get(octave)!;
    source.playbackRate.value = playbackRate;

    const gain = this.ctx.createGain();
    const peakGain = this.mapVelocityToGain(velocity);
    gain.gain.value = peakGain;

    source.connect(gain);
    gain.connect(this.ctx.destination);
    source.start();

    // Natural piano decay if not stopped early
    gain.gain.setTargetAtTime(0, this.ctx.currentTime + 0.1, 1.2);

    const voice = { source, gain };
    if (!this.activeVoices.has(midiNote)) {
      this.activeVoices.set(midiNote, new Set());
    }
    this.activeVoices.get(midiNote)!.add(voice);

    source.onended = () => {
      this.activeVoices.get(midiNote)?.delete(voice);
      source.disconnect();
      gain.disconnect();
    };
  }

  stopNote(midiNote: number) {
    if (!this.ctx || !this.initialized) return;
    const voices = this.activeVoices.get(midiNote);
    if (voices) {
      const now = this.ctx.currentTime;
      for (const voice of voices) {
        voice.gain.gain.cancelScheduledValues(now);
        voice.gain.gain.setTargetAtTime(0, now, 0.05); // Fast fade out (damper)
      }
    }
  }

  stopAll() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    for (const voices of this.activeVoices.values()) {
      for (const voice of voices) {
        voice.gain.gain.cancelScheduledValues(now);
        voice.gain.gain.setTargetAtTime(0, now, 0.05);
      }
    }
  }

  destroy() {
    this.stopAll();
    if (this.ctx) {
      this.ctx.close();
      this.ctx = null;
    }
    this.initialized = false;
  }
}

// ---------------------------------------------------------
// MIDI PLAYBACK CONTROLLER
// ---------------------------------------------------------

export class WebMidiPlaybackController {
  private timeoutIds: number[] = [];
  private progressTimer: number | null = null;
  private finishTimer: number | null = null;
  private playing = false;
  private lastProgressRatio = 0;

  constructor(
    private readonly sampler: MiniSampler,
    private readonly sequence: MidiSequence,
    private readonly callbacks: {
      onProgress: (ratio: number) => void;
      onStateChange: (isPlaying: boolean) => void;
    }
  ) {}

  isPlaying(): boolean {
    return this.playing;
  }

  async play(): Promise<void> {
    this.stop(false);

    if (this.sequence.events.length === 0) {
      this.callbacks.onProgress(0);
      return;
    }

    await this.sampler.init();

    this.playing = true;
    this.callbacks.onStateChange(true);
    this.lastProgressRatio = 0;
    this.emitProgress(0, true);

    const startedAt = performance.now();

    for (const event of this.sequence.events) {
      const timeoutId = window.setTimeout(() => {
        const status = event.message[0] & 0xf0;
        if (status === 0x90) {
          const note = event.message[1];
          const velocity = event.message[2];
          const ratio =
            this.sequence.durationMs === 0 ? 0 : Math.min(event.timeMs / this.sequence.durationMs, 1);
          this.emitProgress(ratio);
          this.sampler.playNote(note, velocity);
        } else if (status === 0x80) {
          const note = event.message[1];
          this.sampler.stopNote(note);
        }
      }, event.timeMs);

      this.timeoutIds.push(timeoutId);
    }

    this.progressTimer = window.setInterval(() => {
      const elapsedMs = performance.now() - startedAt;
      const ratio =
        this.sequence.durationMs === 0 ? 0 : Math.min(elapsedMs / this.sequence.durationMs, 1);
      this.emitProgress(ratio);
    }, 16);

    this.finishTimer = window.setTimeout(() => {
      this.finish();
    }, this.sequence.durationMs + 30);
  }

  stop(resetProgress = true): void {
    if (!this.playing && this.timeoutIds.length === 0 && this.progressTimer === null) {
      if (resetProgress) {
        this.lastProgressRatio = 0;
        this.emitProgress(0, true);
      }
      return;
    }

    for (const timeoutId of this.timeoutIds) {
      window.clearTimeout(timeoutId);
    }
    this.timeoutIds = [];

    if (this.progressTimer !== null) {
      window.clearInterval(this.progressTimer);
      this.progressTimer = null;
    }

    if (this.finishTimer !== null) {
      window.clearTimeout(this.finishTimer);
      this.finishTimer = null;
    }

    this.sampler.stopAll();
    this.playing = false;
    this.callbacks.onStateChange(false);

    if (resetProgress) {
      this.lastProgressRatio = 0;
      this.emitProgress(0, true);
    }
  }

  destroy(): void {
    this.stop(false);
  }

  private finish(): void {
    for (const timeoutId of this.timeoutIds) {
      window.clearTimeout(timeoutId);
    }
    this.timeoutIds = [];

    if (this.progressTimer !== null) {
      window.clearInterval(this.progressTimer);
      this.progressTimer = null;
    }

    if (this.finishTimer !== null) {
      window.clearTimeout(this.finishTimer);
      this.finishTimer = null;
    }

    this.sampler.stopAll();
    this.playing = false;
    this.lastProgressRatio = 1;
    this.emitProgress(1, true);
    this.callbacks.onStateChange(false);
  }

  private emitProgress(ratio: number, allowBackward = false): void {
    const clampedRatio = Math.max(0, Math.min(ratio, 1));
    const nextRatio = allowBackward ? clampedRatio : Math.max(this.lastProgressRatio, clampedRatio);
    this.lastProgressRatio = nextRatio;
    this.callbacks.onProgress(nextRatio);
  }
}

// ---------------------------------------------------------
// SVG TRACKING AND PLAYBAR UI
// ---------------------------------------------------------

function getSvgAnchorHref(element: SVGElement): string | null {
  return (
    element.getAttribute('data-lily-anchor-href') ??
    element.getAttribute('href') ??
    element.getAttributeNS('http://www.w3.org/1999/xlink', 'href')
  );
}

function normalizeSvgInlineStyle(styleText: string, baseInkColor: string): string {
  return String(styleText || '')
    .replace(/color\s*:\s*inherit/gi, `color:${baseInkColor}`)
    .replace(/color\s*:\s*currentColor/gi, `color:${baseInkColor}`)
    .replace(/fill\s*:\s*currentColor/gi, `fill:${baseInkColor}`)
    .replace(/stroke\s*:\s*currentColor/gi, `stroke:${baseInkColor}`)
    .replace(/currentColor/gi, baseInkColor)
    .split(';')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .join(';');
}

function sanitizeLilypondSvg(svgEl: SVGSVGElement) {
  const baseInkColor = '#222939';
  svgEl.style.setProperty('color', baseInkColor, 'important');
  svgEl.setAttribute('color', baseInkColor);
  svgEl.querySelectorAll('*').forEach((node) => {
    if (!(node instanceof SVGElement)) return;

    if (/^currentcolor$/i.test(node.getAttribute('fill') || '')) {
      node.setAttribute('fill', baseInkColor);
    }
    if (/^currentcolor$/i.test(node.getAttribute('stroke') || '')) {
      node.setAttribute('stroke', baseInkColor);
    }
    if (/^currentcolor$/i.test(node.getAttribute('color') || '')) {
      node.setAttribute('color', baseInkColor);
    }

    const styleText = node.getAttribute('style');
    if (styleText) {
      const normalizedStyle = normalizeSvgInlineStyle(styleText, baseInkColor);
      if (normalizedStyle) {
        node.setAttribute('style', normalizedStyle);
      } else {
        node.removeAttribute('style');
      }
    }
  });
  svgEl.querySelectorAll('style').forEach((styleNode) => {
    styleNode.textContent = normalizeSvgInlineStyle(styleNode.textContent || '', baseInkColor);
  });

  Array.from(svgEl.getElementsByTagNameNS('http://www.w3.org/2000/svg', 'a')).forEach((anchor) => {
    if (!(anchor instanceof SVGElement)) return;
    const href = getSvgAnchorHref(anchor);
    if (href?.startsWith('textedit:')) {
      anchor.setAttribute('data-lily-anchor-href', href);
      anchor.classList.add('lily-note-anchor');
      anchor.removeAttribute('href');
      anchor.removeAttributeNS('http://www.w3.org/1999/xlink', 'href');
    }
    anchor.style.setProperty('color', baseInkColor, 'important');
    anchor.style.setProperty('text-decoration', 'none');
    anchor.setAttribute('color', baseInkColor);
  });
}

function extractSvgSystemRanges(svgEl: SVGSVGElement): SvgSystemRange[] {
  const lineElements = Array.from(svgEl.querySelectorAll('line, path'))
    .filter(
      (el): el is SVGGraphicsElement => el instanceof SVGLineElement || el instanceof SVGPathElement
    )
    .map((el) => {
      let box: SVGRect | null = null;
      try {
        box = el.getBBox();
      } catch (_error) {
        box = null;
      }
      if (!box || box.width === 0) return null;

      const isHorizontal = box.width > box.height * 1.2;
      const isWide = box.width > 0.8;
      const isThin = box.height < 25;

      const cls = el.getAttribute('class') || '';
      const id = el.getAttribute('id') || '';
      const isStaffSymbol =
        cls.includes('staff-symbol') ||
        cls.includes('staff-line') ||
        id.includes('StaffSymbol') ||
        el.parentElement?.classList.contains('staff-symbol') ||
        el.parentElement?.parentElement?.classList.contains('staff-symbol') ||
        el.parentElement?.parentElement?.parentElement?.classList.contains('staff-symbol');

      if ((isHorizontal && isWide && isThin) || isStaffSymbol) {
        return { line: el, centerY: box.y + box.height / 2 };
      }
      return null;
    })
    .filter((entry): entry is { line: SVGGraphicsElement; centerY: number } => entry !== null)
    .sort((left, right) => left.centerY - right.centerY);

  if (lineElements.length === 0) return [];

  const dedupedLines: Array<{ line: SVGGraphicsElement; centerY: number }> = [];
  for (const lineEntry of lineElements) {
    const previous = dedupedLines[dedupedLines.length - 1];
    if (previous && Math.abs(previous.centerY - lineEntry.centerY) <= 0.05) {
      continue;
    }
    dedupedLines.push(lineEntry);
  }

  const gaps: number[] = [];
  for (let index = 1; index < dedupedLines.length; index += 1) {
    const gap = dedupedLines[index].centerY - dedupedLines[index - 1].centerY;
    if (gap > 0.01) gaps.push(gap);
  }

  const baseGap = gaps.length > 0 ? Math.min(...gaps) : 1;
  const staffBreakGap = baseGap * 2.2;
  const systems: SvgSystemRange[] = [];
  let currentStaff: Array<{ line: SVGGraphicsElement; centerY: number }> = [];

  const pushStaff = (staffLines: Array<{ line: SVGGraphicsElement; centerY: number }>) => {
    if (staffLines.length === 0) return;

    for (let index = 0; index < staffLines.length; index += 5) {
      const chunk = staffLines.slice(index, index + 5);
      if (chunk.length < 2) continue;

      const topLine = chunk[0];
      const bottomLine = chunk[chunk.length - 1];
      systems.push({
        topLineEl: topLine.line,
        bottomLineEl: bottomLine.line,
        topY: topLine.centerY,
        bottomY: bottomLine.centerY,
        centerY: (topLine.centerY + bottomLine.centerY) / 2,
      });
    }
  };

  for (const lineEntry of dedupedLines) {
    const previous = currentStaff[currentStaff.length - 1];
    const gap = previous ? lineEntry.centerY - previous.centerY : 0;

    if (currentStaff.length >= 5 || gap > staffBreakGap) {
      pushStaff(currentStaff);
      currentStaff = [];
    }

    currentStaff.push(lineEntry);
  }

  pushStaff(currentStaff);
  return systems;
}

function findSystemRangeForY(systems: SvgSystemRange[], centerY: number): SvgSystemRange | null {
  if (systems.length === 0) return null;

  for (const system of systems) {
    if (centerY >= system.topY - 0.5 && centerY <= system.bottomY + 0.5) return system;
  }

  return systems.reduce((closest, current) => {
    if (!closest) return current;
    const currentDistance = Math.abs(current.centerY - centerY);
    const closestDistance = Math.abs(closest.centerY - centerY);
    return currentDistance < closestDistance ? current : closest;
  }, null as SvgSystemRange | null);
}

function extractMidiTimeGroups(sequence: MidiSequence): FollowerTimeGroup[] {
  const timeGroups: FollowerTimeGroup[] = [];
  let previousTimeMs: number | null = null;

  for (const event of sequence.events) {
    const status = event.message[0] & 0xf0;
    const velocity = event.message[2] ?? 0;
    if (status !== 0x90 || velocity === 0) continue;
    if (previousTimeMs !== null && Math.abs(event.timeMs - previousTimeMs) < 0.01) continue;

    timeGroups.push({ timeMs: event.timeMs });
    previousTimeMs = event.timeMs;
  }

  return timeGroups;
}

function isLikelyTimingAnchor(
  element: SVGElement,
  box: SVGRect,
  anchorPoint: SvgPointLike,
  systemRange: SvgSystemRange | null,
): boolean {
  if (element.querySelector('text')) return false;

  const hasShape = Boolean(element.querySelector('path, ellipse, circle, rect, polygon, use'));
  const hasLine = Boolean(element.querySelector('line'));

  if (!hasShape && hasLine) return false;
  if (box.width <= 0.01 && box.height <= 0.01) return false;

  if (systemRange) {
    const staffSpace = Math.max((systemRange.bottomY - systemRange.topY) / 4, 0.5);
    if (anchorPoint.y < systemRange.topY - staffSpace * 3.25) return false;
    if (anchorPoint.y > systemRange.bottomY + staffSpace * 2.5) return false;
  }

  return true;
}

function getPrimaryAnchorGraphicElement(anchor: SVGElement): SVGGraphicsElement | null {
  const graphic = anchor.querySelector('path, ellipse, circle, rect, polygon, use, line');
  return graphic instanceof SVGGraphicsElement ? graphic : null;
}

function getAnchorBoundingBox(anchor: SVGElement): SVGRect | null {
  try {
    return (anchor as unknown as SVGGraphicsElement).getBBox();
  } catch (_error) {
    try {
      return getPrimaryAnchorGraphicElement(anchor)?.getBBox() ?? null;
    } catch {
      return null;
    }
  }
}

function getSvgTranslatePoint(element: Element): SvgPointLike | null {
  const candidates = [element, ...Array.from(element.children)];

  for (const candidate of candidates) {
    if (!(candidate instanceof SVGElement)) continue;

    const transformAttr = candidate.getAttribute('transform');
    if (!transformAttr) continue;

    const match = transformAttr.match(/translate\(\s*([-0-9.]+)(?:[\s,]+([-0-9.]+))?\s*\)/i);
    if (!match) continue;

    return {
      x: Number.parseFloat(match[1]),
      y: Number.parseFloat(match[2] ?? '0'),
    };
  }

  return null;
}

function getSvgClientPoint(svgEl: SVGSVGElement, point: SvgPointLike): SvgPointLike | null {
  const ctm = svgEl.getScreenCTM();
  if (!ctm) return null;

  const svgPoint = svgEl.createSVGPoint();
  svgPoint.x = point.x;
  svgPoint.y = point.y;

  const transformed = svgPoint.matrixTransform(ctm);
  return { x: transformed.x, y: transformed.y };
}

function getAnchorClientRect(anchor: SVGElement): DOMRect | null {
  const rectTarget =
    getPrimaryAnchorGraphicElement(anchor) ??
    (anchor as unknown as SVGGraphicsElement);

  try {
    const rect = rectTarget.getBoundingClientRect();
    if (rect.width > 0 || rect.height > 0) return rect;
  } catch (_error) {
    // Fall through to wrapper fallback.
  }

  try {
    const rect = (anchor as unknown as Element).getBoundingClientRect();
    if (rect.width > 0 || rect.height > 0) return rect;
  } catch (_error) {
    return null;
  }

  return null;
}

function collectSvgMarkerPositions(
  renderEl: HTMLElement,
  svgOrder: Map<SVGSVGElement, number>,
  svgSystems: Map<SVGSVGElement, SvgSystemRange[]>,
  strictFiltering: boolean
): SvgMarkerPosition[] {
  const svgAnchors = Array.from(renderEl.getElementsByTagNameNS('http://www.w3.org/2000/svg', 'a'));

  return svgAnchors
    .map((element): SvgMarkerPosition | null => {
      const href = getSvgAnchorHref(element);
      if (!href?.startsWith('textedit:')) return null;

      const svgEl = element.ownerSVGElement;
      if (!svgEl) return null;

      element.classList.add('lily-note-anchor');
      element.setAttribute('data-lily-anchor-href', href);
      element.removeAttribute('href');
      element.removeAttributeNS('http://www.w3.org/1999/xlink', 'href');

      if (element.querySelector('text')) return null;

      const box = getAnchorBoundingBox(element);
      const anchorPoint =
        getSvgTranslatePoint(element) ??
        (box ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : null);
      if (!anchorPoint) return null;

      const systemRange = findSystemRangeForY(svgSystems.get(svgEl) ?? [], anchorPoint.y);
      if (strictFiltering && box && !isLikelyTimingAnchor(element, box, anchorPoint, systemRange)) {
        return null;
      }

      return {
        element,
        svgEl,
        svgIndex: svgOrder.get(svgEl) ?? 0,
        centerX: anchorPoint.x,
        centerY: anchorPoint.y,
        topLineEl: systemRange?.topLineEl ?? null,
        bottomLineEl: systemRange?.bottomLineEl ?? null,
      };
    })
    .filter((marker): marker is SvgMarkerPosition => marker !== null)
    .sort((left, right) => {
      if (left.svgIndex !== right.svgIndex) return left.svgIndex - right.svgIndex;
      if (Math.abs(left.centerX - right.centerX) > 0.35) return left.centerX - right.centerX;
      return left.centerY - right.centerY;
    });
}

function extractSvgLocationGroups(renderEl: HTMLElement): SvgLocationGroup[] {
  const svgElements = Array.from(renderEl.querySelectorAll('svg'));
  const svgOrder = new Map<SVGSVGElement, number>();
  const svgSystems = new Map<SVGSVGElement, SvgSystemRange[]>();

  for (const [index, svgEl] of svgElements.entries()) {
    svgOrder.set(svgEl, index);
    svgSystems.set(svgEl, extractSvgSystemRanges(svgEl));
  }

  const strictMarkers = collectSvgMarkerPositions(renderEl, svgOrder, svgSystems, true);
  const markers =
    strictMarkers.length > 0
      ? strictMarkers
      : collectSvgMarkerPositions(renderEl, svgOrder, svgSystems, false);

  if (strictMarkers.length === 0 && markers.length > 0) {
    console.warn('[lilypond-player] Follower strict filtering fell back to permissive mode', {
      markers: markers.length,
    });
  }

  const groups: SvgLocationGroup[] = [];

  for (const marker of markers) {
    const currentGroup = groups[groups.length - 1];

    if (
      currentGroup &&
      currentGroup.svgEl === marker.svgEl &&
      Math.abs(currentGroup.centerX - marker.centerX) <= 0.35
    ) {
      currentGroup.elements.push(marker.element);
      currentGroup.centerX =
        (currentGroup.centerX * (currentGroup.elements.length - 1) + marker.centerX) /
        currentGroup.elements.length;
      currentGroup.centerY =
        (currentGroup.centerY * (currentGroup.elements.length - 1) + marker.centerY) /
        currentGroup.elements.length;
      continue;
    }

    groups.push({
      svgEl: marker.svgEl,
      elements: [marker.element],
      centerX: marker.centerX,
      centerY: marker.centerY,
      topLineEl: marker.topLineEl,
      bottomLineEl: marker.bottomLineEl,
    });
  }

  return groups;
}

function buildPlayheadSegments(
  renderEl: HTMLElement,
  group: SvgLocationGroup
): Array<{ left: number; top: number; height: number }> {
  const renderRect = renderEl.getBoundingClientRect();
  const svgSystems = extractSvgSystemRanges(group.svgEl);
  const segments = new Map<string, {
    lefts: number[];
    topLineEl: SVGGraphicsElement | null;
    bottomLineEl: SVGGraphicsElement | null;
    fallbackCenterY: number;
    fallbackHeight: number;
  }>();

  for (const element of group.elements) {
    const anchorRect = getAnchorClientRect(element);
    const box = getAnchorBoundingBox(element);
    const anchorPoint =
      getSvgTranslatePoint(element) ??
      (box ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : null);

    if (!anchorPoint) continue;

    const systemRange = findSystemRangeForY(svgSystems, anchorPoint.y);
    const key = systemRange
      ? `${systemRange.topY.toFixed(3)}:${systemRange.bottomY.toFixed(3)}`
      : `fallback:${anchorPoint.y.toFixed(3)}`;
    const left = anchorRect
      ? anchorRect.left - renderRect.left + anchorRect.width / 2
      : (getSvgClientPoint(group.svgEl, anchorPoint)?.x ?? renderRect.left) - renderRect.left;
    const fallbackCenterY = anchorRect
      ? anchorRect.top + anchorRect.height / 2
      : getSvgClientPoint(group.svgEl, anchorPoint)?.y ?? renderRect.top;
    const fallbackHeight = Math.max(anchorRect?.height ?? 1, 1) * 4.2;

    const existing = segments.get(key);
    if (existing) {
      existing.lefts.push(left);
      existing.fallbackCenterY = (existing.fallbackCenterY + fallbackCenterY) / 2;
      existing.fallbackHeight = Math.max(existing.fallbackHeight, fallbackHeight);
      continue;
    }

    segments.set(key, {
      lefts: [left],
      topLineEl: systemRange?.topLineEl ?? null,
      bottomLineEl: systemRange?.bottomLineEl ?? null,
      fallbackCenterY,
      fallbackHeight,
    });
  }

  return Array.from(segments.values()).map((segment) => {
    let systemTop = segment.topLineEl?.getBoundingClientRect().top ?? -1;
    let systemBottom = segment.bottomLineEl?.getBoundingClientRect().bottom ?? -1;

    if (systemTop === -1 || systemBottom === -1) {
      systemTop = segment.fallbackCenterY - segment.fallbackHeight / 2;
      systemBottom = segment.fallbackCenterY + segment.fallbackHeight / 2;
    }

    const staffHeight = Math.max(systemBottom - systemTop, 1);
    const padding = Math.max(Math.min(staffHeight * 0.08, 3), 1);

    return {
      left: segment.lefts.reduce((sum, value) => sum + value, 0) / segment.lefts.length,
      top: systemTop - renderRect.top - padding,
      height: Math.max(staffHeight + padding * 2, 1),
    };
  });
}

function findActiveGroupIndex(
  groups: Array<SvgLocationGroup & FollowerTimeGroup>,
  timeMs: number
): number {
  if (groups.length === 0) return -1;

  let low = 0;
  let high = groups.length - 1;
  let result = -1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (groups[mid].timeMs <= timeMs + 8) {
      result = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return result;
}

function buildSvgPlaybackFollower(
  renderEl: HTMLElement,
  sequence: MidiSequence
): SvgPlaybackFollower | null {
  const timeGroups = extractMidiTimeGroups(sequence);
  const locationGroups = extractSvgLocationGroups(renderEl);

  if (timeGroups.length === 0 || locationGroups.length === 0) {
    console.warn('[lilypond-player] Follower unavailable', {
      timeGroups: timeGroups.length,
      locationGroups: locationGroups.length,
    });
    return null;
  }

  const mappedCount = Math.min(timeGroups.length, locationGroups.length);
  if (mappedCount === 0) {
    console.warn('[lilypond-player] Follower mapping empty', {
      timeGroups: timeGroups.length,
      locationGroups: locationGroups.length,
    });
    return null;
  }

  // Ensure the container has positioning to trap the absolute playhead
  if (window.getComputedStyle(renderEl).position === 'static') {
    renderEl.style.position = 'relative';
  }

  const playheadEls: HTMLDivElement[] = [];
  const ensurePlayheadCount = (count: number) => {
    while (playheadEls.length < count) {
      const playheadEl = document.createElement('div');
      playheadEl.className = 'lily-playhead is-hidden';
      Object.assign(playheadEl.style, {
        position: 'absolute',
        width: '2px',
        backgroundColor: '#e74c3c',
        pointerEvents: 'none',
        zIndex: '10',
        transform: 'translateX(-50%)',
        transition: 'top 0.1s, left 0.1s, height 0.1s',
      });
      renderEl.appendChild(playheadEl);
      playheadEls.push(playheadEl);
    }
  };

  const groups = timeGroups.slice(0, mappedCount).map((timeGroup, index) => ({
    timeMs: timeGroup.timeMs,
    ...locationGroups[index],
  }));

  let activeIndex = -1;

  const setActiveIndex = (nextIndex: number) => {
    if (activeIndex === nextIndex) {
      if (nextIndex !== -1) {
        const segments = buildPlayheadSegments(renderEl, groups[nextIndex]);
        ensurePlayheadCount(Math.max(segments.length, 1));
        segments.forEach((segment, index) => {
          const playheadEl = playheadEls[index];
          playheadEl.style.left = `${segment.left}px`;
          playheadEl.style.top = `${segment.top}px`;
          playheadEl.style.height = `${segment.height}px`;
          playheadEl.classList.remove('is-hidden');
          playheadEl.style.display = 'block';
        });
        for (let index = segments.length; index < playheadEls.length; index += 1) {
          playheadEls[index].classList.add('is-hidden');
          playheadEls[index].style.display = 'none';
        }
      }
      return;
    }

    if (activeIndex !== -1) {
      for (const element of groups[activeIndex].elements) element.classList.remove('is-active-note');
    }

    activeIndex = nextIndex;

    if (activeIndex === -1) {
      for (const playheadEl of playheadEls) {
        playheadEl.classList.add('is-hidden');
        playheadEl.style.display = 'none';
      }
      return;
    }

    for (const element of groups[activeIndex].elements) element.classList.add('is-active-note');

    const segments = buildPlayheadSegments(renderEl, groups[activeIndex]);
    ensurePlayheadCount(Math.max(segments.length, 1));
    segments.forEach((segment, index) => {
      const playheadEl = playheadEls[index];
      playheadEl.style.left = `${segment.left}px`;
      playheadEl.style.top = `${segment.top}px`;
      playheadEl.style.height = `${segment.height}px`;
      playheadEl.classList.remove('is-hidden');
      playheadEl.style.display = 'block';
    });
    for (let index = segments.length; index < playheadEls.length; index += 1) {
      playheadEls[index].classList.add('is-hidden');
      playheadEls[index].style.display = 'none';
    }
  };

  return {
    update(timeMs: number): void {
      setActiveIndex(findActiveGroupIndex(groups, timeMs));
    },
    reset(): void {
      setActiveIndex(-1);
    },
    destroy(): void {
      setActiveIndex(-1);
      for (const playheadEl of playheadEls) playheadEl.remove();
    },
  };
}

// ---------------------------------------------------------
// PUBLIC API
// ---------------------------------------------------------

function createIconSvg(iconName: 'play' | 'stop'): SVGSVGElement {
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.setAttribute('viewBox', '0 0 16 16');
  icon.setAttribute('aria-hidden', 'true');
  Object.assign(icon.style, { width: '16px', height: '16px', display: 'block' });

  const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  if (iconName === 'play') {
    shape.setAttribute('d', 'M5 3.5v9l7-4.5-7-4.5z');
  } else {
    shape.setAttribute('d', 'M4.5 4.5h7v7h-7z');
  }
  shape.setAttribute('fill', 'currentColor');
  icon.appendChild(shape);
  return icon;
}

const MIDI_URL_RE = /\.(midi|mid)(?=([?#].*)?$)/i;

function isLocalLilyAssetUrl(url: string) {
  const normalized = String(url || '').trim();
  if (!normalized) return false;

  try {
    const parsed = new URL(normalized, window.location.href);
    return parsed.origin === window.location.origin && parsed.pathname.startsWith('/lily/');
  } catch {
    return normalized.startsWith('/lily/');
  }
}

function replaceMidiUrlExtension(url: string, extension: 'midi' | 'mid') {
  return url.replace(MIDI_URL_RE, `.${extension}`);
}

function getLilyHashFromAssetUrl(url: string) {
  const match = url.match(/\/([a-f0-9]{32,})(?=\.(svg|midi|mid)(?:[?#]|$))/i);
  return match?.[1] || '';
}

function buildMidiFetchCandidates(midiUrl: string) {
  const candidates: string[] = [];
  const seen = new Set<string>();
  const addCandidate = (candidate: string) => {
    const normalized = String(candidate || '').trim();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    candidates.push(normalized);
  };

  addCandidate(midiUrl);

  if (midiUrl.startsWith('http')) {
    addCandidate(`/api/lily/render?url=${encodeURIComponent(midiUrl)}`);
  }

  if (MIDI_URL_RE.test(midiUrl)) {
    const fallbackUrl = /\.midi(?=([?#].*)?$)/i.test(midiUrl)
      ? replaceMidiUrlExtension(midiUrl, 'mid')
      : replaceMidiUrlExtension(midiUrl, 'midi');
    addCandidate(fallbackUrl);
    if (fallbackUrl.startsWith('http')) {
      addCandidate(`/api/lily/render?url=${encodeURIComponent(fallbackUrl)}`);
    }
  }

  const lilyHash = getLilyHashFromAssetUrl(midiUrl);
  if (lilyHash) {
    addCandidate(`/lily/${lilyHash}.midi`);
    addCandidate(`/lily/${lilyHash}.mid`);
  }

  return candidates;
}

async function fetchMidiBufferWithFallbacks(midiUrl: string) {
  const candidates = buildMidiFetchCandidates(midiUrl);

  for (const candidate of candidates) {
    try {
      console.log(`[lilypond-player] Trying MIDI candidate: ${candidate}`);
      const res = await fetch(
        candidate,
        candidate.startsWith('http')
          ? { mode: 'cors', cache: 'no-cache' }
          : { cache: 'no-cache' },
      );
      if (!res.ok) {
        console.log(`[lilypond-player] MIDI candidate unavailable (${res.status}): ${candidate}`);
        continue;
      }
      return await res.arrayBuffer();
    } catch (error) {
      console.log(`[lilypond-player] MIDI candidate fetch failed: ${candidate}`, error);
    }
  }

  return null;
}

function getDefaultMidiUrlForRenderedScore(lilyUrl: string) {
  if (!isLocalLilyAssetUrl(lilyUrl) || !/\.svg(?=([?#].*)?$)/i.test(lilyUrl)) {
    return '';
  }

  return replaceMidiUrlExtension(lilyUrl, 'midi');
}

/**
 * Attaches the miniplayer over a given rendered SVG Container using its associated MIDI file.
 */
export async function installLilypondPlayer(container: HTMLElement, midiUrl: string) {
  if (!midiUrl || container.dataset.lilyPlayerInstalled === midiUrl) return null;
  console.log(`[lilypond-player] installLilypondPlayer called for ${midiUrl}`);
  container.dataset.lilyPlayerInstalled = midiUrl;
  
  // Create UI
  const btn = document.createElement('button');
  btn.type = 'button';
  // Use forum-action-btn class to match other buttons next to "R"
  btn.className = 'lily-miniplayer-btn forum-action-btn'; 
  btn.dataset.tooltip = 'Cargando audio...';
  btn.title = 'Cargando audio...';
  btn.setAttribute('aria-label', 'Cargando audio...');
  
  // Minimal inline styles to ensure functionality
  Object.assign(btn.style, {
    pointerEvents: 'auto',
    cursor: 'wait',
  });

  btn.replaceChildren(createIconSvg('play'));
  
  const setIconState = (isPlaying: boolean) => {
    btn.replaceChildren(createIconSvg(isPlaying ? 'stop' : 'play'));
    const label = isPlaying ? 'Detener' : 'Reproducir';
    btn.title = label;
    btn.dataset.tooltip = label;
    btn.setAttribute('aria-label', label);
  };

  // Strategy: If we are in a forum post, move the button to the actions bar
  const postActions = container.closest('.forum-post')?.querySelector('.forum-post-actions');
  const playWrapper = document.createElement('div');
  
  if (postActions) {
    // Inside forum post: place next to Responder (R)
    btn.style.marginLeft = '0.35rem';
    
    const replyBtn = postActions.querySelector('.forum-action-r');
    if (replyBtn && replyBtn.nextSibling) {
      postActions.insertBefore(btn, replyBtn.nextSibling);
    } else {
      postActions.appendChild(btn);
    }
    // Actions bar might be hidden if it only has reactions
    (postActions as HTMLElement).hidden = false;
  } else {
    // Fallback: place over the SVG
    playWrapper.className = 'lily-miniplayer';
    Object.assign(playWrapper.style, {
      position: 'sticky',
      top: '4px',
      right: '4px',
      zIndex: '20',
      float: 'right',
      marginBottom: '-32px',
      pointerEvents: 'none', 
    });
    playWrapper.appendChild(btn);
    if (window.getComputedStyle(container).position === 'static') {
      container.style.position = 'relative';
    }
    container.prepend(playWrapper);
  }

  let playerBuffer: ArrayBuffer | null = null;

  try {
    console.log(`[lilypond-player] Fetching MIDI: ${midiUrl}`);
    playerBuffer = await fetchMidiBufferWithFallbacks(midiUrl);

    if (!playerBuffer) throw new Error('MIDI unretrievable');
    console.log('[lilypond-player] MIDI fetched successfully');
  } catch (err) {
    console.warn('[lilypond-player] Could not fetch MIDI for playback.', err);
    btn.title = 'No disponible (MIDI ausente o inaccesible)';
    btn.dataset.tooltip = 'No disponible';
    btn.setAttribute('aria-label', 'No disponible');
    btn.style.opacity = '0.5';
    btn.style.cursor = 'default'; // Remove prohibition icon
    return null;
  }

  // Enable button once MIDI is loaded
  setIconState(false);
  btn.disabled = false;
  btn.style.cursor = 'pointer';

  try {
    const sequence = parseMidiBuffer(playerBuffer);
    const sampler = new MiniSampler();
    const follower = buildSvgPlaybackFollower(container, sequence);

    // Pre-fetch used octaves
    sampler.preloadUsedOctaves(sequence).catch(e => console.warn('[lilypond-player] Sampler preload failed:', e));

    const controller = new WebMidiPlaybackController(sampler, sequence, {
      onProgress: (ratio) => {
        if (follower) {
          try { follower.update(sequence.durationMs * ratio); } catch {}
        }
      },
      onStateChange: (isPlaying) => {
        setIconState(isPlaying);
        if (!isPlaying && follower) {
          try { follower.reset(); } catch {}
        }
      },
    });

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (controller.isPlaying()) {
        controller.stop();
      } else {
        controller.play().catch(err => {
          console.error('[lilypond-player] Playback error:', err);
          controller.stop();
        });
      }
    });

    // Provide cleanup hook
    return {
      destroy: () => {
        controller.destroy();
        sampler.destroy();
        if (follower) {
          try { follower.destroy(); } catch {}
        }
        btn.remove();
        if (playWrapper.parentNode) playWrapper.remove();
      },
    };
  } catch (err) {
    console.error('[lilypond-player] Failed to initialize player components:', err);
    btn.title = 'Error de inicio';
    btn.dataset.tooltip = 'Error de inicio';
    btn.style.opacity = '0.5';
    btn.style.cursor = 'default';
    return null;
  }
}

console.log('[lilypond-player] Library loaded. Auto-hydration starting...');

/**
 * Global hydration function that finds all LilyPond-related elements 
 * within a container and attaches the miniplayer.
 */
export async function hydrateLilypondBlocks(container: HTMLElement = document.body) {
  if (!container) return;
  
  // 1. Find all candidate images and SVGs
  const images = Array.from(container.querySelectorAll('img')).filter(img => {
    const src = img.getAttribute('src') || '';
    return (src.includes('/lily/') || src.includes('/scores/')) && img.dataset.lilyHydrated !== 'true';
  });

  const svgs = Array.from(container.querySelectorAll('svg')).filter(svg => {
    if (svg.dataset.lilyHydrated === 'true') return false;
    // Check if it's inside a LilyPond block or has the markers
    return svg.closest('.lilypond-block, .lily-score') || svg.querySelector('[href^="textedit:"]');
  });

  if (images.length > 0 || svgs.length > 0) {
    console.log(`[lilypond-player] Found ${images.length} images and ${svgs.length} SVGs to hydrate`);
  }

  // Handle images (need inlining)
  for (const img of images) {
    img.dataset.lilyHydrated = 'true';
    const block = img.parentElement;
    if (!block) continue;

    block.classList.add('lilypond-block', 'is-hydrated');
    const lilyUrl = (block as HTMLElement).dataset.lilyUrl || img.getAttribute('src');
    if (!lilyUrl) continue;

    const midiUrl =
      (block as HTMLElement).dataset.midiUrl ||
      getDefaultMidiUrlForRenderedScore(lilyUrl);
    
    try {
      let svgRes: Response | null = null;
      try {
        svgRes = await fetch(lilyUrl, { mode: 'cors', cache: 'no-cache' });
      } catch (e) {
        console.log('[lilypond-player] SVG direct fetch failed, will try proxy');
      }

      // Proxy fallback for remote URLs that fail
      if ((!svgRes || !svgRes.ok) && lilyUrl.startsWith('http')) {
        console.log(`[lilypond-player] SVG proxying: ${lilyUrl}`);
        const proxyUrl = `/api/lily/render?url=${encodeURIComponent(lilyUrl)}`;
        try { svgRes = await fetch(proxyUrl, { cache: 'no-cache' }); } catch { svgRes = null; }
      }

      if (svgRes && svgRes.ok) {
        const svgText = await svgRes.text();
        if (svgText.includes('<svg')) {
          const parser = new DOMParser();
          const svgDoc = parser.parseFromString(svgText, 'image/svg+xml');
          const svgEl = svgDoc.querySelector('svg');
          if (svgEl) {
            sanitizeLilypondSvg(svgEl);
            svgEl.style.width = '100%';
            svgEl.style.height = 'auto';
            svgEl.style.display = 'block';
            svgEl.dataset.lilyHydrated = 'true';
            img.replaceWith(svgEl);
          }
        }
      }
      if (midiUrl) {
        await installLilypondPlayer(block as HTMLElement, midiUrl);
      }
    } catch (err) {
      console.error('[lilypond-player] Hydration failed for:', lilyUrl, err);
      if (midiUrl) {
        await installLilypondPlayer(block as HTMLElement, midiUrl).catch(() => null);
      }
    }
  }

  // Handle already inlined SVGs
  for (const svg of svgs) {
    svg.dataset.lilyHydrated = 'true';
    const block = svg.parentElement;
    if (!block) continue;

    block.classList.add('lilypond-block', 'is-hydrated-player');
    const lilyUrl = (block as HTMLElement).dataset.lilyUrl || '';
    sanitizeLilypondSvg(svg);
    const midiUrl =
      (block as HTMLElement).dataset.midiUrl ||
      getDefaultMidiUrlForRenderedScore(lilyUrl);
    
    if (midiUrl) {
      await installLilypondPlayer(block as HTMLElement, midiUrl);
    }
  }
}

/**
 * Setup a MutationObserver to automatically hydrate LilyPond blocks
 * whenever they are added to the DOM.
 */
export function setupLilypondAutoHydration() {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;

  const lilyWindow = window as Window & typeof globalThis & {
    __musikiLilypondAutoHydrationObserver?: MutationObserver | null;
  };
  if (lilyWindow.__musikiLilypondAutoHydrationObserver) {
    return lilyWindow.__musikiLilypondAutoHydrationObserver;
  }

  let timer: any = null;
  const observer = new MutationObserver((mutations) => {
    let hasPotentialChanges = false;
    for (const mutation of mutations) {
      if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
        hasPotentialChanges = true;
        break;
      }
    }

    if (hasPotentialChanges) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        hydrateLilypondBlocks(document.body);
      }, 150);
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

  // Initial pass
  console.log('[lilypond-player] Performing initial hydration pass');
  hydrateLilypondBlocks(document.body);
  lilyWindow.__musikiLilypondAutoHydrationObserver = observer;

  return observer;
}

if (typeof window !== 'undefined') {
  setupLilypondAutoHydration();
}
