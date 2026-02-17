/**
 * message Component
 *
 * Renders a styled message with an icon, text, optional title, details/body,
 * and hint. Supports error, warning, success, info, and tip levels.
 *
 * Produces rich output matching HyperDev's visual language:
 * - Title line with prefix label
 * - Icon + summary with gap
 * - Vertical bar connectors for body content
 * - Trailing blank line
 */

import { getContext, indent, stack, styledText, symbol } from "../primitives/index.ts";

/** Options for rendering a status message. */
export type MessageOptions = {
	/** Semantic level determining the icon and color. */
	level: "error" | "warning" | "success" | "info" | "tip";
	/** Primary message text (the summary line). */
	text: string;
	/** Optional title shown as a prefix label above the summary (e.g. "Error: Connection refused"). */
	title?: string;
	/** Additional detail lines displayed below with vertical bar connectors. */
	details?: string | string[];
	/** Hint text shown below details in dim style. */
	hint?: string;
};

/** Prefix labels for each message level. */
const LEVEL_PREFIX: Record<string, string> = {
	error: "Error:",
	warning: "Warning:",
	success: "Success:",
	info: "Info:",
	tip: "Tip:",
};

/**
 * Renders a styled message with an icon, text, optional title, body, and hint.
 *
 * @param options - Message configuration.
 * @returns The formatted message as a multi-line string.
 */
export function message(options: MessageOptions): string {
	const ctx = getContext();
	const iconGap = " ".repeat(ctx.tokens.space.iconGap);

	// Resolve the color token name — tip uses 'info' color since there's no 'tip' color token
	const colorName = options.level === "tip" ? "info" : options.level;

	const icon = symbol(options.level === "tip" ? "tip" : options.level);
	const styledSummary = styledText(options.text, { color: colorName, bold: true });

	// Indentation: tip messages have no leading indent, others get 2 spaces
	const INDENT = "  ";
	const leadingIndent = options.level === "tip" ? "" : INDENT;
	const contentIndent = options.level === "tip" ? INDENT : INDENT + INDENT;

	const parts: string[] = [];

	if (!options.title && !options.details) {
		// Summary-only: just icon + summary
		parts.push(`${leadingIndent}${icon}${iconGap}${styledSummary}`);
	} else if (!options.title && options.details) {
		// No title, but has details: icon + summary, then indented details
		parts.push(`${leadingIndent}${icon}${iconGap}${styledSummary}`);
		const detailLines = Array.isArray(options.details)
			? options.details
			: options.details.split("\n");
		for (const detail of detailLines) {
			parts.push(indent(detail, 1));
		}
	} else if (options.title && !options.details) {
		// Title + summary (no body)
		const prefix = styledText(LEVEL_PREFIX[options.level] ?? "", { color: colorName });
		parts.push(`${leadingIndent}${prefix} ${options.title}`);
		parts.push("");
		parts.push(`${contentIndent}${icon}${iconGap}${styledSummary}`);
	} else {
		// Title + summary + body with bar connectors
		const prefix = styledText(LEVEL_PREFIX[options.level] ?? "", { color: colorName });
		const barChar = symbol("bar");
		const styledBar = styledText(barChar, { color: colorName });

		const bodyLines = Array.isArray(options.details)
			? options.details
			: options.details!.split("\n");

		parts.push(`${leadingIndent}${prefix} ${options.title}`);
		parts.push("");
		parts.push(`${contentIndent}${icon}${iconGap}${styledSummary}`);
		parts.push(`${contentIndent}${styledBar}`);
		for (const bodyLine of bodyLines) {
			const dimLine = styledText(bodyLine, { dim: true });
			parts.push(`${contentIndent}${styledBar}${iconGap}${dimLine}`);
		}
	}

	if (options.hint) {
		const hintText = styledText(options.hint, { dim: true });
		parts.push(indent(hintText, 1));
	}

	// Trailing blank line
	parts.push("");

	return parts.join("\n");
}
