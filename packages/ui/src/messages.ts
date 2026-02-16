/**
 * Structured message blocks — the `msg` namespace.
 *
 * Produces formatted multi-line messages with icons, bars, and indentation.
 * Supports both props objects and simple string shorthand.
 */

import chalk from "chalk";
import { md } from "./md.js";
import { symbols } from "./symbols.js";
import { tokens } from "./tokens.js";

type ChalkFn = (text: string) => string;

interface MessageType {
	prefix: string;
	icon: string;
	color: ChalkFn;
}

interface MessageProps {
	title?: string;
	summary: string;
	body?: string | string[];
}

const INDENT = "  ";
const ICON_GAP = "  ";

const types: Record<string, MessageType> = {
	error: { prefix: "Error:", icon: symbols.error, color: chalk.red },
	warning: { prefix: "Warning:", icon: symbols.warning, color: chalk.yellow },
	success: { prefix: "Success:", icon: symbols.success, color: chalk.green },
	info: { prefix: "Info:", icon: symbols.info, color: chalk.blue },
	tip: { prefix: "Tip:", icon: symbols.tip, color: chalk.hex(tokens.tip) },
};

function formatMessage(type: string, props: MessageProps): string {
	const { prefix, icon, color } = types[type];
	const { title, summary, body } = props;
	const lines: string[] = [];

	// Don't add leading indent for tip messages
	const leadingIndent = type === "tip" ? "" : INDENT;
	const contentIndent = type === "tip" ? INDENT : `${INDENT}${INDENT}`;

	const styledSummary = md(summary);

	if (!title) {
		// summary-only: just icon + summary
		lines.push(`${leadingIndent}${color(icon)}${ICON_GAP}${styledSummary}`);
	} else if (!body) {
		// title + summary
		lines.push(`${leadingIndent}${color(prefix)} ${title}`);
		lines.push("");
		lines.push(`${contentIndent}${color(icon)}${ICON_GAP}${styledSummary}`);
	} else {
		// title + summary + body
		const bodyLines = Array.isArray(body) ? body : body.split("\n");

		lines.push(`${leadingIndent}${color(prefix)} ${title}`);
		lines.push("");
		lines.push(`${contentIndent}${color(icon)}${ICON_GAP}${styledSummary}`);
		lines.push(`${contentIndent}${color(symbols.bar)}`);
		for (const bodyLine of bodyLines) {
			lines.push(`${contentIndent}${color(symbols.bar)}${ICON_GAP}${chalk.dim(bodyLine)}`);
		}
	}

	lines.push("");
	return lines.join("\n");
}

function makeMessageFn(type: string) {
	return (input: string | MessageProps): string => {
		const props: MessageProps = typeof input === "string" ? { summary: input } : input;
		return formatMessage(type, props);
	};
}

export const msg = {
	error: makeMessageFn("error"),
	warning: makeMessageFn("warning"),
	success: makeMessageFn("success"),
	info: makeMessageFn("info"),
	tip: makeMessageFn("tip"),
};
