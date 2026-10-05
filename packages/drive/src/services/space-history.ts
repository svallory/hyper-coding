/** Day-to-day space history. No manifest writes and no implicit network reads. */
import { lstatSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { escapeControlCharacters, quoteForTerminal } from "#lib/terminal-text";
import { isClaudeUserStatePath, renderGitignore } from "#services/allowlist";
import { lastSessionEndFailure } from "#services/session-end-log";
import { detectSpace } from "#services/space";
import {
	finishInterruptedPull,
	gitSaid,
	hasSpaceGit,
	type ReviewPathFacts,
	readCadence,
	readSpaceConfig,
	readTracked,
	SpaceGitError,
	SpaceGitInterruptedError,
	SpaceRefusedError,
	spaceGit,
	spaceGitDir,
	writeTracked,
} from "#services/space-git";
import { incomingReview, validateIncomingSpace } from "#services/space-incoming";
import { withSpaceLock } from "#services/space-lock";

export interface InitializedSpace {
	root: string;
	branch: string;
}

/** Resolve the enclosing space, refusing missing, unfinished or detached history. */
export function requireInitializedSpace(dir = process.cwd()): InitializedSpace {
	const info = detectSpace(dir);
	if (info.root === null || info.layout === null) {
		throw new SpaceGitError(
			`${escapeControlCharacters(dir)} is not inside a hyper space. Change to a space directory, then run \`hyper space init\`.`,
		);
	}
	const root = info.root;
	if (!hasSpaceGit(root))
		throw new SpaceGitError(
			`${escapeControlCharacters(root)} is not initialised for hyperdrive. Run \`hyper space init\` first.`,
		);
	if (readSpaceConfig(root, "core.worktree") !== "../..") {
		throw new SpaceGitError(
			`The space git dir does not point at this space. Repair its core.worktree before running \`hyper space init\`.`,
		);
	}
	if (
		spaceGit(root, ["rev-parse", "--verify", "HEAD^{commit}"], { allowFailure: true }).status !== 0
	) {
		throw new SpaceGitError(
			`This space has unfinished initialisation or an unreadable HEAD. Rerun \`hyper space init\` to finish it; repair damaged history first.`,
		);
	}
	const symbolic = spaceGit(root, ["symbolic-ref", "-q", "HEAD"], { allowFailure: true });
	const ref = symbolic.stdout.trim();
	if (symbolic.status !== 0 || !ref.startsWith("refs/heads/space/")) {
		throw new SpaceGitError(
			`This space is not on its space branch. Restore its original space/<name> branch before trying again.`,
		);
	}
	const branch = ref.slice("refs/heads/".length);
	if (readSpaceConfig(root, `branch.${branch}.merge`) !== ref)
		throw new SpaceGitError(
			`HEAD is not this space's recorded branch. Restore its original branch and upstream before trying again.`,
		);
	return { root, branch };
}

export function spaceRemote(root: string): string {
	const remote = readSpaceConfig(root, "remote.origin.url");
	if (!remote)
		throw new SpaceGitError(
			`This space has no origin remote. Restore remote.origin.url in its git config, then retry.`,
		);
	return remote;
}

/** Keep Node alive for process-group signals so the git child's signal yields exit 130. */
export async function withSpaceSignals<T>(action: () => T | Promise<T>): Promise<T> {
	// Synchronous children block callbacks: only the child's signal is reliable.
	// Keep listeners scoped across asynchronous batch readers as well.
	const onInt = () => {};
	const onTerm = () => {};
	process.on("SIGINT", onInt);
	process.on("SIGTERM", onTerm);
	try {
		return await action();
	} catch (error) {
		if (error instanceof SpaceGitInterruptedError) {
			throw new SpaceGitInterruptedError(
				error.signal,
				"interrupted: inspect `hyper space status` before retrying. Local files and any completed commit were kept; publication may be unconfirmed.",
			);
		}
		throw error;
	} finally {
		process.off("SIGINT", onInt);
		process.off("SIGTERM", onTerm);
	}
}

function trackingRef(branch: string): string {
	return `refs/remotes/origin/${branch}`;
}

/** Fetch only this space; explicit mapping also supports old git dirs without a fetch refspec. */
export function fetchSpace(root: string, branch: string): void {
	const remote = spaceRemote(root);
	const result = spaceGit(
		root,
		[
			"fetch",
			"--no-tags",
			"--no-recurse-submodules",
			"origin",
			`+refs/heads/${branch}:${trackingRef(branch)}`,
		],
		{ allowFailure: true },
	);
	if (result.status !== 0) {
		const detail = (result.stderr || result.stdout).trim();
		if (/couldn't find remote ref/i.test(detail))
			throw new SpaceGitError(
				`Your hyperdrive has no ${escapeControlCharacters(branch)} to fetch. Run \`hyper space push\` to publish the local branch.`,
			);
		throw new SpaceRefusedError(
			"unreachable",
			`I couldn't reach your hyperdrive at ${escapeControlCharacters(remote)} to fetch ${escapeControlCharacters(branch)}. Check the remote and your network, then retry. git said: ${gitSaid(detail)}`,
		);
	}
}

export interface IncomingTrackedEntry {
	path: string;
	localFiles: number;
}
/** The step boundaries of an index-only fast-forward (`advanceKeepingUserState`). */
export type PullStep = "base" | "untracked" | "read-tree";

export interface SpacePullOptions {
	acceptTracked?: boolean;
	confirmTracked?: (entries: IncomingTrackedEntry[]) => Promise<boolean>;
	/**
	 * Called after each step of an index-only fast-forward. Injected by tests
	 * (to stop the process exactly there); never set by a command, and not
	 * reachable through the environment.
	 */
	onStep?: (step: PullStep) => void;
}
export interface SpacePullResult {
	updated: boolean;
	reviewPaths: string[];
	/** Per-path risk facts for the text report; never part of `--json`. */
	reviewFacts?: Map<string, ReviewPathFacts>;
	addedTracked: IncomingTrackedEntry[];
	allowlistRestored: boolean;
	/**
	 * Claude user-state files the incoming history stops tracking that this
	 * machine has on disk: untracked here first, so the fast-forward kept them
	 * byte for byte (review of PR #54, N1).
	 */
	userStateKept?: string[];
	/** Local commits dropped because they only stopped tracking user state too. */
	droppedUserStateCommits?: number;
}

/**
 * Fast-forward `branch` from `before` to `tip` when the range stops tracking
 * Claude user state, WITHOUT touching those working files (review of PR #54,
 * R1). Index-only, step by step, each safe to stop after:
 *
 *  1. Build `base`: HEAD's tree minus the user-state paths, in a temporary
 *     index (the real index is not involved).
 *  2. Untrack the paths in the real index (`rm --cached`): working files
 *     untouched; stopping here leaves staged deletions and the files in place.
 *  3. `read-tree -m -u base tip`: a two-way merge from `base`, in which the
 *     user-state paths exist on neither side, so git has no reason to look at
 *     them (proven for clean, edited, and content-and-mode-differs files).
 *     Everything else moves exactly as a fast-forward would: an edit to a path
 *     the tip changes is refused, one to a path it does not change is kept,
 *     ignored files are not overwritten.
 *  4. `update-ref` the branch from `before` to `tip`.
 *
 * On a refusal in step 3 the index entries from step 2 are put back from HEAD
 * (index only), so the space is exactly as before. A rerun after a stop at any
 * step converges: the paths are already untracked, or the index is already the
 * tip's. Returns git's result for step 3, like the merge it replaces.
 */
function advanceKeepingUserState(
	root: string,
	branch: string,
	before: string,
	tip: string,
	userState: string[],
	onStep: (step: PullStep) => void = () => {},
): ReturnType<typeof spaceGit> {
	const literal = userState.map((path) => `:(literal)${path}`);
	const indexFile = join(spaceGitDir(root), `hyper-pull-base-${process.pid}-${Date.now()}.index`);
	let base: string;
	try {
		spaceGit(root, ["read-tree", before], { indexFile });
		for (let i = 0; i < literal.length; i += 500)
			spaceGit(
				root,
				["rm", "--cached", "-q", "--ignore-unmatch", "--", ...literal.slice(i, i + 500)],
				{
					indexFile,
				},
			);
		base = spaceGit(root, ["write-tree"], { indexFile }).stdout.trim();
	} finally {
		rmSync(indexFile, { force: true });
		rmSync(`${indexFile}.lock`, { force: true });
	}
	onStep("base");
	for (let i = 0; i < literal.length; i += 500)
		spaceGit(root, [
			"rm",
			"--cached",
			"-q",
			"--ignore-unmatch",
			"--",
			...literal.slice(i, i + 500),
		]);
	onStep("untracked");
	const merged = spaceGit(root, ["read-tree", "-m", "-u", base, tip], { allowFailure: true });
	if (merged.status !== 0) {
		// Back to exactly the state before the pull: the index entries from HEAD
		// (index only; the working files were never touched).
		for (let i = 0; i < literal.length; i += 500)
			spaceGit(root, ["reset", "-q", before, "--", ...literal.slice(i, i + 500)], {
				allowFailure: true,
			});
		return merged;
	}
	onStep("read-tree");
	spaceGit(root, ["update-ref", `refs/heads/${branch}`, tip, before]);
	return merged;
}

/** `name-status` of `a..b` (or one commit's own changes), as status/path pairs. */
function treeChanges(root: string, args: string[]): { status: string; path: string }[] {
	const fields = spaceGit(root, [
		"diff-tree",
		"-r",
		"--no-renames",
		"--name-status",
		"-z",
		...args,
	]).stdout.split("\0");
	const changes: { status: string; path: string }[] = [];
	for (let i = 0; i + 1 < fields.length; i += 2) {
		if (/^[A-Z]/.test(fields[i])) changes.push({ status: fields[i], path: fields[i + 1] });
	}
	return changes;
}

/**
 * Local commits on top of `base` that do nothing but stop tracking Claude user
 * state (what the first commit on a current hyper does), when the index has
 * nothing staged: such a local history and an incoming one that did the same
 * are not a real divergence. Returns how many, or 0 when they are not all so.
 */
function userStateOnlyLocalCommits(root: string, base: string, head: string): number {
	if (spaceGit(root, ["diff", "--cached", "--quiet", "HEAD"], { allowFailure: true }).status !== 0)
		return 0;
	const commits = spaceGit(root, ["rev-list", `${base}..${head}`])
		.stdout.split("\n")
		.filter(Boolean);
	if (commits.length === 0) return 0;
	for (const commit of commits) {
		const changes = treeChanges(root, ["--no-commit-id", commit]);
		if (changes.length === 0) return 0;
		if (!changes.every((change) => change.status === "D" && isClaudeUserStatePath(change.path)))
			return 0;
	}
	return commits.length;
}

function clearRefusal(root: string): void {
	for (const key of ["hyper.refusedTip", "hyper.refusedReason"]) {
		const result = spaceGit(root, ["config", "--local", "--unset-all", key], {
			allowFailure: true,
		});
		if (result.status !== 0 && result.status !== 5)
			throw new SpaceGitError(`Could not clear the last pull refusal: ${gitSaid(result.stderr)}`);
	}
}

/** Fast-forward only. The tracking ref means last SEEN, not last accepted. */
export async function pullSpace(
	root: string,
	branch: string,
	options: SpacePullOptions = {},
): Promise<SpacePullResult> {
	fetchSpace(root, branch);
	// The fast-forward rewrites the index and work tree, and the refusal record
	// is config the next commit reads: hold the space lock so a session-end
	// commit cannot stage or reset the index under the merge. The fetch above
	// only updates the tracking ref and is left outside, so a slow network does
	// not keep commits waiting.
	return withSpaceLock(root, `fast-forward ${branch}`, () =>
		pullSpaceLocked(root, branch, options),
	);
}

async function pullSpaceLocked(
	root: string,
	branch: string,
	options: SpacePullOptions,
): Promise<SpacePullResult> {
	// A pull stopped between its index update and its branch update: finish
	// it before comparing histories (review of PR #54, M1).
	finishInterruptedPull(root, branch);
	// Only a fetch that actually reached the hyperdrive may clear the record of
	// a refusal: an unreachable remote has said nothing new about that tip.
	clearRefusal(root);
	const target = spaceGit(root, [
		"rev-parse",
		"--verify",
		`${trackingRef(branch)}^{commit}`,
	]).stdout.trim();
	const unchanged: SpacePullResult = {
		updated: false,
		reviewPaths: [],
		addedTracked: [],
		allowlistRestored: false,
	};
	try {
		let before = spaceGit(root, ["rev-parse", "HEAD"]).stdout.trim();
		if (before === target) return unchanged;
		const isAncestor = (a: string, b: string): boolean => {
			const result = spaceGit(root, ["merge-base", "--is-ancestor", a, b], { allowFailure: true });
			if (result.status > 1)
				throw new SpaceGitError(
					`I couldn't compare this space's histories. Inspect \`hyper space log\` before retrying. ${gitSaid(result.stderr)}`,
				);
			return result.status === 0;
		};
		if (isAncestor(target, before)) return unchanged;
		let droppedUserStateCommits = 0;
		if (!isAncestor(before, target)) {
			// Both machines upgraded and each committed the untracking of the
			// same user state: drop the local commits that did only that (mixed
			// reset: the work tree is not touched), then fast-forward as usual.
			const base = spaceGit(root, ["merge-base", before, target], {
				allowFailure: true,
			}).stdout.trim();
			droppedUserStateCommits = base ? userStateOnlyLocalCommits(root, base, before) : 0;
			if (droppedUserStateCommits > 0) {
				spaceGit(root, ["reset", "-q", base]);
				before = base;
			}
		}
		if (!isAncestor(before, target)) {
			throw new SpaceRefusedError(
				"diverged",
				`The local and remote histories of ${escapeControlCharacters(branch)} have diverged. Nothing was merged or rebased; your local history and files were kept. Inspect \`hyper space log\` and reconcile the histories manually before retrying.`,
			);
		}
		const incoming = await validateIncomingSpace(root, target, before);
		// Never let the fast-forward delete Claude user state from this disk
		// (review of PR #54, N1 and R1): a peer's first commit on a current
		// hyper stops tracking it, and applying that deletion here would remove
		// this machine's transcripts. Those paths are advanced through the
		// INDEX only (`advanceKeepingUserState`): no working file is ever moved,
		// copied or removed, so no signal or crash can strand one.
		const userStateDeleted = treeChanges(root, [before, incoming.tip])
			.filter((change) => change.status === "D" && isClaudeUserStatePath(change.path))
			.map((change) => change.path);
		const userStateKept = userStateDeleted.filter(
			(path) => lstatSync(join(root, path), { throwIfNoEntry: false }) !== undefined,
		);

		const local = readTracked(root);
		const added = incoming.tracked.filter((entry) => !local.includes(entry));
		const ignored =
			added.length === 0
				? []
				: spaceGit(root, [
						"--literal-pathspecs",
						"ls-files",
						"--others",
						"--ignored",
						"--exclude-standard",
						"-z",
						"--",
						...added,
					])
						.stdout.split("\0")
						.filter((path) => path && !path.endsWith("/"));
		const addedTracked = added.map((path) => ({
			path,
			localFiles: ignored.filter((file) => file.startsWith(`${path}/`)).length,
		}));
		if (
			addedTracked.length > 0 &&
			!options.acceptTracked &&
			!(await options.confirmTracked?.(addedTracked))
		) {
			throw new SpaceRefusedError(
				"consent-required",
				`Incoming tracked entries would broaden what this machine uploads:\n${addedTracked.map((entry) => `  ${quoteForTerminal(entry.path)}: ${entry.localFiles} local files would become eligible for commit`).join("\n")}\nNothing was merged. Review these paths, then run \`hyper space pull --accept-tracked\` to consent.`,
			);
		}
		const retained = local.filter((entry) => !incoming.tracked.includes(entry));
		const union = [...incoming.tracked, ...retained];
		const rendered = renderGitignore(union);
		if (
			retained.length > 0 &&
			spaceGit(root, ["diff", "--quiet", "HEAD", "--", ".gitignore"], { allowFailure: true })
				.status !== 0
		)
			throw new SpaceGitError(
				`Local .gitignore changes would be overwritten while preserving this machine's tracked entries. Commit them with \`hyper space commit\` (or move them aside) before retrying.`,
			);
		const review = await incomingReview(root, incoming.tip, before);
		const result =
			userStateDeleted.length === 0
				? spaceGit(
						root,
						[
							"-c",
							"merge.verifySignatures=false",
							"-c",
							"submodule.recurse=false",
							"merge",
							"--ff-only",
							"--no-overwrite-ignore",
							"--no-autostash",
							incoming.tip,
						],
						{ allowFailure: true },
					)
				: advanceKeepingUserState(
						root,
						branch,
						before,
						incoming.tip,
						userStateDeleted,
						options.onStep,
					);
		if (result.status !== 0) {
			const detail = (result.stderr || result.stdout).trim();
			if (userStateDeleted.length > 0 && /would lose untracked files in it/i.test(detail)) {
				throw new SpaceRefusedError(
					"local-changes",
					`The incoming history of ${escapeControlCharacters(branch)} replaces a directory that holds this machine's Claude user state with a file. Nothing was changed, and your files are where they were: ${userStateKept.slice(0, 3).map(quoteForTerminal).join(", ")}. Move that directory aside, then pull again. git said: ${gitSaid(detail)}`,
				);
			}
			if (
				/would be overwritten|would lose untracked files|not uptodate|local changes|untracked working tree/i.test(
					detail,
				)
			) {
				throw new SpaceRefusedError(
					"local-changes",
					`Local changes would be overwritten by the fast-forward of ${escapeControlCharacters(branch)}. Move those files aside or back them up before retrying; ignored paths cannot be saved by \`hyper space commit\`. git said: ${gitSaid(detail)}`,
				);
			}
			throw new SpaceGitError(
				`I couldn't fast-forward ${escapeControlCharacters(branch)}; no merge or rebase was requested. Inspect \`hyper space status\` before retrying. git said: ${gitSaid(detail)}`,
			);
		}
		writeTracked(root, union);
		if (retained.length > 0) writeFileSync(join(root, ".gitignore"), rendered);
		return {
			updated: true,
			reviewPaths: review.paths,
			reviewFacts: review.facts,
			addedTracked,
			allowlistRestored: retained.length > 0,
			userStateKept,
			droppedUserStateCommits,
		};
	} catch (error) {
		const reason = (error instanceof Error ? error.message : String(error))
			.replace(/\p{Cc}/gu, " ")
			.replace(/\s+/g, " ")
			.trim();
		spaceGit(root, ["config", "--local", "hyper.refusedTip", target]);
		spaceGit(root, ["config", "--local", "hyper.refusedReason", reason]);
		throw error;
	}
}

export interface SpaceStatusEntry {
	code: string;
	path: string;
	originalPath?: string;
}

/** Parse porcelain's NUL records, including the second path of renames/copies. */
export function spaceStatus(root: string, branch: string) {
	const records = spaceGit(root, [
		"status",
		"--porcelain=v1",
		"-z",
		"--untracked-files=all",
	]).stdout.split("\0");
	const status: SpaceStatusEntry[] = [];
	const userState: string[] = [];
	for (let index = 0; index < records.length; index++) {
		const record = records[index];
		if (!record) continue;
		const entry: SpaceStatusEntry = { code: record.slice(0, 2), path: record.slice(3) };
		if (/[RC]/.test(entry.code)) entry.originalPath = records[++index];
		// Claude user state is never tracked: not "untracked noise" in every
		// status, but one count in its own field (review of PR #54, N3).
		if (entry.code === "??" && isClaudeUserStatePath(entry.path)) userState.push(entry.path);
		else status.push(entry);
	}
	const ref = trackingRef(branch);
	const tracking = spaceGit(root, ["rev-parse", "--verify", `${ref}^{commit}`], {
		allowFailure: true,
	});
	const upstreamKnown = tracking.status === 0;
	const refusedTip = readSpaceConfig(root, "hyper.refusedTip");
	const refusedReason = readSpaceConfig(root, "hyper.refusedReason");
	const refused =
		upstreamKnown && tracking.stdout.trim() === refusedTip && refusedReason !== null
			? { tip: refusedTip, reason: refusedReason }
			: null;
	let ahead: number | null = null;
	let behind: number | null = null;
	if (upstreamKnown) {
		const counts = spaceGit(root, ["rev-list", "--left-right", "--count", `HEAD...${ref}`])
			.stdout.trim()
			.split(/\s+/)
			.map(Number);
		[ahead, behind] = counts as [number, number];
	}
	return {
		root,
		branch,
		cadence: readCadence(root),
		upstreamKnown,
		ahead,
		behind,
		status,
		/** Claude user-state files on disk; never tracked, not listed in `status`. */
		userState,
		refused,
		// The detached SessionEnd worker cannot print to the session it outlives;
		// its last result is surfaced here when it was a failure.
		sessionEndFailure: lastSessionEndFailure(spaceGitDir(root)),
	};
}

/** Pass through git-log arguments/streams; only ref-expanding options are refused. */
export function logSpace(root: string, branch: string, args: readonly string[]): number {
	const separator = args.indexOf("--");
	const options = separator < 0 ? args : args.slice(0, separator);
	const expanding = new Set([
		"--all",
		"--branches",
		"--tags",
		"--remotes",
		"--glob",
		"--exclude",
		"--reflog",
		"-g",
		"--walk-reflogs",
		"--stdin",
		"--alternate-refs",
		"--bisect",
	]);
	for (const arg of options) {
		if (expanding.has(arg.split("=")[0]))
			throw new SpaceGitError(
				`${escapeControlCharacters(arg)} expands beyond this space's branch; omit it from \`hyper space log\`.`,
			);
	}
	// Let git recognise positional revisions, including ranges and exclusions.
	const revisions = spaceGit(root, ["rev-parse", "--revs-only", ...options], {
		allowFailure: true,
	});
	const hasRevision = revisions.stdout
		.split("\n")
		.some((line) => /^\^?[0-9a-f]{40,64}$/.test(line));
	const forwarded = [...args];
	if (!hasRevision)
		forwarded.splice(separator < 0 ? forwarded.length : separator, 0, `refs/heads/${branch}`);
	const result = spaceGit(root, ["log", ...forwarded], { allowFailure: true, inheritStdio: true });
	return result.signal === "SIGPIPE" ? 0 : result.status;
}
