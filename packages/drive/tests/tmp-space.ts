import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * TypeScript port of the fixture builders in `agent-plugin/tests/helpers.sh`.
 *
 * The port is deliberate and literal: `agent-plugin/tests/test-a-detection.sh`
 * asserts space detection against exactly these layouts, and C-5 requires that
 * `services/space.ts` (which shells out to the same `hyper-lib.sh`) agrees with
 * it case for case. If a fixture drifts from the bash one, the two suites stop
 * being evidence for each other.
 */

function run(cmd: string, args: string[]): void {
	execFileSync(cmd, args, { stdio: "pipe" });
}

/** Git that fails loudly — a broken fixture must not look like a passing assertion. */
function git(args: string[]): void {
	run("git", args);
}

let fix: string | null = null;

/**
 * Create the throwaway fixture root and isolate git inside it, mirroring the
 * bash harness: HOME points into the fixture, system and global config are
 * ignored, and the default branch is `main` so `make_multi_space` can fetch a
 * known ref.
 */
export function setupSpaceFixtures(): string {
	fix = realpathSync(mkdtempSync(join(tmpdir(), "drive-space-")));
	const home = join(fix, "home");
	mkdirSync(home, { recursive: true });

	process.env.HOME = home;
	process.env.GIT_CONFIG_NOSYSTEM = "1";
	process.env.GIT_CONFIG_GLOBAL = join(home, ".gitconfig");
	process.env.GIT_AUTHOR_NAME = "hyper test";
	process.env.GIT_AUTHOR_EMAIL = "hyper-test@example.invalid";
	process.env.GIT_COMMITTER_NAME = "hyper test";
	process.env.GIT_COMMITTER_EMAIL = "hyper-test@example.invalid";
	git(["config", "--global", "user.email", "hyper-test@example.invalid"]);
	git(["config", "--global", "user.name", "hyper test"]);
	git(["config", "--global", "init.defaultBranch", "main"]);
	git(["config", "--global", "commit.gpgsign", "false"]);

	return fix;
}

/** Remove the fixture root and restore the git environment. */
export function teardownSpaceFixtures(): void {
	if (fix === null) return;
	rmSync(fix, { recursive: true, force: true });
	fix = null;
	delete process.env.HOME;
	delete process.env.GIT_CONFIG_NOSYSTEM;
	delete process.env.GIT_CONFIG_GLOBAL;
}

/** A path inside the fixture root (the same `$FIX` the bash harness uses). */
export function fixturePath(...parts: string[]): string {
	if (fix === null) throw new Error("call setupSpaceFixtures() first");
	return join(fix, ...parts);
}

/** `git init --bare <dir>/.git`, the one-line shape several cases need inline. */
export function initBare(gitDir: string): void {
	run("git", ["init", "-q", "--bare", gitDir]);
}

/** Normal working tree with one commit. */
export function makeCheckout(dir: string): void {
	run("git", ["init", "-q", dir]);
	writeFileSync(join(dir, "file.txt"), "hello\n");
	git(["-C", dir, "add", "-A"]);
	git(["-C", dir, "commit", "-qm", "init"]);
}

/** Bare `.git` + `worktrees/` — the self-identifying bare space shape. */
export function makeBareSpace(dir: string): void {
	mkdirSync(dir, { recursive: true });
	run("git", ["init", "-q", "--bare", join(dir, ".git")]);
	mkdirSync(join(dir, "worktrees"), { recursive: true });
}

/**
 * A multi-repo space: no `.git` at the root, a `HYPER.md` marker, and one
 * `code/<slug>/` per slug, each with its own bare `.git` and a
 * `worktrees/<default-branch>` checked out from a seeded commit.
 *
 * Defaults to two slugs so callers exercise the plural case by default.
 */
export function makeMultiSpace(root: string, slugs: string[] = ["alpha", "beta"]): void {
	mkdirSync(join(root, "code"), { recursive: true });
	writeFileSync(join(root, "HYPER.md"), "");

	for (const slug of slugs) {
		const repo = join(root, "code", slug);
		const gitdir = join(repo, ".git");
		mkdirSync(repo, { recursive: true });
		run("git", ["init", "-q", "--bare", gitdir]);

		// A worktree needs a commit to check out, so seed one through a
		// throwaway checkout and fetch it into the bare repo.
		const seed = join(root, `.seed-${slug}`);
		makeCheckout(seed);
		git(["--git-dir", gitdir, "fetch", "-q", seed, "refs/heads/main:refs/heads/main"]);
		git(["--git-dir", gitdir, "symbolic-ref", "HEAD", "refs/heads/main"]);
		rmSync(seed, { recursive: true, force: true });

		mkdirSync(join(repo, "worktrees"), { recursive: true });
		git(["--git-dir", gitdir, "worktree", "add", "-q", join(repo, "worktrees", "main"), "main"]);
	}
}

/**
 * A linked worktree inside a bare space.
 *
 * A freshly created bare space has no commits, so there is no ref to check out
 * and `git worktree add` fails — exactly as it does in the bash harness, where
 * the `2>/dev/null ||` fallback fails too. The caller creates the directory it
 * needs afterwards; the point of the case is a `.git` *file* inside a space.
 */
export function makeBareSpaceWithWorktree(dir: string, branch: string): string {
	makeBareSpace(dir);
	const wt = join(dir, "worktrees", branch);
	try {
		git(["--git-dir", join(dir, ".git"), "worktree", "add", "-q", wt, "-b", branch]);
	} catch {
		// No commit to check out yet; leave the (uncreated) path to the caller.
	}
	return wt;
}
