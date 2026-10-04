import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "#lib/base-command";
import { getEngine } from "#services/sync/engine";
import {
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
	| { kind: "done"; plan: WarpPlan; completed: string[]; json: boolean };

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
	static override description = "Move this session to another machine";

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
			description: "Take the session over from a machine that owns it",
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
			const undone = restoreMarker(
				plan,
				plan.owner.state === "owned" ? plan.owner.marker : null,
				execution.copied === true,
			);
			return {
				kind: "refusal",
				exit: WARP_REFUSAL_EXIT,
				message: [
					`Warp to ${plan.target.name} stopped at: ${execution.failure.summary}`,
					execution.failure.detail,
					execution.completed.length === 0
						? "No step completed, and nothing was changed on either machine."
						: `Completed before that: ${execution.completed.join("; ")}.`,
					undone.restored
						? plan.owner.state === "owned"
							? `The ownership marker was put back to owner ${JSON.stringify(plan.owner.marker.owner)}.`
							: "The ownership marker was removed again."
						: (undone.reason ?? "The ownership marker was left as it is."),
					"Run this again to retry; nothing needs undoing on the target.",
				].join("\n"),
			};
		}
		return { kind: "done", plan, completed: execution.completed, json: flags.json };
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
	}

	private reportDone(outcome: { plan: WarpPlan; completed: string[]; json: boolean }): void {
		const { plan, completed, json } = outcome;
		if (json) {
			this.log(JSON.stringify({ ok: true, plan, completed }, null, 2));
			return;
		}
		this.log("");
		this.log(`Warp to ${plan.target.name} complete — ${completed.length} steps.`);
		this.log(`Session:    ${plan.sessionId}`);
		this.log(`Workdir:    ${plan.cwd} (${plan.cwdKind})`);
		this.log(`Transcript: ${plan.transcriptPath}`);
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
 * name to look for. A missing or failing engine is not an error here: it
 * simply means there is no session, and warp falls back to rsync — which is
 * what it would have done before the session existed.
 */
async function syncSessionFor(machine: string): Promise<string | null> {
	const name = `${SESSION_PREFIX}claude-${machine}`;
	try {
		const sessions = await getEngine().list();
		return sessions.some((session) => session.name === name) ? name : null;
	} catch {
		return null;
	}
}

/** Index of the first step that copies anything; kept for tests and reports. */
export function firstCopyingStep(plan: WarpPlan): number {
	const copying = new Set(["copy", "push-branch", "remote-command", "flush-sync"]);
	const index = plan.steps.findIndex((step) => copying.has(step.kind));
	return index < 0 ? plan.steps.length : index;
}

function truncate(text: string, max: number): string {
	const flat = text.replaceAll(/\s+/g, " ").trim();
	return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}
