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
	// Filled by layout.ts:
	shape: "adjacent" | "above" | "below" | "self";
	lane: number;
	slotFrom: number;
	slotTo: number;
}

export interface Lane {
	id: string;
	name: string;
	by: string;
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
