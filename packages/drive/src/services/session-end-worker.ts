/**
 * The session-end save, run by a process detached from the Claude session.
 *
 * Claude Code gives SessionEnd hooks 1.5 s in total unless the user's own
 * settings raise it, and it is not documented that a plugin's `hooks.json`
 * timeout does. A commit plus a push routinely takes longer, and a hook
 * killed part-way through a commit is how an `index.lock` gets left behind.
 * So the hook script only finds the space and reads its cadence, writes the
 * hook JSON to a payload file in the space git dir, and starts
 * `hyper space commit --session-end --payload-file <file>` in a new session;
 * this module is that process.
 *
 * Bounds (the worker gives up, never waits forever):
 *   - commit lock wait: `SESSION_END_COMMIT_LOCK_WAIT_MS` (45 s)
 *   - push lock wait:   `SESSION_END_PUSH_LOCK_WAIT_MS` (15 s)
 *   - push, connection included: `SESSION_END_PUSH_TIMEOUT_MS` (30 s), its
 *     whole process group killed on expiry; ssh connect timeout 10 s
 *   - everything above is also cut to what is left of
 *     `SESSION_END_WORKER_BUDGET_MS` (120 s) from the worker's start.
 * The local commit itself has no timer: it is local git work, and killing it
 * part-way is exactly what this design avoids.
 *
 * Nobody watches this process, so every result is one line of
 * `session-end.log` (see `session-end-log.ts`).
 */
import { readdirSync, readFileSync, realpathSync, rmSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { Readable } from "node:stream";
import { quoteForTerminal } from "#lib/terminal-text";
import { isIgnoredSessionEnd, readSessionEndInput, sessionEndMessage } from "#services/session-end";
import { appendSessionEndLog, type SessionEndLogEntry } from "#services/session-end-log";
import { readCadence, spaceGitDir } from "#services/space-git";
import { requireInitializedSpace, spaceRemote } from "#services/space-history";
import { commitSpace, pushSpaceBounded, SESSION_END_PUSH_TIMEOUT_MS } from "#services/space-sync";

export const SESSION_END_PAYLOAD_PREFIX = "session-end-payload.";
export const SESSION_END_WORKER_BUDGET_MS = 120_000;
export const SESSION_END_COMMIT_LOCK_WAIT_MS = 45_000;
export const SESSION_END_PUSH_LOCK_WAIT_MS = 15_000;
/** Below this much budget a push is not started at all. */
const PUSH_MINIMUM_MS = 5_000;
/** Payload files a worker never got to (it could not start) are swept after a day. */
const PAYLOAD_SWEEP_AGE_MS = 24 * 60 * 60 * 1000;
const PAYLOAD_LIMIT = 64 * 1024;

export class SessionEndPayloadError extends Error {}

/**
 * The command deletes the file it is given, so only a payload file the hook
 * script created is accepted: named `session-end-payload.*`, directly inside
 * a space git dir.
 */
function payloadGitDir(payloadPath: string): string {
	const gitDir = dirname(payloadPath);
	if (
		!basename(payloadPath).startsWith(SESSION_END_PAYLOAD_PREFIX) ||
		basename(gitDir) !== "space.git" ||
		basename(dirname(gitDir)) !== ".hyper"
	)
		throw new SessionEndPayloadError(
			`--payload-file must be a ${SESSION_END_PAYLOAD_PREFIX}* file inside a space's .hyper/space.git; ${quoteForTerminal(payloadPath)} is not one.`,
		);
	return gitDir;
}

function sweepPayloads(gitDir: string): void {
	try {
		for (const name of readdirSync(gitDir)) {
			if (!name.startsWith(SESSION_END_PAYLOAD_PREFIX)) continue;
			const path = join(gitDir, name);
			if (Date.now() - statSync(path).mtimeMs > PAYLOAD_SWEEP_AGE_MS) rmSync(path, { force: true });
		}
	} catch {
		/* Best effort. */
	}
}

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Read (and always remove) the payload, then commit and, for the
 * `session-end+push` cadence, push. Returns the recorded entry; a payload
 * whose reason is `clear` or `resume` saves nothing and is recorded as ignored.
 */
export async function runSessionEndWorker(
	payloadPath: string,
	cwd: string = process.cwd(),
): Promise<SessionEndLogEntry> {
	const deadline = Date.now() + SESSION_END_WORKER_BUDGET_MS;
	const gitDir = payloadGitDir(payloadPath);
	let raw: Buffer;
	try {
		if (statSync(payloadPath).size > PAYLOAD_LIMIT)
			return appendSessionEndLog(gitDir, {
				session: "-",
				outcome: "refused",
				detail: "the SessionEnd payload exceeds 64 KiB; nothing was committed.",
			});
		raw = readFileSync(payloadPath);
	} catch (error) {
		return appendSessionEndLog(gitDir, {
			session: "-",
			outcome: "failed",
			detail: `I couldn't read the SessionEnd payload: ${message(error)}`,
		});
	} finally {
		rmSync(payloadPath, { force: true });
		sweepPayloads(gitDir);
	}

	let input: Awaited<ReturnType<typeof readSessionEndInput>>;
	try {
		input = await readSessionEndInput(Readable.from([raw]));
	} catch (error) {
		return appendSessionEndLog(gitDir, {
			session: "-",
			outcome: "refused",
			detail: message(error),
		});
	}
	const session = input.session_id;
	// Recorded rather than silent: it only happens when a hook configuration
	// forwards these reasons, and that is worth seeing in the log.
	if (isIgnoredSessionEnd(input))
		return appendSessionEndLog(gitDir, {
			session,
			outcome: "ignored",
			detail: `reason ${quoteForTerminal(input.reason ?? "")}: nothing is saved when a session is cleared or resumed.`,
		});
	const notes: string[] = [];
	let root: string;
	let branch: string;
	let committed: number;
	try {
		({ root, branch } = requireInitializedSpace(cwd));
		if (realpathSync(spaceGitDir(root)) !== realpathSync(gitDir))
			throw new Error(
				`the payload belongs to ${quoteForTerminal(gitDir)}, but the worker's directory is in the space at ${quoteForTerminal(root)}; nothing was committed.`,
			);
		const result = await commitSpace(
			root,
			branch,
			await sessionEndMessage(input),
			[],
			"daily",
			(warning) => notes.push(warning.trim()),
			{
				waitMs: Math.max(0, Math.min(SESSION_END_COMMIT_LOCK_WAIT_MS, deadline - Date.now())),
				note: (note) => notes.push(note),
			},
		);
		committed = result.committed;
	} catch (error) {
		const text = message(error);
		return appendSessionEndLog(gitDir, {
			session,
			outcome: /^(refusing|SessionEnd|I couldn't read the SessionEnd)/.test(text)
				? "refused"
				: "failed",
			detail: [text, ...notes].join(" "),
		});
	}
	const saved =
		committed > 0
			? `committed ${committed} file${committed === 1 ? "" : "s"}`
			: "nothing to commit";
	if (readCadence(root) === "session-end+push") {
		const remaining = deadline - Date.now();
		if (remaining < PUSH_MINIMUM_MS)
			return appendSessionEndLog(gitDir, {
				session,
				outcome: "push-failed",
				detail: `${saved}; the time for this session end ran out before the push. The commit is saved locally and will be pushed next time.`,
			});
		const lockWait = Math.min(SESSION_END_PUSH_LOCK_WAIT_MS, Math.floor(remaining / 3));
		try {
			await pushSpaceBounded(
				root,
				spaceRemote(root),
				branch,
				Math.min(SESSION_END_PUSH_TIMEOUT_MS, remaining - lockWait),
				{ waitMs: lockWait, note: (note) => notes.push(note) },
			);
		} catch (error) {
			return appendSessionEndLog(gitDir, {
				session,
				outcome: "push-failed",
				detail: [`${saved}; push failed: ${message(error)}`, ...notes].join(" "),
			});
		}
		return appendSessionEndLog(gitDir, {
			session,
			outcome: committed > 0 ? "committed" : "nothing",
			detail: [`${saved}, pushed`, ...notes].join(" "),
		});
	}
	return appendSessionEndLog(gitDir, {
		session,
		outcome: committed > 0 ? "committed" : "nothing",
		detail: [saved, ...notes].join(" "),
	});
}
