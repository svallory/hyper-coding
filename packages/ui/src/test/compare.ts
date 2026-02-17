/**
 * Output Comparison Utilities
 *
 * Compare rendered outputs ignoring ANSI codes, reporting visual differences.
 */

import { stripAnsi } from "../render/index.ts";

/** Result of comparing two rendered outputs. */
export type ComparisonResult = {
	/** Whether the outputs are visually identical (ignoring ANSI codes). */
	equal: boolean;
	/** Line-by-line differences found between the outputs. */
	differences: Array<{
		/** 1-indexed line number where the difference occurs. */
		line: number;
		/** Expected line content (ANSI stripped). */
		expected: string;
		/** Actual line content (ANSI stripped). */
		actual: string;
	}>;
};

/**
 * Compares two styled outputs by stripping ANSI codes and diffing line-by-line.
 *
 * @param actual - The actual rendered output.
 * @param expected - The expected rendered output.
 * @returns A {@link ComparisonResult} with equality flag and detailed differences.
 */
export function compareOutput(actual: string, expected: string): ComparisonResult {
	const actualPlain = stripAnsi(actual);
	const expectedPlain = stripAnsi(expected);

	const actualLines = actualPlain.split("\n");
	const expectedLines = expectedPlain.split("\n");

	const maxLines = Math.max(actualLines.length, expectedLines.length);
	const differences: ComparisonResult["differences"] = [];

	for (let i = 0; i < maxLines; i++) {
		const actualLine = actualLines[i] ?? "";
		const expectedLine = expectedLines[i] ?? "";

		if (actualLine !== expectedLine) {
			differences.push({
				line: i + 1,
				expected: expectedLine,
				actual: actualLine,
			});
		}
	}

	return {
		equal: differences.length === 0,
		differences,
	};
}
