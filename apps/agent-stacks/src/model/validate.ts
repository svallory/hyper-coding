import { MAX_TREE_DEPTH } from "./constants";
import { KINDS } from "./kinds";
import type { ContentProblem, Lane, Row, Step } from "./types";

const SLUG = /^[a-z0-9-]+$/;
const GROUPS = ["plan", "build", "check", "ship", "learn"];
const MAX_TITLE_WORDS = 3;
const MAX_PHRASE_WORDS = 8;
const MAX_GLOSS_WORDS = 10;

const words = (text: string): number => text.trim().split(/\s+/).filter(Boolean).length;

/**
 * The structure rules of one lane (C-20, D13, D22). Every problem names the lane, and the step and
 * row when it has them, in its own text: the build shows `message` as it is. That a hand-off's
 * target lane exists is not checkable here (one lane); the built-HTML tests assert it.
 */
export function validateLane(lane: Lane): ContentProblem[] {
	const problems: ContentProblem[] = [];
	const laneName = lane.id || "(no id)";

	const report = (message: string, step?: string, row?: string) => {
		const where = [`lane "${laneName}"`];
		if (step !== undefined) where.push(`step "${step}"`);
		if (row !== undefined) where.push(`row "${row}"`);
		const problem: ContentProblem = { lane: laneName, message: `${where.join(", ")}: ${message}` };
		if (step !== undefined) problem.step = step;
		if (row !== undefined) problem.row = row;
		problems.push(problem);
	};

	if (!SLUG.test(lane.id)) report("the lane id must be a slug ([a-z0-9-]+).");

	const seen = new Set<string>();
	for (const step of lane.steps) {
		if (!SLUG.test(step.id))
			report("the step id must be a slug ([a-z0-9-]+).", step.id || "(no id)");
		else if (seen.has(step.id)) report("the step id is used twice in this lane.", step.id);
		seen.add(step.id);
		validateStep(step, report);
	}

	for (const owner of lane.owners) {
		if (outside(owner.from, lane) || outside(owner.to, lane))
			report(`the owner "${owner.name}" names a step that is not in this lane.`);
	}
	for (const c of lane.connectors) {
		if (outside(c.from, lane) || outside(c.to, lane)) {
			const ends = `"${c.fromId ?? c.from}" to "${c.toId ?? c.to}"`;
			report(`the connector ${ends} has an endpoint that is not a step of this lane.`);
		}
	}
	return problems;
}

const outside = (index: number, lane: Lane): boolean =>
	!Number.isInteger(index) || index < 0 || index >= lane.steps.length;

type Report = (message: string, step?: string, row?: string) => void;

function validateStep(step: Step, report: Report): void {
	const id = step.id || "(no id)";
	if (words(step.title) > MAX_TITLE_WORDS)
		report(`the title "${step.title}" has more than ${MAX_TITLE_WORDS} words.`, id);
	if (words(step.phrase) > MAX_PHRASE_WORDS)
		report(`the phrase "${step.phrase}" has more than ${MAX_PHRASE_WORDS} words.`, id);
	if (!GROUPS.includes(step.group))
		report(`the group "${step.group}" is not one of ${GROUPS.join(", ")}.`, id);
	for (const to of step.handoffs)
		if (!SLUG.test(to)) report(`the hand-off "${to}" must name a lane by its slug.`, id);
	for (const row of step.rows) validateRow(row, id, report);
}

function validateRow(row: Row, step: string, report: Report): void {
	if (row.choice !== undefined) {
		if (row.rows.length < 2)
			report(`the choice "${row.choice}" needs two alternatives or more.`, step, row.choice);
		for (const alt of row.rows) validateRow(alt, step, report);
		return;
	}
	const name = row.name ?? "(no name)";
	if (row.depth > MAX_TREE_DEPTH)
		report(
			`the row is at depth ${row.depth}, below the deepest level allowed (${MAX_TREE_DEPTH}). ` +
				"Say where the chain continues in the last row's text, with a reference tag.",
			step,
			name,
		);
	if (row.kind === undefined || !(row.kind in KINDS))
		report(`the kind "${row.kind}" is not a known kind.`, step, name);
	if (row.gloss !== undefined && words(row.gloss) > MAX_GLOSS_WORDS)
		report(
			`the gloss has more than ${MAX_GLOSS_WORDS} words; move the rest to the row's text.`,
			step,
			name,
		);
	if (row.depth === 0 && row.cite) report("a root row has no `at`.", step, name);
	if (row.depth > 0) {
		if (!row.cite) report("a child row needs `at`, the line that names it.", step, name);
		else if (!row.cite.path)
			report("`at` needs a file: the parent has no path, and no `namedIn` is given.", step, name);
		else if (row.cite.path.endsWith("/"))
			report(`\`at\` cites the directory "${row.cite.path}", which has no lines.`, step, name);
	}
	for (const child of row.rows) validateRow(child, step, report);
}
