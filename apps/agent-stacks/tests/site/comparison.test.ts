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

	it("gives each lane with a source one repository link at its pinned commit (AC-7)", () => {
		const lanes = root.querySelectorAll("[data-lane]");
		const linked = lanes.filter((l) => l.querySelector(".lane-head [data-lane-source]"));
		// The Hyper lane is this project's own proposal: it has no repository to point at.
		expect(linked.map((l) => attr(l, "id"))).toEqual([
			"superpowers",
			"pstack",
			"aihero",
			"ce",
			"omo",
			"lavra",
		]);
		for (const lane of linked) {
			const links = lane.querySelectorAll(".lane-head [data-lane-source]");
			expect(links, attr(lane, "id")).toHaveLength(1);
			expect(attr(links[0], "href")).toMatch(
				/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/tree\/[0-9a-f]{40}$/,
			);
			expect(links[0].text).toMatch(/^[\w.-]+\/[\w.-]+ @[0-9a-f]{7}$/);
		}
	});

	it.each(["comparison", "playbooks"] as const)(
		"describes point, pin, release and Esc in the %s how-to-read paragraph (D38)",
		(page) => {
			const html = readFileSync(`${dist}/${PAGES[page]}`, "utf8");
			expect(html).toContain("Click to pin");
			expect(html).not.toContain("close control");
		},
	);
});
