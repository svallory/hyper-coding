/**
 * Config sync with one machine: the two sessions (`~/.claude`, `~/.pi/agent`)
 * hyperdrive keeps between this machine and another.
 *
 * Shared by `hyper drive sync-config <machine>` and the `config-sync` task of
 * `hyper machine setup <machine>`, so both create, verify and refuse in exactly
 * the same way. Nothing here prints: callers turn the rows into a table, a JSON
 * document or setup log lines.
 */

import { type DriveConfig, type SyncTarget, syncIgnoreFor } from "#config/schema";
import { MachineError, type MachineInfo } from "#services/machine";
import type { MachineRunner } from "#services/remote";
import type { SyncEngine, SyncSession } from "#services/sync/engine";

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
export const CONFIG_SYNC_SESSION_PREFIX = "hyper-";

/** The session semantics hyperdrive always asks for. */
const SYNC_MODE = "two-way-resolved" as const;
const SYMLINK_MODE = "posix-raw" as const;
const BETA_FILE_MODE = "0660";
const BETA_DIR_MODE = "0770";

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
	return `${CONFIG_SYNC_SESSION_PREFIX}${plan.target}-${machine}`;
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

/** One session's outcome. */
export interface ConfigSyncRow {
	name: string;
	state: "ready" | "created" | "mismatch";
	alpha: string;
	beta: string;
	detail: string;
}

export interface ConfigSyncResult {
	rows: ConfigSyncRow[];
	/** Rows in the `mismatch` state. */
	failures: number;
	/**
	 * True when a create failed and the remaining plans were not looked at. The
	 * rows decided so far are kept: a partial create is still useful information.
	 */
	createFailed: boolean;
}

export interface ConfigSyncOptions {
	/** Only verify; never create. */
	check: boolean;
	config: DriveConfig;
	/** This machine's home (`self.home`): the alpha side. */
	localHome: string;
	/**
	 * How to reach the target (`remote.ts`), used only to create the beta
	 * root's missing parent before a create: Mutagen creates a missing root but
	 * not its parent (`~/.pi` on a machine where pi never ran), and the session
	 * then says "Watching for changes" while nothing syncs.
	 */
	runner: MachineRunner;
}

/**
 * Make sure the parent of the beta root exists on the target. Only plans
 * whose subdir has a parent of its own need it (`.pi/agent` → `.pi`); the
 * home itself is the parent of `.claude`.
 */
async function ensureBetaParent(
	runner: MachineRunner,
	home: string,
	plan: SyncPlan,
): Promise<string | null> {
	const slash = plan.relative.lastIndexOf("/");
	if (slash < 0) return null;
	const parent = plan.relative.slice(0, slash);
	// A home of `~` or `~/sub` is the remote's own: `$HOME` expands there, and
	// a quoted `~` would create a literal directory named `~`.
	const tilde = home === "" || home === "~" || home.startsWith("~/");
	const result = tilde
		? await runner.ssh([
				"sh",
				"-c",
				'mkdir -p -- "$HOME/$1"',
				"sh",
				[home.slice(2), parent].filter(Boolean).join("/"),
			])
		: await runner.ssh(["mkdir", "-p", "--", `${home.replace(/\/+$/, "")}/${parent}`]);
	return result.code === 0 ? null : result.stderr.trim() || `exit ${result.code}`;
}

/**
 * Why a session whose settings all match is still not syncing, or "": halted,
 * disconnected, or with an error or a scan/transition problem on either side.
 * A freshly created session that is still connecting or scanning is fine.
 */
export function sessionHealth(session: SyncSession): string {
	if (session.status.startsWith("halted")) return `the session is halted (${session.status})`;
	if (session.status === "disconnected") return "the session is disconnected";
	if (session.problems.length > 0) {
		const shown = session.problems.slice(0, 3).join("; ");
		return `not syncing: ${shown}${session.problems.length > 3 ? ` (and ${session.problems.length - 3} more)` : ""}`;
	}
	return "";
}

/**
 * Make the two sessions with `machine` exist and match what hyperdrive expects,
 * or (with `check`) only report whether they do.
 *
 * Throws {@link MachineError} when the machine has no home or no SSH target,
 * and lets the engine's own `SyncEngineError` through (engine not installed,
 * daemon unreachable) — both before any session is created.
 */
export async function syncConfigWith(
	engine: SyncEngine,
	machine: MachineInfo,
	{ check, config, localHome, runner }: ConfigSyncOptions,
): Promise<ConfigSyncResult> {
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
	// Throws SyncEngineError (friendly, "the engine is not installed…") when
	// the binary is missing — before any state is created.
	const existing = await engine.list();
	const rows: ConfigSyncRow[] = [];
	let failures = 0;
	for (const plan of PLANS) {
		const name = sessionName(plan, machine.name);
		// Validate the SESSION name, not the machine name: it is always
		// `hyper-<target>-<machine>`, so it starts with a letter even when the
		// machine doesn't — a machine called `1box` yields the perfectly valid
		// `hyper-claude-1box`.
		const nameProblem = engine.validateSessionName(name);
		if (nameProblem) {
			throw new MachineError(`${nameProblem}. Rename the machine in Herdr.`);
		}
		const alpha = alphaUrl(localHome, plan);
		const beta = betaUrl(machine.host, machine.home, plan);
		const want = {
			symlinkMode: SYMLINK_MODE,
			betaFileMode: BETA_FILE_MODE,
			betaDirMode: BETA_DIR_MODE,
			mode: SYNC_MODE,
		};
		const current = existing.find((session) => session.name === name);

		// Create only when nothing already syncs this pair in a way that would
		// fight. The cases, all verified against the live sessions:
		//
		//  - any session (any name) over the SAME alpha AND beta pair: two
		//    two-way-resolved sessions over one pair resolve each other's
		//    conflicts forever;
		//  - a session NOT named hyper-* sharing the alpha or the beta: the
		//    operator's hand-made claude-config / pi-config are exactly this, and
		//    a managed session next to them would race them;
		//  - ANOTHER hyper-* session sharing ONLY the alpha: fine. That is the
		//    star (hub) topology — this Mac syncing ~/.claude to netcup and to a
		//    second machine at once — which must work.
		const conflict = existing.find((session) => {
			if (session.name === name) return false;
			const samePair = session.alpha === alpha && session.beta === beta;
			const sharesPath = session.alpha === alpha || session.beta === beta;
			const foreign = !session.name.startsWith(CONFIG_SYNC_SESSION_PREFIX);
			return samePair || (foreign && sharesPath);
		});
		if (conflict) {
			rows.push({
				name,
				state: "mismatch",
				alpha,
				beta,
				detail: `a session called "${conflict.name}" already syncs ${
					conflict.alpha === alpha && conflict.beta === beta
						? "this exact pair"
						: conflict.alpha === alpha
							? "this alpha"
							: "this beta"
				} — ${engine.terminateHint(conflict.name, machine.name)}`,
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
			const parentProblem = await ensureBetaParent(runner, machine.home, plan);
			if (parentProblem !== null) {
				rows.push({
					name,
					state: "mismatch",
					alpha,
					beta,
					detail: `could not create the parent of ${beta} on ${machine.name}: ${parentProblem}`,
				});
				failures++;
				return { rows, failures, createFailed: true };
			}
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
				return { rows, failures, createFailed: true };
			}
			rows.push({ name, state: "created", alpha, beta, detail: `${alpha} → ${beta}` });
			continue;
		}
		const problem = mismatch(
			current,
			alpha,
			beta,
			syncIgnoreFor(plan.target, config),
			want,
			engine.terminateHint(name, machine.name),
		);
		const health = problem || sessionHealth(current);
		if (health) {
			rows.push({
				name,
				state: "mismatch",
				alpha,
				beta,
				detail: problem ? problem : `${health} — fix it on that side; the next check sees it`,
			});
			failures++;
			continue;
		}
		rows.push({ name, state: "ready", alpha, beta, detail: `${alpha} → ${beta}` });
	}
	return { rows, failures, createFailed: false };
}

/** Why an existing session can't be used, or "" when it matches. */
function mismatch(
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
	// 0644, is not the session we mean even though its paths line up — it would
	// land files on the other machine that hyperdrive never intended.
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
