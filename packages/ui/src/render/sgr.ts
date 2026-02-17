/**
 * SGR (Select Graphic Rendition) Code Generation
 *
 * Maps style specifications to ANSI escape sequences for terminal styling.
 * Supports 16-color names, 256-color indices, and truecolor hex values.
 */

/**
 * Specification of terminal text styling attributes.
 *
 * Colors accept ANSI 16 names (`"red"`, `"cyan"`), 256-color indices
 * as numeric strings (`"196"`), or truecolor hex (`"#ff0000"`, `"#f00"`).
 */
export type StyleSpec = {
	/** Foreground color. Accepts a named color, 256-color index string, or `#hex`. */
	color?: string | null;
	/** Background color. Accepts a named color, 256-color index string, or `#hex`. */
	bg?: string | null;
	/** Bold / increased intensity. */
	bold?: boolean;
	/** Dim / decreased intensity. */
	dim?: boolean;
	/** Italic text (terminal support varies). */
	italic?: boolean;
	/** Underlined text. */
	underline?: boolean;
	/** Strikethrough text (terminal support varies). */
	strikethrough?: boolean;
	/** Swap foreground and background colors. */
	inverse?: boolean;
};

// ANSI 16 foreground color codes
const ANSI_FG: Record<string, number> = {
	black: 30,
	red: 31,
	green: 32,
	yellow: 33,
	blue: 34,
	magenta: 35,
	cyan: 36,
	white: 37,
};

// ANSI 16 background color codes
const ANSI_BG: Record<string, number> = {
	black: 40,
	red: 41,
	green: 42,
	yellow: 43,
	blue: 44,
	magenta: 45,
	cyan: 46,
	white: 47,
};

// SGR attribute enable codes
const SGR_ATTR: Record<string, number> = {
	bold: 1,
	dim: 2,
	italic: 3,
	underline: 4,
	inverse: 7,
	strikethrough: 9,
};

// SGR attribute reset codes
const SGR_RESET: Record<string, number> = {
	bold: 22,
	dim: 22,
	italic: 23,
	underline: 24,
	inverse: 27,
	strikethrough: 29,
	fg: 39,
	bg: 49,
};

const ATTR_NAMES = ["bold", "dim", "italic", "underline", "strikethrough", "inverse"] as const;

/**
 * Parse a hex color string (`#RGB` or `#RRGGBB`) into an RGB tuple.
 *
 * @param hex - Hex color string starting with `#`.
 * @returns RGB tuple of numeric values `[R, G, B]`.
 */
function parseHex(hex: string): [number, number, number] {
	const h = hex.slice(1);
	if (h.length === 3) {
		const r = Number.parseInt(h[0]! + h[0]!, 16);
		const g = Number.parseInt(h[1]! + h[1]!, 16);
		const b = Number.parseInt(h[2]! + h[2]!, 16);
		return [r, g, b];
	}
	const r = Number.parseInt(h.slice(0, 2), 16);
	const g = Number.parseInt(h.slice(2, 4), 16);
	const b = Number.parseInt(h.slice(4, 6), 16);
	return [r, g, b];
}

/**
 * Generate SGR parameter strings for a color value.
 *
 * Handles named ANSI-16 colors, 256-color numeric indices, truecolor hex,
 * and the special `"bold"`/`"dim"` attribute-as-color values.
 *
 * @param value - The color value string (name, numeric index, or `#hex`).
 * @param isBg  - Whether the color is for the background (uses code 48) rather than foreground (38).
 * @returns Array of SGR parameter strings (may be compound, e.g. `"38;2;255;0;0"`). Empty if unrecognized.
 */
function colorCodes(value: string, isBg: boolean): string[] {
	// 'bold' and 'dim' are attributes, not colors
	if (value === "bold" || value === "dim") {
		return [String(SGR_ATTR[value]!)];
	}

	if (value.startsWith("#")) {
		const [r, g, b] = parseHex(value);
		const prefix = isBg ? 48 : 38;
		return [`${prefix};2;${r};${g};${b}`];
	}

	// Numeric string → 256-color
	if (/^\d+$/.test(value)) {
		const prefix = isBg ? 48 : 38;
		return [`${prefix};5;${value}`];
	}

	// Named ANSI 16 color
	const table = isBg ? ANSI_BG : ANSI_FG;
	const code = table[value];
	if (code !== undefined) {
		return [String(code)];
	}

	return [];
}

/**
 * Generate the opening SGR escape sequence for a style spec.
 *
 * Combines all attribute and color codes into a single sequence (e.g. `\x1b[1;31;4m`).
 *
 * @param style - The style specification to encode.
 * @returns The opening ANSI escape sequence, or an empty string if no styles are set.
 */
export function sgrOpen(style: StyleSpec): string {
	const codes: string[] = [];

	// Attributes
	for (const attr of ATTR_NAMES) {
		if (style[attr]) {
			codes.push(String(SGR_ATTR[attr]!));
		}
	}

	// Foreground color
	if (style.color != null && style.color !== "") {
		codes.push(...colorCodes(style.color, false));
	}

	// Background color
	if (style.bg != null && style.bg !== "") {
		codes.push(...colorCodes(style.bg, true));
	}

	if (codes.length === 0) return "";
	return `\x1b[${codes.join(";")}m`;
}

/**
 * Generate the closing SGR escape sequence that resets only the attributes
 * set in the given style spec.
 *
 * Uses targeted reset codes (e.g. `22` for bold/dim, `39` for fg) rather
 * than a full `\x1b[0m` reset, so surrounding styles are not disturbed.
 *
 * @param style - The style specification whose attributes should be reset.
 * @returns The closing ANSI escape sequence, or an empty string if no styles were set.
 */
export function sgrClose(style: StyleSpec): string {
	const codes: number[] = [];

	for (const attr of ATTR_NAMES) {
		if (style[attr]) {
			const resetCode = SGR_RESET[attr]!;
			// Avoid duplicates (bold and dim share reset code 22)
			if (!codes.includes(resetCode)) {
				codes.push(resetCode);
			}
		}
	}

	// If color was set via 'bold'/'dim' as a color value, reset that attribute
	if (style.color != null && style.color !== "") {
		if (style.color === "bold" || style.color === "dim") {
			const resetCode = SGR_RESET[style.color]!;
			if (!codes.includes(resetCode)) {
				codes.push(resetCode);
			}
		} else {
			codes.push(SGR_RESET.fg!);
		}
	}

	if (style.bg != null && style.bg !== "") {
		if (style.bg === "bold" || style.bg === "dim") {
			const resetCode = SGR_RESET[style.bg]!;
			if (!codes.includes(resetCode)) {
				codes.push(resetCode);
			}
		} else {
			codes.push(SGR_RESET.bg!);
		}
	}

	if (codes.length === 0) return "";
	return `\x1b[${codes.join(";")}m`;
}

/**
 * Apply a style to text by wrapping it with the appropriate opening
 * and closing SGR escape sequences.
 *
 * @param text  - The text to style.
 * @param style - The style specification to apply.
 * @returns The text wrapped in ANSI escape sequences.
 */
export function applyStyle(text: string, style: StyleSpec): string {
	const open = sgrOpen(style);
	const close = sgrClose(style);
	return `${open}${text}${close}`;
}
