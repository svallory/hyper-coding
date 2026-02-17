/**
 * String Visual Width Calculation
 *
 * Computes the visual display width of strings in terminal columns,
 * accounting for ANSI escape sequences, East Asian wide characters,
 * emoji, zero-width characters, and control characters.
 */

/**
 * Determines the visual column width of a single Unicode code point.
 *
 * - `0` for control characters, combining marks, zero-width joiners, variation selectors
 * - `2` for CJK ideographs, fullwidth forms, hangul syllables, emoji
 * - `1` for everything else
 *
 * @param codePoint - The Unicode code point to measure.
 * @returns The visual width in terminal columns (0, 1, or 2).
 */
export function charWidth(codePoint: number): number {
	// Control characters (C0 and DEL)
	if (codePoint < 32 || codePoint === 0x7f) return 0;

	// Combining Diacritical Marks
	if (codePoint >= 0x0300 && codePoint <= 0x036f) return 0;

	// Zero-width characters
	if (
		codePoint === 0x200b || // Zero Width Space
		codePoint === 0x200c || // Zero Width Non-Joiner
		codePoint === 0x200d || // Zero Width Joiner
		codePoint === 0x2060 || // Word Joiner
		codePoint === 0xfeff // BOM / Zero Width No-Break Space
	) {
		return 0;
	}

	// Variation Selectors
	if (codePoint >= 0xfe00 && codePoint <= 0xfe0f) return 0;

	// Supplementary variation selectors
	if (codePoint >= 0xe0100 && codePoint <= 0xe01ef) return 0;

	// Combining marks in other blocks
	if (
		(codePoint >= 0x0483 && codePoint <= 0x0489) || // Cyrillic combining
		(codePoint >= 0x0591 && codePoint <= 0x05bd) || // Hebrew combining
		(codePoint >= 0x0610 && codePoint <= 0x061a) || // Arabic combining
		(codePoint >= 0x064b && codePoint <= 0x065f) || // Arabic combining
		(codePoint >= 0x0670 && codePoint <= 0x0670) || // Arabic combining
		(codePoint >= 0x06d6 && codePoint <= 0x06dc) || // Arabic combining
		(codePoint >= 0x0730 && codePoint <= 0x074a) || // Syriac combining
		(codePoint >= 0x0900 && codePoint <= 0x0903) || // Devanagari combining
		(codePoint >= 0x093a && codePoint <= 0x094f) || // Devanagari combining
		(codePoint >= 0x0e31 && codePoint <= 0x0e3a) || // Thai combining
		(codePoint >= 0x0e47 && codePoint <= 0x0e4e) || // Thai combining
		(codePoint >= 0x20d0 && codePoint <= 0x20ff) || // Combining Diacriticals for Symbols
		(codePoint >= 0xfe20 && codePoint <= 0xfe2f) // Combining Half Marks
	) {
		return 0;
	}

	// Soft Hyphen
	if (codePoint === 0x00ad) return 0; // width 0 in most terminals

	// CJK Symbols and Punctuation (U+3000-U+303F)
	if (codePoint >= 0x3000 && codePoint <= 0x303f) return 2;

	// Hiragana (U+3040-U+309F)
	if (codePoint >= 0x3040 && codePoint <= 0x309f) return 2;

	// Katakana (U+30A0-U+30FF)
	if (codePoint >= 0x30a0 && codePoint <= 0x30ff) return 2;

	// CJK Unified Ideographs Extension A (U+3400-U+4DBF)
	if (codePoint >= 0x3400 && codePoint <= 0x4dbf) return 2;

	// CJK Unified Ideographs (U+4E00-U+9FFF)
	if (codePoint >= 0x4e00 && codePoint <= 0x9fff) return 2;

	// Hangul Syllables (U+AC00-U+D7AF)
	if (codePoint >= 0xac00 && codePoint <= 0xd7af) return 2;

	// CJK Compatibility Ideographs (U+F900-U+FAFF)
	if (codePoint >= 0xf900 && codePoint <= 0xfaff) return 2;

	// Fullwidth Forms (U+FF01-U+FF60, U+FFE0-U+FFE6)
	if (codePoint >= 0xff01 && codePoint <= 0xff60) return 2;
	if (codePoint >= 0xffe0 && codePoint <= 0xffe6) return 2;

	// Halfwidth Katakana and other halfwidth forms (U+FF61-U+FFDC) — width 1
	// (default case handles this)

	// Supplementary CJK (U+20000-U+2FA1F)
	if (codePoint >= 0x20000 && codePoint <= 0x2fa1f) return 2;

	// Emoji block (U+1F000-U+1FFFF) — Mahjong, Playing Cards, Emoticons, etc.
	if (codePoint >= 0x1f000 && codePoint <= 0x1ffff) return 2;

	// Miscellaneous Symbols and Pictographs, Dingbats, Emoticons
	if (codePoint >= 0x2600 && codePoint <= 0x26ff) return 1; // Most are width 1 in terminals
	if (codePoint >= 0x2700 && codePoint <= 0x27bf) return 1;

	// Regional indicator symbols (U+1F1E0-U+1F1FF) — flags
	if (codePoint >= 0x1f1e0 && codePoint <= 0x1f1ff) return 2;

	// Default: standard width
	return 1;
}

/** Regex to match ANSI escape sequences for skipping in width calculation. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape detection requires control characters
const ANSI_REGEX = /\x1b\[[0-9;]*[A-Za-z]/;

/**
 * Calculates the total visual width of a string in terminal columns.
 *
 * Skips ANSI escape sequences (zero width), handles surrogate pairs
 * for supplementary plane characters, and uses {@link charWidth} for each
 * visible code point.
 *
 * @param str - The string to measure.
 * @returns The total visual width in terminal columns.
 */
export function stringWidth(str: string): number {
	let width = 0;
	let i = 0;

	while (i < str.length) {
		// Skip ANSI escape sequences
		if (str.charCodeAt(i) === 0x1b && str[i + 1] === "[") {
			// Find the end of the sequence
			let j = i + 2;
			while (j < str.length) {
				const ch = str.charCodeAt(j);
				if ((ch >= 0x41 && ch <= 0x5a) || (ch >= 0x61 && ch <= 0x7a)) {
					// Found the terminating letter
					i = j + 1;
					break;
				}
				j++;
			}
			if (j >= str.length) {
				// Unterminated escape sequence, skip rest
				break;
			}
			continue;
		}

		// Get code point (handle surrogate pairs)
		const code = str.codePointAt(i)!;
		width += charWidth(code);

		// Advance past this character (2 code units for supplementary plane)
		i += code > 0xffff ? 2 : 1;
	}

	return width;
}
