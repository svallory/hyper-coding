/**
 * Assembling the root script.
 *
 * This is one of exactly two files in the CLI allowed to contain the word
 * `sudo` (C-6), and only as template text — nothing here runs anything. The
 * script it builds is printed to the user in full before they are asked what to
 * do with it, so the header has to say what it is, where it came from and why it
 * wants root. That is the user's only chance to read it.
 */

import type { MachineInfo } from "#services/machine";
import { shellQuote } from "#services/remote";
import type { Task, TaskContext } from "./tasks/types.js";

/** One task's contribution to the script. */
export interface RootScriptEntry {
	task: Task;
	/** `task.rootScript(ctx)`, already generated for this machine. */
	script: string;
	/**
	 * True when the contribution is a non-root task's fallback rather than its
	 * own root script. The banner says so, because "here is the root part of a
	 * task that otherwise runs as you" is worth spelling out in a file someone
	 * is about to run with their password.
	 */
	fallback?: boolean;
}

/**
 * The group whose membership is the difference between a user and a root user.
 *
 * Named here, in the one file the C-6 grep allows, because the agent-user tasks
 * have to both read that membership in their `check` and hand a script that
 * removes it to the user. Spelling the name out in those tasks would put the
 * word "sudo" in four more files for no gain.
 */
export const PRIVILEGED_GROUP = "sudo";

/** The group that is root with a group seat instead. Handled exactly like the above. */
export const DOCKER_GROUP = "docker";

/** Where sudoers drop-ins live; one is named after the user it grants. */
export const SUDOERS_DIR = "/etc/sudoers.d";

/**
 * The `as-agent` helper, verbatim from the machine it was proven on.
 *
 * The one line in the whole design where a user types a privileged command
 * themselves: hyper installs the file and never runs it. It lives here, as
 * template text, so that C-6's grep stays a real check — a task that embedded
 * it would put "sudo" in `tasks/`, where it is supposed never to appear.
 *
 * Arguments are joined and `eval`ed in the target user's shell, which is what
 * makes `as-agent 'echo $USER'` behave like `ssh 'echo $USER'` rather than
 * passing the command in as a single quoted argument.
 */
export function asAgentScript(agentUser: string): string {
	return `#!/usr/bin/env bash
# Run a command line as ${agentUser} in the current directory.
# Arguments are joined and evaluated by ${agentUser}'s shell, like ssh:
#   as-agent 'echo $USER'   -> ${agentUser}
# With no arguments it runs: claude --resume
dir=$(pwd -P)
[ $# -eq 0 ] && set -- claude --resume
exec ${PRIVILEGED_GROUP} -H -u ${agentUser} bash -lic 'cd "$1" && eval "$2"' _ "$dir" "$*"
`;
}

/** How the machine is named in the header: local setups have no MachineInfo. */
function machineLabel(ctx: TaskContext): string {
	return ctx.machine === null ? "this machine (local setup)" : ctx.machine.name;
}

/**
 * Features in a stable order, so two runs of the same failing task produce
 * byte-identical scripts — a user diffing today's file against yesterday's
 * should see only the task that changed.
 */
function sortedFeatures(entries: RootScriptEntry[]): string[] {
	return [...new Set(entries.map((entry) => entry.task.feature))].sort();
}

/**
 * Build the script: a strict-mode bash preamble, a header naming the machine
 * and what's in it, then each task's script under a banner.
 *
 * `set -euo pipefail` is the point of assembling at all — one script the user
 * reads top to bottom behaves predictably, where five separate pasted fragments
 * don't. Tasks are separated by banners so a task can be lifted out by eye.
 */
export function assembleRootScript(entries: RootScriptEntry[], ctx: TaskContext): string {
	const features = sortedFeatures(entries);
	const lines: string[] = [
		"#!/usr/bin/env bash",
		"set -euo pipefail",
		"",
		"# hyper machine setup — root steps",
		`# machine: ${machineLabel(ctx)}`,
		`# features: ${features.join(", ")}`,
		`# tasks: ${entries.map((entry) => entry.task.id).join(", ")}`,
		"#",
		"# Every step below needs root. Read this file before you run it — hyper",
		"# wrote it, but hyper never runs sudo on its own (C-6). To run it yourself:",
		"#   sudo bash hyper-machine-root.sh",
		"# (on another machine, copy it there first — `hyper machine setup` prints",
		"#  the copy and run commands for the machine it is setting up)",
		"",
	];

	for (const entry of entries) {
		lines.push(`# --- ${entry.task.id} ---`);
		lines.push(`# ${entry.task.title}`);
		if (entry.fallback === true) {
			lines.push("# (root fallback: the rest of this task runs as your own user)");
		}
		lines.push(entry.script.trimEnd());
		lines.push("");
	}

	return `${lines.join("\n")}`;
}

/** Where the script lands inside a remote machine's home. */
export function remoteScriptPath(home: string): string {
	return `${home.replace(/\/+$/, "")}/.hyper/hyper-machine-root.sh`;
}

/**
 * The argv that runs the script as root.
 *
 * This and the recipe below are the only places in the CLI that name the
 * privileged command (C-6). Both the runner's run-for-me branch and the text the
 * user is asked to run come from here, so the printed recipe and the automated
 * path cannot drift apart — and a future change to one cannot silently skip C-6.
 */
export function privilegedArgv(path: string): string[] {
	return ["sudo", "bash", path];
}

/**
 * The commands that get the script onto a machine and run it there.
 *
 * The remote half is quoted on purpose: an unquoted `~/` would be expanded by
 * the shell the user is standing in, not by the one on the other end, and would
 * point at their own home directory. The local path is quoted for the opposite
 * reason — a scratch dir under /tmp or a home with a space in it is not rare,
 * and an unquoted one would run whatever word followed it. scp's target half is
 * never quoted, for the reasons remote.ts documents.
 *
 * The mkdir is printed rather than assumed: scp won't create `~/.hyper` on an
 * older ssh, and a recipe that fails halfway is worse than one extra line.
 */
export function rootSteps(machine: MachineInfo | null, path: string): string[] {
	if (machine === null) {
		// Every word, not just the path: an unquoted path under a scratch dir or a
		// home with a space in it splits into two arguments, and this recipe runs as
		// root.
		return [privilegedArgv(path).map(shellQuote).join(" ")];
	}
	const host = shellQuote(machine.host ?? machine.name);
	const remote = remoteScriptPath("~");
	return [
		`ssh ${host} 'mkdir -p ~/.hyper'`,
		// scp's source is local, so the user's shell has to see it as one word; its
		// target half is never quoted, for the reasons remote.ts documents.
		`scp ${shellQuote(path)} ${host}:${remote}`,
		// Built from privilegedArgv too, but deliberately unquoted: the whole line is
		// single-quoted so the *remote* shell expands the leading ~. Quoting it here
		// would defeat that.
		`ssh -t ${host} '${privilegedArgv(remote).join(" ")}'`,
	];
}

/** Thrown when a root task forgot to provide a script. A bug in the task, not the user. */
export class RootScriptError extends Error {
	readonly taskId: string;
	constructor(taskId: string) {
		super(
			`The "${taskId}" task needs root but doesn't provide a rootScript(), so there's nothing to run.`,
		);
		this.name = "RootScriptError";
		this.taskId = taskId;
	}
}

/** The task's own script text, or a clear failure when it has none. */
export function scriptFor(task: Task, ctx: TaskContext): string {
	if (typeof task.rootScript !== "function") throw new RootScriptError(task.id);
	return task.rootScript(ctx);
}

/** Type-only re-export so callers can name the machine without importing it twice. */
export type { MachineInfo };
