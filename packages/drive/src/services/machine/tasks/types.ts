/**
 * The shape of a machine-setup task.
 *
 * Setup is a list of small idempotent units. Each one answers "is this already
 * right?" ({@link Task.check}) and, when it isn't, either fixes it itself
 * ({@link Task.apply}) or hands the fix to the user as root work
 * ({@link Task.rootScript}). There is no persisted state: `check` reads the
 * machine every time, so running setup twice is a no-op (C-15).
 *
 * The split is the whole of the safety story: a task that needs root never
 * applies itself. The user's only privileged path is the assembled script, which
 * they run (or explicitly ask hyper to run) after reading it (C-6).
 */

import type { DriveConfig } from "#config/schema";
import type { MachineInfo } from "#services/machine";
import type { MachineRunner, Spawner } from "#services/remote";
import type { SyncEngine } from "#services/sync/engine";

/** A capability a task belongs to, and what `hyper machine setup` offers to set up. */
export type Feature = "tools" | "config-sync" | "agent-user" | "docker-rootless" | "home-path";

/** One feature as the prompt shows it. */
export interface FeatureInfo {
	feature: Feature;
	label: string;
	hint: string;
}

/** The features, in the order the prompt offers them. */
export const FEATURE_LIST: readonly FeatureInfo[] = [
	{
		feature: "tools",
		label: "tools",
		hint: "the hyper CLI's own tools (claude, pi, rg, …) at the same versions",
	},
	{
		feature: "config-sync",
		label: "config-sync",
		hint: "keep ~/.claude and ~/.pi/agent in sync across machines",
	},
	{
		feature: "agent-user",
		label: "agent-user",
		hint: "an unattended `agent` user the agents run as, plus its shared dirs",
	},
	{
		feature: "docker-rootless",
		label: "docker-rootless",
		hint: "Docker that runs without root, as the agent user",
	},
	{
		feature: "home-path",
		label: "home-path",
		hint: "a /Users/<name> home path, so the same paths work on both machines",
	},
];

/** Every feature name, for flag parsing and validation. */
export const FEATURES: readonly Feature[] = FEATURE_LIST.map((entry) => entry.feature);

export function isFeature(value: string): value is Feature {
	return (FEATURES as readonly string[]).includes(value);
}

/**
 * What a task is allowed to know about the machine it's running on.
 *
 * `machine` is null for the local one: a task that needs the machine's name or
 * home has to handle the local case itself, rather than being handed a
 * half-invented MachineInfo.
 */
export interface TaskContext {
	/** The target machine, or null when setup targets this machine. */
	machine: MachineInfo | null;
	/** How to reach the target — LocalMachine or RemoteMachine. */
	runner: MachineRunner;
	config: DriveConfig;
	/** Print progress. Goes to stdout in a command, to a buffer in a test. */
	log: (line: string) => void;
	/**
	 * `--agent-key <file>`: the ssh PUBLIC key (.pub) the agent user should
	 * accept on this machine, for this run. Undefined when the flag wasn't
	 * given, and then the machine's `agent_key` config value is used, and then
	 * this machine's own default public key. Only ever the `.pub` half — see
	 * `tasks/agent-key.ts`.
	 */
	agentKeyFile?: string;
	/**
	 * Injection seam for tests: the process spawner the as-agent runner uses.
	 * Undefined in production, where `MachineRunner` uses its own. It exists
	 * because a task that opens a session as ANOTHER user builds its own runner,
	 * so it could not otherwise be driven by a recording runner in `ctx`.
	 */
	spawner?: Spawner;
	/**
	 * Injection seam for tests: the sync engine the `config-sync` task drives.
	 * Undefined in production, where the task uses `getEngine()` — the same
	 * engine `hyper drive sync-config` uses.
	 */
	syncEngine?: SyncEngine;
}

/** One unit of machine setup. */
export interface Task {
	/** Stable id, e.g. "noop.check" or "agent-user.create". Printed and asserted on. */
	id: string;
	feature: Feature;
	/**
	 * True when the work needs root. Such a task must provide `rootScript` and
	 * is never `apply`d by the runner.
	 */
	needsRoot: boolean;
	/** What the user would call it. */
	title: string;
	/** True when the machine already satisfies this task. Must not change anything. */
	check(ctx: TaskContext): Promise<boolean>;
	/** Fix it without root. Only ever called when `needsRoot` is false. */
	apply?(ctx: TaskContext): Promise<void>;
	/** Actionable explanation printed once if the check still fails after apply. */
	unmetReason?: string;
	/** The root fix, as bash. Only ever called when `needsRoot` is true. */
	rootScript?(ctx: TaskContext): string;
	/**
	 * A root step for a task that otherwise runs unprivileged.
	 *
	 * Some work is genuinely the user's to run and only becomes reachable from
	 * root in specific situations — `loginctl enable-linger` on yourself is
	 * allowed by stock polkit and denied by a machine whose polkit rules say
	 * otherwise. Rather than making the whole task a root task (which would put
	 * its everyday work behind a password), it stays `needsRoot: false` and
	 * offers this: the runner collects it into the same assembled script the
	 * user reads before typing their password, banner-marked as a fallback.
	 *
	 * The runner only asks for it after `apply` ran and the task still fails.
	 */
	rootFallback?(ctx: TaskContext): string;
}

/**
 * A task that couldn't be checked. Names the task, because "something failed"
 * with a stack from inside a check is exactly the kind of message the CLI is
 * supposed to replace.
 */
export class TaskError extends Error {
	readonly taskId: string;
	constructor(taskId: string, message: string) {
		super(message);
		this.name = "TaskError";
		this.taskId = taskId;
	}
}
