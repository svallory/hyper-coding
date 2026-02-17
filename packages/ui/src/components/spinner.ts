/**
 * Spinner Component
 *
 * An animated spinner indicator for indeterminate operations.
 * Manages terminal output directly via process.stderr.write and cursor control.
 * Gracefully degrades in non-TTY/CI environments to static line output.
 */

import { getContext, styledText, symbol } from "../primitives/index.ts";
import { stripAnsi } from "../render/index.ts";

/** Options for creating a spinner. */
export type SpinnerOptions = {
	/** Initial spinner label text. */
	text?: string;
	/** Spinner animation style. Defaults to `'dots'`. */
	style?: "dots" | "line" | "arc";
	/** Output stream for spinner rendering. Defaults to `process.stderr`. */
	stream?: NodeJS.WriteStream;
};

/** Handle for controlling a running spinner. */
export type SpinnerHandle = {
	/** Start the spinner animation, optionally setting the label text. */
	start(text?: string): void;
	/** Update the spinner label text. */
	update(text: string): void;
	/** Stop the spinner, optionally showing a final message. */
	stop(finalText?: string): void;
	/** Stop with a success icon and optional message. */
	succeed(text?: string): void;
	/** Stop with a failure icon and optional message. */
	fail(text?: string): void;
};

/**
 * Creates an animated spinner for indeterminate operations.
 * Gracefully degrades to static output in non-TTY/CI environments.
 *
 * @param options - Spinner configuration.
 * @returns A handle to control the spinner lifecycle.
 */
export function spinner(options?: SpinnerOptions): SpinnerHandle {
	const ctx = getContext();
	const stream = options?.stream ?? process.stderr;
	const style = options?.style ?? "dots";
	let currentText = options?.text ?? "";
	let frameIndex = 0;
	let timer: ReturnType<typeof setInterval> | null = null;
	let startTime: number | null = null;
	let running = false;

	const spinnerKey = `spinner${style.charAt(0).toUpperCase()}${style.slice(1)}` as
		| "spinnerDots"
		| "spinnerLine"
		| "spinnerArc";
	const frames = ctx.tokens.motion[spinnerKey];
	const interval = ctx.tokens.motion.spinnerInterval;

	const isTTY = !!(stream as NodeJS.WriteStream).isTTY;
	const isInteractive = isTTY && !ctx.capabilities.isCI;

	function clearLine() {
		// Clear current line: move to column 0, clear to end of line
		stream.write("\r\x1b[K");
	}

	function renderFrame() {
		const frame = frames[frameIndex % frames.length];
		frameIndex++;
		clearLine();
		const frameStyled = styledText(frame!, { color: "accent" });
		stream.write(`${frameStyled} ${currentText}`);
	}

	function formatDuration(ms: number): string {
		if (ms < 1000) return `${ms}ms`;
		const s = (ms / 1000).toFixed(1);
		return `${s}s`;
	}

	const handle: SpinnerHandle = {
		start(text?: string) {
			if (running) return;
			running = true;
			if (text !== undefined) currentText = text;
			startTime = Date.now();

			if (!isInteractive) {
				// Non-TTY/CI: static output
				const prefix = ctx.capabilities.unicode ? symbol("running") : "[..]";
				stream.write(`${prefix} ${currentText}\n`);
				return;
			}

			// Hide cursor
			stream.write("\x1b[?25l");
			frameIndex = 0;
			renderFrame();
			timer = setInterval(renderFrame, interval);
		},

		update(text: string) {
			currentText = text;

			if (!isInteractive) {
				const prefix = ctx.capabilities.unicode ? symbol("running") : "[..]";
				stream.write(`${prefix} ${text}\n`);
				return;
			}

			// Next renderFrame tick will pick up the new text
		},

		stop(finalText?: string) {
			if (!running) return;
			running = false;

			if (timer) {
				clearInterval(timer);
				timer = null;
			}

			if (!isInteractive) {
				if (finalText) {
					stream.write(`${finalText}\n`);
				}
				return;
			}

			clearLine();
			if (finalText) {
				stream.write(`${finalText}\n`);
			}
			// Show cursor
			stream.write("\x1b[?25h");
		},

		succeed(text?: string) {
			const finalText = text ?? currentText;
			const elapsed = startTime !== null ? Date.now() - startTime : 0;
			const icon = styledText(symbol("success"), { color: "success" });
			const duration = styledText(` ${formatDuration(elapsed)}`, { dim: true });

			if (!isInteractive) {
				const prefix = ctx.capabilities.unicode ? symbol("success") : "[OK]";
				stream.write(`${prefix} ${finalText}${duration}\n`);
				running = false;
				return;
			}

			handle.stop(`${icon} ${finalText}${duration}`);
		},

		fail(text?: string) {
			const finalText = text ?? currentText;
			const icon = styledText(symbol("error"), { color: "error" });

			if (!isInteractive) {
				const prefix = ctx.capabilities.unicode ? symbol("error") : "[FAIL]";
				stream.write(`${prefix} ${finalText}\n`);
				running = false;
				return;
			}

			handle.stop(`${icon} ${finalText}`);
		},
	};

	return handle;
}
