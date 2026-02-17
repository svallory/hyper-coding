/**
 * Shortcuts — Quick opinionated API
 *
 * Provides c (color functions), s (composite styles), msg (structured messages),
 * md (inline markdown), symbols, and tokens as convenient shortcuts.
 */

import { message } from "./components/index.ts";
import type { MessageOptions } from "./components/index.ts";
import {
	divider,
	getContext,
	indent as indentPrimitive,
	styledText,
	symbol,
} from "./primitives/index.ts";

// ---------------------------------------------------------------------------
// md — inline markdown → styled text
// ---------------------------------------------------------------------------

export function md(text: string): string {
	return text
		.replace(/`([^`]+)`/g, (_, code: string) => styledText(code, { color: "code" }))
		.replace(/\*\*([^*]+)\*\*/g, (_, bold: string) => styledText(bold, { bold: true }))
		.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, (_, dim: string) => styledText(dim, { dim: true }));
}

// ---------------------------------------------------------------------------
// c — color functions
// ---------------------------------------------------------------------------

export const c = {
	// Status colors
	success: (text: string) => styledText(text, { color: "success" }),
	error: (text: string) => styledText(text, { color: "error" }),
	warning: (text: string) => styledText(text, { color: "warning" }),
	info: (text: string) => styledText(text, { color: "info" }),
	muted: (text: string) => styledText(text, { dim: true }),

	// Hex-based / semantic
	command: (text: string) => styledText(text, { color: "code" }),
	danger: (text: string) => styledText(text, { color: "error", bold: true }),

	// Formatting helpers
	highlight: (text: string) => styledText(text, { color: "info" }),
	dim: (text: string) => styledText(text, { dim: true }),
	bold: (text: string) => styledText(text, { bold: true }),
	subtle: (text: string) => styledText(text, { dim: true }),
	text: (text: string) => text,

	// CLI entity colors
	kit: (text: string) => styledText(text, { color: "accent" }),
	recipe: (text: string) => styledText(text, { color: "code" }),
	cookbook: (text: string) => styledText(text, { color: "accent", bold: true }),
	helper: (text: string) => styledText(text, { color: "warning" }),

	// Code/data colors
	property: (text: string) => styledText(text, { color: "info" }),
	required: (text: string) => styledText(text, { color: "error", bold: true }),
	default: (value: any) => styledText(` (default: ${JSON.stringify(value)})`, { dim: true }),
	enum: (text: string) => styledText(text, { color: "warning" }),

	// Headings & labels
	title: (text: string) => styledText(text, { bold: true, color: "info" }),
	heading: (text: string) => styledText(text, { bold: true, color: "warning" }),
	version: (text: string) => styledText(text, { dim: true }),
};

// ---------------------------------------------------------------------------
// s — composite style formatters
// ---------------------------------------------------------------------------

export const s = {
	hint: (text: string) => styledText(text, { dim: true }),

	// Status messages with icons
	success: (text: string) => `${symbol("success")} ${styledText(text, { color: "success" })}`,
	error: (text: string) => `${symbol("error")} ${styledText(text, { color: "error" })}`,
	warning: (text: string) => `${symbol("warning")} ${styledText(text, { color: "warning" })}`,
	info: (text: string) => `${symbol("info")} ${styledText(text, { color: "info" })}`,

	section: (text: string) => styledText(text, { bold: true, color: "info" }),
	code: (text: string) => styledText(`\`${text}\``, { dim: true }),
	highlight: (text: string) => styledText(text, { color: "info", bold: true }),
	title: (prefix: string, text: string) =>
		styledText(`${prefix}: ${text}`, { bold: true, color: "info" }),
	hr: () => divider(),
	keyValue: (key: string, value: string, indent = 0) =>
		`${" ".repeat(indent)}${styledText(`${key}:`, { color: "info" })} ${value}`,
	header: (text: string, count?: number) =>
		styledText(count !== undefined ? `${text} (${count})` : text, { bold: true, color: "warning" }),
	description: (text: string, level = 2) => indentPrimitive(styledText(text, { dim: true }), level),
	listItem: (text: string) => `  ${symbol("bullet")} ${text}`,
	/**
	 * Renders indented paragraph lines under a list item, followed by a blank line.
	 * Use this when a list item has body content (description, sub-items, etc.).
	 * Items without body content should NOT use this — they get no trailing blank line.
	 */
	listItemBody: (...lines: string[]) => `${lines.join("\n")}\n`,
	indent: (text: string, spaces: number) => " ".repeat(spaces) + text,
	path: (text: string) => styledText(text, { dim: true }),
	version: (text: string) => styledText(text, { dim: true }),

	md,
};

// ---------------------------------------------------------------------------
// msg — structured message blocks
// ---------------------------------------------------------------------------

interface MessageProps {
	title?: string;
	summary: string;
	body?: string | string[];
}

function makeMessageFn(level: MessageOptions["level"]) {
	return (input: string | MessageProps): string => {
		if (typeof input === "string") {
			return message({ level, text: input });
		}
		// Bridge from UI's API shape to DS's message component
		return message({
			level,
			text: input.summary,
			title: input.title,
			details: input.body,
		});
	};
}

export const msg = {
	error: makeMessageFn("error"),
	warning: makeMessageFn("warning"),
	success: makeMessageFn("success"),
	info: makeMessageFn("info"),
	tip: makeMessageFn("tip"),
};

// ---------------------------------------------------------------------------
// symbols & tokens — resolved values
// ---------------------------------------------------------------------------

/** Get resolved symbol glyphs. Lazy getter to ensure system is initialized. */
export function getSymbols() {
	return getContext().tokens.symbol;
}

/** Get resolved tokens. Lazy getter to ensure system is initialized. */
export function getTokens() {
	return getContext().tokens;
}

// For backwards compat, export as objects that proxy to the context
// These are functions, not static objects, because the context may not be initialized yet
export { getSymbols as symbols, getTokens as tokens };
