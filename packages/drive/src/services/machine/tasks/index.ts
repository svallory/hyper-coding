/**
 * The task registry.
 *
 * `allTasks()` is what `hyper machine setup` runs. The tools feature is one
 * `tools.<id>` task per registry entry, so the runner's apply / check contract
 * is what makes an install idempotent (C-15): the runner asks `check` (which is
 * `detect`) and only calls `apply` (which is `install`) when the tool isn't
 * there. No task keeps state of its own.
 *
 * `noop.check` stays, so the report and the "nothing needed" path keep working
 * before any real tool is selected — and so a machine that has every tool still
 * proves the no-op path.
 */

import { findTool, TOOLS, type ToolSpec } from "../tools.js";
import { pathTask } from "./tools-path.js";
import { rsyncTask } from "./tools-rsync.js";
import type { Task, TaskContext } from "./types.js";

/**
 * A task that is always satisfied.
 *
 * It exists so the runner, the report and `hyper machine setup` do something
 * real before there is anything real to do, and so a fresh checkout can prove
 * the "nothing needed" path (C-15) without depending on the machine's state.
 */
const noop: Task = {
	id: "noop.check",
	feature: "tools",
	needsRoot: false,
	title: "the runner itself",
	async check(_ctx: TaskContext): Promise<boolean> {
		return true;
	},
};

/** One `tools.<id>` task for a registry entry. */
export function toolTask(spec: ToolSpec): Task {
	return {
		id: `tools.${spec.id}`,
		feature: "tools",
		// Nothing in the registry needs root, and that is the assertion: a tool
		// that did would have to go through the root script instead (C-6).
		needsRoot: false,
		title: spec.title,
		async check(ctx) {
			return (await spec.detect(ctx)) !== null;
		},
		async apply(ctx) {
			await spec.install(ctx);
		},
	};
}

/**
 * The tasks that are not registry entries: the PATH line, and rsync.
 *
 * Both are always offered. The PATH line is what makes the registry's installs
 * usable at all, and rsync is what `hyper space` and warp copy over — a machine
 * without it looks fine until the first transfer.
 */
export function infrastructureTasks(): Task[] {
	return [pathTask, rsyncTask];
}

/** Every task the CLI knows how to run, in a stable order. */
export function allTasks(options: { tools?: readonly string[] } = {}): Task[] {
	return [noop, ...infrastructureTasks(), ...selectedToolTasks(options.tools)];
}

/**
 * The tool tasks for the given registry ids, in registry order.
 *
 * Ids that aren't in the registry are dropped rather than fatal: they come from
 * `--tools` and from a hook scan, and neither should be able to crash setup for
 * a name that has since been retired. `all` (or nothing) means every tool.
 */
export function selectedToolTasks(ids?: readonly string[]): Task[] {
	if (ids === undefined || ids.includes("all")) return TOOLS.map(toolTask);
	const wanted = new Set(ids);
	return TOOLS.filter((spec) => wanted.has(spec.id)).map(toolTask);
}

/** The task for a registry id, or undefined when the id isn't one. */
export function toolTaskFor(id: string): Task | undefined {
	const spec = findTool(id);
	return spec === undefined ? undefined : toolTask(spec);
}

export * from "../tools.js";
export * from "./types.js";
