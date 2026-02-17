import { describe, expect, test } from "vitest";
import { helpTheme, renderHelp, renderMarkdown } from "#help";
import type { HelpThemeConfig, MarkdownTheme } from "#help";
import { defaultMarkdownTheme } from "#primitives/markdown";
import { stripAnsi } from "#render/index";

describe("help module", () => {
	test("renderHelp renders markdown with default theme", () => {
		const result = renderHelp("# Hello");
		const plain = stripAnsi(result);
		expect(plain).toContain("Hello");
	});

	test("renderHelp accepts custom config", () => {
		const config: HelpThemeConfig = {
			theme: { h1: "green bold" },
		};
		const result = renderHelp("# Custom", config);
		expect(stripAnsi(result)).toContain("Custom");
	});

	test("renderMarkdown renders with default theme", () => {
		const result = renderMarkdown("# Default");
		expect(stripAnsi(result)).toContain("Default");
	});

	test("renderMarkdown accepts custom theme", () => {
		const theme: MarkdownTheme = { h1: "cyan" };
		const result = renderMarkdown("# Themed", theme);
		expect(stripAnsi(result)).toContain("Themed");
	});

	test("helpTheme has expected structure", () => {
		expect(helpTheme.lineWidth).toEqual({ max: 100 });
		expect(helpTheme.theme).toBeDefined();
		expect(helpTheme.theme).toBe(defaultMarkdownTheme);
	});
});
