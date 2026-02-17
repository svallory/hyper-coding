/**
 * indent Primitive
 *
 * Prepends indentation spaces to each line of content based on
 * the resolved space.indent token.
 */

import { getContext } from "./context.ts";

/**
 * Indents each line of content by a number of indent levels.
 * The indent size per level is determined by the `space.indent` token.
 *
 * @param content - The text content to indent (may contain newlines).
 * @param level - Number of indent levels to apply. Defaults to `1`.
 * @returns The indented text string.
 */
export function indent(content: string, level = 1): string {
	const ctx = getContext();
	const indentSize = ctx.tokens.space.indent;
	const prefix = " ".repeat(level * indentSize);

	return content
		.split("\n")
		.map((line) => prefix + line)
		.join("\n");
}
