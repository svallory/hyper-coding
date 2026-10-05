import { Args, Flags } from "@oclif/core";
import { loadConfig } from "#config/index";
import { BaseCommand } from "#lib/base-command";
import { MachineError, resolveMachine, runnerFor, self } from "#services/machine";
import {
	CONFIG_SYNC_SESSION_PREFIX,
	type ConfigSyncRow,
	syncConfigWith,
} from "#services/sync/config-sync";
import { getEngine, SyncEngineError, type SyncSession } from "#services/sync/engine";

type Row = ConfigSyncRow;

export default class SyncConfig extends BaseCommand<typeof SyncConfig> {
	static override description =
		"Keep ~/.claude and ~/.pi/agent in sync with another machine, and show the sync sessions";

	static override examples = [
		"<%= config.bin %> drive sync-config",
		"<%= config.bin %> drive sync-config netcup",
		"<%= config.bin %> drive sync-config netcup --check",
	];

	static override args = {
		machine: Args.string({
			description: "Machine to sync with. Omit to just list the sessions.",
			required: false,
		}),
	};

	static override flags = {
		...BaseCommand.baseFlags,
		check: Flags.boolean({
			description: "Only verify; never create. Exits 1 if anything is missing or mismatched.",
			default: false,
		}),
		json: Flags.boolean({ description: "Print the result as JSON.", default: false }),
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(SyncConfig);
		const engine = getEngine();

		if (args.machine === undefined) {
			await this.reportStatus(engine, flags.debug, flags.json);
			return;
		}
		await this.syncWith(engine, args.machine, flags.check, flags.json, flags.debug);
	}

	/**
	 * Every user-facing failure leaves through here.
	 *
	 * A friendly error's `stack` is its message (SyncEngineError, MachineError
	 * shaped the same way), so oclif's prettyPrint — which returns `error.stack`
	 * verbatim in dev mode — prints the sentence and not the JS frames. --debug
	 * keeps the frames, because there the frames are the point.
	 */
	/** Print the table (or JSON) and exit `code` if anything went wrong. */
	private finish(
		machineName: string,
		check: boolean,
		json: boolean,
		rows: Row[],
		failures: number,
		code: number,
	): void {
		if (json) {
			this.log(JSON.stringify({ machine: machineName, check, sessions: rows }, null, 2));
		} else {
			this.table(
				rows.map((row) => ({
					name: row.name,
					alpha: row.alpha,
					beta: row.beta,
					status: `${row.state}: ${row.detail}`,
				})),
			);
		}
		if (code !== 0) {
			this.error(
				`${failures} of ${rows.length} config sync session(s) for "${machineName}" are missing or don't match what hyperdrive expects.`,
				{ exit: code },
			);
		}
	}

	private fail(err: unknown, debug: boolean): never {
		if (err instanceof SyncEngineError || err instanceof MachineError) {
			const problem = new Error(err.message);
			problem.stack = debug ? (err.stack ?? err.message) : err.message;
			this.error(problem, { exit: 2 });
		}
		// Anything else is a real bug and must keep its stack.
		throw err;
	}

	/** No machine: is the daemon up, and what is it syncing? */
	private async reportStatus(
		engine: ReturnType<typeof getEngine>,
		debug: boolean,
		json: boolean,
	): Promise<void> {
		let daemon: { registered: boolean; running: boolean };
		let sessions: SyncSession[];
		try {
			// One round trip: the probe returns liveness and the session list
			// together, so the engine is asked once, not twice.
			const probe = await engine.probe();
			daemon = probe.daemon;
			sessions = probe.sessions.filter((session) =>
				session.name.startsWith(CONFIG_SYNC_SESSION_PREFIX),
			);
		} catch (err) {
			this.fail(err, debug);
		}

		if (json) {
			this.log(JSON.stringify({ daemon, sessions }, null, 2));
			return;
		}

		this.log("Config sync daemon:");
		this.log(`  registered: ${daemon.registered ? "yes" : "no"}`);
		this.log(`  running:    ${daemon.running ? "yes" : "no"}`);
		// The fix commands are the engine's, not this command's (C-8).
		for (const hint of engine.fixHints(daemon)) this.log(`    → fix: ${hint}`);

		this.log("");
		if (sessions.length === 0) {
			this.log("No hyper config-sync sessions yet.");
			this.log("  → create one with `hyper drive sync-config <machine>`");
			return;
		}
		this.table(
			sessions.map((session) => ({
				name: session.name,
				alpha: session.alpha,
				beta: session.beta,
				status: session.status,
			})),
		);
	}

	/** With a machine: make the two sessions exist and say they match. */
	private async syncWith(
		engine: ReturnType<typeof getEngine>,
		machineName: string,
		check: boolean,
		json: boolean,
		debug: boolean,
	): Promise<void> {
		let result: Awaited<ReturnType<typeof syncConfigWith>>;
		try {
			const config = loadConfig();
			const machine = resolveMachine(machineName);
			result = await syncConfigWith(engine, machine, {
				check,
				config,
				localHome: self().home,
				runner: runnerFor(machine.name),
			});
		} catch (err) {
			this.fail(err, debug);
		}

		const { rows, failures, createFailed } = result;
		// Partial create: report what was decided and exit 2, with the REAL count —
		// saying "0 of 1 missing" after a failure would be worse than no message.
		if (createFailed) return this.finish(machineName, check, json, rows, failures, 2);
		// A mismatch is a failure whether or not --check was asked for: the user
		// ran a command that did not fully succeed, and exit 0 would say it did.
		this.finish(machineName, check, json, rows, failures, failures > 0 ? 1 : 0);
	}

	/**
	 * NAME / ALPHA / BETA / STATUS, aligned by hand — the package has no table
	 * dependency and one is not worth one.
	 */
	private table(rows: { name: string; alpha: string; beta: string; status: string }[]): void {
		const headers = ["NAME", "ALPHA", "BETA", "STATUS"];
		const keys = ["name", "alpha", "beta", "status"] as const;
		const widths = headers.map((header, i) =>
			Math.max(header.length, ...rows.map((row) => row[keys[i]].length)),
		);
		const line = (cells: string[]): string =>
			cells
				.map((cell, i) => (i === cells.length - 1 ? cell : cell.padEnd(widths[i])))
				.join("  ")
				.trimEnd();
		this.log(line(headers));
		for (const row of rows) this.log(line(keys.map((key) => row[key])));
	}
}
