/**
 * cli-html help theme for `hyper --help` output.
 *
 * Moved from cli/src/help/theme.ts.
 * Uses palette.brand for code color to stay in sync with the design system.
 */

import { palette } from "./palette.js";
import type { HelpThemeConfig } from "./types.js";

export const helpTheme: HelpThemeConfig = {
	lineWidth: {
		max: 100,
	},
	theme: {
		h1: {
			color: "blue bold",
			indicator: {
				marker: "\u25b6\ufe0e",
				color: "blue bold",
			},
		},
		h2: {
			color: "yellow bold",
			indicator: {
				marker: "\u25b8",
				color: "yellow bold",
			},
		},
		h3: {
			color: "white bold",
			indicator: {
				marker: "\u25b9",
				color: "white bold",
			},
		},
		code: {
			color: `hex-${palette.brand.slice(1)}`,
			block: {
				color: "gray",
				numbers: {
					enabled: false,
				},
			},
		},
		table: {
			header: {
				color: "white bold",
			},
		},
		a: {
			color: "cyan underline",
		},
	},
};
