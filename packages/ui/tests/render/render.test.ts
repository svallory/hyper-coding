import { describe, expect, it } from "vitest";
import {
	ansiPad,
	ansiSlice,
	ansiTruncate,
	ansiWrap,
	applyStyle,
	charWidth,
	sgrClose,
	sgrOpen,
	stringWidth,
	stripAnsi,
	stripColor,
} from "../../src/render/index.ts";
import type { StyleSpec } from "../../src/render/index.ts";

// =============================================================================
// SGR Tests
// =============================================================================

describe("SGR Code Generation", () => {
	describe("sgrOpen", () => {
		it("generates bold code", () => {
			expect(sgrOpen({ bold: true })).toBe("\x1b[1m");
		});

		it("generates dim code", () => {
			expect(sgrOpen({ dim: true })).toBe("\x1b[2m");
		});

		it("generates italic code", () => {
			expect(sgrOpen({ italic: true })).toBe("\x1b[3m");
		});

		it("generates underline code", () => {
			expect(sgrOpen({ underline: true })).toBe("\x1b[4m");
		});

		it("generates inverse code", () => {
			expect(sgrOpen({ inverse: true })).toBe("\x1b[7m");
		});

		it("generates strikethrough code", () => {
			expect(sgrOpen({ strikethrough: true })).toBe("\x1b[9m");
		});

		it("maps 16-color foreground names correctly", () => {
			expect(sgrOpen({ color: "red" })).toBe("\x1b[31m");
			expect(sgrOpen({ color: "green" })).toBe("\x1b[32m");
			expect(sgrOpen({ color: "yellow" })).toBe("\x1b[33m");
			expect(sgrOpen({ color: "blue" })).toBe("\x1b[34m");
			expect(sgrOpen({ color: "magenta" })).toBe("\x1b[35m");
			expect(sgrOpen({ color: "cyan" })).toBe("\x1b[36m");
			expect(sgrOpen({ color: "white" })).toBe("\x1b[37m");
			expect(sgrOpen({ color: "black" })).toBe("\x1b[30m");
		});

		it("maps 16-color background names correctly", () => {
			expect(sgrOpen({ bg: "red" })).toBe("\x1b[41m");
			expect(sgrOpen({ bg: "green" })).toBe("\x1b[42m");
			expect(sgrOpen({ bg: "blue" })).toBe("\x1b[44m");
			expect(sgrOpen({ bg: "black" })).toBe("\x1b[40m");
		});

		it("generates 256-color foreground sequence", () => {
			expect(sgrOpen({ color: "196" })).toBe("\x1b[38;5;196m");
		});

		it("generates 256-color background sequence", () => {
			expect(sgrOpen({ bg: "33" })).toBe("\x1b[48;5;33m");
		});

		it("generates truecolor foreground from hex", () => {
			expect(sgrOpen({ color: "#ff0000" })).toBe("\x1b[38;2;255;0;0m");
		});

		it("generates truecolor background from hex", () => {
			expect(sgrOpen({ bg: "#00ff00" })).toBe("\x1b[48;2;0;255;0m");
		});

		it("handles shorthand hex (#RGB)", () => {
			expect(sgrOpen({ color: "#f00" })).toBe("\x1b[38;2;255;0;0m");
		});

		it("composes bold + red + underline into a single sequence", () => {
			const result = sgrOpen({ bold: true, color: "red", underline: true });
			expect(result).toBe("\x1b[1;4;31m");
		});

		it("composes multiple attributes and colors", () => {
			const result = sgrOpen({ bold: true, dim: true, color: "blue", bg: "yellow" });
			expect(result).toBe("\x1b[1;2;34;43m");
		});

		it('treats "dim" as color value as an attribute', () => {
			expect(sgrOpen({ color: "dim" })).toBe("\x1b[2m");
		});

		it('treats "bold" as color value as an attribute', () => {
			expect(sgrOpen({ color: "bold" })).toBe("\x1b[1m");
		});

		it("returns empty string for null color", () => {
			expect(sgrOpen({ color: null })).toBe("");
		});

		it("returns empty string for empty style", () => {
			expect(sgrOpen({})).toBe("");
		});

		it("returns empty string for all-false attributes", () => {
			expect(sgrOpen({ bold: false, dim: false })).toBe("");
		});
	});

	describe("sgrClose", () => {
		it("resets bold with code 22", () => {
			expect(sgrClose({ bold: true })).toBe("\x1b[22m");
		});

		it("resets dim with code 22", () => {
			expect(sgrClose({ dim: true })).toBe("\x1b[22m");
		});

		it("deduplicates shared reset code for bold+dim", () => {
			// Both bold and dim share reset code 22
			expect(sgrClose({ bold: true, dim: true })).toBe("\x1b[22m");
		});

		it("resets italic with code 23", () => {
			expect(sgrClose({ italic: true })).toBe("\x1b[23m");
		});

		it("resets underline with code 24", () => {
			expect(sgrClose({ underline: true })).toBe("\x1b[24m");
		});

		it("resets inverse with code 27", () => {
			expect(sgrClose({ inverse: true })).toBe("\x1b[27m");
		});

		it("resets strikethrough with code 29", () => {
			expect(sgrClose({ strikethrough: true })).toBe("\x1b[29m");
		});

		it("resets foreground color with code 39", () => {
			expect(sgrClose({ color: "red" })).toBe("\x1b[39m");
		});

		it("resets background color with code 49", () => {
			expect(sgrClose({ bg: "blue" })).toBe("\x1b[49m");
		});

		it("resets only what was set", () => {
			const result = sgrClose({ bold: true, color: "red", underline: true });
			expect(result).toBe("\x1b[22;24;39m");
		});

		it('resets attribute when "dim" used as color', () => {
			expect(sgrClose({ color: "dim" })).toBe("\x1b[22m");
		});

		it('resets attribute when "bold" used as color', () => {
			expect(sgrClose({ color: "bold" })).toBe("\x1b[22m");
		});

		it("returns empty string for empty style", () => {
			expect(sgrClose({})).toBe("");
		});

		it("returns empty string for null values", () => {
			expect(sgrClose({ color: null, bg: null })).toBe("");
		});
	});

	describe("applyStyle", () => {
		it("wraps text with open and close sequences", () => {
			const result = applyStyle("hello", { bold: true });
			expect(result).toBe("\x1b[1mhello\x1b[22m");
		});

		it("applies color and attribute together", () => {
			const result = applyStyle("world", { color: "red", underline: true });
			expect(result).toBe("\x1b[4;31mworld\x1b[24;39m");
		});

		it("returns plain text when style is empty", () => {
			expect(applyStyle("text", {})).toBe("text");
		});

		it("applies truecolor correctly", () => {
			const result = applyStyle("hi", { color: "#ff8800" });
			expect(result).toBe("\x1b[38;2;255;136;0mhi\x1b[39m");
		});

		it("applies 256-color correctly", () => {
			const result = applyStyle("hi", { color: "42" });
			expect(result).toBe("\x1b[38;5;42mhi\x1b[39m");
		});
	});
});

// =============================================================================
// Strip Tests
// =============================================================================

describe("Strip Functions", () => {
	describe("stripAnsi", () => {
		it("removes SGR color codes", () => {
			expect(stripAnsi("\x1b[31mred\x1b[0m")).toBe("red");
		});

		it("removes multiple ANSI codes", () => {
			expect(stripAnsi("\x1b[1m\x1b[31mbold red\x1b[0m")).toBe("bold red");
		});

		it("removes cursor movement sequences", () => {
			expect(stripAnsi("\x1b[2Ahello\x1b[10B")).toBe("hello");
		});

		it("removes erase and other sequences", () => {
			expect(stripAnsi("\x1b[2Jclear\x1b[K")).toBe("clear");
		});

		it("handles string with no ANSI codes", () => {
			expect(stripAnsi("plain text")).toBe("plain text");
		});

		it("handles empty string", () => {
			expect(stripAnsi("")).toBe("");
		});

		it("handles nested styles", () => {
			const input = "\x1b[1m\x1b[4m\x1b[31mnested\x1b[0m";
			expect(stripAnsi(input)).toBe("nested");
		});

		it("handles complex styled string", () => {
			const input = "\x1b[38;2;255;0;0mtruecolor \x1b[48;5;33m256bg\x1b[0m";
			expect(stripAnsi(input)).toBe("truecolor 256bg");
		});
	});

	describe("stripColor", () => {
		it("removes foreground color codes (30-37)", () => {
			expect(stripColor("\x1b[31mred\x1b[39m")).toBe("red");
		});

		it("removes background color codes (40-47)", () => {
			expect(stripColor("\x1b[41mredbg\x1b[49m")).toBe("redbg");
		});

		it("removes 256-color sequences (38;5;N)", () => {
			expect(stripColor("\x1b[38;5;196mcolor\x1b[39m")).toBe("color");
		});

		it("removes truecolor sequences (38;2;R;G;B)", () => {
			expect(stripColor("\x1b[38;2;255;0;0mcolor\x1b[39m")).toBe("color");
		});

		it("removes bright color codes (90-97, 100-107)", () => {
			expect(stripColor("\x1b[91mbright red\x1b[39m")).toBe("bright red");
			expect(stripColor("\x1b[101mbright bg\x1b[49m")).toBe("bright bg");
		});

		it("preserves bold (code 1)", () => {
			const result = stripColor("\x1b[1mbold\x1b[22m");
			expect(result).toBe("\x1b[1mbold\x1b[22m");
		});

		it("preserves dim (code 2)", () => {
			const result = stripColor("\x1b[2mdim\x1b[22m");
			expect(result).toBe("\x1b[2mdim\x1b[22m");
		});

		it("preserves italic (code 3)", () => {
			const result = stripColor("\x1b[3mitalic\x1b[23m");
			expect(result).toBe("\x1b[3mitalic\x1b[23m");
		});

		it("preserves underline (code 4)", () => {
			const result = stripColor("\x1b[4munderline\x1b[24m");
			expect(result).toBe("\x1b[4munderline\x1b[24m");
		});

		it("preserves strikethrough (code 9)", () => {
			const result = stripColor("\x1b[9mstrike\x1b[29m");
			expect(result).toBe("\x1b[9mstrike\x1b[29m");
		});

		it("strips color but keeps bold in combined sequence", () => {
			// \x1b[1;31m → bold(1) + red(31), should keep just bold
			const result = stripColor("\x1b[1;31mtext\x1b[22;39m");
			expect(result).toBe("\x1b[1mtext\x1b[22m");
		});

		it("preserves full reset sequence", () => {
			const result = stripColor("\x1b[0m");
			expect(result).toBe("\x1b[0m");
		});

		it("handles empty string", () => {
			expect(stripColor("")).toBe("");
		});

		it("handles string with no ANSI codes", () => {
			expect(stripColor("plain")).toBe("plain");
		});

		it("removes sequence entirely if only color codes", () => {
			expect(stripColor("\x1b[31;42m")).toBe("");
		});

		it("handles bg 256-color sequences (48;5;N)", () => {
			expect(stripColor("\x1b[48;5;33mcolor\x1b[49m")).toBe("color");
		});

		it("handles bg truecolor sequences (48;2;R;G;B)", () => {
			expect(stripColor("\x1b[48;2;0;255;0mcolor\x1b[49m")).toBe("color");
		});
	});
});

// =============================================================================
// Width Tests
// =============================================================================

describe("String Width", () => {
	describe("charWidth", () => {
		it("returns 1 for ASCII printable characters", () => {
			expect(charWidth("A".codePointAt(0)!)).toBe(1);
			expect(charWidth("z".codePointAt(0)!)).toBe(1);
			expect(charWidth(" ".codePointAt(0)!)).toBe(1);
			expect(charWidth("~".codePointAt(0)!)).toBe(1);
		});

		it("returns 0 for control characters", () => {
			expect(charWidth(0)).toBe(0); // NUL
			expect(charWidth(0x0a)).toBe(0); // LF
			expect(charWidth(0x1b)).toBe(0); // ESC
			expect(charWidth(0x7f)).toBe(0); // DEL
		});

		it("returns 2 for CJK Unified Ideographs", () => {
			expect(charWidth(0x4e2d)).toBe(2); // 中
			expect(charWidth(0x6587)).toBe(2); // 文
		});

		it("returns 2 for Hangul syllables", () => {
			expect(charWidth(0xac00)).toBe(2); // 가
		});

		it("returns 2 for Katakana", () => {
			expect(charWidth(0x30a2)).toBe(2); // ア
		});

		it("returns 2 for Hiragana", () => {
			expect(charWidth(0x3042)).toBe(2); // あ
		});

		it("returns 2 for fullwidth forms", () => {
			expect(charWidth(0xff21)).toBe(2); // Ａ (fullwidth A)
		});

		it("returns 2 for emoji in U+1F000-U+1FFFF", () => {
			expect(charWidth(0x1f600)).toBe(2); // 😀
			expect(charWidth(0x1f4a9)).toBe(2); // 💩
		});

		it("returns 0 for combining marks", () => {
			expect(charWidth(0x0300)).toBe(0); // Combining Grave Accent
			expect(charWidth(0x0308)).toBe(0); // Combining Diaeresis
		});

		it("returns 0 for zero-width joiner", () => {
			expect(charWidth(0x200d)).toBe(0);
		});

		it("returns 0 for variation selectors", () => {
			expect(charWidth(0xfe0f)).toBe(0); // VS16
			expect(charWidth(0xfe0e)).toBe(0); // VS15
		});

		it("returns 2 for CJK Symbols and Punctuation", () => {
			expect(charWidth(0x3000)).toBe(2); // Ideographic Space
			expect(charWidth(0x3001)).toBe(2); // Ideographic Comma
		});
	});

	describe("stringWidth", () => {
		it("returns length for plain ASCII", () => {
			expect(stringWidth("hello")).toBe(5);
			expect(stringWidth("abc123")).toBe(6);
		});

		it("returns 0 for empty string", () => {
			expect(stringWidth("")).toBe(0);
		});

		it("ignores ANSI escape sequences", () => {
			expect(stringWidth("\x1b[31mred\x1b[0m")).toBe(3);
		});

		it("ignores complex ANSI sequences", () => {
			expect(stringWidth("\x1b[1m\x1b[38;2;255;0;0mhello\x1b[0m")).toBe(5);
		});

		it("counts CJK characters as width 2", () => {
			expect(stringWidth("中文")).toBe(4);
			expect(stringWidth("日本語")).toBe(6);
		});

		it("counts emoji as width 2", () => {
			expect(stringWidth("😀")).toBe(2);
			expect(stringWidth("💩")).toBe(2);
		});

		it("handles mixed ASCII + CJK + ANSI", () => {
			// "hi中文" = 2 + 4 = 6, ANSI adds 0
			expect(stringWidth("hi\x1b[31m中文\x1b[0m")).toBe(6);
		});

		it("handles combining marks (zero width)", () => {
			// 'e' + combining acute accent = visual width 1
			expect(stringWidth("e\u0301")).toBe(1);
		});

		it("handles fullwidth characters", () => {
			// Ａ is fullwidth A
			expect(stringWidth("\uff21\uff22")).toBe(4);
		});

		it("handles strings with only ANSI codes", () => {
			expect(stringWidth("\x1b[31m\x1b[0m")).toBe(0);
		});
	});
});

// =============================================================================
// ANSI Utils Tests
// =============================================================================

describe("ANSI Utils", () => {
	describe("ansiTruncate", () => {
		it("returns string unchanged when it fits", () => {
			expect(ansiTruncate("hello", 10)).toBe("hello");
		});

		it("truncates plain text at correct width", () => {
			expect(ansiTruncate("hello world", 5)).toBe("hello");
		});

		it("truncates and appends ellipsis", () => {
			const result = ansiTruncate("hello world", 8, "...");
			// 8 - 3(ellipsis) = 5 chars: "hello" + "..."
			expect(stripAnsi(result)).toBe("hello...");
		});

		it("preserves ANSI styles in truncated output", () => {
			const input = "\x1b[31mhello world\x1b[0m";
			const result = ansiTruncate(input, 5);
			// Should contain the red code and truncated text
			expect(result).toContain("\x1b[31m");
			expect(stripAnsi(result)).toBe("hello");
		});

		it("closes open styles at cut point", () => {
			const input = "\x1b[1m\x1b[31mhello world\x1b[0m";
			const result = ansiTruncate(input, 5);
			// Should contain a reset after the text
			expect(result).toContain("\x1b[0m");
		});

		it("handles string that is exactly maxWidth", () => {
			expect(ansiTruncate("hello", 5)).toBe("hello");
		});

		it("returns empty when maxWidth is 0", () => {
			expect(ansiTruncate("hello", 0)).toBe("");
		});

		it("handles CJK characters in truncation", () => {
			// 中文 = width 4, truncating to 3 should give "中" (width 2) since 中文 doesn't fit
			const result = ansiTruncate("中文测试", 4);
			expect(stripAnsi(result)).toBe("中文");
		});

		it("no-op when string without ANSI fits", () => {
			const result = ansiTruncate("hi", 5);
			expect(result).toBe("hi");
		});
	});

	describe("ansiPad", () => {
		it("pads left-aligned by default", () => {
			expect(ansiPad("hi", 5)).toBe("hi   ");
		});

		it("pads right-aligned", () => {
			expect(ansiPad("hi", 5, "right")).toBe("   hi");
		});

		it("pads center-aligned", () => {
			const result = ansiPad("hi", 6, "center");
			expect(result).toBe("  hi  ");
		});

		it("pads center-aligned with odd padding", () => {
			const result = ansiPad("hi", 5, "center");
			// 5 - 2 = 3 padding, floor(3/2)=1 left, 2 right
			expect(result).toBe(" hi  ");
		});

		it("returns string unchanged when already at target width", () => {
			expect(ansiPad("hello", 5)).toBe("hello");
		});

		it("returns string unchanged when wider than target", () => {
			expect(ansiPad("hello world", 5)).toBe("hello world");
		});

		it("works with ANSI-styled strings", () => {
			const styled = "\x1b[31mhi\x1b[0m";
			const result = ansiPad(styled, 5);
			// Visual width of "hi" is 2, so 3 spaces of padding
			expect(stringWidth(result)).toBe(5);
			expect(result).toBe("\x1b[31mhi\x1b[0m   ");
		});

		it("pads CJK strings correctly", () => {
			// 中 is width 2, need 3 spaces to reach width 5
			const result = ansiPad("中", 5);
			expect(stringWidth(result)).toBe(5);
			expect(result).toBe("中   ");
		});
	});

	describe("ansiSlice", () => {
		it("slices plain text by visual position", () => {
			expect(ansiSlice("hello world", 0, 5)).toBe("hello");
		});

		it("slices from middle", () => {
			expect(ansiSlice("hello world", 6, 11)).toBe("world");
		});

		it("preserves styles active before slice start", () => {
			const input = "\x1b[31mhello world\x1b[0m";
			const result = ansiSlice(input, 6, 11);
			// Should re-apply the red style and reset at end
			expect(result).toContain("\x1b[31m");
			expect(stripAnsi(result)).toBe("world");
		});

		it("returns empty for zero-width slice", () => {
			expect(ansiSlice("hello", 3, 3)).toBe("");
		});

		it("slices to end when end is omitted", () => {
			expect(ansiSlice("hello", 2)).toBe("llo");
		});

		it("handles CJK characters", () => {
			// 中文测试 = positions 0-1, 2-3, 4-5, 6-7
			const result = ansiSlice("中文测试", 2, 6);
			expect(result).toBe("文测");
		});
	});

	describe("ansiWrap", () => {
		it("wraps at word boundaries", () => {
			const result = ansiWrap("hello world foo", 11);
			expect(result).toBe("hello world\nfoo");
		});

		it("does not wrap when string fits", () => {
			expect(ansiWrap("hello", 10)).toBe("hello");
		});

		it("hard-breaks mid-word when hard=true", () => {
			const result = ansiWrap("abcdefghij", 5, true);
			expect(result).toBe("abcde\nfghij");
		});

		it("carries ANSI styles across line breaks", () => {
			const input = "\x1b[31mhello world\x1b[0m";
			const result = ansiWrap(input, 5, true);
			const lines = result.split("\n");
			expect(lines.length).toBe(3);
			// First line should have the red open
			expect(lines[0]).toContain("\x1b[31m");
			// Subsequent lines should re-open the style
			expect(lines[1]).toContain("\x1b[31m");
		});

		it("preserves existing newlines", () => {
			const result = ansiWrap("hi\nthere", 20);
			expect(result).toBe("hi\nthere");
		});

		it("wraps multiple words correctly", () => {
			const result = ansiWrap("aa bb cc dd", 5);
			// "aa bb" fits in 5, "cc dd" fits in 5
			expect(result).toBe("aa bb\ncc dd");
		});

		it("handles single word longer than maxWidth in soft mode", () => {
			// In soft wrap mode, a long word stays on its own line (no mid-word break)
			const result = ansiWrap("a longword b", 5);
			const lines = result.split("\n");
			// "a" then "longword" (can't break), then "b"
			expect(lines[0]).toBe("a");
			// longword doesn't fit in 5 but soft mode won't break it
		});

		it("hard wraps CJK characters", () => {
			// Each CJK char is width 2, so 3 chars = 6 wide, maxWidth 4 = 2 chars per line
			const result = ansiWrap("中文测", 4, true);
			const lines = result.split("\n");
			expect(lines.length).toBe(2);
			expect(lines[0]).toBe("中文");
			expect(lines[1]).toBe("测");
		});
	});
});
