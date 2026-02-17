/**
 * divider Primitive
 *
 * Renders a horizontal divider line with optional title. Supports
 * multiple styles and gracefully degrades to ASCII.
 */

import { stringWidth } from "../render/index.ts";
import { getContext } from "./context.ts";

/** Options for rendering a horizontal divider. */
export type DividerOptions = {
	/** Total width of the divider in columns. Defaults to terminal width or `layout.defaultWidth`. */
	width?: number;
	/** Visual style of the divider line. Defaults to `'line'`. */
	style?: "line" | "dashed" | "heavy" | "blank";
	/** Title text displayed inline within the divider. */
	title?: string;
	/** Alignment of the title within the divider. Defaults to `'left'`. */
	titleAlign?: "left" | "center" | "right";
};

/** Unicode divider characters keyed by style name. */
const UNICODE_CHARS: Record<string, string> = {
	line: "\u2500", // ─
	dashed: "\u254C", // ╌
	heavy: "\u2501", // ━
};

/** ASCII fallback divider characters keyed by style name. */
const ASCII_CHARS: Record<string, string> = {
	line: "-",
	dashed: "-",
	heavy: "=",
};

/**
 * Renders a horizontal divider line, optionally with an inline title.
 *
 * @param options - Divider configuration.
 * @returns The divider string, or an empty string for the `'blank'` style.
 */
export function divider(options?: DividerOptions): string {
	const ctx = getContext();
	const style = options?.style ?? "line";
	const width = options?.width ?? ctx.capabilities.columns ?? ctx.tokens.layout.defaultWidth;
	const titleAlign = options?.titleAlign ?? "left";

	if (style === "blank") return "";

	const chars = ctx.capabilities.unicode ? UNICODE_CHARS : ASCII_CHARS;
	const ch = chars[style]!;

	if (!options?.title) {
		return ch.repeat(width);
	}

	const title = ` ${options.title} `;
	const titleWidth = stringWidth(title);
	const available = width - titleWidth;

	if (available <= 0) {
		return ch.repeat(width);
	}

	if (titleAlign === "left") {
		return ch.repeat(2) + title + ch.repeat(available - 2);
	}

	if (titleAlign === "right") {
		return ch.repeat(available - 2) + title + ch.repeat(2);
	}

	// center
	const left = Math.floor(available / 2);
	const right = available - left;
	return ch.repeat(left) + title + ch.repeat(right);
}
