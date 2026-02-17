/**
 * ANSI Escape Sequence Stripping
 *
 * Functions to remove ANSI escape sequences from strings, either fully
 * (for plain text output) or selectively (preserving typography for NO_COLOR mode).
 */

/** Matches SGR (Select Graphic Rendition) escape sequences only. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape detection requires control characters
const ANSI_REGEX = /\x1b\[[0-9;]*m/g;

/** Matches all ANSI escape sequences (SGR, cursor movement, etc.). */
// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape detection requires control characters
const ALL_ANSI_REGEX = /\x1b\[[0-9;]*[A-Za-z]/g;

/**
 * Strips ALL ANSI escape sequences from a string, returning plain text.
 *
 * @param str - The string to strip.
 * @returns The plain text with no ANSI codes.
 */
export function stripAnsi(str: string): string {
	return str.replace(ALL_ANSI_REGEX, "");
}

/**
 * Returns true if the SGR code number is a color-related code.
 * Color codes: 30-37, 38, 39, 40-47, 48, 49, 90-97, 100-107
 */
function isColorCode(code: number): boolean {
	return (code >= 30 && code <= 49) || (code >= 90 && code <= 97) || (code >= 100 && code <= 107);
}

/**
 * Strips only color codes from ANSI escape sequences, preserving typography
 * attributes (bold, dim, italic, underline, strikethrough, inverse and their resets).
 *
 * Implements NO_COLOR mode: text styling is preserved but all hue information is removed.
 *
 * @param str - The string to strip color codes from.
 * @returns The string with color codes removed but typography preserved.
 */
export function stripColor(str: string): string {
	return str.replace(ANSI_REGEX, (match) => {
		// Extract the parameter portion between \x1b[ and m
		const params = match.slice(2, -1);

		if (params === "" || params === "0") {
			// Full reset — keep it as-is since it resets attributes too
			return match;
		}

		const parts = params.split(";");
		const kept: string[] = [];

		for (let i = 0; i < parts.length; i++) {
			const code = Number.parseInt(parts[i]!, 10);

			if (Number.isNaN(code)) {
				kept.push(parts[i]!);
				continue;
			}

			// Extended color sequences: 38;5;N or 38;2;R;G;B (and 48 for bg)
			if (code === 38 || code === 48) {
				const next = parts[i + 1];
				if (next === "5") {
					// 256-color: skip code;5;N (3 parts)
					i += 2;
					continue;
				}
				if (next === "2") {
					// Truecolor: skip code;2;R;G;B (5 parts)
					i += 4;
					continue;
				}
				// Just 38/48 alone — still a color code, skip it
				continue;
			}

			if (isColorCode(code)) {
				continue;
			}

			// Non-color code — keep it
			kept.push(String(code));
		}

		if (kept.length === 0) return "";
		return `\x1b[${kept.join(";")}m`;
	});
}
