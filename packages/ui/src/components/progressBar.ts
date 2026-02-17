/**
 * ProgressBar Component
 *
 * A progress bar for determinate or indeterminate operations.
 * Renders an animated bar with percentage, using spinner frames for the leading indicator.
 * Gracefully degrades in non-TTY/CI environments to periodic percentage updates.
 */

import { getContext, styledText, symbol } from "../primitives/index.ts";

/** Options for creating a progress bar. */
export type ProgressBarOptions = {
	/** Total number of units for determinate progress. Omit for indeterminate mode. */
	total?: number;
	/** Width of the progress bar in characters. Defaults to `30`. */
	width?: number;
	/** Label text displayed alongside the bar. */
	label?: string;
	/** Whether to show a percentage indicator. Defaults to `true`. */
	showPercentage?: boolean;
	/** Output stream for progress bar rendering. Defaults to `process.stderr`. */
	stream?: NodeJS.WriteStream;
};

/** Handle for controlling a running progress bar. */
export type ProgressBarHandle = {
	/** Start the progress bar, optionally setting the label. */
	start(label?: string): void;
	/** Set the current progress value, optionally updating the label. */
	update(current: number, label?: string): void;
	/** Increment progress by an amount. Defaults to `1`. */
	increment(amount?: number): void;
	/** Stop the progress bar, optionally showing a final message. */
	stop(finalText?: string): void;
	/** Stop with a success icon and optional message. */
	succeed(text?: string): void;
	/** Stop with a failure icon and optional message. */
	fail(text?: string): void;
};

/**
 * Creates a progress bar for determinate or indeterminate operations.
 * Gracefully degrades to periodic percentage updates in non-TTY environments.
 *
 * @param options - Progress bar configuration.
 * @returns A handle to control the progress bar lifecycle.
 */
export function progressBar(options?: ProgressBarOptions): ProgressBarHandle {
	const ctx = getContext();
	const stream = options?.stream ?? process.stderr;
	const total = options?.total;
	const barWidth = options?.width ?? 30;
	const showPercentage = options?.showPercentage ?? true;
	let label = options?.label ?? "";
	let current = 0;
	let running = false;
	let timer: ReturnType<typeof setInterval> | null = null;
	let spinnerFrame = 0;
	let lastReportedDecile = -1;

	const spinnerFrames = ctx.tokens.motion.spinnerDots;
	const filledChar = ctx.tokens.motion.progressFilled;
	const partialChar = ctx.tokens.motion.progressPartial;
	const interval = ctx.tokens.motion.progressInterval;

	const isTTY = !!(stream as NodeJS.WriteStream).isTTY;
	const isInteractive = isTTY && !ctx.capabilities.isCI;

	function clearLine() {
		stream.write("\r\x1b[K");
	}

	function renderBar() {
		if (total === undefined) {
			// Indeterminate mode
			const frame = spinnerFrames[spinnerFrame % spinnerFrames.length];
			spinnerFrame++;
			const frameStyled = styledText(frame!, { color: "accent" });
			clearLine();
			stream.write(`${frameStyled} ${label}`);
			return;
		}

		const pct = Math.min(current / total, 1);
		const filled = Math.round(pct * barWidth);
		const empty = barWidth - filled;

		const frame = spinnerFrames[spinnerFrame % spinnerFrames.length];
		spinnerFrame++;
		const frameStyled = styledText(frame!, { color: "accent" });

		const barFilled = styledText(filledChar.repeat(filled), { color: "accent" });
		const barEmpty = styledText(partialChar.repeat(empty), { dim: true });
		const bar = barFilled + barEmpty;

		const pctStr = showPercentage ? ` ${Math.round(pct * 100)}%` : "";
		const labelStr = label ? ` ${label}` : "";

		clearLine();
		stream.write(`${frameStyled}${labelStr} ${bar}${pctStr}`);
	}

	function checkComplete() {
		if (total !== undefined && current >= total) {
			handle.succeed();
		}
	}

	const handle: ProgressBarHandle = {
		start(startLabel?: string) {
			if (running) return;
			running = true;
			if (startLabel !== undefined) label = startLabel;
			current = 0;
			lastReportedDecile = -1;

			if (!isInteractive) {
				const pctStr = total !== undefined ? " 0%" : "";
				stream.write(`${label}...${pctStr}\n`);
				lastReportedDecile = 0;
				return;
			}

			stream.write("\x1b[?25l");
			spinnerFrame = 0;
			renderBar();
			timer = setInterval(renderBar, interval);
		},

		update(value: number, updateLabel?: string) {
			current = value;
			if (updateLabel !== undefined) label = updateLabel;

			if (!isInteractive) {
				if (total !== undefined) {
					const pct = Math.min(current / total, 1);
					const decile = Math.floor(pct * 10);
					if (decile > lastReportedDecile) {
						lastReportedDecile = decile;
						stream.write(`${label}... ${Math.round(pct * 100)}%\n`);
					}
				}
				if (total !== undefined && current >= total) {
					handle.succeed();
				}
				return;
			}

			checkComplete();
		},

		increment(amount?: number) {
			handle.update(current + (amount ?? 1));
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
			stream.write("\x1b[?25h");
		},

		succeed(text?: string) {
			const finalText = text ?? label;
			const icon = styledText(symbol("success"), { color: "success" });

			if (!isInteractive) {
				const prefix = ctx.capabilities.unicode ? symbol("success") : "[OK]";
				stream.write(`${prefix} ${finalText}\n`);
				running = false;
				return;
			}

			handle.stop(`${icon} ${finalText}`);
		},

		fail(text?: string) {
			const finalText = text ?? label;
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
