/**
 * ANSI-Aware String Operations
 *
 * String manipulation functions that understand ANSI escape sequences,
 * ensuring styles are properly preserved, carried, and closed across
 * truncation, padding, slicing, and wrapping operations.
 */

import { stripAnsi } from "./strip.ts";
import { charWidth, stringWidth } from "./width.ts";

/**
 * Parse a string into segments: either ANSI escape sequences or visible characters.
 * Each segment is tagged with its type.
 */
type Segment = { type: "ansi"; value: string } | { type: "char"; value: string; width: number };

function parseSegments(str: string): Segment[] {
	const segments: Segment[] = [];
	let i = 0;

	while (i < str.length) {
		// ANSI escape sequence
		if (str.charCodeAt(i) === 0x1b && str[i + 1] === "[") {
			let j = i + 2;
			while (j < str.length) {
				const ch = str.charCodeAt(j);
				if ((ch >= 0x41 && ch <= 0x5a) || (ch >= 0x61 && ch <= 0x7a)) {
					segments.push({ type: "ansi", value: str.slice(i, j + 1) });
					i = j + 1;
					break;
				}
				j++;
			}
			if (j >= str.length) {
				// Unterminated sequence, treat as text
				segments.push({ type: "char", value: str.slice(i), width: 1 });
				break;
			}
			continue;
		}

		// Regular character (handle surrogate pairs)
		const code = str.codePointAt(i)!;
		const charLen = code > 0xffff ? 2 : 1;
		const ch = str.slice(i, i + charLen);
		segments.push({ type: "char", value: ch, width: charWidth(code) });
		i += charLen;
	}

	return segments;
}

/**
 * Track which ANSI SGR styles are currently "open" by accumulating
 * all SGR sequences encountered. Returns the concatenation of all
 * active style sequences (for re-opening after a break).
 */
function collectOpenStyles(segments: Segment[], upTo: number): string {
	// We track style state by replaying all SGR sequences up to the given index.
	// A full reset (\x1b[0m or \x1b[m) clears everything.
	const activeSequences: string[] = [];

	for (let i = 0; i < upTo && i < segments.length; i++) {
		const seg = segments[i]!;
		if (seg.type === "ansi") {
			const params = seg.value.slice(2, -1);
			if (params === "" || params === "0") {
				// Full reset
				activeSequences.length = 0;
			} else {
				activeSequences.push(seg.value);
			}
		}
	}

	return activeSequences.join("");
}

/**
 * Check if any styles are active (non-reset SGR sequences have been applied).
 */
function hasActiveStyles(openStyles: string): boolean {
	return openStyles.length > 0;
}

/**
 * Truncates a string to `maxWidth` visual columns, appending an ellipsis if truncated.
 * Preserves ANSI styling and properly closes any open styles at the truncation point.
 *
 * @param str - The string to truncate.
 * @param maxWidth - Maximum visual width in terminal columns.
 * @param ellipsis - Ellipsis string appended at the truncation point. Defaults to `''`.
 * @returns The truncated string, or the original if it fits within `maxWidth`.
 */
export function ansiTruncate(str: string, maxWidth: number, ellipsis = ""): string {
	const currentWidth = stringWidth(str);
	if (currentWidth <= maxWidth) return str;

	const ellipsisWidth = stringWidth(ellipsis);
	const targetWidth = maxWidth - ellipsisWidth;

	if (targetWidth <= 0) {
		// Ellipsis alone exceeds maxWidth; just return truncated ellipsis or empty
		if (ellipsisWidth <= maxWidth) return ellipsis;
		return "";
	}

	const segments = parseSegments(str);
	let width = 0;
	let result = "";
	let lastAnsiIndex = -1;

	for (let i = 0; i < segments.length; i++) {
		const seg = segments[i]!;

		if (seg.type === "ansi") {
			result += seg.value;
			lastAnsiIndex = i;
			continue;
		}

		if (width + seg.width > targetWidth) {
			// Close open styles, append ellipsis
			const openStyles = collectOpenStyles(segments, i);
			if (hasActiveStyles(openStyles)) {
				result += "\x1b[0m";
			}
			result += ellipsis;
			if (hasActiveStyles(openStyles)) {
				result += openStyles;
			}
			// Find and append any remaining closing sequences
			// Actually, we want to close styles after the ellipsis too
			if (hasActiveStyles(openStyles)) {
				result += "\x1b[0m";
			}
			return result;
		}

		result += seg.value;
		width += seg.width;
	}

	return str;
}

/**
 * Pads a string to an exact visual width using spaces.
 *
 * @param str - The string to pad.
 * @param width - Target visual width in terminal columns.
 * @param align - Alignment: `'left'` (default), `'right'`, or `'center'`.
 * @returns The padded string.
 */
export function ansiPad(
	str: string,
	width: number,
	align: "left" | "right" | "center" = "left",
): string {
	const currentWidth = stringWidth(str);
	if (currentWidth >= width) return str;

	const padding = width - currentWidth;

	switch (align) {
		case "right":
			return " ".repeat(padding) + str;
		case "center": {
			const left = Math.floor(padding / 2);
			const right = padding - left;
			return " ".repeat(left) + str + " ".repeat(right);
		}
		default:
			return str + " ".repeat(padding);
	}
}

/**
 * Slices a string by visual column positions, preserving active ANSI styles.
 *
 * Returns the substring from visual column `start` to `end` (exclusive),
 * with any active styles from before the slice re-applied at the beginning
 * and a reset appended at the end if styles were active.
 *
 * @param str - The string to slice.
 * @param start - Start visual column (inclusive).
 * @param end - End visual column (exclusive). Defaults to end of string.
 * @returns The sliced substring with ANSI styles preserved.
 */
export function ansiSlice(str: string, start: number, end?: number): string {
	const segments = parseSegments(str);
	const totalWidth = stringWidth(str);
	const effectiveEnd = end !== undefined ? Math.min(end, totalWidth) : totalWidth;

	if (start >= effectiveEnd) return "";

	let col = 0;
	let result = "";
	let inRange = false;
	let preStyles = ""; // Styles active before the start position

	for (let i = 0; i < segments.length; i++) {
		const seg = segments[i]!;

		if (seg.type === "ansi") {
			if (!inRange) {
				// Track styles before our range
				const params = seg.value.slice(2, -1);
				if (params === "" || params === "0") {
					preStyles = "";
				} else {
					preStyles += seg.value;
				}
			} else {
				// Inside range, include the ANSI sequence
				result += seg.value;
			}
			continue;
		}

		const nextCol = col + seg.width;

		if (!inRange && nextCol > start) {
			// Entering range — apply accumulated styles
			inRange = true;
			if (preStyles) {
				result += preStyles;
			}
		}

		if (inRange && col < effectiveEnd) {
			if (nextCol <= effectiveEnd) {
				result += seg.value;
			}
			// If this char would exceed end, skip it
		}

		col = nextCol;

		if (col >= effectiveEnd && inRange) {
			break;
		}
	}

	// Close any open styles
	if (preStyles || result.includes("\x1b[")) {
		// Check if there are active styles by looking for non-reset SGR sequences
		const allSegments = parseSegments(result);
		const styles: string[] = [];
		for (const s of allSegments) {
			if (s.type === "ansi") {
				const params = s.value.slice(2, -1);
				if (params === "" || params === "0") {
					styles.length = 0;
				} else {
					styles.push(s.value);
				}
			}
		}
		// Also account for preStyles
		if (preStyles) {
			// preStyles were already injected into result, so they're already counted
		}
		if (styles.length > 0) {
			result += "\x1b[0m";
		}
	}

	return result;
}

/**
 * Word-wraps a string to `maxWidth` visual columns, preserving ANSI styles across line breaks.
 *
 * @param str - The string to wrap.
 * @param maxWidth - Maximum visual width per line in terminal columns.
 * @param hard - When `true`, breaks mid-word if a single word exceeds `maxWidth`. Defaults to `false`.
 * @returns The wrapped string with `\n` inserted at break points.
 */
export function ansiWrap(str: string, maxWidth: number, hard = false): string {
	// Process line-by-line (preserve existing newlines)
	const inputLines = str.split("\n");
	const outputLines: string[] = [];

	for (const line of inputLines) {
		if (stringWidth(line) <= maxWidth) {
			outputLines.push(line);
			continue;
		}

		if (hard) {
			// Hard wrap: break at exact width
			const wrapped = hardWrapLine(line, maxWidth);
			outputLines.push(...wrapped);
		} else {
			// Soft wrap: break at word boundaries
			const wrapped = softWrapLine(line, maxWidth);
			outputLines.push(...wrapped);
		}
	}

	return outputLines.join("\n");
}

function hardWrapLine(line: string, maxWidth: number): string[] {
	const segments = parseSegments(line);
	const lines: string[] = [];
	let current = "";
	let col = 0;
	let activeStyles: string[] = [];

	for (const seg of segments) {
		if (seg.type === "ansi") {
			current += seg.value;
			const params = seg.value.slice(2, -1);
			if (params === "" || params === "0") {
				activeStyles = [];
			} else {
				activeStyles.push(seg.value);
			}
			continue;
		}

		if (col + seg.width > maxWidth && col > 0) {
			// Break here
			if (activeStyles.length > 0) {
				current += "\x1b[0m";
			}
			lines.push(current);
			current = activeStyles.join("") + seg.value;
			col = seg.width;
		} else {
			current += seg.value;
			col += seg.width;
		}
	}

	if (current) {
		lines.push(current);
	}

	return lines;
}

function softWrapLine(line: string, maxWidth: number): string[] {
	const segments = parseSegments(line);
	const lines: string[] = [];

	// Build words: a "word" is a sequence of non-space visible chars (plus their ANSI)
	type Word = { segments: Segment[]; width: number };
	const words: Word[] = [];
	let currentWord: Segment[] = [];
	let currentWordWidth = 0;
	let pendingSpaces: Segment[] = [];
	let pendingSpacesWidth = 0;

	for (const seg of segments) {
		if (seg.type === "ansi") {
			currentWord.push(seg);
			continue;
		}

		if (seg.value === " " || seg.value === "\t") {
			if (currentWordWidth > 0) {
				words.push({
					segments: [...pendingSpaces, ...currentWord],
					width: pendingSpacesWidth + currentWordWidth,
				});
				currentWord = [];
				currentWordWidth = 0;
				pendingSpaces = [];
				pendingSpacesWidth = 0;
			}
			pendingSpaces.push(seg);
			pendingSpacesWidth += seg.width;
		} else {
			currentWord.push(seg);
			currentWordWidth += seg.width;
		}
	}

	// Final word
	if (currentWordWidth > 0 || currentWord.length > 0) {
		words.push({
			segments: [...pendingSpaces, ...currentWord],
			width: pendingSpacesWidth + currentWordWidth,
		});
	}

	let currentLine = "";
	let col = 0;
	let activeStyles: string[] = [];

	for (const word of words) {
		// Calculate the visible width of just this word (excluding leading spaces if it starts a new line)
		const wordVisibleWidth = word.width;

		if (col > 0 && col + wordVisibleWidth > maxWidth) {
			// Break: close styles, start new line
			if (activeStyles.length > 0) {
				currentLine += "\x1b[0m";
			}
			lines.push(currentLine);

			// Start new line with active styles, skip leading spaces
			currentLine = activeStyles.join("");
			col = 0;

			// Add word segments, skipping leading spaces
			let skipSpaces = true;
			for (const seg of word.segments) {
				if (seg.type === "ansi") {
					currentLine += seg.value;
					const params = seg.value.slice(2, -1);
					if (params === "" || params === "0") {
						activeStyles = [];
					} else {
						activeStyles.push(seg.value);
					}
					continue;
				}
				if (skipSpaces && (seg.value === " " || seg.value === "\t")) {
					continue;
				}
				skipSpaces = false;
				currentLine += seg.value;
				col += seg.width;
			}
		} else {
			// Append word to current line
			for (const seg of word.segments) {
				if (seg.type === "ansi") {
					currentLine += seg.value;
					const params = seg.value.slice(2, -1);
					if (params === "" || params === "0") {
						activeStyles = [];
					} else {
						activeStyles.push(seg.value);
					}
				} else {
					currentLine += seg.value;
					col += seg.width;
				}
			}
		}
	}

	if (currentLine || lines.length === 0) {
		lines.push(currentLine);
	}

	return lines;
}
