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

import { spawnSync } from "node:child_process";
import {
	closeSync,
	existsSync,
	mkdirSync,
	openSync,
	readdirSync,
	readFileSync,
	readSync,
	realpathSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";

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
 * Two steps, both confirmed by running `claude -p` in throwaway directories and
 * reading the folder that appeared:
 *
 * 1. The path is resolved through `realpath` first (a session run in
 *    `/tmp/enc-probe.XXXX/plain` created `-private-tmp-enc-probe-XXXX-plain`),
 *    then every character outside `[A-Za-z0-9]` becomes a single `-`. Verified
 *    with directories named `plain`, `dot.name`, `under_score`, `with space`,
 *    `ünïcodé` and `dash-and.ü_ x`, which produced `plain`, `dot-name`,
 *    `under-score`, `with-space`, `-n-cod-` and `dash-and----x`: non-ASCII
 *    letters are replaced, not kept and not transliterated.
 * 2. When the result is longer than 200 characters it becomes
 *    `` `${first200}-${hash}` `` where `hash` is `Math.abs(javaStyleHash(realpath)).toString(36)`.
 *    Verified with a 278-character path: the folder created was the first 200
 *    characters of the encoding followed by `-zh355g`, and
 *    `Math.abs(hash("/private/tmp/encdeep.gJVC5k/.../leaf")).toString(36) === "zh355g"`.
 *
 * The mapping is not reversible and two different cwds can collide, so callers
 * match on the realpath of a cwd, not on this name.
 */
export function encodeProjectDir(cwd: string): string {
	// CLAUDE-INTERNAL (verified 2.1.288): see the doc comment above.
	const path = safeRealpath(cwd);
	const encoded = path.replace(/[^a-zA-Z0-9]/g, "-");
	if (encoded.length <= 200) return encoded;
	return `${encoded.slice(0, 200)}-${Math.abs(javaStyleHash(path)).toString(36)}`;
}

/**
 * `h = (h << 5) - h + charCodeAt(i) | 0`, the 32-bit string hash Claude Code
 * uses for its over-long project folder names.
 *
 * CLAUDE-INTERNAL (verified 2.1.288): reproduced exactly for a 278-character
 * path (see {@link encodeProjectDir}).
 */
function javaStyleHash(value: string): number {
	let hash = 0;
	for (let index = 0; index < value.length; index++) {
		hash = (hash << 5) - hash + value.charCodeAt(index);
		hash |= 0;
	}
	return hash;
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
 *
 * Known gap for T-12: the folder name is not reversible, so two directories
 * whose encodings collide share one folder (`foo_bar` and `foo-bar` both encode
 * to `foo-bar`) and their transcripts land side by side. Nothing here tells them
 * apart; a caller that needs to cannot rely on the folder name alone.
 */
export function listTranscripts(cwd: string): TranscriptRef[] {
	const dir = projectDir(cwd);
	if (!existsSync(dir)) return [];

	const out: TranscriptRef[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (!entry.isFile() || extname(entry.name) !== ".jsonl") continue;
		const path = join(dir, entry.name);
		const stats = tryStat(path);
		if (!stats) continue; // vanished between listing and stat
		out.push({ id: basename(entry.name, ".jsonl"), path, mtime: stats.mtime });
	}
	return out.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
}

/** Newest transcript of `cwd`, or null when the project has none. */
export function latestTranscript(cwd: string): TranscriptRef | null {
	return listTranscripts(cwd)[0] ?? null;
}

/** A running process that registered itself in `~/.claude/sessions/`. */
export interface LiveSession {
	pid: number;
	/** Claude Code's session id, when the sessions file carries one. */
	sessionId?: string;
	/** Process start time in epoch milliseconds, when present. */
	startedAt?: number;
	/**
	 * Working directory as the writer recorded it. This is the process cwd, not
	 * necessarily the folder the transcript lives in: a session started in the
	 * repo root writes its transcript under the root's own project folder while
	 * the process itself is in a worktree, so the two can differ.
	 */
	cwd: string;
	/** Who registered the session (`cli` for Claude Code, `pi` for pi-launched). */
	entrypoint?: string;
	/** Writer version (`2.1.288`, or `pi-claude-link` for the pi bridge). */
	version?: string;
	/** `ps -o lstart=` style start time, used to spot a reused pid. */
	procStart?: string;
	/** Human-readable session name, when present. */
	name?: string;
}

/** CLAUDE-INTERNAL (verified 2.1.288): `~/.claude/sessions/<pid>.json`. */
const SESSIONS_FILE = /^(\d+)\.json$/;

/** Options shared by the live-session lookups. */
export interface LiveOptions {
	/**
	 * Keep only sessions written by Claude Code. pi's `pi-claude-link` bridge
	 * registers itself in the same directory (`entrypoint: "pi"`,
	 * `version: "pi-claude-link"`) without ever writing a transcript, so those
	 * entries must not be mistaken for warpable sessions. Default true.
	 */
	claudeOnly?: boolean;
}

/**
 * Every live Claude Code session whose registered cwd is `cwd`, oldest first.
 *
 * CLAUDE-INTERNAL (verified 2.1.288): `~/.claude/sessions/` holds one
 * `<pid>.json` per running session (several per cwd are normal — five shared
 * one cwd while writing this) plus `<pid>.<sha256>.key` files, which are not
 * sessions. The JSON carries `pid`, `cwd`, `sessionId`, `startedAt` (epoch ms),
 * `procStart`, `version`, `entrypoint`, `kind`, `status`, `name`,
 * `messagingSocketPath`.
 *
 * Entries are kept only when the realpath of their cwd matches and their pid is
 * alive (`process.kill(pid, 0)`); stale files from dead processes are ignored,
 * never deleted.
 */
export function liveSessions(cwd: string, options: LiveOptions = {}): LiveSession[] {
	const wanted = safeRealpath(cwd);
	return readSessionFiles()
		.filter((entry) => safeRealpath(entry.cwd) === wanted)
		.filter((entry) => matchesClaudeOnly(entry, options))
		.sort(byStartedAt);
}

/**
 * The newest live Claude Code session of `cwd`, or null. Prefer
 * {@link liveSessions} when several sessions can share one cwd.
 */
export function liveSession(cwd: string, options: LiveOptions = {}): LiveSession | null {
	return liveSessions(cwd, options).at(-1) ?? null;
}

/**
 * Every live session registered under `sessionId`, in any cwd.
 *
 * This is how warp pairs a chosen transcript with the process that is writing
 * it: the transcript id is the session id, and the process may be running in a
 * different directory than the transcript's project folder.
 */
export function liveSessionsFor(sessionId: string, options: LiveOptions = {}): LiveSession[] {
	return readSessionFiles()
		.filter((entry) => entry.sessionId === sessionId)
		.filter((entry) => matchesClaudeOnly(entry, options))
		.sort(byStartedAt);
}

/** Ownership marker: which machine last warped this transcript. */
export interface OwnerMarker {
	/** Name of the machine that owns the session (C-10). */
	owner: string;
	/** ISO timestamp of the write. */
	at: string;
}

/**
 * What {@link readOwner} found.
 *
 * `malformed` is deliberately not the same as `unowned`: a marker that exists
 * but cannot be parsed is an ownership question warp must refuse on (C-10),
 * while a missing marker means nobody has claimed the session.
 */
export type OwnerState =
	| { state: "unowned"; path: string }
	| { state: "owned"; path: string; marker: OwnerMarker }
	| { state: "malformed"; path: string; reason: string };

/**
 * Path of the ownership marker for one transcript.
 *
 * CLAUDE-INTERNAL (verified 2.1.288): the marker lives next to the transcript
 * in the project folder so Mutagen config sync carries it between machines.
 */
export function ownerPath(cwd: string, id: string): string {
	return join(projectDir(cwd), `${id}.warp.json`);
}

/** Read the ownership marker of a session. */
export function readOwner(cwd: string, id: string): OwnerState {
	const path = ownerPath(cwd, id);
	if (!existsSync(path)) return { state: "unowned", path };
	let raw: string;
	try {
		raw = readFileSync(path, "utf-8");
	} catch (error) {
		// A marker that vanished between the check and the read is gone, not
		// corrupt: Mutagen moving a file mid-sync is normal, and the session is
		// unowned rather than unclaimable.
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return { state: "unowned", path };
		}
		return { state: "malformed", path, reason: describeError(error, path) };
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		return { state: "malformed", path, reason: `${path} is not valid JSON: ${detail}` };
	}
	if (!parsed || typeof parsed !== "object") {
		return { state: "malformed", path, reason: "marker is not a JSON object" };
	}
	const { owner, at } = parsed as Partial<OwnerMarker>;
	if (typeof owner !== "string" || typeof at !== "string") {
		return {
			state: "malformed",
			path,
			reason: `marker needs string fields "owner" and "at" (found ${JSON.stringify(parsed)})`,
		};
	}
	return { state: "owned", path, marker: { owner, at } };
}

/**
 * Write the ownership marker atomically (temp file + rename) so a crash never
 * leaves a half-written marker that config sync would copy.
 *
 * The transcript has to exist: a marker is a claim about a session, and the
 * session's transcript is what config sync carries. Marking an id with no
 * transcript would put a file in a project folder that says nothing about any
 * session, so it is refused with a message naming the path.
 */
export function writeOwner(cwd: string, id: string, machine: string, at?: string): OwnerMarker {
	const transcriptPath = join(projectDir(cwd), `${id}.jsonl`);
	if (!existsSync(transcriptPath)) {
		throw new Error(
			`no transcript at ${transcriptPath}, so there is no session to mark as owned by ${machine}`,
		);
	}
	const marker: OwnerMarker = { owner: machine, at: at ?? new Date().toISOString() };
	const target = ownerPath(cwd, id);
	const dir = dirname(target);
	const temp = join(dir, `.${id}.warp.json.${process.pid}.tmp`);
	try {
		mkdirSync(dir, { recursive: true });
		writeFileSync(temp, `${JSON.stringify(marker, null, 2)}\n`, "utf-8");
		renameSync(temp, target);
	} catch (error) {
		throw new Error(describeError(error, target));
	} finally {
		// Never leave a `.tmp` behind, whether the rename worked or not.
		rmSync(temp, { force: true });
	}
	return marker;
}

/** How {@link stopSession} ended. */
export type StopOutcome =
	/** The process was already gone. */
	| "gone"
	/** The process exited during the grace period (SIGTERM worked). */
	| "terminated"
	/** The process is confirmed dead after SIGKILL. */
	| "killed"
	/** The sessions file describes a different process (stale file, reused pid). */
	| "mismatch"
	/** The pid belongs to another user; nothing was signalled. */
	| "unauthorized"
	/** SIGKILL was sent but the process is still alive. */
	| "survived";

/**
 * Stop the Claude Code process running session `sessionId` in `cwd`: SIGTERM,
 * poll until it is gone or `graceMs` elapses, then SIGKILL and poll again.
 *
 * Returns null when no sessions file claims that pid in that cwd. Before
 * signalling, the file is checked against reality (C-18, this is what keeps
 * `hyper warp --stop` from killing an unrelated process):
 *
 * - a dead pid is reported `"gone"` without being signalled;
 * - the file must carry a `sessionId`, and it must equal the requested one — a
 *   file without one is refused as `"mismatch"`;
 * - the file must carry a `procStart`, and it must equal what `ps` reports for
 *   that pid, so a stale file whose pid has been recycled is refused
 *   (`"mismatch"`). Both identity fields are required: a file that carries
 *   neither cannot be proven to be the process that was asked for, and failing
 *   closed is the safe answer.
 *
 * `cwd` here is the **process** working directory recorded in the sessions file
 * — take it from the {@link LiveSession} that {@link liveSessionsFor} returned,
 * not from warp's own cwd. The two differ in practice: on this machine session
 * `3d9c77a6-6975-4381-b884-214b3ca452d8` (pid 27145) registers cwd
 * `/Users/svallory/work` while its transcript sits in
 * `~/.claude/projects/-Users-svallory-work-saulo-tech/`.
 *
 * `procStart` is not `ps -o lstart=` in the ambient locale: Claude Code runs
 * `LC_ALL=C TZ=UTC ps -o lstart= -p <pid>` and stores that, i.e. the start time
 * in **UTC** (`Fri Oct  2 22:38:35 2026` for a pid whose local `ps` says
 * `19:38:35` on this machine). The same comparison is therefore done with
 * `LC_ALL=C TZ=UTC`. Linux procps is expected to print the same UTC form under
 * `LC_ALL=C` — inferred, not verified here; T-19 verifies it on Linux.
 *
 * Async on purpose: a blocking poll would freeze the event loop, and a process
 * that is a child of this one only stops answering `kill(pid, 0)` once the OS
 * reaps it, which needs the event loop to run.
 */
export async function stopSession(
	pid: number,
	options: { cwd: string; sessionId: string; graceMs?: number },
): Promise<StopOutcome | null> {
	const { cwd, sessionId, graceMs = 10_000 } = options;
	const claimed = claimForPid(pid, cwd);
	if (!claimed) return null;
	if (!isAlive(pid)) return "gone";
	// A file with no sessionId cannot be proven to be the process we were asked
	// to stop, so it is a mismatch, not a licence to signal.
	if (claimed.sessionId === undefined || claimed.sessionId !== sessionId) return "mismatch";
	// Fail closed: without a procStart there is nothing to compare the pid
	// against, so the file cannot prove it still describes this process.
	if (claimed.procStart === undefined) return "mismatch";
	{
		const actual = currentProcStart(pid);
		// An empty answer means the pid vanished between the check above and
		// now; there is nothing left to signal.
		if (actual === undefined) return "gone";
		if (actual !== claimed.procStart) return "mismatch";
	}

	const first = signal(pid, "SIGTERM");
	if (first === "unauthorized") return "unauthorized";
	if (await waitForExit(pid, graceMs)) return "terminated";

	const second = signal(pid, "SIGKILL");
	if (second === "unauthorized") return "unauthorized";
	// SIGKILL is not a promise: confirm the process is really gone before
	// reporting success, and say so plainly when it is not.
	return (await waitForExit(pid, 2_000)) ? "killed" : "survived";
}

/** Wait up to `ms` for the pid to disappear. */
async function waitForExit(pid: number, ms: number): Promise<boolean> {
	const deadline = Date.now() + ms;
	for (;;) {
		if (!isAlive(pid)) return true;
		if (Date.now() >= deadline) return false;
		await sleep(100);
	}
}

/**
 * Number of non-empty lines in a transcript.
 *
 * Streamed in 256 KB chunks: transcripts here reach 66 MB, so the file is never
 * held in memory. A transcript is still being appended to while a session runs,
 * so a partially written last line is counted, not rejected. Returns 0 when the
 * file cannot be read.
 */
export function transcriptLineCount(path: string): number {
	let count = 0;
	let partial = "";
	let sawAny = false;
	forEachChunk(path, (chunk) => {
		sawAny = true;
		const parts = (partial + chunk).split("\n");
		partial = parts.pop() ?? "";
		for (const line of parts) {
			if (line.trim() !== "") count++;
		}
	});
	if (sawAny && partial.trim() !== "") count++;
	return count;
}

/**
 * Text of the last assistant message in a transcript, or null when there is
 * none (no assistant turn at all, or the last assistant turn carried no text
 * block).
 *
 * CLAUDE-INTERNAL (verified 2.1.288): transcript lines are JSON objects with a
 * `type`, and each assistant line holds the content blocks of one reply — in
 * practice one block, the blocks of a reply being separate lines that share
 * `message.id` (in an 8389-line session: 1442 assistant lines, 726 distinct
 * message ids, blocks seen were `text`, `thinking`, `tool_use`, 1442 lines with
 * one block each and 477 message ids spread over more than one line). So the
 * last reply is the last `message.id` seen, its text is the `text` blocks of the
 * lines carrying that id joined, and null when it had none (a reply that ends
 * on a `tool_use` line has no text yet).
 *
 * A line without `message.id` is treated as a reply of its own, so an unusual
 * line never merges with the reply before it and never hides one.
 *
 * Only the tail of the file is read (512 KB, widening to 8 MB and then the whole
 * file when the window cannot hold the last reply in full), because transcripts
 * here reach 66 MB. Lines with unknown shapes are skipped, never thrown on: one
 * transcript file holds 8 different line types and that set grows between
 * versions.
 */
export function lastAssistantText(path: string): string | null {
	for (const size of [512 * 1024, 8 * 1024 * 1024, Number.POSITIVE_INFINITY]) {
		const window = tailLines(path, size);
		const found = lastReplyText(window.lines, window.truncatedStart);
		if (found !== undefined) return found;
	}
	return null;
}

/**
 * The text of the last reply in `lines` (oldest first), or undefined when these
 * lines cannot answer the question: no assistant line at all, or a reply whose
 * earlier lines may be in the unread part of the file.
 *
 * `truncatedStart` says the window begins mid-file. When the walk back over a
 * reply's lines runs out of window without meeting a different reply, the answer
 * may be cut short, so the caller reads a bigger window rather than return half
 * a reply.
 */
function lastReplyText(lines: string[], truncatedStart: boolean): string | null | undefined {
	for (let index = lines.length - 1; index >= 0; index--) {
		const blocks = assistantBlocks(lines[index] ?? "");
		if (!blocks) continue;

		const id = blocks.id;
		if (id === undefined) {
			// No message id: this line is a reply on its own.
			return joinTexts(blocks.texts);
		}
		// Walk back over the other lines of the same reply. Non-assistant lines
		// are stepped over, not treated as the end: a reply interleaves
		// `attachment`, `user` and `system` lines while its tools run, and that
		// is exactly the state warp stops a session in.
		const texts = [...blocks.texts];
		let reachedStart = true;
		for (let back = index - 1; back >= 0; back--) {
			const earlier = assistantBlocks(lines[back] ?? "");
			if (!earlier) continue;
			if (earlier.id !== id) {
				reachedStart = false;
				break;
			}
			texts.unshift(...earlier.texts);
		}
		// The reply may continue before the window: read more rather than answer
		// with a fragment.
		if (truncatedStart && reachedStart) return undefined;
		return joinTexts(texts);
	}
	return undefined;
}

function joinTexts(texts: string[]): string | null {
	return texts.length === 0 ? null : texts.join("");
}

/** Every content block of an assistant line, with its reply id when it has one. */
function assistantBlocks(line: string): { id: string | undefined; texts: string[] } | null {
	let entry: unknown;
	try {
		entry = JSON.parse(line);
	} catch {
		return null;
	}
	if (!entry || typeof entry !== "object") return null;
	const record = entry as { type?: unknown; message?: { id?: unknown; content?: unknown } };
	if (record.type !== "assistant") return null;
	const content = record.message?.content;
	if (!Array.isArray(content)) return null;
	const id = typeof record.message?.id === "string" ? record.message.id : undefined;

	const texts: string[] = [];
	for (const block of content) {
		if (!block || typeof block !== "object") continue;
		const { type, text } = block as { type?: unknown; text?: unknown };
		if (type === "text" && typeof text === "string") texts.push(text);
	}
	return { id, texts };
}

/** A window of the end of a transcript, ready to be walked backwards. */
interface TailWindow {
	/** Complete, non-empty lines, oldest first. */
	lines: string[];
	/** True when the window starts mid-line, so a reply may continue before it. */
	truncatedStart: boolean;
}

/**
 * The last `size` bytes of a file as complete lines.
 *
 * One byte before the window is read to see whether it begins on a line
 * boundary: a window that holds the whole file (or lands exactly after a
 * newline) keeps its first line, and only a window that truly starts mid-line
 * drops the fragment — which also means the answer there may be incomplete.
 */
function tailLines(path: string, size: number): TailWindow {
	let stats: ReturnType<typeof statSync>;
	try {
		stats = statSync(path);
	} catch {
		return { lines: [], truncatedStart: false };
	}
	const length = Math.min(stats.size, size);
	if (length <= 0) return { lines: [], truncatedStart: false };
	const offset = stats.size - length;

	let text: string;
	try {
		const buffer = Buffer.allocUnsafe(length + (offset > 0 ? 1 : 0));
		const fd = openSync(path, "r");
		let read = 0;
		try {
			read = readSync(fd, buffer, 0, buffer.length, offset > 0 ? offset - 1 : 0);
		} finally {
			closeSync(fd);
		}
		// Decode only what was read: a file truncated mid-read (a transcript
		// being written, or a Mutagen sync landing) leaves the rest of the
		// buffer uninitialised, and allocUnsafe does not clear it.
		text = buffer.toString("utf-8", 0, Math.max(read, 0));
	} catch {
		return { lines: [], truncatedStart: false };
	}

	let truncatedStart = false;
	if (offset > 0) {
		truncatedStart = text[0] !== "\n";
		text = text.slice(1);
	}
	return {
		lines: text.split("\n").filter((line) => line.trim() !== ""),
		truncatedStart,
	};
}

/** Feed a file to `visit` in 256 KB chunks, never holding it all in memory. */
function forEachChunk(path: string, visit: (chunk: string) => void): void {
	const CHUNK = 256 * 1024;
	const buffer = Buffer.allocUnsafe(CHUNK);
	let fd: number;
	try {
		fd = openSync(path, "r");
	} catch {
		return;
	}
	try {
		for (;;) {
			const read = readSync(fd, buffer, 0, CHUNK, null);
			if (read <= 0) break;
			visit(buffer.toString("utf-8", 0, read));
		}
	} catch {
		// A transcript being written can disappear under us; count what we read.
	} finally {
		closeSync(fd);
	}
}

/** One parsed `<pid>.json` sessions file. */
function readSessionFiles(): LiveSession[] {
	const dir = join(claudeHome(), "sessions");
	if (!existsSync(dir)) return [];

	const out: LiveSession[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (!entry.isFile()) continue;
		const match = SESSIONS_FILE.exec(entry.name);
		if (!match) continue;
		const parsed = parseSessionFile(join(dir, entry.name));
		if (!parsed || parsed.cwd === undefined) continue;
		const pid = parsed.pid ?? Number(match[1]);
		if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0 || !isAlive(pid)) continue;
		out.push({
			pid,
			...(parsed.sessionId !== undefined ? { sessionId: parsed.sessionId } : {}),
			...(typeof parsed.startedAt === "number" ? { startedAt: parsed.startedAt } : {}),
			cwd: parsed.cwd,
			...(parsed.entrypoint !== undefined ? { entrypoint: parsed.entrypoint } : {}),
			...(parsed.version !== undefined ? { version: parsed.version } : {}),
			...(parsed.procStart !== undefined ? { procStart: parsed.procStart } : {}),
			...(parsed.name !== undefined ? { name: parsed.name } : {}),
		});
	}
	return out;
}

/** One parsed `<pid>.json` sessions file, with only the fields we rely on. */
function parseSessionFile(path: string): Partial<LiveSession> | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(path, "utf-8"));
	} catch {
		return null;
	}
	if (!parsed || typeof parsed !== "object") return null;
	const record = parsed as Record<string, unknown>;
	const pid = record.pid;
	const str = (value: unknown): string | undefined =>
		typeof value === "string" ? value : undefined;
	return {
		...(typeof pid === "number" ? { pid } : {}),
		...(str(record.cwd) !== undefined ? { cwd: str(record.cwd) } : {}),
		...(str(record.sessionId) !== undefined ? { sessionId: str(record.sessionId) } : {}),
		...(typeof record.startedAt === "number" ? { startedAt: record.startedAt } : {}),
		...(str(record.entrypoint) !== undefined ? { entrypoint: str(record.entrypoint) } : {}),
		...(str(record.version) !== undefined ? { version: str(record.version) } : {}),
		...(str(record.procStart) !== undefined ? { procStart: str(record.procStart) } : {}),
		...(str(record.name) !== undefined ? { name: str(record.name) } : {}),
	};
}

/**
 * Keep Claude Code's own sessions. pi's `pi-claude-link` bridge writes into the
 * same directory (`entrypoint: "pi"`, `version: "pi-claude-link"`) for sessions
 * that never produce a transcript.
 *
 * CLAUDE-INTERNAL (verified 2.1.288): both shapes observed in live files.
 */
function matchesClaudeOnly(entry: LiveSession, options: LiveOptions): boolean {
	if (options.claudeOnly === false) return true;
	if (entry.entrypoint === "pi") return false;
	if (typeof entry.version === "string" && entry.version.startsWith("pi-")) return false;
	return true;
}

function byStartedAt(a: LiveSession, b: LiveSession): number {
	return (a.startedAt ?? 0) - (b.startedAt ?? 0);
}

/** The sessions file for `pid` in `cwd`, when it claims that cwd. */
function claimForPid(pid: number, cwd: string): LiveSession | null {
	const path = join(claudeHome(), "sessions", `${pid}.json`);
	if (!existsSync(path)) return null;
	const parsed = parseSessionFile(path);
	if (!parsed || typeof parsed.cwd !== "string") return null;
	if (safeRealpath(parsed.cwd) !== safeRealpath(cwd)) return null;
	return { ...parsed, pid, cwd: parsed.cwd };
}

/** True when the process exists (signal 0 delivers nothing). */
function isAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		// EPERM means it exists but belongs to someone else; treat as alive.
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

/**
 * CLAUDE-INTERNAL (verified 2.1.288): `LC_ALL=C TZ=UTC ps -o lstart= -p <pid>`,
 * e.g. `Fri Oct  2 22:38:35 2026`. Claude Code reads the start time in UTC and
 * stores that string; the same invocation is used here, because a plain
 * `ps -o lstart=` in this machine's local zone prints `19:38:35` for the very
 * same pid and would never match. Linux procps is expected to print the same
 * UTC form under `LC_ALL=C` — inferred from the format, not verified here;
 * T-19 verifies it on Linux.
 */
function currentProcStart(pid: number): string | undefined {
	const result = spawnSync("ps", ["-o", "lstart=", "-p", String(pid)], {
		encoding: "utf-8",
		env: { ...process.env, LC_ALL: "C", TZ: "UTC" },
	});
	if (result.status !== 0 || !result.stdout) return undefined;
	return result.stdout.trim();
}

function signal(pid: number, name: NodeJS.Signals): "sent" | "unauthorized" | "gone" {
	try {
		process.kill(pid, name);
		return "sent";
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "EPERM") return "unauthorized";
		return "gone";
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((done) => {
		setTimeout(done, ms);
	});
}

/** realpath that falls back to the input when the path does not exist yet. */
function safeRealpath(path: string): string {
	try {
		return realpathSync(path);
	} catch {
		return resolve(path);
	}
}

function tryStat(path: string): ReturnType<typeof statSync> | null {
	try {
		return statSync(path);
	} catch {
		return null;
	}
}

/** A message a user can act on, instead of a bare ENOENT. */
function describeError(error: unknown, path: string): string {
	const code = (error as NodeJS.ErrnoException).code;
	if (code === "ENOENT") return `${path} does not exist`;
	if (code === "EACCES" || code === "EPERM") return `not allowed to write ${path}`;
	if (code === "EISDIR") return `${path} is a directory`;
	return error instanceof Error ? error.message : String(error);
}
