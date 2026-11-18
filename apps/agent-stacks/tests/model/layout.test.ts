import { describe, expect, it } from "vitest";
import {
	assignSlots,
	bandHeight,
	COL_MAX,
	COL_MIN,
	type Edge,
	edgeClass,
	flowMinWidth,
	layoutLane,
	packLanes,
	type Shape,
} from "../../src/model/layout";
import type { Connector } from "../../src/model/types";

/** The pstack lane's connectors, as step indexes (steps 0 to 8). */
const PSTACK: (Edge & { shape: Shape })[] = [
	{ from: 0, to: 1, shape: "adjacent" },
	{ from: 1, to: 2, shape: "adjacent" },
	{ from: 2, to: 3, shape: "adjacent" },
	{ from: 3, to: 4, shape: "adjacent" },
	{ from: 4, to: 5, shape: "adjacent" },
	{ from: 5, to: 6, shape: "adjacent" },
	{ from: 6, to: 7, shape: "adjacent" },
	{ from: 7, to: 8, shape: "adjacent" },
	{ from: 1, to: 1, shape: "self" },
	{ from: 4, to: 3, shape: "below" },
	{ from: 6, to: 3, shape: "below" },
	{ from: 7, to: 3, shape: "below" },
	{ from: 8, to: 0, shape: "below", outer: true },
];

const asConnector = (e: Edge): Connector => ({
	from: e.from,
	to: e.to,
	manual: false,
	inferred: false,
	outer: Boolean(e.outer),
	pick: false,
	details: {},
	shape: "adjacent",
	lane: 0,
	slotFrom: 0,
	slotTo: 0,
});

describe("edgeClass", () => {
	it("follows from the endpoints, for the pstack lane's edge list", () => {
		expect(PSTACK.map((e) => edgeClass(e))).toEqual(PSTACK.map((e) => e.shape));
	});

	it.each<[string, Edge, Shape]>([
		["a forward skip", { from: 1, to: 4 }, "above"],
		["an outer edge to the next step", { from: 2, to: 3, outer: true }, "below"],
		["an outer edge that skips forward", { from: 0, to: 5, outer: true }, "below"],
		["an outer self edge", { from: 2, to: 2, outer: true }, "self"],
	])("places %s", (_name, edge, shape) => {
		expect(edgeClass(edge)).toBe(shape);
	});
});

describe("packLanes", () => {
	it("packs the pstack lane's arcs below the nodes into four lanes, nested ones inside", () => {
		// the self loop (1,1), 4 to 3, 6 to 3, 7 to 3 and the outer 8 to 0, as column spans
		const spans = [
			{ lo: 1, hi: 1 },
			{ lo: 3, hi: 4 },
			{ lo: 3, hi: 6 },
			{ lo: 3, hi: 7 },
			{ lo: 0, hi: 8 },
		];
		expect(packLanes(spans)).toEqual({ lanes: [0, 0, 1, 2, 3], count: 4 });
	});

	type Pairs = [number, number][];
	const cases: [string, Pairs, number[], number][] = [
		["no arc", [], [], 0],
		[
			"arcs that do not overlap share lane 0",
			[
				[0, 1],
				[2, 3],
				[5, 6],
			],
			[0, 0, 0],
			1,
		],
		[
			"arcs that share a column take different lanes",
			[
				[0, 2],
				[2, 4],
			],
			[0, 1],
			2,
		],
		[
			"the shorter arc takes lane 0 whatever the order",
			[
				[0, 5],
				[1, 2],
			],
			[1, 0],
			2,
		],
		[
			"three nested arcs",
			[
				[0, 6],
				[1, 5],
				[2, 4],
			],
			[2, 1, 0],
			3,
		],
	];
	it.each(cases)("%s", (_name, pairs, lanes, count) => {
		const packed = packLanes(pairs.map(([lo, hi]) => ({ lo, hi })));
		expect(packed.lanes).toEqual(lanes);
		expect(packed.count).toBe(count);
	});
});

describe("assignSlots", () => {
	it("gives the arcs that arrive at one node distinct slots, the deepest nearest the centre", () => {
		const { connectors } = layoutLane(PSTACK.map(asConnector));
		const arrivals = connectors.filter((c) => c.to === 3 && c.shape === "below");
		expect(arrivals.map((c) => [c.from, c.lane, c.slotTo])).toEqual([
			[4, 0, 2],
			[6, 1, 1],
			[7, 2, 0],
		]);
	});

	it("gives an arc that leaves a node and one that arrives there distinct slots, past a self loop", () => {
		const slots = assignSlots([
			{ from: 2, to: 0, shape: "below", lane: 1 },
			{ from: 4, to: 2, shape: "below", lane: 0 },
			{ from: 3, to: 3, shape: "self", lane: 0 },
			{ from: 5, to: 3, shape: "below", lane: 0 },
		]);
		expect(slots).toEqual([
			{ slotFrom: 0, slotTo: 0 },
			{ slotFrom: 0, slotTo: 0 },
			{ slotFrom: 0, slotTo: 0 },
			{ slotFrom: 0, slotTo: 1 },
		]);
	});

	it("uses no slot for adjacent and self connectors", () => {
		const slots = assignSlots([
			{ from: 0, to: 1, shape: "adjacent", lane: 0 },
			{ from: 2, to: 2, shape: "self", lane: 0 },
		]);
		expect(slots).toEqual([
			{ slotFrom: 0, slotTo: 0 },
			{ slotFrom: 0, slotTo: 0 },
		]);
	});
});

describe("bandHeight", () => {
	it.each([
		[0, 0],
		[1, 42],
		[3, 90],
	])("%i lanes make a band of %i px (a side with no arc has none)", (lanes, px) => {
		expect(bandHeight(lanes)).toBe(px);
	});
});

describe("layoutLane", () => {
	it("is a pure function: the same edges give the same layout and the input is unchanged", () => {
		const input = PSTACK.map(asConnector);
		const before = JSON.stringify(input);
		const a = layoutLane(input);
		expect(layoutLane(input)).toEqual(a);
		expect(JSON.stringify(input)).toBe(before);
		expect(a).toMatchObject({ aboveHeight: 0, belowHeight: 114 });
	});
});

describe("flowMinWidth", () => {
	// A 1440 px window leaves 1288 px for the page and 1286 px inside the lane's card.
	const CARD_INNER = 1286;

	it("fits Superpowers' 8 steps in the card at 1440 px, and not 9 (pstack scrolls inside its card)", () => {
		expect(flowMinWidth(8)).toBeLessThanOrEqual(CARD_INNER);
		expect(flowMinWidth(9)).toBeGreaterThan(CARD_INNER);
		expect(COL_MIN).toBeLessThan(COL_MAX);
	});
});
