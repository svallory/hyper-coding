/**
 * truncate Primitive
 *
 * Truncates a string to a maximum visual width, with support for
 * end, start, and middle truncation positions. ANSI-aware.
 */

import { ansiTruncate, stringWidth, stripAnsi } from "../render/index.ts";
import { getContext } from "./context.ts";

/** Options for truncating text. */
export type TruncateOptions = {
	/** Where to truncate: `'end'` (default), `'start'`, or `'middle'`. */
	position?: "end" | "middle" | "start";
	/** Ellipsis string inserted at the truncation point. Defaults to the resolved symbol token. */
	ellipsis?: string;
};

/**
 * Truncates text to fit within a maximum visual width, inserting an ellipsis at the cut point.
 *
 * @param text - The text to truncate.
 * @param maxWidth - Maximum visual width in columns.
 * @param options - Truncation configuration.
 * @returns The truncated text string, or the original if it already fits.
 */
export function truncate(text: string, maxWidth: number, options?: TruncateOptions): string {
	const ctx = getContext();
	const position = options?.position ?? "end";
	const ellipsis = options?.ellipsis ?? ctx.tokens.symbol.ellipsis;

	const currentWidth = stringWidth(text);
	if (currentWidth <= maxWidth) return text;

	const ellipsisWidth = stringWidth(ellipsis);

	if (position === "end") {
		return ansiTruncate(text, maxWidth, ellipsis);
	}

	if (position === "start") {
		// Keep the end of the string, prepend ellipsis
		const targetWidth = maxWidth - ellipsisWidth;
		if (targetWidth <= 0) {
			return ellipsisWidth <= maxWidth ? ellipsis : "";
		}

		// For start truncation, work on plain text for simplicity
		// (ANSI in the middle of a start-truncated string is edge-case)
		const plain = stripAnsi(text);
		// Walk backwards to find the cut point
		let width = 0;
		let cutIndex = plain.length;
		for (let i = plain.length - 1; i >= 0; i--) {
			const code = plain.codePointAt(i)!;
			// Skip low surrogates
			if (code >= 0xdc00 && code <= 0xdfff) continue;
			const charW = code > 0xffff ? 2 : code >= 0x1100 && isFullWidth(code) ? 2 : 1;
			if (width + charW > targetWidth) break;
			width += charW;
			cutIndex = i;
		}

		return ellipsis + plain.slice(cutIndex);
	}

	// Middle truncation: keep first half + ellipsis + last half
	const targetWidth = maxWidth - ellipsisWidth;
	if (targetWidth <= 0) {
		return ellipsisWidth <= maxWidth ? ellipsis : "";
	}

	const plain = stripAnsi(text);
	const firstHalfWidth = Math.ceil(targetWidth / 2);
	const lastHalfWidth = Math.floor(targetWidth / 2);

	// Find first half end
	let width = 0;
	let firstEnd = 0;
	for (let i = 0; i < plain.length; i++) {
		const code = plain.codePointAt(i)!;
		if (code >= 0xdc00 && code <= 0xdfff) continue;
		const charW = code > 0xffff ? 2 : code >= 0x1100 && isFullWidth(code) ? 2 : 1;
		if (width + charW > firstHalfWidth) break;
		width += charW;
		firstEnd = i + (code > 0xffff ? 2 : 1);
	}

	// Find last half start (walk backwards)
	width = 0;
	let lastStart = plain.length;
	for (let i = plain.length - 1; i >= 0; i--) {
		const code = plain.codePointAt(i)!;
		if (code >= 0xdc00 && code <= 0xdfff) continue;
		const charW = code > 0xffff ? 2 : code >= 0x1100 && isFullWidth(code) ? 2 : 1;
		if (width + charW > lastHalfWidth) break;
		width += charW;
		lastStart = i;
	}

	return plain.slice(0, firstEnd) + ellipsis + plain.slice(lastStart);
}

/** Checks whether a Unicode code point is a full-width character. */
function isFullWidth(code: number): boolean {
	return (
		(code >= 0x1100 && code <= 0x115f) ||
		(code >= 0x2e80 && code <= 0xa4cf) ||
		(code >= 0xac00 && code <= 0xd7a3) ||
		(code >= 0xf900 && code <= 0xfaff) ||
		(code >= 0xfe10 && code <= 0xfe6f) ||
		(code >= 0xff01 && code <= 0xff60) ||
		(code >= 0xffe0 && code <= 0xffe6)
	);
}
