/**
 * border Primitive
 *
 * Draws a box around content using resolved border character sets.
 * Supports titles, configurable padding, and explicit or auto width.
 */

import { ansiPad, stringWidth } from "../render/index.ts";
import type { BorderStyleName } from "../tokens/index.ts";
import { getContext } from "./context.ts";

/** Options for rendering a border box around content. */
export type BorderOptions = {
	/** Border character style name. Falls back to `'ascii'` when unicode is unavailable. */
	style?: BorderStyleName;
	/** Title text displayed in the top border. */
	title?: string;
	/** Alignment of the title within the top border. Defaults to `'left'`. */
	titleAlign?: "left" | "center" | "right";
	/** Number of horizontal padding characters inside the border on each side. Defaults to `1`. */
	padding?: number;
	/** Total box width including borders, or `'auto'` to fit content. Defaults to `'auto'`. */
	width?: number | "auto";
};

/**
 * Draws a box border around content lines.
 *
 * @param content - A string (split on newlines) or array of lines to enclose.
 * @param options - Border configuration.
 * @returns The bordered content as a multi-line string.
 */
export function border(content: string | string[], options?: BorderOptions): string {
	const ctx = getContext();
	const paddingSize = options?.padding ?? 1;
	const titleAlign = options?.titleAlign ?? "left";

	// Resolve border character set
	let chars = ctx.tokens.border.chars;
	if (options?.style) {
		// If not unicode capable, force ascii
		const effectiveStyle: BorderStyleName = ctx.capabilities.unicode ? options.style : "ascii";
		chars = ctx.tokens.border.styles[effectiveStyle];
	} else if (!ctx.capabilities.unicode) {
		chars = ctx.tokens.border.styles.ascii;
	}

	const lines = Array.isArray(content) ? content : content.split("\n");
	const paddingStr = " ".repeat(paddingSize);

	// Calculate inner width (content area between vertical bars, including padding)
	let innerWidth: number;
	if (options?.width && options.width !== "auto") {
		// Explicit width is the total box width including borders
		// innerWidth = totalWidth - 2 (for vertical bars)
		innerWidth = options.width - 2;
	} else {
		// Auto: find the widest line
		let maxLineWidth = 0;
		for (const line of lines) {
			const w = stringWidth(line);
			if (w > maxLineWidth) maxLineWidth = w;
		}
		innerWidth = maxLineWidth + paddingSize * 2;
	}

	// Content width is innerWidth minus padding on both sides
	const contentWidth = innerWidth - paddingSize * 2;

	// Build top border
	let topLine: string;
	if (options?.title) {
		const title = ` ${options.title} `;
		const titleWidth = stringWidth(title);
		const available = innerWidth - titleWidth;

		if (available <= 0) {
			topLine = chars.topLeft + title.slice(0, innerWidth) + chars.topRight;
		} else if (titleAlign === "left") {
			topLine =
				chars.topLeft +
				chars.horizontal +
				title +
				chars.horizontal.repeat(available - 1) +
				chars.topRight;
		} else if (titleAlign === "right") {
			topLine =
				chars.topLeft +
				chars.horizontal.repeat(available - 1) +
				title +
				chars.horizontal +
				chars.topRight;
		} else {
			// center
			const left = Math.floor(available / 2);
			const right = available - left;
			topLine =
				chars.topLeft +
				chars.horizontal.repeat(left) +
				title +
				chars.horizontal.repeat(right) +
				chars.topRight;
		}
	} else {
		topLine = chars.topLeft + chars.horizontal.repeat(innerWidth) + chars.topRight;
	}

	// Build bottom border
	const bottomLine = chars.bottomLeft + chars.horizontal.repeat(innerWidth) + chars.bottomRight;

	// Build content lines
	const contentLines = lines.map((line) => {
		const padded = ansiPad(line, contentWidth);
		return chars.vertical + paddingStr + padded + paddingStr + chars.vertical;
	});

	return [topLine, ...contentLines, bottomLine].join("\n");
}
