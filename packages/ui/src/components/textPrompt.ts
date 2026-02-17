/**
 * TextPrompt Component
 *
 * Prompts the user for text input with validation, placeholder, and default value support.
 * Uses Node's readline module for input handling.
 * Falls back to simple stdin reading in non-TTY environments.
 */

import * as readline from "node:readline";
import { getContext, styledText, symbol } from "../primitives/index.ts";

/** Options for creating a text input prompt. */
export type TextPromptOptions = {
	/** The question or label displayed to the user. */
	message: string;
	/** Placeholder text shown when the input is empty. */
	placeholder?: string;
	/** Default value used when the user submits an empty input. */
	defaultValue?: string;
	/** Validation function. Return an error message string to reject, or `undefined` to accept. */
	validate?: (value: string) => string | undefined;
	/** Whether an empty input is rejected. Defaults to `false`. */
	required?: boolean;
};

/**
 * Formats the prompt question line.
 * Returns: `? message > ` with `?` in accent color and `>` as separator.
 */
export function formatTextQuestion(message: string): string {
	const ctx = getContext();
	const q = styledText("?", { color: "accent", bold: true });
	const sep = styledText("\u203a", { dim: true });
	return `${q} ${message} ${sep} `;
}

/**
 * Formats the submitted answer line.
 * Returns: `checkmark message value` with value in dim.
 */
export function formatTextAnswer(message: string, value: string): string {
	const icon = styledText(symbol("success"), { color: "success" });
	const val = styledText(value, { dim: true });
	return `${icon} ${message} ${val}`;
}

/**
 * Formats a validation error.
 */
export function formatValidationError(error: string): string {
	const icon = styledText(symbol("error"), { color: "error" });
	return `${icon} ${styledText(error, { color: "error" })}`;
}

/**
 * Prompts the user for single-line text input with validation support.
 * Falls back to simple stdin reading in non-TTY environments.
 *
 * @param options - Prompt configuration.
 * @returns The validated user input string.
 */
export function textPrompt(options: TextPromptOptions): Promise<string> {
	const ctx = getContext();
	const stream = process.stderr;
	const isTTY = !!process.stdin.isTTY;

	return new Promise<string>((resolve, reject) => {
		if (!isTTY) {
			// Non-TTY: read a line from stdin directly
			const rl = readline.createInterface({
				input: process.stdin,
				terminal: false,
			});

			stream.write(`${options.message}: `);

			rl.once("line", (line) => {
				const value = line.trim() || options.defaultValue || "";

				if (options.required && !value) {
					rl.close();
					reject(new Error("Input required but received empty value in non-interactive mode"));
					return;
				}

				if (options.validate) {
					const error = options.validate(value);
					if (error) {
						rl.close();
						reject(new Error(error));
						return;
					}
				}

				rl.close();
				resolve(value);
			});

			rl.once("close", () => {
				// If stdin closes without a line (e.g. EOF), resolve with default
			});

			return;
		}

		// Interactive TTY mode
		const promptLine = formatTextQuestion(options.message);
		const placeholderText = options.placeholder
			? styledText(options.placeholder, { dim: true })
			: "";

		function askQuestion() {
			stream.write("\r\x1b[K");
			stream.write(promptLine);
			if (placeholderText && !options.defaultValue) {
				// Show placeholder, but it will be overwritten on typing
			}

			const rl = readline.createInterface({
				input: process.stdin,
				output: stream,
				terminal: true,
			});

			rl.question("", (answer) => {
				rl.close();

				const value = answer.trim() || options.defaultValue || "";

				if (options.required && !value) {
					stream.write("\n");
					stream.write(`${formatValidationError("This field is required")}\n`);
					askQuestion();
					return;
				}

				if (options.validate) {
					const error = options.validate(value);
					if (error) {
						stream.write("\n");
						stream.write(`${formatValidationError(error)}\n`);
						askQuestion();
						return;
					}
				}

				// Replace prompt with final answer
				stream.write("\r\x1b[K");
				// Move up one line to overwrite the question
				stream.write("\x1b[A\r\x1b[K");
				stream.write(`${formatTextAnswer(options.message, value)}\n`);
				resolve(value);
			});
		}

		askQuestion();
	});
}
