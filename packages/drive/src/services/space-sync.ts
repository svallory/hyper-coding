/** Shared staging, publication and remote diagnostics for space history. */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { findSecretPaths } from "#services/allowlist";
import { SpaceGitError, spaceGit } from "#services/space-git";

/** The first matching branch on the remote, or null. */
export function remoteRef(root: string, remote: string, pattern: string): string | null {
	const result = spaceGit(root, ["ls-remote", "--heads", remote, pattern], { allowFailure: true });
	if (result.status !== 0) {
		throw new SpaceGitError(
			`I couldn't reach your hyperdrive at ${remote} to look at its branches: ` +
				`${(result.stderr || result.stdout).trim() || "git ls-remote said nothing"}`,
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
			`I couldn't reach your hyperdrive at ${remote} to look for ${branch}: ` +
				`${(result.stderr || result.stdout).trim() || "git ls-remote said nothing"}`,
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
): void {
	const result = spaceGit(root, [...args], { allowFailure: true });
	if (result.status === 0) return;
	const detail = (result.stderr || result.stdout).trim();
	const what = `push ${branch}`;
	if (/(fetch first|non-fast-forward|stale info|behind its remote)/i.test(detail)) {
		throw new SpacePushRefusedError(
			`${what} was refused: ${remote} has moved on, so another machine pushed this space's branch ` +
				`first. Nothing was overwritten — hyper never rewrites a space's history. Syncing a space ` +
				`from another machine is not available yet.`,
			` Pass \`--name\` with a different name to initialise a new space.`,
		);
	}
	if (/refname conflict|cannot lock ref/i.test(detail)) {
		throw new SpacePushRefusedError(
			`the hyperdrive at ${remote} already has a ref that ${branch} collides with, so it cannot ` +
				`take this branch. That is the same ambiguity the ref-clash check looks for, seen by the ` +
				`server instead: \`space/x\` cannot be both a space and the group holding \`space/x/y\`.`,
			` Pass \`--name\` or \`--group\` to pick a name that does not collide.`,
		);
	}
	if (/\[remote rejected\]|hook declined/i.test(detail)) {
		const reason = hookReason(detail);
		throw new SpacePushRefusedError(
			`the hyperdrive at ${remote} refused to take ${branch}: a server-side hook declined the push. ` +
				`Nothing was overwritten, and retrying will not help until that hook allows it.` +
				(reason === "" ? "" : ` It said: ${reason}`),
		);
	}
	throw new SpaceGitError(
		`I couldn't reach your hyperdrive at ${remote} to ${what}: ${detail || `git ${args[0]} failed`}`,
	);
}

/** NUL-delimited paths preserve Unicode, whitespace and literal glob characters. */
export function stagedPaths(root: string): string[] {
	return spaceGit(root, ["diff", "--cached", "--name-only", "-z"])
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

export interface SpaceCommitResult {
	committed: number;
	unborn: boolean;
	skipped: string[];
}

/** Stage the allowlist, remove gitlinks, guard secrets and commit without hooks/signing. */
export function commitSpace(root: string, branch: string, message: string): SpaceCommitResult {
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
	]);
	const staged = stagedPaths(root);
	const gitlinks = stagedGitlinks(root);
	const nested = [...new Set([...excluded, ...gitlinks])];
	for (const path of gitlinks) {
		spaceGit(root, ["rm", "--cached", "-q", "-f", "--", `:(literal)${path}`]);
	}
	for (const path of nested) {
		process.stderr.write(
			`warning: ${path} contains its own git repository; its files are not saved in the space.\n`,
		);
	}
	if (nested.length > 0) staged.splice(0, staged.length, ...stagedPaths(root));
	const secrets = findSecretPaths(staged);
	if (secrets.length > 0) {
		throw new Error(
			`refusing to commit ${branch}: ${secrets.join(", ")} ` +
				`${secrets.length === 1 ? "matches" : "match"} the secret guard (a .env, a key, a ` +
				`credentials file). Move ${secrets.length === 1 ? "it" : "them"} out of the space, or ` +
				`keep ${secrets.length === 1 ? "it" : "them"} out of the allowlist.`,
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
				/please tell me who you are|no name was given|empty ident/i.test(detail)
					? `git has no identity to commit ${branch} with. Set one and run this again: ` +
							`\n\n  git config --global user.name "Your Name"\n  git config --global user.email "you@example.com"\n`
					: `the first commit of ${branch} failed: ${detail}`,
			);
		}
	} else if (unborn) {
		process.stderr.write(
			`warning: the allowlist matched no files in ${root}, so there is nothing to commit and no branch to push.\n`,
		);
	}
	return { committed: staged.length, unborn: unborn && staged.length === 0, skipped: nested };
}

/** A plain, explicit branch push; never rewrites remote history. */
export function pushSpace(root: string, remote: string, branch: string): void {
	spaceGitRemote(root, remote, ["push", "-u", "origin", branch], branch);
}

/** Init/refresh publication, with callbacks preserving the caller's rollback boundary. */
export function commitAndPushSpace(
	root: string,
	name: string,
	branch: string,
	remote: string,
	onCommitted: (files: number) => void,
	beforePush: () => void,
): SpaceCommitResult & { upToDate: boolean } {
	const result = commitSpace(root, branch, `space: init ${name}`);
	if (result.committed > 0) onCommitted(result.committed);
	if (result.unborn) return { ...result, upToDate: true };
	const head = spaceGit(root, ["rev-parse", "HEAD"], { allowFailure: true }).stdout.trim();
	const publishedBefore = remoteSha(root, remote, branch);
	beforePush();
	pushSpace(root, remote, branch);
	return { ...result, upToDate: head !== "" && head === publishedBefore };
}
