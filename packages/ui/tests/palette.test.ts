import { describe, expect, it } from "vitest";
import { palette } from "../src/palette.js";

describe("palette", () => {
	it("exports brand color as hex", () => {
		expect(palette.brand).toBe("#4EC9B0");
	});

	it("exports danger color as hex", () => {
		expect(palette.danger).toBe("#F67280");
	});

	it("exports tipBlue as hex", () => {
		expect(palette.tipBlue).toBe("#7FB3D5");
	});

	it("exports terminal builtin color names", () => {
		expect(palette.red).toBe("red");
		expect(palette.green).toBe("green");
		expect(palette.yellow).toBe("yellow");
		expect(palette.blue).toBe("blue");
		expect(palette.magenta).toBe("magenta");
		expect(palette.cyan).toBe("cyan");
		expect(palette.gray).toBe("gray");
		expect(palette.white).toBe("white");
	});
});
