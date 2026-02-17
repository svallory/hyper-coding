/**
 * ConfirmPrompt Component
 *
 * Prompts the user for a yes/no confirmation.
 * Uses Node's readline module for input handling.
 * Falls back to simple stdin reading in non-TTY environments.
 */

import * as readline from "node:readline";
import { getContext, styledText, symbol } from "../primitives/index.ts";

/** Options for creating a confirmation prompt. */
export type ConfirmPromptOptions = {
	/** The question displayed to the user. */
	message: string;
	/** Default value when the user presses Enter without typing. Defaults to `true`. */
	defaultValue?: boolean;
};

/**
 * Formats the confirm question line.
 * Returns: `? message (Y/n) > ` or `? message (y/N) > ` based on default.
 */
export function formatConfirmQuestion(message: string, defaultValue: boolean): string {
	const ctx = getContext();
	const q = styledText("?", { color: "accent", bold: true });
	const hint = defaultValue
		? styledText("(Y/n)", { dim: true })
		: styledText("(y/N)", { dim: true });
	const sep = styledText("\u203a", { dim: true });
	return `${q} ${message} ${hint} ${sep} `;
}

/**
 * Formats the submitted answer line.
 * Returns: `checkmark message Yes` or `checkmark message No`.
 */
export function formatConfirmAnswer(message: string, value: boolean): string {
	const icon = styledText(symbol("success"), { color: "success" });
	const answer = styledText(value ? "Yes" : "No", { dim: true });
	return `${icon} ${message} ${answer}`;
}

/**
 * Parses a confirm input string to a boolean.
 * Returns undefined if the input is not recognized.
 */
export function parseConfirmInput(input: string, defaultValue: boolean): boolean | undefined {
	const trimmed = input.trim().toLowerCase();
	if (trimmed === "") return defaultValue;
	if (trimmed === "y" || trimmed === "yes") return true;
	if (trimmed === "n" || trimmed === "no") return false;
	return undefined;
}

/**
 * Prompts the user for a yes/no confirmation.
 * Falls back to stdin line reading in non-TTY environments.
 *
 * @param options - Prompt configuration.
 * @returns `true` for yes, `false` for no.
 */
export function confirmPrompt(options: ConfirmPromptOptions): Promise<boolean> {
	const ctx = getContext();
	const stream = process.stderr;
	const defaultValue = options.defaultValue ?? true;
	const isTTY = !!process.stdin.isTTY;

	return new Promise<boolean>((resolve, reject) => {
		if (!isTTY) {
			// Non-TTY: read a line from stdin
			const rl = readline.createInterface({
				input: process.stdin,
				terminal: false,
			});

			const hint = defaultValue ? "(Y/n)" : "(y/N)";
			stream.write(`${options.message} ${hint}: `);

			rl.once("line", (line) => {
				const result = parseConfirmInput(line, defaultValue);
				rl.close();
				if (result === undefined) {
					reject(new Error(`Invalid input: "${line.trim()}". Expected y/yes/n/no.`));
					return;
				}
				resolve(result);
			});

			return;
		}

		// Interactive TTY mode
		function askQuestion() {
			const promptLine = formatConfirmQuestion(options.message, defaultValue);

			const rl = readline.createInterface({
				input: process.stdin,
				output: stream,
				terminal: true,
			});

			stream.write("\r\x1b[K");
			stream.write(promptLine);

			rl.question("", (answer) => {
				rl.close();

				const result = parseConfirmInput(answer, defaultValue);

				if (result === undefined) {
					// Invalid input, re-prompt
					stream.write("\n");
					const icon = styledText(symbol("error"), { color: "error" });
					stream.write(`${icon} ${styledText("Please answer y or n", { color: "error" })}\n`);
					askQuestion();
					return;
				}

				// Replace prompt with final answer
				stream.write("\r\x1b[K");
				stream.write("\x1b[A\r\x1b[K");
				stream.write(`${formatConfirmAnswer(options.message, result)}\n`);
				resolve(result);
			});
		}

		askQuestion();
	});
}
