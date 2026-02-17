/**
 * table Component
 *
 * Renders tabular data in multiple variants: minimal, borderless, grid, outer.
 */

import { getContext, styledText } from "../primitives/index.ts";
import { ansiPad, ansiTruncate, stringWidth } from "../render/index.ts";

/** Definition of a single table column. */
export type TableColumn = {
	/** Property key used to look up values in each data row. */
	key: string;
	/** Display header text. Defaults to the `key`. */
	header?: string;
	/** Cell text alignment. Defaults to `'left'`. */
	align?: "left" | "right" | "center";
	/** Fixed column width in characters, or `'auto'` to fit content. */
	width?: number | "auto";
	/** Maximum column width. Only effective when `truncate` is enabled. */
	maxWidth?: number;
	/** Whether to truncate cell text that exceeds `maxWidth`. */
	truncate?: boolean;
};

/** Options for rendering a table. */
export type TableOptions = {
	/** Column definitions describing the table structure. */
	columns: TableColumn[];
	/** Row data as an array of records keyed by column `key`. */
	data: Array<Record<string, unknown>>;
	/** Table rendering variant. Defaults to `'minimal'`. */
	variant?: "minimal" | "grid" | "borderless" | "outer";
	/** Text to display when `data` is empty. Defaults to `''`. */
	emptyText?: string;
};

/**
 * Renders tabular data in aligned columns with multiple visual variants.
 *
 * @param options - Table configuration.
 * @returns The formatted table as a multi-line string.
 */
export function table(options: TableOptions): string {
	const ctx = getContext();
	const variant = options.variant ?? "minimal";
	const gutter = ctx.tokens.space.gutter;
	const chars = ctx.tokens.border.chars;

	const columns = options.columns;
	const data = options.data;

	// Handle empty data
	if (data.length === 0) {
		return options.emptyText ?? "";
	}

	// Convert data to cell strings
	const cellData: string[][] = data.map((row) =>
		columns.map((col) => {
			const val = row[col.key];
			return val === null || val === undefined ? "" : String(val);
		}),
	);

	// Calculate column widths
	const colWidths: number[] = columns.map((col, i) => {
		if (typeof col.width === "number") return col.width;

		// Auto: max of header width and all data widths
		let max = stringWidth(col.header ?? col.key);
		for (const row of cellData) {
			const w = stringWidth(row[i]!);
			if (w > max) max = w;
		}

		if (col.maxWidth && max > col.maxWidth) {
			max = col.maxWidth;
		}

		return max;
	});

	// Format cell content (truncate + align)
	function formatCell(text: string, colIndex: number): string {
		const col = columns[colIndex]!;
		const width = colWidths[colIndex]!;
		let result = text;

		if (col.truncate && col.maxWidth) {
			const currentW = stringWidth(result);
			if (currentW > width) {
				result = ansiTruncate(result, width, ctx.tokens.symbol.ellipsis);
			}
		}

		return ansiPad(result, width, col.align ?? "left");
	}

	// Build header cells
	const headerCells = columns.map((col, i) => {
		const headerText = col.header ?? col.key;
		const formatted = ansiPad(headerText, colWidths[i]!, col.align ?? "left");
		return styledText(formatted, { bold: true });
	});

	// Build data rows
	const dataRows = cellData.map((row) => row.map((cell, i) => formatCell(cell, i)));

	const lines: string[] = [];
	const gutterStr = " ".repeat(gutter);

	if (variant === "minimal") {
		lines.push(headerCells.join(gutterStr));
		// Divider under headers
		const dividerParts = colWidths.map((w) => chars.horizontal.repeat(w));
		lines.push(dividerParts.join(gutterStr));
		for (const row of dataRows) {
			lines.push(row.join(gutterStr));
		}
	} else if (variant === "borderless") {
		lines.push(headerCells.join(gutterStr));
		for (const row of dataRows) {
			lines.push(row.join(gutterStr));
		}
	} else if (variant === "grid") {
		const sep = chars.vertical;
		const innerWidth = colWidths.reduce((s, w) => s + w, 0) + (columns.length - 1) * 3; // " | " between columns

		// Top border
		const topParts = colWidths.map((w) => chars.horizontal.repeat(w));
		lines.push(
			chars.topLeft +
				topParts.join(chars.horizontal + chars.teeDown + chars.horizontal) +
				chars.topRight,
		);

		// Header row
		lines.push(`${sep} ${headerCells.join(` ${sep} `)} ${sep}`);

		// Header divider
		const hDivParts = colWidths.map((w) => chars.horizontal.repeat(w));
		lines.push(
			chars.teeRight +
				hDivParts.join(chars.horizontal + chars.cross + chars.horizontal) +
				chars.teeLeft,
		);

		// Data rows with dividers between them
		for (let i = 0; i < dataRows.length; i++) {
			lines.push(`${sep} ${dataRows[i]!.join(` ${sep} `)} ${sep}`);
			if (i < dataRows.length - 1) {
				lines.push(
					chars.teeRight +
						hDivParts.join(chars.horizontal + chars.cross + chars.horizontal) +
						chars.teeLeft,
				);
			}
		}

		// Bottom border
		lines.push(
			chars.bottomLeft +
				topParts.join(chars.horizontal + chars.teeUp + chars.horizontal) +
				chars.bottomRight,
		);
	} else if (variant === "outer") {
		const sep = chars.vertical;

		// Top border
		const topParts = colWidths.map((w) => chars.horizontal.repeat(w));
		const innerHWidth = colWidths.reduce((s, w) => s + w, 0) + (columns.length - 1) * gutter;
		lines.push(chars.topLeft + chars.horizontal.repeat(innerHWidth + 2) + chars.topRight);

		// Header row
		lines.push(`${sep} ${headerCells.join(gutterStr)} ${sep}`);

		// Header divider
		lines.push(`${sep} ${colWidths.map((w) => chars.horizontal.repeat(w)).join(gutterStr)} ${sep}`);

		// Data rows
		for (const row of dataRows) {
			lines.push(`${sep} ${row.join(gutterStr)} ${sep}`);
		}

		// Bottom border
		lines.push(chars.bottomLeft + chars.horizontal.repeat(innerHWidth + 2) + chars.bottomRight);
	}

	return lines.join("\n");
}
