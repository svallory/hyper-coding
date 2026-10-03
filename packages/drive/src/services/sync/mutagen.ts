/**
 * The Mutagen sync engine — the ONLY file in hyperdrive that knows the word
 * "mutagen" (C-8).
 *
 * Everything is spawned as an argument array through the shared `Spawner` seam
 * from `services/remote.ts` (reused, not re-declared), so a fake spawner in the
 * tests can assert on the exact argv without a real binary. Process spawning
 * itself goes through `LocalMachine.ssh`, which is this machine running a
 * command — the same code path every local command already uses.
 *
 * There is no shell anywhere in this file: a path with a space, a quote or a
 * glob in it is one argv element, so nothing can be re-split or re-globbed.
 */

import { existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { LocalMachine, type RunResult, type Spawner } from "#services/remote";
import type {
	SyncCreateOptions,
	SyncDaemonState,
	SyncEngine,
	SyncProbe,
	SyncSession,
} from "#services/sync/engine";
import { SyncEngineError } from "#services/sync/engine";

/** The binary this file is the only place allowed to name. */
const BIN = "mutagen";

/** The template that turns `sync list` into machine-readable JSON. */
const LIST_TEMPLATE = "{{json .}}";

/**
 * The engine's session-name rule, checked up front so a bad name fails with a
 * message naming the machine rather than deep inside `--name`.
 *
 * MUTAGEN-INTERNAL (verified 0.18.1, probed with throwaway sessions): a name
 * must start with a Unicode letter, and after that may contain only Unicode
 * letters, digits and `-`. Digits, `_`, `.`, spaces and `!` are rejected as
 * the FIRST character; `_` and `.` are rejected anywhere.
 */
const SESSION_NAME_OK = /^\p{L}[\p{L}\p{N}-]*$/u;

/**
 * Does this name satisfy the engine's session-name rule? Engine-neutral
 * message (C-8): the caller must never have to know what the engine is.
 */
export function sessionNameProblem(name: string): string | null {
	if (SESSION_NAME_OK.test(name)) return null;
	if (name === "") return "a sync session name can't be empty";
	return `\`${name}\` can't be part of a sync session name: it must start with a letter and contain only letters, digits and dashes`;
}

/**
 * Characters the engine's `--ignore` cannot carry.
 *
 * MUTAGEN-INTERNAL (verified 0.18.1): `--ignore` is a pflag *string slice*,
 * and pflag parses string slices as CSV. So one `--ignore` flag per pattern
 * does NOT stop a comma splitting it — `*.{json,bak}` is read as two patterns
 * and the engine fails with "unable to parse pattern: syntax error in
 * pattern", and a `"` fails outright with `bare " in non-quoted-field`.
 * Neither can be worked around at the call site, so the value is rejected
 * before it is ever passed.
 */
const IGNORE_UNSUPPORTED = /[,"]/;

/**
 * Reject an ignore pattern the engine could not have meant. Engine-neutral
 * wording (C-8).
 *
 * `!` is rejected too: the engine treats a leading `!` as negating
 * (un-ignoring) an earlier pattern, so `!/.credentials.json` would silently
 * put credentials back into sync — the one failure mode here with real
 * consequences off-machine.
 */
export function ignorePatternProblem(pattern: string): string | null {
	if (pattern === "") return "an ignore pattern can't be empty";
	if (IGNORE_UNSUPPORTED.test(pattern)) {
		return `\`${pattern}\` can't be used as an ignore pattern: the engine reads ignore patterns as a comma-separated list, so a \`,\` or \`"\` splits or breaks it. Rewrite it without them.`;
	}
	if (pattern.startsWith("!")) {
		return `\`${pattern}\` can't be used as an ignore pattern: a leading \`!\` un-ignores a path, which would put files back into sync.`;
	}
	return null;
}

/** What the user gets told when the binary isn't there. */
function missingBinary(): SyncEngineError {
	return new SyncEngineError(
		"mutagen is not installed — run `hyper machine setup --features tools` to install it.",
		"ENOENT",
	);
}

function friendlyError(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

/**
 * What a stopped daemon looks like on stderr.
 *
 * MUTAGEN-INTERNAL (verified 0.18.1): with `MUTAGEN_DISABLE_AUTOSTART=1`, a
 * stopped daemon fails with "unable to autostart daemon" / "unable to connect
 * to the agent". That specific shape is the ONLY thing we may soften into
 * `running: no`; everything else is a fault the user needs to see.
 *
 * Anchored on purpose. A loose /daemon|agent/ also matches an ordinary failure
 * whose stderr merely mentions a path like `~/.pi/agent`, turning a real fault
 * into "the daemon is down, run `mutagen daemon start`" — advice that cannot
 * work, delivered with a cheerful exit 0.
 */
const DAEMON_UNREACHABLE = /unable to (autostart|connect to) (the )?(daemon|agent)/i;

function daemonUnreachable(err: unknown): boolean {
	if (!(err instanceof SyncEngineError) || err.code !== "DAEMON_UNREACHABLE") return false;
	return DAEMON_UNREACHABLE.test(err.message);
}

/**
 * A session URL as Mutagen spells it in JSON.
 *
 * MUTAGEN-INTERNAL (verified 0.18.1): each endpoint object carries a
 * `protocol` (local or ssh) and a `path`; a remote endpoint also carries
 * `user` and `host`, plus a `port` when one was set. The session object
 * itself has `name`, `status` (a lowercase word: "watching", "scanning",
 * "propagating", "halted", …), `mode`, `paused`, `alpha`, `beta`,
 * `ignore.paths`, `symlink.mode`, `permissions.defaultFileMode` and
 * `permissions.defaultDirectoryMode`.
 *
 * A `local` protocol is spelled as a bare path, so alpha comes back as
 * `/Users/…`. A remote URL is `[user@]host:[port]:path` — verified against
 * live sessions: `svallory@localhost:22:/tmp/x` with a port,
 * `svallory@localhost:/tmp/x` without one.
 *
 * The colon appears after the host ALWAYS, and after the port only when there
 * is one. That is not cosmetic: mutagen parses `host:22/path` (no colon after
 * the port) as a path of `22/path` with NO port set at all, so a `--check`
 * built on the wrong spelling mismatches forever.
 *
 * The user and port MUST be carried through: a Herdr target is commonly
 * `user@host` or `user@host:2222` (`herdr machine add <ssh-target>`), and
 * dropping either would make every `--check` report a permanent mismatch
 * against a session hyperdrive had just created itself.
 */
function endpointUrl(endpoint: Record<string, unknown> | undefined): string {
	if (!endpoint) return "";
	const protocol = endpoint.protocol;
	const path = typeof endpoint.path === "string" ? endpoint.path : "";
	if (protocol === "local" || protocol === undefined) return path;
	const host = typeof endpoint.host === "string" ? endpoint.host : "";
	const user = typeof endpoint.user === "string" && endpoint.user !== "" ? endpoint.user : "";
	const port = typeof endpoint.port === "number" && endpoint.port > 0 ? String(endpoint.port) : "";
	return `${user === "" ? "" : `${user}@`}${host}:${port}${port === "" ? "" : ":"}${path}`;
}

function bool(value: unknown): boolean {
	return value === true;
}

/**
 * Parse `mutagen sync list --template '{{json .}}'`.
 *
 * Mutagen prints one JSON array (empty array when there are no sessions), so
 * there is no "no sessions" special case to write. Anything unparsable is an
 * engine failure, not an empty list: silently reporting "no sessions" when the
 * output changed shape would make a working sync look broken.
 */
export function parseSessionList(stdout: string): SyncSession[] {
	let parsed: unknown;
	try {
		parsed = JSON.parse(stdout.trim() === "" ? "[]" : stdout);
	} catch (err) {
		throw new SyncEngineError(
			`I couldn't read \`${BIN} sync list\` output as JSON (${friendlyError(err)}). The engine may be a version hyperdrive doesn't know.`,
		);
	}
	if (!Array.isArray(parsed)) {
		throw new SyncEngineError(
			`\`${BIN} sync list\` returned JSON that isn't a list, so hyperdrive can't tell which sessions exist.`,
		);
	}
	return parsed.map((raw) => {
		if (typeof raw !== "object" || raw === null) {
			throw new SyncEngineError(`\`${BIN} sync list\` returned an entry hyperdrive can't read.`);
		}
		const entry = raw as Record<string, unknown>;
		const ignore = entry.ignore as { paths?: unknown } | undefined;
		const alpha = entry.alpha as Record<string, unknown> | undefined;
		const beta = entry.beta as Record<string, unknown> | undefined;
		const symlink = entry.symlink as { mode?: unknown } | undefined;
		const betaPermissions = beta?.permissions as
			| { defaultFileMode?: unknown; defaultDirectoryMode?: unknown }
			| undefined;
		return {
			name: typeof entry.name === "string" ? entry.name : "",
			alpha: endpointUrl(alpha),
			beta: endpointUrl(beta),
			status: typeof entry.status === "string" ? entry.status : "unknown",
			mode: typeof entry.mode === "string" ? entry.mode : "",
			ignore: Array.isArray(ignore?.paths)
				? ignore.paths.filter((p): p is string => typeof p === "string")
				: [],
			paused: bool(entry.paused),
			// The symlink mode and beta permissions are part of what makes a
			// session correct: a session created with `portable` symlinks, or with
			// beta files at 0644, must not report as ready.
			symlinkMode: typeof symlink?.mode === "string" ? symlink.mode : "",
			betaFileMode:
				typeof betaPermissions?.defaultFileMode === "string" ? betaPermissions.defaultFileMode : "",
			betaDirMode:
				typeof betaPermissions?.defaultDirectoryMode === "string"
					? betaPermissions.defaultDirectoryMode
					: "",
			alphaConnected: bool(alpha?.connected),
			betaConnected: bool(beta?.connected),
		};
	});
}

/**
 * The exact argv for a session create.
 *
 * Exported so the flags are asserted directly, without a spawner in the way.
 * `--ignore` takes one pattern per flag, in list order. That is tidier, but it
 * is NOT what stops a comma being read as a separator: pflag parses --ignore as
 * a CSV string slice (verified 0.18.1 — `*.{json,bak}` fails with a pattern
 * parse error), so a comma is rejected in the config loader instead.
 */
export function createArgs(
	name: string,
	alpha: string,
	beta: string,
	options: SyncCreateOptions,
): string[] {
	return [
		"sync",
		"create",
		"--name",
		name,
		`--mode=${options.mode}`,
		`--symlink-mode=${options.symlinkMode}`,
		`--default-file-mode-beta=${options.betaFileMode}`,
		`--default-directory-mode-beta=${options.betaDirMode}`,
		...options.ignore.flatMap((pattern) => ["--ignore", pattern]),
		alpha,
		beta,
	];
}

/**
 * Is the daemon registered to start at login?
 *
 * MUTAGEN-INTERNAL (verified 0.18.1): `mutagen daemon register` writes a
 * launch agent at `~/Library/LaunchAgents/io.mutagen.mutagen.plist` on macOS
 * (KeepAlive true, runs `mutagen daemon run`) and a systemd *user* unit at
 * `~/.config/systemd/user/mutagen.service` on Linux. There is no
 * `mutagen daemon status` — `mutagen daemon` only offers start/stop/register/
 * unregister — so the registration file is the only observable state, and
 * asking the engine itself isn't possible. On a platform with neither layout
 * (Windows) the answer is `false`: hyperdrive then suggests running
 * `mutagen daemon register`, which is harmless and idempotent there too.
 */
export function daemonRegistered(): boolean {
	const home = homedir();
	const candidates =
		platform() === "darwin"
			? [join(home, "Library/LaunchAgents/io.mutagen.mutagen.plist")]
			: platform() === "linux"
				? [join(home, ".config/systemd/user/mutagen.service")]
				: [];
	return candidates.some((path) => existsSync(path));
}

export class MutagenSyncEngine implements SyncEngine {
	private readonly runner: LocalMachine;

	/** `spawner` is the same injection seam `LocalMachine` takes (tests use it). */
	constructor(spawner?: Spawner) {
		this.runner = new LocalMachine(spawner);
	}

	/** Run the engine, turning every failure into a friendly SyncEngineError. */
	private async run(args: string[], env?: Record<string, string>): Promise<string> {
		let result: RunResult;
		try {
			result = await this.runner.ssh([BIN, ...args], { env });
		} catch (err) {
			const code = (err as NodeJS.ErrnoException | undefined)?.code;
			// ENOENT is the only "not installed". Anything else (EACCES, a crash)
			// is a different problem and must not masquerade as a missing tool.
			if (code === "ENOENT") throw missingBinary();
			throw new SyncEngineError(`Couldn't run \`${BIN} ${args.join(" ")}\`: ${friendlyError(err)}`);
		}
		if (result.code !== 0) {
			const detail = result.stderr.trim() || result.stdout.trim() || `exit ${result.code}`;
			// Tagged so probe() can tell "the daemon is down" — a state worth
			// reporting — from every other non-zero exit, which is a fault.
			const code = DAEMON_UNREACHABLE.test(detail) ? "DAEMON_UNREACHABLE" : undefined;
			throw new SyncEngineError(`\`${BIN} ${args.join(" ")}\` failed: ${detail}`, code);
		}
		return result.stdout;
	}

	async create(
		name: string,
		alpha: string,
		beta: string,
		options: SyncCreateOptions,
	): Promise<void> {
		await this.run(createArgs(name, alpha, beta, options));
	}

	async list(): Promise<SyncSession[]> {
		return parseSessionList(await this.run(["sync", "list", "--template", LIST_TEMPLATE]));
	}

	async flush(name: string): Promise<void> {
		await this.run(["sync", "flush", name]);
	}

	async terminate(name: string): Promise<void> {
		await this.run(["sync", "terminate", name]);
	}

	async status(name: string): Promise<SyncSession> {
		const session = (await this.list()).find((candidate) => candidate.name === name);
		if (!session) {
			throw new SyncEngineError(
				`There's no sync session called "${name}". Run \`${BIN} sync list\` to see the ones that exist.`,
			);
		}
		return session;
	}

	/**
	 * Liveness and the session list in one round trip.
	 *
	 * MUTAGEN-INTERNAL (verified 0.18.1): by default the CLI autostarts a
	 * stopped daemon (the launch agent is KeepAlive), so a plain `sync list`
	 * would answer "running" even when the daemon was down before we asked.
	 * `MUTAGEN_DISABLE_AUTOSTART=1` (present in the 0.18.1 binary) suppresses
	 * exactly that, which turns this into an honest liveness check: with the
	 * daemon down the command fails instead of quietly bringing it up.
	 */
	async probe(): Promise<SyncProbe> {
		let stdout: string;
		try {
			stdout = await this.run(["sync", "list", "--template", LIST_TEMPLATE], {
				MUTAGEN_DISABLE_AUTOSTART: "1",
			});
		} catch (err) {
			// Only "the daemon did not answer" may be reported as not-running.
			// A missing binary and anything else (EACCES, a crash) must surface:
			// printing `mutagen daemon start` for those is advice that cannot
			// work, and exiting 0 over them hides a real fault.
			if (!daemonUnreachable(err)) throw err;
			return { daemon: { registered: daemonRegistered(), running: false }, sessions: [] };
		}
		// Parsing is OUTSIDE the catch: a `sync list` we cannot understand is
		// not a stopped daemon, and must not be reported as one.
		return {
			daemon: { registered: daemonRegistered(), running: true },
			sessions: parseSessionList(stdout),
		};
	}

	async daemonReady(): Promise<SyncDaemonState> {
		return (await this.probe()).daemon;
	}

	/**
	 * The exact fix commands, so the command layer never has to know that the
	 * engine is Mutagen (C-8).
	 */
	fixHints(state: SyncDaemonState): string[] {
		const hints: string[] = [];
		if (!state.registered) {
			hints.push(`run \`${BIN} daemon register\` so it starts again after a reboot`);
		}
		if (!state.running) hints.push(`run \`${BIN} daemon start\``);
		return hints;
	}

	terminateHint(name: string, machine: string): string {
		return `run \`hyper drive sync-config ${machine}\` after \`${BIN} sync terminate ${name}\``;
	}

	validateSessionName(name: string): string | null {
		return sessionNameProblem(name);
	}

	validateIgnore(pattern: string): string | null {
		return ignorePatternProblem(pattern);
	}
}
