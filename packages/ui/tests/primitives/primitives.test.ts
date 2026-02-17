import { beforeEach, describe, expect, test } from "vitest";
import { align } from "#primitives/align";
import { badge } from "#primitives/badge";
import { border } from "#primitives/border";
import { createContext, setContext } from "#primitives/context";
import { divider } from "#primitives/divider";
import { indent } from "#primitives/indent";
import { line } from "#primitives/line";
import { pad } from "#primitives/pad";
import { stack } from "#primitives/stack";
import { styledText } from "#primitives/styledText";
import { symbol } from "#primitives/symbol";
import { truncate } from "#primitives/truncate";
import { wrap } from "#primitives/wrap";
import { stringWidth, stripAnsi } from "#render/index";

// ---------------------------------------------------------------------------
// Context fixtures
// ---------------------------------------------------------------------------

const fullCtx = createContext({
	colorDepth: "truecolor",
	unicode: true,
	isDumb: false,
	noColor: false,
	columns: 80,
});

const noColorCtx = createContext({
	colorDepth: "none",
	unicode: true,
	isDumb: false,
	noColor: true,
	columns: 80,
});

const asciiCtx = createContext({
	colorDepth: "16",
	unicode: false,
	isDumb: false,
	noColor: false,
	columns: 80,
});

const dumbCtx = createContext({
	colorDepth: "none",
	unicode: false,
	isDumb: true,
	noColor: false,
	columns: 80,
});

// ---------------------------------------------------------------------------
// styledText
// ---------------------------------------------------------------------------

describe("styledText", () => {
	test("applies color and bold in full-color context", () => {
		setContext(fullCtx);
		const result = styledText("hello", { color: "error", bold: true });
		expect(result).toContain("\x1b[");
		expect(result).toContain("hello");
		expect(stripAnsi(result)).toBe("hello");
	});

	test("applies bold without color value in truecolor", () => {
		setContext(fullCtx);
		const result = styledText("test", { bold: true });
		expect(result).toContain("\x1b[1m");
		expect(stripAnsi(result)).toBe("test");
	});

	test("respects noColor: strips color but keeps bold", () => {
		setContext(noColorCtx);
		const result = styledText("warn", { color: "warning", bold: true });
		// Should have bold but no color codes
		expect(result).toContain("\x1b[1m");
		expect(stripAnsi(result)).toBe("warn");
		// Should NOT contain color escape for warning
		// In noColor mode, color is not set, so only bold attribute is present
	});

	test("respects noColor: italic is preserved", () => {
		setContext(noColorCtx);
		const result = styledText("note", { color: "info", italic: true });
		expect(result).toContain("\x1b[3m");
		expect(stripAnsi(result)).toBe("note");
	});

	test("isDumb returns plain text with no escapes", () => {
		setContext(dumbCtx);
		const result = styledText("plain", { color: "error", bold: true, underline: true });
		expect(result).toBe("plain");
	});

	test("background color is applied", () => {
		setContext(fullCtx);
		const result = styledText("bg", { bg: "bgError" });
		expect(result).toContain("\x1b[");
		expect(stripAnsi(result)).toBe("bg");
	});

	test("empty style returns unmodified text", () => {
		setContext(fullCtx);
		const result = styledText("raw", {});
		// applyStyle with no attributes returns the text as-is (no open/close)
		expect(result).toBe("raw");
	});
});

// ---------------------------------------------------------------------------
// symbol
// ---------------------------------------------------------------------------

describe("symbol", () => {
	test("returns unicode glyph in unicode context", () => {
		setContext(fullCtx);
		expect(symbol("success")).toBe("\u2713"); // ✓
		expect(symbol("error")).toBe("\u2717"); // ✗
		expect(symbol("bullet")).toBe("\u2022"); // •
		expect(symbol("ellipsis")).toBe("\u2026"); // …
	});

	test("returns ascii glyph in ascii context", () => {
		setContext(asciiCtx);
		expect(symbol("success")).toBe("[OK]");
		expect(symbol("error")).toBe("[FAIL]");
		expect(symbol("bullet")).toBe("*");
		expect(symbol("ellipsis")).toBe("...");
	});

	test("returns ascii in dumb context", () => {
		setContext(dumbCtx);
		expect(symbol("arrowRight")).toBe("->");
	});
});

// ---------------------------------------------------------------------------
// pad
// ---------------------------------------------------------------------------

describe("pad", () => {
	test("left padding", () => {
		expect(pad("x", { left: 3 })).toBe("   x");
	});

	test("right padding", () => {
		expect(pad("x", { right: 3 })).toBe("x   ");
	});

	test("both sides", () => {
		expect(pad("x", { left: 2, right: 2 })).toBe("  x  ");
	});

	test("custom fill character", () => {
		expect(pad("x", { left: 3, char: "." })).toBe("...x");
	});

	test("no options returns unchanged", () => {
		expect(pad("hello")).toBe("hello");
	});

	test("zero padding returns unchanged", () => {
		expect(pad("hello", { left: 0, right: 0 })).toBe("hello");
	});
});

// ---------------------------------------------------------------------------
// truncate
// ---------------------------------------------------------------------------

describe("truncate", () => {
	test("no-op when text fits", () => {
		setContext(fullCtx);
		expect(truncate("hello", 10)).toBe("hello");
	});

	test("end truncation with unicode ellipsis", () => {
		setContext(fullCtx);
		const result = truncate("hello world", 8);
		expect(stringWidth(result)).toBeLessThanOrEqual(8);
		expect(result).toContain("\u2026"); // …
	});

	test("end truncation with custom ellipsis", () => {
		setContext(fullCtx);
		const result = truncate("hello world", 8, { ellipsis: "..." });
		expect(stringWidth(result)).toBeLessThanOrEqual(8);
		expect(result).toContain("...");
	});

	test("start truncation", () => {
		setContext(fullCtx);
		const result = truncate("hello world", 8, { position: "start" });
		expect(stringWidth(result)).toBeLessThanOrEqual(8);
		expect(result).toContain("\u2026");
		// Should keep the end of the string
		expect(result).toContain("world");
	});

	test("middle truncation", () => {
		setContext(fullCtx);
		const result = truncate("hello world", 8, { position: "middle" });
		expect(stringWidth(result)).toBeLessThanOrEqual(8);
		expect(result).toContain("\u2026");
		// Should contain start and end fragments
		expect(result.startsWith("hel")).toBe(true);
		expect(result.endsWith("ld")).toBe(true);
	});

	test("uses ascii ellipsis in ascii context", () => {
		setContext(asciiCtx);
		const result = truncate("hello world", 8);
		expect(result).toContain("...");
		expect(stringWidth(result)).toBeLessThanOrEqual(8);
	});

	test("returns text unchanged when exactly at maxWidth", () => {
		setContext(fullCtx);
		expect(truncate("hello", 5)).toBe("hello");
	});
});

// ---------------------------------------------------------------------------
// align
// ---------------------------------------------------------------------------

describe("align", () => {
	test("left alignment (default)", () => {
		const result = align("hi", 10);
		expect(result).toBe("hi        ");
		expect(stringWidth(result)).toBe(10);
	});

	test("right alignment", () => {
		const result = align("hi", 10, { alignment: "right" });
		expect(result).toBe("        hi");
		expect(stringWidth(result)).toBe(10);
	});

	test("center alignment", () => {
		const result = align("hi", 10, { alignment: "center" });
		expect(result).toBe("    hi    ");
		expect(stringWidth(result)).toBe(10);
	});

	test("custom fill character", () => {
		const result = align("hi", 10, { alignment: "center", fill: "." });
		expect(result).toBe("....hi....");
	});

	test("no padding if text is already wider", () => {
		const result = align("hello world", 5);
		expect(result).toBe("hello world");
	});
});

// ---------------------------------------------------------------------------
// line
// ---------------------------------------------------------------------------

describe("line", () => {
	test("simple string concatenation", () => {
		expect(line("hello", " ", "world")).toBe("hello world");
	});

	test("column-width parts", () => {
		const result = line(["Name", 20], ["Age", 5]);
		expect(result).toBe("Name                Age  ");
		expect(stringWidth(result)).toBe(25);
	});

	test("mixed parts", () => {
		const result = line("> ", ["status", 10], " ok");
		expect(result).toBe("> status     ok");
	});

	test("empty parts", () => {
		expect(line()).toBe("");
	});
});

// ---------------------------------------------------------------------------
// stack
// ---------------------------------------------------------------------------

describe("stack", () => {
	test("basic join", () => {
		expect(stack(["a", "b", "c"])).toBe("a\nb\nc");
	});

	test("spacing adds blank lines", () => {
		expect(stack(["a", "b"], { spacing: 1 })).toBe("a\n\nb");
	});

	test("spacing of 2 adds two blank lines", () => {
		expect(stack(["a", "b"], { spacing: 2 })).toBe("a\n\n\nb");
	});

	test("prefix prepended to each line", () => {
		expect(stack(["a", "b"], { prefix: "> " })).toBe("> a\n> b");
	});

	test("prefix with spacing", () => {
		expect(stack(["a", "b"], { prefix: "| ", spacing: 1 })).toBe("| a\n\n| b");
	});

	test("single line", () => {
		expect(stack(["only"])).toBe("only");
	});

	test("empty array", () => {
		expect(stack([])).toBe("");
	});
});

// ---------------------------------------------------------------------------
// indent
// ---------------------------------------------------------------------------

describe("indent", () => {
	test("single line default level", () => {
		setContext(fullCtx); // indent = 2
		expect(indent("hello")).toBe("  hello");
	});

	test("multi-line", () => {
		setContext(fullCtx);
		expect(indent("a\nb\nc")).toBe("  a\n  b\n  c");
	});

	test("custom level", () => {
		setContext(fullCtx);
		expect(indent("x", 3)).toBe("      x"); // 3 * 2 = 6 spaces
	});

	test("level 0 adds no indent", () => {
		setContext(fullCtx);
		expect(indent("x", 0)).toBe("x");
	});

	test("respects token indent size", () => {
		// Default token indent is 2
		setContext(fullCtx);
		const result = indent("test", 2);
		expect(result).toBe("    test"); // 2 * 2 = 4 spaces
	});
});

// ---------------------------------------------------------------------------
// wrap
// ---------------------------------------------------------------------------

describe("wrap", () => {
	test("wraps at specified width", () => {
		setContext(fullCtx);
		const text = "hello world foo bar";
		const result = wrap(text, 12);
		const lines = result.split("\n");
		expect(lines.length).toBeGreaterThan(1);
		for (const l of lines) {
			expect(stringWidth(l)).toBeLessThanOrEqual(12);
		}
	});

	test("uses layout.maxWidth as default", () => {
		setContext(fullCtx);
		// maxWidth is 100 in defaults; short text should not wrap
		const text = "short text";
		expect(wrap(text)).toBe("short text");
	});

	test("hard wrap breaks mid-word", () => {
		setContext(fullCtx);
		const text = "abcdefghij";
		const result = wrap(text, 5, { hard: true });
		const lines = result.split("\n");
		expect(lines.length).toBe(2);
		expect(lines[0]).toBe("abcde");
		expect(lines[1]).toBe("fghij");
	});

	test("preserves existing newlines", () => {
		setContext(fullCtx);
		const text = "line one\nline two";
		const result = wrap(text, 100);
		expect(result).toBe("line one\nline two");
	});
});

// ---------------------------------------------------------------------------
// border
// ---------------------------------------------------------------------------

describe("border", () => {
	test("basic box with unicode", () => {
		setContext(fullCtx);
		const result = border("Hello");
		const lines = result.split("\n");
		expect(lines.length).toBe(3); // top + content + bottom
		// Top should have rounded corners
		expect(lines[0]!.startsWith("\u256D")).toBe(true); // ╭
		expect(lines[0]!.endsWith("\u256E")).toBe(true); // ╮
		// Content line has vertical bars
		expect(lines[1]!.startsWith("\u2502")).toBe(true); // │
		expect(lines[1]!.endsWith("\u2502")).toBe(true);
		// Bottom
		expect(lines[2]!.startsWith("\u2570")).toBe(true); // ╰
		expect(lines[2]!.endsWith("\u256F")).toBe(true); // ╯
		// Content should contain the text
		expect(stripAnsi(lines[1]!)).toContain("Hello");
	});

	test("with title", () => {
		setContext(fullCtx);
		const result = border("Content", { title: "Title" });
		const lines = result.split("\n");
		expect(lines[0]).toContain("Title");
	});

	test("ascii fallback", () => {
		setContext(asciiCtx);
		const result = border("Hello");
		const lines = result.split("\n");
		expect(lines[0]!.startsWith("+")).toBe(true);
		expect(lines[0]).toContain("-");
		expect(lines[1]).toContain("|");
		expect(lines[2]!.startsWith("+")).toBe(true);
	});

	test("explicit style override", () => {
		setContext(fullCtx);
		const result = border("X", { style: "double" });
		const lines = result.split("\n");
		expect(lines[0]!.startsWith("\u2554")).toBe(true); // ╔
	});

	test("multi-line content", () => {
		setContext(fullCtx);
		const result = border(["line1", "line2"]);
		const lines = result.split("\n");
		expect(lines.length).toBe(4); // top + 2 content + bottom
	});

	test("custom padding", () => {
		setContext(fullCtx);
		const result = border("Hi", { padding: 3 });
		const lines = result.split("\n");
		// Content line should have 3 spaces of padding on each side
		const contentLine = lines[1]!;
		// After the vertical bar, there should be 3 spaces before 'Hi'
		expect(contentLine).toContain("   Hi   ");
	});

	test("explicit width", () => {
		setContext(fullCtx);
		const result = border("Hi", { width: 20 });
		const lines = result.split("\n");
		// Total width of top line should be 20
		expect(stringWidth(lines[0]!)).toBe(20);
	});

	test("title alignment center", () => {
		setContext(fullCtx);
		const result = border("X", { title: "T", titleAlign: "center", width: 20 });
		const topLine = result.split("\n")[0]!;
		// Title should be roughly centered
		const idx = topLine.indexOf(" T ");
		expect(idx).toBeGreaterThan(2);
	});

	test("title alignment right", () => {
		setContext(fullCtx);
		const result = border("X", { title: "T", titleAlign: "right", width: 20 });
		const topLine = result.split("\n")[0]!;
		const idx = topLine.indexOf(" T ");
		// Should be closer to the right side
		expect(idx).toBeGreaterThan(5);
	});
});

// ---------------------------------------------------------------------------
// divider
// ---------------------------------------------------------------------------

describe("divider", () => {
	test("line style with unicode", () => {
		setContext(fullCtx);
		const result = divider({ width: 20, style: "line" });
		expect(result).toBe("\u2500".repeat(20));
	});

	test("dashed style with unicode", () => {
		setContext(fullCtx);
		const result = divider({ width: 10, style: "dashed" });
		expect(result).toBe("\u254C".repeat(10));
	});

	test("heavy style with unicode", () => {
		setContext(fullCtx);
		const result = divider({ width: 10, style: "heavy" });
		expect(result).toBe("\u2501".repeat(10));
	});

	test("blank returns empty string", () => {
		setContext(fullCtx);
		expect(divider({ style: "blank" })).toBe("");
	});

	test("ascii fallback", () => {
		setContext(asciiCtx);
		const result = divider({ width: 10, style: "line" });
		expect(result).toBe("-".repeat(10));
	});

	test("heavy in ascii uses =", () => {
		setContext(asciiCtx);
		const result = divider({ width: 10, style: "heavy" });
		expect(result).toBe("=".repeat(10));
	});

	test("with title (left)", () => {
		setContext(fullCtx);
		const result = divider({ width: 20, title: "Hi" });
		expect(result).toContain(" Hi ");
		expect(stringWidth(result)).toBe(20);
		// Should start with ── (two horizontal chars)
		expect(result.startsWith("\u2500\u2500")).toBe(true);
	});

	test("with title (center)", () => {
		setContext(fullCtx);
		const result = divider({ width: 20, title: "Hi", titleAlign: "center" });
		expect(result).toContain(" Hi ");
		expect(stringWidth(result)).toBe(20);
	});

	test("with title (right)", () => {
		setContext(fullCtx);
		const result = divider({ width: 20, title: "Hi", titleAlign: "right" });
		expect(result).toContain(" Hi ");
		expect(stringWidth(result)).toBe(20);
		// Should end with ── (two horizontal chars)
		expect(result.endsWith("\u2500\u2500")).toBe(true);
	});

	test("default width uses columns", () => {
		setContext(fullCtx); // columns = 80
		const result = divider({ style: "line" });
		expect(stringWidth(result)).toBe(80);
	});
});

// ---------------------------------------------------------------------------
// badge
// ---------------------------------------------------------------------------

describe("badge", () => {
	test("with color: applies bg and pads", () => {
		setContext(fullCtx);
		const result = badge("OK");
		expect(result).toContain("\x1b[");
		expect(stripAnsi(result)).toBe(" OK ");
	});

	test("noColor: brackets", () => {
		setContext(noColorCtx);
		expect(badge("OK")).toBe("[OK]");
	});

	test("isDumb: plain brackets", () => {
		setContext(dumbCtx);
		expect(badge("ERROR")).toBe("[ERROR]");
	});

	test("custom color", () => {
		setContext(fullCtx);
		const result = badge("WARN", { color: "bgWarning" });
		expect(result).toContain("\x1b[");
		expect(stripAnsi(result)).toBe(" WARN ");
	});

	test("custom text color", () => {
		setContext(fullCtx);
		const result = badge("X", { textColor: "fg" });
		expect(result).toContain("\x1b[");
		expect(stripAnsi(result)).toBe(" X ");
	});

	test("colorDepth none without noColor flag still uses brackets", () => {
		const ctx = createContext({ colorDepth: "none", noColor: false, isDumb: false });
		setContext(ctx);
		expect(badge("TEST")).toBe("[TEST]");
	});
});

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

describe("composition", () => {
	test("indent(stack([line(symbol, text)]))", () => {
		setContext(fullCtx);
		const result = indent(stack([line(symbol("success"), " Done")]));
		expect(result).toBe("  \u2713 Done"); // 2 spaces indent + ✓ + ' Done'
	});

	test("border around stacked lines", () => {
		setContext(fullCtx);
		const content = stack([
			line(symbol("success"), " Tests passed"),
			line(symbol("info"), " Coverage: 100%"),
		]);
		const result = border(content);
		const lines = result.split("\n");
		// top + 2 content lines + bottom
		expect(lines.length).toBe(4);
		expect(stripAnsi(lines[1]!)).toContain("\u2713 Tests passed");
		expect(stripAnsi(lines[2]!)).toContain("\u2139 Coverage: 100%");
	});

	test("divider + stack + indent", () => {
		setContext(fullCtx);
		const result = stack([
			divider({ width: 30, style: "line" }),
			indent(stack(["Item 1", "Item 2"])),
			divider({ width: 30, style: "line" }),
		]);
		const lines = result.split("\n");
		expect(lines.length).toBe(4);
		expect(lines[0]).toBe("\u2500".repeat(30));
		expect(lines[1]).toBe("  Item 1");
		expect(lines[2]).toBe("  Item 2");
		expect(lines[3]).toBe("\u2500".repeat(30));
	});

	test("ascii composition", () => {
		setContext(asciiCtx);
		const result = indent(
			stack([line(symbol("success"), " Done"), line(symbol("error"), " Failed")]),
		);
		const lines = result.split("\n");
		expect(lines[0]).toBe("  [OK] Done");
		expect(lines[1]).toBe("  [FAIL] Failed");
	});
});
