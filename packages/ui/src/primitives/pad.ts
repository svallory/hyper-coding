/**
 * pad Primitive
 *
 * Adds left and/or right padding to a string using a configurable
 * fill character.
 */

/** Options for adding padding to text. */
export type PadOptions = {
	/** Number of padding characters to prepend. Defaults to `0`. */
	left?: number;
	/** Number of padding characters to append. Defaults to `0`. */
	right?: number;
	/** Character used for padding. Defaults to `' '`. */
	char?: string;
};

/**
 * Pads a string with a fill character on the left and/or right.
 *
 * @param text - The text to pad.
 * @param options - Padding configuration.
 * @returns The padded text string.
 */
export function pad(text: string, options?: PadOptions): string {
	const left = options?.left ?? 0;
	const right = options?.right ?? 0;
	const ch = options?.char ?? " ";

	return ch.repeat(left) + text + ch.repeat(right);
}
