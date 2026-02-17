/**
 * SelectPrompt Component
 *
 * Prompts the user to select a single option from a list.
 * Uses raw mode to capture keystrokes for arrow navigation.
 * Falls back to numbered list input in non-TTY environments.
 */

import * as readline from "node:readline";
import { getContext, styledText, symbol } from "../primitives/index.ts";

/**
 * A single option in a select prompt.
 * @typeParam T - The value type returned when this option is selected.
 */
export type SelectOption<T> = {
	/** Display label shown to the user. */
	label: string;
	/** Value returned when this option is selected. */
	value: T;
	/** Hint text shown next to the label when active. */
	hint?: string;
	/** Whether this option is disabled and cannot be selected. */
	disabled?: boolean;
};

/**
 * Options for creating a select prompt.
 * @typeParam T - The value type of the selectable options.
 */
export type SelectPromptOptions<T> = {
	/** The question displayed above the option list. */
	message: string;
	/** Available options to choose from. */
	options: SelectOption<T>[];
	/** Maximum number of options visible at once before scrolling. Defaults to `10`. */
	maxVisible?: number;
};

/**
 * Formats the select question line.
 * Returns: `? message` with `?` in accent color.
 */
export function formatSelectQuestion(message: string): string {
	const q = styledText("?", { color: "accent", bold: true });
	return `${q} ${message}`;
}

/**
 * Formats the submitted answer line.
 * Returns: `checkmark message selected-label`.
 */
export function formatSelectAnswer(message: string, selectedLabel: string): string {
	const icon = styledText(symbol("success"), { color: "success" });
	const label = styledText(selectedLabel, { dim: true });
	return `${icon} ${message} ${label}`;
}

/**
 * Renders the option list for display.
 * Returns an array of formatted option lines.
 */
export function renderOptions<T>(
	options: SelectOption<T>[],
	activeIndex: number,
	scrollOffset: number,
	maxVisible: number,
): string[] {
	const ctx = getContext();
	const lines: string[] = [];
	const visible = options.slice(scrollOffset, scrollOffset + maxVisible);

	for (let i = 0; i < visible.length; i++) {
		const option = visible[i]!;
		const realIndex = scrollOffset + i;
		const isActive = realIndex === activeIndex;

		if (option.disabled) {
			const pointer = "  ";
			const label = styledText(option.label, { dim: true });
			const disabled = styledText("(disabled)", { dim: true });
			lines.push(`${pointer}${label} ${disabled}`);
		} else if (isActive) {
			const pointer = styledText(symbol("pointer"), { color: "accent" });
			const label = styledText(option.label, { color: "accent" });
			const hint = option.hint ? ` ${styledText(option.hint, { dim: true })}` : "";
			lines.push(`${pointer} ${label}${hint}`);
		} else {
			const pointer = "  ";
			lines.push(`${pointer}${option.label}`);
		}
	}

	// Scroll indicators
	if (scrollOffset > 0) {
		const arrow = styledText(symbol("arrowUp"), { dim: true });
		lines[0] = `${lines[0]}  ${arrow}`;
	}
	if (scrollOffset + maxVisible < options.length) {
		const arrow = styledText(symbol("arrowDown"), { dim: true });
		lines[lines.length - 1] = `${lines[lines.length - 1]}  ${arrow}`;
	}

	return lines;
}

/**
 * Find the next non-disabled index in a direction.
 */
function findNextEnabled<T>(options: SelectOption<T>[], from: number, direction: 1 | -1): number {
	let index = from;
	const len = options.length;
	for (let attempts = 0; attempts < len; attempts++) {
		index = (index + direction + len) % len;
		if (!options[index]!.disabled) return index;
	}
	return from; // All disabled, stay put
}

/**
 * Prompts the user to select a single option from a list using arrow-key navigation.
 * Falls back to numbered list input in non-TTY environments.
 *
 * @typeParam T - The value type of the selectable options.
 * @param options - Select prompt configuration.
 * @returns The value of the selected option.
 */
export function selectPrompt<T>(options: SelectPromptOptions<T>): Promise<T> {
	const ctx = getContext();
	const stream = process.stderr;
	const maxVisible = options.maxVisible ?? 10;
	const isTTY = !!process.stdin.isTTY;

	// Find first non-disabled option
	let activeIndex = options.options.findIndex((o) => !o.disabled);
	if (activeIndex === -1) {
		return Promise.reject(new Error("All options are disabled"));
	}

	let scrollOffset = 0;

	function adjustScroll() {
		if (activeIndex < scrollOffset) {
			scrollOffset = activeIndex;
		} else if (activeIndex >= scrollOffset + maxVisible) {
			scrollOffset = activeIndex - maxVisible + 1;
		}
	}

	return new Promise<T>((resolve, reject) => {
		if (!isTTY) {
			// Non-TTY: numbered list fallback
			stream.write(`${options.message}\n`);
			options.options.forEach((opt, i) => {
				const disabled = opt.disabled ? " (disabled)" : "";
				stream.write(`  ${i + 1}. ${opt.label}${disabled}\n`);
			});
			stream.write("Enter number: ");

			const rl = readline.createInterface({
				input: process.stdin,
				terminal: false,
			});

			rl.once("line", (line) => {
				rl.close();
				const num = Number.parseInt(line.trim(), 10);
				if (Number.isNaN(num) || num < 1 || num > options.options.length) {
					reject(new Error(`Invalid selection: "${line.trim()}"`));
					return;
				}
				const selected = options.options[num - 1]!;
				if (selected.disabled) {
					reject(new Error(`Option "${selected.label}" is disabled`));
					return;
				}
				resolve(selected.value);
			});

			return;
		}

		// Interactive TTY mode with raw keypress handling
		const question = formatSelectQuestion(options.message);
		let renderedLines = 0;

		function render() {
			// Clear previously rendered lines
			if (renderedLines > 0) {
				for (let i = 0; i < renderedLines; i++) {
					stream.write("\x1b[A"); // move up
				}
				stream.write("\r\x1b[J"); // clear from cursor to end
			}

			adjustScroll();
			const lines = renderOptions(options.options, activeIndex, scrollOffset, maxVisible);

			stream.write(`${question}\n`);
			for (const line of lines) {
				stream.write(`${line}\n`);
			}
			renderedLines = lines.length + 1; // +1 for the question line
		}

		// Hide cursor
		stream.write("\x1b[?25l");
		render();

		// Enable raw mode for keypress capture
		process.stdin.setRawMode(true);
		process.stdin.resume();

		const onData = (data: Buffer) => {
			const key = data.toString();

			// Ctrl+C
			if (key === "\x03") {
				cleanup();
				stream.write("\x1b[?25h");
				reject(new Error("Prompt cancelled"));
				return;
			}

			// Enter
			if (key === "\r" || key === "\n") {
				cleanup();
				// Clear the rendered options
				if (renderedLines > 0) {
					for (let i = 0; i < renderedLines; i++) {
						stream.write("\x1b[A");
					}
					stream.write("\r\x1b[J");
				}
				const selected = options.options[activeIndex]!;
				stream.write(`${formatSelectAnswer(options.message, selected.label)}\n`);
				stream.write("\x1b[?25h");
				resolve(selected.value);
				return;
			}

			// Arrow keys (escape sequences)
			if (key === "\x1b[A" || key === "k") {
				// Up
				activeIndex = findNextEnabled(options.options, activeIndex, -1);
				render();
			} else if (key === "\x1b[B" || key === "j") {
				// Down
				activeIndex = findNextEnabled(options.options, activeIndex, 1);
				render();
			}
		};

		function cleanup() {
			process.stdin.removeListener("data", onData);
			process.stdin.setRawMode(false);
			process.stdin.pause();
		}

		process.stdin.on("data", onData);
	});
}
