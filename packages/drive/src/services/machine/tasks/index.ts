/**
 * The task registry.
 *
 * `allTasks()` is what `hyper machine setup` runs; T-15 adds the tool tasks,
 * T-16 the agent-user and home-path ones, T-17 docker and config sync. Until
 * then this ships exactly one task, so the runner's apply / check / root-script
 * paths are exercised end to end by the command and its tests.
 */

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

/** Every task the CLI knows how to run, in a stable order. */
export function allTasks(): Task[] {
	return [noop];
}

export * from "./types.js";
