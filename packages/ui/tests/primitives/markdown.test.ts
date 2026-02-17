import { describe, expect, test } from "vitest";
import { defaultMarkdownTheme, markdown } from "../../src/primitives/markdown.ts";
import type { MarkdownOptions, MarkdownTheme } from "../../src/primitives/markdown.ts";
import { stripAnsi } from "../../src/render/index.ts";

describe("markdown primitive", () => {
	test("renders a heading", () => {
		const result = markdown("# Hello World");
		const plain = stripAnsi(result);
		expect(plain).toContain("Hello World");
	});

	test("renders inline code", () => {
		const result = markdown("Use `npm install` to install");
		const plain = stripAnsi(result);
		expect(plain).toContain("npm install");
	});

	test("renders bold text", () => {
		const result = markdown("This is **bold** text");
		const plain = stripAnsi(result);
		expect(plain).toContain("bold");
	});

	test("renders with default theme when no options given", () => {
		const result = markdown("# Test");
		// Should produce styled output (not plain)
		expect(result).not.toBe("# Test");
	});

	test("accepts custom theme", () => {
		const customTheme: MarkdownTheme = {
			h1: "green bold",
			code: { color: "yellow" },
		};
		const result = markdown("# Custom", { theme: customTheme });
		expect(stripAnsi(result)).toContain("Custom");
	});

	test("renders multi-line markdown", () => {
		const input = "# Title\n\nParagraph text\n\n## Subtitle";
		const result = markdown(input);
		const plain = stripAnsi(result);
		expect(plain).toContain("Title");
		expect(plain).toContain("Paragraph text");
		expect(plain).toContain("Subtitle");
	});

	test("defaultMarkdownTheme has expected shape", () => {
		expect(defaultMarkdownTheme.h1).toBeDefined();
		expect(defaultMarkdownTheme.h2).toBeDefined();
		expect(defaultMarkdownTheme.h3).toBeDefined();
		expect(defaultMarkdownTheme.code).toBeDefined();
		expect(defaultMarkdownTheme.table).toBeDefined();
		expect(defaultMarkdownTheme.a).toBeDefined();
	});

	test("HeadingStyle shape works for h1", () => {
		const theme: MarkdownTheme = {
			h1: { color: "red bold", indicator: { marker: ">", color: "red" } },
		};
		const result = markdown("# Test", { theme });
		expect(stripAnsi(result)).toContain("Test");
	});
});
