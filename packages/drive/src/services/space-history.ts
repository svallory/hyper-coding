/** Day-to-day space history. No manifest writes and no implicit network reads. */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { escapeControlCharacters, quoteForTerminal } from "#lib/terminal-text";
import { renderGitignore } from "#services/allowlist";
import { detectSpace } from "#services/space";
import {
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
	writeTracked,
} from "#services/space-git";
import { incomingReview, validateIncomingSpace } from "#services/space-incoming";

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
export interface SpacePullOptions {
	acceptTracked?: boolean;
	confirmTracked?: (entries: IncomingTrackedEntry[]) => Promise<boolean>;
}
export interface SpacePullResult {
	updated: boolean;
	reviewPaths: string[];
	/** Per-path risk facts for the text report; never part of `--json`. */
	reviewFacts?: Map<string, ReviewPathFacts>;
	addedTracked: IncomingTrackedEntry[];
	allowlistRestored: boolean;
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
		const before = spaceGit(root, ["rev-parse", "HEAD"]).stdout.trim();
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
		if (!isAncestor(before, target)) {
			throw new SpaceRefusedError(
				"diverged",
				`The local and remote histories of ${escapeControlCharacters(branch)} have diverged. Nothing was merged or rebased; your local history and files were kept. Inspect \`hyper space log\` and reconcile the histories manually before retrying.`,
			);
		}
		const incoming = await validateIncomingSpace(root, target, before);
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
		const result = spaceGit(
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
		);
		if (result.status !== 0) {
			const detail = (result.stderr || result.stdout).trim();
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
	for (let index = 0; index < records.length; index++) {
		const record = records[index];
		if (!record) continue;
		const entry: SpaceStatusEntry = { code: record.slice(0, 2), path: record.slice(3) };
		if (/[RC]/.test(entry.code)) entry.originalPath = records[++index];
		status.push(entry);
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
		refused,
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
