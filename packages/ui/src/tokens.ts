/**
 * Semantic tokens — map UI roles to palette values.
 *
 * These tokens define *what* a color means in the CLI context,
 * not *what* color it is. Change the palette, and all tokens update.
 */

import { palette } from "./palette.js";

export const tokens = {
	// Status
	success: palette.green,
	error: palette.red,
	warning: palette.yellow,
	info: palette.blue,
	tip: palette.tipBlue,
	muted: palette.gray,

	// CLI entities
	command: palette.brand,
	danger: palette.danger,
	kit: palette.magenta,
	recipe: palette.cyan,
	cookbook: palette.magenta,

	// Text roles
	highlight: palette.cyan,
	subtle: palette.gray,
	title: palette.cyan,
	heading: palette.yellow,
	version: palette.gray,
	path: palette.gray,
} as const;
