import chalk from "chalk";
import { describe, expect, it } from "vitest";
import { md } from "../src/md.js";
import { palette } from "../src/palette.js";

describe("md (inline markdown)", () => {
	it("transforms backtick spans to command color", () => {
		const result = md("Run `hyper init` to start");
		const expected = `Run ${chalk.hex(palette.brand)("hyper init")} to start`;
		expect(result).toBe(expected);
	});

	it("transforms **bold** to chalk.bold", () => {
		const result = md("This is **important**");
		const expected = `This is ${chalk.bold("important")}`;
		expect(result).toBe(expected);
	});

	it("transforms *dim* to chalk.dim", () => {
		const result = md("This is *subtle*");
		const expected = `This is ${chalk.dim("subtle")}`;
		expect(result).toBe(expected);
	});

	it("handles multiple backtick spans", () => {
		const result = md("Use `kit install` then `hyper run`");
		expect(result).toContain(chalk.hex(palette.brand)("kit install"));
		expect(result).toContain(chalk.hex(palette.brand)("hyper run"));
	});

	it("handles mixed markdown", () => {
		const result = md("Run `hyper init` for **quick** setup");
		expect(result).toContain(chalk.hex(palette.brand)("hyper init"));
		expect(result).toContain(chalk.bold("quick"));
	});

	it("returns plain text unchanged when no markdown", () => {
		const result = md("Hello world");
		expect(result).toBe("Hello world");
	});

	it("does not treat **bold** stars inside bold as dim", () => {
		const result = md("This is **very bold**");
		expect(result).toBe(`This is ${chalk.bold("very bold")}`);
	});
});
