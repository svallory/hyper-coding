import { describe, expect, it } from "vitest";
import { escapeControlCharacters, quoteForTerminal } from "#lib/terminal-text";
import { quoteChildOutput } from "#services/space-git";
import { SpaceIncomingError } from "#services/space-incoming";

/** Anything a terminal would act on or reorder, as raw text. */
function hasRawHazard(text: string): boolean {
	return /[\p{Cc}\p{Cf}]/u.test(text) || text.includes(" ") || text.includes(" ");
}

describe("escapeControlCharacters: the one rule for text output", () => {
	it.each([
		["ESC", "a\u001b[31mb", "a\\u001b[31mb"],
		["C1 CSI", "a\u009b2Jb", "a\\u009b2Jb"],
		["DEL", "a\u007fb", "a\\u007fb"],
		["bidi override", "a‮b", "a\\u202eb"],
		["zero-width joiner", "a‍b", "a\\u200db"],
		["line separator", "a b", "a\\u2028b"],
		["paragraph separator", "a b", "a\\u2029b"],
		["newline", "a\nb", "a\\u000ab"],
		// Astral: braces, so U+E0001 cannot read as `` followed by `1`.
		["astral tag character", "a\u{e0001}b", "a\\u{e0001}b"],
		// A literal backslash is escaped too, so the output is unambiguous.
		["literal backslash", "a\\u202eb", "a\\\\u202eb"],
		["plain text", "notes/café.md", "notes/café.md"],
	])("%s", (_name, raw, expected) => {
		const escaped = escapeControlCharacters(raw);
		expect(escaped).toBe(expected);
		expect(hasRawHazard(escaped)).toBe(false);
	});
	it("keeps a real U+202E and a literal `\\u202e` apart", () => {
		expect(escapeControlCharacters("a‮b")).not.toBe(escapeControlCharacters("a\\u202eb"));
	});
	it("quotes with plain double quotes, never through JSON.stringify", () => {
		// JSON.stringify would double the backslash of every escape it is given.
		expect(quoteForTerminal("bin/a‮gnp.sh")).toBe('"bin/a\\u202egnp.sh"');
	});
	it("escapes the path inside an incoming refusal", () => {
		for (const path of ["bin/b\u009b2Jx", "bin/c\u007f", "bin/d‮"]) {
			const { message } = new SpaceIncomingError(path, "contains a terminal control character");
			expect(hasRawHazard(message), path).toBe(false);
			expect(message, path).toContain(quoteForTerminal(path));
		}
	});
});

describe("quoteChildOutput truncation", () => {
	it("cuts on code points, never inside a surrogate pair", () => {
		// 1,999 ASCII characters, then astral characters: a UTF-16 cut at 2,000
		// units would leave half of the first pair before the marker.
		const quoted = quoteChildOutput(`${"x".repeat(1_999)}${"\u{1f600}".repeat(10)}`);
		expect(quoted).toContain("… [truncated]");
		expect(quoted.isWellFormed()).toBe(true);
		expect(quoted.endsWith("x\u{1f600}… [truncated]")).toBe(true);
	});
});
