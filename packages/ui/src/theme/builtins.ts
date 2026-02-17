/**
 * Built-in Themes
 *
 * Four built-in themes shipped with the design system. Each is a partial
 * token override — only values that differ from defaultTokens are specified.
 */

import type { BuiltinThemeName, Theme } from "./types.ts";

/** Minimal theme: ASCII-only symbols, no decorative borders, muted colors. */
const minimal: Theme = {
	name: "minimal",
	meta: {
		description: "Clean, ASCII-friendly theme with minimal decoration",
	},
	border: {
		style: "ascii",
	},
	symbol: {
		success: { unicode: "+", ascii: "+" },
		error: { unicode: "x", ascii: "x" },
		warning: { unicode: "!", ascii: "!" },
		info: { unicode: "-", ascii: "-" },
	},
	color: {
		info: "dim",
		heading: "bold",
	},
	components: {
		table: { variant: "borderless" },
	},
};

/** High contrast theme: no dim text, verbose status labels, maximum readability. */
const highContrast: Theme = {
	name: "highContrast",
	meta: {
		description: "High contrast theme with no dim text and verbose status labels",
	},
	type: {
		deEmphasis: { bold: false, dim: false },
		heading3: { bold: true, dim: false },
		caption: { italic: true, dim: false },
	},
	symbol: {
		success: { unicode: "[OK]", ascii: "[OK]" },
		error: { unicode: "[FAIL]", ascii: "[FAIL]" },
		warning: { unicode: "[WARN]", ascii: "[WARN]" },
		info: { unicode: "[INFO]", ascii: "[INFO]" },
	},
};

/** Monochrome theme: no color at all, relies on bold/dim/underline for hierarchy. */
const monochrome: Theme = {
	name: "monochrome",
	meta: {
		description: "Colorless theme using only text attributes for visual hierarchy",
	},
	color: {
		fg: "default",
		fgMuted: "default",
		error: "default",
		warning: "default",
		success: "default",
		info: "default",
		accent: "default",
		emphasis: "default",
		code: "default",
		heading: "default",
		bgError: "default",
		bgWarning: "default",
		bgSuccess: "default",
		bgInfo: "default",
		bgHighlight: "default",
		diffAdded: "default",
		diffRemoved: "default",
		diffContext: "default",
		diffHunk: "default",
	},
	type: {
		emphasis: { bold: true },
		deEmphasis: { dim: true },
		heading1: { bold: true, underline: true },
		link: { underline: true },
	},
	symbol: {
		success: { unicode: "[OK]", ascii: "[OK]" },
		error: { unicode: "[FAIL]", ascii: "[FAIL]" },
		warning: { unicode: "[WARN]", ascii: "[WARN]" },
		info: { unicode: "[INFO]", ascii: "[INFO]" },
	},
};

/** The default theme is empty — it adds nothing on top of defaultTokens. */
const defaultTheme: Theme = {
	name: "default",
	meta: {
		description: "The default theme with no overrides",
	},
};

/** All built-in themes indexed by name. */
export const builtinThemes: Record<BuiltinThemeName, Theme> = {
	default: defaultTheme,
	minimal,
	highContrast,
	monochrome,
};
