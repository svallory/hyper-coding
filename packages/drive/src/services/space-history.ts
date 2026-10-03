/** Day-to-day space history. No manifest writes and no implicit network reads. */
import { detectSpace } from "#services/space";
import {
	hasSpaceGit,
	readCadence,
	readSpaceConfig,
	SpaceGitError,
	SpaceGitInterruptedError,
	spaceGit,
} from "#services/space-git";

export interface InitializedSpace {
	root: string;
	branch: string;
}

/** Resolve the enclosing space, refusing missing, unfinished or detached history. */
export function requireInitializedSpace(dir = process.cwd()): InitializedSpace {
	const info = detectSpace(dir);
	if (info.root === null || info.layout === null) {
		throw new SpaceGitError(
			`${dir} is not inside a hyper space. Change to a space directory, then run \`hyper space init\`.`,
		);
	}
	const root = info.root;
	if (!hasSpaceGit(root))
		throw new SpaceGitError(
			`${root} is not initialised for hyperdrive. Run \`hyper space init\` first.`,
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
	return { root, branch: ref.slice("refs/heads/".length) };
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
export function withSpaceSignals<T>(action: () => T): T {
	let pending: "SIGINT" | "SIGTERM" | null = null;
	const onInt = () => {
		pending = "SIGINT";
	};
	const onTerm = () => {
		pending = "SIGTERM";
	};
	process.on("SIGINT", onInt);
	process.on("SIGTERM", onTerm);
	try {
		const result = action();
		if (pending !== null) throw new SpaceGitInterruptedError(pending);
		return result;
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
			`refs/heads/${branch}:${trackingRef(branch)}`,
		],
		{ allowFailure: true },
	);
	if (result.status !== 0) {
		const detail = (result.stderr || result.stdout).trim();
		if (/couldn't find remote ref/i.test(detail))
			throw new SpaceGitError(
				`Your hyperdrive has no ${branch} to fetch. Run \`hyper space push\` to publish the local branch.`,
			);
		throw new SpaceGitError(
			`I couldn't reach your hyperdrive at ${remote} to fetch ${branch}. Check the remote and your network, then retry. git said: ${detail}`,
		);
	}
}

/** Fast-forward only: never merge or rebase divergent histories. */
export function pullSpace(root: string, branch: string): { updated: boolean } {
	fetchSpace(root, branch);
	const target = spaceGit(root, [
		"rev-parse",
		"--verify",
		`${trackingRef(branch)}^{commit}`,
	]).stdout.trim();
	const before = spaceGit(root, ["rev-parse", "HEAD"]).stdout.trim();
	if (before === target) return { updated: false };
	const isAncestor = (a: string, b: string): boolean => {
		const result = spaceGit(root, ["merge-base", "--is-ancestor", a, b], { allowFailure: true });
		if (result.status > 1)
			throw new SpaceGitError(
				`I couldn't compare this space's histories. Inspect \`hyper space log\` before retrying. ${result.stderr.trim()}`,
			);
		return result.status === 0;
	};
	if (isAncestor(target, before)) return { updated: false };
	if (!isAncestor(before, target)) {
		throw new SpaceGitError(
			`The local and remote histories of ${branch} have diverged. Nothing was merged or rebased; your local history and files were kept. Inspect \`hyper space log\` and reconcile the histories manually before retrying.`,
		);
	}
	const result = spaceGit(
		root,
		["-c", "core.hooksPath=/dev/null", "merge", "--ff-only", "--no-autostash", target],
		{ allowFailure: true },
	);
	if (result.status !== 0) {
		const detail = (result.stderr || result.stdout).trim();
		if (/would be overwritten|not uptodate|local changes|untracked working tree/i.test(detail)) {
			throw new SpaceGitError(
				`Local changes would be overwritten by the fast-forward of ${branch}. Commit them with \`hyper space commit\` or move them aside, then retry. git said: ${detail}`,
			);
		}
		throw new SpaceGitError(
			`I couldn't fast-forward ${branch}; no merge or rebase was requested. Inspect \`hyper space status\` before retrying. git said: ${detail}`,
		);
	}
	return { updated: true };
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
	const upstreamKnown =
		spaceGit(root, ["rev-parse", "--verify", `${ref}^{commit}`], { allowFailure: true }).status ===
		0;
	let ahead: number | null = null;
	let behind: number | null = null;
	if (upstreamKnown) {
		const counts = spaceGit(root, ["rev-list", "--left-right", "--count", `HEAD...${ref}`])
			.stdout.trim()
			.split(/\s+/)
			.map(Number);
		[ahead, behind] = counts as [number, number];
	}
	return { root, branch, cadence: readCadence(root), upstreamKnown, ahead, behind, status };
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
	]);
	for (const arg of options) {
		if (expanding.has(arg.split("=")[0]))
			throw new SpaceGitError(
				`${arg} expands beyond this space's branch; omit it from \`hyper space log\`.`,
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
	return spaceGit(root, ["log", ...forwarded], { allowFailure: true, inheritStdio: true }).status;
}
