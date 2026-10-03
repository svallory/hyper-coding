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
import { existsSync, mkdirSync, rmSync } from "node:fs";
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
function spaceConfigGet(spaceRoot: string, key: string): string | null {
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
			encoding: "utf8",
			env: cleanGitEnv(),
		},
	);

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
		const worktree = spaceConfigGet(spaceRoot, "core.worktree");
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
		if (init.error || init.status !== 0) {
			throw new SpaceGitError((init.stderr ?? "").trim() || `git init --bare failed for ${gitDir}`);
		}

		spaceGit(spaceRoot, ["config", "--local", "core.bare", "false"]);
		spaceGit(spaceRoot, ["config", "--local", "core.worktree", "../.."]);
		// Point HEAD at the orphan branch without creating it: the branch must not
		// exist as a commit yet — the first space commit is made by `space commit`.
		spaceGit(spaceRoot, ["symbolic-ref", "HEAD", `refs/heads/${branch}`]);

		if (remote !== undefined) {
			spaceGit(spaceRoot, ["config", "--local", "remote.origin.url", remote]);
			spaceGit(spaceRoot, ["config", "--local", `branch.${branch}.remote`, "origin"]);
			spaceGit(spaceRoot, ["config", "--local", `branch.${branch}.merge`, `refs/heads/${branch}`]);
		}
	} catch (err) {
		rmSync(gitDir, { recursive: true, force: true });
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
 * The space's sync cadence (C-11: `hyper.cadence` in the space git dir's
 * config is the truth). An unset key reads as `""`. A value outside the union
 * is refused rather than passed on: it can only come from a hand-edit or a
 * stale writer, and quietly scheduling syncs from it would be worse than a
 * clear complaint.
 */
export function readCadence(spaceRoot: string): SyncCadence {
	const value = spaceConfigGet(spaceRoot, "hyper.cadence");
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
