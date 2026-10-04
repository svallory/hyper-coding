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
import { appendFileSync, closeSync, openSync, readSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import { sessionEndLine } from "#services/session-end";
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

/** Append one record, rotating first when the log has reached its limit. */
export function appendSessionEndLog(
	gitDir: string,
	entry: Omit<SessionEndLogEntry, "at"> & { at?: string },
): SessionEndLogEntry {
	const record: SessionEndLogEntry = {
		at: entry.at ?? new Date().toISOString(),
		session: sessionEndLine(entry.session, 64) || "-",
		outcome: entry.outcome,
		detail: sessionEndLine(entry.detail, DETAIL_LIMIT),
	};
	const path = sessionEndLogPath(gitDir);
	try {
		if (statSync(path).size >= SESSION_END_LOG_LIMIT) renameSync(path, `${path}.1`);
	} catch {
		/* No log yet. */
	}
	try {
		appendFileSync(path, `${record.at}\t${record.session}\t${record.outcome}\t${record.detail}\n`, {
			mode: 0o600,
		});
	} catch (error) {
		throw spaceGitDirWriteError(gitDir, `record this session end (${record.outcome})`, error);
	}
	return record;
}

/** The newest record, or null when there is none (or it cannot be read). */
export function lastSessionEndEntry(gitDir: string): SessionEndLogEntry | null {
	const path = sessionEndLogPath(gitDir);
	let text: string;
	try {
		const size = statSync(path).size;
		const length = Math.min(size, 16 * 1024);
		const buffer = Buffer.alloc(length);
		const fd = openSync(path, "r");
		try {
			readSync(fd, buffer, 0, length, size - length);
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

/** The newest record when it was a failure; what `hyper space status` shows. */
export function lastSessionEndFailure(gitDir: string): SessionEndLogEntry | null {
	const entry = lastSessionEndEntry(gitDir);
	return entry !== null && SESSION_END_FAILURES.includes(entry.outcome) ? entry : null;
}
