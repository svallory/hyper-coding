/**
 * list Component
 *
 * Renders ordered and unordered lists with nesting support.
 */

import { getContext, indent as indentPrimitive, stack, symbol } from "../primitives/index.ts";
import { stripAnsi } from "../render/index.ts";

/** A list item: either a plain string or an object with optional nested children. */
export type ListItem = string | { text: string; children?: ListItem[] };

/** Options for rendering a list. */
export type ListOptions = {
	/** Render as an ordered (numbered/lettered) list instead of bulleted. Defaults to `false`. */
	ordered?: boolean;
	/** Number of blank lines between items. Defaults to `1`. Set to `0` for compact lists. */
	gap?: number;
	/** Extra spaces added to body lines (continuation lines) beyond the prefix column. Defaults to `2`. Set to `0` to align body with title. */
	bodyIndent?: number;
	/** Bullet character style for unordered lists. Defaults to `'bullet'`. */
	bulletStyle?: "bullet" | "dash" | "arrow";
};

const BULLET_SYMBOL_MAP = {
	bullet: "bullet" as const,
	dash: "dash" as const,
	arrow: "pointer" as const,
};

function renderItems(items: ListItem[], options: ListOptions, depth: number): string[] {
	const ctx = getContext();
	const iconGap = " ".repeat(ctx.tokens.space.iconGap);
	const lines: string[] = [];

	for (let i = 0; i < items.length; i++) {
		const item = items[i]!;
		const text = typeof item === "string" ? item : item.text;
		const children = typeof item === "string" ? undefined : item.children;

		let prefix: string;
		if (options.ordered) {
			if (depth === 0) {
				prefix = `${i + 1}.`;
			} else {
				// Nested ordered: a., b., c., ...
				prefix = `${String.fromCharCode(97 + (i % 26))}.`;
			}
		} else {
			const bulletName = BULLET_SYMBOL_MAP[options.bulletStyle ?? "bullet"];
			prefix = symbol(bulletName);
		}

		const fullPrefix = prefix + iconGap;
		// Indent continuation lines relative to prefix column + bodyIndent
		// Use visual width (strip ANSI codes) for consistent alignment
		const visualWidth = stripAnsi(fullPrefix).length;
		const bodyIndent = " ".repeat(visualWidth + (options.bodyIndent ?? 2));
		const textLines = text.split("\n");
		const formattedText = textLines
			.map((line, idx) => {
				if (idx === 0) return fullPrefix + line;
				if (line === "") return "";
				return bodyIndent + line;
			})
			.join("\n");

		if (depth > 0) {
			lines.push(indentPrimitive(formattedText, depth));
		} else {
			lines.push(formattedText);
		}

		if (children && children.length > 0) {
			const childLines = renderItems(children, options, depth + 1);
			lines.push(...childLines);
		}
	}

	return lines;
}

/**
 * Renders ordered or unordered lists with nesting support.
 *
 * @param items - List items to render, supporting nested children.
 * @param options - List rendering configuration.
 * @returns The formatted list as a multi-line string.
 */
export function list(items: ListItem[], options?: ListOptions): string {
	const opts: ListOptions = {
		ordered: false,
		gap: 1,
		bulletStyle: "bullet",
		...options,
	};

	const lines = renderItems(items, opts, 0);
	return stack(lines, { spacing: opts.gap });
}
