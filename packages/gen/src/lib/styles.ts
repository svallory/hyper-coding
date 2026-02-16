/**
 * Style utilities for CLI output
 */

import chalk from "chalk";

export const s = {
	hint: (text: string) => chalk.gray(text),
	success: (text: string) => chalk.green(`✔ ${text}`),
	error: (text: string) => chalk.red(`✘ ${text}`),
	warning: (text: string) => chalk.yellow(`⚠ ${text}`),
	info: (text: string) => chalk.blue(`ℹ ${text}`),
	section: (text: string) => chalk.bold.cyan(text),
	code: (text: string) => chalk.gray(`\`${text}\``),
	highlight: (text: string) => chalk.cyan.bold(text),
	title: (prefix: string, text: string) => chalk.bold.cyan(`${prefix}: ${text}`),
	hr: () => chalk.gray("─".repeat(60)),
	keyValue: (key: string, value: string, indent = 0) =>
		`${" ".repeat(indent) + chalk.cyan(`${key}:`)} ${value}`,
	header: (text: string, count?: number) =>
		chalk.bold.yellow(count !== undefined ? `${text} (${count})` : text),
	description: (text: string, indent = 0) => " ".repeat(indent) + chalk.gray(text),
	listItem: (text: string) => chalk.white(`  • ${text}`),
	indent: (text: string, spaces: number) => " ".repeat(spaces) + text,
	path: (text: string) => chalk.gray(text),
	version: (text: string) => chalk.gray(text),
};
