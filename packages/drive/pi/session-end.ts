/**
 * The hyperdrive session-end save for pi, as a plain function of injected
 * dependencies so it can be tested without pi, a space or a CLI.
 *
 * What pi gives us (`dist/core/extensions/types.d.ts`): `session_shutdown`
 * with a reason, awaited by pi with no timeout, plus the session id, file and
 * cwd. What we do with it mirrors `agent-plugin/scripts/hyper-drive-session-end.sh`:
 * find the space by walking up for `.hyper/space.git`, read `hyper.cadence`
 * WITHOUT spawning git, write the payload next to the space's git dir, and
 * start `hyper space commit --session-end --payload-file <file>` in a detached
 * process. Then return at once — the commit, the push and the log line belong
 * to the worker, which is why a 30 MB session never delays pi's exit.
 *
 * Nothing here throws: every failure ends as at most one line.
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { closeSync, openSync, readFileSync, statSync, writeSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

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

/** The cadences the hook script acts on. Everything else (including unset) does nothing. */
const SAVING_CADENCES = new Set(["session-end", "session-end+push"]);

/** Must match `SESSION_END_PAYLOAD_PREFIX` in services/session-end-worker.ts. */
export const PAYLOAD_PREFIX = "session-end-payload.";

/** The CLI's own limit; one byte more and the worker refuses the payload. */
const PAYLOAD_LIMIT = 64 * 1024;

export type Cadence = string;

export interface SessionEndDeps {
	/** Read a file, or throw. Injected so tests need no fixtures on disk. */
	readFile(path: string): string;
	/** True when `path` is a directory. */
	isDirectory(path: string): boolean;
	/** Write the payload file exclusively; returns the path written. */
	writePayload(dir: string, contents: string): string;
	/** Start the detached worker. Never throws; a missing CLI is reported by `notify`. */
	spawnWorker(payloadPath: string, spaceRoot: string): void;
	/** Tell the user one line (TUI notification, or stderr with no UI). */
	notify(line: string): void;
}

/** What the handler needs from the session, all captured at shutdown time. */
export interface SessionFacts {
	/** pi's session id (a UUID by default). */
	sessionId: string;
	/** The session's cwd — the space may be an ancestor of it. */
	cwd: string;
	/** The session's name, when the user or pi gave it one. */
	sessionName?: string | undefined;
	/** The active branch's entries, oldest first. */
	entries: readonly unknown[];
}

/** Nearest ancestor holding `.hyper/space.git`, or undefined. */
export function findSpaceRoot(
	cwd: string,
	isDirectory: (path: string) => boolean,
): string | undefined {
	let current = resolve(cwd);
	for (;;) {
		if (isDirectory(join(current, ".hyper", "space.git"))) return current;
		const parent = dirname(current);
		if (parent === current) return undefined;
		current = parent;
	}
}

/**
 * Read `hyper.cadence` from the space git dir's config file. This is the one
 * thing the Claude hook gets from `git config`; a pi extension cannot spawn
 * git, and the file it would read is plain INI written by that very command.
 * Unparseable or absent means "no cadence", so nothing is saved.
 */
export function readCadenceFromConfig(config: string | undefined): Cadence {
	if (!config) return "";
	let section = "";
	for (const line of config.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith(";")) continue;
		const header = /^\[(.+)\]$/.exec(trimmed);
		if (header) {
			section = header[1].trim().toLowerCase();
			continue;
		}
		if (section !== "hyper") continue;
		const pair = /^([A-Za-z0-9.-]+)\s*=\s*(.*)$/.exec(trimmed);
		if (pair?.[1].toLowerCase() !== "cadence") continue;
		const value = pair[2].trim();
		// git quotes values that need it; only the plain unquoted form is ours.
		return value.startsWith('"') && value.endsWith('"') && value.length > 1
			? value.slice(1, -1)
			: value;
	}
	return "";
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
 * Trimmed to the CLI's 200 code-point cap here so the payload stays small; the
 * CLI cleans and caps it again regardless of what a sender does.
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
 * The whole handler: decide, write, detach. Returns what it did, for the tests
 * and for the log line in the report; pi ignores the return value.
 */
export function saveSessionEnd(
	facts: SessionFacts,
	deps: SessionEndDeps,
): SessionEndPayload | undefined {
	const root = findSpaceRoot(facts.cwd, deps.isDirectory);
	if (!root) return undefined;
	const gitDir = join(root, ".hyper", "space.git");
	let cadence: Cadence;
	try {
		cadence = readCadenceFromConfig(deps.readFile(join(gitDir, "config")));
	} catch {
		return undefined;
	}
	if (!SAVING_CADENCES.has(cadence)) return undefined;
	const summary = sessionSummary(facts);
	const payload: SessionEndPayload = {
		session_id: facts.sessionId,
		cwd: facts.cwd,
		harness: "pi",
		...(summary ? { summary } : {}),
	};
	let payloadPath: string;
	try {
		payloadPath = deps.writePayload(gitDir, JSON.stringify(payload));
	} catch {
		deps.notify(
			`hyperdrive: could not write the session-end payload into ${gitDir}; nothing was saved`,
		);
		return undefined;
	}
	deps.spawnWorker(payloadPath, root);
	return payload;
}

/** Real filesystem and process dependencies, for the extension entry point. */
export const realDeps: SessionEndDeps = {
	readFile: (path) => readFileSync(path, "utf8"),
	isDirectory: (path) => {
		try {
			return statSync(path).isDirectory();
		} catch {
			return false;
		}
	},
	writePayload: (dir, contents) => {
		const path = join(dir, `${PAYLOAD_PREFIX}${process.pid}.${randomBytes(6).toString("hex")}`);
		// O_EXCL: two pi sessions in one space must not share a payload file.
		const fd = openSync(path, "wx", 0o600);
		try {
			writeSync(fd, contents.slice(0, PAYLOAD_LIMIT));
		} finally {
			closeSync(fd);
		}
		return path;
	},
	spawnWorker: (payloadPath, spaceRoot) => {
		let child;
		try {
			child = spawn("hyper", ["space", "commit", "--session-end", "--payload-file", payloadPath], {
				// The worker's own session: it survives pi exiting, and a kill of
				// pi's process group does not reach it. pi only kills the pids
				// its own bash tool tracked, and this child is not one.
				detached: true,
				stdio: "ignore",
				cwd: spaceRoot,
				env: { ...process.env, HYPER_SKIP_NEW_VERSION_CHECK: "1" },
			});
		} catch {
			realDeps.notify(`hyperdrive: could not start \`hyper\`; nothing was saved`);
			return;
		}
		child.on("error", () => {
			// ENOENT arrives here, after the fact: one line, never into pi's face.
			realDeps.notify("hyperdrive: the hyper CLI is not installed; nothing was saved");
		});
		child.unref();
	},
	notify: (line) => {
		process.stderr.write(`${line}\n`);
	},
};
