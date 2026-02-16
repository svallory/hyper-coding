/**
 * Inline markdown processor for CLI strings.
 *
 * Transforms a subset of markdown into chalk-styled terminal output:
 * - `code` → command color (palette.brand)
 * - **bold** → chalk.bold
 * - *dim* → chalk.dim
 *
 * Opt-in only — not auto-applied to other functions.
 */

import chalk from "chalk";
import { palette } from "./palette.js";

export function md(text: string): string {
	return text
		.replace(/`([^`]+)`/g, (_, code) => chalk.hex(palette.brand)(code))
		.replace(/\*\*([^*]+)\*\*/g, (_, bold) => chalk.bold(bold))
		.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, (_, dim) => chalk.dim(dim));
}
