/**
 * One writer at a time in a space's git dir.
 *
 * Several agent sessions in one space can end together, and each SessionEnd
 * hook commits. `git add -A`, the secret guard and `git commit` all work on
 * the ONE shared index, so without this lock one process could commit what
 * another staged after the guard had looked (an unchecked `.env`), or clear
 * the index another was about to commit (PR #45 review, B1).
 *
 * The lock is a file created with O_EXCL in `.hyper/space.git`, holding the
 * owner's pid, host and start time. Every writer of the space index (commit,
 * pull's fast-forward, init's rollback) and every update of the tracking ref
 * (push) holds it for its whole critical section; a process that has not got
 * it never touches the index. Waiters retry until a bound and then give up
 * with one line, having changed nothing.
 *
 * A lock is stale, and taken over with a one-line note, when its owner is a
 * dead process on this host, or when it is older than `STALE_AFTER_MS` (a
 * guard against pid reuse; nothing hyper does holds it that long). A takeover
 * also removes an `index.lock` the dead owner's git left behind. Takeovers are
 * serialised by a second, short-lived guard file, so two waiters that both
 * judged the same lock stale cannot delete each other's fresh lock.
 */
import {
	closeSync,
	openSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeSync,
} from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { escapeControlCharacters, quoteForTerminal } from "#lib/terminal-text";
import { SpaceGitError, spaceGitDir } from "#services/space-git";

export const SPACE_LOCK_FILE = "hyper.lock";
/** How long an interactive command waits for another writer. */
export const SPACE_LOCK_WAIT_MS = 15_000;
/** A lock older than this is presumed abandoned, whatever its pid says. */
export const STALE_AFTER_MS = 30 * 60 * 1000;
const RETRY_MS = 50;
/** A guard or lock file with no readable owner yet is given this long to be written. */
const UNWRITTEN_GRACE_MS = 5_000;

export class SpaceLockTimeoutError extends SpaceGitError {
	constructor(detail: string) {
		super(detail);
		this.name = "SpaceLockTimeoutError";
	}
}

interface LockOwner {
	pid: number;
	host: string;
	started: number;
	token: string;
}

export interface SpaceLockOptions {
	/** Give up after this many milliseconds (default `SPACE_LOCK_WAIT_MS`). */
	waitMs?: number;
	/** Receives a one-line note when a stale lock is taken over. */
	note?: (message: string) => void;
}

function sleepSync(ms: number): void {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Is a pid still running? EPERM means it exists but belongs to someone else. */
function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

function readOwner(path: string): LockOwner | null {
	try {
		const value = JSON.parse(readFileSync(path, "utf8")) as Partial<LockOwner>;
		if (
			typeof value.pid === "number" &&
			typeof value.host === "string" &&
			typeof value.started === "number" &&
			typeof value.token === "string"
		)
			return value as LockOwner;
	} catch {
		/* Missing, or being written right now. */
	}
	return null;
}

function ageOf(path: string): number | null {
	try {
		return Date.now() - statSync(path).mtimeMs;
	} catch {
		return null;
	}
}

/** Why a lock may be taken over, or null while its owner may still be working. */
function staleReason(path: string, owner: LockOwner | null): string | null {
	if (owner === null) {
		const age = ageOf(path);
		return age !== null && age > UNWRITTEN_GRACE_MS ? "it records no owner" : null;
	}
	if (Date.now() - owner.started > STALE_AFTER_MS)
		return `it is older than ${STALE_AFTER_MS / 60_000} minutes`;
	if (owner.host === hostname() && !isProcessAlive(owner.pid))
		return `its owner (pid ${owner.pid}) is no longer running`;
	return null;
}

/** Create `path` exclusively with `content`; false when it already exists. */
function createExclusive(path: string, content: string): boolean {
	let fd: number;
	try {
		fd = openSync(path, "wx", 0o600);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
		throw error;
	}
	try {
		writeSync(fd, content);
	} finally {
		closeSync(fd);
	}
	return true;
}

/**
 * Remove a lock judged stale, but only if it is still the SAME lock: under a
 * takeover guard, re-read it and compare. Returns true when it was removed.
 */
function takeOver(gitDir: string, path: string, judged: LockOwner | null): boolean {
	const guard = `${path}.takeover`;
	if (!createExclusive(guard, `${process.pid}\n`)) {
		// A guard is held for microseconds; one this old belongs to a dead process.
		const age = ageOf(guard);
		if (age !== null && age > UNWRITTEN_GRACE_MS) rmSync(guard, { force: true });
		return false;
	}
	try {
		const current = readOwner(path);
		if ((current?.token ?? null) !== (judged?.token ?? null)) return false;
		if (staleReason(path, current) === null) return false;
		// Move it aside first: the rename is the atomic step, the rest is cleanup.
		const aside = `${path}.stale-${process.pid}`;
		try {
			renameSync(path, aside);
		} catch {
			return false;
		}
		rmSync(aside, { force: true });
		// Every writer holds this lock, so an index.lock written after the dead
		// owner took it is that owner's git, killed mid-write.
		const indexLock = join(gitDir, "index.lock");
		try {
			const since = judged?.started ?? 0;
			if (statSync(indexLock).mtimeMs >= since - 1000) rmSync(indexLock, { force: true });
		} catch {
			/* No index.lock left behind. */
		}
		return true;
	} finally {
		rmSync(guard, { force: true });
	}
}

/**
 * Run `action` holding the space lock. Works for synchronous and asynchronous
 * actions: the lock is released when the returned promise settles. Throws
 * `SpaceLockTimeoutError` (nothing touched) when the wait runs out.
 */
export function withSpaceLock<T>(
	root: string,
	what: string,
	action: () => T,
	options: SpaceLockOptions = {},
): T {
	const gitDir = spaceGitDir(root);
	const path = join(gitDir, SPACE_LOCK_FILE);
	const waitMs = options.waitMs ?? SPACE_LOCK_WAIT_MS;
	const note =
		options.note ??
		((message: string) => {
			process.stderr.write(`${message}\n`);
		});
	const me: LockOwner = {
		pid: process.pid,
		host: hostname(),
		started: Date.now(),
		token: `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	};
	const deadline = Date.now() + waitMs;
	let holder: LockOwner | null = null;
	for (;;) {
		me.started = Date.now();
		if (createExclusive(path, `${JSON.stringify(me)}\n`)) break;
		holder = readOwner(path);
		const reason = staleReason(path, holder);
		if (reason !== null && takeOver(gitDir, path, holder)) {
			note(`hyperdrive: took over a stale space lock at ${quoteForTerminal(path)}: ${reason}.`);
			continue;
		}
		if (Date.now() >= deadline) {
			const who =
				holder === null
					? "another hyper process"
					: `another hyper process (pid ${holder.pid}${holder.host === hostname() ? "" : ` on ${quoteForTerminal(holder.host)}`}, since ${new Date(holder.started).toISOString()})`;
			throw new SpaceLockTimeoutError(
				`${who} is still writing this space, so I did not ${escapeControlCharacters(what)} (waited ${Math.round(waitMs / 1000)} s; nothing was changed). Retry when it has finished; if no hyper process is running, delete ${quoteForTerminal(path)}.`,
			);
		}
		sleepSync(Math.min(RETRY_MS, Math.max(1, deadline - Date.now())));
	}
	const release = () => {
		// Never delete a lock that is no longer ours (taken over as stale).
		if (readOwner(path)?.token === me.token) rmSync(path, { force: true });
	};
	let result: T;
	try {
		result = action();
	} catch (error) {
		release();
		throw error;
	}
	if (result instanceof Promise) {
		return result.finally(release) as T;
	}
	release();
	return result;
}
