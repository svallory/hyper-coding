/**
 * The ONE place in hyperdrive that spawns `ssh`, `rsync` or `scp` (C-16).
 *
 * Every other module goes through the {@link MachineRunner} interface, so the
 * remote-execution surface stays auditable and testable: this file is the only
 * one that names those three binaries, and `tests/remote-exec.test.ts` fails if
 * that ever stops being true.
 *
 * Two implementations:
 * - {@link LocalMachine} — runs commands on this machine and copies files with
 *   the Node filesystem API. This is what every command gets when there is no
 *   target ("no target means local").
 * - {@link RemoteMachine} — runs commands over SSH, quoting the remote argv so
 *   the remote shell sees exactly the arguments we passed.
 */

import { spawn } from "node:child_process";
import { copyFile, cp, lstat, mkdir, readdir, readlink, rm, stat, symlink } from "node:fs/promises";
import { constants as SIGNALS } from "node:os";
import { dirname, join, relative, sep } from "node:path";

/** Result of any runner operation. `code` is the process exit code (0 = ok). */
export interface RunResult {
	code: number;
	stdout: string;
	stderr: string;
}

export interface SshOptions {
	/** Written to the command's stdin, then stdin is closed. */
	stdin?: string;
	/** Attach the terminal. Output is not captured (it goes straight to the user). */
	tty?: boolean;
	/** Directory to run the command in, on the machine that runs it. */
	cwd?: string;
}

export interface RsyncOptions {
	/** rsync `--exclude` patterns. */
	excludes?: string[];
	/** Mirror deletions on the destination. Never enabled unless explicitly true. */
	delete?: boolean;
}

/** How commands reach a machine, local or remote. */
export interface MachineRunner {
	ssh(cmd: string[], opts?: SshOptions): Promise<RunResult>;
	rsync(src: string, dst: string, opts?: RsyncOptions): Promise<RunResult>;
	scp(src: string, dst: string): Promise<RunResult>;
}

/** One spawned process, described so a fake spawner can assert on it. */
export interface SpawnRequest {
	file: string;
	args: string[];
	stdin?: string;
	cwd?: string;
	tty?: boolean;
}

/** Injection seam for tests: replaces the real child_process spawn. */
export type Spawner = (request: SpawnRequest) => Promise<RunResult>;

/** Characters that need no quoting in a POSIX shell. */
const SHELL_SAFE = /^[A-Za-z0-9_@%+=:,./-]+$/;

/**
 * Quote one argument for a POSIX shell. Output is always safe to paste into a
 * command line verbatim; already-safe words are returned unchanged so the
 * common case stays readable in logs and tests.
 */
export function shellQuote(value: string): string {
	if (value === "") return "''";
	if (SHELL_SAFE.test(value)) return value;
	return `'${value.replaceAll("'", `'\\''`)}'`;
}

/** Join an argv array into one remote-shell command line, quoting each word. */
export function shellJoin(cmd: string[]): string {
	return cmd.map(shellQuote).join(" ");
}

/**
 * Exit code for a process that died from a signal, following the shell
 * convention of 128 + signal number. `code` is null in that case, so reporting
 * `code ?? 0` would call every killed process a success.
 */
export function exitCodeForSignal(signal: NodeJS.Signals | null | undefined): number {
	if (!signal) return 0;
	const number = SIGNALS.signals[signal];
	return typeof number === "number" ? 128 + number : 1;
}

const spawnProcess: Spawner = (request) =>
	new Promise((resolvePromise, rejectPromise) => {
		const child = spawn(request.file, request.args, {
			cwd: request.cwd,
			stdio: request.tty ? "inherit" : ["pipe", "pipe", "pipe"],
		});

		let stdout = "";
		let stderr = "";
		child.stdout?.setEncoding("utf-8");
		child.stderr?.setEncoding("utf-8");
		child.stdout?.on("data", (chunk: string) => {
			stdout += chunk;
		});
		child.stderr?.on("data", (chunk: string) => {
			stderr += chunk;
		});

		child.on("error", rejectPromise);
		child.on("close", (code, signal) => {
			resolvePromise({ code: code ?? exitCodeForSignal(signal), stdout, stderr });
		});

		if (request.tty) return;
		child.stdin?.on("error", () => {
			// The command may exit before reading all of stdin; that's not our failure.
		});
		if (request.stdin !== undefined) child.stdin?.end(request.stdin);
		else child.stdin?.end();
	});

/**
 * `host:path` for rsync/scp. The path is quoted because the remote side runs it
 * through a shell: an unquoted `$(…)`, backtick or space in a path would split
 * or execute there. Safe paths come back unquoted, so the common case is
 * unchanged.
 */
export function remoteSpec(host: string, path: string): string {
	return `${host}:${shellQuote(path)}`;
}

/**
 * Portable rsync flags only.
 *
 * `--info=stats1` is rsync 3.1+; this Mac ships openrsync ("2.6.9 compatible"),
 * which rejects it outright, so every transfer from the Mac would fail. `-a`,
 * `--stats`, `--exclude` and `--` work everywhere.
 */
function rsyncArgs(src: string, dst: string, opts?: RsyncOptions): string[] {
	const args = ["-a", "--stats", "-e", "ssh"];
	for (const pattern of opts?.excludes ?? []) {
		args.push(`--exclude=${pattern}`);
	}
	// Safety: never pass --delete unless the caller explicitly asked. Mirroring a
	// half-sent tree destroys whatever the destination had that we didn't send.
	if (opts?.delete === true) args.push("--delete");
	// `--` ends rsync's options, so a path starting with `-` is still a path.
	args.push("--", src, dst);
	return args;
}

/**
 * Directory sources get a trailing slash, so rsync copies their *contents*
 * into the destination. This matches {@link LocalMachine}, which always copies
 * contents — `rsync -a src dst` without the slash would create `dst/<name>/…`
 * and silently land files one level deeper than the local path.
 */
function withDirectorySlash(src: string): string {
	return src.endsWith("/") ? src : `${src}/`;
}

/** Translate an rsync exclude pattern into a matcher over relative paths. */
function globToRegExp(glob: string): RegExp {
	let out = "";
	for (let i = 0; i < glob.length; i++) {
		const char = glob[i];
		if (char === "*") {
			if (glob[i + 1] === "*") {
				i += 1;
				if (glob[i + 1] === "/") {
					i += 1;
					out += "(?:[^/]+/)*";
				} else {
					out += ".*";
				}
			} else {
				out += "[^/]*";
			}
		} else if (char === "?") {
			out += "[^/]";
		} else {
			out += char.replace(/[.+^${}()|[\]\\]/, "\\$&");
		}
	}
	return new RegExp(`^${out}$`);
}

/**
 * rsync-style exclude matching: a pattern without a slash matches any path
 * component, a pattern with one is anchored at the transfer root. A pattern
 * ending in `/` matches directories only, and a leading `/` just anchors it.
 */
export function isExcluded(
	relPath: string,
	patterns: readonly string[],
	isDirectory = false,
): boolean {
	for (const raw of patterns) {
		if (raw.endsWith("/") && !isDirectory) continue;
		const pattern = raw.replace(/^\.\//, "").replace(/^\/+/, "").replace(/\/+$/, "");
		if (pattern === "") continue;
		const matcher = globToRegExp(pattern);
		if (pattern.includes("/")) {
			if (matcher.test(relPath)) return true;
			if (relPath.startsWith(`${pattern}/`)) return true;
		} else if (relPath.split("/").some((part) => matcher.test(part))) {
			return true;
		}
	}
	return false;
}

/** lstat-based: a dangling symlink exists, even though access() says otherwise. */
async function pathExists(path: string): Promise<boolean> {
	try {
		await lstat(path);
		return true;
	} catch {
		return false;
	}
}

/** Follows symlinks, like `rsync -a` does when deciding what a path is. */
async function isDirectory(path: string): Promise<boolean> {
	try {
		return (await stat(path)).isDirectory();
	} catch {
		return false;
	}
}

function toPosix(path: string): string {
	return path.split(sep).join("/");
}

function friendlyError(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

/**
 * Copy the contents of `src` into `dst` the way `rsync -a src/ dst` would:
 * recurse, preserve the relative layout, keep symlinks as symlinks, honour
 * excludes, and delete extraneous destination entries only when `delete` is
 * explicitly true.
 */
async function copyTree(
	src: string,
	dst: string,
	excludes: readonly string[],
	deleteExtraneous: boolean,
	root = src,
): Promise<void> {
	const entries = await readdir(src, { withFileTypes: true });
	await mkdir(dst, { recursive: true });
	for (const entry of entries) {
		const from = join(src, entry.name);
		const to = join(dst, entry.name);
		const relPath = toPosix(relative(root, from));
		if (isExcluded(relPath, excludes, entry.isDirectory())) continue;
		if (entry.isDirectory()) {
			await copyTree(from, to, excludes, deleteExtraneous, root);
			continue;
		}
		if (entry.isSymbolicLink()) {
			// `-a` preserves symlinks; repos are full of them (node_modules/.bin).
			const target = await readlink(from);
			await rm(to, { recursive: true, force: true });
			await symlink(target, to);
			continue;
		}
		await copyFile(from, to);
	}

	if (!deleteExtraneous) return;
	// Only a directory destination can have extraneous entries; a file
	// destination is either overwritten or an error, exactly like rsync.
	if (!(await isDirectory(dst))) return;
	for (const entry of await readdir(dst, { withFileTypes: true })) {
		const relPath = toPosix(relative(root, join(dst, entry.name)));
		if (isExcluded(relPath, excludes, entry.isDirectory())) continue;
		if (await pathExists(join(src, entry.name))) continue;
		await rm(join(dst, entry.name), { recursive: true, force: true });
	}
}

/** Commands on this machine, and file copies through the Node filesystem API. */
export class LocalMachine implements MachineRunner {
	readonly kind = "local" as const;
	private readonly spawner: Spawner;

	constructor(spawner: Spawner = spawnProcess) {
		this.spawner = spawner;
	}

	async ssh(cmd: string[], opts?: SshOptions): Promise<RunResult> {
		const [file, ...args] = cmd;
		if (file === undefined) return { code: 0, stdout: "", stderr: "" };
		// Locally, `cwd` is just the child's working directory — it exists here.
		return this.spawner({
			file,
			args,
			stdin: opts?.stdin,
			cwd: opts?.cwd,
			tty: opts?.tty,
		});
	}

	async rsync(src: string, dst: string, opts?: RsyncOptions): Promise<RunResult> {
		if (!(await pathExists(src))) {
			return { code: 23, stdout: "", stderr: `${src} doesn't exist, so there's nothing to copy.` };
		}
		try {
			if (!(await isDirectory(src))) {
				await mkdir(dirname(dst), { recursive: true });
				await copyFile(src, dst);
				return { code: 0, stdout: `copied ${src} to ${dst}`, stderr: "" };
			}
			// Like `rsync -a src/ dst`: the contents of src land inside dst.
			await copyTree(src, dst, opts?.excludes ?? [], opts?.delete === true);
			return { code: 0, stdout: `copied ${src} to ${dst}`, stderr: "" };
		} catch (err) {
			// Filesystem trouble is a failed transfer, not a crash: callers check
			// `code` and print `stderr`.
			return {
				code: 23,
				stdout: "",
				stderr: `Couldn't copy ${src} to ${dst}: ${friendlyError(err)}`,
			};
		}
	}

	async scp(src: string, dst: string): Promise<RunResult> {
		if (!(await pathExists(src))) {
			return { code: 1, stdout: "", stderr: `${src} doesn't exist, so there's nothing to copy.` };
		}
		try {
			if (!(await isDirectory(src))) await mkdir(dirname(dst), { recursive: true });
			// `cp` keeps symlinks as symlinks, like scp -r does.
			await cp(src, dst, { recursive: true });
			return { code: 0, stdout: `copied ${src} to ${dst}`, stderr: "" };
		} catch (err) {
			return {
				code: 1,
				stdout: "",
				stderr: `Couldn't copy ${src} to ${dst}: ${friendlyError(err)}`,
			};
		}
	}
}

/** Commands on a remote machine over SSH. `host` is whatever `ssh` accepts. */
export class RemoteMachine implements MachineRunner {
	readonly kind = "remote" as const;
	readonly host: string;
	private readonly spawner: Spawner;

	constructor(host: string, spawner: Spawner = spawnProcess) {
		this.host = host;
		this.spawner = spawner;
	}

	async ssh(cmd: string[], opts?: SshOptions): Promise<RunResult> {
		// One command string, each word quoted: ssh hands it to the remote shell,
		// which reproduces exactly the argv we passed. A remote `cwd` has to be a
		// `cd` in that string — it does not exist on this machine, so it can never
		// be the local child's cwd (that would fail with ENOENT).
		const command = opts?.cwd ? `cd ${shellQuote(opts.cwd)} && ${shellJoin(cmd)}` : shellJoin(cmd);
		return this.spawner({
			file: "ssh",
			args: [this.host, "--", command],
			stdin: opts?.stdin,
			tty: opts?.tty,
		});
	}

	async rsync(src: string, dst: string, opts?: RsyncOptions): Promise<RunResult> {
		// Only a local directory can be stat'ed; a remote source spec (`host:path`)
		// falls through as-is.
		const source = (await isDirectory(src)) ? withDirectorySlash(src) : src;
		return this.spawner({
			file: "rsync",
			args: rsyncArgs(source, remoteSpec(this.host, dst), opts),
		});
	}

	async scp(src: string, dst: string): Promise<RunResult> {
		return this.spawner({ file: "scp", args: [src, remoteSpec(this.host, dst)] });
	}
}
