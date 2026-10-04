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
 * `ps -o lstart=` (one-second resolution), run from an absolute path with the
 * C locale.
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
		const result = spawnSync(ps, ["-o", "lstart=", "-p", String(pid)], {
			encoding: "utf8",
			env: { LC_ALL: "C", ...(process.env.TZ ? { TZ: process.env.TZ } : {}) },
			stdio: ["ignore", "pipe", "ignore"],
			timeout: 2_000,
		});
		if ((result.error as NodeJS.ErrnoException | undefined)?.code === "ENOENT") continue;
		const text = result.status === 0 ? result.stdout.trim().replace(/\s+/g, " ") : "";
		return text ? `ps:${text}` : null;
	}
	return null;
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

function readOwner(path: string): LockOwner | null {
	try {
		const value = JSON.parse(readFileSync(path, "utf8")) as Partial<LockOwner>;
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
function staleReason(path: string, owner: LockOwner | null): string | null {
	if (owner === null) {
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
