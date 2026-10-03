/**
 * `hyper machine setup [machine]` — prepare a machine for hyper work.
 *
 * The command is a thin shell over {@link runSetup}: it decides *which*
 * features, hands the runner a machine and a prompt, and prints the report. All
 * the sequencing lives in the runner, where it can be tested without a TTY.
 */

import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { isCancel, multiselect, select } from "@clack/prompts";
import { Args, Flags } from "@oclif/core";
import { ConfigError, loadConfig } from "#config/index";
import { BaseCommand } from "#lib/base-command";
import { MachineError, type MachineInfo, resolveMachine, runnerFor } from "#services/machine";
import {
	type RootChoice,
	type RootQuestion,
	runSetup,
	type SetupPrompt,
	type SetupReport,
} from "#services/machine/runner";
import { allTasks } from "#services/machine/tasks/index";
import {
	FEATURE_LIST,
	type Feature,
	isFeature,
	type TaskContext,
	TaskError,
} from "#services/machine/tasks/types";
import { findSpaceRoot } from "#services/space";

/** `--features a,b` split into real feature names, or a friendly error naming the valid ones. */
function parseFeatures(raw: string): Feature[] {
	const wanted = raw
		.split(",")
		.map((part) => part.trim())
		.filter((part) => part !== "");
	const unknown = wanted.filter((part) => !isFeature(part));
	if (unknown.length > 0) {
		throw new MachineError(
			`Unknown feature${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}. The features are: ${FEATURE_LIST.map((entry) => entry.feature).join(", ")}.`,
		);
	}
	return wanted as Feature[];
}

/**
 * Features to preselect: whatever `drive.toml` already says this machine has.
 * A machine registered with `features = ["tools", "docker-rootless"]` should
 * only be asked about the ones it doesn't have.
 */
function preselected(machine: MachineInfo | null): Feature[] {
	const configured = machine?.features ?? [];
	return FEATURE_LIST.map((entry) => entry.feature).filter((feature) =>
		configured.includes(feature),
	);
}

/** Where the root script goes: inside the space when there is one, else in the user's cache. */
function scratchDir(): string {
	const override = process.env.HYPER_MACHINE_SCRATCH;
	if (override !== undefined && override !== "") return override;
	const root = findSpaceRoot(process.cwd());
	if (root !== null) return join(root, "scratch", "hyperdrive");
	const home = homedir();
	// A machine whose HOME is the temp dir (some CI sandboxes) would otherwise get
	// a cache dir that vanishes with the run.
	return home === tmpdir()
		? join(tmpdir(), "hyper-machine")
		: join(home, ".cache", "hyper", "machine");
}

/** Ask which features to set up. Never called when --features was given. */
async function askFeatures(initial: Feature[]): Promise<Feature[] | symbol> {
	return multiselect({
		message: "What should this machine have?",
		options: FEATURE_LIST.map((entry) => ({
			value: entry.feature,
			label: entry.label,
			hint: entry.hint,
			initialValue: initial.includes(entry.feature),
		})),
		required: false,
	});
}

/**
 * The root prompt. Three answers, in the order the brief fixes them, and
 * "I've run it" is the default — pressing enter must never ask for a password.
 */
/**
 * The three answers, in order.
 *
 * Exported so the order and the default can be asserted directly: "I've run it"
 * being first *and* the initial value is the C-6 guarantee that pressing enter
 * never asks for a password — and that is not visible from running the command.
 */
export const ROOT_CHOICE_OPTIONS = [
	{ value: "ran", label: "I've run it", hint: "you ran the script yourself" },
	{
		value: "run-for-me",
		label: "Run it for me (asks for your password)",
		hint: "hyper runs the script; you type your password",
	},
	{ value: "skip", label: "Skip", hint: "leave those steps for later" },
] as const;

/** The answer a bare Enter gets. */
export const DEFAULT_ROOT_CHOICE = "ran";

async function askRootChoice(question: RootQuestion): Promise<RootChoice | symbol> {
	return select({
		message: `How do you want to handle the root steps on ${question.machine} (${question.tasks.join(", ")})?`,
		options: ROOT_CHOICE_OPTIONS.map((option) => ({ ...option })),
		initialValue: DEFAULT_ROOT_CHOICE,
	});
}

/**
 * The prompt the runner uses, and the one place the "is there a terminal?"
 * decision is made.
 *
 * Without a terminal clack's select waits forever — it renders to a TTY, and
 * reading from a pipe never yields an answer — so the question cannot be asked
 * and the only safe answer to give is "skip", reported through `onUnattended` so
 * the run can exit 3 instead of claiming a machine is ready.
 *
 * Exported so the unattended branch is testable without a terminal and without a
 * root task: it is the dangerous branch, and it was the untested one.
 */
export function rootPrompt(
	interactive: boolean,
	onUnattended: (path: string) => void,
): SetupPrompt {
	return {
		async rootChoice(question: RootQuestion): Promise<RootChoice> {
			if (!interactive) {
				onUnattended(question.path);
				return "skip";
			}
			const answer = await askRootChoice(question);
			// Cancelling the root prompt is a skip, never a surprise password prompt.
			return isCancel(answer) ? "skip" : (answer as RootChoice);
		},
	};
}

/**
 * The exit code for a finished run: 3 when root work is still pending because
 * nobody could answer, otherwise null — the run exits as it otherwise would.
 */
export function exitCodeFor(pendingRootPath: string | null): number | null {
	return pendingRootPath === null ? null : PENDING_ROOT_EXIT;
}

/** Render the report the way the machine list renders a table: plainly. */
function renderReport(report: SetupReport, target: string): string[] {
	const lines: string[] = [];
	const total = report.applied.length + report.alreadyOk.length + report.skipped.length;
	if (report.applied.length === 0 && report.skipped.length === 0) {
		lines.push(`Nothing needed — ${target} was already set up for everything you picked.`);
	}
	if (report.alreadyOk.length > 0) lines.push(`  already fine: ${report.alreadyOk.join(", ")}`);
	for (const id of report.applied) lines.push(`  set up:        ${id}`);
	for (const id of report.skipped) lines.push(`  skipped:       ${id}`);
	if (total === 0) lines.push("  (no tasks for the features you picked yet)");
	return lines;
}

/**
 * Exit code for a run that left root work undone because nobody could answer.
 *
 * 3, not 0 and not 2: this is neither success (the machine is NOT set up) nor a
 * user error (nothing was typed wrong). A CI job that provisions machines needs
 * to be able to say "this needs you" without parsing the output, and 0 would
 * report a half-prepared machine as ready.
 */
export const PENDING_ROOT_EXIT = 3;

/**
 * What to tell the user when root work is still pending after an unattended run.
 *
 * Exported so the rule is testable without a TTY and without a root task: which
 * exit code, and that the path to the script is named, are both worth pinning.
 */
export function pendingRootMessage(target: string, path: string): string {
	return `Some steps on ${target} still need root, and I couldn't ask about them (no terminal). Nothing was run. Run ${path} yourself, or re-run this command interactively.`;
}

export default class MachineSetup extends BaseCommand<typeof MachineSetup> {
	static override description =
		"Set up a machine for hyper work (tools, config sync, agent user, …)";

	static override examples = [
		"<%= config.bin %> machine setup",
		"<%= config.bin %> machine setup netcup --features tools,agent-user",
		// --yes with no machine means `tools`: the local default.
		"<%= config.bin %> machine setup --features tools --yes",
		"<%= config.bin %> machine setup --yes",
	];

	static override flags = {
		...BaseCommand.baseFlags,
		features: Flags.string({
			description: "Comma-separated features to set up, skipping the prompt",
		}),
		yes: Flags.boolean({
			description:
				"Take the defaults: tools locally, or the features drive.toml lists for a named machine. Never runs anything as root",
			default: false,
		}),
	};

	static override args = {
		machine: Args.string({
			required: false,
			description: "Machine to set up. Omit for this machine.",
		}),
	};

	async run(): Promise<void> {
		const { argv, flags } = await this.parse(MachineSetup);
		// `InferredArgs` degrades to `unknown[]` for an optional positional, so read
		// the machine by position. There is exactly one arg and it's a string.
		const name = typeof argv[0] === "string" ? argv[0] : undefined;

		let config;
		let machine: MachineInfo | null = null;
		try {
			config = loadConfig();
			machine = name === undefined ? null : resolveMachine(name);
		} catch (err) {
			if (!(err instanceof ConfigError || err instanceof MachineError)) throw err;
			return this.fail(err.message, flags.debug);
		}

		let features: Feature[];
		try {
			if (flags.features !== undefined) {
				features = parseFeatures(flags.features);
			} else if (flags.yes) {
				// Checked before the terminal, not after: --yes exists precisely for
				// the unattended case, and it needs no terminal because the defaults
				// are known without asking (a named machine's features from
				// drive.toml, or `tools` locally, where there is no entry to read).
				// Gating it on a TTY made it fail in the one place it matters.
				features = name === undefined ? ["tools"] : preselected(machine);
			} else if (!process.stdin.isTTY || !process.stdout.isTTY) {
				return this.fail(
					"I need to ask which features to set up, but this isn't an interactive terminal. Pass them yourself with `--features tools,config-sync`.",
					flags.debug,
				);
			} else {
				const answer = await askFeatures(preselected(machine));
				if (isCancel(answer)) {
					// Ctrl-C is "no", and the user asked a question whose answer was
					// "don't do this". Exiting 0 would tell their pipeline it worked.
					return this.fail("Cancelled — nothing was changed.", flags.debug);
				}
				features = answer as Feature[];
			}
		} catch (err) {
			if (!(err instanceof MachineError)) throw err;
			return this.fail(err.message, flags.debug);
		}

		if (features.length === 0) {
			this.log("No features picked — nothing to do.");
			return;
		}

		// Set when the root prompt had to answer for itself, so the run can report
		// unfinished root work instead of exiting 0 on a half-prepared machine.
		let unattendedRootPath: string | null = null;
		const interactive = process.stdin.isTTY === true && process.stdout.isTTY === true;
		const prompt = rootPrompt(interactive, (path) => {
			unattendedRootPath = path;
			this.log(
				`This isn't an interactive terminal, so I'm leaving the root steps for you: ${path}`,
			);
		});

		const ctx: TaskContext = {
			machine,
			runner: runnerFor(name),
			config,
			log: (line) => this.log(line),
		};

		let report: SetupReport;
		try {
			report = await runSetup(ctx, {
				features,
				tasks: allTasks(),
				prompt,
				scratchDir: scratchDir(),
			});
		} catch (err) {
			// A TaskError is a bug in a task we wrote, not something the user can
			// fix by retyping something — so it exits 1 (crash) rather than 2
			// (user error). The two codes mean different things to a caller, and
			// telling someone their command was wrong when our task threw would send
			// them looking in the wrong place.
			return this.fail(
				err instanceof Error ? err.message : String(err),
				flags.debug,
				err instanceof Error ? err.stack : undefined,
				err instanceof TaskError ? 1 : 2,
			);
		}

		for (const line of renderReport(report, machine?.name ?? "this machine")) this.log(line);

		// Unattended with root work still to do is not a successful setup. Say so
		// loudly and with a code CI can branch on.
		const pendingExit = exitCodeFor(unattendedRootPath);
		if (pendingExit !== null && unattendedRootPath !== null) {
			this.error(pendingRootMessage(machine?.name ?? "this machine", unattendedRootPath), {
				exit: pendingExit,
			});
		}
	}

	/** Report a user error the way `machine list` does: message, exit 2, no stack unless --debug. */
	private fail(message: string, debug: boolean, stack?: string, exit = 2): void {
		const problem = new Error(message);
		problem.stack = debug ? (stack ?? message) : message;
		this.error(problem, { exit });
	}
}
