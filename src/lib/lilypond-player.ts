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
  'https://2c69548e21f3b9cfd4d9fd4035e59007.r2.cloudflarestorage.com/media/samples-piano/C1.mp3',
  'https://2c69548e21f3b9cfd4d9fd4035e59007.r2.cloudflarestorage.com/media/samples-piano/C2.mp3',
  'https://2c69548e21f3b9cfd4d9fd4035e59007.r2.cloudflarestorage.com/media/samples-piano/C3.mp3',
  'https://2c69548e21f3b9cfd4d9fd4035e59007.r2.cloudflarestorage.com/media/samples-piano/C4.mp3',
  'https://2c69548e21f3b9cfd4d9fd4035e59007.r2.cloudflarestorage.com/media/samples-piano/C5.mp3',
  'https://2c69548e21f3b9cfd4d9fd4035e59007.r2.cloudflarestorage.com/media/samples-piano/C6.mp3',
  'https://2c69548e21f3b9cfd4d9fd4035e59007.r2.cloudflarestorage.com/media/samples-piano/C7.mp3',
  'https://2c69548e21f3b9cfd4d9fd4035e59007.r2.cloudflarestorage.com/media/samples-piano/C8.mp3',
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
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
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
    const peakGain = (velocity / 127) * 0.8;
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
    this.callbacks.onProgress(0);

    const startedAt = performance.now();

    for (const event of this.sequence.events) {
      const timeoutId = window.setTimeout(() => {
        const status = event.message[0] & 0xf0;
        if (status === 0x90) {
          const note = event.message[1];
          const velocity = event.message[2];
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
      this.callbacks.onProgress(ratio);
    }, 40);

    this.finishTimer = window.setTimeout(() => {
      this.finish();
    }, this.sequence.durationMs + 30);
  }

  stop(resetProgress = true): void {
    if (!this.playing && this.timeoutIds.length === 0 && this.progressTimer === null) {
      if (resetProgress) {
        this.callbacks.onProgress(0);
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
      this.callbacks.onProgress(0);
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
    this.callbacks.onProgress(1);
    this.callbacks.onStateChange(false);
  }
}

// ---------------------------------------------------------
// SVG TRACKING AND PLAYBAR UI
// ---------------------------------------------------------

function getSvgAnchorHref(element: SVGElement): string | null {
  return (
    element.getAttribute('href') ?? element.getAttributeNS('http://www.w3.org/1999/xlink', 'href')
  );
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

  const gaps: number[] = [];
  for (let index = 1; index < lineElements.length; index += 1) {
    const gap = lineElements[index].centerY - lineElements[index - 1].centerY;
    if (gap > 0.01) gaps.push(gap);
  }

  const baseGap = gaps.length > 0 ? Math.min(...gaps) : 1;
  const systemBreakGap = baseGap * 40;
  const systems: SvgSystemRange[] = [];
  let startIndex = 0;

  for (let index = 1; index <= lineElements.length; index += 1) {
    const previous = lineElements[index - 1];
    const current = lineElements[index];
    const gap = current ? current.centerY - previous.centerY : Number.POSITIVE_INFINITY;

    if (gap <= systemBreakGap) continue;

    const systemLines = lineElements.slice(startIndex, index);
    const topLine = systemLines[0];
    const bottomLine = systemLines[systemLines.length - 1];

    systems.push({
      topLineEl: topLine.line,
      bottomLineEl: bottomLine.line,
      topY: topLine.centerY,
      bottomY: bottomLine.centerY,
      centerY: (topLine.centerY + bottomLine.centerY) / 2,
    });
    startIndex = index;
  }

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

function extractSvgLocationGroups(renderEl: HTMLElement): SvgLocationGroup[] {
  const svgElements = Array.from(renderEl.querySelectorAll('svg'));
  const svgOrder = new Map<SVGSVGElement, number>();
  const svgSystems = new Map<SVGSVGElement, SvgSystemRange[]>();

  for (const [index, svgEl] of svgElements.entries()) {
    svgOrder.set(svgEl, index);
    svgSystems.set(svgEl, extractSvgSystemRanges(svgEl));
  }

  const svgAnchors = Array.from(renderEl.getElementsByTagNameNS('http://www.w3.org/2000/svg', 'a'));

  const markers = svgAnchors
    .map((element, domIndex): SvgMarkerPosition | null => {
      const href = getSvgAnchorHref(element);
      if (!href?.startsWith('textedit:')) return null;

      const svgEl = element.ownerSVGElement;
      if (!svgEl) return null;

      element.classList.add('lily-note-anchor');
      element.removeAttribute('href');
      element.removeAttributeNS('http://www.w3.org/1999/xlink', 'href');

      let box: SVGRect | null = null;
      try {
        const svgGraphics = element as unknown as SVGGraphicsElement;
        box = svgGraphics.getBBox();
      } catch (_error) {
        box = null;
      }

      const centerY = box ? box.y + box.height / 2 : 0;
      const systemRange = findSystemRangeForY(svgSystems.get(svgEl) ?? [], centerY);

      return {
        element,
        svgEl,
        svgIndex: svgOrder.get(svgEl) ?? 0,
        centerX: box ? box.x + box.width / 2 : domIndex,
        centerY,
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
      continue;
    }

    groups.push({
      svgEl: marker.svgEl,
      elements: [marker.element],
      centerX: marker.centerX,
      topLineEl: marker.topLineEl,
      bottomLineEl: marker.bottomLineEl,
    });
  }

  return groups;
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

function positionPlayhead(
  playheadEl: HTMLDivElement,
  renderEl: HTMLElement,
  group: SvgLocationGroup
): void {
  const targetElement = group.elements[0];
  const targetRect = targetElement.getBoundingClientRect();
  const renderRect = renderEl.getBoundingClientRect();

  let systemTop = -1;
  let systemBottom = -1;

  let current: Node | null = targetElement.parentNode;
  let systemEl: Element | null = null;
  const svgNode = group.svgEl as Node;
  while (current && current !== svgNode) {
    if (current instanceof Element) {
      const cls = (current.getAttribute('class') || '').toLowerCase();
      const id = (current.getAttribute('id') || '').toLowerCase();
      if (
        cls.includes('system') ||
        cls.includes('staff-group') ||
        cls.includes('score') ||
        cls.includes('staffsymbol') ||
        id.includes('system') ||
        id.includes('score')
      ) {
        systemEl = current;
      }
    }
    current = current.parentNode;
  }

  if (!systemEl) systemEl = targetElement.closest('svg > g');

  if (systemEl) {
    const staffElements = Array.from(
      systemEl.querySelectorAll(
        ".staff-symbol, .staff-line, .staff, [class*='staff'], [class*='Staff'], [id*='staff'], [id*='Staff'], path, line"
      )
    ).filter((el) => {
      if (!(el instanceof SVGGraphicsElement)) return false;
      const cls = (el.getAttribute('class') || '').toLowerCase();
      const id = (el.getAttribute('id') || '').toLowerCase();
      if (
        cls.includes('staff-symbol') ||
        cls.includes('staff-line') ||
        cls.includes('staffsymbol') ||
        id.includes('staffsymbol')
      ) {
        return true;
      }
      try {
        const b = el.getBBox();
        return b.width > b.height * 1.2 && b.width > 0.8 && b.height < 25;
      } catch {
        return false;
      }
    });

    if (staffElements.length > 0) {
      const boxes = staffElements.map((s) => s.getBoundingClientRect());
      systemTop = Math.min(...boxes.map((b) => b.top));
      systemBottom = Math.max(...boxes.map((b) => b.bottom));
    }
  }

  if (systemTop === -1 || systemBottom === -1) {
    const topLineRect = group.topLineEl?.getBoundingClientRect() ?? null;
    const bottomLineRect = group.bottomLineEl?.getBoundingClientRect() ?? null;
    if (topLineRect && bottomLineRect) {
      systemTop = topLineRect.top;
      systemBottom = bottomLineRect.bottom;
    }
  }

  if (systemTop === -1 || systemBottom === -1) {
    const noteHeight = targetRect.height;
    const estimatedStaffHeight = noteHeight * 35;
    systemTop = targetRect.top + targetRect.height / 2 - estimatedStaffHeight / 2;
    systemBottom = systemTop + estimatedStaffHeight;
  }

  const noteWidth = targetRect.width;
  const padding = Math.max(noteWidth * 4.5, 40);

  const top = systemTop - renderRect.top - padding;
  const height = systemBottom - systemTop + padding * 2;
  const left = targetRect.left - renderRect.left + targetRect.width / 2;

  playheadEl.style.left = `${left}px`;
  playheadEl.style.top = `${top}px`;
  playheadEl.style.height = `${Math.max(height, 1)}px`;
}

function buildSvgPlaybackFollower(
  renderEl: HTMLElement,
  sequence: MidiSequence
): SvgPlaybackFollower | null {
  const timeGroups = extractMidiTimeGroups(sequence);
  const locationGroups = extractSvgLocationGroups(renderEl);

  if (timeGroups.length === 0 || locationGroups.length === 0) return null;

  const mappedCount = Math.min(timeGroups.length, locationGroups.length);
  if (mappedCount === 0) return null;

  const playheadEl = document.createElement('div');
  playheadEl.className = 'lily-playhead is-hidden';
  // Minimal playhead styling - standard CSS would usually do this but we inline the required positioning.
  Object.assign(playheadEl.style, {
    position: 'absolute',
    width: '2px',
    backgroundColor: '#e74c3c', // Red tint
    pointerEvents: 'none',
    zIndex: '10',
    transition: 'top 0.1s, left 0.1s, height 0.1s',
  });
  // Ensure the container has positioning to trap the absolute playhead
  if (window.getComputedStyle(renderEl).position === 'static') {
    renderEl.style.position = 'relative';
  }
  renderEl.appendChild(playheadEl);

  const groups = timeGroups.slice(0, mappedCount).map((timeGroup, index) => ({
    timeMs: timeGroup.timeMs,
    ...locationGroups[index],
  }));

  let activeIndex = -1;

  const setActiveIndex = (nextIndex: number) => {
    if (activeIndex === nextIndex) {
      if (nextIndex !== -1) positionPlayhead(playheadEl, renderEl, groups[nextIndex]);
      return;
    }

    if (activeIndex !== -1) {
      for (const element of groups[activeIndex].elements) element.classList.remove('is-active-note');
    }

    activeIndex = nextIndex;

    if (activeIndex === -1) {
      playheadEl.classList.add('is-hidden');
      playheadEl.style.display = 'none';
      return;
    }

    for (const element of groups[activeIndex].elements) element.classList.add('is-active-note');

    positionPlayhead(playheadEl, renderEl, groups[activeIndex]);
    playheadEl.classList.remove('is-hidden');
    playheadEl.style.display = 'block';
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
      playheadEl.remove();
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

/**
 * Attaches the miniplayer over a given rendered SVG Container using its associated MIDI file.
 */
export async function installLilypondPlayer(container: HTMLElement, midiUrl: string) {
  // Create UI first so it's visible while loading
  const playWrapper = document.createElement('div');
  playWrapper.className = 'lily-miniplayer';
  Object.assign(playWrapper.style, {
    position: 'sticky',
    top: '8px',
    left: 'calc(100% - 40px)', 
    width: '32px',
    height: '32px',
    zIndex: '20',
    float: 'right',
    marginBottom: '-32px',
    pointerEvents: 'none', // Allow clicking through the wrapper
  });

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'lily-miniplayer-btn';
  btn.disabled = true; 
  Object.assign(btn.style, {
    background: 'rgba(255, 255, 255, 0.95)',
    backdropFilter: 'blur(4px)',
    border: '1px solid rgba(0,0,0,0.2)',
    borderRadius: '6px',
    cursor: 'wait',
    padding: '0',
    color: '#2c3e50',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '32px',
    height: '32px',
    pointerEvents: 'auto', // Re-enable pointer events for the button
    boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
    transition: 'all 0.2s ease',
  });
  
  const setIconState = (isPlaying: boolean) => {
    btn.replaceChildren(createIconSvg(isPlaying ? 'stop' : 'play'));
    btn.title = isPlaying ? 'Stop playback' : 'Play LilyPond score';
  };
  setIconState(false);
  playWrapper.appendChild(btn);

  if (window.getComputedStyle(container).position === 'static') {
    container.style.position = 'relative';
  }
  container.prepend(playWrapper); 

  let playerBuffer: ArrayBuffer | null = null;
  try {
    console.log(`[lilypond-player] Fetching MIDI: ${midiUrl}`);
    let res = await fetch(midiUrl);
    if (!res.ok && midiUrl.endsWith('.midi')) {
      const fallbackUrl = midiUrl.replace(/\.midi$/i, '.mid');
      console.log(`[lilypond-player] Retrying with fallback: ${fallbackUrl}`);
      res = await fetch(fallbackUrl);
    }
    if (!res.ok) throw new Error(`MIDI unretrievable (status ${res.status})`);
    playerBuffer = await res.arrayBuffer();
    console.log('[lilypond-player] MIDI fetched successfully');
  } catch (err) {
    console.warn('[lilypond-player] Could not fetch MIDI for playback.', err);
    btn.title = 'Playback unavailable (no MIDI)';
    btn.style.opacity = '0.5';
    btn.style.cursor = 'not-allowed';
    // We keep the button but it's disabled. 
    // If you prefer to hide it completely if MIDI fails, uncomment next line:
    // playWrapper.style.display = 'none'; 
    return null;
  }

  // Enable button once MIDI is loaded
  btn.disabled = false;
  btn.style.cursor = 'pointer';
  btn.style.background = 'white';

  const sequence = parseMidiBuffer(playerBuffer);
  const sampler = new MiniSampler();
  const follower = buildSvgPlaybackFollower(container, sequence);

  // Pre-fetch used octaves for the loaded sequence over network 
  sampler.preloadUsedOctaves(sequence);

  const controller = new WebMidiPlaybackController(sampler, sequence, {
    onProgress: (ratio) => {
      follower?.update(sequence.durationMs * ratio);
    },
    onStateChange: (isPlaying) => {
      setIconState(isPlaying);
      if (!isPlaying) follower?.reset();
    },
  });

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (controller.isPlaying()) {
      controller.stop();
    } else {
      controller.play();
    }
  });

  // Provide cleanup hook
  return {
    destroy: () => {
      controller.destroy();
      sampler.destroy();
      follower?.destroy();
      playWrapper.remove();
    },
  };
}

/**
 * Global hydration function that finds all .lilypond-block elements 
 * within a container, inlines their SVGs, and attaches the miniplayer.
 */
export async function hydrateLilypondBlocks(container: HTMLElement = document.body) {
  const selectors = [
    '.lilypond-block:not(.is-hydrated)',
    '.lily-score:not(.is-hydrated)',
    'figure:has(img[src*="/lily/"]):not(.is-hydrated)',
    'div:has(img[src*="/lily/"]):not(.is-hydrated)',
    'p:has(img[src*="/lily/"]):not(.is-hydrated)'
  ];
  const blocks = Array.from(container.querySelectorAll(selectors.join(',')));
  
  if (blocks.length > 0) {
    console.log(`[lilypond-player] Found ${blocks.length} blocks to hydrate`);
  }

  const tasks = blocks.map(async (block) => {
    if (!(block instanceof HTMLElement)) return;
    block.classList.add('is-hydrated');

    const img = block.querySelector('img');
    const lilyUrl = block.dataset.lilyUrl || img?.getAttribute('src');
    if (!lilyUrl) {
      console.warn('[lilypond-player] Block missing URL:', block);
      return;
    }

    // Derived midiUrl (assume same name but .midi)
    // If it's a full URL from remote, it might not work if remote doesn't serve .midi
    const midiUrl = lilyUrl.replace(/\.svg$/i, '.midi');
    
    try {
      console.log(`[lilypond-player] Hydrating SVG from: ${lilyUrl}`);
      // 1. Fetch SVG content to inline it (needed for follower/DOM access)
      // Use no-cache to avoid getting a stale version without textedit anchors if recently re-rendered
      const svgRes = await fetch(lilyUrl, { mode: 'cors', cache: 'no-cache' });
      if (!svgRes.ok) {
        throw new Error(`SVG fetch failed: ${svgRes.status}`);
      }
      const svgText = await svgRes.text();
      
      if (!svgText.includes('<svg')) {
        throw new Error('Fetched content is not an SVG');
      }

      const parser = new DOMParser();
      const svgDoc = parser.parseFromString(svgText, 'image/svg+xml');
      const svgEl = svgDoc.querySelector('svg');
      if (!svgEl) {
        throw new Error('Could not find <svg> element in fetched content');
      }

      // Style for responsiveness
      svgEl.style.width = '100%';
      svgEl.style.height = 'auto';
      svgEl.style.display = 'block';

      // 2. Inline the SVG by replacing the img
      if (img) {
        img.replaceWith(svgEl);
      } else {
        block.appendChild(svgEl);
      }

      // 3. Install the miniplayer 
      await installLilypondPlayer(block, midiUrl);
    } catch (err) {
      console.error('[lilypond-player] Hydration failed for:', lilyUrl, err);
      // Even if SVG fetching fails, the <img> should still be there from SSR.
    }
  });

  return Promise.all(tasks);
}
