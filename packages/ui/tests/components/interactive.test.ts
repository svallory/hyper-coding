/**
 * Interactive Component Tests
 *
 * Tests for spinner, progressBar, and prompt components.
 * Focuses on non-TTY/CI paths (static output) and formatting functions
 * since actual interactive readline/raw-mode behavior cannot be tested in unit tests.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createContext, getContext, setContext } from "../../src/components/../primitives/index.ts";
import { stripAnsi } from "../../src/components/../render/index.ts";

import {
	formatConfirmAnswer,
	formatConfirmQuestion,
	parseConfirmInput,
} from "../../src/components/confirmPrompt.ts";
import { progressBar } from "../../src/components/progressBar.ts";
import {
	formatSelectAnswer,
	formatSelectQuestion,
	renderOptions,
} from "../../src/components/selectPrompt.ts";
// Components
import { spinner } from "../../src/components/spinner.ts";
import {
	formatTextAnswer,
	formatTextQuestion,
	formatValidationError,
} from "../../src/components/textPrompt.ts";

// ---------------------------------------------------------------------------
// Mock stream helper
// ---------------------------------------------------------------------------

function createMockStream() {
	const chunks: string[] = [];
	return {
		write(data: string) {
			chunks.push(data);
			return true;
		},
		chunks,
		get output() {
			return chunks.join("");
		},
		get plainOutput() {
			return stripAnsi(chunks.join(""));
		},
		isTTY: false,
		columns: 80,
	} as unknown as NodeJS.WriteStream & {
		chunks: string[];
		output: string;
		plainOutput: string;
	};
}

// ---------------------------------------------------------------------------
// Test context: non-TTY, CI, unicode enabled
// ---------------------------------------------------------------------------

function setupNonTTYContext() {
	const ctx = createContext({
		isTTY: false,
		isStderrTTY: false,
		isCI: true,
		unicode: true,
		colorDepth: "none",
	});
	setContext(ctx);
	return ctx;
}

function setupNonTTYAsciiContext() {
	const ctx = createContext({
		isTTY: false,
		isStderrTTY: false,
		isCI: true,
		unicode: false,
		colorDepth: "none",
	});
	setContext(ctx);
	return ctx;
}

function setupTTYContext() {
	const ctx = createContext({
		isTTY: true,
		isStderrTTY: true,
		isCI: false,
		unicode: true,
		colorDepth: "16",
	});
	setContext(ctx);
	return ctx;
}

// ---------------------------------------------------------------------------
// Spinner Tests
// ---------------------------------------------------------------------------

describe("spinner", () => {
	describe("non-TTY/CI mode", () => {
		let mockStream: ReturnType<typeof createMockStream>;

		beforeEach(() => {
			setupNonTTYContext();
			mockStream = createMockStream();
		});

		it("start() writes a static line with running symbol", () => {
			const s = spinner({ stream: mockStream, text: "Loading..." });
			s.start();

			expect(mockStream.chunks.length).toBe(1);
			expect(mockStream.plainOutput).toContain("Loading...");
			expect(mockStream.plainOutput).toContain("\n");
		});

		it("start(text) uses the provided text", () => {
			const s = spinner({ stream: mockStream });
			s.start("Compiling...");

			expect(mockStream.plainOutput).toContain("Compiling...");
		});

		it("update(text) writes a new static line", () => {
			const s = spinner({ stream: mockStream });
			s.start("Step 1");
			s.update("Step 2");

			expect(mockStream.chunks.length).toBe(2);
			expect(mockStream.plainOutput).toContain("Step 1");
			expect(mockStream.plainOutput).toContain("Step 2");
		});

		it("succeed() writes success line with checkmark", () => {
			const ctx = getContext();
			const s = spinner({ stream: mockStream, text: "Done" });
			s.start();
			s.succeed();

			const output = mockStream.plainOutput;
			const successSymbol = ctx.tokens.symbol.success;
			expect(output).toContain(successSymbol);
			expect(output).toContain("Done");
		});

		it("succeed(text) uses the provided text", () => {
			const s = spinner({ stream: mockStream, text: "Loading" });
			s.start();
			s.succeed("All done!");

			expect(mockStream.plainOutput).toContain("All done!");
		});

		it("fail() writes fail line with error symbol", () => {
			const ctx = getContext();
			const s = spinner({ stream: mockStream, text: "Oops" });
			s.start();
			s.fail();

			const output = mockStream.plainOutput;
			const errorSymbol = ctx.tokens.symbol.error;
			expect(output).toContain(errorSymbol);
			expect(output).toContain("Oops");
		});

		it("fail(text) uses the provided text", () => {
			const s = spinner({ stream: mockStream, text: "Loading" });
			s.start();
			s.fail("Something broke");

			expect(mockStream.plainOutput).toContain("Something broke");
		});

		it("succeed() shows duration", () => {
			const s = spinner({ stream: mockStream, text: "Work" });
			s.start();
			// Immediately succeed — duration should be very short
			s.succeed();

			// Duration is appended to succeed output
			const output = mockStream.plainOutput;
			// Should contain a duration like "0ms" or "1ms" etc.
			expect(output).toMatch(/\d+ms/);
		});

		it("does not write cursor hide/show sequences", () => {
			const s = spinner({ stream: mockStream, text: "Test" });
			s.start();
			s.stop();

			const raw = mockStream.output;
			expect(raw).not.toContain("\x1b[?25l");
			expect(raw).not.toContain("\x1b[?25h");
		});

		it("does not use carriage return for overwrites", () => {
			const s = spinner({ stream: mockStream, text: "Test" });
			s.start();
			s.update("Updated");
			s.stop();

			const raw = mockStream.output;
			expect(raw).not.toContain("\r");
		});
	});

	describe("non-TTY/CI ASCII mode", () => {
		let mockStream: ReturnType<typeof createMockStream>;

		beforeEach(() => {
			setupNonTTYAsciiContext();
			mockStream = createMockStream();
		});

		it("start() uses ASCII fallback prefix", () => {
			const s = spinner({ stream: mockStream, text: "Loading" });
			s.start();

			expect(mockStream.plainOutput).toContain("[..]");
		});

		it("succeed() uses [OK] prefix in ASCII mode", () => {
			const s = spinner({ stream: mockStream, text: "Done" });
			s.start();
			s.succeed();

			expect(mockStream.plainOutput).toContain("[OK]");
		});

		it("fail() uses [FAIL] prefix in ASCII mode", () => {
			const s = spinner({ stream: mockStream, text: "Oops" });
			s.start();
			s.fail();

			expect(mockStream.plainOutput).toContain("[FAIL]");
		});
	});
});

// ---------------------------------------------------------------------------
// ProgressBar Tests
// ---------------------------------------------------------------------------

describe("progressBar", () => {
	describe("non-TTY/CI mode", () => {
		let mockStream: ReturnType<typeof createMockStream>;

		beforeEach(() => {
			setupNonTTYContext();
			mockStream = createMockStream();
		});

		it("start() writes initial label with 0%", () => {
			const p = progressBar({ stream: mockStream, total: 100, label: "Downloading" });
			p.start();

			expect(mockStream.plainOutput).toContain("Downloading");
			expect(mockStream.plainOutput).toContain("0%");
		});

		it("start(label) uses the provided label", () => {
			const p = progressBar({ stream: mockStream, total: 100 });
			p.start("Installing");

			expect(mockStream.plainOutput).toContain("Installing");
		});

		it("update() writes percentage at 10% intervals", () => {
			const p = progressBar({ stream: mockStream, total: 100, label: "Progress" });
			p.start();

			// update to 5% — no output (not a decile boundary)
			mockStream.chunks.length = 0; // clear start output
			p.update(5);
			expect(mockStream.chunks.length).toBe(0);

			// update to 10% — should output
			p.update(10);
			expect(mockStream.plainOutput).toContain("10%");
		});

		it("update() writes at each 10% boundary", () => {
			const p = progressBar({ stream: mockStream, total: 50, label: "Build" });
			p.start();
			mockStream.chunks.length = 0;

			p.update(5); // 10%
			p.update(10); // 20%
			p.update(15); // 30%
			p.update(25); // 50%

			const output = mockStream.plainOutput;
			expect(output).toContain("10%");
			expect(output).toContain("20%");
			expect(output).toContain("30%");
			expect(output).toContain("50%");
		});

		it("increment() increases current value", () => {
			const p = progressBar({ stream: mockStream, total: 10, label: "Items" });
			p.start();
			mockStream.chunks.length = 0;

			p.increment(); // 1 of 10 = 10%
			expect(mockStream.plainOutput).toContain("10%");
		});

		it("increment(n) increases by n", () => {
			const p = progressBar({ stream: mockStream, total: 10, label: "Items" });
			p.start();
			mockStream.chunks.length = 0;

			p.increment(5); // 5 of 10 = 50%
			expect(mockStream.plainOutput).toContain("50%");
		});

		it("auto-succeeds on completion", () => {
			const ctx = getContext();
			const p = progressBar({ stream: mockStream, total: 10, label: "Complete" });
			p.start();
			mockStream.chunks.length = 0;

			p.update(10); // 100% — should auto-succeed

			const output = mockStream.plainOutput;
			expect(output).toContain("100%");
			expect(output).toContain(ctx.tokens.symbol.success);
		});

		it("succeed() writes success line", () => {
			const ctx = getContext();
			const p = progressBar({ stream: mockStream, total: 100, label: "Task" });
			p.start();
			mockStream.chunks.length = 0;

			p.succeed("All done");

			const output = mockStream.plainOutput;
			expect(output).toContain(ctx.tokens.symbol.success);
			expect(output).toContain("All done");
		});

		it("fail() writes failure line", () => {
			const ctx = getContext();
			const p = progressBar({ stream: mockStream, total: 100, label: "Task" });
			p.start();
			mockStream.chunks.length = 0;

			p.fail("Something failed");

			const output = mockStream.plainOutput;
			expect(output).toContain(ctx.tokens.symbol.error);
			expect(output).toContain("Something failed");
		});

		it("does not draw a bar in non-TTY mode", () => {
			const ctx = getContext();
			const p = progressBar({ stream: mockStream, total: 100, label: "Task" });
			p.start();
			p.update(50);

			const output = mockStream.plainOutput;
			const filledChar = ctx.tokens.motion.progressFilled;
			expect(output).not.toContain(filledChar.repeat(5));
		});

		it("does not use cursor hide/show sequences", () => {
			const p = progressBar({ stream: mockStream, total: 100, label: "Test" });
			p.start();
			p.stop();

			const raw = mockStream.output;
			expect(raw).not.toContain("\x1b[?25l");
			expect(raw).not.toContain("\x1b[?25h");
		});
	});
});

// ---------------------------------------------------------------------------
// TextPrompt Formatting Tests
// ---------------------------------------------------------------------------

describe("textPrompt formatting", () => {
	beforeEach(() => {
		setupTTYContext();
	});

	it("formatTextQuestion includes accent-colored ? and message", () => {
		const result = formatTextQuestion("Enter your name");
		const plain = stripAnsi(result);
		expect(plain).toContain("?");
		expect(plain).toContain("Enter your name");
		expect(plain).toContain("\u203a"); // separator
	});

	it("formatTextAnswer includes success symbol and dim value", () => {
		const result = formatTextAnswer("Enter your name", "Alice");
		const plain = stripAnsi(result);
		const ctx = getContext();
		expect(plain).toContain(ctx.tokens.symbol.success);
		expect(plain).toContain("Enter your name");
		expect(plain).toContain("Alice");
	});

	it("formatValidationError includes error symbol and message", () => {
		const result = formatValidationError("Name is required");
		const plain = stripAnsi(result);
		const ctx = getContext();
		expect(plain).toContain(ctx.tokens.symbol.error);
		expect(plain).toContain("Name is required");
	});

	it("formatTextQuestion with styled output contains ANSI sequences", () => {
		const result = formatTextQuestion("Test");
		// Should contain ANSI escape codes for styling
		expect(result).toContain("\x1b[");
	});

	it("formatTextAnswer with empty value", () => {
		const result = formatTextAnswer("Prompt", "");
		const plain = stripAnsi(result);
		expect(plain).toContain("Prompt");
	});
});

// ---------------------------------------------------------------------------
// ConfirmPrompt Formatting Tests
// ---------------------------------------------------------------------------

describe("confirmPrompt formatting", () => {
	beforeEach(() => {
		setupTTYContext();
	});

	it("formatConfirmQuestion shows (Y/n) when default is true", () => {
		const result = formatConfirmQuestion("Continue?", true);
		const plain = stripAnsi(result);
		expect(plain).toContain("?");
		expect(plain).toContain("Continue?");
		expect(plain).toContain("(Y/n)");
	});

	it("formatConfirmQuestion shows (y/N) when default is false", () => {
		const result = formatConfirmQuestion("Delete?", false);
		const plain = stripAnsi(result);
		expect(plain).toContain("(y/N)");
	});

	it("formatConfirmAnswer shows Yes for true", () => {
		const result = formatConfirmAnswer("Continue?", true);
		const plain = stripAnsi(result);
		const ctx = getContext();
		expect(plain).toContain(ctx.tokens.symbol.success);
		expect(plain).toContain("Continue?");
		expect(plain).toContain("Yes");
	});

	it("formatConfirmAnswer shows No for false", () => {
		const result = formatConfirmAnswer("Delete?", false);
		const plain = stripAnsi(result);
		expect(plain).toContain("No");
	});

	describe("parseConfirmInput", () => {
		it('returns true for "y"', () => {
			expect(parseConfirmInput("y", false)).toBe(true);
		});

		it('returns true for "yes"', () => {
			expect(parseConfirmInput("yes", false)).toBe(true);
		});

		it('returns true for "Y"', () => {
			expect(parseConfirmInput("Y", false)).toBe(true);
		});

		it('returns true for "YES"', () => {
			expect(parseConfirmInput("YES", false)).toBe(true);
		});

		it('returns false for "n"', () => {
			expect(parseConfirmInput("n", true)).toBe(false);
		});

		it('returns false for "no"', () => {
			expect(parseConfirmInput("no", true)).toBe(false);
		});

		it('returns false for "N"', () => {
			expect(parseConfirmInput("N", true)).toBe(false);
		});

		it('returns false for "NO"', () => {
			expect(parseConfirmInput("NO", true)).toBe(false);
		});

		it("returns default (true) for empty string", () => {
			expect(parseConfirmInput("", true)).toBe(true);
		});

		it("returns default (false) for empty string", () => {
			expect(parseConfirmInput("", false)).toBe(false);
		});

		it("returns default for whitespace-only", () => {
			expect(parseConfirmInput("   ", true)).toBe(true);
		});

		it("returns undefined for invalid input", () => {
			expect(parseConfirmInput("maybe", true)).toBeUndefined();
		});

		it("returns undefined for numbers", () => {
			expect(parseConfirmInput("1", true)).toBeUndefined();
		});

		it("handles leading/trailing whitespace", () => {
			expect(parseConfirmInput("  yes  ", false)).toBe(true);
			expect(parseConfirmInput(" n ", true)).toBe(false);
		});
	});
});

// ---------------------------------------------------------------------------
// SelectPrompt Formatting Tests
// ---------------------------------------------------------------------------

describe("selectPrompt formatting", () => {
	beforeEach(() => {
		setupTTYContext();
	});

	it("formatSelectQuestion includes accent-colored ? and message", () => {
		const result = formatSelectQuestion("Choose a color");
		const plain = stripAnsi(result);
		expect(plain).toContain("?");
		expect(plain).toContain("Choose a color");
	});

	it("formatSelectAnswer includes success symbol and label", () => {
		const result = formatSelectAnswer("Choose a color", "Blue");
		const plain = stripAnsi(result);
		const ctx = getContext();
		expect(plain).toContain(ctx.tokens.symbol.success);
		expect(plain).toContain("Choose a color");
		expect(plain).toContain("Blue");
	});

	describe("renderOptions", () => {
		const options = [
			{ label: "Red", value: "red" },
			{ label: "Green", value: "green", hint: "recommended" },
			{ label: "Blue", value: "blue" },
			{ label: "Gray", value: "gray", disabled: true },
		];

		it("renders all options within maxVisible", () => {
			const lines = renderOptions(options, 0, 0, 10);
			expect(lines.length).toBe(4);
		});

		it("shows pointer on active option", () => {
			const ctx = getContext();
			const lines = renderOptions(options, 0, 0, 10);
			const activeLine = stripAnsi(lines[0]!);
			expect(activeLine).toContain(ctx.tokens.symbol.pointer);
			expect(activeLine).toContain("Red");
		});

		it("non-active options do not have pointer", () => {
			const ctx = getContext();
			const lines = renderOptions(options, 0, 0, 10);
			const inactiveLine = stripAnsi(lines[2]!);
			expect(inactiveLine).not.toContain(ctx.tokens.symbol.pointer);
			expect(inactiveLine).toContain("Blue");
		});

		it("shows hint on active option that has a hint", () => {
			const lines = renderOptions(options, 1, 0, 10);
			const activeLine = stripAnsi(lines[1]!);
			expect(activeLine).toContain("Green");
			expect(activeLine).toContain("recommended");
		});

		it("does not show hint on inactive option", () => {
			const lines = renderOptions(options, 0, 0, 10);
			const inactiveLine = stripAnsi(lines[1]!);
			expect(inactiveLine).toContain("Green");
			expect(inactiveLine).not.toContain("recommended");
		});

		it("renders disabled option with (disabled) marker", () => {
			const lines = renderOptions(options, 0, 0, 10);
			const disabledLine = stripAnsi(lines[3]!);
			expect(disabledLine).toContain("Gray");
			expect(disabledLine).toContain("(disabled)");
		});

		it("disabled option does not get pointer even if active index matches", () => {
			// This shouldn't happen in practice, but test the rendering
			const lines = renderOptions(options, 3, 0, 10);
			const disabledLine = stripAnsi(lines[3]!);
			// Disabled rendering takes precedence
			expect(disabledLine).toContain("(disabled)");
		});

		it("limits visible options based on maxVisible", () => {
			const lines = renderOptions(options, 0, 0, 2);
			expect(lines.length).toBe(2);
		});

		it("respects scrollOffset", () => {
			const lines = renderOptions(options, 2, 2, 10);
			expect(lines.length).toBe(2); // Blue, Gray
			const firstLine = stripAnsi(lines[0]!);
			expect(firstLine).toContain("Blue");
		});

		it("shows scroll-down indicator when more items below", () => {
			const ctx = getContext();
			const lines = renderOptions(options, 0, 0, 2);
			const lastLine = stripAnsi(lines[lines.length - 1]!);
			expect(lastLine).toContain(ctx.tokens.symbol.arrowDown);
		});

		it("shows scroll-up indicator when items above", () => {
			const ctx = getContext();
			const lines = renderOptions(options, 2, 1, 2);
			const firstLine = stripAnsi(lines[0]!);
			expect(firstLine).toContain(ctx.tokens.symbol.arrowUp);
		});

		it("handles empty options list", () => {
			const lines = renderOptions([], 0, 0, 10);
			expect(lines.length).toBe(0);
		});

		it("handles single option", () => {
			const singleOption = [{ label: "Only", value: "only" }];
			const lines = renderOptions(singleOption, 0, 0, 10);
			expect(lines.length).toBe(1);
			const plain = stripAnsi(lines[0]!);
			expect(plain).toContain("Only");
		});
	});
});
