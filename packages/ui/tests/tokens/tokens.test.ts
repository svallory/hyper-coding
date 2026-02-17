import { describe, expect, test } from "vitest";
import type { TerminalCapabilities } from "#capabilities/index";
import { defaultTokens } from "#tokens/defaults";
import { resolveColor, resolveSpinner, resolveSymbol, resolveTokens } from "#tokens/resolver";
import type {
	BorderCharSet,
	BorderStyleName,
	ColorTokenValue,
	ColorValue,
	SpinnerDefinition,
	SymbolPair,
	TokenSet,
} from "#tokens/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCaps(overrides: Partial<TerminalCapabilities> = {}): TerminalCapabilities {
	return {
		colorDepth: "16",
		unicode: true,
		isTTY: true,
		isStderrTTY: true,
		isCI: false,
		isDumb: false,
		noColor: false,
		forceColor: false,
		columns: 80,
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Default Token Set Completeness
// ---------------------------------------------------------------------------

describe("defaultTokens completeness", () => {
	test("top-level categories are all present", () => {
		expect(defaultTokens.color).toBeDefined();
		expect(defaultTokens.type).toBeDefined();
		expect(defaultTokens.space).toBeDefined();
		expect(defaultTokens.layout).toBeDefined();
		expect(defaultTokens.symbol).toBeDefined();
		expect(defaultTokens.border).toBeDefined();
		expect(defaultTokens.tree).toBeDefined();
		expect(defaultTokens.motion).toBeDefined();
	});

	test("all color tokens have values (no undefined)", () => {
		const colors = defaultTokens.color;
		const keys: Array<keyof typeof colors> = [
			"fg",
			"fgMuted",
			"error",
			"warning",
			"success",
			"info",
			"accent",
			"emphasis",
			"code",
			"heading",
			"bgError",
			"bgWarning",
			"bgSuccess",
			"bgInfo",
			"bgHighlight",
			"diffAdded",
			"diffRemoved",
			"diffContext",
			"diffHunk",
		];
		for (const key of keys) {
			expect(colors[key]).toBeDefined();
		}
	});

	test("all typography tokens have values", () => {
		const typo = defaultTokens.type;
		const keys: Array<keyof typeof typo> = [
			"emphasis",
			"strong",
			"deEmphasis",
			"code",
			"link",
			"deleted",
			"heading1",
			"heading2",
			"heading3",
			"label",
			"caption",
		];
		for (const key of keys) {
			expect(typo[key]).toBeDefined();
		}
	});

	test("all spacing tokens are non-negative integers", () => {
		for (const [key, value] of Object.entries(defaultTokens.space)) {
			expect(typeof value).toBe("number");
			expect(value).toBeGreaterThanOrEqual(0);
			expect(Number.isInteger(value)).toBe(true);
		}
	});

	test("all layout tokens are positive integers", () => {
		for (const [key, value] of Object.entries(defaultTokens.layout)) {
			expect(typeof value).toBe("number");
			expect(value).toBeGreaterThan(0);
			expect(Number.isInteger(value)).toBe(true);
		}
	});

	test("all symbol tokens have unicode and ascii values", () => {
		for (const [key, pair] of Object.entries(defaultTokens.symbol)) {
			const sp = pair as SymbolPair;
			expect(typeof sp.unicode).toBe("string");
			expect(typeof sp.ascii).toBe("string");
			expect(sp.unicode.length).toBeGreaterThan(0);
			expect(sp.ascii.length).toBeGreaterThan(0);
		}
	});

	test("all motion spinner definitions have unicode and ascii frames", () => {
		const spinners = [
			defaultTokens.motion.spinnerDots,
			defaultTokens.motion.spinnerLine,
			defaultTokens.motion.spinnerArc,
		];
		for (const spinner of spinners) {
			expect(Array.isArray(spinner.unicode)).toBe(true);
			expect(Array.isArray(spinner.ascii)).toBe(true);
			expect(spinner.unicode.length).toBeGreaterThan(0);
			expect(spinner.ascii.length).toBeGreaterThan(0);
		}
	});

	test("motion timing values are positive", () => {
		expect(defaultTokens.motion.spinnerInterval).toBeGreaterThan(0);
		expect(defaultTokens.motion.progressInterval).toBeGreaterThan(0);
	});

	test("progress symbols have unicode and ascii values", () => {
		const progressTokens = [
			defaultTokens.motion.progressFilled,
			defaultTokens.motion.progressPartial,
			defaultTokens.motion.progressHead,
		];
		for (const token of progressTokens) {
			expect(typeof token.unicode).toBe("string");
			expect(typeof token.ascii).toBe("string");
			expect(token.unicode.length).toBeGreaterThan(0);
			expect(token.ascii.length).toBeGreaterThan(0);
		}
	});
});

// ---------------------------------------------------------------------------
// Border Styles Completeness
// ---------------------------------------------------------------------------

describe("border styles", () => {
	const borderCharKeys: Array<keyof BorderCharSet> = [
		"topLeft",
		"topRight",
		"bottomLeft",
		"bottomRight",
		"horizontal",
		"vertical",
		"teeRight",
		"teeLeft",
		"teeDown",
		"teeUp",
		"cross",
	];

	const styleNames: BorderStyleName[] = ["rounded", "single", "double", "heavy", "dashed", "ascii"];

	test("all six border styles are defined", () => {
		for (const name of styleNames) {
			expect(defaultTokens.border.styles[name]).toBeDefined();
		}
	});

	for (const styleName of styleNames) {
		test(`${styleName} style has all 11 character set entries`, () => {
			const style = defaultTokens.border.styles[styleName];
			for (const charKey of borderCharKeys) {
				expect(typeof style[charKey]).toBe("string");
				expect(style[charKey].length).toBeGreaterThan(0);
			}
		});
	}

	test('default border style is "rounded"', () => {
		expect(defaultTokens.border.style).toBe("rounded");
	});

	test("ascii border uses only ASCII characters", () => {
		const ascii = defaultTokens.border.styles.ascii;
		for (const charKey of borderCharKeys) {
			for (const ch of ascii[charKey]) {
				expect(ch.charCodeAt(0)).toBeLessThan(128);
			}
		}
	});
});

// ---------------------------------------------------------------------------
// Tree Tokens
// ---------------------------------------------------------------------------

describe("tree tokens", () => {
	test("unicode tree set is defined with all keys", () => {
		const t = defaultTokens.tree.unicode;
		expect(typeof t.branch).toBe("string");
		expect(typeof t.last).toBe("string");
		expect(typeof t.vertical).toBe("string");
		expect(typeof t.indent).toBe("string");
	});

	test("ascii tree set is defined with all keys", () => {
		const t = defaultTokens.tree.ascii;
		expect(typeof t.branch).toBe("string");
		expect(typeof t.last).toBe("string");
		expect(typeof t.vertical).toBe("string");
		expect(typeof t.indent).toBe("string");
	});
});

// ---------------------------------------------------------------------------
// Color Resolution
// ---------------------------------------------------------------------------

describe("resolveColor", () => {
	const errorToken: ColorValue = { ansi16: "red", ansi256: 196, truecolor: "#f87171" };

	test("truecolor depth returns hex value", () => {
		const result = resolveColor(errorToken, makeCaps({ colorDepth: "truecolor" }));
		expect(result).toBe("#f87171");
	});

	test("256 depth returns ansi256 index as string", () => {
		const result = resolveColor(errorToken, makeCaps({ colorDepth: "256" }));
		expect(result).toBe("196");
	});

	test("16 depth returns ansi16 name", () => {
		const result = resolveColor(errorToken, makeCaps({ colorDepth: "16" }));
		expect(result).toBe("red");
	});

	test("none depth returns null", () => {
		const result = resolveColor(errorToken, makeCaps({ colorDepth: "none" }));
		expect(result).toBeNull();
	});

	test('attribute "dim" passes through at all depths', () => {
		for (const depth of ["none", "16", "256", "truecolor"] as const) {
			expect(resolveColor("dim", makeCaps({ colorDepth: depth }))).toBe("dim");
		}
	});

	test('attribute "bold" passes through at all depths', () => {
		for (const depth of ["none", "16", "256", "truecolor"] as const) {
			expect(resolveColor("bold", makeCaps({ colorDepth: depth }))).toBe("bold");
		}
	});

	test('attribute "default" passes through at all depths', () => {
		for (const depth of ["none", "16", "256", "truecolor"] as const) {
			expect(resolveColor("default", makeCaps({ colorDepth: depth }))).toBe("default");
		}
	});

	test("resolves all default color tokens without errors", () => {
		const caps = makeCaps({ colorDepth: "truecolor" });
		for (const [key, value] of Object.entries(defaultTokens.color)) {
			// Should not throw
			const resolved = resolveColor(value as ColorTokenValue, caps);
			expect(resolved).not.toBeUndefined();
		}
	});
});

// ---------------------------------------------------------------------------
// Symbol Resolution
// ---------------------------------------------------------------------------

describe("resolveSymbol", () => {
	const successSymbol: SymbolPair = { unicode: "\u2713", ascii: "[OK]" };

	test("unicode capable terminal gets unicode glyph", () => {
		expect(resolveSymbol(successSymbol, makeCaps({ unicode: true }))).toBe("\u2713");
	});

	test("ascii-only terminal gets ascii fallback", () => {
		expect(resolveSymbol(successSymbol, makeCaps({ unicode: false }))).toBe("[OK]");
	});

	test("resolves all default symbol tokens", () => {
		for (const [key, pair] of Object.entries(defaultTokens.symbol)) {
			const unicodeResult = resolveSymbol(pair as SymbolPair, makeCaps({ unicode: true }));
			const asciiResult = resolveSymbol(pair as SymbolPair, makeCaps({ unicode: false }));
			expect(typeof unicodeResult).toBe("string");
			expect(typeof asciiResult).toBe("string");
			expect(unicodeResult).toBe((pair as SymbolPair).unicode);
			expect(asciiResult).toBe((pair as SymbolPair).ascii);
		}
	});
});

// ---------------------------------------------------------------------------
// Spinner Resolution
// ---------------------------------------------------------------------------

describe("resolveSpinner", () => {
	const dotsSpinner: SpinnerDefinition = {
		unicode: [
			"\u280B",
			"\u2819",
			"\u2839",
			"\u2838",
			"\u283C",
			"\u2834",
			"\u2826",
			"\u2827",
			"\u2807",
			"\u280F",
		],
		ascii: ["-", "\\", "|", "/"],
	};

	test("unicode capable terminal gets unicode frames", () => {
		const frames = resolveSpinner(dotsSpinner, makeCaps({ unicode: true }));
		expect(frames).toEqual(dotsSpinner.unicode);
		expect(frames.length).toBe(10);
	});

	test("ascii-only terminal gets ascii frames", () => {
		const frames = resolveSpinner(dotsSpinner, makeCaps({ unicode: false }));
		expect(frames).toEqual(dotsSpinner.ascii);
		expect(frames.length).toBe(4);
	});

	test("all default spinners resolve without error", () => {
		const spinners = [
			defaultTokens.motion.spinnerDots,
			defaultTokens.motion.spinnerLine,
			defaultTokens.motion.spinnerArc,
		];
		for (const spinner of spinners) {
			const unicodeFrames = resolveSpinner(spinner, makeCaps({ unicode: true }));
			const asciiFrames = resolveSpinner(spinner, makeCaps({ unicode: false }));
			expect(Array.isArray(unicodeFrames)).toBe(true);
			expect(Array.isArray(asciiFrames)).toBe(true);
			expect(unicodeFrames.length).toBeGreaterThan(0);
			expect(asciiFrames.length).toBeGreaterThan(0);
		}
	});
});

// ---------------------------------------------------------------------------
// Full Token Resolution
// ---------------------------------------------------------------------------

describe("resolveTokens", () => {
	test("produces a complete resolved token set for truecolor + unicode", () => {
		const caps = makeCaps({ colorDepth: "truecolor", unicode: true });
		const resolved = resolveTokens(defaultTokens, caps);

		// Color
		expect(resolved.color.error).toBe("#f87171");
		expect(resolved.color.success).toBe("#4ade80");
		expect(resolved.color.warning).toBe("#fbbf24");
		expect(resolved.color.info).toBe("#38bdf8");
		expect(resolved.color.accent).toBe("#60a5fa");
		expect(resolved.color.code).toBe("#67e8f9");
		expect(resolved.color.emphasis).toBe("bold");
		expect(resolved.color.fg).toBe("default");
		expect(resolved.color.fgMuted).toBe("dim");

		// Symbols
		expect(resolved.symbol.success).toBe("\u2713");
		expect(resolved.symbol.error).toBe("\u2717");

		// Border
		expect(resolved.border.style).toBe("rounded");
		expect(resolved.border.chars.topLeft).toBe("\u256D");

		// Tree
		expect(resolved.tree.branch).toBe("\u251C\u2500\u2500");

		// Motion
		expect(resolved.motion.spinnerDots.length).toBe(10);
		expect(resolved.motion.progressFilled).toBe("\u2588");

		// Spacing and layout pass through unchanged
		expect(resolved.space).toEqual(defaultTokens.space);
		expect(resolved.layout).toEqual(defaultTokens.layout);
	});

	test("produces resolved tokens for no-color + ascii", () => {
		const caps = makeCaps({ colorDepth: "none", unicode: false });
		const resolved = resolveTokens(defaultTokens, caps);

		// Colors with actual color values resolve to null
		expect(resolved.color.error).toBeNull();
		expect(resolved.color.success).toBeNull();

		// Attribute-only colors still pass through
		expect(resolved.color.emphasis).toBe("bold");
		expect(resolved.color.fgMuted).toBe("dim");
		expect(resolved.color.fg).toBe("default");

		// Symbols use ASCII
		expect(resolved.symbol.success).toBe("[OK]");
		expect(resolved.symbol.error).toBe("[FAIL]");
		expect(resolved.symbol.warning).toBe("[WARN]");

		// Border forced to ascii
		expect(resolved.border.style).toBe("ascii");
		expect(resolved.border.chars.topLeft).toBe("+");
		expect(resolved.border.chars.horizontal).toBe("-");

		// Tree uses ASCII
		expect(resolved.tree.branch).toBe("|--");
		expect(resolved.tree.last).toBe("\\--");

		// Motion uses ASCII
		expect(resolved.motion.spinnerDots).toEqual(["-", "\\", "|", "/"]);
		expect(resolved.motion.progressFilled).toBe("#");
	});

	test("produces resolved tokens for 256-color", () => {
		const caps = makeCaps({ colorDepth: "256", unicode: true });
		const resolved = resolveTokens(defaultTokens, caps);

		expect(resolved.color.error).toBe("196");
		expect(resolved.color.success).toBe("34");
		expect(resolved.color.warning).toBe("214");
		expect(resolved.color.info).toBe("39");
		expect(resolved.color.accent).toBe("33");
		expect(resolved.color.code).toBe("37");
	});

	test("produces resolved tokens for 16-color", () => {
		const caps = makeCaps({ colorDepth: "16", unicode: true });
		const resolved = resolveTokens(defaultTokens, caps);

		expect(resolved.color.error).toBe("red");
		expect(resolved.color.success).toBe("green");
		expect(resolved.color.warning).toBe("yellow");
		expect(resolved.color.info).toBe("cyan");
		expect(resolved.color.accent).toBe("blue");
		expect(resolved.color.code).toBe("cyan");
	});

	test("typography color references are resolved", () => {
		const caps = makeCaps({ colorDepth: "truecolor", unicode: true });
		const resolved = resolveTokens(defaultTokens, caps);

		// strong has color: 'accent' → should resolve to accent's truecolor
		expect(resolved.type.strong.color).toBe("#60a5fa");
		expect(resolved.type.strong.bold).toBe(true);

		// code has color: 'code' → should resolve to code's truecolor
		expect(resolved.type.code.color).toBe("#67e8f9");

		// link has color: 'accent'
		expect(resolved.type.link.color).toBe("#60a5fa");
		expect(resolved.type.link.underline).toBe(true);
	});

	test("typography color references are null when colorDepth is none", () => {
		const caps = makeCaps({ colorDepth: "none", unicode: true });
		const resolved = resolveTokens(defaultTokens, caps);

		// Color-referencing typography tokens should have null color
		expect(resolved.type.strong.color).toBeNull();
		expect(resolved.type.code.color).toBeNull();
		expect(resolved.type.link.color).toBeNull();

		// Non-color attributes remain intact
		expect(resolved.type.strong.bold).toBe(true);
		expect(resolved.type.link.underline).toBe(true);
	});

	test("typography tokens without color refs have no color property", () => {
		const caps = makeCaps({ colorDepth: "truecolor", unicode: true });
		const resolved = resolveTokens(defaultTokens, caps);

		// emphasis has no color ref
		expect(resolved.type.emphasis.color).toBeUndefined();
		expect(resolved.type.emphasis.bold).toBe(true);

		// deEmphasis has no color ref
		expect(resolved.type.deEmphasis.color).toBeUndefined();
		expect(resolved.type.deEmphasis.dim).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Serialization Round-Trip
// ---------------------------------------------------------------------------

describe("token serialization", () => {
	test("defaultTokens survives JSON round-trip", () => {
		const serialized = JSON.stringify(defaultTokens);
		const deserialized = JSON.parse(serialized) as TokenSet;
		expect(deserialized).toEqual(defaultTokens);
	});

	test("resolved tokens survive JSON round-trip", () => {
		const caps = makeCaps({ colorDepth: "truecolor", unicode: true });
		const resolved = resolveTokens(defaultTokens, caps);
		const serialized = JSON.stringify(resolved);
		const deserialized = JSON.parse(serialized);
		expect(deserialized).toEqual(resolved);
	});

	test("resolved tokens with null colors survive JSON round-trip", () => {
		const caps = makeCaps({ colorDepth: "none", unicode: false });
		const resolved = resolveTokens(defaultTokens, caps);
		const serialized = JSON.stringify(resolved);
		const deserialized = JSON.parse(serialized);
		expect(deserialized).toEqual(resolved);
	});
});

// ---------------------------------------------------------------------------
// Edge Cases
// ---------------------------------------------------------------------------

describe("edge cases", () => {
	test("background color tokens resolve like foreground colors", () => {
		const caps = makeCaps({ colorDepth: "16" });
		const resolved = resolveTokens(defaultTokens, caps);
		expect(resolved.color.bgError).toBe("bgRed");
		expect(resolved.color.bgWarning).toBe("bgYellow");
		expect(resolved.color.bgSuccess).toBe("bgGreen");
		expect(resolved.color.bgInfo).toBe("bgCyan");
		expect(resolved.color.bgHighlight).toBe("bgBlue");
	});

	test("diff color tokens resolve correctly", () => {
		const caps = makeCaps({ colorDepth: "truecolor" });
		const resolved = resolveTokens(defaultTokens, caps);
		expect(resolved.color.diffAdded).toBe("#4ade80");
		expect(resolved.color.diffRemoved).toBe("#f87171");
		expect(resolved.color.diffContext).toBe("dim");
		expect(resolved.color.diffHunk).toBe("#38bdf8");
	});

	test("border resolution falls back to ascii when unicode is false", () => {
		const caps = makeCaps({ unicode: false });
		const resolved = resolveTokens(defaultTokens, caps);
		expect(resolved.border.style).toBe("ascii");
		expect(resolved.border.chars).toEqual(defaultTokens.border.styles.ascii);
	});

	test("border resolution preserves all styles for potential runtime switching", () => {
		const caps = makeCaps({ unicode: true });
		const resolved = resolveTokens(defaultTokens, caps);
		// All styles are still available even though one is selected as default
		expect(Object.keys(resolved.border.styles).length).toBe(6);
	});
});
