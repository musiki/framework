import * as fs from "fs";

interface ParsedMidiEvent {
	ticks: number;
	message: number[];
	channel?: number;
}

interface TempoEvent {
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

export type MidiOutputLike = MIDIOutput & {
	clear?: () => void;
};

interface MidiPlaybackCallbacks {
	onProgress: (ratio: number) => void;
	onStateChange: (isPlaying: boolean) => void;
	onLog?: (message: string) => void;
}

class ByteReader {
	private offset = 0;

	constructor(private readonly data: Uint8Array) {}

	readString(length: number): string {
		const value = this.data.subarray(this.offset, this.offset + length);
		this.offset += length;
		return Buffer.from(value).toString("ascii");
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
			(this.data[this.offset] * 0x1000000) +
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

let midiAccessPromise: Promise<MIDIAccess | null> | null = null;

export async function getMidiOutputs(): Promise<MidiOutputLike[]> {
	const access = await getMidiAccess();

	if (!access) {
		return [];
	}

	const outputs: MidiOutputLike[] = [];
	access.outputs.forEach((output) => {
		outputs.push(output as MidiOutputLike);
	});

	return outputs;
}

export async function findMidiOutputByName(name: string): Promise<MidiOutputLike | null> {
	const outputs = await getMidiOutputs();
	const exactMatch = outputs.find((output) => output.name === name);

	if (exactMatch) {
		return exactMatch;
	}

	const loweredName = name.toLowerCase();
	return outputs.find((output) => output.name?.toLowerCase() === loweredName) ?? null;
}

export function parseMidiFile(midiPath: string): MidiSequence {
	const reader = new ByteReader(new Uint8Array(fs.readFileSync(midiPath)));
	const headerChunk = reader.readString(4);

	if (headerChunk !== "MThd") {
		throw new Error("Invalid MIDI header.");
	}

	const headerLength = reader.readUint32();
	const format = reader.readUint16();
	const trackCount = reader.readUint16();
	const division = reader.readUint16();

	if (format > 2) {
		throw new Error(`Unsupported MIDI format ${format}.`);
	}

	if ((division & 0x8000) !== 0) {
		throw new Error("SMPTE MIDI timing is not supported.");
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
			ticksToMilliseconds(
				event.ticks - currentTempoTick,
				currentTempo,
				ticksPerQuarterNote
			);
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

export class MidiPlaybackController {
	private timeoutIds: number[] = [];
	private progressTimer: number | null = null;
	private finishTimer: number | null = null;
	private playing = false;

	constructor(
		private readonly output: MidiOutputLike,
		private readonly sequence: MidiSequence,
		private readonly callbacks: MidiPlaybackCallbacks
	) {}

	isPlaying(): boolean {
		return this.playing;
	}

	play(): void {
		this.stop(false);

		if (this.sequence.events.length === 0) {
			this.callbacks.onProgress(0);
			this.callbacks.onLog?.("No MIDI note data found.");
			return;
		}

		this.output.clear?.();
		this.playing = true;
		this.callbacks.onStateChange(true);
		this.callbacks.onProgress(0);
		this.callbacks.onLog?.("Playback started.");

		const startedAt = performance.now();

		for (const event of this.sequence.events) {
			const timeoutId = window.setTimeout(() => {
				try {
					this.output.send(event.message);
				} catch (error) {
					this.callbacks.onLog?.(formatError("MIDI send failed", error));
					this.stop();
				}
			}, event.timeMs);

			this.timeoutIds.push(timeoutId);
		}

		this.progressTimer = window.setInterval(() => {
			const elapsedMs = performance.now() - startedAt;
			const ratio = this.sequence.durationMs === 0
				? 0
				: Math.min(elapsedMs / this.sequence.durationMs, 1);
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

		this.sendAllNotesOff();
		this.playing = false;
		this.callbacks.onStateChange(false);

		if (resetProgress) {
			this.callbacks.onProgress(0);
			this.callbacks.onLog?.("Playback stopped.");
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

		this.sendAllNotesOff();
		this.playing = false;
		this.callbacks.onProgress(1);
		this.callbacks.onStateChange(false);
		this.callbacks.onLog?.("Playback finished.");
	}

	private sendAllNotesOff(): void {
		for (const channel of this.sequence.usedChannels) {
			try {
				this.output.send([0xb0 | channel, 123, 0]);
				this.output.send([0xb0 | channel, 120, 0]);
			} catch (error) {
				this.callbacks.onLog?.(formatError("All notes off failed", error));
			}
		}
	}
}

async function getMidiAccess(): Promise<MIDIAccess | null> {
	if (!midiAccessPromise) {
		const midiNavigator = navigator as Navigator & {
			requestMIDIAccess?: typeof navigator.requestMIDIAccess;
		};

		if (typeof midiNavigator.requestMIDIAccess !== "function") {
			midiAccessPromise = Promise.resolve(null);
		} else {
			midiAccessPromise = midiNavigator.requestMIDIAccess({ sysex: false })
				.catch((): null => null);
		}
	}

	return midiAccessPromise;
}

function parseTrack(
	reader: ByteReader,
	parsedEvents: ParsedMidiEvent[],
	tempoEvents: TempoEvent[]
): void {
	const chunkType = reader.readString(4);

	if (chunkType !== "MTrk") {
		throw new Error("Invalid MIDI track chunk.");
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
				throw new Error("Invalid running status in MIDI track.");
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
					microsecondsPerQuarter:
						(data[0] << 16) | (data[1] << 8) | data[2],
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

function formatError(prefix: string, error: unknown): string {
	if (error instanceof Error) {
		return `${prefix}: ${error.message}`;
	}

	return `${prefix}.`;
}
