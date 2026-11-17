import { beforeAll, describe, expect, it } from "vitest";
import By from "../fixtures/lane-by.marko";
import Deep from "../fixtures/lane-deep.marko";
import Dir from "../fixtures/lane-dir.marko";
import Ok from "../fixtures/lane-ok.marko";

type Tag = { render(input: object): { toString(): string } };
const render = (tag: unknown, input: object): string => (tag as Tag).render(input).toString();

/** The opening tags in `html` that carry every one of `attrs` (Marko leaves values unquoted when it can). */
const tagsWith = (html: string, ...attrs: string[]): string[] =>
	[...html.matchAll(/<[a-z][^>]*>/g)]
		.map((m) => m[0])
		.filter((t) => attrs.every((a) => t.includes(a)));
const text = (html: string): string =>
	html
		.replace(/<svg[\s\S]*?<\/svg>/g, "")
		.replace(/<[^>]+>/g, " ")
		.replace(/\s+/g, " ")
		.trim();

describe("a valid lane, view panels", () => {
	let html: string;
	beforeAll(() => {
		html = render(Ok, { view: "panels" });
	});

	it("renders a hand-off as a link with data-handoff and the lane's href", () => {
		const [link, ...rest] = tagsWith(html, "data-handoff=other-lane");
		expect(rest).toEqual([]);
		expect(link).toContain("href=#other-lane");
		expect(link.startsWith("<a ")).toBe(true);
	});

	it("renders a manual row with data-manual and its chip and sentence", () => {
		const [row, ...rest] = tagsWith(html, "data-row", "data-manual");
		expect(rest).toEqual([]);
		expect(row).toContain("data-depth=1");
		expect(html).toContain("data-chip=manual");
		expect(text(html)).toContain("The operator starts it by hand");
	});
});

describe("a lane with a content problem", () => {
	it("renders pre[data-content-error] naming lane, step and row, in place of the view", () => {
		const html = render(Deep, { view: "flow" });
		const errors = [...html.matchAll(/<pre data-content-error>([\s\S]*?)<\/pre>/g)].map(
			(m) => m[1],
		);
		expect(errors).toHaveLength(1);
		for (const word of ["demo", "deep", "d5"]) expect(errors[0]).toContain(word);
		expect(html).not.toContain("data-lane");
		expect(html).not.toContain("data-step");
	});

	it("shows a directory row's name link to the tree and a slot with the parent file's line (D22)", () => {
		const html = render(Dir, { view: "panels" });
		const [name] = tagsWith(html, "data-ref=playbook", "/tree/");
		expect(name).toContain("skills/poteto-mode/playbooks/");
		const [slot] = tagsWith(html, "data-slot");
		expect(slot).toContain("data-lines=108");
		expect(slot).toContain("skills/poteto-mode/SKILL.md?plain=1#L108");
	});
});

describe("a lane's `by`", () => {
	it("shows an attribute tag's reference tag, and the text after it, where the text form shows", () => {
		const html = render(By, { view: "flow" });
		const by = /<p class=lane-by data-lane-by>([\s\S]*?)<\/p>/.exec(html)?.[1] ?? "";
		expect(by).toContain("data-ref=playbook");
		expect(text(by)).toBe("bug-fix.md · a playbook");
		expect(
			text(
				/<p class=lane-by data-lane-by>([\s\S]*?)<\/p>/.exec(render(Ok, { view: "flow" }))?.[1] ??
					"",
			),
		).toBe("nobody");
	});
});
