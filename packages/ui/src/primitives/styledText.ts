/**
 * styledText Primitive
 *
 * Applies semantic color tokens and typography attributes to text,
 * respecting terminal capabilities (isDumb, noColor).
 */

import type { StyleSpec } from "../render/index.ts";
import { applyStyle } from "../render/index.ts";
import type { ColorTokens } from "../tokens/index.ts";
import { getContext } from "./context.ts";

/** Options for styling text with semantic color tokens and typography attributes. */
export type StyledTextOptions = {
	/** Foreground color token name. */
	color?: keyof ColorTokens;
	/** Background color token name. */
	bg?: keyof ColorTokens;
	/** Render text in bold weight. */
	bold?: boolean;
	/** Render text with reduced intensity. */
	dim?: boolean;
	/** Render text in italic style. */
	italic?: boolean;
	/** Render text with an underline. */
	underline?: boolean;
	/** Render text with a strikethrough line. */
	strikethrough?: boolean;
	/** Swap foreground and background colors. */
	inverse?: boolean;
};

/**
 * Applies semantic styling to text, respecting terminal capabilities.
 * Dumb terminals receive no styling; noColor terminals keep typography but strip color.
 *
 * @param text - The text content to style.
 * @param style - Styling options including color tokens and typography attributes.
 * @returns The styled text string with ANSI escape codes applied.
 */
export function styledText(text: string, style: StyledTextOptions): string {
	const ctx = getContext();

	// Dumb terminals get no styling at all
	if (ctx.capabilities.isDumb) {
		return text;
	}

	const spec: StyleSpec = {
		bold: style.bold,
		dim: style.dim,
		italic: style.italic,
		underline: style.underline,
		strikethrough: style.strikethrough,
		inverse: style.inverse,
	};

	// noColor: keep typography attributes but strip color
	if (!ctx.capabilities.noColor) {
		if (style.color) {
			spec.color = ctx.tokens.color[style.color];
		}
		if (style.bg) {
			spec.bg = ctx.tokens.color[style.bg];
		}
	}

	return applyStyle(text, spec);
}
