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
import { escapeControlCharacters, quoteForTerminal } from "#lib/terminal-text";
// C-16: only services/remote.ts may name an SSH program, so the command-shape
// knowledge lives there and is imported, not re-spelled here.
import { sshCommandWithBatchMode, sshCommandWithConnectTimeout } from "#services/remote";

// Re-exported: callers already import the escape from here.
export { escapeControlCharacters, quoteForTerminal };

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
 * A git command that exited non-zero. `said` is git's own stderr, raw, so a
 * caller that wraps the failure in its own sentence can quote it the same way
 * as every other child output (sanitised, `git: ` prefixed).
 */
export class SpaceGitCommandError extends SpaceGitError {
	constructor(readonly said: string) {
		super(gitSaid(said));
		this.name = "SpaceGitCommandError";
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
	const remote = REMOTE_COMMANDS.has(gitCommand(args) ?? "");
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
		env: remote
			? spaceRemoteEnv(spaceRoot, !!(process.stdin.isTTY && process.stderr.isTTY))
			: cleanGitEnv(),
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
		if (detail === "")
			throw new SpaceGitError(
				`git ${args[0] ?? ""} failed with exit code ${status} and said nothing.`,
			);
		throw new SpaceGitCommandError(detail);
	}
	return { status, stdout, stderr, signal: result.signal };
}

/** The git subcommand in an argument list, skipping `-c key=value` pairs. */
function gitCommand(args: readonly string[]): string | undefined {
	return args.find(
		(arg, index) => !arg.startsWith("-") && (index === 0 || args[index - 1] !== "-c"),
	);
}

/** Space git commands that reach the hyperdrive over the network. */
const REMOTE_COMMANDS = new Set(["push", "fetch", "ls-remote"]);

/** Seconds an ssh connection to the hyperdrive may take before git gives up. */
export const SPACE_SSH_CONNECT_TIMEOUT_SECONDS = 10;

/**
 * Child environment for a space command that talks to the hyperdrive.
 *
 * Every such call gets an ssh connect timeout, so an unreachable host fails
 * in seconds rather than after the operating system's TCP timeout. Off a
 * terminal (a hook, a detached worker, CI) it also gets BatchMode, the same
 * hardening clone has: nothing can wait for a passphrase no one will type.
 * `GIT_SSH` alone names a wrapper that need not understand `-o`, so it is
 * left exactly as configured. Otherwise the effective `core.sshCommand`
 * (space, global or system config) is kept and only gains the options.
 */
export function spaceRemoteEnv(root: string, interactive: boolean): NodeJS.ProcessEnv {
	const env = cleanGitEnv();
	if (env.GIT_SSH !== undefined && env.GIT_SSH_COMMAND === undefined) return env;
	let command = env.GIT_SSH_COMMAND || undefined;
	if (command === undefined) {
		const configured = spaceGit(root, ["config", "--get", "core.sshCommand"], {
			allowFailure: true,
		});
		const value = configured.status === 0 ? configured.stdout.trim() : "";
		command = value === "" ? undefined : value;
	}
	command = sshCommandWithConnectTimeout(command, SPACE_SSH_CONNECT_TIMEOUT_SECONDS);
	if (!interactive) command = sshCommandWithBatchMode(command);
	if (command !== undefined) env.GIT_SSH_COMMAND = command;
	return env;
}

export interface BoundedSpaceGitResult extends SpaceGitResult {
	/** The overall timeout expired and git's process group was killed. */
	timedOut: boolean;
}

/** Grace between SIGTERM and SIGKILL for a timed-out git process group. */
const KILL_GRACE_MS = 2000;
/** Each captured stream is cut here; diagnostics never need more. */
const BOUNDED_CAPTURE_LIMIT = 1024 * 1024;

/**
 * Run a space remote command with an overall time limit, never on a terminal.
 *
 * For the detached session-end worker, which nobody watches: git runs in its
 * own process group (with ssh and any helper under it) so that on expiry the
 * WHOLE group is killed. A plain `spawnSync` timeout would kill git alone and
 * then keep waiting for the pipes an orphaned ssh still holds open.
 */
export function spaceGitBounded(
	root: string,
	args: string[],
	timeoutMs: number,
): Promise<BoundedSpaceGitResult> {
	const env = spaceRemoteEnv(root, false);
	return new Promise((resolve) => {
		const child = spawn("git", spaceGitArguments(root, args), {
			cwd: root,
			env,
			stdio: ["ignore", "pipe", "pipe"],
			detached: true,
		});
		let stdout = "";
		let stderr = "";
		let timedOut = false;
		let settled = false;
		let hardKill: NodeJS.Timeout | undefined;
		const killGroup = (signal: NodeJS.Signals) => {
			if (child.pid === undefined) return;
			try {
				process.kill(-child.pid, signal);
			} catch {
				/* The group is already gone. */
			}
		};
		const timer = setTimeout(() => {
			timedOut = true;
			killGroup("SIGTERM");
			hardKill = setTimeout(() => killGroup("SIGKILL"), KILL_GRACE_MS);
		}, timeoutMs);
		const finish = (result: BoundedSpaceGitResult) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			if (hardKill !== undefined) clearTimeout(hardKill);
			resolve(result);
		};
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => {
			if (stdout.length < BOUNDED_CAPTURE_LIMIT) stdout += chunk;
		});
		child.stderr.on("data", (chunk: string) => {
			if (stderr.length < BOUNDED_CAPTURE_LIMIT) stderr += chunk;
		});
		child.on("error", (error) =>
			finish({
				status: 1,
				stdout,
				stderr: `I couldn't run git: ${error.message}. Is git installed and on your PATH?`,
				timedOut,
			}),
		);
		child.on("close", (code, signal) => {
			// Anything git left behind in its group (an ssh still connecting) goes too.
			if (timedOut) killGroup("SIGKILL");
			finish({ status: code ?? 1, stdout, stderr, signal, timedOut });
		});
	});
}

/** Harden every space operation independently of mutable local or global config. */
function spaceGitArguments(root: string, args: string[], readOnly?: boolean): string[] {
	const command = gitCommand(args);
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
				`There's a git dir at ${escapeControlCharacters(gitDir)}, but it isn't a hyper space git dir — it has no core.worktree. Move it aside and try again.`,
			);
		}
		if (worktree !== "../..") {
			throw new SpaceGitError(
				`There's a git dir at ${escapeControlCharacters(gitDir)}, but it isn't a hyper space git dir — its core.worktree points at ${escapeControlCharacters(worktree)}, not at this space. Move it aside and try again.`,
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
			throw new SpaceGitError(
				gitSaid(init.stderr ?? "") ||
					`git init --bare failed for ${escapeControlCharacters(gitDir)}`,
			);
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
			`The space git dir at ${escapeControlCharacters(spaceGitDir(spaceRoot))} says its cadence is ${quoteForTerminal(value)}, which isn't one of "manual", "session-end", "session-end+push". Fix it with \`git config --file <git dir>/config hyper.cadence <value>\`.`,
		);
	}
	return value as SyncCadence;
}

/** Write `hyper.cadence` into the space git dir's config. */
export function writeCadence(spaceRoot: string, cadence: SyncCadence): void {
	if (!ALLOWED_CADENCES.includes(cadence)) {
		throw new SpaceGitError(
			`${quoteForTerminal(cadence)} isn't a cadence I know — use "manual", "session-end" or "session-end+push".`,
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
			`I couldn't read the space's tracked directories from ${escapeControlCharacters(spaceGitDir(spaceRoot))}: ` +
				`${gitSaid(stderr) || gitSaid(stdout) || `git config exited ${status}`}`,
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
				? `The manifest names ${escapeControlCharacters(branch)}, but that branch is missing from your hyperdrive. Publish it from the original machine, then try again.`
				: `I couldn't fetch ${escapeControlCharacters(branch)} from your hyperdrive. Check the remote URL, access and network, then try again. ${gitSaid(detail)}`,
		);
	}
}

/** C0, C1, DEL, format characters and line separators are never printed raw. */
const CONTROL_CHARACTERS = /[\p{Cc}\p{Cf}\u2028\u2029]/gu;

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

/** git's own words inline in a sentence: no credentials, no control characters. */
export function gitSaid(text: string): string {
	return sanitizeForTerminal(redactGitSecrets(text.trim()));
}

/** Prefix every line of quoted child output, so a hostile server cannot print
 * a line that reads like one of hyper's own messages. */
export function quoteChildOutput(value: string, prefix = "git: "): string {
	return sanitizeForTerminal(value)
		.split("\n")
		.filter((line, index, lines) => line !== "" || index < lines.length - 1)
		.map((line) => {
			// Cut on code points, never inside a surrogate pair: half a pair is
			// not a character any terminal can show.
			const points = Array.from(line);
			return points.length > QUOTED_LINE_CAP
				? `${prefix}${points.slice(0, QUOTED_LINE_CAP).join("")}… [truncated]`
				: `${prefix}${line}`;
		})
		.join("\n");
}

/**
 * A server can print a megabyte in one line, and quoting it verbatim buries
 * the message it was quoted for. The cut is stated, never silent.
 */
const QUOTED_LINE_CAP = 2_000;

/**
 * How many review paths a human-readable report names before it points at
 * `--json`. A space with a vendored tool directory can review in the hundreds,
 * and a single line that long is unreadable and buries the clone summary.
 */
export const REVIEW_PATHS_SHOWN = 20;

/**
 * What the review step knows about one reported path, without reading git
 * again: its mode in the tip (or, for a deletion, in the base), and whether it
 * was reported only because it sits behind a reviewed symlink.
 */
export interface ReviewPathFacts {
	executable: boolean;
	symlink: boolean;
	/** Reached through a reviewed symlink rather than named for itself. */
	throughLink: boolean;
}

/** Risk classes, most dangerous first. The text list is cut in this order. */
const REVIEW_CLASSES = [
	{ singular: "settings or hook file", plural: "settings or hook files" },
	{ singular: "executable", plural: "executables" },
	{ singular: "symlink", plural: "symlinks" },
	{ singular: "instruction file", plural: "instruction files" },
	{ singular: "other file", plural: "other files" },
] as const;

const INSTRUCTION_NAMES = new Set([
	"claude.md",
	"claude.local.md",
	"agents.md",
	"gemini.md",
	"hyper.md",
	"memory.md",
]);

/**
 * The risk class of one review path, 0 (settings and hooks, which run
 * commands without anyone asking) to 4 (anything else). Pure: the facts come
 * from the review step that already listed the trees.
 */
export function reviewPathClass(path: string, facts?: ReviewPathFacts): number {
	const lower = path.normalize("NFC").toLowerCase();
	const name = lower.slice(lower.lastIndexOf("/") + 1);
	const under = (directory: string): boolean => lower.startsWith(directory);
	const markdown = name.endsWith(".md");
	if (
		/^\.claude\/settings[^/]*\.json$/.test(lower) ||
		under(".claude/hooks/") ||
		under(".config/") ||
		// Every `.vscode/*.json`: tasks.json can run on folder open, and
		// launch.json names programs to start.
		(under(".vscode/") && name.endsWith(".json")) ||
		((under(".cursor/") || under(".codex/") || under(".pi/")) && !markdown) ||
		(under(".hyper/") && (facts?.executable || name.includes("hook")))
	)
		return 0;
	// A script a settings file runs through an interpreter needs no execute
	// bit, so anything in an agent directory that is not instruction markdown
	// counts as something that can run (`.claude/statusline.sh`,
	// `.claude/output-styles/*.md`, `.hyper/` outside memory).
	const instructionMarkdown =
		markdown &&
		(under(".claude/commands/") ||
			under(".claude/agents/") ||
			under(".claude/skills/") ||
			under(".claude/memory/"));
	const hyperMemory = under(".hyper/memory/") || lower === ".hyper/memory";
	if (
		facts?.executable ||
		under("bin/") ||
		(under(".claude/") && !instructionMarkdown) ||
		(under(".hyper/") && !hyperMemory && !markdown)
	)
		return 1;
	if (facts?.symlink || facts?.throughLink) return 2;
	if (
		INSTRUCTION_NAMES.has(name) ||
		under(".claude/commands/") ||
		under(".claude/agents/") ||
		under(".claude/skills/") ||
		under(".hyper/memory/") ||
		lower === ".hyper/memory" ||
		((under(".cursor/") || under(".codex/") || under(".pi/")) && markdown)
	)
		return 3;
	return 4;
}

/**
 * The review list for a terminal: most dangerous first (alphabetical within a
 * class), the first {@link REVIEW_PATHS_SHOWN} of them, and how many of each
 * class were left out. `paths` itself is never reordered: `--json` keeps the
 * complete list in its sorted order.
 */
export function orderReviewPaths(
	paths: readonly string[],
	facts: ReadonlyMap<string, ReviewPathFacts> = new Map(),
): { shown: string[]; hidden: number; hiddenSummary: string } {
	const ranked = paths
		.map((path) => ({ path, rank: reviewPathClass(path, facts.get(path)) }))
		.sort((left, right) =>
			left.rank !== right.rank
				? left.rank - right.rank
				: left.path < right.path
					? -1
					: left.path > right.path
						? 1
						: 0,
		);
	const shown = ranked.slice(0, REVIEW_PATHS_SHOWN).map((entry) => entry.path);
	const counts = new Array<number>(REVIEW_CLASSES.length).fill(0);
	for (const entry of ranked.slice(REVIEW_PATHS_SHOWN)) counts[entry.rank] += 1;
	const hidden = ranked.length - shown.length;
	const hiddenSummary = counts
		.map((count, rank) =>
			count === 0
				? ""
				: `${count} ${count === 1 ? REVIEW_CLASSES[rank].singular : REVIEW_CLASSES[rank].plural}`,
		)
		.filter(Boolean)
		.join(", ");
	return {
		shown,
		hidden,
		hiddenSummary:
			hidden === 0 ? "" : `and ${hidden} more: ${hiddenSummary}; run with --json to see them all`,
	};
}

/**
 * The review list as text, risk-ordered and bounded by
 * {@link orderReviewPaths}. `--json` output is never truncated or reordered —
 * this is for the terminal only.
 */
export function describeReviewPaths(
	paths: readonly string[],
	facts?: ReadonlyMap<string, ReviewPathFacts>,
): string {
	const { shown, hiddenSummary } = orderReviewPaths(paths, facts);
	const list = shown.map((path) => quoteForTerminal(path)).join(", ");
	return hiddenSummary === ""
		? `${list}: these came from the hyperdrive; review before trusting this space.`
		: `${list} (${hiddenSummary}): these came from the hyperdrive; review before trusting this space.`;
}

/** Redact credentials line by line: userinfo first, then every query value. */
export function redactGitSecrets(value: string): string {
	return value.split("\n").map(redactLine).join("\n");
}

function redactLine(line: string): string {
	// A query value can carry a secret, and it is printed both in our url and
	// inside git's own line.
	const masked = line.replace(/([?&][^=&\s]+)=([^&\s]*)/g, "$1=[redacted]");
	// Userinfo lives in the AUTHORITY: between `scheme://` and the LAST `@`
	// before the next `/` or whitespace. Every url on the line is handled,
	// wherever it sits. An unencoded `@` inside the password
	// (`user:prefix@password-value@host`) is still userinfo, so the match runs to the last
	// `@`; an `@` after the first `/` belongs to a path (`/a@b/c`), and masking
	// there would invent a host the user never configured.
	// No punctuation stops the authority: a password may contain `,`, `;`,
	// quotes or `)` unencoded, and stopping there would print it. The price
	// is over-redaction when an email follows a url with no whitespace
	// between (`'https://h',admin@example.com` loses its host): hiding a host
	// is acceptable, leaking a secret is not.
	const urls = masked.replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^/\s]*@/gi, "$1[redacted]@");
	// A bare `user:secret@host` with no scheme. The `//` guard keeps a url
	// redacted above from being read as `scheme:password@`. scp-like
	// `user@host:path` has no colon before the `@` and is not a secret.
	return urls.replace(/(^|[\s"'(])([\w.+-]+):(?!\/\/)([^\s@]+)@/g, "$1$2:[redacted]@");
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
			`A project repository already exists at ${escapeControlCharacters(gitDir)}. Choose an empty clone target.`,
		);
	const label = options.label ? `${escapeControlCharacters(options.label)}: ` : "";
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
				`I couldn't recreate the project repository for ${label}${escapeControlCharacters(safeUrl)} at ${escapeControlCharacters(gitDir)}. ` +
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
				// `--includes` is not optional: with a file scope git otherwise
				// ignores `[include]`/`[includeIf]`, so an ssh command kept in
				// an included file would be dropped and our default would win.
				"--includes",
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
			`The remote ${label}${escapeControlCharacters(safeUrl)} points HEAD at a branch name hyper cannot use (${quoteForTerminal(head)}). ` +
				`Fix the project's default branch on the original machine, then retry the clone.`,
		);
	}
	if (advertisement === "") {
		throw new SpaceGitError(
			`The project repository ${label}${escapeControlCharacters(safeUrl)} has no commits yet, so it has no branch to check out. ` +
				`Push at least one commit to it, then retry the clone.`,
		);
	}
	throw new SpaceGitError(
		`The manifest names ${quoteForTerminal(requested)} as the default branch for ${label}${escapeControlCharacters(safeUrl)}, but the remote has no such branch and no usable HEAD either. ` +
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

/**
 * The branch a worktree has checked out, or null when it is not a worktree at
 * all or the checkout is detached.
 *
 * A PROJECT-repo call, not a space one: this reads the worktree's own `.git`
 * (which for a space worktree is a FILE holding an absolute path to the
 * space's bare git dir), and it deliberately does NOT go through `spaceGit()` —
 * that would force `--git-dir <space>/.hyper/space.git`, which is the space's
 * own history, a completely different repository whose branch says nothing
 * about the code the user is working on.
 *
 * It lives in this file anyway because C-2 makes this the only place allowed
 * to name the `git` binary at all. See `pushProjectBranch` below.
 */
export function projectWorktreeBranch(worktree: string): string | null {
	const head = projectWorktreeHead(worktree);
	return head.state === "branch" ? head.branch : null;
}

/**
 * What a worktree has checked out: a branch, a detached HEAD, or nothing git
 * can read (not a worktree, unborn branch, no git).
 *
 * Kept apart from {@link projectWorktreeBranch} so a caller can tell the user
 * WHY there is no branch: "check out a branch first" for a detached HEAD is an
 * instruction, "couldn't work out which space" is not.
 */
export function projectWorktreeHead(
	worktree: string,
): { state: "branch"; branch: string } | { state: "detached" } | { state: "unreadable" } {
	const result = spawnSync(
		"git",
		[
			"-C",
			worktree,
			"--no-optional-locks",
			"-c",
			"core.fsmonitor=false",
			"-c",
			"core.hooksPath=/dev/null",
			"rev-parse",
			"--abbrev-ref",
			"HEAD",
		],
		{ encoding: "utf8", env: cleanGitEnv() },
	);
	if (result.error || result.status !== 0) return { state: "unreadable" };
	const branch = (result.stdout ?? "").trim();
	// A detached HEAD answers "HEAD", which is not a branch and would make a
	// push refspec of `refs/heads/HEAD` — a real, wrong branch name.
	if (branch === "HEAD") return { state: "detached" };
	return branch === "" ? { state: "unreadable" } : { state: "branch", branch };
}

/**
 * Push the worktree's current HEAD to an EXPLICIT URL, never to a remote name
 * (C-9).
 *
 * This is the second git call warp makes and the one that can do damage, so it
 * is the one with the strictest shape:
 *
 * - `url` is always an `ssh://…` URL built from the target's machine entry
 *   (`sshUrl()` in services/remote.ts). There is deliberately NO code path
 *   that takes a remote NAME: `git push origin …` on the target would write to
 *   whatever `origin` is configured there, and the operator's own `origin` is
 *   the one remote a warp must never touch by accident.
 * - the refspec is built here from a branch that {@link projectWorktreeBranch}
 *   read and {@link checkProjectBranchName} accepted, so a branch name is
 *   never a free-form argument that could become `--force` or an option.
 * - `--` ends git's option parsing before the URL.
 *
 * Hooks are disabled (`core.hooksPath=/dev/null`) for the same reason every
 * other call here does, and prompts are off (from `cleanGitEnv()`), so a push
 * can never block on a credential prompt: it fails, and warp says so.
 */
export function pushProjectBranch(options: {
	/** The worktree directory holding the commits to push. */
	worktree: string;
	/** Explicit `ssh://` URL. Never a remote name. */
	url: string;
	/** Branch {@link projectWorktreeBranch} read from the worktree. */
	branch: string;
	/**
	 * `--dry-run`: contact the target and decide (fast-forward or not, new
	 * branch or not) without updating anything there. Warp runs this in its
	 * read-only probe block so a push that would be rejected is refused
	 * before anything is changed.
	 */
	dryRun?: boolean;
	/**
	 * The branch is checked out in a worktree on the target AT THE SAME PATH
	 * as this one (a re-warp). receive-pack refuses to move a checked-out
	 * branch by default ("branch is currently checked out"), so the TARGET's
	 * receive-pack is run with `receive.denyCurrentBranch=ignore` for this
	 * one push. Safe only because warp then runs `git reset` (mixed) in that
	 * worktree, so its index matches the new HEAD, and copies the files.
	 * Never set it for a branch checked out anywhere else: warp refuses that.
	 */
	checkedOutAtSamePath?: boolean;
}): { url: string; branch: string; refspec: string } {
	if (!checkProjectBranchName(options.branch)) {
		throw new SpaceGitError(
			`${JSON.stringify(options.branch)} isn't a branch name git would accept, so warp won't push it.`,
		);
	}
	if (!options.url.startsWith("ssh://")) {
		throw new SpaceGitError(
			`refusing to push to ${JSON.stringify(options.url)}: warp only pushes to an explicit ssh:// URL built from the target's machine entry, never to a remote name.`,
		);
	}
	const refspec = `HEAD:refs/heads/${options.branch}`;
	const [program, ...args] = projectPushArgv(options);
	const result = spawnSync(program as string, args, { encoding: "utf8", env: cleanGitEnv() });
	if (result.signal === "SIGINT" || result.signal === "SIGTERM") {
		throw new SpaceGitInterruptedError(result.signal);
	}
	if (result.error) {
		throw new SpaceGitError(
			`I couldn't run git push: ${result.error.message}. Is git installed and on your PATH?`,
		);
	}
	if (result.status !== 0) {
		const detail = (result.stderr ?? "").trim();
		throw new SpaceGitError(
			`I couldn't push ${options.branch} to ${options.url}${detail ? `: ${detail}` : ` (git push exited ${result.status})`}. Check that the path is a bare repository hyperdrive can write to and that your key is accepted there.`,
		);
	}
	return { url: options.url, branch: options.branch, refspec };
}

/**
 * The full argv {@link pushProjectBranch} spawns, program first. Exported so
 * warp's `--dry-run` prints the exact command it would run.
 */
export function projectPushArgv(options: {
	worktree: string;
	url: string;
	branch: string;
	dryRun?: boolean;
	checkedOutAtSamePath?: boolean;
}): string[] {
	return [
		"git",
		"-C",
		options.worktree,
		"-c",
		"core.fsmonitor=false",
		"-c",
		"core.hooksPath=/dev/null",
		"push",
		...(options.dryRun ? ["--dry-run"] : []),
		...(options.checkedOutAtSamePath
			? ["--receive-pack=git -c receive.denyCurrentBranch=ignore receive-pack"]
			: []),
		"--",
		options.url,
		`HEAD:refs/heads/${options.branch}`,
	];
}

/**
 * The commands warp runs ON THE TARGET for a space worktree, as argv for
 * `MachineRunner.ssh` (services/remote.ts quotes them for the remote shell).
 *
 * They live here, not in services/warp.ts, because C-2 makes this the one file
 * that may name the git binary; warp only sends what these return. None of
 * them run anything on this machine.
 */
const TARGET_GIT_SAFETY = ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false"];

/** Exit 0 when `bare` is a bare git repository on the target. */
export function targetBareRepoCheck(bare: string): string[] {
	return ["git", `--git-dir=${bare}`, "rev-parse", "--is-bare-repository"];
}

/**
 * Register `worktree` as a worktree of `bare` on `branch`, WITHOUT checking
 * any file out: the files arrive by copy right after, and a checkout here would
 * only be overwritten (or, for a file the copy excludes, left as a stale
 * version). `--no-checkout` also skips the post-checkout hook; hooks are off
 * anyway.
 */
export function targetWorktreeAdd(bare: string, worktree: string, branch: string): string[] {
	return [
		"git",
		`--git-dir=${bare}`,
		...TARGET_GIT_SAFETY,
		"worktree",
		"add",
		"--no-checkout",
		"--",
		worktree,
		branch,
	];
}

/**
 * A mixed `git reset` in the target's worktree: the index is rebuilt from HEAD
 * and NO file is touched. After a `--no-checkout` add (or after a push moved
 * a checked-out branch) the index is empty or stale; this makes `git status`
 * report the copied files against HEAD. Staged-but-uncommitted state on the
 * source does not travel: it arrives as unstaged modifications.
 */
export function targetWorktreeReset(worktree: string): string[] {
	return ["git", "-C", worktree, ...TARGET_GIT_SAFETY, "reset", "-q"];
}

/**
 * Exit codes of {@link targetWorktreeState}. 0 and 1 are the answer; every
 * other code is a reason warp must refuse before it changes anything.
 */
export const TARGET_WORKTREE_STATE = {
	/** A worktree of `bare` is registered at the path, on the branch. */
	registeredHere: 0,
	/** Nothing is registered at the path, and the path is absent or empty. */
	absent: 1,
	/** `worktree list` itself failed (not a repo, unreadable). */
	unreadable: 3,
	/** A worktree is registered at the path on ANOTHER branch (or detached). */
	otherBranchHere: 20,
	/** The branch is checked out in a worktree at a DIFFERENT path. */
	branchElsewhere: 21,
	/** The path exists, is not empty, and is not a registered worktree. */
	occupied: 22,
	/** Registered at the path, but the directory (or its `.git`) is gone. */
	registeredButMissing: 23,
} as const;

/**
 * A read-only script for the target: is `worktree` a registered worktree of
 * `bare`, on `branch`? Answers through its exit code
 * ({@link TARGET_WORKTREE_STATE}). Runs `git worktree list --porcelain`, whose
 * records are blank-line separated, and reads them with awk's paragraph mode
 * (`RS=""`, POSIX, so mawk on Debian handles it).
 *
 * The paths are interpolated, single-quoted, into the script: callers only
 * pass paths that services/remote.ts's path rule already accepted (no quote can
 * appear in them), and the quoting is there anyway.
 */
export function targetWorktreeState(bare: string, worktree: string, branch: string): string[] {
	const quote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;
	const states = TARGET_WORKTREE_STATE;
	const awk = [
		'BEGIN { RS = ""; FS = "\\n" }',
		'{ p = ""; br = "";',
		"  for (i = 1; i <= NF; i++) { if ($i ~ /^worktree /) p = substr($i, 10); else if ($i ~ /^branch /) br = substr($i, 8) }",
		"  if (p == w) { if (br == b) here = 1; else other = 1 } else if (br == b) elsewhere = 1 }",
		`END { if (other) exit ${states.otherBranchHere}; if (elsewhere) exit ${states.branchElsewhere}; if (here) exit ${states.registeredHere}; exit ${states.absent} }`,
	].join("\n");
	const script = [
		`g=${quote(bare)}; w=${quote(worktree)}; b=${quote(`refs/heads/${branch}`)}`,
		`list=$(git --git-dir="$g" worktree list --porcelain) || exit ${states.unreadable}`,
		`printf '%s\\n' "$list" | awk -v w="$w" -v b="$b" ${quote(awk)}`,
		"rc=$?",
		`if [ "$rc" -eq ${states.registeredHere} ] && [ ! -e "$w/.git" ]; then exit ${states.registeredButMissing}; fi`,
		`if [ "$rc" -eq ${states.absent} ] && [ -e "$w" ]; then if [ ! -d "$w" ] || [ -n "$(ls -A "$w" 2>/dev/null)" ]; then exit ${states.occupied}; fi; fi`,
		'exit "$rc"',
	].join("\n");
	return ["sh", "-c", script];
}

/** Exit code of {@link targetStatusCheck} when the target's copy has uncommitted work. */
export const TARGET_DIRTY = 25;
/** Exit code of {@link targetStatusCheck}: a merge, rebase, cherry-pick, revert or bisect is in progress. */
export const TARGET_IN_PROGRESS = 26;
/** Exit code of {@link targetStatusCheck}: the index has unresolved conflicts. */
export const TARGET_CONFLICTED = 27;
/** Exit code of {@link targetStatusCheck}: a submodule has changes (inside it, or its commit). */
export const TARGET_SUBMODULE_CHANGED = 28;

/**
 * The read-only git every target probe runs, as a shell function `g` over the
 * repository at `$w`: no optional index lock (so `status` never refreshes the
 * index), no fsmonitor hook and no hooks at all, whatever the target's
 * repository configures.
 */
const TARGET_READ_ONLY_GIT =
	'g() { git -C "$w" --no-optional-locks -c core.fsmonitor=false -c core.hooksPath=/dev/null "$@"; }';

/**
 * A read-only script for the target: may warp overwrite the repository or
 * worktree at `worktree`? Exits 0 when there is no `.git` there. Otherwise, in
 * this order, it refuses with:
 *
 *  - {@link TARGET_IN_PROGRESS} (printing which) when a merge, rebase (or
 *    `git am`), cherry-pick, revert or bisect is in progress;
 *  - {@link TARGET_CONFLICTED} (printing the paths) when the index has
 *    unresolved conflicts;
 *  - {@link TARGET_SUBMODULE_CHANGED} (printing the paths) when a submodule
 *    has changes, inside it or to its recorded commit;
 *  - {@link TARGET_DIRTY} (printing `git status --porcelain`) when anything is
 *    uncommitted, unless `force` (a `--force` warp saves that work first).
 *
 * The first three hold with `force` too: nothing a warp saves can carry them.
 * Exit 3 when git itself failed.
 */
export function targetStatusCheck(worktree: string, options: { force?: boolean } = {}): string[] {
	const quote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;
	const awkSubmodules = [
		'($1 == "1" || $1 == "2") && $3 ~ /^S/ {',
		'  n = ($1 == "1") ? 8 : 9; p = $0',
		'  for (i = 0; i < n; i++) sub(/^[^ ]* /, "", p)',
		"  print p }",
	].join("\n");
	const script = [
		`w=${quote(worktree)}`,
		'[ -e "$w/.git" ] || exit 0',
		TARGET_READ_ONLY_GIT,
		"state() {",
		'  p=$(g rev-parse --git-path "$1") || exit 3',
		'  case "$p" in /*) ;; *) p="$w/$p" ;; esac',
		`  if [ -e "$p" ]; then printf 'a %s is in progress\\n' "$2"; exit ${TARGET_IN_PROGRESS}; fi`,
		"}",
		"state MERGE_HEAD merge",
		"state rebase-merge rebase",
		'state rebase-apply "rebase (or git am)"',
		"state CHERRY_PICK_HEAD cherry-pick",
		"state REVERT_HEAD revert",
		"state BISECT_LOG bisect",
		"u=$(g ls-files --unmerged) || exit 3",
		`if [ -n "$u" ]; then printf '%s\\n' "$u" | cut -f2- | sort -u; exit ${TARGET_CONFLICTED}; fi`,
		"v=$(g status --porcelain=v2 --ignore-submodules=none) || exit 3",
		`s=$(printf '%s\\n' "$v" | awk ${quote(awkSubmodules)})`,
		`if [ -n "$s" ]; then printf '%s\\n' "$s"; exit ${TARGET_SUBMODULE_CHANGED}; fi`,
		...(options.force
			? ["exit 0"]
			: [
					"out=$(g status --porcelain --ignore-submodules=none) || exit 3",
					'[ -z "$out" ] && exit 0',
					`printf '%s\\n' "$out"`,
					`exit ${TARGET_DIRTY}`,
				]),
	].join("\n");
	return ["sh", "-c", script];
}

/**
 * A read-only script for the target: what of the repository at `worktree` the
 * collision check must look at, NUL-separated. Prints nothing when there is no
 * `.git` there. Exit 3 when git failed.
 *
 *  - Every untracked OR ignored path (`git ls-files --others --directory`: no
 *    exclude rules, so ignored files are listed too; a directory whose whole
 *    content is untracked is listed once, with a trailing `/`).
 *  - Then, each prefixed with `/` (no path git prints starts with one), the
 *    directories the target TRACKS: the parent directory of every index entry
 *    (consecutive duplicates dropped), and every index entry that is a real
 *    directory on disk there (`ls-files --modified`, then `-d` and not `-L`:
 *    a target left half-way, its index already this machine's, the directory
 *    still on disk). A file here at one of those paths can't be copied over
 *    it, so it is a type-change collision.
 */
export function targetUntrackedPaths(worktree: string): string[] {
	const quote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;
	const parents = [
		'l=""; for p in "$@"; do case "$p" in */*)',
		// biome-ignore lint/suspicious/noTemplateCurlyInString: shell parameter expansion, not a template.
		'  d=${p%/*}; if [ "$d" != "$l" ]; then printf \'/%s\\000\' "$d"; l=$d; fi ;;',
		"esac; done",
	].join("\n");
	const directories = [
		'for p in "$@"; do',
		'  if [ -d "./$p" ] && [ ! -L "./$p" ]; then printf \'/%s\\000\' "$p"; fi',
		"done",
	].join("\n");
	const script = [
		`w=${quote(worktree)}`,
		'[ -e "$w/.git" ] || exit 0',
		'cd "$w" || exit 3',
		TARGET_READ_ONLY_GIT,
		"g ls-files -z --others --directory || exit 3",
		`g ls-files -z | xargs -0 sh -c ${quote(parents)} sh || exit 3`,
		`g ls-files -z --modified | xargs -0 sh -c ${quote(directories)} sh || exit 3`,
	].join("\n");
	return ["sh", "-c", script];
}

/**
 * A script for the target that COPIES entries of the repository at `worktree`
 * aside before a `--force` warp overwrites them: into
 * `<git common dir>/hyper-warp-backup/<id>/`, relative paths kept, every
 * directory it creates mode 0700, each entry with its modes and times
 * (`cp -pPR`: a symlink is copied as a symlink, a directory with everything in
 * it). The entries arrive on stdin, NUL-separated, each prefixed with `K`
 * (keep: the copy overwrites it in place) or `R` (replace: a type change the
 * copy can't overwrite). Only once EVERY entry is copied are the `R` entries
 * removed (`rm -rf` on the entry itself: a symlink is removed, never
 * followed). Prints the backup directory. Fails (non-zero) when the directory
 * already exists, or any entry can't be copied or removed; exits 7, before
 * copying or removing anything, when an entry is empty, absolute or has a
 * `..` component.
 */
export function targetBackupCopy(worktree: string, id: string): string[] {
	const quote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;
	const copyEach = [
		'b=$1; shift; for e in "$@"; do',
		// biome-ignore lint/suspicious/noTemplateCurlyInString: shell parameter expansion, not a template.
		'  p=${e#?}; d=$(dirname "./$p")',
		'  mkdir -p "$b/$d" && cp -pPR "./$p" "$b/$p" || exit 255',
		"done",
	].join("\n");
	// Every entry is checked before anything is copied or removed: a path
	// from git or this machine's walk never has these, but the removal must
	// never reach outside the repository whatever it is given.
	const checkEach = [
		'for e in "$@"; do',
		'  case "$e" in K?*|R?*) ;; *) printf \'refusing the backup entry "%s"\\n\' "$e" >&2; exit 255 ;; esac',
		// biome-ignore lint/suspicious/noTemplateCurlyInString: shell parameter expansion, not a template.
		'  case "/${e#?}/" in */../*|//*) printf \'refusing the path "%s": absolute or with a .. component\\n\' "${e#?}" >&2; exit 255 ;; esac',
		"done",
	].join("\n");
	const removeEach = [
		'for e in "$@"; do',
		// biome-ignore lint/suspicious/noTemplateCurlyInString: shell parameter expansion, not a template.
		'  case "$e" in R*) rm -rf "./${e#?}" || exit 255 ;; esac',
		"done",
	].join("\n");
	const script = [
		`w=${quote(worktree)}; id=${quote(id)}`,
		'cd "$w" || exit 3',
		TARGET_READ_ONLY_GIT,
		"gd=$(g rev-parse --git-common-dir) || exit 3",
		'case "$gd" in /*) ;; *) gd="$w/$gd" ;; esac',
		"umask 077",
		'mkdir -p "$gd/hyper-warp-backup" && chmod 700 "$gd/hyper-warp-backup" || exit 4',
		'b="$gd/hyper-warp-backup/$id"',
		'list="$b.list"',
		`trap 'rm -f "$list"' EXIT`,
		'cat > "$list" || exit 4',
		`xargs -0 sh -c ${quote(checkEach)} sh < "$list" || exit 7`,
		'mkdir "$b" || exit 4',
		`xargs -0 sh -c ${quote(copyEach)} sh "$b" < "$list" || exit 5`,
		`xargs -0 sh -c ${quote(removeEach)} sh < "$list" || exit 6`,
		`printf '%s\\n' "$b"`,
	].join("\n");
	return ["sh", "-c", script];
}

/** The ref namespace a `--force` plain-repo warp saves the target's refs under. */
export const WARP_REF_BACKUP = "refs/hyper-warp-backup";

/**
 * Exit code of {@link targetRefs}: the target's repository keeps its refs in
 * the reftable format (`extensions.refStorage=reftable`). A plain-repo warp
 * replaces `.git/config` with this machine's, which drops that setting, so
 * every ref there (a saved one too) would vanish from git's view.
 */
export const TARGET_REFTABLE = 29;

/**
 * Exit code of {@link targetRefs}: a ref lock (`<ref>.lock` under `refs/`, or
 * `packed-refs.lock`) exists in the target's repository, so the steps that
 * write refs there would fail half-way. The path is printed.
 */
export const TARGET_REF_LOCK = 30;

/**
 * What a plain-repo warp copies of `.git` leaves out, anchored at the `.git`
 * directory: the backups of earlier `--force` warps (entries and refs), which
 * stay as they are on the target. Nothing else in `.git` is excluded; in
 * particular the user's `warp.exclude` patterns (meant for the working tree)
 * never apply inside it. {@link isWarpCarriedRef} is derived from this list.
 */
export const WARP_GIT_DIR_EXCLUDES = ["/hyper-warp-backup", `/${WARP_REF_BACKUP}`];

/**
 * Does a plain-repo warp make the target's ref `name` equal to this
 * machine's? Every ref is, except those under an excluded path of
 * {@link WARP_GIT_DIR_EXCLUDES} (earlier warps' backups). After the copy, the
 * ref sync ({@link targetRefsSync}) sets each of these to this machine's
 * value and deletes the ones this machine doesn't have.
 */
export function isWarpCarriedRef(name: string): boolean {
	if (!name.startsWith("refs/")) return false;
	return !WARP_GIT_DIR_EXCLUDES.some((excluded) => `/${name}`.startsWith(`${excluded}/`));
}

/**
 * This machine's refs that a plain-repo warp carries to the target
 * ({@link isWarpCarriedRef}), as `{ object, name, symbolic }`, from the
 * repository at `worktree`. Read-only. Throws when git can't list them.
 */
export function warpCarriedRefs(
	worktree: string,
): { object: string; name: string; symbolic: boolean }[] {
	const listed = spawnSync(
		"git",
		[
			"-C",
			worktree,
			"--no-optional-locks",
			"-c",
			"core.fsmonitor=false",
			"for-each-ref",
			"--format=%(objectname) %(refname) %(symref)",
		],
		{ encoding: "utf8", env: cleanGitEnv(), maxBuffer: 256 * 1024 * 1024 },
	);
	if (listed.error || listed.status !== 0) {
		throw new SpaceGitError(
			`couldn't list the refs of ${worktree}: ${(listed.stderr ?? "").trim() || listed.error?.message}`,
		);
	}
	return (listed.stdout ?? "").split("\n").flatMap((line) => {
		const [object, name, symref] = line.split(" ");
		return object && name && isWarpCarriedRef(name)
			? [{ object, name, symbolic: Boolean(symref) }]
			: [];
	});
}

/**
 * A script for the target that makes the refs of the repository at
 * `worktree` equal to this machine's, after a plain-repo copy: stdin holds
 * this machine's carried refs ({@link warpCarriedRefs}), `<object> <refname>`
 * per line, or `- <refname>` for a symbolic ref (which the copy carries as its
 * file and the sync leaves alone). In ONE `git update-ref --no-deref --stdin`
 * transaction, every other one of them is set to that object, and every
 * target ref {@link isWarpCarriedRef} covers that is not in the list is
 * deleted (a symbolic ref itself, never what it points at). A loose ref and a packed one are
 * handled alike, so a stale loose ref there can't shadow this machine's
 * packed one. Earlier warps' backups are never touched. Only run after the
 * refs check passed (or `--force` saved the target's refs).
 */
export function targetRefsSync(worktree: string): string[] {
	const quote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;
	const keep = WARP_GIT_DIR_EXCLUDES.filter((path) => path.startsWith("/refs/")).map(
		(path) => `${path.slice(1)}/`,
	);
	const awk = [
		"NR == FNR { w[$2] = 1; next }",
		`{ for (i in k) if (index($1, k[i]) == 1) next }`,
		'index($1, "refs/") == 1 && !($1 in w) { print "delete " $1 }',
	].join("\n");
	const script = [
		`w=${quote(worktree)}`,
		'cd "$w" || exit 3',
		TARGET_READ_ONLY_GIT,
		"gd=$(g rev-parse --git-common-dir) || exit 3",
		'case "$gd" in /*) ;; *) gd="$w/$gd" ;; esac',
		't="$gd/hyper-warp-refs.$$"',
		`trap 'rm -f "$t"' EXIT`,
		'cat > "$t" || exit 4',
		"{",
		`  g for-each-ref --format='%(refname)' | awk -v keep=${quote(keep.join(" "))} 'BEGIN { split(keep, k, " ") }
${awk}' "$t" - || exit 5`,
		`  awk 'NF == 2 && $1 != "-" { print "update " $2 " " $1 }' "$t" || exit 5`,
		'} > "$t.cmd" || { rm -f "$t.cmd"; exit 5; }',
		'g update-ref --no-deref --stdin < "$t.cmd"; rc=$?; rm -f "$t.cmd"',
		'[ "$rc" -eq 0 ] || exit 6',
		"exit 0",
	].join("\n");
	return ["sh", "-c", script];
}

/**
 * A read-only script for the target: the refs of the repository at
 * `worktree`, one `<object> <refname> <peeled>` line each (`<peeled>` is the
 * commit an annotated tag points at, empty otherwise), and `<commit> HEAD`
 * when HEAD is detached. Refs under {@link WARP_REF_BACKUP} (earlier warps'
 * backups) are left out. Prints nothing when there is no `.git` there. Exits
 * {@link TARGET_REFTABLE} when the repository's config sets
 * `extensions.refStorage` to `reftable`, and {@link TARGET_REF_LOCK} (printing
 * the path) when a `<ref>.lock` or `packed-refs.lock` exists, before listing
 * anything.
 */
export function targetRefs(worktree: string): string[] {
	const quote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;
	const script = [
		`w=${quote(worktree)}`,
		'[ -e "$w/.git" ] || exit 0',
		TARGET_READ_ONLY_GIT,
		"f=$(g config --get extensions.refStorage)",
		`case "$f" in [Rr][Ee][Ff][Tt][Aa][Bb][Ll][Ee]) echo "extensions.refStorage=$f"; exit ${TARGET_REFTABLE} ;; esac`,
		"gd=$(g rev-parse --git-common-dir) || exit 3",
		'case "$gd" in /*) ;; *) gd="$w/$gd" ;; esac',
		'l=""; [ -e "$gd/packed-refs.lock" ] && l="$gd/packed-refs.lock"',
		'[ -n "$l" ] || l=$(find "$gd/refs" -name \'*.lock\' -print 2>/dev/null | head -n 1)',
		`if [ -n "$l" ]; then printf '%s\\n' "$l"; exit ${TARGET_REF_LOCK}; fi`,
		`r=$(g for-each-ref --format='%(objectname) %(refname) %(*objectname)') || exit 3`,
		`printf '%s\\n' "$r" | grep -v ' ${WARP_REF_BACKUP}/' || true`,
		"if ! g symbolic-ref -q HEAD >/dev/null; then",
		`  h=$(g rev-parse -q --verify HEAD) && printf '%s HEAD\\n' "$h"`,
		"fi",
		"exit 0",
	].join("\n");
	return ["sh", "-c", script];
}

/**
 * A script for the target that keeps earlier warps' saved refs across a
 * plain-repo copy. The copy replaces `.git/packed-refs` with this machine's
 * and leaves `.git/refs/hyper-warp-backup/` alone, so a saved ref survives
 * only as a LOOSE ref; a `git pack-refs` (or `gc`) on the target since it was
 * saved moved it into `packed-refs`. Each ref under {@link WARP_REF_BACKUP}
 * with no loose file is written back as one, the way git writes a loose ref
 * (`<ref>.lock` created exclusively, then renamed), and read back with
 * `rev-parse`. Its packed entry is left as it is (a loose ref wins). Prints
 * how many it wrote, when it wrote any. Prints nothing when there is no
 * `.git` there.
 */
export function targetRefBackupsLoose(worktree: string): string[] {
	const quote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;
	const script = [
		`w=${quote(worktree)}`,
		'[ -e "$w/.git" ] || exit 0',
		TARGET_READ_ONLY_GIT,
		"gd=$(g rev-parse --git-common-dir) || exit 3",
		'case "$gd" in /*) ;; *) gd="$w/$gd" ;; esac',
		`r=$(g for-each-ref --format='%(objectname) %(refname)' ${WARP_REF_BACKUP}/) || exit 3`,
		"out=$(printf '%s\\n' \"$r\" | while read -r s ref; do",
		'  [ -n "$ref" ] || continue',
		'  f="$gd/$ref"',
		'  [ -f "$f" ] && continue',
		'  mkdir -p "$(dirname "$f")" || exit 1',
		'  ( set -C; printf \'%s\\n\' "$s" > "$f.lock" ) || exit 1',
		'  mv "$f.lock" "$f" || { rm -f "$f.lock"; exit 1; }',
		'  [ "$(g rev-parse -q --verify "$ref")" = "$s" ] || exit 1',
		"  echo x",
		"done) || exit 1",
		"[ -n \"$out\" ] && printf '%s\\n' \"$out\" | wc -l | tr -d ' '",
		"exit 0",
	].join("\n");
	return ["sh", "-c", script];
}

/**
 * A script for the target that saves every ref of the repository at
 * `worktree` (and HEAD when it is detached) as
 * `refs/hyper-warp-backup/<id>/<ref without "refs/">`, so a plain-repo warp,
 * which replaces the target's `.git` files with this machine's, can't make a
 * commit only the target had unreachable. Prints the namespace.
 */
export function targetRefsSave(worktree: string, id: string): string[] {
	const quote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;
	const ns = `${WARP_REF_BACKUP}/${id}`;
	const script = [
		`w=${quote(worktree)}; ns=${quote(ns)}`,
		TARGET_READ_ONLY_GIT,
		`r=$(g for-each-ref --format='%(objectname) %(refname)') || exit 3`,
		`printf '%s\\n' "$r" | while read -r s n; do`,
		'  [ -n "$n" ] || continue',
		`  case "$n" in ${WARP_REF_BACKUP}/*) continue ;; esac`,
		// biome-ignore lint/suspicious/noTemplateCurlyInString: shell parameter expansion, not a template.
		'  g update-ref "$ns/${n#refs/}" "$s" || exit 1',
		"done || exit 1",
		"if ! g symbolic-ref -q HEAD >/dev/null; then",
		'  h=$(g rev-parse -q --verify HEAD) && { g update-ref "$ns/HEAD" "$h" || exit 1; }',
		"fi",
		`printf '%s/\\n' "$ns"`,
	].join("\n");
	return ["sh", "-c", script];
}

/** A target ref this machine doesn't hold, or holds behind the target. */
export interface UncoveredRef {
	name: string;
	reason: string;
}

/**
 * Which of `refs` (the target's, from {@link targetRefs}) this machine's
 * repository at `worktree` does NOT cover. A ref is covered when a ref of the
 * same name here (HEAD: this machine's HEAD) points at the same object, or
 * when the commit it points at (an annotated tag: the commit it tags, `peeled`
 * as the target read it, so a tag object only the target has counts) exists
 * here and is reachable from one of the refs the copy carries
 * ({@link warpCarriedRefs}, the stash aside) or HEAD, whatever their names:
 * after the copy and the ref sync those refs are the target's, so the commit
 * stays reachable there. Uncovered: an object this machine doesn't have, a commit
 * here that none of its refs reach, or anything that is not a commit at all
 * and differs. Read-only: `for-each-ref`, `rev-parse`, `cat-file
 * --batch-check` and `rev-list` with an explicit tip list, no optional locks,
 * no fsmonitor.
 */
export function refsNotCoveredHere(
	worktree: string,
	refs: { object: string; name: string; peeled?: string }[],
): UncoveredRef[] {
	if (refs.length === 0) return [];
	const run = (args: string[], input?: string) =>
		spawnSync(
			"git",
			["-C", worktree, "--no-optional-locks", "-c", "core.fsmonitor=false", ...args],
			{ encoding: "utf8", env: cleanGitEnv(), maxBuffer: 256 * 1024 * 1024, input },
		);
	// Only what the copy carries counts: the refs the ref sync makes equal on
	// the target, and HEAD. Never `--all`: that would count earlier warps'
	// backups and other worktrees' HEADs, which the target never gets.
	const carried = warpCarriedRefs(worktree);
	const local = new Map<string, string>();
	for (const ref of carried) local.set(ref.name, ref.object);
	const head = run(["rev-parse", "-q", "--verify", "HEAD"]);
	if (head.status === 0) local.set("HEAD", (head.stdout ?? "").trim());
	const pending = refs.filter((ref) => local.get(ref.name) !== ref.object);
	if (pending.length === 0) return [];
	// The commit each object stands for (an annotated tag: the commit it tags),
	// when this machine has it: the target's pending refs first, then this
	// machine's tips. A stash is a ref the sync carries, but not a branch
	// anyone keeps: it never counts as covering.
	const tipObjects = [...local]
		.filter(([name]) => name !== "refs/stash")
		.map(([, object]) => object);
	const peeled = run(
		["cat-file", "--batch-check=%(objectname) %(objecttype)"],
		[...pending.map((ref) => ref.peeled || ref.object), ...tipObjects]
			.map((object) => `${object}^{commit}\n`)
			.join(""),
	);
	const answers = (peeled.stdout ?? "").split("\n");
	const commitAt = (index: number): string | undefined => {
		const [object, type] = (answers[index] ?? "").split(" ");
		return peeled.status === 0 && type === "commit" ? object : undefined;
	};
	const commitOf = (index: number) => commitAt(index);
	const tips = [...new Set(pending.map((_, index) => commitOf(index)).filter(Boolean))];
	const negatives = [
		...new Set(tipObjects.map((_, index) => commitAt(pending.length + index)).filter(Boolean)),
	];
	// Of those commits, the ones none of the carried refs (or HEAD) reach.
	const unreached = new Set<string>();
	if (tips.length > 0) {
		const walked = run(
			["rev-list", "--stdin"],
			[...tips, ...negatives.map((tip) => `^${tip}`)].map((line) => `${line}\n`).join(""),
		);
		if (walked.status === 0) {
			for (const line of (walked.stdout ?? "").split("\n")) if (line) unreached.add(line);
		} else {
			for (const tip of tips) unreached.add(tip as string);
		}
	}
	return pending.flatMap((ref, index): UncoveredRef[] => {
		const commit = commitOf(index);
		if (commit !== undefined && !unreached.has(commit)) return [];
		return [
			{
				name: ref.name,
				reason: local.has(ref.name) ? "has commits this machine doesn't" : "only there",
			},
		];
	});
}

/**
 * A script for the target that snapshots the uncommitted TRACKED work (index
 * and working tree) of `worktree` as a stash entry named `message`, without
 * touching the working tree: `git stash create` + `git stash store`. Prints
 * the stash commit when there was something to save. Untracked files are not
 * in the snapshot.
 *
 * `stash create` writes commits, so it needs an identity; a target with none
 * configured gets a neutral one for this call only. Hooks and signing are off.
 */
export function targetStashSnapshot(worktree: string, message: string): string[] {
	const quote = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;
	const script = [
		`w=${quote(worktree)}; m=${quote(message)}`,
		'who=""; git -C "$w" config user.email >/dev/null 2>&1 || who="-c user.email=hyper-warp@localhost -c user.name=hyper-warp"',
		// $who is split on purpose: it is either empty or four fixed words.
		'opts="-c core.hooksPath=/dev/null -c core.fsmonitor=false -c commit.gpgSign=false $who"',
		's=$(git $opts -C "$w" stash create) || exit 1',
		'[ -z "$s" ] && exit 0',
		'git $opts -C "$w" stash store -m "$m" "$s" || exit 1',
		`printf '%s\\n' "$s"`,
	].join("\n");
	return ["sh", "-c", script];
}

/**
 * How many TRACKED files of the repository at `worktree` live under a
 * directory named `name`, at any depth: what a copy that excludes `name`
 * leaves behind, so they show as deleted on the other side. Reads the index
 * only (`ls-files`); 0 when it cannot be read.
 */
export function trackedUnderDirectory(worktree: string, name: string): number {
	const result = spawnSync(
		"git",
		[
			"-C",
			worktree,
			"--no-optional-locks",
			"-c",
			"core.fsmonitor=false",
			"ls-files",
			"-z",
			"--",
			`:(glob)**/${name}/**`,
		],
		{ encoding: "utf8", env: cleanGitEnv() },
	);
	if (result.error || result.status !== 0) return 0;
	return (result.stdout ?? "").split("\0").filter((entry) => entry !== "").length;
}
