/**
 * columns Component
 *
 * Renders content in side-by-side columns with configurable widths and alignment.
 */

import { getContext } from "../primitives/index.ts";
import { ansiPad, stringWidth } from "../render/index.ts";

/** Definition of a single column in a multi-column layout. */
export type ColumnDef = {
	/** Column content as a string or array of lines. */
	content: string | string[];
	/** Column width: fixed number, `'auto'` to fit content, or `'fill'` to consume remaining space. */
	width?: number | "auto" | "fill";
	/** Text alignment within the column. Defaults to `'left'`. */
	align?: "left" | "right" | "center";
};

/** Options for the multi-column layout. */
export type ColumnsOptions = {
	/** Gap between columns in characters. Defaults to the `space.gutter` token. */
	gap?: number;
};

/**
 * Renders content in a side-by-side multi-column layout.
 *
 * @param cols - Column definitions.
 * @param options - Layout configuration.
 * @returns The formatted columns as a multi-line string.
 */
export function columns(cols: ColumnDef[], options?: ColumnsOptions): string {
	const ctx = getContext();
	const gap = options?.gap ?? ctx.tokens.space.gutter;
	const totalWidth = ctx.capabilities.columns ?? ctx.tokens.layout.defaultWidth;

	// Normalize content to arrays of lines
	const colLines: string[][] = cols.map((col) =>
		Array.isArray(col.content) ? col.content : col.content.split("\n"),
	);

	// Calculate column widths
	const colWidths: number[] = cols.map((col, i) => {
		if (typeof col.width === "number") return col.width;
		if (col.width === "auto" || col.width === undefined) {
			// Auto: use the widest line in the column
			let max = 0;
			for (const line of colLines[i]!) {
				const w = stringWidth(line);
				if (w > max) max = w;
			}
			return max;
		}
		return 0; // fill — will be calculated below
	});

	// Calculate fill columns
	const fillIndices = cols.map((col, i) => (col.width === "fill" ? i : -1)).filter((i) => i >= 0);
	if (fillIndices.length > 0) {
		const usedWidth = colWidths.reduce((sum, w) => sum + w, 0) + gap * (cols.length - 1);
		const remaining = Math.max(0, totalWidth - usedWidth);
		const perFill = Math.floor(remaining / fillIndices.length);
		for (const i of fillIndices) {
			colWidths[i] = perFill;
		}
	}

	// Find the max number of lines
	const maxLines = Math.max(...colLines.map((l) => l.length));

	// Pad shorter columns with blank lines
	for (const lines of colLines) {
		while (lines.length < maxLines) {
			lines.push("");
		}
	}

	// Build output rows
	const gapStr = " ".repeat(gap);
	const rows: string[] = [];

	for (let row = 0; row < maxLines; row++) {
		const parts: string[] = [];
		for (let col = 0; col < cols.length; col++) {
			const line = colLines[col]![row] ?? "";
			const alignment = cols[col]!.align ?? "left";
			const padded = ansiPad(line, colWidths[col]!, alignment);
			parts.push(padded);
		}
		rows.push(parts.join(gapStr));
	}

	return rows.join("\n");
}
