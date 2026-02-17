import { describe, expect, test } from "vitest";
import { createSystem } from "../../src/ds-index.ts";
import { hyperTheme } from "../../src/hyper-theme.ts";
import { stripAnsi } from "../../src/render/index.ts";

describe("hyperTheme", () => {
	test('has name "hyper"', () => {
		expect(hyperTheme.name).toBe("hyper");
	});

	test("has meta description", () => {
		expect(hyperTheme.meta?.description).toBe("HyperDev CLI brand theme");
	});

	test("defines code color with brand teal", () => {
		expect(hyperTheme.color?.code).toBeDefined();
		const code = hyperTheme.color!.code as any;
		expect(code.truecolor).toBe("#4EC9B0");
	});

	test("defines error/warning/success/info colors", () => {
		expect(hyperTheme.color?.error).toBeDefined();
		expect(hyperTheme.color?.warning).toBeDefined();
		expect(hyperTheme.color?.success).toBeDefined();
		expect(hyperTheme.color?.info).toBeDefined();
	});

	test("defines custom symbol glyphs", () => {
		expect(hyperTheme.symbol?.error).toEqual({ unicode: "\u00d7", ascii: "[FAIL]" });
		expect(hyperTheme.symbol?.warning).toEqual({ unicode: "\u25b2", ascii: "[WARN]" });
		expect(hyperTheme.symbol?.success).toEqual({ unicode: "\u2714", ascii: "[OK]" });
		expect(hyperTheme.symbol?.info).toEqual({ unicode: "\u25cf", ascii: "[INFO]" });
		expect(hyperTheme.symbol?.tip).toEqual({ unicode: "\u25c6", ascii: "[TIP]" });
	});

	test("sets iconGap to 2", () => {
		expect(hyperTheme.space?.iconGap).toBe(2);
	});

	test("works with createSystem", () => {
		const ds = createSystem({
			theme: hyperTheme,
			capabilities: { colorDepth: "truecolor", unicode: true, columns: 80 },
		});
		expect(ds.tokens).toBeDefined();
		// Verify the hyper theme's brand teal is resolved for code
		expect(ds.tokens.color.code).toBe("#4EC9B0");
		// Verify custom symbol
		expect(ds.tokens.symbol.error).toBe("\u00d7");
		expect(ds.tokens.symbol.tip).toBe("\u25c6");
	});

	test("iconGap is applied in resolved tokens", () => {
		const ds = createSystem({
			theme: hyperTheme,
			capabilities: { colorDepth: "truecolor", unicode: true, columns: 80 },
		});
		expect(ds.tokens.space.iconGap).toBe(2);
	});
});
