/**
 * Color utilities for CLI output
 */

import chalk from "chalk";

export const c = {
	success: (text: string) => chalk.green(text),
	error: (text: string) => chalk.red(text),
	warning: (text: string) => chalk.yellow(text),
	info: (text: string) => chalk.blue(text),
	muted: (text: string) => chalk.gray(text),
	highlight: (text: string) => chalk.cyan(text),
	dim: (text: string) => chalk.dim(text),
	bold: (text: string) => chalk.bold(text),
	kit: (text: string) => chalk.magenta(text),
	recipe: (text: string) => chalk.cyan.bold(text),
	helper: (text: string) => chalk.yellow(text),
	property: (text: string) => chalk.cyan(text),
	subtle: (text: string) => chalk.gray(text),
	required: (text: string) => chalk.red.bold(text),
	default: (value: any) => chalk.gray(` (default: ${JSON.stringify(value)})`),
	text: (text: string) => text,
	enum: (text: string) => chalk.yellow(text),
	cookbook: (text: string) => chalk.magenta.bold(text),
	title: (text: string) => chalk.bold.cyan(text),
	heading: (text: string) => chalk.bold.yellow(text),
	version: (text: string) => chalk.gray(text),
};
