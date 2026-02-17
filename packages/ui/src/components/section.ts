/**
 * section Component
 *
 * Renders a titled section with heading level styling and content layout.
 */

import { divider, getContext, stack, styledText } from "../primitives/index.ts";
import type { ColorTokens } from "../tokens/index.ts";

/** Options for rendering a titled section. */
export type SectionOptions = {
	/** The section heading text. */
	title: string;
	/** Heading level: `1` (divider + spacing), `2` (spacing only), `3` (compact). Defaults to `1`. */
	level?: 1 | 2 | 3;
	/** Body content below the heading. */
	content: string | string[];
};

/**
 * Renders a titled section with heading level styling and content layout.
 *
 * @param options - Section configuration.
 * @returns The formatted section as a multi-line string.
 */
export function section(options: SectionOptions): string {
	const ctx = getContext();
	const level = options.level ?? 1;
	const content = Array.isArray(options.content) ? options.content.join("\n") : options.content;

	// Get typography style for the heading level
	const typoKey = `heading${level}` as "heading1" | "heading2" | "heading3";
	const typoStyle = ctx.tokens.type[typoKey];

	const title = styledText(options.title, {
		bold: typoStyle.bold,
		dim: typoStyle.dim,
		italic: typoStyle.italic,
		underline: typoStyle.underline,
		color: typoStyle.color as keyof ColorTokens | undefined,
	});

	const parts: string[] = [];

	if (level === 1) {
		// Title + divider + blank line + content
		parts.push(title);
		parts.push(divider());
		parts.push("");
		parts.push(content);
	} else if (level === 2) {
		// Title + blank line + content
		parts.push(title);
		parts.push("");
		parts.push(content);
	} else {
		// Title + content (no blank line)
		parts.push(title);
		parts.push(content);
	}

	return parts.join("\n");
}
