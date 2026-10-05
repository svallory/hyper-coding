import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "#lib/base-command";
import { getEngine } from "#services/sync/engine";
import {
	describeFailure,
	describeWarp,
	executeWarp,
	gatherWarp,
	planWarp,
	restoreMarker,
	runnerForTarget,
	WARP_REFUSAL_EXIT,
	type WarpInputs,
	type WarpPlan,
} from "#services/warp";

/** Prefix of every sync session hyperdrive owns, as `drive sync-config` builds it. */
const SESSION_PREFIX = "hyper-";

/**
 * What `run()` decided, before anything is printed.
 *
 * A refusal is an exit code plus sentences; success is the plan and what
 * running it did. Returning one of these instead of calling `this.error()` from
 * inside the `try` keeps a refusal from being re-caught and re-wrapped with a
 * generic message.
 */
type Outcome =
	| { kind: "refusal"; exit: number; message: string }
	| { kind: "dry-run"; plan: WarpPlan; json: boolean }
	| { kind: "done"; plan: WarpPlan; completed: string[]; notices: string[]; json: boolean };

/**
 * `hyper warp <machine>` — move this session to another machine.
 *
 * Send-only: the machine holding the session runs it, because only it can tell
 * whether the session is still running.
 *
 * Deliberately thin. It gathers facts (which machine, which session, is it
 * live, does a sync session already carry the transcript), hands them to the
 * pure `planWarp`, and runs what comes back. Everything with a decision in it
 * lives in `services/warp.ts`, where it can be tested without a machine, an SSH
 * hop, or a filesystem.
 */
export default class Warp extends BaseCommand<typeof Warp> {
	static override summary = "Move this session to another machine";

	static override description =
		`Copies this session's transcript and the working directory to the SAME absolute path on <machine>, then resumes the session there through Herdr.

Every check runs before the first change on either machine. A session that already lives on <machine> (its ownership marker names it) is refused unless you pass --force.

Limits:
  - The target's copy of the directory is overwritten file by file; files that exist only there are kept (no --delete).
  - Only this session's files travel (<id>.jsonl, <id>.warp.json, <id>/), never the whole project folder.
  - A space worktree arrives as a git worktree on the target. Staged-but-uncommitted changes arrive as unstaged modifications: the index does not travel.
  - A git copy on the target is refused when it has uncommitted work, when the copy would overwrite an untracked or ignored entry there with different content or a different type, or when it has a tracked directory where this machine has a file; --force first saves a space worktree's tracked changes as a stash and copies those entries to hyper-warp-backup/ in the target repo's git directory.
  - A plain repo is refused when a target ref points at a commit this machine doesn't have or doesn't reach from the refs warp carries; --force saves the target's refs (every stash entry too, as .../stash/<n>) under refs/hyper-warp-backup/ first (kept as loose refs by every later warp). Stash entries only the target has, and refs that conflict as file and directory, are refused without --force. The rest of the target's .git (config, info/exclude, hooks, packed-refs) is replaced by this machine's, and its refs are then set to exactly this machine's.
  - A merge, rebase, cherry-pick, revert or bisect in progress, unresolved conflicts, a changed submodule, or (plain repo) the reftable ref format or a ref lock file on the target are refused even with --force.`;

	static override examples = [
		"<%= config.bin %> warp netcup",
		"<%= config.bin %> warp netcup --stop",
		"<%= config.bin %> warp netcup --session 3d9c77a6-6975-4381-b884-214b3ca452d8",
		"<%= config.bin %> warp netcup --dry-run",
		"<%= config.bin %> warp netcup --stop --remote-control",
	];

	static override args = {
		machine: Args.string({
			description: "Machine to move to, as Herdr and your drive.toml both know it",
			required: true,
		}),
	};

	static override flags = {
		...BaseCommand.baseFlags,
		session: Flags.string({
			description: "Session id to warp (default: the newest session of this directory)",
		}),
		stop: Flags.boolean({
			description: "Stop the session here before copying it",
			default: false,
		}),
		"remote-control": Flags.boolean({
			description: "Resume the session with Claude Code's remote control enabled",
			default: false,
		}),
		force: Flags.boolean({
			description:
				"Take the session over from a machine that owns it, and overwrite the target's uncommitted work after saving what warp can (see Limits)",
			default: false,
		}),
		"dry-run": Flags.boolean({
			description: "Print every step warp would take and change nothing, here or there",
			default: false,
		}),
		json: Flags.boolean({ description: "Print the result as JSON", default: false }),
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(Warp);
		let outcome: Outcome;
		try {
			outcome = await this.decide(args.machine, flags);
		} catch (error) {
			if (!(error instanceof Error)) throw error;
			this.error(error.message, { exit: WARP_REFUSAL_EXIT });
		}
		if (outcome.kind === "refusal") {
			this.error(outcome.message, { exit: outcome.exit });
		}
		if (outcome.kind === "dry-run") {
			this.reportDryRun(outcome.plan, outcome.json);
			return;
		}
		this.reportDone(outcome);
	}

	/** Gather → plan → (dry run | run). Throws only on a genuine failure. */
	private async decide(
		machine: string,
		flags: {
			session?: string;
			stop: boolean;
			force: boolean;
			"remote-control": boolean;
			"dry-run": boolean;
			json: boolean;
		},
	): Promise<Outcome> {
		const gathered = gatherWarp({
			cwd: process.cwd(),
			targetName: machine,
			...(flags.session === undefined ? {} : { sessionId: flags.session }),
		});
		const inputs: WarpInputs = {
			...gathered.inputs,
			stop: flags.stop,
			force: flags.force,
			remoteControl: flags["remote-control"],
			syncSession: await syncSessionFor(gathered.inputs.target.name),
		};
		const planned = planWarp(inputs);
		if (!planned.ok) return { kind: "refusal", exit: planned.exit, message: planned.message };
		const plan = planned.plan;

		if (flags["dry-run"]) return { kind: "dry-run", plan, json: flags.json };

		const engine = plan.syncSession ? getEngine() : null;
		const execution = await executeWarp(plan, {
			runner: runnerForTarget(plan.target),
			...(engine
				? {
						flushSync: async (session: string) => {
							await engine.flush(session);
						},
					}
				: {}),
		});

		if (execution.failure) {
			const undone = restoreMarker(plan, execution);
			return {
				kind: "refusal",
				exit: WARP_REFUSAL_EXIT,
				message: describeFailure(plan, execution, undone),
			};
		}
		return {
			kind: "done",
			plan,
			completed: execution.completed.map((record) => record.summary),
			notices: execution.notices,
			json: flags.json,
		};
	}

	/** `--dry-run`: the whole plan, and a statement that nothing ran. */
	private reportDryRun(plan: WarpPlan, asJson: boolean): void {
		const described = describeWarp(plan);
		if (asJson) {
			this.log(JSON.stringify({ ...described, ran: false }, null, 2));
			return;
		}
		this.log("Dry run — nothing was copied, stopped or written on either machine.");
		this.log(
			`Target:    ${plan.target.name} (${plan.target.host}${plan.target.port ? `:${plan.target.port}` : ""})`,
		);
		this.log(`Workdir:   ${plan.cwd} (${plan.cwdKind})`);
		this.log(`Session:   ${plan.sessionId}`);
		this.log(`Transcript: ${described.transcript.path} — ${described.transcript.lines} lines`);
		if (described.transcript.lastMessage !== null) {
			this.log(`Last message: ${truncate(described.transcript.lastMessage, 160)}`);
		}
		this.log("");
		for (const line of described.lines) this.log(line);
		this.log("");
		this.log("Worth knowing:");
		for (const note of described.notes) this.log(`  - ${note}`);
	}

	private reportDone(outcome: {
		plan: WarpPlan;
		completed: string[];
		notices: string[];
		json: boolean;
	}): void {
		const { plan, completed, notices, json } = outcome;
		if (json) {
			this.log(JSON.stringify({ ok: true, plan, completed, notices }, null, 2));
			return;
		}
		this.log("");
		this.log(`Warp to ${plan.target.name} complete — ${completed.length} steps.`);
		this.log(`Session:    ${plan.sessionId}`);
		this.log(`Workdir:    ${plan.cwd} (${plan.cwdKind})`);
		this.log(`Transcript: ${plan.transcriptPath}`);
		for (const notice of notices) {
			this.log("");
			this.log(notice);
		}
		this.log("");
		this.log(`Watch it with: herdr --remote ${plan.target.name}`);
		this.log(`Then attach:  herdr --machine ${plan.target.name} agent get ${plan.agentName}`);
	}
}

/**
 * The config-sync session that would carry this transcript to the target, if
 * one exists.
 *
 * `drive sync-config` names sessions `hyper-claude-<machine>`, so that is the
 * name to look for. Asked through `probe()`, which runs the engine with its
 * daemon autostart DISABLED: merely looking (even for `--dry-run`) must never
 * start a sync daemon. A stopped daemon, a missing engine or a failure all
 * mean "no session", and warp copies the transcript itself.
 */
async function syncSessionFor(machine: string): Promise<string | null> {
	const name = `${SESSION_PREFIX}claude-${machine}`;
	try {
		const probe = await getEngine().probe();
		if (!probe.daemon.running) return null;
		return probe.sessions.some((session) => session.name === name) ? name : null;
	} catch {
		return null;
	}
}

function truncate(text: string, max: number): string {
	const flat = text.replaceAll(/\s+/g, " ").trim();
	return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}
