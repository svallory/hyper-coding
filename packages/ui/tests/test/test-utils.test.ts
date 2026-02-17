/**
 * Tests for CLI Design System test utilities
 */

import { describe, expect, test } from "vitest";
import { compareOutput } from "#test/compare";
import { mockCapabilities, mockTheme, setupTestContext } from "#test/mock";
import { render } from "#test/render";
import { snapshot } from "#test/snapshot";

// ─── render() ────────────────────────────────────────────────────────────────

describe("render()", () => {
	test("plain text: hasColor false, plain equals input", () => {
		const result = render("hello world");
		expect(result.hasColor).toBe(false);
		expect(result.plain).toBe("hello world");
		expect(result.styled).toBe("hello world");
	});

	test("styled text: hasColor true, plain has no ANSI", () => {
		const styled = "\x1b[31mhello\x1b[39m";
		const result = render(styled);
		expect(result.hasColor).toBe(true);
		expect(result.plain).toBe("hello");
		expect(result.styled).toBe(styled);
	});

	test('hasStyle("bold") detects bold', () => {
		const result = render("\x1b[1mbold text\x1b[22m");
		expect(result.hasStyle("bold")).toBe(true);
		expect(result.hasStyle("italic")).toBe(false);
	});

	test('hasStyle("dim") detects dim', () => {
		const result = render("\x1b[2mdim text\x1b[22m");
		expect(result.hasStyle("dim")).toBe(true);
		expect(result.hasStyle("bold")).toBe(false);
	});

	test('hasStyle("italic") detects italic', () => {
		const result = render("\x1b[3mitalic\x1b[23m");
		expect(result.hasStyle("italic")).toBe(true);
	});

	test('hasStyle("underline") detects underline', () => {
		const result = render("\x1b[4munderlined\x1b[24m");
		expect(result.hasStyle("underline")).toBe(true);
	});

	test('hasStyle("strikethrough") detects strikethrough', () => {
		const result = render("\x1b[9mstruck\x1b[29m");
		expect(result.hasStyle("strikethrough")).toBe(true);
	});

	test('hasStyle("inverse") detects inverse', () => {
		const result = render("\x1b[7minverted\x1b[27m");
		expect(result.hasStyle("inverse")).toBe(true);
	});

	test("hasColor false for bold-only text (no color codes)", () => {
		const result = render("\x1b[1mbold\x1b[22m");
		expect(result.hasColor).toBe(false);
	});

	test("hasColor true for 256-color codes", () => {
		const result = render("\x1b[38;5;196mred\x1b[39m");
		expect(result.hasColor).toBe(true);
	});

	test("hasColor true for truecolor codes", () => {
		const result = render("\x1b[38;2;255;0;0mred\x1b[39m");
		expect(result.hasColor).toBe(true);
	});

	test("hasColor true for background color codes", () => {
		const result = render("\x1b[41mred bg\x1b[49m");
		expect(result.hasColor).toBe(true);
	});

	test("width calculation correct", () => {
		const result = render("\x1b[1mhello\x1b[22m");
		expect(result.width).toBe(5);
	});

	test("width of empty string is 0", () => {
		const result = render("");
		expect(result.width).toBe(0);
	});

	test("lines split correctly", () => {
		const result = render("line1\nline2\nline3");
		expect(result.lines).toEqual(["line1", "line2", "line3"]);
	});

	test("lines strips ANSI before splitting", () => {
		const result = render("\x1b[31mred\x1b[39m\n\x1b[32mgreen\x1b[39m");
		expect(result.lines).toEqual(["red", "green"]);
	});

	test("multi-line output: lineCount correct", () => {
		const result = render("a\nb\nc\nd");
		expect(result.lineCount).toBe(4);
	});

	test("single line: lineCount is 1", () => {
		const result = render("single");
		expect(result.lineCount).toBe(1);
	});

	test("compound SGR sequences: hasColor and hasStyle both work", () => {
		// bold + red in one sequence
		const result = render("\x1b[1;31mbold red\x1b[22;39m");
		expect(result.hasColor).toBe(true);
		expect(result.hasStyle("bold")).toBe(true);
		expect(result.hasStyle("dim")).toBe(false);
	});
});

// ─── mockCapabilities() ─────────────────────────────────────────────────────

describe("mockCapabilities()", () => {
	test("full preset: truecolor + unicode + TTY + 120 cols", () => {
		const caps = mockCapabilities("full");
		expect(caps.colorDepth).toBe("truecolor");
		expect(caps.unicode).toBe(true);
		expect(caps.isTTY).toBe(true);
		expect(caps.columns).toBe(120);
		expect(caps.isCI).toBe(false);
		expect(caps.isDumb).toBe(false);
		expect(caps.noColor).toBe(false);
	});

	test("ansi256 preset: 256-color + unicode + TTY + 80 cols", () => {
		const caps = mockCapabilities("ansi256");
		expect(caps.colorDepth).toBe("256");
		expect(caps.unicode).toBe(true);
		expect(caps.isTTY).toBe(true);
		expect(caps.columns).toBe(80);
	});

	test("ansi16 preset: 16-color + unicode + TTY + 80 cols", () => {
		const caps = mockCapabilities("ansi16");
		expect(caps.colorDepth).toBe("16");
		expect(caps.unicode).toBe(true);
		expect(caps.isTTY).toBe(true);
		expect(caps.columns).toBe(80);
	});

	test("nocolor preset: none + unicode + TTY + noColor:true", () => {
		const caps = mockCapabilities("nocolor");
		expect(caps.colorDepth).toBe("none");
		expect(caps.unicode).toBe(true);
		expect(caps.isTTY).toBe(true);
		expect(caps.noColor).toBe(true);
		expect(caps.columns).toBe(80);
	});

	test("dumb preset: none + no unicode + isDumb:true", () => {
		const caps = mockCapabilities("dumb");
		expect(caps.colorDepth).toBe("none");
		expect(caps.unicode).toBe(false);
		expect(caps.isDumb).toBe(true);
		expect(caps.isTTY).toBe(true);
		expect(caps.columns).toBe(80);
	});

	test("ascii preset: 16-color + no unicode", () => {
		const caps = mockCapabilities("ascii");
		expect(caps.colorDepth).toBe("16");
		expect(caps.unicode).toBe(false);
		expect(caps.isTTY).toBe(true);
		expect(caps.columns).toBe(80);
	});

	test("ci preset: 16-color + unicode + not TTY + isCI:true", () => {
		const caps = mockCapabilities("ci");
		expect(caps.colorDepth).toBe("16");
		expect(caps.unicode).toBe(true);
		expect(caps.isTTY).toBe(false);
		expect(caps.isCI).toBe(true);
		expect(caps.columns).toBe(80);
	});

	test("overrides merge on top of preset", () => {
		const caps = mockCapabilities("full", { columns: 200, unicode: false });
		expect(caps.colorDepth).toBe("truecolor");
		expect(caps.columns).toBe(200);
		expect(caps.unicode).toBe(false);
	});

	test("default (no preset) returns reasonable defaults", () => {
		const caps = mockCapabilities();
		expect(caps.colorDepth).toBe("16");
		expect(caps.unicode).toBe(true);
		expect(caps.isTTY).toBe(true);
		expect(caps.columns).toBe(80);
	});

	test("overrides without preset", () => {
		const caps = mockCapabilities(undefined, { colorDepth: "truecolor", columns: 160 });
		expect(caps.colorDepth).toBe("truecolor");
		expect(caps.columns).toBe(160);
	});

	test("capabilities object is frozen", () => {
		const caps = mockCapabilities("full");
		expect(Object.isFrozen(caps)).toBe(true);
	});
});

// ─── mockTheme() ────────────────────────────────────────────────────────────

describe("mockTheme()", () => {
	test("creates theme with default name", () => {
		const theme = mockTheme({});
		expect(theme.name).toBe("test-theme");
	});

	test("overrides name", () => {
		const theme = mockTheme({ name: "custom" });
		expect(theme.name).toBe("custom");
	});

	test("passes through overrides", () => {
		const theme = mockTheme({
			extends: "minimal",
			meta: { description: "test" },
		});
		expect(theme.extends).toBe("minimal");
		expect(theme.meta?.description).toBe("test");
	});
});

// ─── setupTestContext() ─────────────────────────────────────────────────────

describe("setupTestContext()", () => {
	test("sets up and cleans up context", () => {
		const cleanup = setupTestContext("full");
		expect(typeof cleanup).toBe("function");
		cleanup();
	});

	test("sets up context with theme", () => {
		const cleanup = setupTestContext("full", "minimal");
		cleanup();
	});
});

// ─── snapshot() ─────────────────────────────────────────────────────────────

describe("snapshot()", () => {
	test("bold → [bold]...[/bold]", () => {
		const result = snapshot("\x1b[1mbold\x1b[22m");
		expect(result).toBe("[bold]bold[/bold]");
	});

	test("dim → [dim]...[/dim]", () => {
		const result = snapshot("\x1b[2mdim\x1b[22m");
		expect(result).toBe("[dim]dim[/dim]");
	});

	test("italic → [italic]...[/italic]", () => {
		const result = snapshot("\x1b[3mitalic\x1b[23m");
		expect(result).toBe("[italic]italic[/italic]");
	});

	test("underline → [underline]...[/underline]", () => {
		const result = snapshot("\x1b[4munderlined\x1b[24m");
		expect(result).toBe("[underline]underlined[/underline]");
	});

	test("inverse → [inverse]...[/inverse]", () => {
		const result = snapshot("\x1b[7minverted\x1b[27m");
		expect(result).toBe("[inverse]inverted[/inverse]");
	});

	test("strikethrough → [strikethrough]...[/strikethrough]", () => {
		const result = snapshot("\x1b[9mstruck\x1b[29m");
		expect(result).toBe("[strikethrough]struck[/strikethrough]");
	});

	test("foreground color → [red]...[/fg]", () => {
		const result = snapshot("\x1b[31mred text\x1b[39m");
		expect(result).toBe("[red]red text[/fg]");
	});

	test("green foreground", () => {
		const result = snapshot("\x1b[32mgreen\x1b[39m");
		expect(result).toBe("[green]green[/fg]");
	});

	test("256-color → [fg:N]", () => {
		const result = snapshot("\x1b[38;5;196mred\x1b[39m");
		expect(result).toBe("[fg:196]red[/fg]");
	});

	test("truecolor → [fg:#hex]", () => {
		const result = snapshot("\x1b[38;2;255;0;0mred\x1b[39m");
		expect(result).toBe("[fg:#ff0000]red[/fg]");
	});

	test("background 16-color → [bg:red]", () => {
		const result = snapshot("\x1b[41mred bg\x1b[49m");
		expect(result).toBe("[bg:red]red bg[/bg]");
	});

	test("background 256-color → [bg:N]", () => {
		const result = snapshot("\x1b[48;5;21mbg\x1b[49m");
		expect(result).toBe("[bg:21]bg[/bg]");
	});

	test("background truecolor → [bg:#hex]", () => {
		const result = snapshot("\x1b[48;2;0;128;255mbg\x1b[49m");
		expect(result).toBe("[bg:#0080ff]bg[/bg]");
	});

	test("compound sequences split correctly", () => {
		const result = snapshot("\x1b[1;31mbold red\x1b[22;39m");
		expect(result).toBe("[bold][red]bold red[/bold][/fg]");
	});

	test("reset → [reset]", () => {
		const result = snapshot("\x1b[1mbold\x1b[0m");
		expect(result).toBe("[bold]bold[reset]");
	});

	test("empty params treated as reset", () => {
		const result = snapshot("\x1b[1mbold\x1b[m");
		expect(result).toBe("[bold]bold[reset]");
	});

	test("duration stripping: (1.2s) → (TIME)", () => {
		const result = snapshot("Completed (1.2s)");
		expect(result).toBe("Completed (TIME)");
	});

	test("duration stripping: (123ms) → (TIME)", () => {
		const result = snapshot("Took (123ms)");
		expect(result).toBe("Took (TIME)");
	});

	test("duration stripping: (0.5s) → (TIME)", () => {
		const result = snapshot("Done (0.5s)");
		expect(result).toBe("Done (TIME)");
	});

	test("date stripping: 2024-01-15 → (DATE)", () => {
		const result = snapshot("Created on 2024-01-15");
		expect(result).toBe("Created on (DATE)");
	});

	test("multiple dates stripped", () => {
		const result = snapshot("From 2024-01-01 to 2024-12-31");
		expect(result).toBe("From (DATE) to (DATE)");
	});

	test("plain text passes through unchanged (no volatile content)", () => {
		const result = snapshot("hello world");
		expect(result).toBe("hello world");
	});

	test("bold + dim both open, 22 closes both", () => {
		const result = snapshot("\x1b[1m\x1b[2mboth\x1b[22m");
		expect(result).toBe("[bold][dim]both[/bold][/dim]");
	});

	test("nested styles", () => {
		const result = snapshot("\x1b[1mbold \x1b[3mand italic\x1b[23m still bold\x1b[22m");
		expect(result).toBe("[bold]bold [italic]and italic[/italic] still bold[/bold]");
	});

	test("bright foreground colors", () => {
		const result = snapshot("\x1b[91mbright red\x1b[39m");
		expect(result).toBe("[brightRed]bright red[/fg]");
	});

	test("bright background colors", () => {
		const result = snapshot("\x1b[101mbright red bg\x1b[49m");
		expect(result).toBe("[bg:brightRed]bright red bg[/bg]");
	});
});

// ─── compareOutput() ────────────────────────────────────────────────────────

describe("compareOutput()", () => {
	test("identical strings: equal true, no differences", () => {
		const result = compareOutput("hello", "hello");
		expect(result.equal).toBe(true);
		expect(result.differences).toEqual([]);
	});

	test("identical multi-line strings", () => {
		const result = compareOutput("a\nb\nc", "a\nb\nc");
		expect(result.equal).toBe(true);
		expect(result.differences).toEqual([]);
	});

	test("different lines: reports correct line number and content", () => {
		const result = compareOutput("a\nX\nc", "a\nY\nc");
		expect(result.equal).toBe(false);
		expect(result.differences).toEqual([{ line: 2, expected: "Y", actual: "X" }]);
	});

	test("multiple differences", () => {
		const result = compareOutput("a\nb\nc", "X\nb\nZ");
		expect(result.equal).toBe(false);
		expect(result.differences).toHaveLength(2);
		expect(result.differences[0]).toEqual({ line: 1, expected: "X", actual: "a" });
		expect(result.differences[1]).toEqual({ line: 3, expected: "Z", actual: "c" });
	});

	test("ignores ANSI differences", () => {
		const result = compareOutput("\x1b[31mhello\x1b[39m", "\x1b[32mhello\x1b[39m");
		expect(result.equal).toBe(true);
	});

	test("detects content differences even with ANSI", () => {
		const result = compareOutput("\x1b[31mfoo\x1b[39m", "\x1b[31mbar\x1b[39m");
		expect(result.equal).toBe(false);
		expect(result.differences).toEqual([{ line: 1, expected: "bar", actual: "foo" }]);
	});

	test("different line counts: actual has more lines", () => {
		const result = compareOutput("a\nb\nc", "a\nb");
		expect(result.equal).toBe(false);
		expect(result.differences).toEqual([{ line: 3, expected: "", actual: "c" }]);
	});

	test("different line counts: expected has more lines", () => {
		const result = compareOutput("a", "a\nb");
		expect(result.equal).toBe(false);
		expect(result.differences).toEqual([{ line: 2, expected: "b", actual: "" }]);
	});

	test("empty strings are equal", () => {
		const result = compareOutput("", "");
		expect(result.equal).toBe(true);
		expect(result.differences).toEqual([]);
	});

	test("empty vs non-empty", () => {
		const result = compareOutput("", "hello");
		expect(result.equal).toBe(false);
		expect(result.differences).toEqual([{ line: 1, expected: "hello", actual: "" }]);
	});

	test("ANSI-only vs empty: both are visually empty", () => {
		const result = compareOutput("\x1b[31m\x1b[39m", "");
		expect(result.equal).toBe(true);
	});
});
