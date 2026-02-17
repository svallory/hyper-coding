/**
 * statusList Component (Static)
 *
 * Renders a list of items with status icons and optional detail text.
 */

import { getContext, indent, stack, styledText, symbol } from "../primitives/index.ts";
import type { ColorTokens } from "../tokens/index.ts";

/** A single item in a status list. */
export type StatusListItem = {
	/** Display text for this item. */
	text: string;
	/** Current status, determining the icon and color. */
	status: "pending" | "running" | "success" | "error" | "warning" | "skipped";
	/** Optional detail text shown inline (if short) or on the next line (if long). */
	detail?: string;
};

const STATUS_COLOR_MAP: Record<StatusListItem["status"], keyof ColorTokens> = {
	success: "success",
	error: "error",
	warning: "warning",
	running: "info",
	pending: "fgMuted",
	skipped: "fgMuted",
};

/**
 * Renders a list of items with status-mapped icons and colors.
 *
 * @param items - The status list items to render.
 * @returns The formatted status list as a multi-line string.
 */
export function statusList(items: StatusListItem[]): string {
	const ctx = getContext();
	const iconGap = " ".repeat(ctx.tokens.space.iconGap);
	const lines: string[] = [];

	for (const item of items) {
		const icon = symbol(item.status);
		const color = STATUS_COLOR_MAP[item.status];
		const text = styledText(item.text, { color });

		let line = icon + iconGap + text;

		if (item.detail) {
			// If detail is short (< 40 chars), show inline; otherwise on next line indented
			if (item.detail.length < 40) {
				line += ` ${styledText(`(${item.detail})`, { dim: true })}`;
			} else {
				line += `\n${indent(styledText(item.detail, { dim: true }), 1)}`;
			}
		}

		lines.push(line);
	}

	return stack(lines);
}
