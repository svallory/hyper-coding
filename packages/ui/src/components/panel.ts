/**
 * panel Component
 *
 * Thin wrapper around the border primitive that adds vertical padding support.
 */

import { border } from "../primitives/index.ts";
import type { BorderStyleName } from "../tokens/index.ts";

/** Options for rendering a panel box. */
export type PanelOptions = {
	/** Title displayed in the top border. */
	title?: string;
	/** Title alignment within the top border. Defaults to `'left'`. */
	titleAlign?: "left" | "center" | "right";
	/** Border character style. Defaults to the theme's default. */
	borderStyle?: BorderStyleName;
	/** Vertical padding (blank lines) inside the box. Defaults to `0`. */
	padding?: number;
	/** Total box width, or `'auto'` to fit content. */
	width?: number | "auto";
};

/**
 * Renders content inside a bordered panel box with optional vertical padding.
 *
 * @param content - A string or array of lines to enclose.
 * @param options - Panel configuration.
 * @returns The bordered panel as a multi-line string.
 */
export function panel(content: string | string[], options?: PanelOptions): string {
	const padding = options?.padding ?? 0;
	let lines = Array.isArray(content) ? [...content] : content.split("\n");

	// Add vertical padding (blank lines) inside the box
	if (padding > 0) {
		const blankLines = Array.from({ length: padding }, () => "");
		lines = [...blankLines, ...lines, ...blankLines];
	}

	return border(lines, {
		style: options?.borderStyle,
		title: options?.title,
		titleAlign: options?.titleAlign,
		padding: options?.padding ?? 1,
		width: options?.width,
	});
}
