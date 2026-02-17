/**
 * line Primitive
 *
 * Composes a single horizontal line from parts. String parts are
 * concatenated directly. Tuple [string, number] parts pad the string
 * to the given column width.
 */

import { ansiPad } from "../render/index.ts";

/**
 * A segment of a line: either a plain string or a `[text, columnWidth]` tuple
 * that pads the text to a fixed column width.
 */
export type LinePart = string | [string, number];

/**
 * Composes a horizontal line by concatenating parts.
 * Tuple parts are padded to their specified column width.
 *
 * @param parts - Line segments to compose.
 * @returns The composed line string.
 */
export function line(...parts: LinePart[]): string {
	let result = "";
	for (const part of parts) {
		if (typeof part === "string") {
			result += part;
		} else {
			const [text, colWidth] = part;
			result += ansiPad(text, colWidth);
		}
	}
	return result;
}
