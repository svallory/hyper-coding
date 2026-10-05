/**
 * The sync-engine interface — the seam between hyperdrive's config sync and the
 * tool that actually moves the bytes (C-8).
 *
 * Nothing in this file (or anywhere else outside `services/sync/mutagen.ts`)
 * names the engine. Commands import {@link getEngine}, never a concrete class,
 * so swapping Mutagen for another engine is one new file plus one line here.
 *
 * The vocabulary is deliberately engine-neutral: an "alpha" is where files are
 * read from, a "beta" is where they are written, and a "session" is one named
 * pairing. Mutagen calls them that, but so does every other rsync-shaped tool.
 */

// The engine owns the rules for what an ignore pattern can be (C-8): the
// config loader asks through the engine module rather than importing the
// implementation directly.
export { ignorePatternProblem, sessionNameProblem } from "#services/sync/mutagen";

import { MutagenSyncEngine } from "#services/sync/mutagen";

/** The only sync semantics hyperdrive configures. */
export type SyncMode = "two-way-resolved";

/** How symlinks are reproduced on the far side. */
export type SyncSymlinkMode = "posix-raw";

/** One configured pairing, as `list()` reports it. */
export interface SyncSession {
	/** Session name — `hyper-claude-<machine>` / `hyper-pi-<machine>` in practice. */
	name: string;
	/** Alpha URL: where files are read from. */
	alpha: string;
	/** Beta URL: where files are written. */
	beta: string;
	/** Engine's own status word, verbatim (e.g. "watching", "scanning", "halted"). */
	status: string;
	/** Reconciliation mode ("two-way-resolved"). */
	mode: string;
	/** Ignore patterns in force, as the engine normalized them. */
	ignore: string[];
	/** True when the session is paused. */
	paused: boolean;
	/** How symlinks are reproduced on beta ("posix-raw"), as the engine stores it. */
	symlinkMode: string;
	/** Default file mode created on beta, as the engine stores it ("0660"). */
	betaFileMode: string;
	/** Default directory mode created on beta, as the engine stores it ("0770"). */
	betaDirMode: string;
	/** Whether each side answered on the last poll. */
	alphaConnected: boolean;
	betaConnected: boolean;
	/**
	 * Why the session is not moving files, as the engine reports it: its last
	 * error and every scan or transition problem on either side, one line each
	 * (`beta transition problem: <path>: <error>`). Empty when it is healthy.
	 */
	problems: string[];
}

export interface SyncCreateOptions {
	/** Patterns to leave behind. Order is preserved; one flag per pattern. */
	ignore: string[];
	symlinkMode: SyncSymlinkMode;
	/** Mode for files created on beta, as an octal string (spawned verbatim). */
	betaFileMode: string;
	/** Mode for directories created on beta, as an octal string. */
	betaDirMode: string;
	mode: SyncMode;
}

/** Whether the engine's background process will survive a reboot. */
export interface SyncDaemonState {
	/** Registered to start automatically at login. */
	registered: boolean;
	/** Answering right now. */
	running: boolean;
}

/**
 * One round trip to the engine: liveness and the session list together.
 *
 * They come from the same `sync list` call, so a caller that needs both gets
 * them without asking twice.
 */
export interface SyncProbe {
	daemon: SyncDaemonState;
	sessions: SyncSession[];
}

/** Everything hyperdrive needs from a sync engine. */
export interface SyncEngine {
	/** Create a session. Fails if one of that name already exists. */
	create(name: string, alpha: string, beta: string, options: SyncCreateOptions): Promise<void>;
	/** Every session the engine knows about. */
	list(): Promise<SyncSession[]>;
	/** Push everything queued on alpha out to beta now. */
	flush(name: string): Promise<void>;
	/** Delete the session (the files on both sides stay). */
	terminate(name: string): Promise<void>;
	/** One session, or a SyncEngineError if there is no session by that name. */
	status(name: string): Promise<SyncSession>;
	/** Login-registration and liveness of the engine's background process. */
	daemonReady(): Promise<SyncDaemonState>;
	/** Liveness and the session list in one round trip. */
	probe(): Promise<SyncProbe>;
	/**
	 * The exact commands a user should run to reach a healthy daemon.
	 *
	 * Engine-specific on purpose: the command layer prints these without ever
	 * knowing what tool they belong to, which is what keeps the engine isolated.
	 */
	fixHints(state: SyncDaemonState): string[];
	/** How to replace a session that no longer matches, naming the machine. */
	terminateHint(name: string, machine: string): string;
	/** Why this name can't be a session name, or null if it's fine. */
	validateSessionName(name: string): string | null;
	/** Why this ignore pattern is unusable, or null if it's fine. */
	validateIgnore(pattern: string): string | null;
}

/**
 * A user-facing sync failure. The stack is the message and nothing else, so
 * oclif's prettyPrint() (which returns `error.stack` verbatim in dev mode)
 * never dumps JS frames on top of a friendly sentence — the same trick
 * SpaceGitError uses, and for the same reason.
 */
export class SyncEngineError extends Error {
	/**
	 * Stable machine-readable reason. Callers use it to tell "the engine is
	 * not installed" (which must always reach the user) from "the daemon is
	 * down" (which is a normal state worth reporting, not an error).
	 */
	readonly code?: string;

	constructor(message: string, code?: string) {
		super(message);
		this.name = "SyncEngineError";
		this.code = code;
		this.stack = message;
	}
}

/** The engine hyperdrive uses today. */
export type SyncEngineName = "mutagen";

/**
 * The configured sync engine.
 *
 * The concrete class is imported here rather than in each command, so callers
 * never import `services/sync/mutagen.ts` directly and the engine choice stays
 * in this one file.
 */
export function getEngine(): SyncEngine {
	return new MutagenSyncEngine();
}
