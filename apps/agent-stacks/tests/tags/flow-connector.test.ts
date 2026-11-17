import { describe, expect, it } from "vitest";
import type { Connector, Lane, Step } from "../../src/model/types";
import FlowConnector from "../../src/tags/flow/flow-connector.marko";
import StepNode from "../../src/tags/flow/step-node.marko";
import Manual from "../fixtures/lane-manual.marko";

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
	});

	it("renders a manual connector with details as a link to its panel and the details as the explanation", () => {
		const html = render(Manual, { view: "flow" });
		const [edge, ...rest] = tagsWith(html, "data-connector=a~b");
		expect(rest).toEqual([]);
		expect(edge.startsWith("<a")).toBe(true);
		expect(edge).toContain("href=#demo/a~b");
		expect(text(html)).toContain("The operator says go.");
	});

	it("renders an arc without a label with no invented words", () => {
		const html = render(FlowConnector, {
			lane,
			connector: connector({ from: 3, to: 0, shape: "below" }),
		});
		expect(text(html)).toBe("");
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
});
