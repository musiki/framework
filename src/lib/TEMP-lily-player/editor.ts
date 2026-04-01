import {
	App,
	MarkdownPostProcessorContext,
	Notice,
} from "obsidian";
import {
	EditorSelection,
	EditorState,
	RangeSetBuilder,
} from "@codemirror/state";
import {
	Decoration,
	DecorationSet,
	drawSelection,
	EditorView,
	highlightSpecialChars,
	keymap,
	ViewPlugin,
	ViewUpdate,
} from "@codemirror/view";

export interface EditorLogger {
	push(message: string): void;
	show(): void;
}

interface PendingEditorState {
	sourcePath: string;
	source: string;
}

interface EditorElements {
	rootEl: HTMLElement;
	toggleButton: HTMLButtonElement;
	panelEl: HTMLDivElement;
	onApply?: (source: string) => Promise<void> | void;
}

interface FencedLilyBlock {
	startLine: number;
	endLine: number;
	code: string;
}

interface HighlightSpan {
	from: number;
	to: number;
	decoration: Decoration;
	priority: number;
}

const commentDecoration = Decoration.mark({ class: "cm-lily-comment" });
const stringDecoration = Decoration.mark({ class: "cm-lily-string" });
const commandDecoration = Decoration.mark({ class: "cm-lily-command" });
const schemeDecoration = Decoration.mark({ class: "cm-lily-scheme" });
const numberDecoration = Decoration.mark({ class: "cm-lily-number" });
const noteDecoration = Decoration.mark({ class: "cm-lily-note" });
const symbolDecoration = Decoration.mark({ class: "cm-lily-symbol" });
const braceDecoration = Decoration.mark({ class: "cm-lily-brace" });
const pendingEditorState: PendingEditorState[] = [];

export class LilypondInlineEditor {
	private view: EditorView | null = null;
	private currentSource: string;
	private draftSource: string;
	private open = false;
	private shortcutsLogged = false;
	private saving = false;
	private readonly handleWindowKeydown = (event: KeyboardEvent) => {
		if (!this.open) {
			return;
		}

		const target = event.target;

		if (!(target instanceof Node) || !this.elements.panelEl.contains(target)) {
			return;
		}

		if (!event.metaKey && !event.ctrlKey) {
			return;
		}

		if (event.key.toLowerCase() === "s") {
			event.preventDefault();
			event.stopPropagation();
			event.stopImmediatePropagation();
			void this.save({ keepOpen: true });
			return;
		}

		if (event.key === "Enter") {
			event.preventDefault();
			event.stopPropagation();
			event.stopImmediatePropagation();
			void this.save({ keepOpen: false });
		}
	};

	constructor(
		private readonly app: App,
		private readonly ctx: MarkdownPostProcessorContext,
		private readonly elements: EditorElements,
		private readonly logger: EditorLogger,
		initialSource: string
	) {
		this.currentSource = normalizeCode(initialSource);
		this.draftSource = this.currentSource;

		this.elements.toggleButton.addEventListener("click", () => {
			void this.toggle();
		});
	}

	isOpen(): boolean {
		return this.open;
	}

	async toggle(): Promise<void> {
		if (this.open) {
			this.close();
			return;
		}

		this.openEditor();
	}

	close(): void {
		this.open = false;
		window.removeEventListener("keydown", this.handleWindowKeydown, true);
		this.elements.panelEl.classList.add("is-hidden");
		this.elements.toggleButton.classList.remove("is-active");
		this.view?.destroy();
		this.view = null;
	}

	destroy(): void {
		window.removeEventListener("keydown", this.handleWindowKeydown, true);
		this.view?.destroy();
		this.view = null;
	}

	restoreIfPending(currentSource: string): void {
		const normalizedSource = normalizeCode(currentSource);
		const pendingIndex = pendingEditorState.findIndex((entry) => {
			return (
				entry.sourcePath === this.ctx.sourcePath &&
				entry.source === normalizedSource
			);
		});

		if (pendingIndex === -1) {
			return;
		}

		pendingEditorState.splice(pendingIndex, 1);
		this.currentSource = normalizedSource;
		this.draftSource = normalizedSource;
		this.openEditor();
	}

	private openEditor(): void {
		window.addEventListener("keydown", this.handleWindowKeydown, true);
		this.ensureView();
		this.open = true;
		this.elements.panelEl.classList.remove("is-hidden");
		this.elements.toggleButton.classList.add("is-active");
		this.view?.focus();

		if (!this.shortcutsLogged) {
			this.logger.push("Editor: Mod-Enter save, Mod-S save, Esc close.");
			this.shortcutsLogged = true;
		}
	}

	private ensureView(): void {
		if (this.view) {
			this.syncEditorDoc(this.draftSource);
			return;
		}

		const state = EditorState.create({
			doc: this.draftSource,
			extensions: [
				EditorState.tabSize.of(2),
				drawSelection(),
				highlightSpecialChars(),
				EditorView.editable.of(true),
				EditorView.contentAttributes.of({
					spellcheck: "false",
					autocorrect: "off",
					autocapitalize: "off",
					"data-gramm": "false",
				}),
				EditorView.updateListener.of((update) => {
					if (update.docChanged) {
						this.draftSource = normalizeCode(update.state.doc.toString());
					}
				}),
				keymap.of([
					{
						key: "Mod-Enter",
						run: () => {
							void this.save();
							return true;
						},
					},
					{
						key: "Mod-s",
						run: () => {
							void this.save({ keepOpen: true });
							return true;
						},
					},
					{
						key: "Escape",
						run: () => {
							this.close();
							return true;
						},
					},
					{
						key: "Tab",
						run: (view) => {
							insertTab(view);
							return true;
						},
					},
				]),
				lilyEditorTheme,
				lilySyntaxHighlighter,
			],
		});

		this.view = new EditorView({
			state,
			parent: this.elements.panelEl,
		});
	}

	private syncEditorDoc(nextSource: string): void {
		if (!this.view) {
			return;
		}

		const currentDoc = normalizeCode(this.view.state.doc.toString());

		if (currentDoc === nextSource) {
			return;
		}

		this.view.dispatch({
			changes: {
				from: 0,
				to: this.view.state.doc.length,
				insert: nextSource,
			},
			selection: EditorSelection.cursor(nextSource.length),
		});
	}

	private async save(options: { keepOpen: boolean } = { keepOpen: false }): Promise<void> {
		if (this.saving) {
			return;
		}

		const nextSource = normalizeCode(this.view?.state.doc.toString() ?? this.draftSource);

		if (nextSource === this.currentSource) {
			this.logger.push("No LilyPond changes to save.");
			if (!options.keepOpen) {
				this.close();
			}
			return;
		}

		this.saving = true;

		try {
			await saveCodeBlockToNote(
				this.app,
				this.ctx,
				this.elements.rootEl,
				this.currentSource,
				nextSource
			);

			this.currentSource = nextSource;
			this.draftSource = nextSource;

			if (options.keepOpen) {
				queuePendingEditorState(this.ctx.sourcePath, nextSource);
			}

			await this.elements.onApply?.(nextSource);
			this.logger.push(options.keepOpen ? "LilyPond block applied." : "LilyPond block saved.");
			if (!options.keepOpen) {
				this.close();
			}
		} catch (error) {
			const message = formatError(error);
			console.error(error);
			this.logger.push(message);
			this.logger.show();
			new Notice(message, 5000);
		} finally {
			this.saving = false;
		}
	}
}

const lilyEditorTheme = EditorView.theme({
	"&": {
		backgroundColor: "transparent",
		height: "100%",
	},
	".cm-scroller": {
		overflow: "auto",
		fontFamily: "var(--font-monospace)",
	},
	".cm-content": {
		padding: "0.55rem 0.7rem 0.8rem",
		caretColor: "var(--text-normal)",
	},
	".cm-line": {
		padding: "0",
	},
	".cm-cursor": {
		borderLeftColor: "var(--text-normal)",
	},
	".cm-selectionBackground, ::selection": {
		backgroundColor: "color-mix(in srgb, var(--interactive-accent) 22%, transparent)",
	},
	".cm-lily-comment": {
		color: "var(--text-faint)",
		fontStyle: "italic",
	},
	".cm-lily-string": {
		color: "#c0702f",
	},
	".cm-lily-command": {
		color: "#2f6fbe",
		fontWeight: "600",
	},
	".cm-lily-scheme": {
		color: "#7a3fa1",
		fontWeight: "600",
	},
	".cm-lily-number": {
		color: "#8f5b00",
	},
	".cm-lily-note": {
		color: "#1b7a5e",
		fontWeight: "600",
	},
	".cm-lily-symbol": {
		color: "var(--text-accent)",
		fontWeight: "600",
	},
	".cm-lily-brace": {
		color: "var(--text-muted)",
	},
});

const lilySyntaxHighlighter = ViewPlugin.fromClass(class {
	decorations: DecorationSet;

	constructor(view: EditorView) {
		this.decorations = buildDecorations(view);
	}

	update(update: ViewUpdate): void {
		if (update.docChanged || update.viewportChanged) {
			this.decorations = buildDecorations(update.view);
		}
	}
}, {
	decorations: (value) => value.decorations,
});

function buildDecorations(view: EditorView): DecorationSet {
	const builder = new RangeSetBuilder<Decoration>();

	for (let lineNumber = 1; lineNumber <= view.state.doc.lines; lineNumber += 1) {
		const line = view.state.doc.line(lineNumber);
		highlightLine(line.from, line.text, builder);
	}

	return builder.finish();
}

function highlightLine(
	lineStart: number,
	lineText: string,
	builder: RangeSetBuilder<Decoration>
): void {
	const commentIndex = findCommentStart(lineText);
	const codeText = commentIndex === -1 ? lineText : lineText.slice(0, commentIndex);
	const spans: HighlightSpan[] = [];

	if (commentIndex !== -1) {
		spans.push({
			from: lineStart + commentIndex,
			to: lineStart + lineText.length,
			decoration: commentDecoration,
			priority: 6,
		});
	}

	collectMatches(spans, codeText, lineStart, /"(?:[^"\\]|\\.)*"?/g, stringDecoration, 0);
	collectMatches(spans, codeText, lineStart, /\\[A-Za-z][\w-]*/g, commandDecoration, 1);
	collectMatches(spans, codeText, lineStart, /##?[tf]\b|#'[A-Za-z][\w-]*|#:[A-Za-z][\w-]*/g, schemeDecoration, 2);
	collectMatches(spans, codeText, lineStart, /\b[a-g](?:es|is|eh|ih|s|f)?[,']*\d*\.?(?:\*[\d/]+)?\b/gi, noteDecoration, 3);
	collectMatches(spans, codeText, lineStart, /\b[A-Za-z][\w-]*(?=\s*=)/g, symbolDecoration, 4);
	collectMatches(spans, codeText, lineStart, /\b-?\d+(?:\.\d+)?\b/g, numberDecoration, 5);
	collectMatches(spans, codeText, lineStart, /[{}<>\[\]]/g, braceDecoration, 7);
	applyHighlightSpans(spans, builder);
}

function collectMatches(
	spans: HighlightSpan[],
	text: string,
	lineStart: number,
	regex: RegExp,
	decoration: Decoration,
	priority: number
): void {
	let match: RegExpExecArray | null;
	regex.lastIndex = 0;

	while ((match = regex.exec(text)) !== null) {
		spans.push({
			from: lineStart + match.index,
			to: lineStart + match.index + match[0].length,
			decoration,
			priority,
		});
	}
}

function applyHighlightSpans(
	spans: HighlightSpan[],
	builder: RangeSetBuilder<Decoration>
): void {
	spans.sort((left, right) => {
		if (left.from !== right.from) {
			return left.from - right.from;
		}

		if (left.priority !== right.priority) {
			return left.priority - right.priority;
		}

		return (right.to - right.from) - (left.to - left.from);
	});

	let lastTo = -1;

	for (const span of spans) {
		if (span.to <= span.from) {
			continue;
		}

		if (span.from < lastTo) {
			continue;
		}

		builder.add(span.from, span.to, span.decoration);
		lastTo = span.to;
	}
}

function findCommentStart(lineText: string): number {
	let escaped = false;

	for (let index = 0; index < lineText.length; index += 1) {
		const char = lineText[index];

		if (char === "\\" && !escaped) {
			escaped = true;
			continue;
		}

		if (char === "%" && !escaped) {
			return index;
		}

		escaped = false;
	}

	return -1;
}

function insertTab(view: EditorView): void {
	const change = view.state.changeByRange((range) => {
		return {
			changes: {
				from: range.from,
				to: range.to,
				insert: "\t",
			},
			range: EditorSelection.cursor(range.from + 1),
		};
	});

	view.dispatch(change, {
		userEvent: "input",
		scrollIntoView: true,
	});
}

async function saveCodeBlockToNote(
	app: App,
	ctx: MarkdownPostProcessorContext,
	containerEl: HTMLElement,
	previousSource: string,
	nextSource: string
): Promise<void> {
	const file = app.vault.getFileByPath(ctx.sourcePath);

	if (!file) {
		throw new Error(`LilyPond source file not found: ${ctx.sourcePath}`);
	}

	const currentFileText = normalizeLineEndings(await app.vault.cachedRead(file));
	const sectionInfo = ctx.getSectionInfo(containerEl);
	const nextFileText = replaceCodeBlockSource(
		currentFileText,
		sectionInfo?.text ?? null,
		sectionInfo?.lineStart ?? null,
		sectionInfo?.lineEnd ?? null,
		previousSource,
		nextSource
	);

	await app.vault.modify(file, nextFileText);
}

function replaceCodeBlockSource(
	fileText: string,
	sectionText: string | null,
	lineStart: number | null,
	lineEnd: number | null,
	previousSource: string,
	nextSource: string
): string {
	const fileLines = fileText.split("\n");
	const normalizedPreviousSource = normalizeCode(previousSource);
	const nextSourceLines = sourceToLines(nextSource);

	if (sectionText !== null && lineStart !== null && lineEnd !== null) {
		const sectionBounds = resolveSectionBounds(fileLines, sectionText, lineStart, lineEnd);

		if (sectionBounds) {
			const updated = replaceCodeBlockInLineRange(
				fileLines,
				sectionBounds.start,
				sectionBounds.endExclusive,
				normalizedPreviousSource,
				nextSourceLines
			);

			if (updated) {
				return updated.join("\n");
			}
		}
	}

	const updated = replaceCodeBlockInLineRange(
		fileLines,
		0,
		fileLines.length,
		normalizedPreviousSource,
		nextSourceLines
	);

	if (!updated) {
		throw new Error("Could not locate the LilyPond code block in the note.");
	}

	return updated.join("\n");
}

function resolveSectionBounds(
	fileLines: string[],
	sectionText: string,
	lineStart: number,
	lineEnd: number
): { start: number; endExclusive: number } | null {
	const normalizedSectionText = normalizeCode(sectionText);
	const candidates = [
		{ start: lineStart, endExclusive: lineEnd },
		{ start: lineStart, endExclusive: lineEnd + 1 },
	];

	for (const candidate of candidates) {
		if (
			candidate.start < 0 ||
			candidate.start > fileLines.length ||
			candidate.endExclusive < candidate.start ||
			candidate.endExclusive > fileLines.length
		) {
			continue;
		}

		const candidateText = normalizeCode(
			fileLines.slice(candidate.start, candidate.endExclusive).join("\n")
		);

		if (candidateText === normalizedSectionText) {
			return candidate;
		}
	}

	return null;
}

function replaceCodeBlockInLineRange(
	fileLines: string[],
	startLine: number,
	endExclusive: number,
	previousSource: string,
	nextSourceLines: string[]
): string[] | null {
	const regionLines = fileLines.slice(startLine, endExclusive);
	const blocks = parseFencedLilyBlocks(regionLines);
	const targetBlock = blocks.find((block) => normalizeCode(block.code) === previousSource);

	if (!targetBlock) {
		return null;
	}

	const updatedRegionLines = [
		...regionLines.slice(0, targetBlock.startLine + 1),
		...nextSourceLines,
		...regionLines.slice(targetBlock.endLine),
	];

	return [
		...fileLines.slice(0, startLine),
		...updatedRegionLines,
		...fileLines.slice(endExclusive),
	];
}

function parseFencedLilyBlocks(lines: string[]): FencedLilyBlock[] {
	const blocks: FencedLilyBlock[] = [];
	let index = 0;

	while (index < lines.length) {
		const openingFence = parseOpeningFence(lines[index]);

		if (!openingFence) {
			index += 1;
			continue;
		}

		let closingIndex = index + 1;

		while (closingIndex < lines.length) {
			if (isClosingFence(lines[closingIndex], openingFence.character, openingFence.length)) {
				break;
			}

			closingIndex += 1;
		}

		if (closingIndex >= lines.length) {
			break;
		}

		blocks.push({
			startLine: index,
			endLine: closingIndex,
			code: lines.slice(index + 1, closingIndex).join("\n"),
		});

		index = closingIndex + 1;
	}

	return blocks;
}

function parseOpeningFence(
	line: string
): { character: "`" | "~"; length: number } | null {
	const match = line.match(/^\s*([`~]{3,})(.*)$/);

	if (!match) {
		return null;
	}

	const infoString = match[2].trim();
	const language = infoString.split(/\s+/)[0]?.toLowerCase() ?? "";

	if (language !== "lily") {
		return null;
	}

	return {
		character: match[1][0] as "`" | "~",
		length: match[1].length,
	};
}

function isClosingFence(
	line: string,
	character: "`" | "~",
	length: number
): boolean {
	return new RegExp(`^\\s*${escapeRegExp(character)}{${length},}\\s*$`).test(line);
}

function sourceToLines(source: string): string[] {
	const normalized = normalizeCode(source);
	return normalized === "" ? [] : normalized.split("\n");
}

function normalizeCode(source: string): string {
	return normalizeLineEndings(source).replace(/\n$/, "");
}

function normalizeLineEndings(text: string): string {
	return text.replace(/\r\n?/g, "\n");
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatError(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}

	return String(error);
}

function queuePendingEditorState(sourcePath: string, source: string): void {
	const normalizedSource = normalizeCode(source);
	const existingIndex = pendingEditorState.findIndex((entry) => {
		return entry.sourcePath === sourcePath;
	});

	if (existingIndex !== -1) {
		pendingEditorState.splice(existingIndex, 1);
	}

	pendingEditorState.push({
		sourcePath,
		source: normalizedSource,
	});
}
