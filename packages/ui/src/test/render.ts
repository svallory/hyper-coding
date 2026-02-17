/**
 * Test Rendering Utilities
 *
 * Captures rendered output and provides assertions for ANSI-styled strings.
 */

import { stripAnsi } from "../render/index.ts";
import { stringWidth } from "../render/index.ts";

export type RenderedOutput = {
	/** The raw string with ANSI codes */
	readonly styled: string;
	/** Plain text with all ANSI codes stripped */
	readonly plain: string;
	/** Whether any color codes are present (not just typography) */
	readonly hasColor: boolean;
	/** Whether a specific SGR attribute is present */
	hasStyle(attr: "bold" | "dim" | "italic" | "underline" | "strikethrough" | "inverse"): boolean;
	/** Visual width of the first line */
	readonly width: number;
	/** Array of visual lines (split by \n, stripped of ANSI) */
	readonly lines: string[];
	/** Number of visual lines */
	readonly lineCount: number;
};

/**
 * Regex matching SGR sequences that contain color codes.
 * Color codes: 30-37, 38, 39, 40-47, 48, 49, 90-97, 100-107
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape detection requires control characters
const COLOR_SGR_REGEX = /\x1b\[([0-9;]*)m/g;

/** SGR code numbers for style attributes */
const STYLE_CODES: Record<string, number> = {
	bold: 1,
	dim: 2,
	italic: 3,
	underline: 4,
	inverse: 7,
	strikethrough: 9,
};

function isColorCode(code: number): boolean {
	return (code >= 30 && code <= 49) || (code >= 90 && code <= 97) || (code >= 100 && code <= 107);
}

function detectColor(raw: string): boolean {
	const regex = new RegExp(COLOR_SGR_REGEX.source, "g");
	for (const match of raw.matchAll(regex)) {
		const params = match[1]!;
		if (params === "" || params === "0") continue;
		const parts = params.split(";");
		for (const part of parts) {
			const code = Number.parseInt(part, 10);
			if (!Number.isNaN(code) && isColorCode(code)) {
				return true;
			}
		}
	}
	return false;
}

function detectStyle(raw: string, attr: string): boolean {
	const targetCode = STYLE_CODES[attr];
	if (targetCode === undefined) return false;

	const regex = new RegExp(COLOR_SGR_REGEX.source, "g");
	for (const match of raw.matchAll(regex)) {
		const params = match[1]!;
		if (params === "" || params === "0") continue;
		const parts = params.split(";");
		for (const part of parts) {
			const code = Number.parseInt(part, 10);
			if (code === targetCode) return true;
		}
	}
	return false;
}

/**
 * Wraps a rendered string in a {@link RenderedOutput} object for inspection and assertions.
 *
 * @param output - The raw styled string to analyze.
 * @returns A {@link RenderedOutput} object with plain text, color detection, and style queries.
 */
export function render(output: string): RenderedOutput {
	const plain = stripAnsi(output);
	const lines = plain.split("\n");

	return {
		styled: output,
		plain,
		get hasColor() {
			return detectColor(output);
		},
		hasStyle(attr) {
			return detectStyle(output, attr);
		},
		get width() {
			return stringWidth(lines[0] ?? "");
		},
		lines,
		get lineCount() {
			return lines.length;
		},
	};
}
