import { describe, expect, it } from "vitest";
import { MAX_TREE_DEPTH } from "../../src/model/constants";
import { normalizeLane } from "../../src/model/normalize";
import type { Lane, LaneViewInput, Row, Step } from "../../src/model/types";
import { validateLane } from "../../src/model/validate";

const row = (over: Partial<Row> = {}): Row => ({
	depth: 0,
	kind: "skill",
	name: "alpha",
	path: "skills/alpha/SKILL.md",
	own: false,
	rows: [],
	...over,
});

const step = (over: Partial<Step> = {}): Step => ({
	id: "first",
	index: 0,
	title: "First step",
	phrase: "Does the first thing",
	group: "plan",
	human: false,
	fields: {},
	handoffs: [],
	rows: [],
	...over,
});

/** A valid lane; each case changes one thing. */
const lane = (over: Partial<Lane> = {}): Lane => ({
	id: "demo",
	name: "Demo",
	by: "nobody",
	owners: [],
	steps: [step(), step({ id: "second", index: 1, title: "Second step" })],
	connectors: [],
	cover: {},
	takes: [],
	gaps: [],
	...over,
});

const connector = (from: number, to: number, ids?: [string, string]) => ({
	from,
	to,
	...(ids ? { fromId: ids[0], toId: ids[1] } : {}),
	manual: false,
	inferred: false,
	outer: false,
	pick: false,
	details: {},
	shape: "adjacent" as const,
	lane: 0,
	slotFrom: 0,
	slotTo: 0,
});

const withRows = (...rows: Row[]): Lane => lane({ steps: [step({ rows })] });
/** A chain of `levels` rows, the root at depth 0; the deepest row is named `row<levels - 1>`. */
const chain = (levels: number): Row => {
	let node: Row | undefined;
	for (let depth = levels - 1; depth >= 0; depth--) {
		const r = row({
			depth,
			name: `row${depth}`,
			...(depth > 0 ? { cite: { path: "skills/alpha/SKILL.md", lines: "1" } } : {}),
			rows: node ? [node] : [],
		});
		node = r;
	}
	return node as Row;
};
const text = (lane: Lane): string =>
	validateLane(lane)
		.map((p) => p.message)
		.join("\n");

it("a valid lane has no problem", () => {
	expect(validateLane(lane())).toEqual([]);
});

describe("tree depth (D13, C-8)", () => {
	it("allows a row at the deepest level", () => {
		expect(validateLane(withRows(chain(MAX_TREE_DEPTH + 1)))).toEqual([]);
	});

	it("fails a row one level deeper, naming lane, step and row", () => {
		const [problem, ...rest] = validateLane(withRows(chain(MAX_TREE_DEPTH + 2)));
		expect(rest).toEqual([]);
		expect(problem).toMatchObject({ lane: "demo", step: "first", row: `row${MAX_TREE_DEPTH + 1}` });
		for (const word of ["demo", "first", `row${MAX_TREE_DEPTH + 1}`])
			expect(problem.message).toContain(word);
	});

	// Built through normalizeLane: the depth arithmetic for a choice lives there.
	const rawRow = (name: string, row?: unknown) => ({
		kind: "skill",
		name,
		path: `skills/${name}/SKILL.md`,
		at: "1",
		row,
	});
	/** A root, then a choice at every level; the alternatives of the last choice are at `deepest`. */
	const throughChoices = (deepest: number) => {
		let alts: unknown[] = [rawRow(`a${deepest}`), rawRow(`b${deepest}`)];
		for (let depth = deepest - 1; depth >= 1; depth--)
			alts = [rawRow(`a${depth}`, { choice: "pick", row: alts }), rawRow(`b${depth}`)];
		const root = {
			kind: "skill",
			name: "root",
			path: "skills/root/SKILL.md",
			row: { choice: "pick", row: alts },
		};
		return normalizeLane({
			id: "demo",
			name: "Demo",
			step: { id: "first", title: "First step", phrase: "Does it", group: "plan", row: root },
		} as unknown as LaneViewInput);
	};

	it("does not count a choice group as a level", () => {
		const deepAlt = throughChoices(MAX_TREE_DEPTH).steps[0].rows[0].rows[0].rows[0];
		expect(deepAlt.depth).toBe(1);
		expect(validateLane(throughChoices(MAX_TREE_DEPTH))).toEqual([]);
		const problems = validateLane(throughChoices(MAX_TREE_DEPTH + 1));
		expect(problems.map((p) => p.row)).toEqual([
			`a${MAX_TREE_DEPTH + 1}`,
			`b${MAX_TREE_DEPTH + 1}`,
		]);
	});
});

describe("structure rules (C-20)", () => {
	const cite = { path: "skills/alpha/SKILL.md", lines: "7" };
	const twoSteps = (a: Partial<Step>, b: Partial<Step> = {}): Lane =>
		lane({ steps: [step(a), step({ id: "second", index: 1, title: "Second step", ...b })] });
	const cases: [string, Lane, RegExp][] = [
		["the lane id is a slug", lane({ id: "Not A Slug" }), /lane id must be a slug/],
		["a step id is a slug", twoSteps({ id: "Bad_Id" }), /step id must be a slug/],
		["a step id is unique", twoSteps({}, { id: "first" }), /used twice/],
		[
			"a connector endpoint exists",
			lane({ connectors: [connector(0, -1, ["first", "nowhere"])] }),
			/"first" to "nowhere".*not a step/,
		],
		[
			"an owner names a step of the lane",
			lane({ owners: [{ from: 0, to: -1, name: "ghost" }] }),
			/owner "ghost" names a step that is not in this lane/,
		],
		[
			"a connector is given once",
			lane({
				connectors: [connector(0, 1, ["first", "second"]), connector(0, 1, ["first", "second"])],
			}),
			/connector "first" to "second" is given twice/,
		],
		[
			"a hand-off names a lane by its slug",
			withSteps({ handoffs: ["Not A Lane"] }),
			/hand-off "Not A Lane"/,
		],
		[
			"a title has at most 3 words",
			withSteps({ title: "One two three four" }),
			/title .* more than 3 words/,
		],
		[
			"a phrase has at most 8 words",
			withSteps({ phrase: "a b c d e f g h i" }),
			/phrase .* more than 8 words/,
		],
		[
			"a gloss has at most 10 words",
			withRows(row({ gloss: "a b c d e f g h i j k" })),
			/gloss has more than 10 words/,
		],
		["group is one of the five", withSteps({ group: "deploy" as Step["group"] }), /group "deploy"/],
		["a root row has no at", withRows(row({ cite })), /root row has no `at`/],
		[
			"a child row has at",
			withRows(row({ rows: [row({ depth: 1, name: "child" })] })),
			/child row needs `at`/,
		],
		[
			"a child's at has a file to cite",
			withRows(row({ rows: [row({ depth: 1, name: "child", cite: { path: "", lines: "3" } })] })),
			/`at` needs a file/,
		],
		[
			"at on a directory is a problem (D22)",
			withRows(
				row({
					rows: [row({ depth: 1, name: "child", cite: { path: "skills/dir/", lines: "3" } })],
				}),
			),
			/cites the directory "skills\/dir\/"/,
		],
		[
			"a choice has two alternatives or more",
			withRows(row({ depth: 0, choice: "pick", rows: [row({ name: "only" })] })),
			/needs two alternatives/,
		],
		["a kind is a known kind", withRows(row({ kind: "gadget" as Row["kind"] })), /kind "gadget"/],
	];

	function withSteps(over: Partial<Step>): Lane {
		return lane({ steps: [step(over)] });
	}

	it.each(cases)("%s", (_name, bad, expected) => {
		expect(text(bad)).toMatch(expected);
	});
});
