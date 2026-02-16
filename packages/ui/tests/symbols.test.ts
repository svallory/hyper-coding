import { describe, expect, it } from "vitest";
import { symbols } from "../src/symbols.js";

describe("symbols", () => {
	it("exports status symbols as unicode characters", () => {
		expect(symbols.error).toBe("\u00d7");
		expect(symbols.warning).toBe("\u25b2");
		expect(symbols.success).toBe("\u2714");
		expect(symbols.info).toBe("\u25cf");
		expect(symbols.tip).toBe("\u25c6");
	});

	it("exports structural symbols", () => {
		expect(symbols.bar).toBe("\u2502");
		expect(symbols.bullet).toBe("\u2022");
		expect(symbols.dash).toBe("\u2500");
		expect(symbols.arrow).toBe("\u25b8");
	});
});
