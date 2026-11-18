import { parse } from "node-html-parser";
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
	const bar = (kind: string) => parse(render(kind)).querySelector("nav.site-nav");
	const links = (kind: string) =>
		(bar(kind)?.querySelectorAll(".tl a") ?? []).map((a) => a.text.trim());

	it("renders each group's links in order, and nothing for an empty group", () => {
		expect(links("nav")).toEqual(["Router", "Investigation"]);
		expect(bar("nav")?.querySelectorAll("[data-nav-group]")).toHaveLength(2);
		expect(render("nav")).not.toContain("Nothing here");
	});

	it("renders the section links after the lanes", () => {
		expect(links("nav-comparison")).toEqual(["alpha", "Questions"]);
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
	// [label, the marker the entry must draw]
	const expected: [string, string][] = [
		["Plan", "data-swatch=plan"],
		["Build", "data-swatch=build"],
		["Check", "data-swatch=check"],
		["Ship", "data-swatch=ship"],
		["Learn", "data-swatch=learn"],
		["A human decides", "data-swatch=human"],
		["a human is here", "data-icon=human"],
		["a warning inside", "data-ui-icon=warning"],
		["next step", "data-line=solid"],
		["feeds the next", "data-line=dashed"],
		["our inference", "data-line=dotted"],
		["operator asks", "data-ui-icon=manual"],
		["a choice", "data-marker=pick"],
		["name column heading", "key-sample"],
		["files", "data-icon=file"],
		["code", "data-icon=code"],
	];
	const html = render("legend");
	const entries = html.split("data-key-entry").slice(1);

	it("draws every entry with its label and its marker, under the group's title", () => {
		expect(entries).toHaveLength(expected.length);
		entries.forEach((e, i) => {
			const [label, marker] = expected[i];
			expect(text(`<span ${e}`.split("</span></span>")[0])).toBe(label);
			expect(e).toContain(marker);
		});
		expect(inner(html, "b")).toEqual(["Steps", "Connectors", "What runs a step"]);
	});
});
