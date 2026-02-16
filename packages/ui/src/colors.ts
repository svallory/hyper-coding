/**
 * Color functions — the `c` object.
 *
 * Each function wraps chalk to apply a semantic color.
 * Merged from gen/lib/colors.ts + core/ui/styles.ts.
 */

import chalk from "chalk";
import { palette } from "./palette.js";

export const c = {
	// Status colors
	success: (text: string) => chalk.green(text),
	error: (text: string) => chalk.red(text),
	warning: (text: string) => chalk.yellow(text),
	info: (text: string) => chalk.blue(text),
	muted: (text: string) => chalk.gray(text),

	// From core/ui/styles — hex-based
	command: (text: string) => chalk.hex(palette.brand)(text),
	danger: (text: string) => chalk.hex(palette.danger)(text),

	// Formatting helpers
	highlight: (text: string) => chalk.cyan(text),
	dim: (text: string) => chalk.dim(text),
	bold: (text: string) => chalk.bold(text),
	subtle: (text: string) => chalk.gray(text),
	text: (text: string) => text,

	// CLI entity colors
	kit: (text: string) => chalk.magenta(text),
	recipe: (text: string) => chalk.cyan.bold(text),
	cookbook: (text: string) => chalk.magenta.bold(text),
	helper: (text: string) => chalk.yellow(text),

	// Code/data colors
	property: (text: string) => chalk.cyan(text),
	required: (text: string) => chalk.red.bold(text),
	default: (value: any) => chalk.gray(` (default: ${JSON.stringify(value)})`),
	enum: (text: string) => chalk.yellow(text),

	// Headings & labels
	title: (text: string) => chalk.bold.cyan(text),
	heading: (text: string) => chalk.bold.yellow(text),
	version: (text: string) => chalk.gray(text),
};
