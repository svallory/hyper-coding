/**
 * Claude Code session discovery and warp ownership.
 *
 * This module is the ONLY place in @hypercli/drive that knows how Claude Code
 * lays out `~/.claude` on disk. Every assumption about Claude Code's private
 * file formats carries a `CLAUDE-INTERNAL (verified <version>)` comment so a
 * future break is found with:
 *
 *   grep -rn "CLAUDE-INTERNAL" packages/drive/src
 *
 * Nothing here writes to, moves or deletes anything under the real
 * `~/.claude` except the ownership marker next to a transcript.
 */

import {
	existsSync,
	readdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, extname, join, resolve } from "node:path";

/** Claude Code version these on-disk facts were observed on. */
export const VERIFIED_CLAUDE_VERSION = "2.1.288";

/**
 * Root of Claude Code's config/state directory.
 *
 * The only place this path is built. `CLAUDE_CONFIG_DIR` wins (it is what
 * Claude Code itself honours), otherwise `~/.claude`.
 */
export function claudeHome(): string {
	return process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
}

/**
 * Claude Code's mapping of an absolute working directory to the folder name it
 * uses under `~/.claude/projects/`.
 *
 * CLAUDE-INTERNAL (verified 2.1.288)
 * Observed on this machine: `/Users/svallory/work/hyper/hyper` →
 * `-Users-svallory-work-hyper-hyper`, i.e. the leading `/` and every character
 * outside `[A-Za-z0-9]` each become a single `-`. Verified against the
 * installed `claude` by running `claude -p` in temp dirs named `plain`,
 * `dot.name`, `under_score`, `with space`, `ünïcodé` and `dash-and.ü_ x`:
 * they produced `plain`, `dot-name`, `under-score`, `with-space`,
 * `-n-cod-` and `dash-and----x` respectively. Non-ASCII letters are replaced,
 * not kept and not transliterated.
 *
 * The path is resolved through `realpath` first, because Claude Code does that:
 * a session run in `/tmp/enc-probe.XXXX/plain` created the folder
 * `-private-tmp-enc-probe-XXXX-plain`.
 *
 * The result is therefore not reversible and two different cwds can collide;
 * callers match on the realpath of the cwd, not on this name.
 */
export function encodeProjectDir(cwd: string): string {
	// CLAUDE-INTERNAL (verified 2.1.288): see the doc comment above.
	return safeRealpath(cwd).replace(/[^A-Za-z0-9]/g, "-");
}

/**
 * Absolute path of the project folder Claude Code keeps for `cwd`.
 *
 * CLAUDE-INTERNAL (verified 2.1.288): `~/.claude/projects/<encodeProjectDir(cwd)>`.
 */
export function projectDir(cwd: string): string {
	return join(claudeHome(), "projects", encodeProjectDir(cwd));
}

/** A transcript file (`*.jsonl`) of one session inside a project folder. */
export interface TranscriptRef {
	/** Session id: the file's basename without the `.jsonl` extension. */
	id: string;
	/** Absolute path of the transcript. */
	path: string;
	/** Last-modified time, used to order newest first. */
	mtime: Date;
}

/**
 * Transcripts of `cwd`, newest first.
 *
 * CLAUDE-INTERNAL (verified 2.1.288): a project folder holds one
 * `<sessionId>.jsonl` per session; nothing else with a `.jsonl` suffix is
 * treated as a transcript (e.g. this module's own `<id>.warp.json` marker).
 */
export function listTranscripts(cwd: string): TranscriptRef[] {
	const dir = projectDir(cwd);
	if (!existsSync(dir)) return [];

	const out: TranscriptRef[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (!entry.isFile() || extname(entry.name) !== ".jsonl") continue;
		const path = join(dir, entry.name);
		out.push({
			id: basename(entry.name, ".jsonl"),
			path,
			mtime: statSync(path).mtime,
		});
	}
	return out.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
}

/** Newest transcript of `cwd`, or null when the project has none. */
export function latestTranscript(cwd: string): TranscriptRef | null {
	return listTranscripts(cwd)[0] ?? null;
}

/** A running Claude Code process started in `cwd`. */
export interface LiveSession {
	pid: number;
	/** Claude Code's session id, when the sessions file carries one. */
	sessionId?: string;
	/** Process start time in epoch milliseconds, when present. */
	startedAt?: number;
	/** Realpath of the working directory, as Claude Code recorded it. */
	cwd: string;
	/** Human-readable session name, when present. */
	name?: string;
}

/** CLAUDE-INTERNAL (verified 2.1.288): `~/.claude/sessions/<pid>.json`. */
const SESSIONS_FILE = /^(\d+)\.json$/;

/**
 * The live Claude Code process whose working directory is `cwd`, or null.
 *
 * CLAUDE-INTERNAL (verified 2.1.288): `~/.claude/sessions/` holds one
 * `<pid>.json` per running session (32 on this machine while writing this,
 * including sessions launched by other agents) plus
 * `<pid>.<sha256>.key` files, which are not sessions. The JSON carries
 * `pid`, `cwd`, `sessionId`, `startedAt` (epoch ms), `procStart`, `version`,
 * `entrypoint`, `kind`, `status`, `name`, `messagingSocketPath`.
 *
 * Entries are kept only when `realpath(cwd)` equals their `cwd` and their pid
 * is alive (`process.kill(pid, 0)`); stale files from dead processes are
 * ignored, never deleted. The newest surviving entry wins.
 */
export function liveSession(cwd: string): LiveSession | null {
	const dir = join(claudeHome(), "sessions");
	if (!existsSync(dir)) return null;

	const wanted = safeRealpath(cwd);
	const found: LiveSession[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (!entry.isFile()) continue;
		const match = SESSIONS_FILE.exec(entry.name);
		if (!match) continue;
		const parsed = parseSessionFile(join(dir, entry.name));
		if (!parsed || parsed.cwd === undefined) continue;
		if (safeRealpath(parsed.cwd) !== wanted) continue;
		const pid = parsed.pid ?? Number(match[1]);
		if (!Number.isInteger(pid) || pid <= 0 || !isAlive(pid)) continue;
		found.push({
			pid,
			...(parsed.sessionId ? { sessionId: parsed.sessionId } : {}),
			...(typeof parsed.startedAt === "number" ? { startedAt: parsed.startedAt } : {}),
			cwd: parsed.cwd,
			...(parsed.name ? { name: parsed.name } : {}),
		});
	}

	if (found.length === 0) return null;
	return found.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))[0] ?? null;
}

/** How {@link stopSession} ended. */
export type StopOutcome =
	/** The process was already gone. */
	| "gone"
	/** The process exited during the grace period (SIGTERM worked). */
	| "terminated"
	/** The process needed SIGKILL. */
	| "killed";

/**
 * Stop a Claude Code process started in `cwd`: SIGTERM, poll until it is gone
 * or `graceMs` elapses, then SIGKILL.
 *
 * Refuses to signal a pid whose sessions file cwd does not match `cwd`
 * (C-18: the check is what keeps `hyper warp --stop` from killing a machine's
 * other agents). Returns null when the pid is unknown for this cwd.
 *
 * Async on purpose: a blocking 10 s poll would freeze the event loop, and a
 * process that is a child of this one only stops answering `kill(pid, 0)` once
 * the OS reaps it, which needs the event loop to run.
 */
export async function stopSession(
	pid: number,
	options: { cwd: string; graceMs?: number },
): Promise<StopOutcome | null> {
	const { cwd, graceMs = 10_000 } = options;
	if (!ownsPid(pid, cwd)) return null;
	if (!isAlive(pid)) return "gone";

	signal(pid, "SIGTERM");
	const deadline = Date.now() + graceMs;
	while (Date.now() < deadline) {
		if (!isAlive(pid)) return "terminated";
		await sleep(100);
	}
	if (!isAlive(pid)) return "terminated";

	signal(pid, "SIGKILL");
	await sleep(100);
	return "killed";
}

/** Whether `pid` is the owner of a live session in `cwd`. */
function ownsPid(pid: number, cwd: string): boolean {
	const dir = join(claudeHome(), "sessions");
	const path = join(dir, `${pid}.json`);
	if (!existsSync(path)) return false;
	const parsed = parseSessionFile(path);
	return parsed?.cwd !== undefined && safeRealpath(parsed.cwd) === safeRealpath(cwd);
}

/** True when the process exists (signal 0 does not deliver anything). */
function isAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		// EPERM means it exists but belongs to someone else; treat as alive.
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

function signal(pid: number, name: NodeJS.Signals): void {
	try {
		process.kill(pid, name);
	} catch {
		// Already gone; the poll below reports the outcome.
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

/** Ownership marker: which machine last warped this transcript. */
export interface OwnerMarker {
	/** Name of the machine that owns the session (C-10). */
	owner: string;
	/** ISO timestamp of the write. */
	at: string;
}

/**
 * Path of the ownership marker for one transcript.
 *
 * CLAUDE-INTERNAL (verified 2.1.288): the marker lives next to the transcript
 * in the project folder so Mutagen config sync carries it between machines.
 */
export function ownerPath(cwd: string, id: string): string {
	return join(projectDir(cwd), `${id}.warp.json`);
}

/** Read the ownership marker of a session, or null when absent/unreadable. */
export function readOwner(cwd: string, id: string): OwnerMarker | null {
	const path = ownerPath(cwd, id);
	if (!existsSync(path)) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(path, "utf-8"));
	} catch {
		return null;
	}
	if (!parsed || typeof parsed !== "object") return null;
	const { owner, at } = parsed as Partial<OwnerMarker>;
	if (typeof owner !== "string" || typeof at !== "string") return null;
	return { owner, at };
}

/**
 * Write the ownership marker atomically (temp file + rename) so a crash never
 * leaves a half-written marker that config sync would copy.
 */
export function writeOwner(cwd: string, id: string, machine: string, at?: string): OwnerMarker {
	const marker: OwnerMarker = { owner: machine, at: at ?? new Date().toISOString() };
	const target = ownerPath(cwd, id);
	const temp = `${target}.${process.pid}.tmp`;
	writeFileSync(temp, `${JSON.stringify(marker, null, 2)}\n`, "utf-8");
	renameSync(temp, target);
	return marker;
}

/**
 * Number of non-empty lines in a transcript.
 *
 * Reads the file line by line; a transcript is still being appended to while
 * a session runs, so a partially written last line is counted, not rejected.
 */
export function transcriptLineCount(path: string): number {
	let count = 0;
	for (const line of readLines(path)) {
		if (line.trim() !== "") count++;
	}
	return count;
}

/**
 * Text of the last assistant message in a transcript, or null when there is
 * none (or the file is unreadable).
 *
 * CLAUDE-INTERNAL (verified 2.1.288): transcript lines are JSON objects with a
 * `type`; assistant turns have `type: "assistant"` and
 * `message.content`, an array of blocks whose `type` is `text`, `thinking` or
 * `tool_use` (only `text` is returned, in order). Lines with unknown shapes
 * are skipped, never thrown on: one transcript file holds 8 different line
 * types and that set grows between versions.
 */
export function lastAssistantText(path: string): string | null {
	let text: string | null = null;
	for (const line of readLines(path)) {
		const text0 = assistantText(line);
		if (text0 !== null) text = text0;
	}
	return text;
}

function assistantText(line: string): string | null {
	let entry: unknown;
	try {
		entry = JSON.parse(line);
	} catch {
		return null;
	}
	if (!entry || typeof entry !== "object") return null;
	const record = entry as { type?: unknown; message?: { content?: unknown } };
	if (record.type !== "assistant") return null;
	const content = record.message?.content;
	if (!Array.isArray(content)) return null;
	const parts = content
		.filter(
			(block): block is { type: string; text?: string } =>
				!!block && typeof block === "object" && (block as { type?: unknown }).type === "text",
		)
		.map((block) => (typeof block.text === "string" ? block.text : ""));
	return parts.join("");
}

/** Non-empty lines of a text file, tolerating a truncated last line. */
function readLines(path: string): string[] {
	let raw: string;
	try {
		raw = readFileSync(path, "utf-8");
	} catch {
		return [];
	}
	return raw.split("\n");
}

function parseSessionFile(
	path: string,
): { pid?: number; cwd?: string; sessionId?: string; startedAt?: number; name?: string } | null {
	try {
		const parsed = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
		if (!parsed || typeof parsed !== "object") return null;
		return {
			...(typeof parsed.pid === "number" ? { pid: parsed.pid } : {}),
			...(typeof parsed.cwd === "string" ? { cwd: parsed.cwd } : {}),
			...(typeof parsed.sessionId === "string" ? { sessionId: parsed.sessionId } : {}),
			...(typeof parsed.startedAt === "number" ? { startedAt: parsed.startedAt } : {}),
			...(typeof parsed.name === "string" ? { name: parsed.name } : {}),
		};
	} catch {
		return null;
	}
}

/** realpath that falls back to the input when the path does not exist yet. */
function safeRealpath(path: string): string {
	try {
		return realpathSync(path);
	} catch {
		return resolve(path);
	}
}
