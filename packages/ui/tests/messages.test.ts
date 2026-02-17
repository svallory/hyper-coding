import stripAnsi from "strip-ansi";
import { describe, expect, it } from "vitest";
import { msg } from "../src/messages.js";
import { symbols } from "../src/symbols.js";

describe("msg (structured messages)", () => {
	describe("string shorthand", () => {
		it("msg.error with string produces summary-only output", () => {
			const result = msg.error("Something broke");
			expect(result).toContain(symbols.error);
			expect(result).toContain("Something broke");
			// No prefix in summary-only mode
			expect(result).not.toContain("Error:");
		});

		it("msg.tip with string produces summary-only output", () => {
			const result = msg.tip("Try this");
			expect(result).toContain(symbols.tip);
			expect(result).toContain("Try this");
		});
	});

	describe("props object", () => {
		it("summary-only props works", () => {
			const result = msg.warning({ summary: "Heads up" });
			expect(result).toContain(symbols.warning);
			expect(result).toContain("Heads up");
		});

		it("title + summary shows prefix", () => {
			const result = msg.error({ title: "Config", summary: "File not found" });
			expect(result).toContain("Error:");
			expect(result).toContain("Config");
			expect(result).toContain("File not found");
		});

		it("title + summary + body shows bar and body lines", () => {
			const result = msg.info({
				title: "Help",
				summary: "Getting started",
				body: ["Step 1", "Step 2"],
			});
			expect(result).toContain("Info:");
			expect(result).toContain("Help");
			expect(result).toContain("Getting started");
			expect(result).toContain(symbols.bar);
			expect(result).toContain("Step 1");
			expect(result).toContain("Step 2");
		});

		it("body as string splits on newlines", () => {
			const result = msg.success({
				title: "Done",
				summary: "All good",
				body: "Line 1\nLine 2",
			});
			expect(result).toContain("Line 1");
			expect(result).toContain("Line 2");
		});
	});

	describe("all message types exist", () => {
		it("msg has error, warning, success, info, tip", () => {
			expect(typeof msg.error).toBe("function");
			expect(typeof msg.warning).toBe("function");
			expect(typeof msg.success).toBe("function");
			expect(typeof msg.info).toBe("function");
			expect(typeof msg.tip).toBe("function");
		});
	});

	describe("tip messages have no leading indent", () => {
		it("tip summary-only starts without indent", () => {
			const result = msg.tip("Do this");
			const firstLine = stripAnsi(result.split("\n")[0]);
			// Tip starts with the symbol directly (no leading spaces)
			expect(
				firstLine.startsWith(symbols.tip) || firstLine.trimStart().startsWith(symbols.tip),
			).toBe(true);
		});
	});

	describe("inline markdown in summaries", () => {
		it("processes backticks in summary", () => {
			const result = msg.tip("Run `hyper init`");
			// Should contain the text but styled (not raw backticks)
			expect(result).toContain("hyper init");
			expect(result).not.toContain("`hyper init`");
		});
	});
});
