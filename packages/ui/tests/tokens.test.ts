import { describe, expect, it } from "vitest";
import { palette } from "../src/palette.js";
import { tokens } from "../src/tokens.js";

describe("tokens", () => {
	it("maps status tokens to palette colors", () => {
		expect(tokens.success).toBe(palette.green);
		expect(tokens.error).toBe(palette.red);
		expect(tokens.warning).toBe(palette.yellow);
		expect(tokens.info).toBe(palette.blue);
		expect(tokens.tip).toBe(palette.tipBlue);
		expect(tokens.muted).toBe(palette.gray);
	});

	it("maps command to brand color", () => {
		expect(tokens.command).toBe(palette.brand);
	});

	it("maps danger to danger color", () => {
		expect(tokens.danger).toBe(palette.danger);
	});

	it("maps CLI entity tokens", () => {
		expect(tokens.kit).toBe(palette.magenta);
		expect(tokens.recipe).toBe(palette.cyan);
		expect(tokens.cookbook).toBe(palette.magenta);
	});
});
