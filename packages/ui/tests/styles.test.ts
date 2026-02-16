import { describe, expect, it } from "vitest";
import { s } from "../src/styles.js";

describe("s (composite styles)", () => {
	it("s.hint returns a string containing the text", () => {
		expect(s.hint("try this")).toContain("try this");
	});

	it("s.success prepends checkmark", () => {
		expect(s.success("done")).toContain("\u2714");
		expect(s.success("done")).toContain("done");
	});

	it("s.error prepends X mark", () => {
		expect(s.error("failed")).toContain("\u2718");
	});

	it("s.hr returns a line of dashes", () => {
		const hr = s.hr();
		expect(hr).toContain("\u2500");
	});

	it("s.keyValue formats key: value", () => {
		const kv = s.keyValue("name", "hyper");
		expect(kv).toContain("name:");
		expect(kv).toContain("hyper");
	});

	it("s.keyValue supports indent", () => {
		const kv = s.keyValue("name", "hyper", 4);
		expect(kv.startsWith("    ")).toBe(true);
	});

	it("s.header with count appends count in parens", () => {
		const h = s.header("Items", 5);
		expect(h).toContain("Items");
		expect(h).toContain("(5)");
	});

	it("s.header without count omits parens", () => {
		const h = s.header("Items");
		expect(h).toContain("Items");
		expect(h).not.toContain("(");
	});

	it("s.listItem prepends bullet", () => {
		expect(s.listItem("item")).toContain("\u2022");
		expect(s.listItem("item")).toContain("item");
	});

	it("s.indent adds spaces", () => {
		const indented = s.indent("hello", 6);
		expect(indented).toBe("      hello");
	});

	it("s.md is a function", () => {
		expect(typeof s.md).toBe("function");
	});

	it("s.md transforms backticks", () => {
		const result = s.md("Run `hyper`");
		expect(result).toContain("hyper");
		expect(result).not.toContain("`");
	});
});
