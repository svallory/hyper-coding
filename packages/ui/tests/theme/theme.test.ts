import { describe, expect, test } from "vitest";
import { createCapabilities } from "#capabilities/index";
import { builtinThemes } from "#theme/builtins";
import { ThemeEngine } from "#theme/engine";
import { deepMerge } from "#theme/merge";
import type { Theme } from "#theme/types";
import { defaultTokens } from "#tokens/index";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const defaultCaps = createCapabilities();
const noUnicodeCaps = createCapabilities({ unicode: false });
const noColorCaps = createCapabilities({ colorDepth: "none" });

// ---------------------------------------------------------------------------
// deepMerge
// ---------------------------------------------------------------------------

describe("deepMerge", () => {
	test("merges nested objects recursively", () => {
		const base = { a: { b: 1, c: 2 }, d: 3 };
		const override = { a: { b: 10 } };
		const result = deepMerge(base, override);
		expect(result).toEqual({ a: { b: 10, c: 2 }, d: 3 });
	});

	test("replaces arrays instead of concatenating", () => {
		const base = { items: [1, 2, 3] };
		const override = { items: [4, 5] };
		const result = deepMerge(base, override);
		expect(result).toEqual({ items: [4, 5] });
	});

	test("skips undefined values in overrides", () => {
		const base = { a: 1, b: 2 };
		const override = { a: undefined, b: 3 };
		const result = deepMerge(base, override);
		expect(result).toEqual({ a: 1, b: 3 });
	});

	test("handles multi-level nesting", () => {
		const base = { l1: { l2: { l3: { value: "base" }, other: true } } };
		const override = { l1: { l2: { l3: { value: "override" } } } };
		const result = deepMerge(base, override);
		expect(result).toEqual({ l1: { l2: { l3: { value: "override" }, other: true } } });
	});

	test("replaces primitives", () => {
		const base = { name: "old", count: 0, active: false };
		const override = { name: "new", count: 5, active: true };
		const result = deepMerge(base, override);
		expect(result).toEqual({ name: "new", count: 5, active: true });
	});

	test("applies multiple overrides left to right", () => {
		const base = { a: 1, b: 2, c: 3 };
		const first = { a: 10 };
		const second = { a: 100, b: 20 };
		const result = deepMerge(base, first, second);
		expect(result).toEqual({ a: 100, b: 20, c: 3 });
	});

	test("does not mutate the base object", () => {
		const base = { a: { b: 1 } };
		const override = { a: { b: 2 } };
		deepMerge(base, override);
		expect(base.a.b).toBe(1);
	});

	test("handles null values as replacements", () => {
		const base = { a: { b: 1 } } as Record<string, unknown>;
		const override = { a: null } as Record<string, unknown>;
		const result = deepMerge(base, override);
		expect(result.a).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// Theme composition
// ---------------------------------------------------------------------------

describe("theme composition", () => {
	test("[base, override] applies correctly left-to-right", () => {
		const engine = new ThemeEngine(defaultCaps, [
			{ color: { heading: "dim" } },
			{ color: { heading: "bold" } },
		]);
		expect(engine.rawTokens.color.heading).toBe("bold");
	});

	test("later themes override earlier ones for the same key", () => {
		const engine = new ThemeEngine(defaultCaps, [
			{ border: { style: "ascii" } },
			{ border: { style: "double" } },
		]);
		expect(engine.rawTokens.border.style).toBe("double");
	});

	test("composition preserves non-overlapping values from each theme", () => {
		const engine = new ThemeEngine(defaultCaps, [
			{ color: { heading: "dim" } },
			{ space: { indent: 4 } },
		]);
		expect(engine.rawTokens.color.heading).toBe("dim");
		expect(engine.rawTokens.space.indent).toBe(4);
	});
});

// ---------------------------------------------------------------------------
// extends resolution
// ---------------------------------------------------------------------------

describe("extends resolution", () => {
	test("theme extending minimal gets minimal values plus its own overrides", () => {
		const custom: Theme = {
			extends: "minimal",
			color: { heading: "dim" },
		};
		const engine = new ThemeEngine(defaultCaps, custom);
		// Should have minimal's border style
		expect(engine.rawTokens.border.style).toBe("ascii");
		// Should have custom's heading override
		expect(engine.rawTokens.color.heading).toBe("dim");
	});

	test("theme extending highContrast inherits no-dim typography", () => {
		const custom: Theme = {
			extends: "highContrast",
			symbol: { success: { unicode: "PASS", ascii: "PASS" } },
		};
		const engine = new ThemeEngine(defaultCaps, custom);
		expect(engine.rawTokens.type.deEmphasis.dim).toBe(false);
		expect(engine.resolvedTokens.symbol.success).toBe("PASS");
	});

	test("extends with no additional overrides equals the base theme", () => {
		const extending: Theme = { extends: "minimal" };
		const direct = new ThemeEngine(defaultCaps, "minimal");
		const extended = new ThemeEngine(defaultCaps, extending);
		expect(extended.rawTokens.border.style).toBe(direct.rawTokens.border.style);
	});
});

// ---------------------------------------------------------------------------
// Built-in themes
// ---------------------------------------------------------------------------

describe("built-in themes", () => {
	test("minimal has ascii border style", () => {
		const engine = new ThemeEngine(defaultCaps, "minimal");
		expect(engine.rawTokens.border.style).toBe("ascii");
	});

	test("minimal has simplified symbols", () => {
		const engine = new ThemeEngine(defaultCaps, "minimal");
		expect(engine.rawTokens.symbol.success).toEqual({ unicode: "+", ascii: "+" });
		expect(engine.rawTokens.symbol.error).toEqual({ unicode: "x", ascii: "x" });
	});

	test("minimal has dim info color and bold heading", () => {
		const engine = new ThemeEngine(defaultCaps, "minimal");
		expect(engine.rawTokens.color.info).toBe("dim");
		expect(engine.rawTokens.color.heading).toBe("bold");
	});

	test("minimal has borderless table component default", () => {
		const engine = new ThemeEngine(defaultCaps, "minimal");
		expect(engine.getComponentDefaults("table")).toEqual({ variant: "borderless" });
	});

	test("highContrast has no dim typography", () => {
		const engine = new ThemeEngine(defaultCaps, "highContrast");
		expect(engine.rawTokens.type.deEmphasis.dim).toBe(false);
		expect(engine.rawTokens.type.heading3.dim).toBe(false);
		expect(engine.rawTokens.type.caption.dim).toBe(false);
	});

	test("highContrast has verbose status symbols", () => {
		const engine = new ThemeEngine(defaultCaps, "highContrast");
		expect(engine.rawTokens.symbol.success).toEqual({ unicode: "[OK]", ascii: "[OK]" });
		expect(engine.rawTokens.symbol.error).toEqual({ unicode: "[FAIL]", ascii: "[FAIL]" });
		expect(engine.rawTokens.symbol.warning).toEqual({ unicode: "[WARN]", ascii: "[WARN]" });
		expect(engine.rawTokens.symbol.info).toEqual({ unicode: "[INFO]", ascii: "[INFO]" });
	});

	test("monochrome sets all color tokens to default", () => {
		const engine = new ThemeEngine(defaultCaps, "monochrome");
		const colors = engine.rawTokens.color;
		for (const key of Object.keys(colors)) {
			expect(colors[key as keyof typeof colors]).toBe("default");
		}
	});

	test("monochrome uses text attributes for hierarchy", () => {
		const engine = new ThemeEngine(defaultCaps, "monochrome");
		expect(engine.rawTokens.type.emphasis.bold).toBe(true);
		expect(engine.rawTokens.type.deEmphasis.dim).toBe(true);
		expect(engine.rawTokens.type.heading1.bold).toBe(true);
		expect(engine.rawTokens.type.heading1.underline).toBe(true);
		expect(engine.rawTokens.type.link.underline).toBe(true);
	});

	test("monochrome has ASCII text labels for symbols", () => {
		const engine = new ThemeEngine(noUnicodeCaps, "monochrome");
		expect(engine.resolvedTokens.symbol.success).toBe("[OK]");
		expect(engine.resolvedTokens.symbol.error).toBe("[FAIL]");
	});

	test("default theme equals defaultTokens", () => {
		const engine = new ThemeEngine(defaultCaps, "default");
		expect(engine.rawTokens).toEqual(defaultTokens);
	});
});

// ---------------------------------------------------------------------------
// Runtime switching
// ---------------------------------------------------------------------------

describe("runtime switching", () => {
	test("setTheme invalidates cache and reflects new theme", () => {
		const engine = new ThemeEngine(defaultCaps, "minimal");
		const firstResolved = engine.resolvedTokens;
		expect(engine.rawTokens.border.style).toBe("ascii");

		engine.setTheme("highContrast");
		const secondResolved = engine.resolvedTokens;
		expect(engine.rawTokens.border.style).toBe("rounded"); // back to default
		expect(engine.rawTokens.type.deEmphasis.dim).toBe(false);

		// Cache was invalidated — different object reference
		expect(firstResolved).not.toBe(secondResolved);
	});

	test("setTheme with array composes themes", () => {
		const engine = new ThemeEngine(defaultCaps);
		engine.setTheme(["minimal", { color: { heading: "dim" } }]);
		expect(engine.rawTokens.border.style).toBe("ascii"); // from minimal
		expect(engine.rawTokens.color.heading).toBe("dim"); // from custom override
	});
});

// ---------------------------------------------------------------------------
// mergeTheme
// ---------------------------------------------------------------------------

describe("mergeTheme", () => {
	test("partial overlay on existing theme", () => {
		const engine = new ThemeEngine(defaultCaps, "minimal");
		expect(engine.rawTokens.border.style).toBe("ascii");

		engine.mergeTheme({ space: { indent: 4 } });
		expect(engine.rawTokens.space.indent).toBe(4);
		// Original minimal values are preserved
		expect(engine.rawTokens.border.style).toBe("ascii");
	});

	test("mergeTheme invalidates resolved cache", () => {
		const engine = new ThemeEngine(defaultCaps);
		const first = engine.resolvedTokens;
		engine.mergeTheme({ space: { indent: 8 } });
		const second = engine.resolvedTokens;
		expect(first).not.toBe(second);
		expect(second.space.indent).toBe(8);
	});

	test("mergeTheme can override specific symbol", () => {
		const engine = new ThemeEngine(defaultCaps);
		engine.mergeTheme({ symbol: { success: { unicode: "YEP", ascii: "YEP" } } });
		expect(engine.resolvedTokens.symbol.success).toBe("YEP");
		// Other symbols untouched
		expect(engine.rawTokens.symbol.error).toEqual(defaultTokens.symbol.error);
	});
});

// ---------------------------------------------------------------------------
// Component defaults
// ---------------------------------------------------------------------------

describe("component defaults", () => {
	test("returns component defaults from theme", () => {
		const engine = new ThemeEngine(defaultCaps, {
			components: { table: { variant: "grid", showHeader: true } },
		});
		expect(engine.getComponentDefaults("table")).toEqual({ variant: "grid", showHeader: true });
	});

	test("returns undefined for unknown component", () => {
		const engine = new ThemeEngine(defaultCaps);
		expect(engine.getComponentDefaults("nonexistent")).toBeUndefined();
	});

	test("mergeTheme preserves existing component defaults", () => {
		const engine = new ThemeEngine(defaultCaps, {
			components: { table: { variant: "grid" } },
		});
		engine.mergeTheme({ components: { list: { style: "bullet" } } });
		expect(engine.getComponentDefaults("table")).toEqual({ variant: "grid" });
		expect(engine.getComponentDefaults("list")).toEqual({ style: "bullet" });
	});
});

// ---------------------------------------------------------------------------
// Resolved tokens validity
// ---------------------------------------------------------------------------

describe("resolved tokens validity", () => {
	const themeNames = ["default", "minimal", "highContrast", "monochrome"] as const;

	for (const name of themeNames) {
		test(`${name} theme produces valid resolved tokens (no undefined)`, () => {
			const engine = new ThemeEngine(defaultCaps, name);
			const resolved = engine.resolvedTokens;

			// Color tokens: all should be string or null (not undefined)
			for (const [key, value] of Object.entries(resolved.color)) {
				expect(value === null || typeof value === "string").toBe(true);
			}

			// Typography tokens: all should be objects
			for (const [key, style] of Object.entries(resolved.type)) {
				expect(typeof style).toBe("object");
				expect(style).not.toBeNull();
			}

			// Symbol tokens: all should be strings
			for (const [key, value] of Object.entries(resolved.symbol)) {
				expect(typeof value).toBe("string");
			}

			// Space tokens: all should be numbers
			for (const [key, value] of Object.entries(resolved.space)) {
				expect(typeof value).toBe("number");
			}

			// Layout tokens: all should be numbers
			for (const [key, value] of Object.entries(resolved.layout)) {
				expect(typeof value).toBe("number");
			}

			// Border: chars should be present
			expect(resolved.border.chars).toBeDefined();
			expect(typeof resolved.border.chars.horizontal).toBe("string");

			// Tree: should have branch, last, vertical, indent
			expect(typeof resolved.tree.branch).toBe("string");
			expect(typeof resolved.tree.last).toBe("string");
			expect(typeof resolved.tree.vertical).toBe("string");
			expect(typeof resolved.tree.indent).toBe("string");

			// Motion: spinner arrays should be non-empty
			expect(resolved.motion.spinnerDots.length).toBeGreaterThan(0);
			expect(typeof resolved.motion.progressFilled).toBe("string");
		});
	}

	test('monochrome resolved colors are all "default" or null', () => {
		const engine = new ThemeEngine(defaultCaps, "monochrome");
		const resolved = engine.resolvedTokens;
		for (const [key, value] of Object.entries(resolved.color)) {
			expect(value === "default" || value === null).toBe(true);
		}
	});

	test("resolved tokens with no color depth return null for hue colors", () => {
		const engine = new ThemeEngine(noColorCaps, "default");
		const resolved = engine.resolvedTokens;
		// Hue colors should be null, attribute colors pass through
		expect(resolved.color.error).toBeNull();
		expect(resolved.color.fg).toBe("default");
		expect(resolved.color.emphasis).toBe("bold");
	});
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("edge cases", () => {
	test("empty theme input produces default tokens", () => {
		const engine = new ThemeEngine(defaultCaps);
		expect(engine.rawTokens).toEqual(defaultTokens);
	});

	test("empty array theme input produces default tokens", () => {
		const engine = new ThemeEngine(defaultCaps, []);
		expect(engine.rawTokens).toEqual(defaultTokens);
	});

	test("resolvedTokens is cached on repeated access", () => {
		const engine = new ThemeEngine(defaultCaps);
		const first = engine.resolvedTokens;
		const second = engine.resolvedTokens;
		expect(first).toBe(second); // same reference
	});

	test("single-element array theme works like a direct theme", () => {
		const engine1 = new ThemeEngine(defaultCaps, "minimal");
		const engine2 = new ThemeEngine(defaultCaps, ["minimal"]);
		expect(engine1.rawTokens).toEqual(engine2.rawTokens);
	});
});
