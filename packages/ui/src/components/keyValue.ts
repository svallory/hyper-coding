/**
 * keyValue Component
 *
 * Renders aligned key-value pairs with configurable styling and separators.
 */

import type { StyledTextOptions } from "../primitives/index.ts";
import { styledText } from "../primitives/index.ts";
import { stringWidth } from "../render/index.ts";

/** A single key-value pair to display. */
export type KeyValueEntry = {
	/** The label text. */
	key: string;
	/** The value text. Displays `nullDisplay` when `undefined`. */
	value: string | undefined;
};

/** Options for rendering key-value pairs. */
export type KeyValueOptions = {
	/** String inserted between the key column and the value column. Defaults to `'  '`. */
	separator?: string;
	/** Styling applied to key labels. Defaults to `{ bold: true }`. */
	keyStyle?: StyledTextOptions;
	/** Text shown in place of `undefined` values. Defaults to `'-'`. */
	nullDisplay?: string;
};

/**
 * Renders aligned key-value pairs with configurable styling and separators.
 *
 * @param entries - The key-value pairs to display.
 * @param options - Rendering configuration.
 * @returns The formatted key-value output as a multi-line string.
 */
export function keyValue(entries: KeyValueEntry[], options?: KeyValueOptions): string {
	const separator = options?.separator ?? "  ";
	const nullDisplay = options?.nullDisplay ?? "-";
	const keyStyle: StyledTextOptions = options?.keyStyle ?? { bold: true };

	// Calculate max key width
	let maxKeyWidth = 0;
	for (const entry of entries) {
		const w = stringWidth(entry.key);
		if (w > maxKeyWidth) maxKeyWidth = w;
	}

	const lines: string[] = [];

	for (const entry of entries) {
		const styledKey = styledText(entry.key, keyStyle);
		const keyWidth = stringWidth(entry.key);
		const padding = " ".repeat(maxKeyWidth - keyWidth);
		const value = entry.value ?? nullDisplay;

		lines.push(styledKey + padding + separator + value);
	}

	return lines.join("\n");
}
