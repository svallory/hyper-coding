/**
 * align Primitive
 *
 * Aligns text within a given width using left, right, or center alignment.
 * Supports a custom fill character.
 */

import { ansiPad, stringWidth } from "../render/index.ts";

/** Options for aligning text within a fixed width. */
export type AlignOptions = {
	/** Horizontal alignment direction. Defaults to `'left'`. */
	alignment?: "left" | "right" | "center";
	/** Character used to fill remaining space. Defaults to `' '`. */
	fill?: string;
};

/**
 * Aligns text within a fixed column width, padding with a fill character.
 *
 * @param text - The text to align.
 * @param width - The total column width to align within.
 * @param options - Alignment configuration.
 * @returns The aligned text string padded to the specified width.
 */
export function align(text: string, width: number, options?: AlignOptions): string {
	const alignment = options?.alignment ?? "left";
	const fill = options?.fill;

	// Default space fill: delegate to ansiPad
	if (!fill || fill === " ") {
		return ansiPad(text, width, alignment);
	}

	// Custom fill character: implement manually
	const currentWidth = stringWidth(text);
	if (currentWidth >= width) return text;

	const padding = width - currentWidth;

	switch (alignment) {
		case "right":
			return fill.repeat(padding) + text;
		case "center": {
			const left = Math.floor(padding / 2);
			const right = padding - left;
			return fill.repeat(left) + text + fill.repeat(right);
		}
		default:
			return text + fill.repeat(padding);
	}
}
