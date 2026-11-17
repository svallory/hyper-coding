import type { Connector } from "./types";

/** The part of a connector the layout reads. */
export interface Edge {
	from: number;
	to: number;
	outer?: boolean;
}

export type Shape = Connector["shape"];

/** The columns an arc covers, both ends included. */
export interface Span {
	lo: number;
	hi: number;
}

/** First anchor sits this far from the node's centre; each further one is this much further out. */
export const SLOT_FIRST = 10;
export const SLOT_STEP = 12;

/** The band above or below the nodes needs room for each lane of arcs: `18 + lanes*24` px. */
export const BAND_BASE = 18;
export const BAND_LANE = 24;

/**
 * A connector's class from its endpoints. The next step is `adjacent`; going to the same step is
 * `self`; a forward skip is `above`; a back edge is `below`. An `outer` connector is never
 * `adjacent` or `above`: it feeds the next piece of work, so it is drawn as a back edge.
 */
export function edgeClass(edge: Edge): Shape {
	if (edge.from === edge.to) return "self";
	if (edge.outer) return "below";
	if (edge.to === edge.from + 1) return "adjacent";
	return edge.to > edge.from ? "above" : "below";
}

/**
 * Packs arcs of one side into lanes, shortest first: an arc takes the lowest lane where it shares
 * no column with an arc already there, so a nested arc sits inside the one that spans it. Returns
 * each arc's lane (in the order given) and how many lanes were used.
 */
export function packLanes(spans: Span[]): { lanes: number[]; count: number } {
	const order = spans
		.map((s, i) => ({ ...s, i }))
		.sort((a, b) => a.hi - a.lo - (b.hi - b.lo) || a.i - b.i);
	const used: Span[][] = [];
	const lanes: number[] = new Array(spans.length).fill(0);
	for (const e of order) {
		let lane = 0;
		while ((used[lane] ?? []).some((o) => !(e.hi < o.lo || e.lo > o.hi))) lane++;
		used[lane] = used[lane] ?? [];
		used[lane].push(e);
		lanes[e.i] = lane;
	}
	return { lanes, count: used.length };
}

/** Height in px of the band above or below the nodes; a side with no arc has none. */
export function bandHeight(lanes: number): number {
	return lanes > 0 ? BAND_BASE + lanes * BAND_LANE : 0;
}

export interface Slots {
	slotFrom: number;
	slotTo: number;
}

/**
 * Anchor slots: arcs that meet at one node on the same side, leaving the same way, take distinct
 * slots (0 is nearest the centre). The deepest lane takes the nearest slot, so a shallower arc
 * never crosses a deeper one. Adjacent and self connectors use no slot, but a self loop hangs below
 * its node, so the arcs there start past its legs (slot 1 on both sides).
 */
export function assignSlots(
	edges: { from: number; to: number; shape: Shape; lane: number }[],
): Slots[] {
	const slots: Slots[] = edges.map(() => ({ slotFrom: 0, slotTo: 0 }));
	const taken = new Map<string, number>();
	for (const e of edges) {
		if (e.shape !== "self") continue;
		taken.set(`${e.from}:below:1`, 1);
		taken.set(`${e.from}:below:-1`, 1);
	}
	const next = (node: number, side: string, dir: number): number => {
		const key = `${node}:${side}:${dir}`;
		const n = taken.get(key) ?? 0;
		taken.set(key, n + 1);
		return n;
	};
	const order = edges.map((_, i) => i).sort((a, b) => edges[b].lane - edges[a].lane || a - b);
	for (const i of order) {
		const e = edges[i];
		if (e.shape !== "above" && e.shape !== "below") continue;
		const way = e.to > e.from ? 1 : -1;
		slots[i].slotFrom = next(e.from, e.shape, way);
		slots[i].slotTo = next(e.to, e.shape, -way);
	}
	return slots;
}

export interface Layout {
	connectors: Connector[];
	/** Band heights in px; a self loop sits in the band below. */
	aboveHeight: number;
	belowHeight: number;
}

/** A lane's whole layout: a pure function of its connectors. Returns copies; nothing is changed. */
export function layoutLane(connectors: Connector[]): Layout {
	const shapes = connectors.map((c) => edgeClass(c));
	const lane = connectors.map(() => 0);
	let counts = { above: 0, below: 0 };
	for (const side of ["above", "below"] as const) {
		const idx = connectors
			.map((_, i) => i)
			.filter((i) =>
				side === "above" ? shapes[i] === "above" : shapes[i] === "below" || shapes[i] === "self",
			);
		const packed = packLanes(
			idx.map((i) => ({
				lo: Math.min(connectors[i].from, connectors[i].to),
				hi: Math.max(connectors[i].from, connectors[i].to),
			})),
		);
		idx.forEach((i, k) => {
			lane[i] = packed.lanes[k];
		});
		counts = { ...counts, [side]: packed.count };
	}
	const slots = assignSlots(
		connectors.map((c, i) => ({ from: c.from, to: c.to, shape: shapes[i], lane: lane[i] })),
	);
	return {
		connectors: connectors.map((c, i) => ({ ...c, shape: shapes[i], lane: lane[i], ...slots[i] })),
		aboveHeight: bandHeight(counts.above),
		belowHeight: bandHeight(counts.below),
	};
}
