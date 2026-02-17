/**
 * Hyper Theme — HyperDev CLI brand theme
 *
 * Encodes all of HyperDev's visual opinions as a DS theme object.
 */

import type { Theme } from "./theme/index.ts";

export const hyperTheme: Theme = {
	name: "hyper",
	meta: { description: "HyperDev CLI brand theme" },
	color: {
		// Map Hyper's palette to DS token roles
		code: { ansi16: "cyan", ansi256: 37, truecolor: "#4EC9B0" },
		error: { ansi16: "red", ansi256: 196, truecolor: "#f87171" },
		warning: { ansi16: "yellow", ansi256: 214, truecolor: "#fbbf24" },
		success: { ansi16: "green", ansi256: 34, truecolor: "#4ade80" },
		info: { ansi16: "blue", ansi256: 33, truecolor: "#60a5fa" },
		accent: { ansi16: "blue", ansi256: 33, truecolor: "#60a5fa" },
	},
	symbol: {
		// Match current UI symbols exactly
		error: { unicode: "\u00d7", ascii: "[FAIL]" },
		warning: { unicode: "\u25b2", ascii: "[WARN]" },
		success: { unicode: "\u2714", ascii: "[OK]" },
		info: { unicode: "\u25cf", ascii: "[INFO]" },
		tip: { unicode: "\u25c6", ascii: "[TIP]" },
	},
	space: {
		iconGap: 2,
	},
};
