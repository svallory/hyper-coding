/**
 * Raw color values — single source of truth for the HyperDev CLI palette.
 *
 * All hex values and terminal color names live here.
 * No chalk imports, no logic — just constants.
 */

export const palette = {
	// Brand colors (hex)
	brand: "#4EC9B0", // teal — commands, code
	danger: "#F67280", // coral — destructive actions
	tipBlue: "#7FB3D5", // pastel blue — tips

	// Terminal builtins (named for chalk compatibility)
	red: "red",
	green: "green",
	yellow: "yellow",
	blue: "blue",
	magenta: "magenta",
	cyan: "cyan",
	gray: "gray",
	white: "white",
} as const;
