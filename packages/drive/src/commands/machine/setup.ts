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
import { type HookScan, scanHooks } from "#services/machine/hooks-scan";
import { parityTable, renderParity } from "#services/machine/parity";
import {
	type RootChoice,
	type RootQuestion,
	runSetup,
	type SetupPrompt,
	type SetupReport,
} from "#services/machine/runner";
import { allTasks } from "#services/machine/tasks/index";
import { rsyncSpec, type Versioned } from "#services/machine/tasks/tools-rsync";
import {
	FEATURE_LIST,
	type Feature,
	isFeature,
	type TaskContext,
	TaskError,
} from "#services/machine/tasks/types";
import { findTool, TOOLS } from "#services/machine/tools";
import { LocalMachine } from "#services/remote";
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

/**
 * `--tools a,b` split into real tool ids, or a friendly error naming the valid ones.
 *
 * `all` is a real answer here — "everything in the registry" — and it is what
 * `--features tools` on its own means when there are no hooks to narrow it.
 */
export function parseTools(raw: string): string[] {
	const wanted = raw
		.split(",")
		.map((part) => part.trim())
		.filter((part) => part !== "");
	const unknown = wanted.filter((part) => part !== "all" && findTool(part) === undefined);
	if (unknown.length > 0) {
		throw new MachineError(
			`Unknown tool${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}. The tools are: ${TOOLS.map((tool) => tool.id).join(", ")} (or "all").`,
		);
	}
	if (wanted.length === 0)
		throw new MachineError(
			"No tools selected: pass `--tools all` explicitly, or name tools such as `--tools jq,wt`.",
		);
	return wanted;
}

/** Strip terminal control characters from untrusted hook text before display. */
export function printableHookWord(word: string): string {
	return Array.from(word)
		.filter((char) => {
			const code = char.codePointAt(0) ?? 0;
			return code >= 32 && !(code >= 127 && code <= 159);
		})
		.join("");
}

export function emptySelectionMessage(scan: HookScan): string {
	return `${scan.commandCount === 0 ? "no hooks found" : "hooks found, none maps to a registry tool"}: pass \`--tools all\` or \`--tools a,b\` to select tools explicitly.`;
}

/**
 * Which tools the user's own Claude hooks imply.
 *
 * An empty scan means an empty selection, and that is the honest answer: the
 * evidence says this machine's hooks call no tool in the registry, and
 * installing fifteen CLIs on the strength of a file that wasn't there is not what
 * `--yes` should do. The caller says so and points at `--tools`.
 */
export function toolsFromScan(scan: HookScan): string[] {
	return scan.preselect.filter((id) => findTool(id) !== undefined);
}

/**
 * Ask which tools to put there, with the hook scan's answers already ticked.
 *
 * The ticks go in the option's own `initialValues` list, not in each option's
 * `initialValue`: `multiselect` reads the top-level array only, so an
 * `initialValue` per option pre-ticks nothing and the preselection the hook
 * scan just did silently disappears.
 */
export async function askTools(preselected: readonly string[]): Promise<string[] | symbol> {
	return multiselect({
		message: "Which tools? (ticked: your Claude hooks call them)",
		...toolPromptOptions(preselected),
		required: false,
	});
}

/**
 * The tool multiselect's options and its ticks, apart from the question itself.
 *
 * Split out because the tick is the part that was wrong and is invisible from
 * the call: `multiselect` reads the top-level `initialValues` and ignores an
 * `initialValue` on any single option.
 */
export function toolPromptOptions(preselected: readonly string[]): {
	options: { value: string; label: string; hint: string }[];
	initialValues: string[];
} {
	return {
		options: TOOLS.map((tool) => ({
			value: tool.id,
			label: tool.id,
			hint: tool.notes ?? tool.title,
		})),
		initialValues: TOOLS.map((tool) => tool.id).filter((id) => preselected.includes(id)),
	};
}

/** Where this machine keeps its Claude Code config. */
function claudeHome(): string {
	const override = process.env.CLAUDE_CONFIG_DIR;
	if (override !== undefined && override !== "") return override;
	return join(homedir(), ".claude");
}

/**
 * Every wanted tool's version on one machine.
 *
 * Four at a time, not all of them: sixteen simultaneous ssh connections is past
 * sshd's default `MaxStartups 10`, and the connections it refuses come back as
 * failures — which the table would report as "missing" on a machine that has
 * every tool. Detecting the local machine needs no ssh at all, so it is asked
 * separately for the reference PATH and the strict target PATH.
 */
const DETECT_CONCURRENCY = 4;

type ParitySpec = Versioned & { detectReference?: (ctx: TaskContext) => Promise<string | null> };

export async function versionsFor(
	specs: readonly ParitySpec[],
	ctx: TaskContext,
	reference = false,
): Promise<Record<string, string | null>> {
	const out: Record<string, string | null> = {};
	let next = 0;
	const worker = async (): Promise<void> => {
		while (next < specs.length) {
			const spec = specs[next++];
			try {
				out[spec.id] = await (reference ? (spec.detectReference ?? spec.detect) : spec.detect)(ctx);
			} catch (err) {
				out[spec.id] = null;
				ctx.log(
					`warning: couldn't detect ${spec.id}: ${err instanceof Error ? err.message : String(err)}`,
				);
			}
		}
	};
	await Promise.all(Array.from({ length: Math.min(DETECT_CONCURRENCY, specs.length) }, worker));
	return out;
}

/** The reference uses the operator's PATH; even a local target stays strict. */
export async function parityVersions(
	specs: readonly ParitySpec[],
	here: TaskContext,
	target: TaskContext,
): Promise<[Record<string, string | null>, Record<string, string | null>]> {
	return Promise.all([versionsFor(specs, here, true), versionsFor(specs, target)]);
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

/**
 * Ask which features to set up. Never called when --features was given.
 *
 * Ticks go in the top-level `initialValues` for the same reason as `askTools`:
 * `multiselect` ignores a per-option `initialValue`, so a machine registered
 * with `features = ["tools"]` was asked about `tools` again.
 */
export async function askFeatures(initial: Feature[]): Promise<Feature[] | symbol> {
	return multiselect({
		message: "What should this machine have?",
		...featurePromptOptions(initial),
		required: false,
	});
}

/** The feature multiselect's options and its ticks. See {@link toolPromptOptions}. */
export function featurePromptOptions(initial: readonly Feature[]): {
	options: { value: Feature; label: string; hint: string }[];
	initialValues: Feature[];
} {
	return {
		options: FEATURE_LIST.map((entry) => ({
			value: entry.feature,
			label: entry.label,
			hint: entry.hint,
		})),
		initialValues: FEATURE_LIST.map((entry) => entry.feature).filter((feature) =>
			initial.includes(feature),
		),
	};
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
export function exitCodeFor(pendingRootPath: string | null, failedCount = 0): number | null {
	if (failedCount > 0) return FAILED_TOOLS_EXIT;
	return pendingRootPath === null ? null : PENDING_ROOT_EXIT;
}

/** Render the report the way the machine list renders a table: plainly. */
export function renderReport(report: SetupReport, target: string): string[] {
	const lines: string[] = [];
	const total =
		report.applied.length + report.alreadyOk.length + report.skipped.length + report.failed.length;
	if (report.applied.length === 0 && report.skipped.length === 0 && report.failed.length === 0) {
		lines.push(`Nothing needed — ${target} was already set up for everything you picked.`);
	}
	if (report.alreadyOk.length > 0) lines.push(`  already fine: ${report.alreadyOk.join(", ")}`);
	for (const id of report.applied) lines.push(`  set up:        ${id}`);
	for (const id of report.skipped) lines.push(`  skipped:       ${id}`);
	for (const failure of report.failed)
		lines.push(`  FAILED:        ${failure.id} — ${failure.reason}`);
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
export const FAILED_TOOLS_EXIT = 4;

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
		"Set up a machine for hyper work (tools, config sync, agent user, …)\n\nExit codes: 0 success; 1 bug in a task; 2 usage error; 3 unattended root steps pending; 4 tool installation failed or the fix did not take (also when root steps are pending).";

	static override examples = [
		"<%= config.bin %> machine setup",
		"<%= config.bin %> machine setup netcup --features tools,agent-user",
		// --yes with no machine means `tools`: the local default.
		"<%= config.bin %> machine setup --features tools --yes",
		"<%= config.bin %> machine setup --features tools --tools jq,wt --yes",
		"<%= config.bin %> machine setup --yes",
	];

	static override flags = {
		...BaseCommand.baseFlags,
		features: Flags.string({
			description: "Comma-separated features to set up, skipping the prompt",
		}),
		tools: Flags.string({
			description: `Comma-separated tools to install, skipping the tool prompt ("all" for every one). One of: ${TOOLS.map((tool) => tool.id).join(", ")}`,
		}),
		yes: Flags.boolean({
			description:
				"Take the defaults: tools locally, or the features drive.toml lists for a named machine. Never runs anything as root",
			default: false,
		}),
		"agent-key": Flags.string({
			description:
				"Ssh PUBLIC key (.pub) the agent user should accept, so setup can open a session as it. Only the public half is ever read",
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

		if (flags.tools !== undefined && !features.includes("tools")) {
			return this.fail(
				"`--tools` needs `--features tools`. Add the tools feature or drop `--tools`.",
				flags.debug,
			);
		}

		if (features.length === 0) {
			this.log("No features picked — nothing to do.");
			return;
		}

		const interactive = process.stdin.isTTY === true && process.stdout.isTTY === true;

		// Which tools, and what the user's own hooks say about it. The scan reads
		// this machine's Claude config, which is where the evidence lives; it is
		// read-only and its findings are only ever a default, never an action.
		let tools: string[] = [];
		if (features.includes("tools")) {
			// `--tools` is the answer already: scanning first would cost a read of
			// the user's config to compute a value nobody uses.
			const scan = flags.tools === undefined ? await scanHooks(claudeHome()) : null;
			const suggested = scan === null ? [] : toolsFromScan(scan);
			try {
				if (flags.tools !== undefined) {
					tools = parseTools(flags.tools);
				} else if (flags.yes || !interactive) {
					// Same reasoning as `--yes` for the features: nobody can answer
					// here, and the hook scan is a good enough answer to act on.
					tools = suggested;
				} else {
					const answer = await askTools(suggested);
					if (isCancel(answer)) {
						return this.fail("Cancelled — nothing was changed.", flags.debug);
					}
					tools = answer as string[];
				}
			} catch (err) {
				if (!(err instanceof MachineError)) throw err;
				return this.fail(err.message, flags.debug);
			}
			if (suggested.length === 0 && scan !== null) {
				this.log(emptySelectionMessage(scan));
			}
			// Say what the scan found, so "why only these four?" has an answer on
			// screen rather than in the source.
			if (scan !== null && scan.configSync.length > 0) {
				this.log(
					`${scan.configSync.length} hook${scan.configSync.length === 1 ? "" : "s"} under ~/.claude/hooks need a config sync to be here.`,
				);
			}
			if (scan !== null && scan.resolvesAfterClone.length > 0) {
				this.log(
					`Hooks point at ${scan.resolvesAfterClone.length} path${scan.resolvesAfterClone.length === 1 ? "" : "s"} in your home — those resolve once the space is cloned here.`,
				);
			}
			if (scan !== null && scan.unknown.length > 0) {
				this.log(
					`Hooks also call tools this registry doesn't know: ${scan.unknown.map(printableHookWord).join(", ")}.`,
				);
			}
			if (flags.debug && scan !== null) {
				for (const file of scan.files) this.log(`  read ${file}`);
				for (const warning of scan.warnings) this.log(`  warning: ${warning}`);
			}
		}

		// Set when the root prompt had to answer for itself, so the run can report
		// unfinished root work instead of exiting 0 on a half-prepared machine.
		let unattendedRootPath: string | null = null;
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
			...(flags["agent-key"] === undefined ? {} : { agentKeyFile: flags["agent-key"] }),
		};

		let report: SetupReport;
		try {
			report = await runSetup(ctx, {
				features,
				// rsync is a root task, not a registry entry: a remote machine needs
				// it for warp and for every file transfer, whether or not anything
				// asked for it by name.
				// The PATH line and rsync are in `allTasks` already: both are needed
				// on every machine, local or remote.
				tasks: allTasks({ tools }),
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

		// Design step 5: the parity table. The local column is detected on the
		// machine the user is sitting at, the other column on the machine that was
		// just set up — for a local run they're the same machine, which is exactly
		// what a local run should show.
		if (features.includes("tools")) {
			const wanted: Versioned[] = TOOLS.filter(
				(tool) => tools.includes("all") || tools.includes(tool.id),
			);
			// rsync gets a row on every target, local included: it is what `hyper
			// space` copies over, and a local machine without it breaks the same
			// transfers a remote one would.
			wanted.push(rsyncSpec);
			if (wanted.length > 0) {
				const here: TaskContext = {
					machine: null,
					runner: new LocalMachine(),
					config,
					log: (line) => this.log(line),
				};
				// A local target still has a distinct strict-PATH readiness column.
				const [local, other] = await parityVersions(wanted, here, ctx);
				const table = renderParity(parityTable(local, other));
				if (table.length > 0) {
					this.log("");
					this.log(
						machine === null
							? "Tool versions on this machine:"
							: `Tool parity (this machine vs ${machine.name}):`,
					);
					for (const line of table) this.log(`  ${line}`);
				}
			}
		}

		// Print both diagnoses before choosing the exit code: failed tools take
		// precedence, but must never hide the pending root steps.
		const messages: string[] = [];
		if (unattendedRootPath !== null)
			messages.push(pendingRootMessage(machine?.name ?? "this machine", unattendedRootPath));
		if (report.failed.length > 0)
			// Not "tool(s)": a failed entry can be any task whose install threw —
			// including a rootless-Docker install that could not reach the agent —
			// and calling that a tool failure would send the user looking for one.
			messages.push(
				`${report.failed.length} setup step(s) could not be completed. Fix the failures above and re-run setup.`,
			);
		const exit = exitCodeFor(unattendedRootPath, report.failed.length);
		if (exit !== null) this.error(messages.join("\n"), { exit });
	}

	/** Report a user error the way `machine list` does: message, exit 2, no stack unless --debug. */
	private fail(message: string, debug: boolean, stack?: string, exit = 2): void {
		const problem = new Error(message);
		problem.stack = debug ? (stack ?? message) : message;
		this.error(problem, { exit });
	}
}
