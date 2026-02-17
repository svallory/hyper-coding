/**
 * Default Token Values
 *
 * The complete built-in token set with all concrete values from the design spec.
 * These serve as the base theme. Every value can be overridden via the theme system.
 */

import type { TokenSet } from "./types.ts";

/**
 * The complete built-in design token set with all concrete values from the design spec.
 * Serves as the base theme; every value can be overridden via the theme system.
 */
export const defaultTokens: TokenSet = {
	// ---------------------------------------------------------------------------
	// Color Tokens
	// ---------------------------------------------------------------------------
	color: {
		fg: "default",
		fgMuted: "dim",
		error: { ansi16: "red", ansi256: 196, truecolor: "#f87171" },
		warning: { ansi16: "yellow", ansi256: 214, truecolor: "#fbbf24" },
		success: { ansi16: "green", ansi256: 34, truecolor: "#4ade80" },
		info: { ansi16: "cyan", ansi256: 39, truecolor: "#38bdf8" },
		accent: { ansi16: "blue", ansi256: 33, truecolor: "#60a5fa" },
		emphasis: "bold",
		code: { ansi16: "cyan", ansi256: 37, truecolor: "#67e8f9" },
		heading: "bold",
		// Background
		bgError: { ansi16: "bgRed", ansi256: 196, truecolor: "#f87171" },
		bgWarning: { ansi16: "bgYellow", ansi256: 214, truecolor: "#fbbf24" },
		bgSuccess: { ansi16: "bgGreen", ansi256: 34, truecolor: "#4ade80" },
		bgInfo: { ansi16: "bgCyan", ansi256: 39, truecolor: "#38bdf8" },
		bgHighlight: { ansi16: "bgBlue", ansi256: 33, truecolor: "#60a5fa" },
		// Diff
		diffAdded: { ansi16: "green", ansi256: 34, truecolor: "#4ade80" },
		diffRemoved: { ansi16: "red", ansi256: 196, truecolor: "#f87171" },
		diffContext: "dim",
		diffHunk: { ansi16: "cyan", ansi256: 39, truecolor: "#38bdf8" },
	},

	// ---------------------------------------------------------------------------
	// Typography Tokens
	// ---------------------------------------------------------------------------
	type: {
		emphasis: { bold: true },
		strong: { bold: true, color: "accent" },
		deEmphasis: { dim: true },
		code: { color: "code" },
		link: { underline: true, color: "accent" },
		deleted: { strikethrough: true, dim: true },
		heading1: { bold: true, underline: true },
		heading2: { bold: true },
		heading3: { bold: true, dim: true },
		label: { bold: true },
		caption: { dim: true, italic: true },
	},

	// ---------------------------------------------------------------------------
	// Spacing Tokens
	// ---------------------------------------------------------------------------
	space: {
		indent: 2,
		indentLarge: 4,
		gutter: 2,
		gutterLarge: 4,
		padding: 1,
		paddingLarge: 2,
		iconGap: 1,
		lineNone: 0,
		lineCompact: 0,
		lineNormal: 1,
		lineRelaxed: 2,
	},

	// ---------------------------------------------------------------------------
	// Layout Tokens
	// ---------------------------------------------------------------------------
	layout: {
		maxWidth: 100,
		minWidth: 40,
		defaultWidth: 80,
	},

	// ---------------------------------------------------------------------------
	// Symbol Tokens
	// ---------------------------------------------------------------------------
	symbol: {
		// Status
		success: { unicode: "\u2713", ascii: "[OK]" },
		error: { unicode: "\u2717", ascii: "[FAIL]" },
		warning: { unicode: "\u26A0", ascii: "[WARN]" },
		info: { unicode: "\u2139", ascii: "[INFO]" },
		pending: { unicode: "\u25CC", ascii: "[ ]" },
		running: { unicode: "\u25C9", ascii: "[..]" },
		skipped: { unicode: "\u25CB", ascii: "[SKIP]" },
		tip: { unicode: "\u25C6", ascii: "[TIP]" },
		bar: { unicode: "\u2502", ascii: "|" },
		// Navigation
		arrowRight: { unicode: "\u2192", ascii: "->" },
		arrowLeft: { unicode: "\u2190", ascii: "<-" },
		arrowUp: { unicode: "\u2191", ascii: "^" },
		arrowDown: { unicode: "\u2193", ascii: "v" },
		pointer: { unicode: "\u25B8", ascii: ">" },
		pointerSmall: { unicode: "\u203A", ascii: ">" },
		// Structural
		bullet: { unicode: "\u2022", ascii: "*" },
		dash: { unicode: "\u2500", ascii: "-" },
		ellipsis: { unicode: "\u2026", ascii: "..." },
		middot: { unicode: "\u00B7", ascii: "." },
		// Interactive
		radioOn: { unicode: "\u25C9", ascii: "(*)" },
		radioOff: { unicode: "\u25CB", ascii: "( )" },
		checkboxOn: { unicode: "\u25FC", ascii: "[x]" },
		checkboxOff: { unicode: "\u25FB", ascii: "[ ]" },
		cursor: { unicode: "\u25B8", ascii: ">" },
	},

	// ---------------------------------------------------------------------------
	// Border Tokens
	// ---------------------------------------------------------------------------
	border: {
		style: "rounded",
		styles: {
			rounded: {
				topLeft: "\u256D",
				topRight: "\u256E",
				bottomLeft: "\u2570",
				bottomRight: "\u256F",
				horizontal: "\u2500",
				vertical: "\u2502",
				teeRight: "\u251C",
				teeLeft: "\u2524",
				teeDown: "\u252C",
				teeUp: "\u2534",
				cross: "\u253C",
			},
			single: {
				topLeft: "\u250C",
				topRight: "\u2510",
				bottomLeft: "\u2514",
				bottomRight: "\u2518",
				horizontal: "\u2500",
				vertical: "\u2502",
				teeRight: "\u251C",
				teeLeft: "\u2524",
				teeDown: "\u252C",
				teeUp: "\u2534",
				cross: "\u253C",
			},
			double: {
				topLeft: "\u2554",
				topRight: "\u2557",
				bottomLeft: "\u255A",
				bottomRight: "\u255D",
				horizontal: "\u2550",
				vertical: "\u2551",
				teeRight: "\u2560",
				teeLeft: "\u2563",
				teeDown: "\u2566",
				teeUp: "\u2569",
				cross: "\u256C",
			},
			heavy: {
				topLeft: "\u250F",
				topRight: "\u2513",
				bottomLeft: "\u2517",
				bottomRight: "\u251B",
				horizontal: "\u2501",
				vertical: "\u2503",
				teeRight: "\u2523",
				teeLeft: "\u252B",
				teeDown: "\u2533",
				teeUp: "\u253B",
				cross: "\u254B",
			},
			dashed: {
				topLeft: "\u250C",
				topRight: "\u2510",
				bottomLeft: "\u2514",
				bottomRight: "\u2518",
				horizontal: "\u254C",
				vertical: "\u254E",
				teeRight: "\u251C",
				teeLeft: "\u2524",
				teeDown: "\u252C",
				teeUp: "\u2534",
				cross: "\u253C",
			},
			ascii: {
				topLeft: "+",
				topRight: "+",
				bottomLeft: "+",
				bottomRight: "+",
				horizontal: "-",
				vertical: "|",
				teeRight: "+",
				teeLeft: "+",
				teeDown: "+",
				teeUp: "+",
				cross: "+",
			},
		},
	},

	// ---------------------------------------------------------------------------
	// Tree Tokens
	// ---------------------------------------------------------------------------
	tree: {
		unicode: {
			branch: "\u251C\u2500\u2500",
			last: "\u2514\u2500\u2500",
			vertical: "\u2502  ",
			indent: "   ",
		},
		ascii: {
			branch: "|--",
			last: "\\--",
			vertical: "|  ",
			indent: "   ",
		},
	},

	// ---------------------------------------------------------------------------
	// Motion Tokens
	// ---------------------------------------------------------------------------
	motion: {
		spinnerDots: {
			unicode: [
				"\u280B",
				"\u2819",
				"\u2839",
				"\u2838",
				"\u283C",
				"\u2834",
				"\u2826",
				"\u2827",
				"\u2807",
				"\u280F",
			],
			ascii: ["-", "\\", "|", "/"],
		},
		spinnerLine: {
			unicode: ["\u2500", "\\", "\u2502", "/"],
			ascii: ["-", "\\", "|", "/"],
		},
		spinnerArc: {
			unicode: ["\u25DC", "\u25E0", "\u25DD", "\u25DE", "\u25E1", "\u25DF"],
			ascii: ["-", "\\", "|", "/"],
		},
		progressFilled: { unicode: "\u2588", ascii: "#" },
		progressPartial: { unicode: "\u2591", ascii: "-" },
		progressHead: { unicode: "\u258C", ascii: ">" },
		spinnerInterval: 80,
		progressInterval: 100,
	},
};
