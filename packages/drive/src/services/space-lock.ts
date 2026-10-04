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
 * A lock is stale, and taken over with a one-line note, only when its owner
 * is provably gone: it was written on this host (and, on Linux, in this pid
 * namespace) and its pid no longer runs, or runs with a different start time
 * than the lock records (the pid was reused). A live owner is never taken
 * over, however old its lock: an interactive push may sit at a passphrase
 * prompt for an hour.
 *
 * Where liveness cannot be judged, the age rule (`STALE_AFTER_MS`) still
 * applies: a lock from another host, a lock from another pid namespace, a
 * lock written by an older CLI that recorded no start time, and a live pid
 * whose start time cannot be read. Two containers that share a hostname and a
 * space git dir but not a pid namespace are only told apart on Linux, through
 * `/proc/self/ns/pid`; anywhere else such a pair falls under the pid rule and
 * can misjudge the other's owner (a known limit, documented in the README).
 *
 * A lock file that cannot be read (EACCES…) or does not hold a lock record is
 * never taken over either: nothing about its owner is provable, so the waiter
 * times out with a line naming the file and the reason. Only an EMPTY file
 * (created, not yet written) older than `UNWRITTEN_GRACE_MS` is taken over.
 *
 * A takeover also removes an `index.lock` the dead owner's git left behind.
 * Takeovers are serialised by a second, short-lived guard file, so two
 * waiters that both judged the same lock stale cannot delete each other's
 * fresh lock.
 */
import { spawnSync } from "node:child_process";
import {
	closeSync,
	openSync,
	readFileSync,
	readlinkSync,
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
/**
 * A lock older than this is presumed abandoned when its owner's liveness
 * cannot be judged (another host or pid namespace, no recorded start time).
 */
export const STALE_AFTER_MS = 30 * 60 * 1000;
const RETRY_MS = 50;
/** A guard or lock file with no readable owner yet is given this long to be written. */
const UNWRITTEN_GRACE_MS = 5_000;

/** Why a write failed when the cause is the place, not hyper: errno to words. */
const UNWRITABLE: Record<string, string> = {
	EACCES: "permission denied",
	EPERM: "operation not permitted",
	EROFS: "the file system is read-only",
	ENOSPC: "the disk is full",
	EDQUOT: "the disk quota is exceeded",
};

/**
 * A one-line error for a write into a space git dir that the file system
 * refused (permissions, read-only mount, full disk), or the original error
 * when it is anything else. Used for the lock, the session-end payload and
 * the session-end log, so none of them surfaces a raw `EACCES: …, open …`.
 */
export function spaceGitDirWriteError(gitDir: string, what: string, error: unknown): unknown {
	const why = UNWRITABLE[(error as NodeJS.ErrnoException | undefined)?.code ?? ""];
	if (why === undefined) return error;
	return new SpaceGitError(
		`I can't write to the space git dir ${quoteForTerminal(gitDir)} (${why}), so I did not ${escapeControlCharacters(what)}; nothing was changed. Check that directory's owner, permissions and free space.`,
	);
}

export class SpaceLockTimeoutError extends SpaceGitError {
	constructor(detail: string) {
		super(detail);
		this.name = "SpaceLockTimeoutError";
	}
}

export interface LockOwner {
	pid: number;
	host: string;
	started: number;
	token: string;
	/**
	 * Opaque identity of the owner process's start (`/proc` start ticks on
	 * Linux, `ps -o lstart` elsewhere). Absent in locks from older CLIs and
	 * where it cannot be read.
	 */
	procStart?: string;
	/** `/proc/self/ns/pid` of the owner (Linux only). */
	pidNs?: string;
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

/**
 * An opaque, comparable identity of when `pid` started, or null when it cannot
 * be read. Linux: field 22 of `/proc/<pid>/stat` (clock ticks since boot),
 * prefixed with the boot id so a reboot never compares equal. Elsewhere:
 * `ps -o lstart=` (one-second resolution) from an absolute path, under a fixed
 * `TZ=UTC0` and the C locale, stored as epoch seconds so the value never
 * depends on the caller's time zone.
 */
export function processStartId(pid: number): string | null {
	if (!Number.isInteger(pid) || pid <= 0) return null;
	try {
		const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
		// The command name (field 2) may hold spaces and parentheses.
		const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
		const ticks = fields[19];
		if (ticks && /^\d+$/.test(ticks)) {
			let boot = "";
			try {
				boot = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
			} catch {
				/* Older kernels: ticks alone still change on pid reuse. */
			}
			return `proc:${boot}:${ticks}`;
		}
	} catch {
		/* No /proc (macOS), or the pid is gone. */
	}
	for (const ps of ["/bin/ps", "/usr/bin/ps"]) {
		// The zone and locale are FIXED, never inherited: `lstart` is printed in
		// the reading process's local time, and a writer and a waiter with
		// different TZ values would otherwise see one live process as two
		// (PR #52 review, B1). The text is then reduced to epoch seconds.
		const result = spawnSync(ps, ["-o", "lstart=", "-p", String(pid)], {
			encoding: "utf8",
			env: { LC_ALL: "C", TZ: "UTC0" },
			stdio: ["ignore", "pipe", "ignore"],
			timeout: 2_000,
		});
		if ((result.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") continue;
		const seconds = result.status === 0 ? utcLstartSeconds(result.stdout) : null;
		return seconds === null ? null : `ps:${seconds}`;
	}
	return null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * `ps -o lstart=` output printed under `TZ=UTC0 LC_ALL=C`
 * (`Sun Oct  4 23:03:55 2026`) as epoch seconds, or null when it is not that
 * shape. Exported for tests.
 */
export function utcLstartSeconds(text: string): number | null {
	const match = /^[A-Z][a-z]{2} ([A-Z][a-z]{2}) +(\d{1,2}) (\d{2}):(\d{2}):(\d{2}) (\d{4})$/.exec(
		text.trim(),
	);
	if (match === null) return null;
	const month = MONTHS.indexOf(match[1]!);
	if (month === -1) return null;
	const [day, hours, minutes, seconds, year] = match.slice(2).map(Number) as [
		number,
		number,
		number,
		number,
		number,
	];
	return Date.UTC(year, month, day, hours, minutes, seconds) / 1000;
}

/** This process's pid namespace (Linux), or null. */
function pidNamespace(): string | null {
	try {
		return readlinkSync("/proc/self/ns/pid");
	} catch {
		return null;
	}
}

let selfIdentity: { procStart: string | null; pidNs: string | null } | undefined;
function self(): { procStart: string | null; pidNs: string | null } {
	selfIdentity ??= { procStart: processStartId(process.pid), pidNs: pidNamespace() };
	return selfIdentity;
}

/**
 * What a waiter found in the lock file. Only `owner` can be judged. `missing`
 * means retry the create at once; `empty` is a lock created but not written
 * yet (taken over only after `UNWRITTEN_GRACE_MS`); `unreadable` (EACCES…)
 * and `garbage` can never be judged, so they are never taken over (PR #52
 * review, H1): the waiter times out with a line that says why.
 */
type LockRead =
	| { owner: LockOwner }
	| { owner: null; state: "missing" | "empty" | "garbage" }
	| { owner: null; state: "unreadable"; code: string };

function readLock(path: string): LockRead {
	let text: string;
	try {
		text = readFileSync(path, "utf8");
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code ?? "an error";
		return code === "ENOENT"
			? { owner: null, state: "missing" }
			: { owner: null, state: "unreadable", code };
	}
	if (text === "") return { owner: null, state: "empty" };
	const owner = parseOwner(text);
	return owner === null ? { owner: null, state: "garbage" } : { owner };
}

function readOwner(path: string): LockOwner | null {
	return readLock(path).owner;
}

function parseOwner(text: string): LockOwner | null {
	try {
		const value = JSON.parse(text) as Partial<LockOwner>;
		if (
			typeof value.pid === "number" &&
			typeof value.host === "string" &&
			typeof value.started === "number" &&
			typeof value.token === "string"
		)
			return {
				pid: value.pid,
				host: value.host,
				started: value.started,
				token: value.token,
				// A malformed optional field reads as absent, never as "differs".
				...(typeof value.procStart === "string" ? { procStart: value.procStart } : {}),
				...(typeof value.pidNs === "string" ? { pidNs: value.pidNs } : {}),
			};
	} catch {
		/* Not JSON: garbage, or a write caught half-way (judged as garbage). */
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

/** What `ownerStaleReason` needs to know about this machine and its processes. */
export interface LockProbe {
	host: string;
	pidNs: string | null;
	now: number;
	isAlive(pid: number): boolean;
	startOf(pid: number): string | null;
}

const ageRule = (owner: LockOwner, now: number) =>
	now - owner.started > STALE_AFTER_MS
		? `it is older than ${STALE_AFTER_MS / 60_000} minutes`
		: null;

/**
 * Why a written lock may be taken over, or null while its owner may still be
 * working. Exported for tests; the rules are in the header comment.
 */
export function ownerStaleReason(owner: LockOwner, probe: LockProbe): string | null {
	if (owner.host !== probe.host) return ageRule(owner, probe.now);
	if (owner.pidNs && probe.pidNs && owner.pidNs !== probe.pidNs) return ageRule(owner, probe.now);
	if (!probe.isAlive(owner.pid)) return `its owner (pid ${owner.pid}) is no longer running`;
	if (owner.procStart === undefined) return ageRule(owner, probe.now);
	const current = probe.startOf(owner.pid);
	if (current === null) return ageRule(owner, probe.now);
	if (current !== owner.procStart)
		return `its owner (pid ${owner.pid}) is no longer running; that pid now belongs to another process`;
	return null;
}

/**
 * Start ids already read in this process, per lock token: a waiter polls every
 * 50 ms, and `ps` must not run on each poll.
 */
const startCache = new Map<string, string | null>();

/** Why a lock may be taken over, or null while its owner may still be working. */
function staleReason(path: string, read: LockRead): string | null {
	const owner = read.owner;
	if (owner === null) {
		if (read.state !== "empty") return null;
		const age = ageOf(path);
		return age !== null && age > UNWRITTEN_GRACE_MS ? "it records no owner" : null;
	}
	return ownerStaleReason(owner, {
		host: hostname(),
		pidNs: self().pidNs,
		now: Date.now(),
		isAlive: isProcessAlive,
		startOf: (pid) => {
			const key = `${owner.token}:${pid}`;
			if (!startCache.has(key)) startCache.set(key, processStartId(pid));
			return startCache.get(key) ?? null;
		},
	});
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
function takeOver(gitDir: string, path: string, judgedRead: LockRead): boolean {
	const judged = judgedRead.owner;
	const guard = `${path}.takeover`;
	if (!createExclusive(guard, `${process.pid}\n`)) {
		// A guard is held for microseconds; one this old belongs to a dead process.
		const age = ageOf(guard);
		if (age !== null && age > UNWRITTEN_GRACE_MS) rmSync(guard, { force: true });
		return false;
	}
	try {
		const currentRead = readLock(path);
		const current = currentRead.owner;
		if ((current?.token ?? null) !== (judged?.token ?? null)) return false;
		if (staleReason(path, currentRead) === null) return false;
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

function describeAge(ms: number): string {
	const seconds = Math.max(0, Math.round(ms / 1000));
	if (seconds < 120) return `${seconds} s`;
	const minutes = Math.round(seconds / 60);
	return minutes < 120 ? `${minutes} min` : `${Math.round(minutes / 60)} h`;
}

/**
 * The one line a waiter gives up with. A lock still held at this point has an
 * owner judged alive, or one that cannot be judged, so the line says who holds
 * it and never invites deleting a live owner's lock (PR #52 review, M4).
 */
function lockTimeout(
	path: string,
	held: LockRead,
	what: string,
	waitMs: number,
): SpaceLockTimeoutError {
	const waited = `so I did not ${escapeControlCharacters(what)} (waited ${Math.round(waitMs / 1000)} s; nothing was changed)`;
	const file = quoteForTerminal(path);
	const owner = held.owner;
	if (owner !== null) {
		const here = owner.host === hostname();
		const where = here ? "" : ` on ${quoteForTerminal(owner.host)}`;
		const check = here ? ` (\`ps -p ${owner.pid}\` shows whether it is)` : "";
		return new SpaceLockTimeoutError(
			`hyper process ${owner.pid}${where} has held this space's lock for ${describeAge(Date.now() - owner.started)} (since ${new Date(owner.started).toISOString()}) and is still running, ${waited}. Retry when it has finished, or stop that process. Delete ${file} only if process ${owner.pid}${where} is gone${check}.`,
		);
	}
	if (held.state === "unreadable")
		return new SpaceLockTimeoutError(
			`I can't read the space lock ${file} (${held.code}), so I can't tell whether its owner is still running, ${waited}. Check that file's owner and permissions; delete it only if no hyper process is writing this space.`,
		);
	if (held.state === "garbage")
		return new SpaceLockTimeoutError(
			`The space lock ${file} holds something that is not a hyper lock record, so I can't tell whether its owner is still running, ${waited}. Delete it only if no hyper process is writing this space.`,
		);
	return new SpaceLockTimeoutError(
		`Another hyper process is still writing this space, ${waited}. Retry when it has finished.`,
	);
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
	const identity = self();
	const me: LockOwner = {
		pid: process.pid,
		host: hostname(),
		started: Date.now(),
		token: `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
		...(identity.procStart === null ? {} : { procStart: identity.procStart }),
		...(identity.pidNs === null ? {} : { pidNs: identity.pidNs }),
	};
	const deadline = Date.now() + waitMs;
	let held: LockRead = { owner: null, state: "missing" };
	for (;;) {
		me.started = Date.now();
		let created: boolean;
		try {
			created = createExclusive(path, `${JSON.stringify(me)}\n`);
		} catch (error) {
			throw spaceGitDirWriteError(gitDir, what, error);
		}
		if (created) break;
		held = readLock(path);
		const reason = staleReason(path, held);
		let tookOver = false;
		try {
			tookOver = reason !== null && takeOver(gitDir, path, held);
		} catch (error) {
			throw spaceGitDirWriteError(gitDir, what, error);
		}
		if (tookOver) {
			note(`hyperdrive: took over a stale space lock at ${quoteForTerminal(path)}: ${reason}.`);
			continue;
		}
		if (Date.now() >= deadline) throw lockTimeout(path, held, what, waitMs);
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
