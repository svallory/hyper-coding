import { beforeEach, describe, expect, test } from "vitest";
import {
	type BadgeOptions,
	type BorderOptions,
	type BuiltinThemeName,
	type ColorDepth,
	// Type-only imports (compile-time check)
	type DesignSystem,
	type MessageOptions,
	type ResolvedTokens,
	type StyleSpec,
	type StyledTextOptions,
	type SystemContext,
	type SystemOptions,
	type TableOptions,
	type TerminalCapabilities,
	type Theme,
	type ThemeInput,
	badge,
	createCapabilities,
	createContext,
	createSystem,
	divider,
	// Context exports
	getContext,
	keyValue,
	list,
	// Standalone function exports
	message,
	panel,
	section,
	setContext,
	statusList,
	stringWidth,
	// Utility exports
	stripAnsi,
	styledText,
	symbol,
	table,
	tree,
} from "#index";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a system with color forced on and unicode enabled, for deterministic output. */
function testSystem(opts?: Parameters<typeof createSystem>[0]) {
	return createSystem({
		capabilities: { colorDepth: "truecolor", unicode: true, columns: 80 },
		...opts,
	});
}

// ---------------------------------------------------------------------------
// createSystem — defaults
// ---------------------------------------------------------------------------

describe("createSystem", () => {
	test("with no args produces working defaults", () => {
		const ds = createSystem();
		expect(ds).toBeDefined();
		expect(ds.tokens).toBeDefined();
		expect(ds.capabilities).toBeDefined();
		expect(ds.theme).toBeDefined();

		// Tokens should have all top-level groups
		expect(ds.tokens.color).toBeDefined();
		expect(ds.tokens.symbol).toBeDefined();
		expect(ds.tokens.space).toBeDefined();
		expect(ds.tokens.border).toBeDefined();
		expect(ds.tokens.type).toBeDefined();

		// Capabilities should be a valid object with required fields
		expect(typeof ds.capabilities.colorDepth).toBe("string");
		expect(typeof ds.capabilities.unicode).toBe("boolean");
		expect(typeof ds.capabilities.columns).toBe("number");
	});

	test('with builtin theme "minimal" applies minimal theme tokens', () => {
		const ds = testSystem({ theme: "minimal" });
		// The minimal theme uses '+' for success and 'x' for error
		const successSym = ds.symbol("success");
		expect(successSym).toBe("+");
		const errorSym = ds.symbol("error");
		expect(errorSym).toBe("x");
	});

	test('with builtin theme "default" uses default unicode symbols', () => {
		const ds = testSystem({ theme: "default" });
		const successSym = ds.symbol("success");
		// default theme with unicode on should use the unicode checkmark
		expect(successSym).toBe("\u2713"); // ✓
	});

	test("with custom theme overrides specific tokens", () => {
		const customTheme: Theme = {
			name: "custom-test",
			symbol: {
				success: { unicode: "OK", ascii: "OK" },
			},
		};
		const ds = testSystem({ theme: customTheme });
		expect(ds.symbol("success")).toBe("OK");
	});

	test("with capabilities override disables color", () => {
		const ds = createSystem({
			capabilities: { colorDepth: "none", unicode: true, columns: 80 },
		});
		expect(ds.capabilities.colorDepth).toBe("none");
		// Styled text with color should produce no ANSI escapes when color is none
		const result = ds.styledText("hello", { color: "error" });
		expect(result).toBe("hello");
	});

	test("with capabilities override sets columns", () => {
		const ds = createSystem({
			capabilities: { columns: 120 },
		});
		expect(ds.capabilities.columns).toBe(120);
	});
});

// ---------------------------------------------------------------------------
// System methods produce output
// ---------------------------------------------------------------------------

describe("system methods work", () => {
	let ds: DesignSystem;

	beforeEach(() => {
		ds = testSystem();
	});

	test("ds.message() produces a string with the text", () => {
		const result = ds.message({ level: "success", text: "All good" });
		expect(typeof result).toBe("string");
		expect(stripAnsi(result)).toContain("All good");
	});

	test("ds.table() produces tabular output", () => {
		const result = ds.table({
			columns: [
				{ key: "name", header: "Name" },
				{ key: "val", header: "Value" },
			],
			data: [
				{ name: "foo", val: "1" },
				{ name: "bar", val: "2" },
			],
		});
		expect(typeof result).toBe("string");
		const plain = stripAnsi(result);
		expect(plain).toContain("foo");
		expect(plain).toContain("bar");
	});

	test("ds.symbol() returns a string symbol", () => {
		const result = ds.symbol("success");
		expect(typeof result).toBe("string");
		expect(result.length).toBeGreaterThan(0);
	});

	test("ds.badge() produces a badge string", () => {
		const result = ds.badge("OK");
		expect(typeof result).toBe("string");
		expect(stripAnsi(result)).toContain("OK");
	});

	test("ds.divider() produces a divider string", () => {
		const result = ds.divider();
		expect(typeof result).toBe("string");
		expect(result.length).toBeGreaterThan(0);
	});

	test("ds.panel() produces a panel", () => {
		const result = ds.panel("Hello panel");
		expect(typeof result).toBe("string");
		expect(stripAnsi(result)).toContain("Hello panel");
	});

	test("ds.styledText() applies styling", () => {
		const result = ds.styledText("bold text", { bold: true });
		expect(typeof result).toBe("string");
		// With truecolor, bold should add ANSI codes
		expect(result).not.toBe("bold text");
		expect(stripAnsi(result)).toBe("bold text");
	});
});

// ---------------------------------------------------------------------------
// setTheme / mergeTheme
// ---------------------------------------------------------------------------

describe("setTheme", () => {
	test("changes theme and tokens reflect new values", () => {
		const ds = testSystem({ theme: "default" });
		const defaultSuccess = ds.symbol("success");

		ds.setTheme("minimal");
		const minimalSuccess = ds.symbol("success");

		// Minimal uses '+' for success, default uses unicode checkmark
		expect(defaultSuccess).not.toBe(minimalSuccess);
		expect(minimalSuccess).toBe("+");
	});

	test("tokens getter reflects changes live after setTheme", () => {
		const ds = testSystem({ theme: "default" });
		const tokensBefore = ds.tokens;

		ds.setTheme("minimal");
		const tokensAfter = ds.tokens;

		// Tokens object should reflect the new theme
		// (tokens getter delegates to themeEngine.resolvedTokens which recalculates)
		expect(tokensAfter.symbol.success).toBe("+");
	});
});

describe("mergeTheme", () => {
	test("partial overlay works", () => {
		const ds = testSystem({ theme: "default" });

		ds.mergeTheme({
			symbol: {
				success: { unicode: "YES", ascii: "YES" },
			},
		});

		expect(ds.symbol("success")).toBe("YES");
		// Other symbols should remain from default theme
		const errorSym = ds.symbol("error");
		expect(errorSym).toBe("\u2717"); // ✗ from default
	});

	test("mergeTheme preserves base theme and adds overlay", () => {
		const ds = testSystem({ theme: "minimal" });
		// minimal uses '+' for success
		expect(ds.symbol("success")).toBe("+");

		ds.mergeTheme({
			symbol: {
				success: { unicode: "PASS", ascii: "PASS" },
			},
		});

		expect(ds.symbol("success")).toBe("PASS");
		// error should still be 'x' from minimal
		expect(ds.symbol("error")).toBe("x");
	});
});

// ---------------------------------------------------------------------------
// Multiple instances
// ---------------------------------------------------------------------------

describe("multiple instances", () => {
	test("two systems with different themes produce different output", () => {
		// Create first system
		const ds1 = testSystem({ theme: "default" });
		const msg1 = ds1.message({ level: "success", text: "Done" });

		// Create second system (this will set the global context to ds2)
		const ds2 = testSystem({ theme: "minimal" });
		const msg2 = ds2.message({ level: "success", text: "Done" });

		// The messages should differ because the themes differ
		expect(msg1).not.toBe(msg2);

		// Verify the theme-specific symbols are present
		const plain1 = stripAnsi(msg1);
		const plain2 = stripAnsi(msg2);
		expect(plain1).toContain("\u2713"); // ✓ from default
		expect(plain2).toContain("+"); // + from minimal
	});

	test("last createSystem wins the global context", () => {
		const _ds1 = testSystem({ theme: "default" });
		const _ds2 = testSystem({ theme: "minimal" });

		// Standalone symbol() should use ds2's context (minimal theme)
		expect(symbol("success")).toBe("+");
	});
});

// ---------------------------------------------------------------------------
// Standalone exports (zero config)
// ---------------------------------------------------------------------------

describe("standalone exports", () => {
	beforeEach(() => {
		// Reset context to ensure auto-initialization works
		// We do this by setting a fresh default context
		const ctx = createContext({ colorDepth: "truecolor", unicode: true, columns: 80 });
		setContext(ctx);
	});

	test("message() works without createSystem", () => {
		const result = message({ level: "info", text: "Standalone message" });
		expect(typeof result).toBe("string");
		expect(stripAnsi(result)).toContain("Standalone message");
	});

	test("symbol() works without createSystem", () => {
		const result = symbol("success");
		expect(typeof result).toBe("string");
		expect(result.length).toBeGreaterThan(0);
	});

	test("table() works without createSystem", () => {
		const result = table({
			columns: [{ key: "a", header: "A" }],
			data: [{ a: "hello" }],
		});
		expect(typeof result).toBe("string");
		expect(stripAnsi(result)).toContain("hello");
	});

	test("styledText() works without createSystem", () => {
		const result = styledText("hi", { bold: true });
		expect(typeof result).toBe("string");
		expect(stripAnsi(result)).toBe("hi");
	});

	test("stripAnsi is exported and works", () => {
		expect(stripAnsi("\x1b[31mred\x1b[0m")).toBe("red");
	});

	test("stringWidth is exported and works", () => {
		expect(stringWidth("hello")).toBe(5);
	});

	test("createCapabilities is exported and works", () => {
		const caps = createCapabilities({ colorDepth: "none" });
		expect(caps.colorDepth).toBe("none");
		expect(typeof caps.unicode).toBe("boolean");
	});
});

// ---------------------------------------------------------------------------
// Type re-exports (compile-time check — if this file compiles, types work)
// ---------------------------------------------------------------------------

describe("type re-exports", () => {
	test("all key types are importable (compile-time verification)", () => {
		// These are type-only imports. If this test file compiles, the types
		// are correctly exported. We just assert true to confirm the test runs.
		const _opts: SystemOptions = {};
		const _colorDepth: ColorDepth = "truecolor";
		const _themeName: BuiltinThemeName = "minimal";
		const _msgOpts: MessageOptions = { level: "info", text: "hi" };

		expect(true).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Context synchronization
// ---------------------------------------------------------------------------

describe("context synchronization", () => {
	test("setTheme on system updates the global context tokens", () => {
		const ds = testSystem({ theme: "default" });

		// Global context should match system
		const ctx = getContext();
		const symbolBefore = ctx.tokens.symbol.success;
		expect(symbolBefore).toBe("\u2713");

		ds.setTheme("minimal");

		// The global context tokens should now reflect minimal theme
		const symbolAfter = ctx.tokens.symbol.success;
		expect(symbolAfter).toBe("+");
	});

	test("mergeTheme on system updates the global context tokens", () => {
		const ds = testSystem({ theme: "default" });

		ds.mergeTheme({
			symbol: {
				success: { unicode: "MERGED", ascii: "MERGED" },
			},
		});

		const ctx = getContext();
		expect(ctx.tokens.symbol.success).toBe("MERGED");
	});
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("edge cases", () => {
	test("createSystem with empty options object", () => {
		const ds = createSystem({});
		expect(ds).toBeDefined();
		expect(ds.tokens).toBeDefined();
	});

	test("createSystem with theme as composition array", () => {
		const ds = testSystem({
			theme: ["default", { symbol: { success: { unicode: "YEP", ascii: "YEP" } } }],
		});
		expect(ds.symbol("success")).toBe("YEP");
		// Error should still be from default
		expect(ds.symbol("error")).toBe("\u2717");
	});

	test("setTheme followed by mergeTheme composes correctly", () => {
		const ds = testSystem();

		ds.setTheme("minimal");
		expect(ds.symbol("success")).toBe("+");

		ds.mergeTheme({
			symbol: {
				success: { unicode: "WIN", ascii: "WIN" },
			},
		});
		expect(ds.symbol("success")).toBe("WIN");
		// error should still be from minimal
		expect(ds.symbol("error")).toBe("x");
	});
});
