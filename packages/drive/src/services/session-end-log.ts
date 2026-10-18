/**
 * The detached session-end worker cannot print to the Claude session it
 * outlives, so it records each result as one line in the space git dir.
 * `hyper space status` reads the last line back and shows it when it was a
 * failure.
 *
 * Format, one record per line, tab-separated:
 *   <ISO time> <session id or -> <outcome> <detail>
 * The detail is folded to one line, stripped of control characters and capped.
 * The log is rotated at `SESSION_END_LOG_LIMIT` bytes into `<log>.1` (one
 * previous generation is kept), so it never grows past twice that size.
 */
import {
	closeSync,
	constants,
	fstatSync,
	lstatSync,
	openSync,
	readSync,
	renameSync,
	type Stats,
	writeSync,
} from "node:fs";
import { join } from "node:path";
import { escapeControlCharacters, quoteForTerminal } from "#lib/terminal-text";
import { sessionEndLine } from "#services/session-end";
import { SpaceGitError } from "#services/space-git";
import { spaceGitDirWriteError } from "#services/space-lock";

export const SESSION_END_LOG = "session-end.log";
export const SESSION_END_LOG_LIMIT = 64 * 1024;
const DETAIL_LIMIT = 600;

export type SessionEndOutcome =
	| "committed"
	| "nothing"
	| "ignored"
	| "refused"
	| "push-failed"
	| "failed";

/** Outcomes that `hyper space status` reports. */
export const SESSION_END_FAILURES: readonly SessionEndOutcome[] = [
	"refused",
	"push-failed",
	"failed",
];

export interface SessionEndLogEntry {
	at: string;
	session: string;
	outcome: SessionEndOutcome;
	detail: string;
}

export function sessionEndLogPath(gitDir: string): string {
	return join(gitDir, SESSION_END_LOG);
}

/**
 * Whether a `session-end.log` that exists may be appended to: a regular file
 * with exactly one link. A symlink would steer the write elsewhere and a hard
 * link would append to a file that lives outside the git dir too. The pi
 * extension (`pi/session-end.ts`) applies the same rule; it imports nothing
 * from the CLI, so keep the two in step.
 */
export function isAppendableLog(stat: { isFile(): boolean; nlink: number }): boolean {
	return stat.isFile() && stat.nlink === 1;
}

/** The two filesystem calls whose answers the guard compares; tests stub them to stage a swap. */
export interface SessionEndLogIo {
	lstat: typeof lstatSync;
	open: typeof openSync;
}

const realIo: SessionEndLogIo = { lstat: lstatSync, open: openSync };

/** Append one record, rotating first when the log has reached its limit. */
export function appendSessionEndLog(
	gitDir: string,
	entry: Omit<SessionEndLogEntry, "at"> & { at?: string },
	io: SessionEndLogIo = realIo,
): SessionEndLogEntry {
	const record: SessionEndLogEntry = {
		at: entry.at ?? new Date().toISOString(),
		session: sessionEndLine(entry.session, 64) || "-",
		outcome: entry.outcome,
		detail: sessionEndLine(entry.detail, DETAIL_LIMIT),
	};
	const path = sessionEndLogPath(gitDir);
	// Something that is not a plain file sits where the log goes. hyper never
	// creates one, so the next step is the user's: move it aside.
	const refused = () =>
		new SpaceGitError(
			`I did not record this session end (${escapeControlCharacters(record.outcome)}): ${quoteForTerminal(path)} is not a plain file (a link, a directory or a pipe is in its place), and I never write through one; nothing was changed. Move it aside and the next session end creates the log again.`,
		);
	let existing: Stats | undefined;
	try {
		existing = io.lstat(path) as Stats;
	} catch {
		/* No log yet. */
	}
	if (existing !== undefined) {
		if (!isAppendableLog(existing)) throw refused();
		if (existing.size >= SESSION_END_LOG_LIMIT) {
			try {
				renameSync(path, `${path}.1`);
			} catch {
				/* Rotation is best effort; the append below decides. */
			}
		}
	}
	try {
		const fd = io.open(
			path,
			// O_NONBLOCK: a FIFO swapped in for the log fails with ENXIO instead of
			// holding the worker forever.
			constants.O_WRONLY |
				constants.O_APPEND |
				constants.O_CREAT |
				constants.O_NOFOLLOW |
				constants.O_NONBLOCK,
			0o600,
		);
		try {
			// Swapped for something else between the lstat and the open.
			if (!isAppendableLog(fstatSync(fd))) throw refused();
			writeSync(fd, `${record.at}\t${record.session}\t${record.outcome}\t${record.detail}\n`);
		} finally {
			closeSync(fd);
		}
	} catch (error) {
		// ELOOP: O_NOFOLLOW met a symlink. ENXIO: O_NONBLOCK met a FIFO.
		// EISDIR: a directory was swapped in between the lstat and the open.
		const code = (error as NodeJS.ErrnoException | undefined)?.code;
		if (
			error instanceof SpaceGitError ||
			code === "ELOOP" ||
			code === "ENXIO" ||
			code === "EISDIR"
		) {
			throw error instanceof SpaceGitError ? error : refused();
		}
		throw spaceGitDirWriteError(gitDir, `record this session end (${record.outcome})`, error);
	}
	return record;
}

/** The newest record, or null when there is none (or it cannot be read). */
export function lastSessionEndEntry(gitDir: string): SessionEndLogEntry | null {
	const path = sessionEndLogPath(gitDir);
	let text: string;
	try {
		// O_NONBLOCK: a FIFO planted in the log's place must not hang `space status`.
		const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
		let buffer: Buffer;
		try {
			const stat = fstatSync(fd);
			if (!stat.isFile()) return null;
			const length = Math.min(stat.size, 16 * 1024);
			buffer = Buffer.alloc(length);
			readSync(fd, buffer, 0, length, stat.size - length);
		} finally {
			closeSync(fd);
		}
		text = buffer.toString("utf8");
	} catch {
		return null;
	}
	const line = text
		.split("\n")
		.filter((value) => value !== "")
		.pop();
	if (line === undefined) return null;
	const [at, session, outcome, ...detail] = line.split("\t");
	if (
		at === undefined ||
		session === undefined ||
		!["committed", "nothing", "ignored", "refused", "push-failed", "failed"].includes(outcome ?? "")
	)
		return null;
	return {
		at,
		session,
		outcome: outcome as SessionEndOutcome,
		detail: sessionEndLine(detail.join(" "), DETAIL_LIMIT),
	};
}

/**
 * A synthetic failure when something that is not a plain file (a link, a
 * directory, a pipe, a hard-linked file) sits where the log goes. Every writer
 * refuses it, so the log's own last line can no longer report anything and
 * session ends are silently lost; this is how that becomes visible.
 */
export function sessionEndLogObstruction(gitDir: string): SessionEndLogEntry | null {
	const path = sessionEndLogPath(gitDir);
	let stat: Stats;
	try {
		stat = lstatSync(path);
	} catch {
		return null;
	}
	if (isAppendableLog(stat)) return null;
	return {
		at: new Date().toISOString(),
		session: "-",
		outcome: "failed",
		detail: sessionEndLine(
			`${path} is not a plain file, so session ends are not being recorded. Move it aside and the next session end creates the log again.`,
			DETAIL_LIMIT,
		),
	};
}

/** The newest record when it was a failure; what `hyper space status` shows. */
export function lastSessionEndFailure(gitDir: string): SessionEndLogEntry | null {
	const obstruction = sessionEndLogObstruction(gitDir);
	if (obstruction !== null) return obstruction;
	const entry = lastSessionEndEntry(gitDir);
	return entry !== null && SESSION_END_FAILURES.includes(entry.outcome) ? entry : null;
}
