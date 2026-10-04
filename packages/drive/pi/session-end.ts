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
import { closeSync, openSync, statSync, writeSync } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";

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

/** The CLI's own limit; the payload never approaches it, and we send bytes. */
const PAYLOAD_LIMIT = 64 * 1024;

/** Hard bound on the one CLI call. Past it, give up silently. */
export const PROBE_TIMEOUT_MS = 2_000;

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
 * The `hyper` to spawn: the first executable regular file named `hyper` in an
 * ABSOLUTE PATH entry. Relative entries are skipped on purpose — the child's
 * cwd is the session's directory, so `./bin` would resolve inside whatever
 * space or checkout the session runs in, and `bin/` is synced space content.
 */
export function resolveHyper(env: NodeJS.ProcessEnv = process.env): string | undefined {
	for (const entry of (env.PATH ?? "").split(delimiter)) {
		if (entry.length === 0 || !isAbsolute(entry)) continue;
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
 * Parse `hyper space detect --json`. `undefined` means "not a space" (the CLI
 * says so with nulls); a thrown error means the CLI is too old to answer, and
 * the caller prints one line instead of guessing.
 */
export function parseSpaceAnswer(result: ProbeResult): SpaceAnswer | undefined {
	let value: unknown;
	try {
		value = JSON.parse(result.stdout);
	} catch {
		throw new Error("the CLI printed no JSON");
	}
	if (value === null || typeof value !== "object") throw new Error("the CLI printed no object");
	const record = value as Record<string, unknown>;
	if (record.root === null) return undefined;
	if (typeof record.root !== "string") throw new Error("the CLI named no root");
	if (typeof record.spaceGitDir !== "string") throw new Error("the CLI reported no git dir");
	if (record.cadence !== null && typeof record.cadence !== "string")
		throw new Error("the CLI reported an unreadable cadence");
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
		deps.notify(MISSING_CLI_LINE);
		return undefined;
	}
	let answer: SpaceAnswer | undefined;
	const probed = await deps.probe(bin, facts.cwd, timeoutMs);
	// A CLI that did not answer in time is not an old CLI: it is a slow machine
	// or a stuck process, and the honest thing is to save nothing, silently.
	if (probed.timedOut) return undefined;
	try {
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

/** The environment every child gets: no CLI update check racing the teardown. */
const CHILD_ENV = { ...process.env, HYPER_SKIP_NEW_VERSION_CHECK: "1" };

/** Run the resolved CLI once, hard-killed at `timeoutMs`, output captured. */
function runProbe(bin: string, cwd: string, timeoutMs: number): Promise<ProbeResult> {
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
			child = spawn(bin, ["space", "detect", "--json"], { cwd, env: CHILD_ENV });
		} catch {
			resolve({ status: null, stdout: "", timedOut: false });
			return;
		}
		const timer = setTimeout(() => {
			child.kill("SIGKILL");
			finish({ status: null, stdout: "", timedOut: true });
		}, timeoutMs);
		let stdout = "";
		child.stdout?.on("data", (chunk: Buffer) => {
			stdout += chunk.toString();
		});
		child.stderr?.resume();
		child.on("error", () => finish({ status: null, stdout: "", timedOut: false }));
		child.on("close", (status) => finish({ status, stdout, timedOut: false }));
	});
}

/** Real filesystem and process dependencies, for the extension entry point. */
export const realDeps: SessionEndDeps = {
	resolveCli: () => resolveHyper(),
	probe: (bin, cwd, timeoutMs) => runProbe(bin, cwd, timeoutMs),
	writePayload: (dir, contents) => {
		const path = join(dir, `${PAYLOAD_PREFIX}${process.pid}.${randomBytes(6).toString("hex")}`);
		// O_EXCL: two pi sessions in one space must not share a payload file.
		const fd = openSync(path, "wx", 0o600);
		try {
			writeSync(fd, Buffer.from(contents, "utf8").subarray(0, PAYLOAD_LIMIT));
		} finally {
			closeSync(fd);
		}
		return path;
	},
	spawnWorker: (payloadPath, bin, cwd, notify) => {
		let child;
		try {
			child = spawn(bin, ["space", "commit", "--session-end", "--payload-file", payloadPath], {
				// Its own session, so it survives pi exiting and a kill of pi's
				// process group. pi only kills the pids its own bash tool
				// tracked, and this child is not one.
				detached: true,
				stdio: "ignore",
				// The session's own directory, never a root we guessed: the
				// worker resolves the space itself and refuses a payload that
				// belongs to another one.
				cwd,
				env: CHILD_ENV,
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
};
