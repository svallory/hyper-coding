import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { KINDS } from "../../src/model/kinds";

const ICONS = ["skill", "agent", "hook", "file", "code"];
const tokens = readFileSync(new URL("../../src/styles/tokens.css", import.meta.url), "utf8");
const refsDir = new URL("../../src/tags/references/", import.meta.url);
const refTags = readdirSync(refsDir).filter((f) => f.endsWith("-ref.marko"));

describe("kinds", () => {
	it.each(Object.entries(KINDS))(
		"%s has an icon, a defined colour token and a label",
		(_kind, info) => {
			expect(ICONS).toContain(info.icon);
			expect(info.label).not.toBe("");
			expect(tokens).toMatch(new RegExp(`${info.token}\\s*:`));
		},
	);

	it("the D22 tags exist and the ones it leaves out are not built", () => {
		for (const n of [
			"skill",
			"command",
			"agent",
			"hook",
			"file",
			"playbook",
			"script",
			"code",
			"binary",
			"tool",
		])
			expect(refTags).toContain(`${n}-ref.marko`);
		for (const n of ["rule", "step", "stack", "artifact"])
			expect(refTags).not.toContain(`${n}-ref.marko`);
	});

	it.each(refTags)("%s passes exactly one kind, from the list", (file) => {
		const src = readFileSync(new URL(file, refsDir), "utf8");
		const passed = [...src.matchAll(/\bkind="([^"]+)"/g)].map((m) => m[1]);
		expect(passed).toHaveLength(1);
		expect(Object.keys(KINDS)).toContain(passed[0]);
	});
});
