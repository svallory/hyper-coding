/**
 * `config-sync`: keep `~/.claude` and `~/.pi/agent` in sync between this
 * machine and the target.
 *
 * The design's task row says it "delegates to `hyper drive sync-config
 * <machine>`". It does, through the same service the command uses
 * (`services/sync/config-sync.ts`): `check` is the command's `--check`, `apply`
 * is the command without it. Nothing is reimplemented and the CLI is not
 * spawned, so a session this task creates is exactly the one the command
 * would, and a second setup run finds it ready (C-15).
 *
 * The sync engine runs on THIS machine (it reaches the target over its own
 * transport), so the task talks to the engine directly rather than through
 * `ctx.runner`. No root is involved anywhere.
 *
 * With no target there is nothing to pair with: the sessions belong to a pair
 * of machines, and setup on the local machine cannot pick the other one. The
 * task then says so and is reported as skipped, never as done.
 */

import { MachineError } from "#services/machine";
import { syncConfigWith } from "#services/sync/config-sync";
import { getEngine, SyncEngineError } from "#services/sync/engine";
import type { Task, TaskContext } from "./types.js";

/** What a local run prints instead of creating anything. */
export const CONFIG_SYNC_LOCAL_MESSAGE =
	"config-sync: config sync pairs this machine with another one. Run `hyper machine setup <machine> --features config-sync` (or `hyper drive sync-config <machine>`) to sync with it.";

/**
 * Run the shared sync-config logic. A friendly failure becomes `null`, and a
 * log line when `explain` is set: a check stays quiet, the apply explains.
 */
async function run(ctx: TaskContext, check: boolean, explain: boolean) {
	if (ctx.machine === null) return null;
	const engine = ctx.syncEngine ?? getEngine();
	try {
		return await syncConfigWith(engine, ctx.machine, {
			check,
			config: ctx.config,
			localHome: ctx.config.self.home,
		});
	} catch (err) {
		// The engine missing, its daemon unreachable, or a machine with no home
		// or SSH target: the user's to fix, so say it and let the runner report
		// the task as skipped. Anything else is a bug and keeps its stack.
		if (err instanceof SyncEngineError || err instanceof MachineError) {
			if (explain) ctx.log(`config-sync: ${err.message}`);
			return null;
		}
		throw err;
	}
}

export const configSyncTask: Task = {
	id: "config-sync",
	feature: "config-sync",
	needsRoot: false,
	title: "~/.claude and ~/.pi/agent kept in sync with this machine",
	async check(ctx) {
		const result = await run(ctx, true, false);
		return result !== null && result.failures === 0;
	},
	async apply(ctx) {
		if (ctx.machine === null) {
			ctx.log(CONFIG_SYNC_LOCAL_MESSAGE);
			return;
		}
		const result = await run(ctx, false, true);
		if (result === null) return;
		for (const row of result.rows) {
			ctx.log(`config-sync: ${row.name} ${row.state} — ${row.detail}`);
		}
	},
};
