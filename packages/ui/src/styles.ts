/**
 * Composite style formatters — the `s` object.
 *
 * These produce multi-element styled strings (icon + text, key: value, etc.).
 * Merged from gen/lib/styles.ts + core/ui/styles.ts.
 */

import chalk from "chalk";
import { md } from "./md.js";

export const s = {
	/** Dim hint text */
	hint: (text: string) => chalk.gray(text),

	/** Status messages with icons */
	success: (text: string) => chalk.green(`\u2714 ${text}`),
	error: (text: string) => chalk.red(`\u2718 ${text}`),
	warning: (text: string) => chalk.yellow(`\u26a0 ${text}`),
	info: (text: string) => chalk.blue(`\u2139 ${text}`),

	/** Bold section heading */
	section: (text: string) => chalk.bold.cyan(text),

	/** Inline code (gray backticks) */
	code: (text: string) => chalk.gray(`\`${text}\``),

	/** Emphasized text */
	highlight: (text: string) => chalk.cyan.bold(text),

	/** "Prefix: text" title */
	title: (prefix: string, text: string) => chalk.bold.cyan(`${prefix}: ${text}`),

	/** Horizontal rule */
	hr: () => chalk.gray("\u2500".repeat(60)),

	/** "key: value" with optional indent */
	keyValue: (key: string, value: string, indent = 0) =>
		`${" ".repeat(indent)}${chalk.cyan(`${key}:`)} ${value}`,

	/** Section header with optional count */
	header: (text: string, count?: number) =>
		chalk.bold.yellow(count !== undefined ? `${text} (${count})` : text),

	/** Dim description with optional indent */
	description: (text: string, indent = 0) => " ".repeat(indent) + chalk.gray(text),

	/** Bulleted list item */
	listItem: (text: string) => chalk.white(`  \u2022 ${text}`),

	/** Indent text by N spaces */
	indent: (text: string, spaces: number) => " ".repeat(spaces) + text,

	/** Dim file path */
	path: (text: string) => chalk.gray(text),

	/** Dim version string */
	version: (text: string) => chalk.gray(text),

	/** Inline markdown → styled terminal text */
	md,
};
