import { renderMarkdown } from "cli-html";
import { describe, expect, it } from "vitest";
import Logger from "../src/logger/logger.js";

// Helper to strip ANSI color codes
function stripAnsi(str: string): string {
	// eslint-disable-next-line no-control-regex
	return str.replace(/\u001b\[\d+m/g, "");
}

describe("renderMarkdown", () => {
	it("renders headings", () => {
		const result = renderMarkdown("# Hello\n\nThis is **bold** text.");
		const stripped = stripAnsi(result);
		expect(stripped).toContain("Hello");
		expect(stripped).toContain("bold");
	});

	it("renders code blocks", () => {
		const result = renderMarkdown("```ts\nconst x = 1;\n```");
		const stripped = stripAnsi(result);
		expect(stripped).toContain("const x = 1;");
	});

	it("renders code blocks with colors", () => {
		const result = renderMarkdown("```ts\nconst x = 1;\n```");
		// Verify ANSI color codes are present (confirms FORCE_COLOR is working)
		expect(result).toMatch(/\u001b\[\d+m/);
	});

	it("renders inline code", () => {
		const result = renderMarkdown("Use `bun install` to install.");
		const stripped = stripAnsi(result);
		expect(stripped).toContain("bun install");
	});

	it("renders lists", () => {
		const result = renderMarkdown("- item 1\n- item 2\n- item 3");
		const stripped = stripAnsi(result);
		expect(stripped).toContain("item 1");
		expect(stripped).toContain("item 2");
		expect(stripped).toContain("item 3");
	});
});

describe("Logger.markdown", () => {
	it("calls log with rendered markdown content", () => {
		const output: string[] = [];
		const logger = new Logger((msg: string) => output.push(msg));

		logger.markdown("# Test\n\nSome **content**.");

		expect(output).toHaveLength(1);
		const stripped = stripAnsi(output[0]);
		expect(stripped).toContain("Test");
		expect(stripped).toContain("content");
	});
});
