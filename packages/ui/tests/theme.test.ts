import { describe, expect, it } from "vitest";
import { palette } from "../src/palette.js";
import { helpTheme } from "../src/theme.js";

describe("helpTheme", () => {
	it("has lineWidth config", () => {
		expect(helpTheme.lineWidth).toEqual({ max: 100 });
	});

	it("uses palette.brand for code color", () => {
		const codeColor = (helpTheme.theme as any)?.code?.color;
		expect(codeColor).toBe(`hex-${palette.brand.slice(1)}`);
	});

	it("has heading styles with indicators", () => {
		const theme = helpTheme.theme as any;
		expect(theme.h1.indicator.marker).toBeDefined();
		expect(theme.h2.indicator.marker).toBeDefined();
		expect(theme.h3.indicator.marker).toBeDefined();
	});
});
