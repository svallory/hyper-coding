/**
 * badge Primitive
 *
 * Renders a short label with a background color badge style.
 * Falls back to [TEXT] brackets when color is unavailable.
 */

import type { StyleSpec } from "../render/index.ts";
import { applyStyle } from "../render/index.ts";
import type { ColorTokens } from "../tokens/index.ts";
import { getContext } from "./context.ts";

/** Options for rendering a badge label. */
export type BadgeOptions = {
	/** Background color token name. Defaults to `'bgInfo'`. */
	color?: keyof ColorTokens;
	/** Foreground (text) color token name. Uses the terminal default when omitted. */
	textColor?: keyof ColorTokens;
};

/**
 * Renders a short label as a colored badge.
 * Falls back to `[text]` brackets on dumb or no-color terminals.
 *
 * @param text - The label text to display.
 * @param options - Badge color configuration.
 * @returns The styled badge string.
 */
export function badge(text: string, options?: BadgeOptions): string {
	const ctx = getContext();

	// Dumb terminal: plain brackets
	if (ctx.capabilities.isDumb) {
		return `[${text}]`;
	}

	// No color support: brackets
	if (ctx.capabilities.noColor || ctx.capabilities.colorDepth === "none") {
		return `[${text}]`;
	}

	const bgTokenName = options?.color ?? "bgInfo";
	const bgColor = ctx.tokens.color[bgTokenName];

	const fgTokenName = options?.textColor;
	const fgColor = fgTokenName ? ctx.tokens.color[fgTokenName] : null;

	const spec: StyleSpec = {
		bg: bgColor,
	};

	if (fgColor) {
		spec.color = fgColor;
	}

	// Pad with single space each side
	return applyStyle(` ${text} `, spec);
}
