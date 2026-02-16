import { describe, expect, it } from "vitest";
import { c } from "../src/colors.js";

describe("c (color functions)", () => {
	it("returns strings for all color functions", () => {
		// Every function should return a string (chalk-wrapped)
		const fns = [
			"success",
			"error",
			"warning",
			"info",
			"muted",
			"command",
			"danger",
			"highlight",
			"dim",
			"bold",
			"subtle",
			"text",
			"kit",
			"recipe",
			"cookbook",
			"helper",
			"property",
			"required",
			"enum",
			"title",
			"heading",
			"version",
		] as const;

		for (const fn of fns) {
			const result = c[fn]("test");
			expect(typeof result).toBe("string");
			// chalk-wrapped strings should contain the original text
			expect(result).toContain("test");
		}
	});

	it("c.text returns input unchanged", () => {
		expect(c.text("hello")).toBe("hello");
	});

	it("c.default formats with JSON.stringify", () => {
		const result = c.default(42);
		expect(result).toContain("42");
		expect(result).toContain("default:");
	});

	it("c.default handles string values", () => {
		const result = c.default("foo");
		expect(result).toContain('"foo"');
	});
});
