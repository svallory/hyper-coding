import { readFileSync } from "node:fs";
import { type HTMLElement, parse } from "node-html-parser";
import { describe, expect, it } from "vitest";
import { PAGES } from "../../scripts/lib/read-site";

const dist = new URL("../../dist/public", import.meta.url).pathname;
const root = parse(readFileSync(`${dist}/${PAGES.comparison}`, "utf8"), { comment: false });
const attr = (el: HTMLElement, name: string) => el.getAttribute(name) ?? "";

describe("the comparison page", () => {
	// Each test keeps what inventory.test.ts cannot see: lane order, popover wiring and its content
	// (not the fallback), the manual chip, and the omo warning links.
	it("has the seven lanes, in the order of the navigation", () => {
		expect(root.querySelectorAll("[data-lane]").map((l) => attr(l, "id"))).toEqual([
			"superpowers",
			"pstack",
			"aihero",
			"ce",
			"omo",
			"lavra",
			"hyper",
		]);
	});

	it("explains each of its 16 manual connectors in a popover with text (AC-10)", () => {
		const manual = root.querySelectorAll("a[data-connector][data-manual]");
		expect(manual).toHaveLength(16);
		for (const edge of manual) {
			const box = edge.closest(".conn");
			const trigger = box?.querySelector("button[popovertarget]");
			const pop = box?.querySelector("[popover]");
			expect(trigger, attr(edge, "data-connector")).toBeTruthy();
			expect(attr(trigger as HTMLElement, "popovertarget")).toBe(attr(pop as HTMLElement, "id"));
			const id = attr(edge, "data-connector");
			expect(pop?.text.trim().length, id).toBeGreaterThan(0);
			// A connector without a <@when> shows this fallback; the text must come from the content.
			expect(pop?.text.trim(), id).not.toBe("A person triggers this step by hand.");
		}
	});

	it("marks 7 tree rows manual, each with the manual chip (AC-10)", () => {
		const rows = root.querySelectorAll("[data-row][data-manual]");
		expect(rows).toHaveLength(7);
		for (const row of rows) expect(row.querySelector("[data-chip='manual']")).toBeTruthy();
	});

	it("warns on the omo step 'Verify claim' with two source links that carry a line anchor (AC-10)", () => {
		const panel = root.querySelector("[data-panel='step'][id='omo/verify-claim']");
		// A tree row can carry its own warning in the Anatomy tab; the step's is outside every row.
		const warnings = (panel?.querySelectorAll("[data-warning]") ?? []).filter(
			(w) => !w.closest("[data-row]"),
		);
		expect(warnings).toHaveLength(1);
		const links = warnings[0].querySelectorAll("a[data-ref]");
		expect(links).toHaveLength(2);
		for (const a of links) expect(attr(a, "href")).toMatch(/#L\d+/);
	});
});
