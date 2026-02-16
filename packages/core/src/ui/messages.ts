import chalk from "chalk";
import { symbols } from "./symbols.js";

type ChalkFn = (text: string) => string;

interface MessageType {
	prefix: string;
	icon: string;
	color: ChalkFn;
}

const INDENT = "  ";
const ICON_GAP = "  ";

const types: Record<string, MessageType> = {
	error: { prefix: "Error:", icon: symbols.error, color: chalk.red },
	warning: { prefix: "Warning:", icon: symbols.warning, color: chalk.yellow },
	success: { prefix: "Success:", icon: symbols.success, color: chalk.green },
	info: { prefix: "Info:", icon: symbols.info, color: chalk.blue },
	tip: { prefix: "Tip:", icon: symbols.tip, color: chalk.cyan },
};

function formatMessage(
	type: string,
	arg1: string,
	arg2?: string,
	arg3?: string | string[],
): string {
	const { prefix, icon, color } = types[type];
	const lines: string[] = [];

	if (arg2 === undefined) {
		// summary-only: just icon + summary
		lines.push(`${INDENT}${color(icon)}${ICON_GAP}${arg1}`);
	} else if (arg3 === undefined) {
		// title + summary
		lines.push(`${INDENT}${color(prefix)} ${arg1}`);
		lines.push("");
		lines.push(`${INDENT}${INDENT}${color(icon)}${ICON_GAP}${arg2}`);
	} else {
		// title + summary + body
		const bodyLines = Array.isArray(arg3) ? arg3 : arg3.split("\n");

		lines.push(`${INDENT}${color(prefix)} ${arg1}`);
		lines.push("");
		lines.push(`${INDENT}${INDENT}${color(icon)}${ICON_GAP}${arg2}`);
		lines.push(`${INDENT}${INDENT}${color(symbols.bar)}`);
		for (const bodyLine of bodyLines) {
			lines.push(`${INDENT}${INDENT}${color(symbols.bar)}${ICON_GAP}${chalk.dim(bodyLine)}`);
		}
	}

	lines.push("");
	return lines.join("\n");
}

// ─── Public API ─────────────────────────────────────────────────────────────

export function error(summary: string): string;
export function error(title: string, summary: string): string;
export function error(title: string, summary: string, body: string | string[]): string;
export function error(arg1: string, arg2?: string, arg3?: string | string[]): string {
	return formatMessage("error", arg1, arg2, arg3);
}

export function warning(summary: string): string;
export function warning(title: string, summary: string): string;
export function warning(title: string, summary: string, body: string | string[]): string;
export function warning(arg1: string, arg2?: string, arg3?: string | string[]): string {
	return formatMessage("warning", arg1, arg2, arg3);
}

export function success(summary: string): string;
export function success(title: string, summary: string): string;
export function success(title: string, summary: string, body: string | string[]): string;
export function success(arg1: string, arg2?: string, arg3?: string | string[]): string {
	return formatMessage("success", arg1, arg2, arg3);
}

export function info(summary: string): string;
export function info(title: string, summary: string): string;
export function info(title: string, summary: string, body: string | string[]): string;
export function info(arg1: string, arg2?: string, arg3?: string | string[]): string {
	return formatMessage("info", arg1, arg2, arg3);
}

export function tip(summary: string): string;
export function tip(title: string, summary: string): string;
export function tip(title: string, summary: string, body: string | string[]): string;
export function tip(arg1: string, arg2?: string, arg3?: string | string[]): string {
	return formatMessage("tip", arg1, arg2, arg3);
}
