import type {
	Connector,
	Lane,
	LaneViewInput,
	RawConnector,
	RawRow,
	RawStep,
	Row,
	Step,
	Warning,
} from "./types";

/** An attribute tag as Marko collects it: nothing, one value, or a value that is also iterable. */
type Many<T> = T | Iterable<T> | undefined | null;

/** One-or-many to a list, in source order. */
function many<T>(value: Many<T>): T[] {
	if (value === undefined || value === null) return [];
	if (typeof value === "object" && Symbol.iterator in (value as object))
		return [...(value as Iterable<T>)];
	return [value as T];
}

const body = (tag: Many<{ content?: Marko.Body }>): Marko.Body | undefined => many(tag)[0]?.content;

function warning(tag: Many<{ title: string; content?: Marko.Body }>): Warning | undefined {
	const raw = many(tag)[0];
	return raw ? { title: raw.title, content: raw.content as Marko.Body } : undefined;
}

/**
 * A row, and its children. A choice group is not a level: its alternatives sit at the depth the
 * group would have had, and the path a child cites by default is the nearest row's own path.
 */
function normalizeRow(raw: RawRow, depth: number, parentPath: string | undefined): Row {
	const isChoice = raw.choice !== undefined;
	const ownPath = isChoice ? parentPath : raw.path;
	const childDepth = isChoice ? depth : depth + 1;
	const row: Row = {
		depth,
		own: Boolean(raw.own),
		rows: many(raw.row).map((r: RawRow) => normalizeRow(r, childDepth, ownPath)),
	};
	if (isChoice) {
		row.choice = raw.choice;
		return row;
	}
	row.kind = raw.kind;
	row.name = raw.name;
	row.path = raw.path;
	if (raw.at !== undefined) row.cite = { path: raw.namedIn ?? parentPath ?? "", lines: raw.at };
	if (raw.word !== undefined) row.word = raw.word;
	if (raw.count !== undefined) row.count = Number(raw.count);
	if (raw.when !== undefined) row.when = raw.when;
	if (raw.manual !== undefined) row.manual = raw.manual;
	if (raw.gloss !== undefined) row.gloss = raw.gloss;
	if (raw.by !== undefined) row.by = raw.by;
	if (raw.content) row.note = raw.content;
	const w = warning(raw.warning);
	if (w) row.warning = w;
	return row;
}

const FIELDS = ["what", "via", "actor", "input", "output", "starts", "gate", "back"] as const;

function normalizeStep(raw: RawStep, index: number): Step {
	const fields: Step["fields"] = {};
	for (const name of FIELDS) {
		const content = body(raw[name]);
		if (content) fields[name] = content;
	}
	const step: Step = {
		id: raw.id,
		index,
		title: raw.title,
		phrase: raw.phrase,
		group: raw.group,
		human: Boolean(raw.human),
		fields,
		handoffs: many(raw.handoff).map((h) => h.to),
		rows: many(raw.row).map((r) => normalizeRow(r, 0, undefined)),
	};
	const w = warning(raw.warning);
	if (w) step.warning = w;
	return step;
}

const DETAILS = ["when", "by", "how", "bound", "source"] as const;

function normalizeConnector(raw: RawConnector, indexOf: Map<string, number>): Connector {
	const details: Connector["details"] = {};
	for (const name of DETAILS) {
		const content = body(raw[name]);
		if (content) details[name] = content;
	}
	const connector: Connector = {
		from: indexOf.get(raw.from) ?? -1,
		to: indexOf.get(raw.to) ?? -1,
		fromId: raw.from,
		toId: raw.to,
		manual: Boolean(raw.manual),
		inferred: Boolean(raw.inferred),
		outer: Boolean(raw.outer),
		pick: Boolean(raw.pick),
		details,
		// Filled by layout.ts.
		shape: "adjacent",
		lane: 0,
		slotFrom: 0,
		slotTo: 0,
	};
	if (raw.label !== undefined) connector.label = raw.label;
	if (raw.enforced !== undefined) connector.enforced = raw.enforced;
	return connector;
}

/** The raw attribute-tag input of a `<lane>` to the typed shapes. Nothing else reads raw input. */
export function normalizeLane(input: LaneViewInput): Lane {
	const steps = many(input.step).map((s: RawStep, i) => normalizeStep(s, i));
	const indexOf = new Map(steps.map((s) => [s.id, s.index]));
	const by = input.by;
	const lane: Lane = {
		id: input.id ?? "",
		name: input.name ?? "",
		by: typeof by === "string" ? by : "",
		owners: many(input.owner).map((o) => ({
			from: indexOf.get(o.from) ?? -1,
			to: indexOf.get(o.to) ?? -1,
			name: o.name,
			...(o.note === undefined ? {} : { note: o.note }),
		})),
		steps,
		connectors: many(input.connector).map((c: RawConnector) => normalizeConnector(c, indexOf)),
		cover: {},
		takes: many(input.take).map((t) => t.content as Marko.Body),
		gaps: many(input.gap).map((g) => g.content as Marko.Body),
	};
	if (by && typeof by !== "string") {
		const content = body(by as Many<{ content?: Marko.Body }>);
		if (content) lane.byContent = content;
	}
	if (input.status !== undefined) lane.status = input.status;
	if (input.source) lane.source = input.source;
	const summary = body(input.summary);
	if (summary) lane.summary = summary;
	const order = many(input.order)[0];
	if (order)
		lane.order = { label: order.label, lead: order.lead, content: order.content as Marko.Body };
	for (const c of many(input.cover))
		lane.cover[c.col] = c.content ? { level: c.level, content: c.content } : { level: c.level };
	return lane;
}
