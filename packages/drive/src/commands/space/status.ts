import { Flags } from "@oclif/core";
import { SpaceCommand } from "#lib/space-command";
import {
	escapeControlCharacters,
	escapeControlCharactersKeepingBackslashes,
	quoteForTerminal,
} from "#lib/terminal-text";
import {
	finishInterruptedPull,
	interruptedPullTip,
	type PullMarker,
	readPullMarker,
} from "#services/space-git";
import { fetchSpace, spaceStatus } from "#services/space-history";
import { peekSpaceLock, SpaceLockTimeoutError, withSpaceLock } from "#services/space-lock";

/**
 * What status reports instead of waiting for the lock. `running`: the pull
 * that wrote the marker is the one holding the lock. `interrupted`: some other
 * process holds it, and the interrupted pull is finished once it lets go.
 */
interface PullInProgress {
	state: "running" | "interrupted";
	/** The process holding the lock (the pull itself when `running`). */
	pid: number | null;
	since: string | null;
}

function describePull(
	marker: PullMarker | null,
	holder: { pid: number | null; since: number | null } | null,
): PullInProgress {
	const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());
	if (marker !== null && holder !== null && marker.pid === holder.pid)
		return { state: "running", pid: marker.pid, since: iso(marker.startedAt) };
	if (holder !== null) return { state: "interrupted", pid: holder.pid, since: iso(holder.since) };
	// The lock was released between the check and the report: the marker is all there is.
	return marker === null
		? { state: "interrupted", pid: null, since: null }
		: { state: "running", pid: marker.pid, since: iso(marker.startedAt) };
}

/**
 * Status prints paths from the work tree AND from an incoming branch, so a
 * filename is untrusted text. A path that needs escaping is quoted, which also
 * stops it breaking out of its own line; a plain path prints as it is.
 */
function displayPath(path: string): string {
	return escapeControlCharacters(path) === path ? path : quoteForTerminal(path);
}

export default class Status extends SpaceCommand<typeof Status> {
	static override description = "Show this space's changes, cadence and last-known upstream state";
	static override examples = [
		"<%= config.bin %> space status",
		"<%= config.bin %> space status --json",
		"<%= config.bin %> space status --fetch",
	];
	static override flags = {
		...SpaceCommand.baseFlags,
		json: Flags.boolean({ description: "Print the result as JSON", default: false }),
		fetch: Flags.boolean({
			description: "Fetch this space's branch before comparing (otherwise offline)",
			default: false,
		}),
	};
	async run(): Promise<void> {
		const { flags } = await this.parse(Status);
		const result = await this.inSpace(flags.debug, ({ root, branch }) => {
			if (flags.fetch) fetchSpace(root, branch);
			// Status is read-only, except to finish a pull that was stopped
			// between its index and its branch update (review of PR #54, M1):
			// only then does it take the space lock, and it never waits for it
			// (hyper-prj.28): a pull that is still running is reported instead.
			let pullInProgress: PullInProgress | null = null;
			const marker = readPullMarker(root);
			if (marker !== null || interruptedPullTip(root, branch) !== null) {
				const holder = peekSpaceLock(root);
				if (holder !== null) pullInProgress = describePull(marker, holder);
				else
					try {
						withSpaceLock(
							root,
							`finish the pull of ${branch}`,
							() => finishInterruptedPull(root, branch),
							{ waitMs: 0 },
						);
					} catch (error) {
						if (!(error instanceof SpaceLockTimeoutError)) throw error;
						pullInProgress = describePull(marker, peekSpaceLock(root));
					}
			}
			return { ...spaceStatus(root, branch), pullInProgress };
		});
		if (flags.json) {
			// Raw paths: JSON serialisation is the consumer's escaping, and a
			// pre-escaped value could not be told apart from a real backslash.
			this.log(JSON.stringify(result, null, 2));
			return;
		}
		this.log(`Branch:  ${escapeControlCharacters(result.branch)}`);
		this.log(`Cadence: ${escapeControlCharacters(result.cadence || "unset (manual)")}`);
		this.log(
			result.upstreamKnown
				? `Upstream: ahead ${result.ahead}, behind ${result.behind}${result.refused ? `: the newest commit on the hyperdrive was refused by the last pull (${quoteForTerminal(result.refused.reason)})` : " (as of the last contact with the hyperdrive)"}`
				: "Upstream: this machine has not exchanged this branch with the hyperdrive yet — run `hyper space status --fetch` to compare.",
		);
		if (result.pullInProgress !== null) {
			const pull = result.pullInProgress;
			const who = pull.pid === null ? "pid unknown" : `pid ${pull.pid}`;
			this.log(
				pull.state === "running"
					? `Pull in progress (${who}${pull.since === null ? "" : `, since ${pull.since}`}): the numbers below may change when it finishes.`
					: `Another hyper process (${who}) holds the space lock; the interrupted pull will be finished when it releases it.`,
			);
		}
		if (result.sessionEndFailure !== null) {
			const failure = result.sessionEndFailure;
			this.log(
				`Last session end (${escapeControlCharacters(failure.at)}, session ${escapeControlCharacters(failure.session)}): ${failure.outcome === "push-failed" ? "push failed" : failure.outcome}: ${escapeControlCharactersKeepingBackslashes(failure.detail)}`,
			);
		}
		if (result.status.length === 0) this.log("Working tree clean.");
		for (const entry of result.status) {
			this.log(
				`${entry.code} ${entry.originalPath === undefined ? "" : `${displayPath(entry.originalPath)} -> `}${displayPath(entry.path)}`,
			);
		}
		if (result.userState.length > 0)
			this.log(
				`Not tracked (Claude user state under .claude/): ${result.userState.length} — \`hyper space status --json\` lists them.`,
			);
	}
}
