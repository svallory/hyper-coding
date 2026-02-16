import { describe, expect, it } from "vitest";
import * as ui from "../src/index.js";

describe("@hypercli/ui barrel exports", () => {
	it("exports palette", () => {
		expect(ui.palette).toBeDefined();
		expect(ui.palette.brand).toBe("#4EC9B0");
	});

	it("exports tokens", () => {
		expect(ui.tokens).toBeDefined();
	});

	it("exports symbols", () => {
		expect(ui.symbols).toBeDefined();
		expect(ui.symbols.error).toBeDefined();
	});

	it("exports c (colors)", () => {
		expect(ui.c).toBeDefined();
		expect(typeof ui.c.command).toBe("function");
	});

	it("exports s (styles)", () => {
		expect(ui.s).toBeDefined();
		expect(typeof ui.s.header).toBe("function");
	});

	it("exports md", () => {
		expect(typeof ui.md).toBe("function");
	});

	it("exports msg", () => {
		expect(ui.msg).toBeDefined();
		expect(typeof ui.msg.error).toBe("function");
	});

	it("exports helpTheme", () => {
		expect(ui.helpTheme).toBeDefined();
	});

	it("exports renderMarkdown", () => {
		expect(typeof ui.renderMarkdown).toBe("function");
	});
});
