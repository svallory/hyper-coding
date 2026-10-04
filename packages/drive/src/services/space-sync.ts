/** Shared staging, publication and remote diagnostics for space history. */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { escapeControlCharacters, quoteForTerminal } from "#lib/terminal-text";
import { findSecretPaths } from "#services/allowlist";
import {
	gitSaid,
	readSpaceBlobPrefixes,
	SpaceGitError,
	SpaceGitInterruptedError,
	spaceGit,
} from "#services/space-git";

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
	const detail = (result.stderr || result.stdout).trim();
	const what = `push ${escapeControlCharacters(branch)}`;
	// Ref conflicts also carry [remote rejected], but are not hook failures.
	if (/refname conflict|cannot lock ref/i.test(detail)) {
		throw new SpacePushRefusedError(
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
		throw new SpacePushRefusedError(
			`the hyperdrive at ${escapeControlCharacters(remote)} refused to take ${escapeControlCharacters(branch)}: a server-side hook declined the push. ` +
				`Nothing was overwritten, and retrying will not help until that hook allows it.` +
				(reason === "" ? "" : ` It said: ${gitSaid(reason).replace(/[.!?]+$/, "")}.`),
		);
	}
	if (/(fetch first|non-fast-forward|stale info|behind its remote)/i.test(detail)) {
		throw new SpacePushRefusedError(
			`${what} was refused: ${escapeControlCharacters(remote)} has moved on, so another machine pushed this space's branch ` +
				`first. Nothing was overwritten — hyper never rewrites a space's history. ` +
				(caller === "init"
					? "Use a different name to initialise a new space, or reconcile the existing history manually."
					: "Run `hyper space pull` to fast-forward if possible; divergent histories need manual reconciliation."),
			` Pass \`--name\` with a different name to initialise a new space.`,
		);
	}
	throw new SpaceGitError(
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
): Promise<SpaceCommitResult> {
	if (message.trim() === "")
		throw new SpaceGitError(
			"A commit message cannot be empty. Pass a non-empty `-m` message before trying again.",
		);
	try {
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
			// -f is only for removing an index gitlink differing from disk and HEAD;
			// it never deletes work-tree files and is never used for publication.
			spaceGit(root, ["rm", "--cached", "-q", "-f", "--", `:(literal)${path}`]);
		}
		for (const path of nested) {
			process.stderr.write(
				`warning: ${escapeControlCharacters(path)} contains its own git repository; its files are not saved in the space.\n`,
			);
		}
		if (nested.length > 0) staged.splice(0, staged.length, ...stagedPaths(root));
		const inspection = await inspectStagedFiles(root, staged, allowSecrets);
		const { secrets, allowedSecrets, largeFiles } = inspection;
		for (const path of allowedSecrets)
			process.stderr.write(
				`warning: allowing secret path ${quoteForTerminal(path)} as explicitly requested.\n`,
			);
		for (const path of largeFiles)
			process.stderr.write(
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
			process.stderr.write(
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
export function pushSpace(
	root: string,
	remote: string,
	branch: string,
	caller: "init" | "daily" = "daily",
): void {
	const sha = spaceGit(root, ["rev-parse", `refs/heads/${branch}`]).stdout.trim();
	spaceGitRemote(root, remote, ["push", "origin", `${sha}:refs/heads/${branch}`], branch, caller);
	// Legacy init wrote no fetch refspec: Git cannot update a tracking ref for it.
	// Record exactly the immutable SHA handed to the successful push, even there.
	spaceGit(root, ["update-ref", `refs/remotes/origin/${branch}`, sha]);
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
