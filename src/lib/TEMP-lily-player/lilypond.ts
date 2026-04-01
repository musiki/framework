import * as path from "path";
import * as fs from "fs";
import * as temp from "temp";
import { spawn } from "child_process";
import {
	App,
	MarkdownPostProcessorContext,
	MarkdownRenderChild,
} from "obsidian";
import {
	MidiPlaybackController,
	findMidiOutputByName,
	getMidiOutputs,
	parseMidiFile,
} from "./midi";
import {
	EditorLogger,
	LilypondInlineEditor,
} from "./editor";

// windows path: "C:\Program Files (x86)\LilyPond\usr\bin\lilypond-windows.exe"

interface BlockCommands {
	listMidiDevices: boolean;
	midiOutputName: string | null;
}

interface RenderArtifacts {
	svgMarkup: string;
	midiPath: string | null;
}

interface FollowerTimeGroup {
	timeMs: number;
}

interface SvgLocationGroup {
	svgEl: SVGSVGElement;
	elements: SVGElement[];
	centerX: number;
	topLineEl: SVGGraphicsElement | null;
	bottomLineEl: SVGGraphicsElement | null;
}

interface SvgPlaybackFollower {
	update(timeMs: number): void;
	reset(): void;
	destroy(): void;
}

interface SvgSystemRange {
	topLineEl: SVGGraphicsElement;
	bottomLineEl: SVGGraphicsElement;
	topY: number;
	bottomY: number;
	centerY: number;
}

interface SvgMarkerPosition {
	element: SVGElement;
	svgEl: SVGSVGElement;
	svgIndex: number;
	centerX: number;
	centerY: number;
	topLineEl: SVGGraphicsElement | null;
	bottomLineEl: SVGGraphicsElement | null;
}

class BlockConsole implements EditorLogger {
	private lines: string[] = [];
	private visible = false;

	constructor(private readonly element: HTMLPreElement) {}

	push(message: string): void {
		for (const rawLine of message.split(/\r?\n/)) {
			const line = rawLine.trimEnd();

			if (!line) {
				continue;
			}

			this.lines.push(line);
		}

		if (this.lines.length > 500) {
			this.lines = this.lines.slice(this.lines.length - 500);
		}

		this.element.textContent = this.lines.join("\n");
	}

	show(): void {
		this.visible = true;
		this.element.classList.remove("is-hidden");
	}

	hide(): void {
		this.visible = false;
		this.element.classList.add("is-hidden");
	}

	toggle(): void {
		if (this.visible) {
			this.hide();
			return;
		}

		this.show();
	}

	isVisible(): boolean {
		return this.visible;
	}
}

class BlockLifecycle extends MarkdownRenderChild {
	private cleanups: Array<() => void> = [];

	registerCleanup(cleanup: () => void): void {
		this.cleanups.push(cleanup);
	}

	onunload(): void {
		for (let index = this.cleanups.length - 1; index >= 0; index -= 1) {
			try {
				this.cleanups[index]();
			} catch (error) {
				console.error(error);
			}
		}

		this.cleanups = [];
	}
}

let activePlayback: MidiPlaybackController | null = null;

export const render = async function (
	lilypondCode: string,
	lilypondPath: string,
	el: HTMLElement,
	app: App,
	ctx: MarkdownPostProcessorContext
) {
	const ui = createBlockUi(el);
	const logger = new BlockConsole(ui.consoleEl);
	const lifecycle = new BlockLifecycle(ui.root);
	ctx.addChild(lifecycle);

	let playback: MidiPlaybackController | null = null;
	let editor: LilypondInlineEditor | null = null;
	let follower: SvgPlaybackFollower | null = null;
	let disposed = false;
	let renderVersion = 0;

	const setProgress = (ratio: number) => {
		ui.progressFill.style.transform = `translateY(-50%) scaleX(${Math.max(0, Math.min(ratio, 1))})`;
	};

	const syncConsoleToggleState = () => {
		ui.consoleToggleButton.classList.toggle("is-active", logger.isVisible());
	};

	const resetPlayerUi = () => {
		ui.transportButton.disabled = true;
		setTransportButtonState(ui.transportButton, false);
		setProgress(0);
	};

	const clearPlayback = () => {
		if (!playback) {
			return;
		}

		if (activePlayback === playback) {
			activePlayback = null;
		}

		playback.destroy();
		playback = null;
	};

	const clearFollower = () => {
		follower?.destroy();
		follower = null;
	};

	const bindPlayback = (player: MidiPlaybackController) => {
		clearPlayback();
		playback = player;
		ui.transportButton.disabled = false;
		setTransportButtonState(ui.transportButton, false);
	};

	const applyRenderedSource = async (
		source: string,
		options: { restorePendingEditor: boolean }
	): Promise<void> => {
		const commands = parseBlockCommands(source);
		const version = renderVersion + 1;
		renderVersion = version;

		clearPlayback();
		clearFollower();
		resetPlayerUi();
		ui.renderEl.classList.remove("lily-error");

		try {
			const artifacts = await renderLilypond(source, lilypondPath, logger);

			if (disposed || version !== renderVersion) {
				return;
			}

			ui.renderEl.classList.remove("lily-error");
			ui.renderEl.innerHTML = artifacts.svgMarkup;

			if (options.restorePendingEditor) {
				editor?.restoreIfPending(source);
			}

			if (commands.listMidiDevices) {
				await logMidiOutputs(logger);

				if (disposed || version !== renderVersion) {
					return;
				}

				logger.show();
				syncConsoleToggleState();
			}

			if (!artifacts.midiPath) {
				return;
			}

			let midiOutputName = commands.midiOutputName;
			let midiOutput = null;

			if (midiOutputName) {
				midiOutput = await findMidiOutputByName(midiOutputName);
			} else {
				const outputs = await getMidiOutputs();

				if (disposed || version !== renderVersion) {
					return;
				}

				midiOutput = outputs[0] ?? null;
				midiOutputName = midiOutput?.name ?? "unnamed output";

				if (midiOutput) {
					logger.push(`MIDI default -> ${midiOutputName}`);
				}
			}

			if (disposed || version !== renderVersion) {
				return;
			}

			if (!midiOutput) {
				if (commands.midiOutputName) {
					logger.push(`MIDI output not found: ${midiOutputName}`);
					await logMidiOutputs(logger);

					if (disposed || version !== renderVersion) {
						return;
					}
				} else {
					logger.push("No MIDI outputs available.");
				}

				logger.show();
				syncConsoleToggleState();
				return;
			}

			const sequence = parseMidiFile(artifacts.midiPath);
			follower = buildSvgPlaybackFollower(ui.renderEl, sequence, logger);
			midiOutputName = midiOutput.name ?? midiOutputName;

			bindPlayback(
				new MidiPlaybackController(midiOutput, sequence, {
					onProgress: (ratio) => {
						setProgress(ratio);
						follower?.update(sequence.durationMs * ratio);
					},
					onStateChange: (isPlaying) => {
						ui.transportButton.disabled = false;
						setTransportButtonState(ui.transportButton, isPlaying);

						if (!isPlaying && activePlayback === playback) {
							activePlayback = null;
						}

						if (!isPlaying) {
							follower?.reset();
						}
					},
					onLog: (message) => {
						logger.push(message);
					},
				})
			);

			logger.push(`MIDI ready -> ${midiOutputName}`);
		} catch (error) {
			if (disposed || version !== renderVersion) {
				return;
			}

			console.error(error);
			logger.push(formatError(error));
			logger.show();
			syncConsoleToggleState();
			resetPlayerUi();
			ui.renderEl.classList.add("lily-error");
			ui.renderEl.textContent = formatError(error);
		}
	};

	editor = new LilypondInlineEditor(
		app,
		ctx,
		{
			rootEl: ui.root,
			toggleButton: ui.editorToggleButton,
			panelEl: ui.editorEl,
			onApply: async (source) => {
				await applyRenderedSource(source, { restorePendingEditor: false });
			},
		},
		logger,
		lilypondCode
	);

	lifecycle.registerCleanup(() => {
		disposed = true;
		editor?.destroy();
		clearPlayback();
		clearFollower();
	});

	resetPlayerUi();

	ui.transportButton.addEventListener("click", () => {
		if (!playback) {
			return;
		}

		if (playback.isPlaying()) {
			playback.stop();

			if (activePlayback === playback) {
				activePlayback = null;
			}

			return;
		}

		if (activePlayback && activePlayback !== playback) {
			activePlayback.stop();
		}

		activePlayback = playback;
		playback.play();
	});
	ui.consoleToggleButton.addEventListener("click", () => {
		logger.toggle();
		syncConsoleToggleState();
	});

	await applyRenderedSource(lilypondCode, { restorePendingEditor: true });
};

function createBlockUi(el: HTMLElement): {
	root: HTMLDivElement;
	transportButton: HTMLButtonElement;
	progressFill: HTMLDivElement;
	consoleToggleButton: HTMLButtonElement;
	editorToggleButton: HTMLButtonElement;
	consoleEl: HTMLPreElement;
	editorEl: HTMLDivElement;
	renderEl: HTMLDivElement;
} {
	const root = document.createElement("div");
	root.className = "lily-block";

	const controlsEl = document.createElement("div");
	controlsEl.className = "lily-controls";

	const consoleToggleButton = createTextButton("C", "Toggle LilyPond console");
	consoleToggleButton.classList.add("lily-button-console");

	const editorToggleButton = createTextButton("E", "Toggle LilyPond editor");
	editorToggleButton.classList.add("lily-button-editor");

	const transportButton = createTransportButton();
	transportButton.disabled = true;

	const progressEl = document.createElement("div");
	progressEl.className = "lily-progress";

	const progressFill = document.createElement("div");
	progressFill.className = "lily-progress-fill";
	progressEl.appendChild(progressFill);

	controlsEl.append(consoleToggleButton, editorToggleButton, transportButton, progressEl);

	const renderEl = document.createElement("div");
	renderEl.className = "lily-render";

	const consoleEl = document.createElement("pre");
	consoleEl.className = "lily-console is-hidden";

	const editorEl = document.createElement("div");
	editorEl.className = "lily-editor-panel is-hidden";

	root.append(controlsEl, renderEl, consoleEl, editorEl);
	el.replaceChildren(root);

	return {
		root,
		transportButton,
		progressFill,
		consoleToggleButton,
		editorToggleButton,
		consoleEl,
		editorEl,
		renderEl,
	};
}

function createTextButton(text: string, label: string): HTMLButtonElement {
	const button = document.createElement("button");
	button.className = "lily-button lily-button-text";
	button.type = "button";
	button.textContent = text;
	button.setAttribute("aria-label", label);
	button.title = label;
	return button;
}

function createTransportButton(): HTMLButtonElement {
	const button = document.createElement("button");
	button.className = "lily-button lily-button-icon";
	button.type = "button";
	setTransportButtonState(button, false);
	return button;
}

function setTransportButtonState(
	button: HTMLButtonElement,
	isPlaying: boolean
): void {
	const label = isPlaying ? "Stop MIDI" : "Play MIDI";
	button.replaceChildren(createIconSvg(isPlaying ? "stop" : "play"));
	button.setAttribute("aria-label", label);
	button.title = label;
}

function createIconSvg(iconName: "play" | "stop"): SVGSVGElement {
	const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
	icon.setAttribute("viewBox", "0 0 16 16");
	icon.setAttribute("aria-hidden", "true");
	icon.classList.add("lily-icon");

	const shape = document.createElementNS("http://www.w3.org/2000/svg", "path");

	if (iconName === "play") {
		shape.setAttribute("d", "M5 3.5v9l7-4.5-7-4.5z");
	} else {
		shape.setAttribute("d", "M4.5 4.5h7v7h-7z");
	}

	shape.setAttribute("fill", "currentColor");
	icon.appendChild(shape);
	return icon;
}

async function renderLilypond(
	lilypondCode: string,
	lilypondPath: string,
	logger: BlockConsole
): Promise<RenderArtifacts> {
	temp.track();
	const tempDir = temp.mkdirSync("obsidian-lily");
	const lilypondSourcePath = path.join(tempDir, "score.ly");

	fs.writeFileSync(lilypondSourcePath, lilypondCode, "utf8");
	logger.push(`lilypond -> ${path.basename(lilypondPath)}`);

	await runLilypondProcess(lilypondPath, tempDir, lilypondSourcePath, logger);

	if (!hasSvgOutput(tempDir) && shouldRetryWithLayoutFallback(lilypondCode)) {
		logger.push("No SVG output found. Retrying with injected \\layout {} for preview.");

		const fallbackSourcePath = path.join(tempDir, "score-preview.ly");
		fs.writeFileSync(
			fallbackSourcePath,
			injectLayoutFallback(lilypondCode),
			"utf8"
		);

		await runLilypondProcess(lilypondPath, tempDir, fallbackSourcePath, logger);
	}

	return {
		svgMarkup: readSvgMarkup(tempDir),
		midiPath: readMidiPath(tempDir),
	};
}

function runLilypondProcess(
	lilypondPath: string,
	outputDir: string,
	sourcePath: string,
	logger: BlockConsole
): Promise<void> {
	return new Promise((resolve, reject) => {
		const child = spawn(
			lilypondPath,
			[
				"-dbackend=svg",
				"-dpoint-and-click=note-event",
				"-fsvg",
				"--output",
				outputDir,
				sourcePath,
			],
			{
				windowsHide: true,
			}
		);

		pipeProcessStream(child.stdout, logger);
		pipeProcessStream(child.stderr, logger);

		child.on("error", reject);
		child.on("close", (code) => {
			if (code === 0) {
				resolve();
				return;
			}

			reject(new Error(`LilyPond exited with code ${code}.`));
		});
	});
}

function pipeProcessStream(
	stream: NodeJS.ReadableStream | null,
	logger: BlockConsole
): void {
	if (!stream) {
		return;
	}

	let buffer = "";
	stream.on("data", (chunk: Buffer | string) => {
		buffer += chunk.toString();
		const lines = buffer.split(/\r?\n/);
		buffer = lines.pop() ?? "";

		for (const line of lines) {
			if (line.trim()) {
				logger.push(line);
			}
		}
	});

	stream.on("end", () => {
		if (buffer.trim()) {
			logger.push(buffer);
		}
	});
}

function readSvgMarkup(outputDir: string): string {
	const svgFiles = getSvgFiles(outputDir);

	if (svgFiles.length === 0) {
		throw new Error("No SVG output generated. Add \\layout {} to the score, or let the plugin inject it by keeping \\midi {} in the block.");
	}

	return svgFiles
		.map((fileName) => fs.readFileSync(path.join(outputDir, fileName), "utf8"))
		.join("\n");
}

function getSvgFiles(outputDir: string): string[] {
	return fs.readdirSync(outputDir)
		.filter((fileName) => fileName.endsWith(".svg"))
		.sort((left, right) => left.localeCompare(right));
}

function hasSvgOutput(outputDir: string): boolean {
	return getSvgFiles(outputDir).length > 0;
}

function readMidiPath(outputDir: string): string | null {
	const midiFile = fs.readdirSync(outputDir)
		.filter((fileName) => fileName.endsWith(".midi") || fileName.endsWith(".mid"))
		.sort((left, right) => left.localeCompare(right))[0];

	return midiFile ? path.join(outputDir, midiFile) : null;
}

function buildSvgPlaybackFollower(
	renderEl: HTMLDivElement,
	sequence: ReturnType<typeof parseMidiFile>,
	logger: BlockConsole
): SvgPlaybackFollower | null {
	const timeGroups = extractMidiTimeGroups(sequence);
	const locationGroups = extractSvgLocationGroups(renderEl);

	if (timeGroups.length === 0 || locationGroups.length === 0) {
		return null;
	}

	const mappedCount = Math.min(timeGroups.length, locationGroups.length);

	if (mappedCount === 0) {
		return null;
	}

	if (timeGroups.length !== locationGroups.length) {
		logger.push(
			`Follower map ${mappedCount}/${timeGroups.length} MIDI steps -> ${locationGroups.length} score positions.`
		);
	}

	const playheadEl = document.createElement("div");
	playheadEl.className = "lily-playhead is-hidden";
	renderEl.appendChild(playheadEl);

	const groups = timeGroups.slice(0, mappedCount).map((timeGroup, index) => {
		return {
			timeMs: timeGroup.timeMs,
			...locationGroups[index],
		};
	});

	let activeIndex = -1;

	const setActiveIndex = (nextIndex: number) => {
		if (activeIndex === nextIndex) {
			if (nextIndex !== -1) {
				positionPlayhead(playheadEl, renderEl, groups[nextIndex]);
			}
			return;
		}

		if (activeIndex !== -1) {
			for (const element of groups[activeIndex].elements) {
				element.classList.remove("is-active-note");
			}
		}

		activeIndex = nextIndex;

		if (activeIndex === -1) {
			playheadEl.classList.add("is-hidden");
			return;
		}

		for (const element of groups[activeIndex].elements) {
			element.classList.add("is-active-note");
		}

		positionPlayhead(playheadEl, renderEl, groups[activeIndex]);
		playheadEl.classList.remove("is-hidden");
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

function extractMidiTimeGroups(
	sequence: ReturnType<typeof parseMidiFile>
): FollowerTimeGroup[] {
	const timeGroups: FollowerTimeGroup[] = [];
	let previousTimeMs: number | null = null;

	for (const event of sequence.events) {
		const status = event.message[0] & 0xf0;
		const velocity = event.message[2] ?? 0;

		if (status !== 0x90 || velocity === 0) {
			continue;
		}

		if (
			previousTimeMs !== null &&
			Math.abs(event.timeMs - previousTimeMs) < 0.01
		) {
			continue;
		}

		timeGroups.push({
			timeMs: event.timeMs,
		});
		previousTimeMs = event.timeMs;
	}

	return timeGroups;
}

function extractSvgLocationGroups(renderEl: HTMLDivElement): SvgLocationGroup[] {
	const svgElements = Array.from(renderEl.querySelectorAll("svg"));
	const svgOrder = new Map<SVGSVGElement, number>();
	const svgSystems = new Map<SVGSVGElement, SvgSystemRange[]>();

	for (const [index, svgEl] of svgElements.entries()) {
		svgOrder.set(svgEl, index);
		svgSystems.set(svgEl, extractSvgSystemRanges(svgEl));
	}

	const svgAnchors = Array.from(
		renderEl.getElementsByTagNameNS("http://www.w3.org/2000/svg", "a")
	);

	const markers = svgAnchors
		.map((element, domIndex): SvgMarkerPosition | null => {
			const href = getSvgAnchorHref(element);

			if (!href?.startsWith("textedit:")) {
				return null;
			}

			const svgEl = element.ownerSVGElement;

			if (!svgEl) {
				return null;
			}

			element.classList.add("lily-note-anchor");
			element.removeAttribute("href");
			element.removeAttributeNS("http://www.w3.org/1999/xlink", "href");

			let box: SVGRect | null = null;

			try {
				const svgGraphics = element as unknown as SVGGraphicsElement;
				box = svgGraphics.getBBox();
			} catch (_error) {
				box = null;
			}

			const centerY = box ? box.y + box.height / 2 : 0;
			const systemRange = findSystemRangeForY(
				svgSystems.get(svgEl) ?? [],
				centerY
			);

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
			if (left.svgIndex !== right.svgIndex) {
				return left.svgIndex - right.svgIndex;
			}

			if (Math.abs(left.centerX - right.centerX) > 0.35) {
				return left.centerX - right.centerX;
			}

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

function getSvgAnchorHref(element: SVGElement): string | null {
	return (
		element.getAttribute("href") ??
		element.getAttributeNS("http://www.w3.org/1999/xlink", "href")
	);
}

function extractSvgSystemRanges(svgEl: SVGSVGElement): SvgSystemRange[] {
	const lineElements = Array.from(svgEl.querySelectorAll("line, path"))
		.filter(
			(el): el is SVGGraphicsElement =>
				el instanceof SVGLineElement || el instanceof SVGPathElement
		)
		.map((el) => {
			let box: SVGRect | null = null;

			try {
				box = el.getBBox();
			} catch (_error) {
				box = null;
			}

			if (!box || box.width === 0) {
				return null;
			}

			// Staff lines are horizontal: wide and thin.
			const isHorizontal = box.width > box.height * 1.2;
			const isWide = box.width > 0.8;
			const isThin = box.height < 25;

			const cls = el.getAttribute("class") || "";
			const id = el.getAttribute("id") || "";
			const isStaffSymbol =
				cls.includes("staff-symbol") ||
				cls.includes("staff-line") ||
				id.includes("StaffSymbol") ||
				el.parentElement?.classList.contains("staff-symbol") ||
				el.parentElement?.parentElement?.classList.contains("staff-symbol") ||
				el.parentElement?.parentElement?.parentElement?.classList.contains("staff-symbol");

			if ((isHorizontal && isWide && isThin) || isStaffSymbol) {
				return {
					line: el,
					centerY: box.y + box.height / 2,
				};
			}

			return null;
		})
		.filter(
			(entry): entry is { line: SVGGraphicsElement; centerY: number } =>
				entry !== null
		)
		.sort((left, right) => left.centerY - right.centerY);

	if (lineElements.length === 0) {
		return [];
	}

	const gaps: number[] = [];

	for (let index = 1; index < lineElements.length; index += 1) {
		const gap = lineElements[index].centerY - lineElements[index - 1].centerY;

		if (gap > 0.01) {
			gaps.push(gap);
		}
	}

	const baseGap = gaps.length > 0 ? Math.min(...gaps) : 1;
	// Group staves into systems. 40 staff-spaces covers almost any orchestral system spacing.
	const systemBreakGap = baseGap * 40;
	const systems: SvgSystemRange[] = [];
	let startIndex = 0;

	for (let index = 1; index <= lineElements.length; index += 1) {
		const previous = lineElements[index - 1];
		const current = lineElements[index];
		const gap = current ? current.centerY - previous.centerY : Number.POSITIVE_INFINITY;

		if (gap <= systemBreakGap) {
			continue;
		}

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

function findSystemRangeForY(
	systems: SvgSystemRange[],
	centerY: number
): SvgSystemRange | null {
	if (systems.length === 0) {
		return null;
	}

	for (const system of systems) {
		if (centerY >= system.topY - 0.5 && centerY <= system.bottomY + 0.5) {
			return system;
		}
	}

	return systems.reduce((closest, current) => {
		if (!closest) {
			return current;
		}

		const currentDistance = Math.abs(current.centerY - centerY);
		const closestDistance = Math.abs(closest.centerY - centerY);
		return currentDistance < closestDistance ? current : closest;
	}, null as SvgSystemRange | null);
}

function findActiveGroupIndex(
	groups: Array<SvgLocationGroup & FollowerTimeGroup>,
	timeMs: number
): number {
	if (groups.length === 0) {
		return -1;
	}

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
	renderEl: HTMLDivElement,
	group: SvgLocationGroup
): void {
	const targetElement = group.elements[0];
	const targetRect = targetElement.getBoundingClientRect();
	const renderRect = renderEl.getBoundingClientRect();
	const svgRect = group.svgEl.getBoundingClientRect();

	let systemTop = -1;
	let systemBottom = -1;

	// Method 1: Find the outermost container that represents the whole system/staff-group.
	let current: Node | null = targetElement.parentNode;
	let systemEl: Element | null = null;
	const svgNode = group.svgEl as Node;
	while (current && current !== svgNode) {
		if (current instanceof Element) {
			const cls = (current.getAttribute("class") || "").toLowerCase();
			const id = (current.getAttribute("id") || "").toLowerCase();
			if (
				cls.includes("system") ||
				cls.includes("staff-group") ||
				cls.includes("score") ||
				cls.includes("staffsymbol") ||
				id.includes("system") ||
				id.includes("score")
			) {
				systemEl = current;
			}
		}
		current = current.parentNode;
	}

	if (!systemEl) {
		systemEl = targetElement.closest("svg > g");
	}

	if (systemEl) {
		// Extremely inclusive filter for anything staff-related
		const staffElements = Array.from(
			systemEl.querySelectorAll(
				".staff-symbol, .staff-line, .staff, [class*='staff'], [class*='Staff'], [id*='staff'], [id*='Staff'], path, line"
			)
		).filter((el) => {
			if (!(el instanceof SVGGraphicsElement)) return false;
			const cls = (el.getAttribute("class") || "").toLowerCase();
			const id = (el.getAttribute("id") || "").toLowerCase();
			if (
				cls.includes("staff-symbol") ||
				cls.includes("staff-line") ||
				cls.includes("staffsymbol") ||
				id.includes("staffsymbol")
			) {
				return true;
			}

			// Very generous horizontal/thin check
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

	// Method 2: Fallback to pre-calculated staff lines from the extraction phase
	if (systemTop === -1 || systemBottom === -1) {
		const topLineRect = group.topLineEl?.getBoundingClientRect() ?? null;
		const bottomLineRect = group.bottomLineEl?.getBoundingClientRect() ?? null;

		if (topLineRect && bottomLineRect) {
			systemTop = topLineRect.top;
			systemBottom = bottomLineRect.bottom;
		}
	}

	// Method 3: Final fallback - estimate staff height from note size
	if (systemTop === -1 || systemBottom === -1) {
		const noteHeight = targetRect.height;
		// Cover an massive area for multi-staff scores.
		const estimatedStaffHeight = noteHeight * 35;
		systemTop = targetRect.top + targetRect.height / 2 - estimatedStaffHeight / 2;
		systemBottom = systemTop + estimatedStaffHeight;
	}

	// Dynamic padding: 4.5 spaces (approx 4.5 note widths) to ensure 
	// absolutely full coverage of all lines and any symbols around them.
	const noteWidth = targetRect.width;
	const padding = Math.max(noteWidth * 4.5, 40);
	
	const top = systemTop - renderRect.top - padding;
	const height = systemBottom - systemTop + padding * 2;
	const left = targetRect.left - renderRect.left + targetRect.width / 2;

	playheadEl.style.left = `${left}px`;
	playheadEl.style.top = `${top}px`;
	playheadEl.style.height = `${Math.max(height, 1)}px`;
}

function parseBlockCommands(lilypondCode: string): BlockCommands {
	let listMidiDevices = false;
	let midiOutputName: string | null = null;

	for (const line of lilypondCode.split(/\r?\n/)) {
		if (/^\s*%\s*midi\s+list(?:\s+#.*)?\s*$/i.test(line)) {
			listMidiDevices = true;
			continue;
		}

		const midiOutMatch = line.match(/^\s*%\s*midi\s+out\s+["'](.+?)["'](?:\s+#.*)?\s*$/i);

		if (midiOutMatch) {
			midiOutputName = midiOutMatch[1];
		}
	}

	return {
		listMidiDevices,
		midiOutputName,
	};
}

async function logMidiOutputs(logger: BlockConsole): Promise<void> {
	const outputs = await getMidiOutputs();

	if (outputs.length === 0) {
		logger.push("No MIDI outputs available.");
		return;
	}

	logger.push(`MIDI outputs (${outputs.length})`);

	for (const output of outputs) {
		logger.push(`- ${output.name ?? "unnamed output"}`);
	}
}

function formatError(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}

	return String(error);
}

function shouldRetryWithLayoutFallback(lilypondCode: string): boolean {
	return lilypondCode.includes("\\midi") && !lilypondCode.includes("\\layout");
}

function injectLayoutFallback(lilypondCode: string): string {
	const scoreRanges = findScoreRanges(lilypondCode);

	if (scoreRanges.length === 0) {
		return lilypondCode;
	}

	let output = lilypondCode;

	for (let index = scoreRanges.length - 1; index >= 0; index -= 1) {
		const range = scoreRanges[index];
		const scoreBody = output.slice(range.bodyStart, range.end);

		if (!scoreBody.includes("\\midi") || scoreBody.includes("\\layout")) {
			continue;
		}

		output = `${output.slice(0, range.end)}\n\\layout {}\n${output.slice(range.end)}`;
	}

	return output;
}

function findScoreRanges(lilypondCode: string): Array<{
	bodyStart: number;
	end: number;
}> {
	const ranges: Array<{ bodyStart: number; end: number }> = [];
	let index = 0;

	while (index < lilypondCode.length) {
		const scoreIndex = lilypondCode.indexOf("\\score", index);

		if (scoreIndex === -1) {
			break;
		}

		let braceIndex = scoreIndex + "\\score".length;

		while (
			braceIndex < lilypondCode.length &&
			/\s/.test(lilypondCode[braceIndex])
		) {
			braceIndex += 1;
		}

		if (lilypondCode[braceIndex] !== "{") {
			index = scoreIndex + "\\score".length;
			continue;
		}

		const end = findMatchingBrace(lilypondCode, braceIndex);

		if (end === -1) {
			break;
		}

		ranges.push({
			bodyStart: braceIndex + 1,
			end,
		});

		index = end + 1;
	}

	return ranges;
}

function findMatchingBrace(lilypondCode: string, openBraceIndex: number): number {
	let depth = 0;
	let inString = false;
	let inLineComment = false;

	for (let index = openBraceIndex; index < lilypondCode.length; index += 1) {
		const char = lilypondCode[index];
		const previousChar = index === 0 ? "" : lilypondCode[index - 1];

		if (inLineComment) {
			if (char === "\n") {
				inLineComment = false;
			}
			continue;
		}

		if (char === "%" && !inString) {
			inLineComment = true;
			continue;
		}

		if (char === "\"" && previousChar !== "\\") {
			inString = !inString;
			continue;
		}

		if (inString) {
			continue;
		}

		if (char === "{") {
			depth += 1;
			continue;
		}

		if (char === "}") {
			depth -= 1;

			if (depth === 0) {
				return index;
			}
		}
	}

	return -1;
}
