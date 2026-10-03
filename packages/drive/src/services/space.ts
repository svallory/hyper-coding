/**
 * Space detection, delegated to `scripts/hyper-lib.sh`.
 *
 * C-5: there is exactly ONE copy of the bash library — it ships inside this
 * package, and the agent-plugin's scripts source it from the installed CLI
 * (`hyper space lib-path`). This module never re-implements detection in
 * TypeScript; it spawns bash once per call and maps the shell functions'
 * conventions onto TS types:
 *
 *   - a function that prints nothing and exits non-zero ("not a space")
 *     becomes `null` (or `[]` for the list-shaped ones),
 *   - a function that prints lines becomes trimmed strings.
 *
 * Every spawn passes paths as argv (`"$@"` inside `bash -c`), never by
 * string interpolation, so a path with spaces or quotes cannot be re-parsed.
 */

import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export type SpaceLayout = "bare" | "multi";

/**
 * Absolute path of the bash library. Resolved from this module's own URL, so
 * it is the same file whether this runs from `src/` (vitest) or from `dist/`
 * (the installed package): both sit two directories below the package root.
 */
export function libPath(): string {
	return fileURLToPath(new URL("../../scripts/hyper-lib.sh", import.meta.url));
}

/**
 * Resolve symlinks so the paths the lib prints are the same strings a caller
 * can compare against. git resolves symlinks too (`/var` → `/private/var` on
 * macOS) and the bash test harness runs on `pwd -P` for exactly this reason;
 * without it, `space_layout` refuses a path that git considers the repo's own
 * toplevel and the answers disagree with the bash suite. A path that cannot be
 * resolved (it does not exist) is passed through — the lib will simply say it
 * is not a space.
 */
function physical(dir: string): string {
	try {
		return realpathSync(dir);
	} catch {
		return dir;
	}
}

interface RunResult {
	ok: boolean;
	stdout: string;
}

/** Run one hyper-lib.sh function and capture its stdout. */
function runLib(fn: string, args: readonly string[]): RunResult {
	const result = spawnSync("bash", ["-c", `source "$0"; ${fn} "$@"`, libPath(), ...args], {
		encoding: "utf8",
		// bash must not inherit the caller's `set -e`/pipefail opinions, but
		// nothing here depends on that either way; -e is deliberately NOT set
		// so `space_layout … || return 1` inside the lib behaves normally.
	});
	if (result.error) {
		// A missing bash or an unreadable library is an environment failure,
		// not "this directory is not a space" — say so loudly instead of
		// quietly reporting a wrong answer.
		throw new Error(
			`Could not run ${fn} from ${libPath()}: ${result.error.message}. Is bash installed?`,
		);
	}
	return { ok: result.status === 0, stdout: result.stdout ?? "" };
}

function firstLine(stdout: string): string | null {
	const line = stdout.split("\n")[0]?.trim() ?? "";
	return line === "" ? null : line;
}

function lines(stdout: string): string[] {
	return stdout
		.split("\n")
		.map((l) => l.trim())
		.filter((l) => l !== "");
}

/**
 * Walk up from `dir` to the enclosing space root.
 *
 * Returns the root path, or `null` when `dir` is not inside a space.
 */
export function findSpaceRoot(dir: string): string | null {
	const { ok, stdout } = runLib("find_space_root", [physical(dir)]);
	if (!ok) return null;
	return firstLine(stdout);
}

/**
 * Which space shape `dir` has: "bare", "multi", or `null` when it is not a
 * space root at all.
 */
export function spaceLayout(dir: string): SpaceLayout | null {
	const { ok, stdout } = runLib("space_layout", [physical(dir)]);
	if (!ok) return null;
	const layout = firstLine(stdout);
	return layout === "bare" || layout === "multi" ? layout : null;
}

/** Is `dir` a space (root)? Mirrors the lib's `is_space`. */
export function isSpace(dir: string): boolean {
	return runLib("is_space", [physical(dir)]).ok;
}

/**
 * One repo slug per line under a multi-repo space's `code/`; `[]` for a bare
 * space (its single repository is the root itself) or a not-a-space.
 */
export function spaceRepos(dir: string): string[] {
	const { ok, stdout } = runLib("space_repos", [physical(dir)]);
	if (!ok) return [];
	return lines(stdout);
}

/**
 * Slug of the repo containing `dir`, when it is at or under
 * `<root>/code/<slug>`; `null` at the space root, in a local-only dir, or in a
 * bare space.
 */
export function repoSlugOf(root: string, dir: string): string | null {
	const { ok, stdout } = runLib("repo_slug_of", [physical(root), physical(dir)]);
	if (!ok) return null;
	return firstLine(stdout);
}

/**
 * Where worktrees live under `root`: `<root>/worktrees` for a bare space,
 * `<root>/code/<slug>/worktrees` for a multi space (which needs the slug).
 *
 * Returns `null` when the lib refuses — i.e. a multi root asked for without
 * a slug, or a directory that is not a space at all.
 */
export function worktreesDir(root: string, slug?: string): string | null {
	const args = slug === undefined ? [physical(root)] : [physical(root), slug];
	const { ok, stdout } = runLib("worktrees_dir", args);
	if (!ok) return null;
	return firstLine(stdout);
}

/** Everything `hyper space detect` reports about a directory. */
export interface SpaceInfo {
	root: string | null;
	layout: SpaceLayout | null;
	repos: string[];
	slug: string | null;
	worktreesDir: string | null;
}

/** The full detection result in one call, for the `space detect` command. */
export function detectSpace(dir: string): SpaceInfo {
	const root = findSpaceRoot(dir);
	const layout = root === null ? null : spaceLayout(root);
	const repos = root === null ? [] : spaceRepos(root);
	const slug = root === null ? null : repoSlugOf(root, dir);
	const worktrees = root === null || layout === null ? null : worktreesDir(root, slug ?? undefined);
	return { root, layout, repos, slug, worktreesDir: worktrees };
}
