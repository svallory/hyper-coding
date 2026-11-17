export type Kind =
	| "skill"
	| "command"
	| "agent"
	| "reference"
	| "playbook"
	| "rule"
	| "script"
	| "binary"
	| "harness-code"
	| "hook"
	| "tool";
export type IconId = "skill" | "agent" | "hook" | "file" | "code";
export type Group = "plan" | "build" | "check" | "ship" | "learn";

export interface Source {
	id: string;
	repo: string;
	commit: string;
	prefix: string;
}

/** One citation: a file and a line spec ("120", "150-162", "120,126"). */
export interface Cite {
	path: string;
	lines: string;
}

export interface Warning {
	title: string;
	content: Marko.Body;
}

export interface ContentProblem {
	lane: string;
	step?: string;
	row?: string;
	message: string;
}

export interface Row {
	depth: number;
	/** A choice group has a label and child rows only. */
	choice?: string;
	kind?: Kind;
	name?: string;
	path?: string;
	/** From `at` and `namedIn`, or the parent's path. */
	cite?: Cite;
	word?: string;
	count?: number;
	own: boolean;
	when?: string;
	manual?: string;
	gloss?: string;
	by?: string;
	note?: Marko.Body;
	warning?: Warning;
	rows: Row[];
}

type StepField = "what" | "via" | "actor" | "input" | "output" | "starts" | "gate" | "back";

export interface Step {
	id: string;
	index: number;
	title: string;
	phrase: string;
	group: Group;
	human: boolean;
	fields: Partial<Record<StepField, Marko.Body>>;
	warning?: Warning;
	handoffs: string[];
	rows: Row[];
}

type ConnectorDetail = "when" | "by" | "how" | "bound" | "source";

export interface Connector {
	from: number;
	to: number;
	label?: string;
	manual: boolean;
	inferred: boolean;
	outer: boolean;
	pick: boolean;
	enforced?: "prompt" | "harness" | "code";
	details: Partial<Record<ConnectorDetail, Marko.Body>>;
	/** The step ids as written, so a problem can name an endpoint that is not a step. */
	fromId?: string;
	toId?: string;
	// Filled by layout.ts:
	shape: "adjacent" | "above" | "below" | "self";
	lane: number;
	slotFrom: number;
	slotTo: number;
}

export interface Lane {
	id: string;
	name: string;
	/** The author, as text. Empty when the lane gives `<@by>` instead (see `byContent`). */
	by: string;
	/** The body of `<@by>` (playbook lanes: a reference tag, text may follow). */
	byContent?: Marko.Body;
	status?: string;
	source?: Source;
	summary?: Marko.Body;
	order?: { label: string; lead: string; content: Marko.Body };
	owners: { from: number; to: number; name: string; note?: string }[];
	steps: Step[];
	connectors: Connector[];
	cover: Record<string, { level: "explicit" | "implicit" | "absent"; content?: Marko.Body }>;
	takes: Marko.Body[];
	gaps: Marko.Body[];
}

/* ---- The raw input of `<lane>`: attribute tags as Marko collects them (single value or iterable). ---- */

/** One attribute tag: its own attributes, its body as `content`. A repeated tag is iterable. */
export type Tag<T = object> = Marko.AttrTag<T & { content?: Marko.Body }>;

export interface RawRow {
	/** A choice group: its label; the child rows are the alternatives. */
	choice?: string;
	kind?: Kind;
	name?: string;
	path?: string;
	/** The line spec, in the file that names the row (the parent's, or `namedIn`). */
	at?: string;
	namedIn?: string;
	word?: string;
	count?: number;
	own?: boolean;
	when?: string;
	manual?: string;
	gloss?: string;
	by?: string;
	content?: Marko.Body;
	warning?: Tag<{ title: string }>;
	/** Children are written only as `@row`. */
	row?: Tag<RawRowLoose>;
}

/** Rows below the first level are typed loosely, so `mtc` does not recurse (design.md "Risks"). */
export type RawRowLoose = any;

export interface RawStep {
	id: string;
	title: string;
	phrase: string;
	group: Group;
	human?: boolean;
	what?: Tag;
	via?: Tag;
	actor?: Tag;
	input?: Tag;
	output?: Tag;
	starts?: Tag;
	gate?: Tag;
	back?: Tag;
	warning?: Tag<{ title: string }>;
	handoff?: Tag<{ to: string }>;
	row?: Tag<RawRow>;
}

export interface RawConnector {
	from: string;
	to: string;
	label?: string;
	manual?: boolean;
	inferred?: boolean;
	outer?: boolean;
	pick?: boolean;
	enforced?: "prompt" | "harness" | "code";
	when?: Tag;
	by?: Tag;
	how?: Tag;
	bound?: Tag;
	source?: Tag;
}

export type LaneView = "flow" | "panels" | "nav" | "cover" | "takeaways";

/** What a content file's `<lane ...input>` receives: the view asked for, plus the file's own attributes. */
export interface LaneViewInput {
	view?: LaneView;
	/** The columns of the cover table (view `cover`). */
	cols?: string[];
	/** The text of the lane's link (view `nav`); default: the lane's name. */
	label?: string;
	id?: string;
	name?: string;
	/** Stack lanes: text. Playbook lanes: `<@by>` whose body is a reference tag. */
	by?: string | Tag;
	status?: string;
	source?: Source;
	summary?: Tag;
	order?: Tag<{ label: string; lead: string }>;
	owner?: Tag<{ from: string; to: string; name: string; note?: string }>;
	cover?: Tag<{ col: string; level: "explicit" | "implicit" | "absent" }>;
	take?: Tag;
	gap?: Tag;
	step?: Tag<RawStep>;
	connector?: Tag<RawConnector>;
}
