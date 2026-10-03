import { Args, Flags } from "@oclif/core";
import { loadConfig } from "#config/index";
import { type SyncTarget, syncIgnoreFor } from "#config/schema";
import { BaseCommand } from "#lib/base-command";
import { MachineError, resolveMachine, self } from "#services/machine";
import { getEngine, SyncEngineError, type SyncSession } from "#services/sync/engine";

/** One thing hyperdrive keeps in sync. */
interface SyncPlan {
	target: SyncTarget;
	/** Subdir of each machine's home. */
	relative: string;
	/** Human name for messages and table rows. */
	label: string;
}

const PLANS: readonly SyncPlan[] = [
	{ target: "claude", relative: ".claude", label: "Claude" },
	{ target: "pi", relative: ".pi/agent", label: "pi" },
];

/** Every session hyperdrive owns starts with this. */
const SESSION_PREFIX = "hyper-";

/**
 * The alpha URL for a plan: this machine's own config dir, taken from
 * `self.home` in the config so a non-default home is honoured.
 */
function alphaUrl(home: string, plan: SyncPlan): string {
	return `${home.replace(/\/+$/, "")}/${plan.relative}`;
}

/**
 * The beta URL for a plan: `<ssh host>:<that machine's home>/<subdir>`.
 *
 * The host is whatever Herdr stores as the machine's SSH target, which may
 * include a user (`me@host`) and a port (`host:2222`) — passed through whole.
 *
 * The subdir is ALWAYS appended, including for a home of exactly `~` (allowed
 * by the config loader, which deliberately does not expand a remote home).
 * Dropping it would point the sync at the whole remote home — a two-way
 * resolved session mirroring every file in it — which is exactly the kind of
 * mistake that only shows up after the first cycle has already run.
 */
function betaUrl(host: string, home: string, plan: SyncPlan): string {
	const base = home === "" || home === "~" ? "~" : home.replace(/\/+$/, "");
	return `${host}:${base}/${plan.relative}`;
}

/** Session name for a plan + machine: `hyper-claude-<machine>`. */
function sessionName(plan: SyncPlan, machine: string): string {
	return `${SESSION_PREFIX}${plan.target}-${machine}`;
}

/**
 * Compare a session's ignore list with what hyperdrive would create today.
 *
 * The engine normalizes patterns on the way in (root-anchored with a leading
 * `/`) and adds `.DS_Store` itself, so an exact array compare would call every
 * healthy session a mismatch. Compare as sets of slash-normalized patterns, and
 * report only what hyperdrive would add — a pattern the user added by hand in
 * the engine is not a problem we should nag about.
 */
function missingPatterns(want: string[], have: string[]): string[] {
	const normalized = new Set(have.map((pattern) => pattern.replace(/^\/+/, "")));
	return want.filter((pattern) => !normalized.has(pattern.replace(/^\/+/, "")));
}

type Row = {
	name: string;
	state: "ready" | "created" | "mismatch";
	alpha: string;
	beta: string;
	detail: string;
};

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
			sessions = probe.sessions.filter((session) => session.name.startsWith(SESSION_PREFIX));
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
		let config: ReturnType<typeof loadConfig>;
		let rows: Row[];
		let failures = 0;
		try {
			config = loadConfig();
			const machine = resolveMachine(machineName);
			if (!machine.home) {
				throw new MachineError(
					`The "${machine.name}" machine has no home dir in your hyperdrive config, so hyperdrive doesn't know where its ${"~/.claude"} lives. Add \`home = "…"\` under \`[machines.${machine.name}]\` in your drive.toml.`,
				);
			}
			if (!machine.host) {
				throw new MachineError(
					`Herdr has no SSH target for "${machine.name}", so there's no address to sync to. Run \`herdr machine add <ssh-target> --label ${machine.name}\` first.`,
				);
			}
			// Throws SyncEngineError (friendly, "the engine is not
			// installed…") when the binary is missing — before any state
			// is created.
			const existing = await engine.list();
			const local = self().home;
			rows = [];
			for (const plan of PLANS) {
				const name = sessionName(plan, machine.name);
				const alpha = alphaUrl(local, plan);
				const beta = betaUrl(machine.host as string, machine.home as string, plan);
				const current = existing.find((session) => session.name === name);
				if (!current) {
					if (check) {
						rows.push({
							name,
							state: "mismatch",
							alpha,
							beta,
							detail: `missing — run \`hyper drive sync-config ${machine.name}\` to create it`,
						});
						failures++;
						continue;
					}
					await engine.create(name, alpha, beta, {
						ignore: syncIgnoreFor(plan.target, config),
						symlinkMode: "posix-raw",
						betaFileMode: "0660",
						betaDirMode: "0770",
						mode: "two-way-resolved",
					});
					rows.push({ name, state: "created", alpha, beta, detail: `${alpha} → ${beta}` });
					continue;
				}
				const problem = this.mismatch(
					current,
					alpha,
					beta,
					syncIgnoreFor(plan.target, config),
					engine.terminateHint(name, machine.name),
				);
				if (problem) {
					rows.push({ name, state: "mismatch", alpha, beta, detail: problem });
					failures++;
					continue;
				}
				rows.push({ name, state: "ready", alpha, beta, detail: `${alpha} → ${beta}` });
			}
		} catch (err) {
			this.fail(err, debug);
		}

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
		// A mismatch is a failure whether or not --check was asked for: the user
		// ran a command that did not fully succeed, and exit 0 would say it did.
		if (failures > 0) {
			this.error(
				`${failures} of ${rows.length} config sync session(s) for "${machineName}" are missing or don't match what hyperdrive expects.`,
				{ exit: 1 },
			);
		}
	}

	/** Why an existing session can't be used, or "" when it matches. */
	private mismatch(
		current: SyncSession,
		alpha: string,
		beta: string,
		wantIgnore: string[],
		fix: string,
	): string {
		if (current.alpha !== alpha) return `alpha is ${current.alpha}, expected ${alpha} — ${fix}`;
		if (current.beta !== beta) return `beta is ${current.beta}, expected ${beta} — ${fix}`;
		if (current.mode !== "two-way-resolved") {
			return `mode is ${current.mode || "unset"}, expected two-way-resolved — ${fix}`;
		}
		const missing = missingPatterns(wantIgnore, current.ignore);
		if (missing.length > 0) {
			return `ignore list is missing ${missing.join(", ")} — ${fix}`;
		}
		return "";
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
