import { describe, expect, it } from "vitest";
import { formatDiff } from "../../src/utils/diff.js";

describe("formatDiff", () => {
	it("returns a string with ANSI codes for differing content", () => {
		const result = formatDiff("hello\nworld\n", "hello\nearth\n");
		// Should contain ANSI escape codes (colored diff)
		expect(result).toContain("\x1b[");
		expect(result).toContain("world");
		expect(result).toContain("earth");
	});

	it("returns empty diff marker for identical content", () => {
		const content = "same content\n";
		const result = formatDiff(content, content);
		// disparity returns an empty string for identical files
		expect(result).toBe("");
	});

	it("uses custom labels when provided", () => {
		const result = formatDiff("old\n", "new\n", {
			oldLabel: "src/file.ts",
			newLabel: "src/file.ts (incoming)",
		});
		expect(result).toContain("src/file.ts");
	});

	it("handles multi-line additions", () => {
		const old = "line1\nline2\n";
		const updated = "line1\nline2\nline3\nline4\n";
		const result = formatDiff(old, updated);
		expect(result).toContain("line3");
		expect(result).toContain("line4");
	});

	it("handles multi-line deletions", () => {
		const old = "line1\nline2\nline3\n";
		const updated = "line1\n";
		const result = formatDiff(old, updated);
		expect(result).toContain("line2");
		expect(result).toContain("line3");
	});
});
