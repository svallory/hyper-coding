/**
 * The hyperdrive session-end save for pi, as a function of injected
 * dependencies so it can be tested without pi, a space or a CLI.
 *
 * The extension never decides anything about spaces itself. It asks the
 * installed CLI once — `hyper space detect --json`, read-only, bounded — and
 * that answer is the only source of truth for "is this a space", "which
 * space" and "which cadence". A second implementation of detection in here
 * would disagree with the CLI (a `.hyper/space.git` left inside a checkout is
 * not a space), and the disagreement costs the save.
 *
 * What it does with the answer mirrors
 * `agent-plugin/scripts/hyper-drive-session-end.sh`: write the payload into
 * the git dir the CLI named, start `hyper space commit --session-end
 * --payload-file <file>` detached from the session's own directory, and
 * return. The commit, the push and the log line belong to the worker, so a
 * 30 MB session never delays pi's exit.
 *
 * `hyper` is resolved here, never left to the child's PATH: only ABSOLUTE
 * PATH entries count, the candidate must be an executable regular file, and
 * that absolute path is what gets spawned. `bin/` is synced space content, so
 * a space that carries its own `bin/hyper` must not decide what runs at the
 * end of every pi session in it.
 *
 * Nothing here throws: every failure ends as at most one line.
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
	closeSync,
	constants,
	fstatSync,
	lstatSync,
	openSync,
	renameSync,
	statSync,
	writeSync,
} from "node:fs";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";

/** Same shape the Claude SessionEnd hook sends, plus the two fields below. */
export interface SessionEndPayload {
	session_id: string;
	cwd: string;
	/** Pi's session file. Not sent: it has no `type:"summary"` records (see deviations.md). */
	transcript_path?: string;
	/** Session name, else the first line of the first user prompt. Untrusted text. */
	summary?: string;
	/** Names the trailer of the commit message: `Pi-Session: <id>`. */
	harness: "pi";
}

/** What one `hyper space detect --json` told us. */
export interface SpaceAnswer {
	root: string;
	spaceGitDir: string;
	cadence: string;
}

/** The cadences that save. Everything else (including unset) does nothing. */
const SAVING_CADENCES = new Set(["session-end", "session-end+push"]);

/** Must match `SESSION_END_PAYLOAD_PREFIX` in services/session-end-worker.ts. */
export const PAYLOAD_PREFIX = "session-end-payload.";

/**
 * Hard bound on the one CLI call. A cold CLI start measured 0.95 s alone and
 * over 2 s under load, so 5 s. Past it nothing is saved; near a space the
 * miss is logged (see `PROBE_TIMEOUT_DETAIL`).
 */
export const PROBE_TIMEOUT_MS = 5_000;

/**
 * The `failed` detail a timed-out probe leaves in `session-end.log`, so
 * `hyper space status` shows the save that did not happen.
 */
export const PROBE_TIMEOUT_DETAIL =
	"probe timed out (the cadence was never read, so a manual space logs this too)";

/**
 * The worker's log, replicated: this extension is loaded by pi on its own (and
 * may be copied into a project) so it imports nothing from the CLI. Must match
 * `SESSION_END_LOG`, `SESSION_END_LOG_LIMIT` and the record format in
 * src/services/session-end-log.ts; tests/pi-session-end.test.ts parses a line
 * written here with the real reader.
 */
export const SESSION_END_LOG = "session-end.log";
const SESSION_END_LOG_LIMIT = 64 * 1024;

/** The CLI never prints more than this; more than this is not its answer. */
const PROBE_OUTPUT_LIMIT = 64 * 1024;

export const MISSING_CLI_LINE = "hyperdrive: the hyper CLI is not installed; nothing was saved";
/** The same shape as the Claude hook's outdated-CLI line. */
export const OUTDATED_CLI_LINE =
	"hyperdrive: the installed hyper CLI is too old for this pi extension (it cannot report a space's root, git dir and cadence); update @hypercli/cli";

export interface ProbeResult {
	status: number | null;
	stdout: string;
	timedOut: boolean;
}

export interface SessionEndDeps {
	/** Absolute path of the `hyper` to use, or undefined when PATH has none. */
	resolveCli(): string | undefined;
	/** Run `hyper space detect --json` in `cwd`, bounded by `timeoutMs`. */
	probe(bin: string, cwd: string, timeoutMs: number): Promise<ProbeResult>;
	/** Write the payload file exclusively; returns the path written. */
	writePayload(dir: string, contents: string): string;
	/** Start the detached worker. Never throws; a failure is reported through `notify`. */
	spawnWorker(payloadPath: string, bin: string, cwd: string, notify: (line: string) => void): void;
	/** Tell the user one line (TUI notification, or stderr with no UI). */
	notify(line: string): void;
	/** Append one `failed` record to `<gitDir>/session-end.log`. Never throws. */
	logFailure(gitDir: string, sessionId: string, detail: string): void;
	/** Overridable so the tests can see the options a child really gets. */
	spawn?: typeof spawn;
	/** Overridable so the tests can force a payload-name collision. */
	payloadName?: () => string;
}

/** What the handler needs from the session, all captured at shutdown time. */
export interface SessionFacts {
	/** pi's session id (a UUID by default; a custom `--session-id` may not be). */
	sessionId: string;
	/** The session's cwd — the space may be an ancestor of it. */
	cwd: string;
	/** The session's name, when the user or pi gave it one. */
	sessionName?: string | undefined;
	/** The active branch's entries, oldest first. */
	entries: readonly unknown[];
}

/**
 * PATH entries that cannot be trusted from a directory whose contents a space
 * or a clone controls. `./bin`, `.`, `node_modules/.bin` and `~/…` are all
 * resolved against the CHILD's cwd — which is the session's directory, because
 * that is where the probe and the worker have to run — so a relative entry
 * there means "whatever this checkout ships". Only absolute entries survive.
 */
export function absolutePathEntries(pathValue = process.env.PATH ?? ""): string[] {
	return pathValue
		.split(delimiter)
		.filter((entry) => entry.length > 0 && isAbsolute(entry) && !entry.startsWith("~"));
}

/**
 * The `hyper` to spawn: the first executable regular file named `hyper` in an
 * absolute PATH entry. The child gets that same filtered PATH, so the CLI's
 * own `bash` and `git` lookups cannot land in the session's directory either.
 */
export function resolveHyper(env: NodeJS.ProcessEnv = process.env): string | undefined {
	for (const entry of absolutePathEntries(env.PATH)) {
		for (const name of process.platform === "win32" ? ["hyper.cmd", "hyper"] : ["hyper"]) {
			const candidate = join(entry, name);
			try {
				const stats = statSync(candidate);
				if (stats.isFile() && (stats.mode & 0o111) !== 0) return candidate;
			} catch {
				// Not there, or not readable: keep looking.
			}
		}
	}
	return undefined;
}

/**
 * Parse `hyper space detect --json`.
 *
 * `undefined` means "nothing to save here": no root, a root whose
 * `spaceGitDir` is null (a space whose history was never initialised), a git
 * dir that is not the one this root implies, or a `cadence` that is not one of
 * the three. A thrown error means exactly one thing: the CLI answered with an
 * object that HAS a root and NO `spaceGitDir` key, so it predates T-18.
 * Anything unparseable, empty or absurd is silence, not an accusation.
 */
export function parseSpaceAnswer(result: ProbeResult): SpaceAnswer | undefined {
	let value: unknown;
	try {
		value = JSON.parse(result.stdout);
	} catch {
		return undefined;
	}
	if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
	const record = value as Record<string, unknown>;
	if (record.root === null || record.root === undefined) return undefined;
	if (typeof record.root !== "string") return undefined;
	if (!("spaceGitDir" in record)) throw new Error("the CLI reported no git dir");
	if (record.spaceGitDir === null) return undefined;
	if (typeof record.spaceGitDir !== "string") return undefined;
	if (record.cadence !== null && typeof record.cadence !== "string") return undefined;
	// The payload is written into this directory, so the directory has to BE the
	// one this root implies. A probe that says otherwise is refused, not obeyed.
	if (
		!isAbsolute(record.spaceGitDir) ||
		record.spaceGitDir !== join(record.root, ".hyper", "space.git")
	)
		return undefined;
	return { root: record.root, spaceGitDir: record.spaceGitDir, cadence: record.cadence ?? "" };
}

interface ContentBlock {
	type?: unknown;
	text?: unknown;
}

/** Text of a `message` entry's user content: a string, or the first text block. */
export function entryText(entry: unknown): string | undefined {
	if (entry === null || typeof entry !== "object") return undefined;
	const message = (entry as { message?: unknown }).message;
	if (message === null || typeof message !== "object") return undefined;
	const record = message as { role?: unknown; content?: unknown };
	if (record.role !== "user") return undefined;
	if (typeof record.content === "string") return record.content;
	if (!Array.isArray(record.content)) return undefined;
	for (const block of record.content as ContentBlock[]) {
		if (block?.type === "text" && typeof block.text === "string" && block.text.trim())
			return block.text;
	}
	return undefined;
}

/**
 * The summary the commit subject carries: the session name when there is one,
 * else the first non-empty line of the FIRST user prompt on the active branch.
 * Capped here so the payload stays small; the CLI cleans and caps it again
 * regardless of what a sender does.
 */
export function sessionSummary(facts: SessionFacts, limit = 200): string | undefined {
	const name = facts.sessionName?.trim();
	const source = name || firstUserLine(facts.entries);
	if (!source) return undefined;
	return Array.from(source.replace(/\s+/gu, " ").trim()).slice(0, limit).join("");
}

function firstUserLine(entries: readonly unknown[]): string | undefined {
	for (const entry of entries) {
		const text = entryText(entry);
		if (!text) continue;
		const firstLine = text.split(/\r?\n/u).find((line) => line.trim().length > 0);
		if (firstLine?.trim()) return firstLine.trim();
	}
	return undefined;
}

/**
 * The whole handler: ask, decide, write, detach. Returns what it did for the
 * tests; pi ignores the return value.
 */
export async function saveSessionEnd(
	facts: SessionFacts,
	deps: SessionEndDeps,
	timeoutMs = PROBE_TIMEOUT_MS,
): Promise<SessionEndPayload | undefined> {
	const bin = deps.resolveCli();
	if (bin === undefined) {
		// The Claude hook prints this line only in a space that would have saved.
		// Same rule here: this walk decides whether to PRINT and nothing else —
		// what gets saved is decided by the CLI, below.
		if (findSpaceGitDir(facts.cwd) !== undefined) deps.notify(MISSING_CLI_LINE);
		return undefined;
	}
	let answer: SpaceAnswer | undefined;
	try {
		const probed = await deps.probe(bin, facts.cwd, timeoutMs);
		// A CLI that did not answer in time is not an old CLI: it is a slow
		// machine or a stuck process. Nothing is saved and nothing is printed,
		// but near a space the miss goes into its session-end log, where
		// `hyper space status` reports it. The walk picks the log's directory
		// and nothing else: that one line is all that is written there.
		if (probed.timedOut) {
			const gitDir = findSpaceGitDir(facts.cwd);
			if (gitDir !== undefined) deps.logFailure(gitDir, facts.sessionId, PROBE_TIMEOUT_DETAIL);
			return undefined;
		}
		answer = parseSpaceAnswer(probed);
	} catch {
		deps.notify(OUTDATED_CLI_LINE);
		return undefined;
	}
	if (answer === undefined) return undefined;
	if (!SAVING_CADENCES.has(answer.cadence)) return undefined;
	const summary = sessionSummary(facts);
	const payload: SessionEndPayload = {
		session_id: facts.sessionId,
		cwd: facts.cwd,
		harness: "pi",
		...(summary ? { summary } : {}),
	};
	let payloadPath: string;
	try {
		payloadPath = deps.writePayload(answer.spaceGitDir, JSON.stringify(payload));
	} catch {
		deps.notify(
			`hyperdrive: could not write the session-end payload into ${answer.spaceGitDir}; nothing was saved`,
		);
		return undefined;
	}
	deps.spawnWorker(payloadPath, bin, facts.cwd, deps.notify);
	return payload;
}

/**
 * The nearest `.hyper/space.git` directory at or above `dir`. Used ONLY to
 * decide whether a missing CLI is worth a line and where a timed-out probe is
 * logged — never to decide what to save or run, which is the CLI's answer or
 * nothing.
 */
export function findSpaceGitDir(dir: string): string | undefined {
	let current = resolve(dir);
	for (;;) {
		const candidate = join(current, ".hyper", "space.git");
		if (isRealSpaceGitDir(candidate)) return candidate;
		const parent = dirname(current);
		if (parent === current) return undefined;
		current = parent;
	}
}

/**
 * A real directory at both `.hyper` and `.hyper/space.git` (no symlink at
 * either level, checked with `lstat`) that looks like a git dir: `HEAD` and
 * `config` are regular files. A clone can carry symlinks or a bare
 * `.hyper/space.git` folder as content, and the timeout line must never be
 * steered through one; a candidate that fails is skipped and the walk goes on.
 */
function isRealSpaceGitDir(candidate: string): boolean {
	try {
		if (!lstatSync(dirname(candidate)).isDirectory()) return false;
		if (!lstatSync(candidate).isDirectory()) return false;
		return (
			lstatSync(join(candidate, "HEAD")).isFile() && lstatSync(join(candidate, "config")).isFile()
		);
	} catch {
		return false;
	}
}

/** `sessionEndLine` from src/services/session-end.ts: one line, no controls, capped. */
function logField(text: string, limit: number): string {
	return Array.from(
		text
			.replace(/\s+/gu, " ")
			.replace(/[\p{Cc}\p{Cf}]/gu, "")
			.trim(),
	)
		.slice(0, limit)
		.join("");
}

/**
 * `appendSessionEndLog(gitDir, { session, outcome: "failed", detail })`: the
 * same tab-separated record and the same rotation, except that it never
 * follows a symlink. A `session-end.log` that exists and is not a regular file
 * is refused, and the open is `O_NOFOLLOW`. Never throws: a log that cannot be
 * written costs nothing more than the save already lost.
 */
export function appendFailureLine(gitDir: string, sessionId: string, detail: string): void {
	const path = join(gitDir, SESSION_END_LOG);
	try {
		let existing: ReturnType<typeof lstatSync> | undefined;
		try {
			existing = lstatSync(path);
		} catch {
			/* No log yet. */
		}
		if (existing !== undefined) {
			if (!existing.isFile()) return;
			if (existing.size >= SESSION_END_LOG_LIMIT) renameSync(path, `${path}.1`);
		}
		const record = [
			new Date().toISOString(),
			logField(sessionId, 64) || "-",
			"failed",
			logField(detail, 600),
		].join("\t");
		const fd = openSync(
			path,
			constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW,
			0o600,
		);
		try {
			// Swapped for something else between the lstat and the open.
			if (!fstatSync(fd).isFile()) return;
			writeSync(fd, `${record}\n`);
		} finally {
			closeSync(fd);
		}
	} catch {
		// An unwritable git dir, or a symlink planted in the log's place.
	}
}

/**
 * The environment every child gets: no CLI update check racing the teardown,
 * and a PATH of absolute entries only. The probe and the worker both run with
 * the session's directory as their cwd, so a relative PATH entry would let
 * that directory decide which `bash` and which `git` the CLI runs — and
 * `bin/` is synced space content.
 */
export function childEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
	return {
		...env,
		PATH: absolutePathEntries(env.PATH).join(delimiter),
		HYPER_SKIP_NEW_VERSION_CHECK: "1",
	};
}

/** Run the resolved CLI once, hard-killed at `timeoutMs`, output captured. */
function runProbe(
	bin: string,
	cwd: string,
	timeoutMs: number,
	spawnFn: typeof spawn = spawn,
): Promise<ProbeResult> {
	return new Promise((resolve) => {
		let settled = false;
		const finish = (result: ProbeResult) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve(result);
		};
		let child;
		try {
			child = spawnFn(bin, ["space", "detect", "--json"], {
				cwd,
				env: childEnv(),
				stdio: ["ignore", "pipe", "ignore"],
			});
		} catch {
			resolve({ status: null, stdout: "", timedOut: false });
			return;
		}
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			finish({ status: null, stdout: "", timedOut: true });
		}, timeoutMs);
		let stdout = "";
		let overflowed = false;
		child.stdout?.on("data", (chunk: Buffer) => {
			if (overflowed) return;
			stdout += chunk.toString();
			// More than the CLI could ever print is not an answer.
			if (stdout.length > PROBE_OUTPUT_LIMIT) {
				overflowed = true;
				child.kill("SIGKILL");
				finish({ status: null, stdout: "", timedOut: false });
			}
		});
		child.on("error", () => finish({ status: null, stdout: "", timedOut: false }));
		child.on("close", (status) =>
			finish({ status, stdout: overflowed ? "" : stdout, timedOut: false }),
		);
	});
}

/**
 * Real filesystem and process dependencies. `overrides.spawn` exists so a test
 * can see the options and argv a child really gets; pi never passes one.
 */
export function createRealDeps(overrides: Partial<SessionEndDeps> = {}): SessionEndDeps {
	const spawnFn = overrides.spawn ?? spawn;
	const payloadName =
		overrides.payloadName ??
		(() => `${PAYLOAD_PREFIX}${process.pid}.${randomBytes(6).toString("hex")}`);
	return {
		resolveCli: () => resolveHyper(),
		probe: (bin, cwd, timeoutMs) => runProbe(bin, cwd, timeoutMs, spawnFn),
		writePayload: (dir, contents) => {
			// O_EXCL: two pi sessions in one space must not share a payload file, so
			// the name is unique per call and a forced collision is a refusal.
			const path = join(dir, payloadName());
			const fd = openSync(path, "wx", 0o600);
			try {
				writeSync(fd, contents);
			} finally {
				closeSync(fd);
			}
			return path;
		},
		spawnWorker: (payloadPath, bin, cwd, notify) => {
			let child;
			try {
				child = spawnFn(bin, ["space", "commit", "--session-end", "--payload-file", payloadPath], {
					// Its own session, so it survives pi exiting and a kill of pi's
					// process group. pi only kills the pids its own bash tool
					// tracked, and this child is not one.
					detached: true,
					stdio: "ignore",
					// The session's own directory, never a root we guessed: the
					// worker resolves the space itself and refuses a payload that
					// belongs to another one.
					cwd,
					env: childEnv(),
				});
			} catch {
				notify(MISSING_CLI_LINE);
				return;
			}
			child.on("error", () => notify(MISSING_CLI_LINE));
			child.unref();
		},
		notify: (line) => {
			process.stderr.write(`${line}\n`);
		},
		logFailure: appendFailureLine,
		...overrides,
	};
}

/** The extension's real dependencies. */
export const realDeps: SessionEndDeps = createRealDeps();
