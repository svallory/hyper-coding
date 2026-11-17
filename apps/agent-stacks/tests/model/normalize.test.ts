import { expect, it } from "vitest";
import { normalizeLane } from "../../src/model/normalize";
import type { LaneViewInput } from "../../src/model/types";

const body = (text: string) => text as unknown as Marko.Body;
/** What Marko collects for a repeated attribute tag: the first item, iterable over all. */
const repeated = <T extends object>(...items: T[]) =>
	Object.assign({ ...items[0] }, { [Symbol.iterator]: () => items[Symbol.iterator]() });

const raw = {
	id: "demo",
	name: "Demo",
	by: "somebody",
	owner: { from: "second", to: "second", name: "the second", note: "skill" },
	take: repeated({ content: body("take 1") }, { content: body("take 2") }),
	cover: { col: "req", level: "explicit", content: body("covered") },
	step: repeated(
		{
			id: "first",
			title: "First",
			phrase: "The first",
			group: "plan",
			what: { content: body("what") },
			handoff: repeated({ to: "lane-a" }, { to: "lane-b" }),
			row: repeated(
				{
					kind: "skill",
					name: "alpha",
					path: "skills/alpha/SKILL.md",
					own: true,
					row: repeated(
						{ kind: "script", name: "run.sh", path: "skills/alpha/run.sh", at: "7", count: 3 },
						{
							kind: "rule",
							name: "worker.md",
							path: "skills/other/worker.md",
							at: "20",
							namedIn: "skills/other/SKILL.md",
						},
						{
							choice: "which one",
							row: repeated(
								{ kind: "skill", name: "x", path: "skills/x/SKILL.md", at: "1" },
								{ kind: "skill", name: "y", path: "skills/y/SKILL.md", at: "2" },
							),
						},
					),
				},
				{ kind: "skill", name: "beta", path: "skills/beta/SKILL.md" },
			),
		},
		{ id: "second", title: "Second", phrase: "The second", group: "build", human: true },
	),
	connector: {
		from: "first",
		to: "second",
		manual: true,
		label: "go",
		when: { content: body("when") },
	},
} as unknown as LaneViewInput;

const lane = normalizeLane(raw);

it("turns one-or-many attribute tags into lists, in source order", () => {
	expect(lane.steps.map((s) => s.id)).toEqual(["first", "second"]);
	expect(lane.takes).toEqual(["take 1", "take 2"]);
	expect(lane.steps[0].handoffs).toEqual(["lane-a", "lane-b"]);
	expect(lane.steps[0].rows.map((r) => r.name)).toEqual(["alpha", "beta"]);
	expect(lane.owners).toHaveLength(1);
	expect(lane.steps[0].fields).toEqual({ what: "what" });
	expect(lane.cover.req).toEqual({ level: "explicit", content: "covered" });
});

it("turns step ids into indexes on connectors and owners", () => {
	expect(lane.steps.map((s) => s.index)).toEqual([0, 1]);
	expect(lane.connectors[0]).toMatchObject({
		from: 0,
		to: 1,
		fromId: "first",
		toId: "second",
		manual: true,
		label: "go",
	});
	expect(lane.connectors[0].details).toEqual({ when: "when" });
	expect(lane.owners[0]).toEqual({ from: 1, to: 1, name: "the second", note: "skill" });
});

it("cites the parent's path, or `namedIn` when the file that names the row is another", () => {
	const alpha = lane.steps[0].rows[0];
	expect(alpha.rows[0].cite).toEqual({ path: "skills/alpha/SKILL.md", lines: "7" });
	expect(alpha.rows[1].cite).toEqual({ path: "skills/other/SKILL.md", lines: "20" });
	expect(alpha.cite).toBeUndefined();
});

it("gives rows their depth, and a choice keeps its label and alternatives at one depth", () => {
	const alpha = lane.steps[0].rows[0];
	expect([alpha.depth, alpha.rows[0].depth]).toEqual([0, 1]);
	const choice = alpha.rows[2];
	expect(choice.choice).toBe("which one");
	expect(choice.depth).toBe(1);
	expect(choice.rows.map((r) => [r.name, r.depth])).toEqual([
		["x", 1],
		["y", 1],
	]);
	// A choice does not change the path its alternatives cite.
	expect(choice.rows[0].cite).toEqual({ path: "skills/alpha/SKILL.md", lines: "1" });
	expect(alpha.own).toBe(true);
	expect(alpha.rows[0].count).toBe(3);
});

it("resolves an endpoint that is not a step to -1", () => {
	const bad = normalizeLane({
		id: "x",
		step: { id: "a", title: "A", phrase: "A", group: "plan" },
		connector: repeated({ from: "a", to: "nope" }, { from: "nope", to: "a" }),
	} as unknown as LaneViewInput);
	expect(bad.connectors[0]).toMatchObject({ from: 0, to: -1, toId: "nope" });
	expect(bad.connectors[1]).toMatchObject({ from: -1, to: 0, fromId: "nope" });
});
