import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../src/styles/tokens.css", import.meta.url), "utf8");

type Tokens = Record<string, string>;

function declarations(block: string): Tokens {
	const out: Tokens = {};
	for (const m of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
		out[m[1]] = m[2].trim();
	}
	return out;
}

/** The body of the first rule whose selector (after the rule's opening brace) equals `selector`. */
function rule(selector: string): string {
	const start = css.indexOf(`${selector} {`);
	if (start < 0) throw new Error(`no rule for ${selector}`);
	const open = css.indexOf("{", start);
	const close = css.indexOf("}", open);
	return css.slice(open + 1, close);
}

const light = declarations(rule(":root"));
const dark = { ...light, ...declarations(rule(':root[data-theme="dark"]')) };

// The system-dark media rule must carry the same values as the explicit dark rule.
const media = declarations(rule(':root:not([data-theme="light"])'));

const luminance = (hex: string): number => {
	const n = Number.parseInt(hex.slice(1), 16);
	const lin = [n >> 16, (n >> 8) & 255, n & 255].map((v) => {
		const c = v / 255;
		return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
};

const contrast = (a: string, b: string): number => {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
};

const SURFACES = ["--bg", "--surface", "--sunk"];
const ICONS = ["--icon-skill", "--icon-agent", "--icon-hook", "--icon-file", "--icon-code"];

describe.each([
	["light", light],
	["dark", dark],
])("%s theme", (_name, tokens) => {
	it.each(SURFACES)("body text is 4.5:1 or more on %s", (surface) => {
		expect(contrast(tokens["--fg"], tokens[surface])).toBeGreaterThanOrEqual(4.5);
	});

	it.each(ICONS)("%s is 3:1 or more on every surface", (icon) => {
		for (const surface of SURFACES) {
			expect(contrast(tokens[icon], tokens[surface])).toBeGreaterThanOrEqual(3);
		}
	});

	it("the five icon colours differ from each other", () => {
		expect(new Set(ICONS.map((i) => tokens[i].toLowerCase())).size).toBe(ICONS.length);
	});
});

it("the system-dark rule matches the explicit dark rule", () => {
	expect(Object.keys(media).sort()).toEqual(
		Object.keys(declarations(rule(':root[data-theme="dark"]'))).sort(),
	);
	for (const [name, value] of Object.entries(media)) {
		expect(dark[name], name).toBe(value);
	}
});
