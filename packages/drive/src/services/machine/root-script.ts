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
	const local = shellQuote(path);
	if (machine === null) return [privilegedArgv(path).join(" ")];
	const host = shellQuote(machine.host ?? machine.name);
	const remote = remoteScriptPath("~");
	return [
		`ssh ${host} 'mkdir -p ~/.hyper'`,
		`scp ${local} ${host}:${remote}`,
		`ssh -t ${host} 'sudo bash ${remote}'`,
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
