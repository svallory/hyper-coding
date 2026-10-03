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

/** The session semantics hyperdrive always asks for. */
const SYNC_MODE = "two-way-resolved" as const;
const SYMLINK_MODE = "posix-raw" as const;
const BETA_FILE_MODE = "0660";
const BETA_DIR_MODE = "0770";

/**
 * Mutagen's session-name rule, checked up front.
 *
 * MUTAGEN-INTERNAL (verified 0.18.1): session names must start with an
 * alphanumeric and may then contain alphanumerics, `.`, `_` and `-`. A machine
 * name outside that would produce a session the engine refuses to create, with
 * an error from deep inside `--name` rather than anything naming the machine.
 */
const SESSION_NAME_OK = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

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
 * Which patterns hyperdrive would add that the session does not have.
 *
 * Compared EXACTLY, including the leading `/`. That slash is the anchor: an
 * unanchored `sessions` matches a directory of that name at any depth, so
 * treating `/sessions` and `sessions` as the same pattern would let a session
 * that ignores the wrong things report as ready. A pattern the user added by
 * hand in the engine is not reported — only what we would add is.
 */
function missingPatterns(want: string[], have: string[]): string[] {
	const present = new Set(have);
	return want.filter((pattern) => !present.has(pattern));
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
	/** Rows decided before a create failed, so a partial run still reports. */
	private partial: Row[] | null = null;

	/** Print the table (or JSON) and exit `code` if anything went wrong. */
	private finish(machineName: string, check: boolean, json: boolean, code: number): void {
		const rows = this.partial ?? [];
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
				`${this.failureCount} of ${rows.length} config sync session(s) for "${machineName}" are missing or don't match what hyperdrive expects.`,
				{ exit: code },
			);
		}
	}

	/** How many rows are not `ready`/`created`. */
	private failureCount = 0;

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
			if (!SESSION_NAME_OK.test(machine.name)) {
				throw new MachineError(
					`"${machine.name}" can't be part of a sync session name: mutagen wants a name starting with a letter or digit and containing only letters, digits, dots, dashes and underscores. Rename the machine in Herdr.`,
				);
			}
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
				const want = {
					symlinkMode: SYMLINK_MODE,
					betaFileMode: BETA_FILE_MODE,
					betaDirMode: BETA_DIR_MODE,
					mode: SYNC_MODE,
				};
				const current = existing.find((session) => session.name === name);

				// MUST create only when NOTHING at all already syncs this pair.
				// Matching on name alone would let `sync-config netcup` build
				// hyper-claude-netcup right next to the operator's hand-made
				// claude-config on the SAME alpha and beta: two two-way-resolved
				// sessions over one directory pair, each resolving conflicts the
				// other just wrote.
				const collision = existing.find(
					(session) => session.name !== name && (session.alpha === alpha || session.beta === beta),
				);
				if (collision) {
					rows.push({
						name,
						state: "mismatch",
						alpha,
						beta,
						detail: `a session called "${collision.name}" already syncs ${
							collision.alpha === alpha ? "this alpha" : "this beta"
						} — two two-way sessions over one directory pair would fight. Terminate it first (\`mutagen sync terminate ${collision.name}\`), then rerun.`,
					});
					failures++;
					continue;
				}

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
					// SHOULD: keep the rows already decided. A partial create is
					// still useful information — the caller can see which half
					// landed before deciding what to do about the rest.
					try {
						await engine.create(name, alpha, beta, {
							ignore: syncIgnoreFor(plan.target, config),
							...want,
						});
					} catch (err) {
						rows.push({
							name,
							state: "mismatch",
							alpha,
							beta,
							detail: `could not create: ${err instanceof Error ? err.message : String(err)}`,
						});
						failures++;
						this.partial = rows;
						return this.finish(machineName, check, json, 2);
					}
					rows.push({ name, state: "created", alpha, beta, detail: `${alpha} → ${beta}` });
					continue;
				}
				const problem = this.mismatch(
					current,
					alpha,
					beta,
					syncIgnoreFor(plan.target, config),
					want,
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

		this.partial = rows;
		this.failureCount = failures;
		// A mismatch is a failure whether or not --check was asked for: the user
		// ran a command that did not fully succeed, and exit 0 would say it did.
		this.finish(machineName, check, json, failures > 0 ? 1 : 0);
	}

	/** Why an existing session can't be used, or "" when it matches. */
	private mismatch(
		current: SyncSession,
		alpha: string,
		beta: string,
		wantIgnore: string[],
		want: { symlinkMode: string; betaFileMode: string; betaDirMode: string },
		fix: string,
	): string {
		if (current.alpha !== alpha) return `alpha is ${current.alpha}, expected ${alpha} — ${fix}`;
		if (current.beta !== beta) return `beta is ${current.beta}, expected ${beta} — ${fix}`;
		if (current.mode !== "two-way-resolved") {
			return `mode is ${current.mode || "unset"}, expected two-way-resolved — ${fix}`;
		}
		// A session that resolves symlinks `portable`, or creates beta files at
		// 0644, is not the session we mean even though its paths line up — it
		// would land files on the other machine that hyperdrive never intended.
		if (current.symlinkMode !== want.symlinkMode) {
			return `symlink mode is ${current.symlinkMode || "unset"}, expected ${want.symlinkMode} — ${fix}`;
		}
		if (current.betaFileMode !== want.betaFileMode) {
			return `beta file mode is ${current.betaFileMode || "unset"}, expected ${want.betaFileMode} — ${fix}`;
		}
		if (current.betaDirMode !== want.betaDirMode) {
			return `beta directory mode is ${current.betaDirMode || "unset"}, expected ${want.betaDirMode} — ${fix}`;
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
