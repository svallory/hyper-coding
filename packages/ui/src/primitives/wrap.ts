/**
 * wrap Primitive
 *
 * Word-wraps text to a maximum width, defaulting to the resolved
 * layout.maxWidth token.
 */

import { ansiWrap } from "../render/index.ts";
import { getContext } from "./context.ts";

/** Options for word-wrapping text. */
export type WrapOptions = {
	/** Break words that exceed the max width instead of only breaking at spaces. Defaults to `false`. */
	hard?: boolean;
	/** Trim trailing whitespace from each wrapped line. Defaults to `false`. */
	trim?: boolean;
};

/**
 * Word-wraps text to a maximum column width.
 *
 * @param text - The text to wrap.
 * @param maxWidth - Maximum line width in columns. Defaults to the `layout.maxWidth` token.
 * @param options - Wrapping configuration.
 * @returns The wrapped text string.
 */
export function wrap(text: string, maxWidth?: number, options?: WrapOptions): string {
	const ctx = getContext();
	const width = maxWidth ?? ctx.tokens.layout.maxWidth;
	const hard = options?.hard ?? false;

	let result = ansiWrap(text, width, hard);

	if (options?.trim) {
		result = result
			.split("\n")
			.map((l) => l.trimEnd())
			.join("\n");
	}

	return result;
}
