import { renderMarkdown } from "cli-html";
import { describe, expect, it } from "vitest";
import Logger from "../src/logger/logger.js";

describe("renderMarkdown", () => {
	it("renders headings", () => {
		const result = renderMarkdown("# Hello\n\nThis is **bold** text.");
		expect(result).toContain("Hello");
		expect(result).toContain("bold");
	});

	it("renders code blocks", () => {
		const result = renderMarkdown("```ts\nconst x = 1;\n```");
		expect(result).toContain("const x = 1");
	});

	it("renders inline code", () => {
		const result = renderMarkdown("Use `bun install` to install.");
		expect(result).toContain("bun install");
	});

	it("renders lists", () => {
		const result = renderMarkdown("- item 1\n- item 2\n- item 3");
		expect(result).toContain("item 1");
		expect(result).toContain("item 2");
		expect(result).toContain("item 3");
	});
});

describe("Logger.markdown", () => {
	it("calls log with rendered markdown content", () => {
		const output: string[] = [];
		const logger = new Logger((msg: string) => output.push(msg));

		logger.markdown("# Test\n\nSome **content**.");

		expect(output).toHaveLength(1);
		expect(output[0]).toContain("Test");
		expect(output[0]).toContain("content");
	});
});
