/**
 * stack Primitive
 *
 * Joins lines vertically with configurable spacing and an optional
 * prefix prepended to each line.
 */

/** Options for vertical stacking of lines. */
export type StackOptions = {
	/** Number of blank lines to insert between each content line. Defaults to `0`. */
	spacing?: number;
	/** String to prepend to every line. */
	prefix?: string;
};

/**
 * Joins lines vertically with optional spacing and a per-line prefix.
 *
 * @param lines - The lines to stack vertically.
 * @param options - Stacking configuration.
 * @returns The joined multi-line string.
 */
export function stack(lines: string[], options?: StackOptions): string {
	const spacing = options?.spacing ?? 0;
	const prefix = options?.prefix;

	const processed = prefix ? lines.map((l) => prefix + l) : lines;

	const separator = `\n${"\n".repeat(spacing)}`;
	return processed.join(separator);
}
