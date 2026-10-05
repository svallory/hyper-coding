/** Shared staging, publication and remote diagnostics for space history. */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { escapeControlCharacters, quoteForTerminal } from "#lib/terminal-text";
import {
	claudeUserStateExcludes,
	findSecretPaths,
	isClaudeUserStatePath,
} from "#services/allowlist";
import {
	finishInterruptedPull,
	gitSaid,
	readSpaceBlobPrefixes,
	SpaceGitError,
	SpaceGitInterruptedError,
	spaceGit,
	spaceGitBounded,
} from "#services/space-git";
import { type SpaceLockOptions, withSpaceLock } from "#services/space-lock";

/** The first matching branch on the remote, or null. */
export function remoteRef(root: string, remote: string, pattern: string): string | null {
	const result = spaceGit(root, ["ls-remote", "--heads", remote, pattern], { allowFailure: true });
	if (result.status !== 0) {
		throw new SpaceGitError(
			`I couldn't reach your hyperdrive at ${escapeControlCharacters(remote)} to look at its branches: ` +
				`${gitSaid(result.stderr || result.stdout) || "git ls-remote said nothing"}`,
		);
	}
	for (const line of result.stdout.split("\n")) {
		const ref = line.split("\t")[1]?.trim();
		if (ref !== undefined && ref !== "") return ref;
	}
	return null;
}

/** The remote's actual branch tip (not a possibly absent tracking ref). */
export function remoteSha(root: string, remote: string, branch: string): string | null {
	const result = spaceGit(root, ["ls-remote", remote, `refs/heads/${branch}`], {
		allowFailure: true,
	});
	if (result.status !== 0) {
		throw new SpaceGitError(
			`I couldn't reach your hyperdrive at ${escapeControlCharacters(remote)} to look for ${escapeControlCharacters(branch)}: ` +
				`${gitSaid(result.stderr || result.stdout) || "git ls-remote said nothing"}`,
		);
	}
	const first = result.stdout.split("\n")[0] ?? "";
	return first.trim() === "" ? null : (first.split("\t")[0] ?? "").trim();
}

/** A definite remote refusal, distinct from an uncertain network failure. */
export class SpacePushRefusedError extends SpaceGitError {
	constructor(
		message: string,
		readonly firstInitAdvice = "",
	) {
		super(message);
		this.name = "SpacePushRefusedError";
	}
}

/** The first non-empty reason line sent by a remote hook. */
export function hookReason(detail: string): string {
	for (const line of detail.split("\n")) {
		const trimmed = line.trim();
		if (trimmed.startsWith("remote:")) {
			const reason = trimmed.slice("remote:".length).trim();
			if (reason !== "") return reason;
		}
	}
	return "";
}

/** Publish with actionable diagnostics; child interruptions propagate unchanged. */
export function spaceGitRemote(
	root: string,
	remote: string,
	args: readonly string[],
	branch: string,
	caller: "init" | "daily" = "daily",
): void {
	const result = spaceGit(root, [...args], { allowFailure: true });
	if (result.status === 0) return;
	throw pushFailure(remote, (result.stderr || result.stdout).trim(), args, branch, caller);
}

/** Classify a failed push: a definite refusal, or an uncertain network failure. */
function pushFailure(
	remote: string,
	detail: string,
	args: readonly string[],
	branch: string,
	caller: "init" | "daily",
): SpaceGitError {
	const what = `push ${escapeControlCharacters(branch)}`;
	// Ref conflicts also carry [remote rejected], but are not hook failures.
	if (/refname conflict|cannot lock ref/i.test(detail)) {
		return new SpacePushRefusedError(
			`the hyperdrive at ${escapeControlCharacters(remote)} already has a ref that ${escapeControlCharacters(branch)} collides with, so it cannot take this branch. ` +
				(caller === "init"
					? "Pick a space name that does not collide."
					: "Inspect the remote ref hierarchy and reconcile the conflicting names manually; there is no space rename command."),
			` Pass \`--name\` or \`--group\` to pick a name that does not collide.`,
		);
	}
	// A hook may itself say "fetch first"; its explicit refusal takes precedence.
	if (/\((?:pre-receive |update )?hook declined\)/i.test(detail)) {
		const reason = hookReason(detail);
		return new SpacePushRefusedError(
			`the hyperdrive at ${escapeControlCharacters(remote)} refused to take ${escapeControlCharacters(branch)}: a server-side hook declined the push. ` +
				`Nothing was overwritten, and retrying will not help until that hook allows it.` +
				(reason === "" ? "" : ` It said: ${gitSaid(reason).replace(/[.!?]+$/, "")}.`),
		);
	}
	if (/(fetch first|non-fast-forward|stale info|behind its remote)/i.test(detail)) {
		return new SpacePushRefusedError(
			`${what} was refused: ${escapeControlCharacters(remote)} has moved on, so another machine pushed this space's branch ` +
				`first. Nothing was overwritten — hyper never rewrites a space's history. ` +
				(caller === "init"
					? "Use a different name to initialise a new space, or reconcile the existing history manually."
					: "Run `hyper space pull` to fast-forward if possible; divergent histories need manual reconciliation."),
			` Pass \`--name\` with a different name to initialise a new space.`,
		);
	}
	return new SpaceGitError(
		`I couldn't reach your hyperdrive at ${escapeControlCharacters(remote)} to ${what}: ${gitSaid(detail) || `git ${args[0]} failed`}`,
	);
}

/**
 * -z bypasses core.quotePath: line listings C-quote Unicode and control bytes,
 * hiding e.g. a non-ASCII directory's .pem from the name guard. Never trim paths.
 */
export function stagedPaths(root: string): string[] {
	return spaceGit(root, ["diff", "--cached", "--name-only", "-z"])
		.stdout.split("\0")
		.filter((path) => path !== "");
}

/**
 * Claude user-state files on disk that the space does not track: untracked
 * files (gitignore rules respected) that are user state. What a commit leaves
 * out and what `space status` reports instead of listing them as untracked.
 */
export function userStateOnDisk(root: string): string[] {
	return spaceGit(root, ["ls-files", "--others", "--exclude-standard", "-z"])
		.stdout.split("\0")
		.filter((path) => path !== "" && isClaudeUserStatePath(path));
}

/** Every path in the index, NUL-separated so no name is quoted or trimmed. */
function indexPaths(root: string): string[] {
	return spaceGit(root, ["ls-files", "-z"])
		.stdout.split("\0")
		.filter((path) => path !== "");
}

/** Index entries with mode 160000 cannot be backed up by a space. */
export function stagedGitlinks(root: string): string[] {
	return spaceGit(root, ["ls-files", "-s", "-z"])
		.stdout.split("\0")
		.filter((entry) => entry.startsWith("160000 "))
		.map((entry) => entry.slice(entry.indexOf("\t") + 1))
		.filter((path) => path !== "");
}

/** Inspect the index, not disk: deletions are safe and exact overrides never act as globs. */
export async function inspectStagedFiles(
	root: string,
	paths: string[],
	allow: string[] = [],
): Promise<{ secrets: string[]; allowedSecrets: string[]; largeFiles: string[] }> {
	const entries = new Map<string, string>();
	for (const entry of spaceGit(root, ["ls-files", "-s", "-z"]).stdout.split("\0")) {
		if (!entry) continue;
		const tab = entry.indexOf("\t");
		const [mode, hash, stage] = entry.slice(0, tab).split(" ");
		if (stage === "0" && mode !== "160000") entries.set(entry.slice(tab + 1), hash);
	}
	const secrets: string[] = [];
	const allowedSecrets: string[] = [];
	const largeFiles: string[] = [];
	const blobs = await readSpaceBlobPrefixes(
		root,
		paths.flatMap((path) => (entries.has(path) ? [entries.get(path)!] : [])),
	);
	for (const path of paths) {
		const hash = entries.get(path);
		if (!hash) continue; // Deleted paths have no staged blob to leak.
		const blob = blobs.get(hash)!;
		if (blob.size > 50 * 1024 * 1024) largeFiles.push(path);
		const prefix = blob.prefix.toString("utf8");
		const secret =
			findSecretPaths([path]).length > 0 ||
			/-----BEGIN (?:[^\r\n]* )?PRIVATE KEY(?: BLOCK)?-----/.test(prefix);
		if (secret) (allow.includes(path) ? allowedSecrets : secrets).push(path);
	}
	return { secrets, allowedSecrets, largeFiles };
}

export interface SpaceCommitResult {
	committed: number;
	unborn: boolean;
	skipped: string[];
	allowedSecrets: string[];
	largeFiles: string[];
}

/** Stage the allowlist, remove gitlinks, guard secrets and commit without hooks/signing. */
export async function commitSpace(
	root: string,
	branch: string,
	message: string,
	allowSecrets: string[] = [],
	caller: "init" | "daily" = "daily",
	reportWarning: (message: string) => void = (message) => {
		process.stderr.write(message);
	},
	lock: SpaceLockOptions = {},
): Promise<SpaceCommitResult> {
	if (message.trim() === "")
		throw new SpaceGitError(
			"A commit message cannot be empty. Pass a non-empty `-m` message before trying again.",
		);
	// Stage, inspect, commit and any index cleanup form ONE critical section:
	// another process staging between the secret guard and the commit would
	// otherwise have its unchecked files committed here (PR #45 review, B1).
	return withSpaceLock(
		root,
		`commit ${branch}`,
		() => commitSpaceLocked(root, branch, message, allowSecrets, caller, reportWarning),
		lock,
	);
}

async function commitSpaceLocked(
	root: string,
	branch: string,
	message: string,
	allowSecrets: string[],
	caller: "init" | "daily",
	reportWarning: (message: string) => void,
): Promise<SpaceCommitResult> {
	try {
		// A pull stopped between its index update and its branch update leaves
		// the peer's tip in the index: finish it first, or this commit would
		// record that tip as local work (review of PR #54, M1).
		if (finishInterruptedPull(root, branch) !== null)
			reportWarning(
				"note: finished a pull that was interrupted before it could move the branch.\n",
			);
		const excluded = spaceGit(root, ["ls-files", "--others", "--exclude-standard", "-z"])
			.stdout.split("\0")
			.filter((path) => path.endsWith("/") && existsSync(join(root, path, ".git")))
			.map((path) => path.slice(0, -1));
		spaceGit(root, [
			"add",
			"-A",
			"--",
			".",
			...excluded.map((path) => `:(top,exclude,literal)${path}`),
			// Claude's user state never enters the index, whatever the
			// work tree's `.gitignore` says (ac-gaps r2, B1).
			...claudeUserStateExcludes(),
		]);
		// …and user state that is ALREADY tracked (an old space, an incoming
		// tip that planted it, a force-add) leaves the index in this same
		// commit. `--cached`: the files stay on disk.
		const trackedUserState = indexPaths(root).filter(isClaudeUserStatePath);
		if (trackedUserState.length > 0) {
			for (let i = 0; i < trackedUserState.length; i += 500)
				spaceGit(root, [
					"rm",
					"--cached",
					"-q",
					"-f",
					"--",
					...trackedUserState.slice(i, i + 500).map((path) => `:(literal)${path}`),
				]);
		}
		// An exclusion is never silent (review of PR #54, N5): one line with
		// the count, whenever any user state is left out or stopped being
		// tracked here. `hyper space status --json` lists them.
		const leftOut = userStateOnDisk(root);
		if (leftOut.length > 0) {
			const stopped = trackedUserState.length;
			reportWarning(
				`note: ${leftOut.length} Claude user-state path${leftOut.length === 1 ? "" : "s"} under .claude/ ${leftOut.length === 1 ? "is" : "are"} not tracked${stopped > 0 ? ` (${stopped} stopped being tracked by this commit)` : ""}; kept on disk, listed by \`hyper space status --json\`: ${leftOut.slice(0, 3).map(quoteForTerminal).join(", ")}${leftOut.length > 3 ? ", …" : ""}\n`,
			);
		}
		// Second line of defence: nothing that is user state may be committed,
		// and `--allow-secret` cannot override it.
		const leftover = indexPaths(root).filter(isClaudeUserStatePath);
		if (leftover.length > 0)
			throw new SpaceGitError(
				`refusing to commit ${escapeControlCharacters(branch)}: ${leftover.map(quoteForTerminal).join(", ")} ` +
					`${leftover.length === 1 ? "is" : "are"} Claude Code user state, which a space never tracks, and could not be removed from the index. Inspect \`hyper space status\` and retry.`,
			);
		const staged = stagedPaths(root);
		const gitlinks = stagedGitlinks(root);
		const nested = [...new Set([...excluded, ...gitlinks])];
		for (const path of gitlinks) {
			// -f is only for removing an index gitlink differing from disk and HEAD;
			// it never deletes work-tree files and is never used for publication.
			spaceGit(root, ["rm", "--cached", "-q", "-f", "--", `:(literal)${path}`]);
		}
		for (const path of nested) {
			reportWarning(
				`warning: ${escapeControlCharacters(path)} contains its own git repository; its files are not saved in the space.\n`,
			);
		}
		if (nested.length > 0) staged.splice(0, staged.length, ...stagedPaths(root));
		// Every other machine refuses an incoming tree with a control character
		// in a path (the refusal could not even name it safely), so committing
		// one here would only break their next pull. The whole index is the
		// tree that would be published, so a name committed earlier counts too.
		// Format characters (bidi, ZWJ) stay legal: they are escaped on output.
		const unsafeNames = spaceGit(root, ["ls-files", "-z"])
			.stdout.split("\0")
			.filter((path) => /\p{Cc}/u.test(path));
		if (unsafeNames.length > 0)
			throw new SpaceGitError(
				`refusing to commit ${escapeControlCharacters(branch)}: ${unsafeNames.map(quoteForTerminal).join(", ")} ` +
					`${unsafeNames.length === 1 ? "has a control character in its name" : "have control characters in their names"}, ` +
					"and every other machine would refuse to pull it. Rename " +
					`${unsafeNames.length === 1 ? "it" : "them"} without the control character, then ${caller === "init" ? "rerun `hyper space init`" : "commit again"}.`,
			);
		const inspection = await inspectStagedFiles(root, staged, allowSecrets);
		const { secrets, allowedSecrets, largeFiles } = inspection;
		for (const path of allowedSecrets)
			reportWarning(
				`warning: allowing secret path ${quoteForTerminal(path)} as explicitly requested.\n`,
			);
		for (const path of largeFiles)
			reportWarning(
				`warning: ${quoteForTerminal(path)} is above 50 MB; committing it will make this space's history larger.\n`,
			);
		if (secrets.length > 0) {
			throw new Error(
				`refusing to commit ${escapeControlCharacters(branch)}: ${secrets.map(escapeControlCharacters).join(", ")} ` +
					`${secrets.length === 1 ? "matches" : "match"} the secret guard (a .env, a key, a ` +
					`credentials file). Move ${secrets.length === 1 ? "it" : "them"} out of the space, or ` +
					`keep ${secrets.length === 1 ? "it" : "them"} out of the allowlist.` +
					(caller === "init"
						? " Then rerun `hyper space init`."
						: " For an intentional exception, use `hyper space commit --allow-secret <exact-path>`."),
			);
		}
		const unborn =
			spaceGit(root, ["rev-parse", "--verify", "HEAD"], { allowFailure: true }).status !== 0;
		if (staged.length > 0) {
			const commit = spaceGit(
				root,
				["-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", "commit", "-m", message],
				{ allowFailure: true },
			);
			if (commit.status !== 0) {
				const detail = (commit.stderr || commit.stdout).trim();
				throw new Error(
					/please tell me who you are|no (?:name|email) was given|empty ident|unable to auto-detect email|identity unknown/i.test(
						detail,
					)
						? `git has no identity to commit ${escapeControlCharacters(branch)} with. Set one and run this again: ` +
								`\n\n  git config --global user.name "Your Name"\n  git config --global user.email "you@example.com"\n`
						: `the commit of ${escapeControlCharacters(branch)} failed. ${caller === "init" ? "Fix the cause and rerun `hyper space init`" : "Inspect `hyper space status` and retry"}: ${gitSaid(detail)}`,
				);
			}
		} else if (unborn) {
			reportWarning(
				`warning: the allowlist matched no files in ${escapeControlCharacters(root)}, so there is nothing to commit and no branch to push.\n`,
			);
		}
		return {
			committed: staged.length,
			unborn: unborn && staged.length === 0,
			skipped: nested,
			allowedSecrets,
			largeFiles,
		};
	} catch (error) {
		// Init owns interruption rollback, including repeated signals during cleanup.
		if (caller === "init" && error instanceof SpaceGitInterruptedError) throw error;
		// Refusal must not leave staged secrets behind. Keep work-tree files intact.
		try {
			spaceGit(root, ["reset", "--quiet"]);
		} catch (cleanup) {
			throw new SpaceGitError(
				`The commit was refused, but the index could not be cleared. Inspect it before retrying: ${cleanup instanceof Error ? cleanup.message : String(cleanup)}`,
			);
		}
		throw error;
	}
}

/** A plain, explicit branch push; never rewrites remote history. */
/** What a push may publish that its own guard would otherwise refuse. */
export interface PushAllowances {
	/** Exact paths of intentionally committed secrets (as `commit --allow-secret`). */
	allowSecrets?: string[];
	/** Publish commits that hold Claude user state anyway. Loud, never a default. */
	allowUserStateHistory?: boolean;
}

/**
 * The commits a push would publish (what the last-seen remote tip lacks) that
 * ADD or CHANGE Claude user state or a secret-looking path (review of PR #54,
 * N2): commits made by an older hyper or by plain git, which the commit-time
 * guards never saw. Each with the offending paths.
 */
export function outgoingProblems(
	root: string,
	sha: string,
	allow: PushAllowances = {},
	published: string[] = publishedTips(root),
): { commit: string; userState: string[]; secrets: string[] }[] {
	const range = [sha, "--not", ...published];
	const commits = spaceGit(root, ["rev-list", ...range])
		.stdout.split("\n")
		.filter(Boolean);
	const problems: { commit: string; userState: string[]; secrets: string[] }[] = [];
	for (const commit of commits) {
		const fields = spaceGit(root, [
			"diff-tree",
			"-r",
			"--root",
			"--no-commit-id",
			"--no-renames",
			"--name-status",
			"-z",
			commit,
		]).stdout.split("\0");
		const added: string[] = [];
		for (let i = 0; i + 1 < fields.length; i += 2)
			if (/^[AMT]/.test(fields[i])) added.push(fields[i + 1]);
		const userState = allow.allowUserStateHistory ? [] : added.filter(isClaudeUserStatePath);
		const secrets = findSecretPaths(
			added.filter((path) => !isClaudeUserStatePath(path)),
			allow.allowSecrets ?? [],
		);
		if (userState.length + secrets.length > 0) problems.push({ commit, userState, secrets });
	}
	return problems;
}

/**
 * What this machine knows the hyperdrive already has: every `origin`
 * remote-tracking ref. A fallback only: the push asks the remote itself first.
 */
function publishedTips(root: string): string[] {
	const tips = spaceGit(root, ["for-each-ref", "--format=%(objectname)", "refs/remotes/origin/"])
		.stdout.split("\n")
		.filter(Boolean);
	return [...new Set(tips)];
}

/** Is `ancestor` a commit this machine has, reachable from `sha`? */
function isLocalAncestor(root: string, ancestor: string, sha: string): boolean {
	const has = spaceGit(root, ["cat-file", "-e", `${ancestor}^{commit}`], { allowFailure: true });
	if (has.status !== 0) return false;
	return (
		spaceGit(root, ["merge-base", "--is-ancestor", ancestor, sha], { allowFailure: true })
			.status === 0
	);
}

/**
 * A push refused because unpushed commits hold user state or secrets. `summary`
 * is one readable line (reason and paths) for the session-end log and
 * `space status`; the message has the full steps.
 */
export class UnsafeOutgoingError extends SpaceGitError {
	readonly summary: string;
	constructor(message: string, summary: string) {
		super(message);
		this.name = "UnsafeOutgoingError";
		this.summary = summary;
	}
}

/**
 * Refuse a push whose outgoing range publishes user state or a secret, saying
 * how to fix it (review of PR #54, N2, R3). What is unpushed is decided from
 * the REMOTE itself (`ls-remote`): the remote's tip and its ancestry are
 * excluded when this machine has it, so missing tracking refs cannot make a
 * published commit look new, and the printed fix never rewrites a commit the
 * remote already has. Unreachable remote: the tracking refs stand in (the push
 * fails right after anyway).
 */
function refuseUnsafeOutgoing(
	root: string,
	remote: string,
	sha: string,
	branch: string,
	allow: PushAllowances,
	asked?: { tip: string | null | undefined },
): void {
	let remoteTip: string | null | undefined = asked?.tip;
	if (asked === undefined) {
		try {
			remoteTip = remoteSha(root, remote, branch);
		} catch {
			remoteTip = undefined;
		}
	}
	const known =
		remoteTip !== undefined && remoteTip !== null && isLocalAncestor(root, remoteTip, sha);
	const published =
		remoteTip === null
			? []
			: known
				? [remoteTip as string, ...publishedTips(root)]
				: publishedTips(root);
	const problems = outgoingProblems(root, sha, allow, published);
	if (problems.length === 0) return;
	const lines = problems.slice(0, 5).map(({ commit, userState, secrets }) => {
		const paths = [...userState, ...secrets];
		return `  ${commit.slice(0, 12)}: ${paths.slice(0, 4).map(quoteForTerminal).join(", ")}${paths.length > 4 ? `, … (${paths.length} paths)` : ""}`;
	});
	const allPaths = [
		...new Set(problems.flatMap(({ userState, secrets }) => [...userState, ...secrets])),
	];
	const fix =
		remoteTip === null
			? "Nothing of this branch is on the hyperdrive yet. To publish without it, start the branch's history over from your files (they are not touched):\n\n" +
				"  git --git-dir=.hyper/space.git --work-tree=. update-ref -d HEAD\n" +
				`  hyper space commit -m "<message>"\n  hyper space push\n\n`
			: known
				? "The content is only in this machine's history so far. To publish without it, fold the unpushed commits into one new commit (your files are not touched):\n\n" +
					`  git --git-dir=.hyper/space.git --work-tree=. reset --soft ${(remoteTip as string).slice(0, 12)}\n` +
					`  hyper space commit -m "<message>"\n  hyper space push\n\n`
				: "The hyperdrive has commits this machine does not (or could not be reached): run `hyper space pull` first, then push again to see the exact fix.\n\n";
	throw new UnsafeOutgoingError(
		`refusing to push ${escapeControlCharacters(branch)}: ${problems.length === 1 ? "a commit" : `${problems.length} commits`} not yet on the hyperdrive add Claude user state or secret-looking files (made by an older hyper or by plain git), and pushing would publish them:\n${lines.join("\n")}${problems.length > 5 ? "\n  …" : ""}\n` +
			fix +
			"`hyper space commit` leaves the user state out and refuses secrets again. To publish them anyway, `hyper space push --allow-user-state-history` (user state) or `--allow-secret <path>` (one intentional secret).",
		`push refused: ${problems.length} unpushed commit${problems.length === 1 ? "" : "s"} add Claude user state or secret-looking files (${allPaths.slice(0, 5).join(", ")}${allPaths.length > 5 ? ", …" : ""}); run \`hyper space push\` for the fix`,
	);
}

export function pushSpace(
	root: string,
	remote: string,
	branch: string,
	caller: "init" | "daily" = "daily",
	allow: PushAllowances = {},
): void {
	// The push reads the branch tip and then records it as the tracking ref.
	// Serialised with commits, a push always publishes the newest local tip:
	// two unserialised pushes could land newest-first and the older one would
	// then be reported as "another machine pushed first".
	withSpaceLock(root, `push ${branch}`, () => {
		const sha = spaceGit(root, ["rev-parse", `refs/heads/${branch}`]).stdout.trim();
		refuseUnsafeOutgoing(root, remote, sha, branch, allow);
		spaceGitRemote(root, remote, ["push", "origin", `${sha}:refs/heads/${branch}`], branch, caller);
		// Legacy init wrote no fetch refspec: Git cannot update a tracking ref for it.
		// Record exactly the immutable SHA handed to the successful push, even there.
		spaceGit(root, ["update-ref", `refs/remotes/origin/${branch}`, sha]);
	});
}

/** Overall limit on a session-end push, connection included. */
export const SESSION_END_PUSH_TIMEOUT_MS = 30_000;

/**
 * `pushSpace` for the detached session-end worker: never on a terminal (ssh
 * BatchMode, connect timeout) and killed, with its whole process group, when
 * `timeoutMs` runs out. The local commit is untouched either way.
 */
export async function pushSpaceBounded(
	root: string,
	remote: string,
	branch: string,
	timeoutMs: number = SESSION_END_PUSH_TIMEOUT_MS,
	lock: SpaceLockOptions = {},
): Promise<void> {
	await withSpaceLock(
		root,
		`push ${branch}`,
		async () => {
			const sha = spaceGit(root, ["rev-parse", `refs/heads/${branch}`]).stdout.trim();
			const started = Date.now();
			const timedOut = (): SpaceGitError =>
				new SpaceGitError(
					`the push to ${escapeControlCharacters(remote)} did not finish within ${Math.round(timeoutMs / 1000)} s, so I stopped it. The commit is saved locally and will be pushed next time.`,
				);
			// What the remote has, asked within the SAME bound as the push: a host
			// that never answers must not hold the session-end worker past it.
			const asked = await spaceGitBounded(
				root,
				["ls-remote", remote, `refs/heads/${branch}`],
				timeoutMs,
			);
			if (asked.timedOut) throw timedOut();
			const first = asked.status === 0 ? (asked.stdout.split("\n")[0] ?? "").trim() : undefined;
			// The session-end worker never passes allowances: a refusal is
			// logged and shown by `hyper space status`.
			refuseUnsafeOutgoing(
				root,
				remote,
				sha,
				branch,
				{},
				{
					tip:
						first === undefined
							? undefined
							: first === ""
								? null
								: (first.split("\t")[0] ?? "").trim(),
				},
			);
			const args = ["push", "origin", `${sha}:refs/heads/${branch}`];
			const remaining = Math.max(1_000, timeoutMs - (Date.now() - started));
			const result = await spaceGitBounded(root, args, remaining);
			if (result.timedOut)
				throw new SpaceGitError(
					`the push to ${escapeControlCharacters(remote)} did not finish within ${Math.round(timeoutMs / 1000)} s, so I stopped it. The commit is saved locally and will be pushed next time.`,
				);
			if (result.status !== 0)
				throw pushFailure(remote, (result.stderr || result.stdout).trim(), args, branch, "daily");
			spaceGit(root, ["update-ref", `refs/remotes/origin/${branch}`, sha]);
		},
		lock,
	);
}

/** Init/refresh publication, with callbacks preserving the caller's rollback boundary. */
export async function commitAndPushSpace(
	root: string,
	name: string,
	branch: string,
	remote: string,
	onCommitted: (files: number) => void,
	beforePush: () => void,
	pushCaller: "init" | "daily" = "init",
): Promise<SpaceCommitResult & { upToDate: boolean }> {
	const result = await commitSpace(root, branch, `space: init ${name}`, [], "init");
	// Tell rollback a commit exists before anything can fail during publication.
	if (result.committed > 0) onCommitted(result.committed);
	if (result.unborn) return { ...result, upToDate: true };
	const head = spaceGit(root, ["rev-parse", "HEAD"], { allowFailure: true }).stdout.trim();
	const publishedBefore = remoteSha(root, remote, branch);
	beforePush();
	// Publish whenever HEAD exists, even with an empty index: a previous push may
	// have failed after committing, and an unchanged refresh must still retry it.
	pushSpace(root, remote, branch, pushCaller);
	return { ...result, upToDate: head !== "" && head === publishedBefore };
}
