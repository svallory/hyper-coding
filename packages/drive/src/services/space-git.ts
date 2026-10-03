/**
 * The space git runner — the ONE place this package spawns git (C-2).
 *
 * Every space gets its own history as an orphan branch of the user's
 * hyperdrive repo. The git dir lives at `<space>/.hyper/space.git` with the
 * work tree rooted at the space itself, so the project's own bare `.git` at
 * the space root is just an ignored directory, never an embedded-repo
 * problem. Every invocation passes `--git-dir` and `--work-tree` explicitly;
 * `core.worktree` is set on the git dir only so a curious user's manual
 * `GIT_DIR=... git status` also works.
 *
 * Arguments always travel as an argv array to `spawnSync`, never as a shell
 * string, so a path with spaces or quotes cannot be re-parsed.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { SyncCadence } from "#config/schema";

/**
 * The cadence values the space git dir may hold. Mirrors the union in
 * config/schema.ts (and the check in config/index.ts) — kept here so the git
 * dir's config can be validated where it is read, without pulling the whole
 * user config into this module.
 */
const ALLOWED_CADENCES: readonly SyncCadence[] = ["", "manual", "session-end", "session-end+push"];

/** Where a space's own git dir lives. */
export function spaceGitDir(spaceRoot: string): string {
	return join(spaceRoot, ".hyper", "space.git");
}

export interface SpaceGitResult {
	status: number;
	stdout: string;
	stderr: string;
}

export interface SpaceGitOptions {
	/** Working directory for the git process (default: the space root). */
	cwd?: string;
	/** piped to git's stdin. */
	input?: string;
	/** Return non-zero results instead of throwing a SpaceGitError. */
	allowFailure?: boolean;
	/** Inherit git's streams and pager for interactive passthrough commands. */
	inheritStdio?: boolean;
}

/**
 * Every variable git itself considers local to the repository
 * (`git rev-parse --local-env-vars`). hyper can be invoked from inside another
 * repository's hook, and any of these would redirect our command somewhere
 * else — the explicit `--git-dir`/`--work-tree` win over some of them, not all.
 */
const LOCAL_GIT_ENV_VARS = [
	"GIT_ALTERNATE_OBJECT_DIRECTORIES",
	"GIT_COMMON_DIR",
	"GIT_CONFIG",
	"GIT_CONFIG_PARAMETERS",
	"GIT_CONFIG_COUNT",
	"GIT_DIR",
	"GIT_GRAFT_FILE",
	"GIT_IMPLICIT_WORK_TREE",
	"GIT_INDEX_FILE",
	"GIT_INTERNAL_SUPER_PREFIX",
	"GIT_NO_REPLACE_OBJECTS",
	"GIT_OBJECT_DIRECTORY",
	"GIT_PREFIX",
	"GIT_REPLACE_REF_BASE",
	"GIT_SHALLOW_FILE",
	"GIT_WORK_TREE",
] as const;

/**
 * Child environment for git: prompts disabled (so git can never block a
 * command on a credential prompt), and every repo-local variable stripped.
 *
 * Exported so the scrub can be tested directly — passing `--git-dir` already
 * beats `GIT_DIR`, which means most of these leaks cannot be provoked through
 * `spaceGit` itself.
 */
export function cleanGitEnv(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
	const env: NodeJS.ProcessEnv = { ...source, GIT_TERMINAL_PROMPT: "0" };
	for (const key of LOCAL_GIT_ENV_VARS) delete env[key];
	return env;
}

/**
 * Read one key from the space git dir's OWN config.
 *
 * `--local` is not optional: a plain `git config --get` also reads the user's
 * global and system config, so a stray `hyper.cadence` in `~/.gitconfig` would
 * answer for a space, and a global `core.worktree` would make an empty
 * `.hyper/space.git` look like an initialised one. Returns `null` when the key
 * is unset.
 */
export function readSpaceConfig(spaceRoot: string, key: string): string | null {
	const { status, stdout } = spaceGit(spaceRoot, ["config", "--local", "--get", key], {
		allowFailure: true,
	});
	if (status !== 0) return null;
	return stdout.trim();
}

/**
 * A git failure, friendly: the message is git's own stderr, trimmed — the
 * thing a user can act on — never a Node stack dump.
 */
export class SpaceGitError extends Error {
	constructor(detail: string) {
		super(detail);
		this.name = "SpaceGitError";
		// The message IS the whole story; a stack would only bury it.
		this.stack = this.message;
	}
}

/** A child interrupted by the terminal, even when ordinary failures are allowed. */
export class SpaceGitInterruptedError extends SpaceGitError {
	constructor(
		readonly signal: "SIGINT" | "SIGTERM",
		detail = "interrupted: nothing was changed. Run the command again when ready.",
	) {
		super(detail);
		this.name = "SpaceGitInterruptedError";
	}
}

/**
 * Run `git --git-dir <space git dir> --work-tree <space root> ...args`.
 *
 * The child environment comes from `cleanGitEnv()`: prompts disabled, and
 * every repo-local `GIT_*` variable stripped, so an outer git context (a
 * hook, an embedding repo) cannot leak in and redirect the command.
 *
 * Throws `SpaceGitError` on non-zero exit unless `allowFailure` is set.
 */
export function spaceGit(
	spaceRoot: string,
	args: string[],
	opts: SpaceGitOptions = {},
): SpaceGitResult {
	const result = spawnSync(
		"git",
		["--git-dir", spaceGitDir(spaceRoot), "--work-tree", spaceRoot, ...args],
		{
			cwd: opts.cwd ?? spaceRoot,
			input: opts.input,
			stdio: opts.inheritStdio ? "inherit" : "pipe",
			encoding: "utf8",
			env: cleanGitEnv(),
		},
	);

	// spawnSync blocks JS signal handlers. Terminal process-group signals are
	// observable through the child; a signal to Node alone while git runs is
	// not reliably recoverable with synchronous spawns. Do not claim otherwise.
	if (result.signal === "SIGINT" || result.signal === "SIGTERM") {
		throw new SpaceGitInterruptedError(result.signal);
	}
	if (result.error) {
		throw new SpaceGitError(
			`I couldn't run git: ${result.error.message}. Is git installed and on your PATH?`,
		);
	}

	const status = result.status ?? 1;
	const stdout = result.stdout ?? "";
	const stderr = result.stderr ?? "";

	if (status !== 0 && !opts.allowFailure) {
		const detail = stderr.trim();
		throw new SpaceGitError(
			detail === ""
				? `git ${args[0] ?? ""} failed with exit code ${status} and said nothing.`
				: detail,
		);
	}
	return { status, stdout, stderr };
}

/**
 * Read only a bounded prefix of a staged blob, never the work-tree file. Git has no
 * prefix-read mode: maxBuffer bounds capture and kills the reader on overflow.
 * SIGKILL is reserved for this cap; terminal SIGINT/SIGTERM still propagate.
 */
export function readStagedBlobPrefix(spaceRoot: string, path: string): string {
	const limit = 4096;
	const result = spawnSync(
		"git",
		["--git-dir", spaceGitDir(spaceRoot), "--work-tree", spaceRoot, "show", `:${path}`],
		{
			cwd: spaceRoot,
			env: cleanGitEnv(),
			maxBuffer: limit,
			killSignal: "SIGKILL",
		},
	);
	if (result.signal === "SIGINT" || result.signal === "SIGTERM")
		throw new SpaceGitInterruptedError(result.signal);
	const capped = (result.error as NodeJS.ErrnoException | undefined)?.code === "ENOBUFS";
	if ((!capped && result.error) || (!capped && result.status !== 0)) {
		throw new SpaceGitError(
			`I couldn't inspect the staged content of ${JSON.stringify(path)} for secrets. Inspect the index and retry: ${result.error?.message || result.stderr?.toString().trim() || "git show failed"}`,
		);
	}
	return (result.stdout ?? Buffer.alloc(0)).subarray(0, limit).toString("utf8");
}

export interface InitSpaceGitOptions {
	/** Branch name, e.g. `space/<name>`. Must not exist as a commit yet. */
	branch: string;
	/** URL of the user's hyperdrive repo; recorded as `remote.origin.url`. */
	remote?: string;
}

export interface InitSpaceGitResult {
	/** False when the git dir already existed and nothing was touched. */
	created: boolean;
}

/**
 * Create `<space>/.hyper/space.git` as a bare init flipped into a work-tree
 * repo rooted at the space: `core.bare=false`, `core.worktree=../..`, HEAD
 * pointing at the (still unborn) orphan branch, and the origin remote plus
 * upstream config when a remote URL is given.
 *
 * Idempotent: when the git dir already exists this is a no-op returning
 * `{ created: false }` — C-3 means a second `init` must not touch anything,
 * including the space's own `.git`.
 *
 * A failure part-way through removes the git dir this call created, so the
 * next call starts clean instead of finding a half-set-up dir and reporting
 * success for a space that has no history at all.
 */
export function initSpaceGitDir(
	spaceRoot: string,
	{ branch, remote }: InitSpaceGitOptions,
): InitSpaceGitResult {
	const gitDir = spaceGitDir(spaceRoot);
	if (existsSync(gitDir)) {
		// Key idempotence on the config we write, not on the directory merely
		// existing: a directory left by something else (or by an init run
		// elsewhere) is not a space git dir, and calling it a no-op would
		// leave the space permanently without history. The value matters as
		// much as the key — a `core.worktree` pointing anywhere but the space
		// root is somebody else's git dir, not ours.
		const worktree = readSpaceConfig(spaceRoot, "core.worktree");
		if (worktree === null) {
			throw new SpaceGitError(
				`There's a git dir at ${gitDir}, but it isn't a hyper space git dir — it has no core.worktree. Move it aside and try again.`,
			);
		}
		if (worktree !== "../..") {
			throw new SpaceGitError(
				`There's a git dir at ${gitDir}, but it isn't a hyper space git dir — its core.worktree points at ${worktree}, not at this space. Move it aside and try again.`,
			);
		}
		return { created: false };
	}

	mkdirSync(gitDir, { recursive: true });
	try {
		// `git init --bare` scaffolds the dir; the two config flips below turn it
		// into a non-bare repo whose work tree is the space root. Plain
		// spawnSync here (not spaceGit): --work-tree against a half-configured
		// bare dir makes some git builds grumpy before core.bare is false.
		const init = spawnSync("git", ["init", "--bare", gitDir], {
			encoding: "utf8",
			env: cleanGitEnv(),
		});
		if (init.signal === "SIGINT" || init.signal === "SIGTERM") {
			throw new SpaceGitInterruptedError(init.signal);
		}
		if (init.error || init.status !== 0) {
			throw new SpaceGitError((init.stderr ?? "").trim() || `git init --bare failed for ${gitDir}`);
		}

		spaceGit(spaceRoot, ["config", "--local", "core.bare", "false"]);
		spaceGit(spaceRoot, ["config", "--local", "core.worktree", "../.."]);
		// Point HEAD at the orphan branch without creating it: the branch must not
		// exist as a commit yet — the first space commit is made by
		// `hyper space init`, and every commit after that by `hyper space commit`.
		spaceGit(spaceRoot, ["symbolic-ref", "HEAD", `refs/heads/${branch}`]);

		if (remote !== undefined) {
			spaceGit(spaceRoot, ["config", "--local", "remote.origin.url", remote]);
			spaceGit(spaceRoot, [
				"config",
				"--local",
				"remote.origin.fetch",
				`refs/heads/${branch}:refs/remotes/origin/${branch}`,
			]);
			spaceGit(spaceRoot, ["config", "--local", `branch.${branch}.remote`, "origin"]);
			spaceGit(spaceRoot, ["config", "--local", `branch.${branch}.merge`, `refs/heads/${branch}`]);
		}
	} catch (err) {
		rmSync(gitDir, { recursive: true, force: true });
		removeEmptyHyperDir(spaceRoot);
		if (err instanceof SpaceGitInterruptedError) throw err;
		if (err instanceof SpaceGitError) {
			throw new SpaceGitError(`while setting up the space git dir: ${err.message}`);
		}
		throw err;
	}

	return { created: true };
}

/** True when the space already has its own git dir. */
export function hasSpaceGit(spaceRoot: string): boolean {
	return existsSync(spaceGitDir(spaceRoot));
}

/**
 * Remove the space's git dir — only ever one THIS MODULE created.
 *
 * `hyper space init` creates the git dir before its ref-clash and secret
 * checks, because both have to run through it (C-2), and a refusal must not
 * leave a half-registered space behind. The `core.worktree` guard is the
 * safety: a directory that is not a hyper space git dir (someone else's, or a
 * space initialised elsewhere) is left exactly where it is.
 *
 * An EMPTY `.hyper/` goes with it: it is hyper's directory, it held nothing
 * else, and leaving it behind means the next plain `init` finds a space that
 * looks half-set-up.
 *
 * Returns true when a git dir was removed.
 */
export function removeSpaceGitDir(spaceRoot: string): boolean {
	const gitDir = spaceGitDir(spaceRoot);
	if (!existsSync(gitDir)) return false;
	if (readSpaceConfig(spaceRoot, "core.worktree") !== "../..") return false;
	rmSync(gitDir, { recursive: true, force: true });
	removeEmptyHyperDir(spaceRoot);
	return true;
}

/** Remove only an empty metadata directory, without spawning git during cleanup. */
function removeEmptyHyperDir(spaceRoot: string): void {
	try {
		// Only when nothing else of the space's lives there (`.hyper/memory`,
		// say), which is the point: this is not ours to tidy otherwise.
		if (readdirSync(join(spaceRoot, ".hyper")).length === 0) {
			rmdirSync(join(spaceRoot, ".hyper"));
		}
	} catch {
		// No `.hyper`, or not empty, or not removable. Nothing to do about it.
	}
}

/** What a project repository of a space calls itself, for the manifest. */
export interface ProjectRepoInfo {
	/** `remote.origin.url` of the repository's own git dir. */
	url: string;
	/** Its default branch, best effort: origin/HEAD, then `init.defaultBranch`, then `main`. */
	defaultBranch: string;
}

/**
 * Read a space's PROJECT repository (the bare `.git` at a bare space's root,
 * or `<root>/code/<slug>/.git` in a multi space) so the manifest can record
 * where its code came from.
 *
 * Lives here because C-2 makes this the only file allowed to spawn git for
 * anything space-shaped, and it is deliberately a plain `git --git-dir <dir>`
 * call: `--work-tree` would be a lie for these repos (their work trees are the
 * `worktrees/<branch>` checkouts), and every call is a read — nothing here can
 * write inside the project's own repo (C-3).
 *
 * `null` when the git dir is missing or names no `origin`: a repo seeded from
 * a local path has nothing to record, and inventing a URL for it would be a
 * lie in the manifest.
 */
export function projectRepoInfo(gitDir: string): ProjectRepoInfo | null {
	if (!existsSync(gitDir)) return null;
	const read = (args: string[]): string | null => {
		const result = spawnSync("git", ["--git-dir", gitDir, ...args], {
			encoding: "utf8",
			env: cleanGitEnv(),
		});
		if (result.signal === "SIGINT" || result.signal === "SIGTERM") {
			throw new SpaceGitInterruptedError(result.signal);
		}
		if (result.status !== 0) return null;
		const value = (result.stdout ?? "").trim();
		return value === "" ? null : value;
	};

	const url = read(["config", "--get", "remote.origin.url"]);
	if (url === null) return null;

	const originHead = read(["symbolic-ref", "-q", "refs/remotes/origin/HEAD"]);
	const fromOrigin = originHead?.replace(/^refs\/remotes\/origin\//, "") ?? "";
	const defaultBranch = fromOrigin || read(["config", "--get", "init.defaultBranch"]) || "main";
	return { url, defaultBranch };
}

/**
 * The space's sync cadence (C-11: `hyper.cadence` in the space git dir's
 * config is the truth). An unset key reads as `""`. A value outside the union
 * is refused rather than passed on: it can only come from a hand-edit or a
 * stale writer, and quietly scheduling syncs from it would be worse than a
 * clear complaint.
 */
export function readCadence(spaceRoot: string): SyncCadence {
	const value = readSpaceConfig(spaceRoot, "hyper.cadence");
	if (value === null) return "";
	if (!ALLOWED_CADENCES.includes(value as SyncCadence)) {
		throw new SpaceGitError(
			`The space git dir at ${spaceGitDir(spaceRoot)} says its cadence is ${JSON.stringify(value)}, which isn't one of "manual", "session-end", "session-end+push". Fix it with \`git config --file <git dir>/config hyper.cadence <value>\`.`,
		);
	}
	return value as SyncCadence;
}

/** Write `hyper.cadence` into the space git dir's config. */
export function writeCadence(spaceRoot: string, cadence: SyncCadence): void {
	if (!ALLOWED_CADENCES.includes(cadence)) {
		throw new SpaceGitError(
			`${JSON.stringify(cadence)} isn't a cadence I know — use "manual", "session-end" or "session-end+push".`,
		);
	}
	spaceGit(spaceRoot, ["config", "--local", "hyper.cadence", cadence]);
}

/**
 * Remove `hyper.cadence` entirely — the state `readCadence` reports as `""`.
 *
 * Needed to put a space back the way a run found it: a space that had no
 * cadence must not inherit one from a refused run.
 */
export function clearCadence(spaceRoot: string): void {
	spaceGit(spaceRoot, ["config", "--local", "--unset", "hyper.cadence"], { allowFailure: true });
}

/**
 * The space's tracked directories, as recorded in its OWN git dir
 * (`hyper.tracked`, one value per directory) — C-11's rule applied to the
 * allowlist: the git config is the truth, not a copy of it in the manifest.
 *
 * Read with `--get-all` through `config --local`, so a `hyper.tracked` in a
 * user's global config can never answer for a space.
 */
export function readTracked(spaceRoot: string): string[] {
	const { status, stdout, stderr } = spaceGit(
		spaceRoot,
		["config", "--local", "--get-all", "hyper.tracked"],
		{
			allowFailure: true,
		},
	);
	// git exits 1 for "key not found", which is a space that tracks nothing.
	// Anything else (128 and friends) is a broken git dir, and answering "no
	// entries" to it would silently drop the space's tracked directories — the
	// one thing a refresh must never do.
	if (status === 1) return [];
	if (status !== 0) {
		throw new SpaceGitError(
			`I couldn't read the space's tracked directories from ${spaceGitDir(spaceRoot)}: ` +
				`${stderr.trim() || stdout.trim() || `git config exited ${status}`}`,
		);
	}
	return stdout
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "");
}

/**
 * Replace the space's tracked directories with `tracked`.
 *
 * `--unset-all` first rather than `--replace-all`: `replace-all` edits the
 * first line in place and leaves any further lines as they were, which would
 * resurrect a removed entry on the next read.
 */
export function writeTracked(spaceRoot: string, tracked: readonly string[]): void {
	spaceGit(spaceRoot, ["config", "--local", "--unset-all", "hyper.tracked"], {
		allowFailure: true,
	});
	for (const entry of tracked) {
		spaceGit(spaceRoot, ["config", "--local", "--add", "hyper.tracked", entry]);
	}
}
