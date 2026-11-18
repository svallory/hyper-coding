import { describe, expect, it } from "vitest";
import type { Connector, Lane, Step } from "../../src/model/types";
import FlowConnector from "../../src/tags/flow/flow-connector.marko";
import StepNode from "../../src/tags/flow/step-node.marko";
import Manual from "../fixtures/lane-manual.marko";
import Ok from "../fixtures/lane-ok.marko";

type Tag = { render(input: object): { toString(): string } };
const render = (tag: unknown, input: object): string => (tag as Tag).render(input).toString();
const text = (html: string): string =>
	html
		.replace(/<(svg|script)[\s\S]*?<\/\1>/g, "")
		.replace(/<[^>]+>/g, " ")
		.replace(/\s+/g, " ")
		.trim();
const tagsWith = (html: string, ...attrs: string[]): string[] =>
	[...html.matchAll(/<[a-z][^>]*>/g)]
		.map((m) => m[0])
		.filter((t) => attrs.every((a) => t.includes(a)));

const step = (id: string, index: number, over: Partial<Step> = {}): Step => ({
	id,
	index,
	title: `Title ${id}`,
	phrase: `Phrase ${id}`,
	group: "plan",
	human: false,
	fields: {},
	handoffs: [],
	rows: [],
	...over,
});

const lane = { id: "demo", steps: ["a", "b", "c", "d"].map((id, i) => step(id, i)) } as Lane;

const connector = (over: Partial<Connector>): Connector => ({
	from: 0,
	to: 1,
	manual: false,
	inferred: false,
	outer: false,
	pick: false,
	details: {},
	shape: "adjacent",
	lane: 0,
	slotFrom: 0,
	slotTo: 0,
	...over,
});

describe("flow-connector", () => {
	it("renders a plain connector as an element with data-connector and no link", () => {
		const html = render(FlowConnector, { lane, connector: connector({}) });
		const [edge, ...rest] = tagsWith(html, "data-connector=a~b");
		expect(rest).toEqual([]);
		expect(edge.startsWith("<div")).toBe(true);
		expect(html).not.toContain("href");
		for (const hook of ["data-manual", "data-inferred", "data-outer"])
			expect(html).not.toContain(hook);
	});

	it("renders a manual connector without details as an element with the marker and the fallback sentence", () => {
		const html = render(FlowConnector, { lane, connector: connector({ manual: true }) });
		const [edge] = tagsWith(html, "data-connector=a~b");
		expect(edge).toContain("data-manual");
		expect(edge.startsWith("<div")).toBe(true);
		expect(html).toContain("data-manual-marker");
		expect(text(html)).toContain("A person triggers this step by hand.");
		expect(edge).not.toContain("aria-label");
	});

	it("renders a manual connector with details as a link to its panel and the details as the explanation", () => {
		const html = render(Manual, { view: "flow" });
		const [edge, ...rest] = tagsWith(html, "data-connector=a~b");
		expect(rest).toEqual([]);
		expect(edge.startsWith("<a")).toBe(true);
		expect(edge).toContain("href=#demo/a~b");
		expect(text(html)).toContain("The operator says go.");
		expect(edge).toContain('aria-label="Title a to Title b (manual)"');
	});

	it("draws the manual mark as the person icon, with no question mark and no pill (AC-10)", () => {
		const html = render(Manual, { view: "flow" });
		expect(tagsWith(html, "data-icon=manual").length).toBeGreaterThan(0);
		expect(html).not.toContain("data-ui-icon=help");
		expect(html).not.toContain("conn-pill");
	});

	it("renders an arc without a label with no invented words", () => {
		const html = render(FlowConnector, {
			lane,
			connector: connector({ from: 3, to: 0, shape: "below" }),
		});
		expect(text(html)).toBe("");
		expect(html).not.toContain("aria-label");
	});

	const details = { when: (() => {}) as never };
	const linkedArcs: [string, Partial<Connector>, string, string | undefined][] = [
		["a label", { label: "rework" }, "rework", undefined],
		["the manual flag", { manual: true }, "manual", undefined],
		["a label and the manual flag", { label: "rework", manual: true }, "manual: rework", undefined],
		["neither", {}, "", "Title d to Title a"],
	];
	it.each(linkedArcs)(
		"names a linked arc with %s by its visible text, or by its steps when it has none",
		(_name, over, visible, ariaLabel) => {
			const html = render(FlowConnector, {
				lane,
				connector: connector({ from: 3, to: 0, shape: "below", details, ...over }),
			});
			const [edge] = tagsWith(html, "data-connector=d~a");
			expect(edge.startsWith("<a")).toBe(true);
			if (visible) expect(text(html)).toContain(visible);
			else expect(text(html)).toBe("");
			if (ariaLabel) expect(edge).toContain(`aria-label="${ariaLabel}"`);
			else expect(edge).not.toContain("aria-label");
		},
	);

	it("names a linked adjacent edge by its steps and the label", () => {
		const html = render(FlowConnector, {
			lane,
			connector: connector({ label: "go", details }),
		});
		expect(tagsWith(html, "data-connector=a~b")[0]).toContain(
			'aria-label="Title a to Title b: go"',
		);
	});

	it("renders an inferred outer back edge as an arc labelled in visible text, with both hooks", () => {
		const html = render(FlowConnector, {
			lane,
			connector: connector({
				from: 3,
				to: 0,
				label: "feeds the next work",
				inferred: true,
				outer: true,
				shape: "below",
			}),
		});
		const [edge] = tagsWith(html, "data-connector=d~a");
		expect(edge).toContain("data-inferred");
		expect(edge).toContain("data-outer");
		expect(text(html)).toContain("feeds the next work");
		expect(html).not.toContain("href");
	});
});

describe("step-node", () => {
	it("renders a link to #<lane>/<step> with data-step", () => {
		const html = render(StepNode, { lane, step: lane.steps[2] });
		const [link] = tagsWith(html, "data-step=c");
		expect(link.startsWith("<a")).toBe(true);
		expect(link).toContain("href=#demo/c");
		expect(text(html)).toContain("Title c");
	});

	it("marks a step a human decides", () => {
		const human = step("h", 1, { human: true });
		expect(tagsWith(render(StepNode, { lane, step: human }), "data-human-marker")).toHaveLength(1);
		expect(render(StepNode, { lane, step: lane.steps[0] })).not.toContain("data-human-marker");
	});

	it("shows the card as '<n> <Group>', with the person icon and not the word 'human' (AC-9)", () => {
		const human = step("h", 1, { human: true, group: "build" });
		const html = render(StepNode, { lane, step: human });
		expect(text(html)).toContain("2 Build");
		expect(text(html)).not.toMatch(/human/i);
		expect(html).toContain("data-ui-icon=manual");
	});

	it("counts what runs a step in two badges, each a link to the panel with its label (AC-9)", () => {
		const view = Ok as unknown as Tag;
		const html = view.render({ view: "flow" }).toString();
		const badges = tagsWith(html, "class=badge ");
		expect(badges).toHaveLength(2);
		expect(badges[0]).toContain('aria-label="Skills and Files: 1. Open First step"');
		expect(badges[1]).toContain('aria-label="Tools and Hooks: 1. Open First step"');
		for (const b of badges) expect(b).toContain("href=#demo/first");
		// The floating list lists the names behind each count and is not shown without script.
		expect(tagsWith(html, "badge-pop", "popover=manual")).toHaveLength(2);
		expect(html).toMatch(/badge-pop-name>alpha</);
		expect(html).toMatch(/badge-pop-name>run\.sh</);
		expect(html).toContain("badge-pop-man");
	});
});
