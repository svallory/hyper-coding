import type { HelpThemeConfig } from "@hypercli/core";

/**
 * Custom cli-html theme for hyper CLI help output.
 * Provides a clean, readable terminal rendering of markdoÍwn help files.
 */
export const helpTheme: HelpThemeConfig = {
	lineWidth: {
		max: 100,
	},
	theme: {
		h1: {
			color: "blue bold",
			indicator: {
				marker: "▶︎",
				color: "blue bold",
			},
		},
		h2: {
			color: "yellow bold",
			indicator: {
				marker: "▸",
				color: "yellow bold",
			},
		},
		h3: {
			color: "white bold",
			indicator: {
				marker: "▹",
				color: "white bold",
			},
		},
		code: {
			color: "hex-4EC9B0",
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
