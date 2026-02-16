import { describe, expect, it } from "vitest";
import { error, info, success, tip, warning } from "../../src/ui/messages.js";
import { symbols } from "../../src/ui/symbols.js";

/**
 * Strip ANSI escape codes from a string so we can assert on structure.
 */
function strip(s: string): string {
	// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI codes
	return s.replace(/\x1b\[[0-9;]*m/g, "");
}

// ─── error ──────────────────────────────────────────────────────────────────

describe("error", () => {
	it("summary-only (1 arg): icon + summary, no title, no bar", () => {
		const out = strip(error("Something broke"));
		expect(out).toContain(symbols.error);
		expect(out).toContain("Something broke");
		// No title prefix
		expect(out).not.toContain("Error:");
		// No bar (no body)
		expect(out).not.toContain(symbols.bar);
	});

	it("title + summary (2 args): title line, icon + summary, no bar", () => {
		const out = strip(error("deploy::failed", "Deployment timed out"));
		expect(out).toContain("Error:");
		expect(out).toContain("deploy::failed");
		expect(out).toContain(symbols.error);
		expect(out).toContain("Deployment timed out");
		// No bar (no body)
		expect(out).not.toContain(symbols.bar);
	});

	it("title + summary + string body (3 args): title, icon, bar, body lines", () => {
		const out = strip(
			error("process::failed", "Process git failed", "fatal: index file open failed"),
		);
		expect(out).toContain("Error:");
		expect(out).toContain("process::failed");
		expect(out).toContain(symbols.error);
		expect(out).toContain("Process git failed");
		expect(out).toContain(symbols.bar);
		expect(out).toContain("fatal: index file open failed");
	});

	it("title + summary + array body (3 args): each body line appears", () => {
		const body = ["line one", "line two", "line three"];
		const out = strip(error("multi::error", "Multiple issues", body));
		for (const line of body) {
			expect(out).toContain(line);
		}
		expect(out).toContain(symbols.bar);
	});

	it("contains ANSI color codes (is colorized)", () => {
		const raw = error("Something broke");
		// Raw output should contain ANSI escape sequences
		// biome-ignore lint/suspicious/noControlCharactersInRegex: checking for ANSI codes
		expect(raw).toMatch(/\x1b\[/);
	});
});

// ─── warning ────────────────────────────────────────────────────────────────

describe("warning", () => {
	it("summary-only (1 arg): icon + summary, no title", () => {
		const out = strip(warning("Disk space low"));
		expect(out).toContain(symbols.warning);
		expect(out).toContain("Disk space low");
		expect(out).not.toContain("Warning:");
	});

	it("title + summary (2 args): title line with Warning: prefix", () => {
		const out = strip(warning("disk::space", "Disk space is below 10%"));
		expect(out).toContain("Warning:");
		expect(out).toContain("disk::space");
		expect(out).toContain(symbols.warning);
		expect(out).toContain("Disk space is below 10%");
	});
});

// ─── success ────────────────────────────────────────────────────────────────

describe("success", () => {
	it("summary-only (1 arg): icon + summary", () => {
		const out = strip(success("Build complete"));
		expect(out).toContain(symbols.success);
		expect(out).toContain("Build complete");
		expect(out).not.toContain("Success:");
	});

	it("title + summary + body (3 args): full structured output", () => {
		const out = strip(success("build::done", "Build succeeded", "3 files compiled"));
		expect(out).toContain("Success:");
		expect(out).toContain("build::done");
		expect(out).toContain(symbols.success);
		expect(out).toContain("Build succeeded");
		expect(out).toContain(symbols.bar);
		expect(out).toContain("3 files compiled");
	});
});

// ─── info ───────────────────────────────────────────────────────────────────

describe("info", () => {
	it("summary-only (1 arg): icon + summary", () => {
		const out = strip(info("Running diagnostics"));
		expect(out).toContain(symbols.info);
		expect(out).toContain("Running diagnostics");
		expect(out).not.toContain("Info:");
	});

	it("title + summary (2 args): title line with Info: prefix", () => {
		const out = strip(info("diagnostics::start", "Running diagnostics"));
		expect(out).toContain("Info:");
		expect(out).toContain("diagnostics::start");
	});
});

// ─── tip ────────────────────────────────────────────────────────────────────

describe("tip", () => {
	it("summary-only (1 arg): icon + summary", () => {
		const out = strip(tip("Try using --verbose"));
		expect(out).toContain(symbols.tip);
		expect(out).toContain("Try using --verbose");
		expect(out).not.toContain("Tip:");
	});

	it("title + summary + body (3 args): full structured output", () => {
		const out = strip(tip("hint::verbose", "Enable verbose mode", "Use --verbose flag"));
		expect(out).toContain("Tip:");
		expect(out).toContain("hint::verbose");
		expect(out).toContain(symbols.tip);
		expect(out).toContain("Enable verbose mode");
		expect(out).toContain(symbols.bar);
		expect(out).toContain("Use --verbose flag");
	});
});

// ─── structural tests ──────────────────────────────────────────────────────

describe("structure", () => {
	it("icon sits directly below title line (same column indentation)", () => {
		const out = strip(error("test::title", "A summary"));
		const lines = out.split("\n").filter((l) => l.trim().length > 0);
		// First non-empty line: title; second non-empty line: icon+summary
		const titleLine = lines[0];
		const iconLine = lines[1];
		// Both should start with leading spaces (indented)
		expect(titleLine).toMatch(/^\s+Error:/);
		expect(iconLine).toMatch(new RegExp(`^\\s+\\${symbols.error}`));
	});

	it("title line appears before icon line", () => {
		const out = strip(error("test::order", "Summary text"));
		const titleIdx = out.indexOf("Error:");
		const iconIdx = out.indexOf(symbols.error);
		expect(titleIdx).toBeLessThan(iconIdx);
	});

	it("body lines are indented past the bar", () => {
		const out = strip(error("test::body", "Summary", "detail line"));
		const lines = out.split("\n");
		const barLine = lines.find((l) => l.includes(symbols.bar) && !l.includes("detail"));
		const bodyLine = lines.find((l) => l.includes("detail line"));
		expect(barLine).toBeDefined();
		expect(bodyLine).toBeDefined();
		// Body line should contain the bar followed by gap and text
		expect(bodyLine).toMatch(new RegExp(`\\${symbols.bar}\\s+detail line`));
	});

	it("multiline string body splits on newlines", () => {
		const out = strip(error("test::multi", "Summary", "line1\nline2\nline3"));
		expect(out).toContain("line1");
		expect(out).toContain("line2");
		expect(out).toContain("line3");
	});

	it("returns a string (does not print to stdout)", () => {
		const result = error("test");
		expect(typeof result).toBe("string");
	});
});
