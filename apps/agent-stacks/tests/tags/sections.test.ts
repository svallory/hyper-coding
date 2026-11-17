import { describe, expect, it } from "vitest";
import Sections from "./fixtures/sections.marko";

type Tag = { render(input: object): { toString(): string } };

const render = (kind: string): string =>
	(Sections as unknown as Tag).render({ case: kind }).toString();
const text = (html: string): string =>
	html
		.replace(/<svg[\s\S]*?<\/svg>/g, "")
		.replace(/<[^>]+>/g, " ")
		.replace(/\s+/g, " ")
		.trim();
const inner = (html: string, tag: string): string[] =>
	[...html.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "g"))].map((m) =>
		text(m[1]),
	);

describe("lane-nav", () => {
	const html = render("nav");

	it("renders each group with its title and what it holds, in order", () => {
		expect(text(html)).toBe("Lanes Entry Router Understand Investigation");
	});

	it("renders nothing for a group that holds nothing", () => {
		expect(html).not.toContain("Nothing here");
		expect(html.match(/data-nav-group/g)).toHaveLength(2);
	});
});

describe("reading-list", () => {
	it("renders one entry per item, in order", () => {
		expect(inner(render("reading"), "li")).toEqual(["first", "second", "third"]);
	});
});

describe("cover-table", () => {
	const html = render("cover");

	it("renders the lane heading then one header cell per column, in the order given", () => {
		expect(inner(html, "th").slice(0, 4)).toEqual([
			"Stack",
			"Requirements",
			"Design",
			"Learning kept",
		]);
	});

	it("puts the rows it is handed inside the table body", () => {
		const body = /<tbody>([\s\S]*?)<\/tbody>/.exec(html)?.[1] ?? "";
		expect(body).toContain("data-lane-row=alpha");
		expect(text(body)).toBe("alpha one");
	});
});

describe("legend-key", () => {
	const html = render("legend");
	const entries = html.split("data-key-entry").slice(1);

	it("renders one entry per item with its label, grouped under the group's title", () => {
		expect(entries.map((e) => text(`<span ${e}`.split("</span></span>")[0]))).toEqual([
			"Plan",
			"a human decides",
			"feeds the next",
			"a choice",
			"files",
			"code",
		]);
		expect(inner(html, "b")).toEqual(["Steps", "Connectors"]);
	});

	it("draws each variant's marker", () => {
		expect(html).toContain("data-swatch=plan");
		expect(html).toContain("data-icon=human");
		expect(html).toContain("data-line=dashed");
		expect(html).toContain("data-marker=pick");
		expect(html).toContain("data-icon=file");
		expect(html).toContain("data-icon=code");
	});
});
