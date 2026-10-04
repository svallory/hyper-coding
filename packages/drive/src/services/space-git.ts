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

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { SyncCadence } from "#config/schema";
// C-16: only services/remote.ts may name an SSH program, so the command-shape
// knowledge lives there and is imported, not re-spelled here.
import { sshCommandWithBatchMode } from "#services/remote";

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
	signal?: NodeJS.Signals | null;
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
	/** Mark a read command so Git does not refresh/write optional index locks. */
	readOnly?: boolean;
	maxBuffer?: number;
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

/**
 * A refusal a machine can act on. The `reason` slug is the contract for
 * `--json` callers; the message is still the human story.
 */
export class SpaceRefusedError extends SpaceGitError {
	constructor(
		readonly reason: "unreachable" | "consent-required" | "local-changes" | "diverged" | "refused",
		detail: string,
	) {
		super(detail);
		this.name = "SpaceRefusedError";
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
	const result = spawnSync("git", spaceGitArguments(spaceRoot, args, opts.readOnly), {
		cwd: opts.cwd ?? spaceRoot,
		input: opts.input,
		stdio: opts.inheritStdio ? "inherit" : "pipe",
		encoding: "utf8",
		maxBuffer:
			opts.maxBuffer ??
			(args.some((arg) => ["ls-tree", "ls-files", "status", "diff"].includes(arg)) ? 128 : 16) *
				1024 *
				1024,
		env: cleanGitEnv(),
	});

	// Buffer exhaustion also kills the child with SIGTERM; it is not Ctrl-C.
	if ((result.error as NodeJS.ErrnoException | undefined)?.code === "ENOBUFS") {
		throw new SpaceGitError(
			"Git's output exceeded the safe capture limit for this space. No complete listing was available; reduce the requested output or inspect this large tree with Git directly before retrying.",
		);
	}
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
	return { status, stdout, stderr, signal: result.signal };
}

/** Harden every space operation independently of mutable local or global config. */
function spaceGitArguments(root: string, args: string[], readOnly?: boolean): string[] {
	const command = args.find(
		(arg, index) => !arg.startsWith("-") && (index === 0 || args[index - 1] !== "-c"),
	);
	const reads = new Set([
		"status",
		"log",
		"diff",
		"ls-files",
		"ls-tree",
		"rev-parse",
		"rev-list",
		"merge-base",
		"cat-file",
		"ls-remote",
		"show-ref",
		"for-each-ref",
		"check-ref-format",
	]);
	return [
		"--git-dir",
		spaceGitDir(root),
		"--work-tree",
		root,
		...(readOnly ||
		reads.has(command ?? "") ||
		(command === "config" && args.some((arg) => ["--get", "--get-all", "--list"].includes(arg))) ||
		(command === "symbolic-ref" && args.includes("-q"))
			? ["--no-optional-locks"]
			: []),
		"-c",
		"core.fsmonitor=false",
		"-c",
		"core.hooksPath=/dev/null",
		...args,
	];
}

export interface SpaceBlobPrefix {
	size: number;
	prefix: Buffer;
}

/**
 * One batch-check and one streaming batch reader, regardless of path count. Blob IDs
 * come from the index/tree, never from filenames interpreted as revisions. Large
 * blobs are drained without retaining their bodies; even they get a prefix check.
 */
export async function readSpaceBlobPrefixes(
	root: string,
	hashes: readonly string[],
	limit = 4096,
): Promise<Map<string, SpaceBlobPrefix>> {
	const unique = [...new Set(hashes)];
	const result = new Map<string, SpaceBlobPrefix>();
	if (unique.length === 0) return result;
	if (
		!Number.isSafeInteger(limit) ||
		limit < 1 ||
		limit > 1024 * 1024 ||
		unique.some((hash) => !/^[0-9a-f]{40,64}$/.test(hash))
	)
		throw new SpaceGitError(
			"Invalid blob inspection request; inspect the space index before retrying.",
		);
	const input = `${unique.join("\n")}\n`;
	const checked = spaceGit(root, ["cat-file", "--batch-check"], {
		input,
		readOnly: true,
		maxBuffer: Math.max(1024 * 1024, unique.length * 128),
	});
	for (const line of checked.stdout.trimEnd().split("\n")) {
		const [hash, type, rawSize] = line.split(" ");
		const size = Number(rawSize);
		if (type !== "blob" || !Number.isSafeInteger(size) || size < 0)
			throw new SpaceGitError(
				`Cannot inspect blob ${hash}; repair the space history before retrying.`,
			);
		result.set(hash, { size, prefix: Buffer.alloc(Math.min(limit, size)) });
	}
	const child = spawn("git", spaceGitArguments(root, ["cat-file", "--batch"], true), {
		cwd: root,
		env: cleanGitEnv(),
		stdio: ["pipe", "pipe", "pipe"],
	});
	// The batch reader yields to the event loop, unlike spawnSync: forward a
	// signal addressed only to this process rather than silently swallowing it.
	const onInt = () => {
		child.kill("SIGINT");
	};
	const onTerm = () => {
		child.kill("SIGTERM");
	};
	process.on("SIGINT", onInt);
	process.on("SIGTERM", onTerm);
	let stderr = "";
	child.stderr.on("data", (chunk: Buffer) => {
		if (stderr.length < 4096) stderr += chunk.toString("utf8").slice(0, 4096 - stderr.length);
	});
	let spawnError: Error | undefined;
	const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
		child.on("error", (error) => {
			spawnError = error;
		});
		child.on("close", (code, signal) => resolve({ code, signal }));
	});
	child.stdin.on("error", () => {
		/* A killed reader closes stdin; close/signal below owns the error. */
	});
	child.stdin.end(input);
	let header = Buffer.alloc(0);
	let current: SpaceBlobPrefix | undefined;
	let consumed = 0;
	let separator = false;
	let index = 0;
	let failure: unknown;
	try {
		for await (const raw of child.stdout) {
			const chunk = raw as Buffer;
			let offset = 0;
			while (offset < chunk.length) {
				if (separator) {
					if (chunk[offset++] !== 10) throw new Error("Invalid batch blob delimiter");
					separator = false;
					current = undefined;
					index++;
				} else if (current) {
					const length = Math.min(chunk.length - offset, current.size - consumed);
					const keep = Math.min(length, Math.max(0, current.prefix.length - consumed));
					if (keep > 0) chunk.copy(current.prefix, consumed, offset, offset + keep);
					consumed += length;
					offset += length;
					if (consumed === current.size) separator = true;
				} else {
					const newline = chunk.indexOf(10, offset);
					const end = newline < 0 ? chunk.length : newline;
					header = Buffer.concat([header, chunk.subarray(offset, end)]);
					if (header.length > 200) throw new Error("Invalid batch blob header");
					offset = end;
					if (newline < 0) continue;
					offset++;
					const hash = unique[index];
					current = result.get(hash);
					if (!current || header.toString("ascii") !== `${hash} blob ${current.size}`)
						throw new Error("Unexpected batch blob");
					header = Buffer.alloc(0);
					consumed = 0;
					if (current.size === 0) separator = true;
				}
			}
		}
	} catch (error) {
		failure = error;
		child.kill("SIGKILL");
	}
	const terminal = await closed;
	process.off("SIGINT", onInt);
	process.off("SIGTERM", onTerm);
	if (terminal.signal === "SIGINT" || terminal.signal === "SIGTERM")
		throw new SpaceGitInterruptedError(terminal.signal);
	if (
		spawnError ||
		failure ||
		terminal.code !== 0 ||
		index !== unique.length ||
		header.length !== 0
	)
		throw new SpaceGitError(
			`I couldn't inspect space blobs. Retry after inspecting the index: ${spawnError?.message || (failure instanceof Error ? failure.message : stderr) || "incomplete Git batch output"}`,
		);
	return result;
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
		const init = spawnSync(
			"git",
			["-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "init", "--bare", gitDir],
			{
				encoding: "utf8",
				env: cleanGitEnv(),
			},
		);
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
		const result = spawnSync(
			"git",
			[
				"--git-dir",
				gitDir,
				"--no-optional-locks",
				"-c",
				"core.fsmonitor=false",
				"-c",
				"core.hooksPath=/dev/null",
				...args,
			],
			{
				encoding: "utf8",
				env: cleanGitEnv(),
			},
		);
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

/** Fetch only this space's branch (and no tags), ready for a guarded checkout. */
export function fetchSpaceClone(spaceRoot: string, branch: string): void {
	const refspec = `refs/heads/${branch}:refs/remotes/origin/${branch}`;
	spaceGit(spaceRoot, ["config", "--local", "remote.origin.fetch", refspec]);
	const result = spaceGit(spaceRoot, ["fetch", "--no-tags", "origin", refspec], {
		allowFailure: true,
	});
	if (result.status !== 0) {
		const detail = (result.stderr || result.stdout).trim();
		throw new SpaceGitError(
			/couldn't find remote ref|remote ref does not exist/i.test(detail)
				? `The manifest names ${branch}, but that branch is missing from your hyperdrive. Publish it from the original machine, then try again.`
				: `I couldn't fetch ${branch} from your hyperdrive. Check the remote URL, access and network, then try again. ${detail}`,
		);
	}
}

/** C0, C1 and DEL are never printed, whatever their source. */
const CONTROL_CHARACTERS = /[\p{Cc}\p{Cf}]/gu;

/**
 * Anything echoed to a terminal comes from a machine we may not trust: git
 * stderr, a manifest url, an SSH server's banner. Control characters are
 * stripped everywhere except newline and tab, which only ever break lines.
 */
export function sanitizeForTerminal(value: string): string {
	return value.replace(CONTROL_CHARACTERS, (character) =>
		character === "\n" || character === "\t" ? character : "",
	);
}

/**
 * Prefix every line of quoted child output, so a hostile server cannot print
 * a line that reads like one of hyper's own messages.
 */
export function quoteChildOutput(value: string, prefix = "git: "): string {
	return sanitizeForTerminal(value)
		.split("\n")
		.filter((line, index, lines) => line !== "" || index < lines.length - 1)
		.map((line) => `${prefix}${line}`)
		.join("\n");
}

/** Redact credentials line by line: userinfo first, then every query value. */
export function redactGitSecrets(value: string): string {
	return value.split("\n").map(redactLine).join("\n");
}

function redactLine(line: string): string {
	// A query value can carry a secret, and it is printed both in our url and
	// inside git's own line.
	let out = line.replace(/([?&][^=&\s]+)=([^&\s]*)/g, "$1=[redacted]");
	// Mask the whole credential span of an authority. The LAST `@` on the line
	// wins, because a malformed authority (`user:a@b@host`) would otherwise
	// expose everything between the two.
	const at = out.lastIndexOf("@");
	if (at >= 0) {
		const scheme = out.indexOf("://");
		if (scheme >= 0 && scheme < at)
			out = `${out.slice(0, scheme + 3)}[redacted]@${out.slice(at + 1)}`;
		else out = out.replace(/(^|[\s"'(])([\w.+-]+):([^\s@]+)@/g, "$1$2:[redacted]@");
	}
	return out;
}

export interface CloneProjectResult {
	/** The branch actually checked out: `default_branch`, or the remote's HEAD. */
	branch: string;
	requestedBranch: string;
	fellBack: boolean;
}

/**
 * Clone-time ONLY project provisioning. These are project git operations, not
 * space history operations: an explicit project git-dir, never the space's.
 * No later space operation may call this to alter an existing project (C-3).
 */
export function cloneProjectRepoBare(
	gitDir: string,
	url: string,
	defaultBranch: string,
	options: { allowLocal: boolean; interactive?: boolean; label?: string } = {
		allowLocal: false,
	},
): CloneProjectResult {
	if (!checkProjectBranchName(defaultBranch))
		throw new SpaceGitError("Invalid project default branch; repair the manifest before cloning.");
	if (existsSync(gitDir))
		throw new SpaceGitError(
			`A project repository already exists at ${gitDir}. Choose an empty clone target.`,
		);
	const label = options.label ? `${options.label}: ` : "";
	const safeUrl = redactGitSecrets(url);
	const interactive = options.interactive ?? !!(process.stdin.isTTY && process.stderr.isTTY);
	const env = cleanGitEnv();
	env.GIT_TERMINAL_PROMPT = interactive ? "1" : "0";
	// Also defeat inherited protocol.<helper>.allow and URL rewrite settings.
	env.GIT_ALLOW_PROTOCOL = options.allowLocal ? "https:ssh:file" : "https:ssh";
	if (!interactive) {
		// A credential that never prompts is the point of BatchMode, but the
		// user may rely on a specific SSH binary or identity. `GIT_SSH` alone
		// names a wrapper that need not understand `-o`, so it is left alone.
		if (env.GIT_SSH !== undefined && env.GIT_SSH_COMMAND === undefined) {
			// nothing to do: git will use GIT_SSH exactly as configured
		} else {
			env.GIT_SSH_COMMAND = sshCommandWithBatchMode(env.GIT_SSH_COMMAND || readConfiguredSsh(env));
		}
	}
	const protocols = [
		"-c",
		"core.fsmonitor=false",
		"-c",
		"core.hooksPath=/dev/null",
		"-c",
		"protocol.allow=never",
		"-c",
		"protocol.https.allow=always",
		"-c",
		"protocol.ssh.allow=always",
		...(options.allowLocal ? ["-c", "protocol.file.allow=always"] : []),
	];
	const run = (args: string[]): string => {
		const result = spawnSync("git", [...protocols, ...args], {
			encoding: "utf8",
			env,
			stdio: [interactive ? "inherit" : "ignore", "pipe", interactive ? "inherit" : "pipe"],
		});
		if (result.signal === "SIGINT" || result.signal === "SIGTERM") {
			throw new SpaceGitInterruptedError(result.signal);
		}
		if (result.error || result.status !== 0) {
			const detail = redactGitSecrets((result.stderr || result.stdout || "").trim());
			throw new SpaceGitError(
				`I couldn't recreate the project repository for ${label}${sanitizeForTerminal(safeUrl)} at ${gitDir}. ` +
					`Check its URL, access and default branch, then retry the clone. ` +
					(interactive
						? "See git's output above."
						: detail === ""
							? "git said nothing; credential prompts are disabled, so configure noninteractive credentials first."
							: `git said:\n${quoteChildOutput(detail)}`),
			);
		}
		return (result.stdout ?? "").trim();
	};
	// Reserve ownership atomically; a raced-in user directory is never removed.
	mkdirSync(gitDir);
	try {
		run(["clone", "--bare", ...(interactive ? ["--progress"] : []), "--", url, gitDir]);
		run([
			"--git-dir",
			gitDir,
			"config",
			"--local",
			"remote.origin.fetch",
			"+refs/heads/*:refs/remotes/origin/*",
		]);
		run(["--git-dir", gitDir, "fetch", ...(interactive ? ["--progress"] : []), "origin"]);
		const branch = resolveCloneBranch(gitDir, url, defaultBranch, run, label, safeUrl);
		run(["--git-dir", gitDir, "symbolic-ref", "HEAD", `refs/heads/${branch}`]);
		return { branch, requestedBranch: defaultBranch, fellBack: branch !== defaultBranch };
	} catch (error) {
		rmSync(gitDir, { recursive: true, force: true });
		throw error;
	}
}

/**
 * The user's own `core.sshCommand`, global or system scope only. Plain
 * `git clone` ignores a repository-local setting, so reading one from the
 * current directory would apply a command the user never asked for here.
 */
function readConfiguredSsh(env: NodeJS.ProcessEnv): string | undefined {
	for (const scope of ["--global", "--system"]) {
		const result = spawnSync(
			"git",
			[
				"-c",
				"core.fsmonitor=false",
				"-c",
				"core.hooksPath=/dev/null",
				"config",
				scope,
				"--get",
				"core.sshCommand",
			],
			{ encoding: "utf8", env },
		);
		if (result.signal === "SIGINT" || result.signal === "SIGTERM") {
			throw new SpaceGitInterruptedError(result.signal);
		}
		if (result.status === 0) {
			const value = (result.stdout ?? "").trim();
			if (value !== "") return value;
		}
	}
	return undefined;
}

/**
 * A manifest `default_branch` the remote does not have must not become a space's
 * HEAD: every later fetch, worktree and status would follow a ref that is not
 * there. Fall back to the remote's own HEAD branch and report both names.
 */
function resolveCloneBranch(
	gitDir: string,
	url: string,
	requested: string,
	run: (args: string[]) => string,
	label: string,
	safeUrl: string,
): string {
	const exists = (branch: string): boolean => {
		try {
			run([
				"--git-dir",
				gitDir,
				"rev-parse",
				"--verify",
				"--quiet",
				`refs/remotes/origin/${branch}`,
			]);
			return true;
		} catch {
			return false;
		}
	};
	if (exists(requested)) return requested;
	// `ls-remote --symref HEAD` is the remote's own answer, not a guess from
	// our ref advertisement order. It is REMOTE-supplied data and gets the
	// same validation the manifest branch gets: the value ends up in HEAD,
	// `worktrunk.default-branch` and `worktrunk.history`, which scripts read.
	const advertisement = run(["ls-remote", "--symref", "--", url, "HEAD"]);
	const head = advertisement
		.split("\n")
		// `ref: refs/heads/<name>\tHEAD` — the name stops at the tab.
		.map((line) => /^ref:\s+refs\/heads\/(\S+)/.exec(line)?.[1])
		.find((name): name is string => name !== undefined);
	if (head !== undefined && checkProjectBranchName(head) && exists(head)) return head;
	if (head !== undefined && !checkProjectBranchName(head)) {
		throw new SpaceGitError(
			`The remote ${label}${sanitizeForTerminal(safeUrl)} points HEAD at a branch name hyper cannot use (${JSON.stringify(sanitizeForTerminal(head))}). ` +
				`Fix the project's default branch on the original machine, then retry the clone.`,
		);
	}
	if (advertisement === "") {
		throw new SpaceGitError(
			`The project repository ${label}${sanitizeForTerminal(safeUrl)} has no commits yet, so it has no branch to check out. ` +
				`Push at least one commit to it, then retry the clone.`,
		);
	}
	throw new SpaceGitError(
		`The manifest names ${JSON.stringify(requested)} as the default branch for ${label}${sanitizeForTerminal(safeUrl)}, but the remote has no such branch and no usable HEAD either. ` +
			`Fix the project's default branch or its manifest entry, then retry the clone.`,
	);
}

/** Pure validation: no repository or network access, and no directory creation. */
export function checkProjectBranchName(branch: string): boolean {
	if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branch) || branch.includes("..")) return false;
	const result = spawnSync(
		"git",
		[
			"-c",
			"core.fsmonitor=false",
			"-c",
			"core.hooksPath=/dev/null",
			"check-ref-format",
			"--branch",
			branch,
		],
		{
			encoding: "utf8",
			env: cleanGitEnv(),
		},
	);
	if (result.signal === "SIGINT" || result.signal === "SIGTERM")
		throw new SpaceGitInterruptedError(result.signal);
	return result.status === 0;
}
