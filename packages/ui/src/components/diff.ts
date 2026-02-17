/**
 * diff Component
 *
 * Renders a unified diff with file headers, hunk headers, and colored lines.
 */

import { divider, styledText } from "../primitives/index.ts";

/** A single line in a diff hunk. */
export type DiffLine = {
	/** Line change type: `'add'`, `'remove'`, or `'context'`. */
	type: "add" | "remove" | "context";
	/** Line content (without the leading +/-/space prefix). */
	content: string;
};

/** A diff hunk containing a header and a set of lines. */
export type DiffHunk = {
	/** Hunk header (e.g. `'@@ -1,5 +1,7 @@'`). */
	header: string;
	/** Lines within this hunk. */
	lines: DiffLine[];
};

/** Options for rendering a unified diff. */
export type DiffOptions = {
	/** Diff hunks to render. */
	hunks: DiffHunk[];
	/** Optional file header showing old and new file names. */
	fileHeader?: { old: string; new: string };
};

/**
 * Renders a unified diff with file headers, hunk headers, and colored change lines.
 *
 * @param options - Diff configuration.
 * @returns The formatted diff as a multi-line string.
 */
export function diff(options: DiffOptions): string {
	const parts: string[] = [];

	if (options.fileHeader) {
		parts.push(divider({ title: `${options.fileHeader.old} → ${options.fileHeader.new}` }));
	}

	for (const hunk of options.hunks) {
		parts.push(styledText(hunk.header, { color: "diffHunk" }));

		for (const line of hunk.lines) {
			switch (line.type) {
				case "add":
					parts.push(styledText(`+${line.content}`, { color: "diffAdded" }));
					break;
				case "remove":
					parts.push(styledText(`-${line.content}`, { color: "diffRemoved" }));
					break;
				case "context":
					parts.push(styledText(` ${line.content}`, { color: "diffContext", dim: true }));
					break;
			}
		}
	}

	return parts.join("\n");
}
