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
 * - {@link RemoteMachine} — runs commands over SSH. Command argv is quoted for
 *   the remote shell (`shellQuote`); the *path* half of rsync/scp targets is
 *   not quoted (no spelling is safe across openrsync, old rsync, new rsync and
 *   scp) — it is validated against a strict charset instead.
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
	/** Written to the command's stdin, then stdin is closed. Mutually exclusive with `tty`. */
	stdin?: string;
	/**
	 * Attach the terminal. Output is not captured (it goes straight to the
	 * user). On a remote machine this adds `-t`; combined with `stdin` it is
	 * rejected — a pty would echo input and mix it into the terminal.
	 */
	tty?: boolean;
	/**
	 * Directory to run the command in, on the machine that runs it. Must be
	 * absolute on a remote machine (it becomes `cd -- <cwd>`; a `~/x` would be
	 * quoted away from the remote shell).
	 */
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
 * Characters a remote path may contain. Hyperdrive builds these paths itself
 * (a machine's home, a space name), so a strict allowlist costs nothing. `~` is
 * allowed because the remote ssh/scp/rscp expands it.
 *
 * Two shape caveats callers need to know (they're why this is a charset, not a
 * sanitizer): an SFTP-mode `~/path` needs OpenSSH >= 8.7 on the server (Debian
 * 12+), and an IPv6 host needs brackets in the `host:path` form.
 */
const SAFE_REMOTE_PATH = /^[A-Za-z0-9._/~+-]+$/;

/** A remote path we refuse to send, because it can't be sent safely. */
export class RemotePathError extends Error {
	constructor(host: string, path: string) {
		super(
			`"${path}" isn't a path hyperdrive can use on ${host}: remote paths may only contain letters, digits and . _ / ~ + - (no spaces, quotes or shell characters).`,
		);
		this.name = "RemotePathError";
	}
}

/** A machine name or cwd we refuse to use. */
export class RemoteError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "RemoteError";
	}
}

/** Reject a host that ssh/scp/rsync would read as an option. */
function safeHost(host: string): string {
	if (host.startsWith("-")) {
		throw new RemoteError(
			`"${host}" isn't a host hyperdrive can reach: machine names can't start with "-".`,
		);
	}
	return host;
}

/** A remote cwd must be absolute, or `cd -- <cwd>` would break on a `~`. */
function absoluteCwd(host: string, cwd: string): string {
	if (!cwd.startsWith("/")) {
		throw new RemoteError(
			`"${cwd}" isn't a directory hyperdrive can cd to on ${host}: remote working directories must be absolute (start with /), not "~" or a relative path.`,
		);
	}
	return cwd;
}

/**
 * `host:path` for rsync and scp, passed through raw.
 *
 * Quoting the path looks safer but is wrong on the toolchains we actually run
 * against, and each breaks in its own way:
 * - OpenSSH 10.2's `scp` uses SFTP mode by default and passes the path through
 *   untouched, so `h:'a b'` creates a file literally named `'a b'`.
 * - GNU rsync >= 3.2.4 (the Debian server, Homebrew rsync) backslash-escapes
 *   remote arguments itself, so pre-quoted paths arrive with literal quotes.
 * Older rsync and openrsync, in turn, run the path through the remote shell and
 * need the quoting. There is no spelling that is safe on all four, so instead
 * of guessing we reject paths outside {@link SAFE_REMOTE_PATH}.
 */
export function remoteSpec(host: string, path: string): string {
	if (!SAFE_REMOTE_PATH.test(path)) throw new RemotePathError(host, path);
	return `${safeHost(host)}:${path}`;
}

/**
 * Portable rsync flags only.
 *
 * `--info=stats1` is rsync 3.1+; this Mac ships openrsync ("2.6.9 compatible"),
 * which rejects it outright, so every transfer from the Mac would fail. `-a`,
 * `--stats`, `--exclude` and `--` work everywhere. `--mkpath` (rsync 3.2.3+)
 * does *not*, so missing destination parents are created over ssh beforehand.
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
 * ending in `/` matches directories only. A leading `/` anchors the pattern at
 * the transfer root — unlike a plain relative pattern, it does not match
 * `src/build`.
 */
export function isExcluded(
	relPath: string,
	patterns: readonly string[],
	isDirectory = false,
): boolean {
	return compileExcludes(patterns).some((pattern) => pattern.matches(relPath, isDirectory));
}

interface CompiledExclude {
	/** Match `relPath` (slash-separated, relative to the transfer root). */
	matches(relPath: string, isDirectory: boolean): boolean;
}

/**
 * Compile exclude patterns once per transfer, so a tree walk doesn't build a
 * RegExp per path × pattern.
 */
function compileExcludes(patterns: readonly string[]): CompiledExclude[] {
	return patterns
		.map((raw) => compileExclude(raw))
		.filter((pattern): pattern is CompiledExclude => pattern !== null);
}

function compileExclude(raw: string): CompiledExclude | null {
	const dirOnly = raw.endsWith("/");
	const anchored = raw.startsWith("/");
	const body = raw.replace(/^\.\//, "").replace(/^\/+/, "").replace(/\/+$/, "");
	if (body === "") return null;
	const matcher = globToRegExp(body);
	const hasSlash = body.includes("/");

	return {
		matches(relPath, isDirectory) {
			if (dirOnly && !isDirectory) return false;
			if (anchored || hasSlash) {
				if (matcher.test(relPath)) return true;
				return relPath.startsWith(`${body}/`);
			}
			return relPath.split("/").some((part) => matcher.test(part));
		},
	};
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

/** Remove a destination that would make a copy land somewhere wrong. */
async function removeObstacle(to: string, wantDirectory: boolean): Promise<void> {
	try {
		const stat = await lstat(to);
		// A symlink always goes, whatever the source is: following it could write
		// outside the destination (rsync -a replaces the link). A type mismatch
		// (file where a dir belongs, or the reverse) goes too.
		if (stat.isSymbolicLink() || stat.isDirectory() !== wantDirectory) {
			await rm(to, { recursive: true, force: true });
		}
	} catch {
		// Nothing there.
	}
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
	compiled = compileExcludes(excludes),
): Promise<void> {
	const entries = await readdir(src, { withFileTypes: true });
	await removeObstacle(dst, true);
	await mkdir(dst, { recursive: true });
	for (const entry of entries) {
		const from = join(src, entry.name);
		const to = join(dst, entry.name);
		const relPath = toPosix(relative(root, from));
		if (compiled.some((pattern) => pattern.matches(relPath, entry.isDirectory()))) continue;
		if (entry.isDirectory()) {
			await copyTree(from, to, excludes, deleteExtraneous, root, compiled);
			continue;
		}
		if (entry.isSymbolicLink()) {
			// `-a` preserves symlinks; repos are full of them (node_modules/.bin).
			const target = await readlink(from);
			await rm(to, { recursive: true, force: true });
			await symlink(target, to);
			continue;
		}
		await removeObstacle(to, false);
		await copyFile(from, to);
	}

	if (!deleteExtraneous) return;
	// Only a directory destination can have extraneous entries; a file
	// destination is either overwritten or an error, exactly like rsync.
	if (!(await isDirectory(dst))) return;
	for (const entry of await readdir(dst, { withFileTypes: true })) {
		const relPath = toPosix(relative(root, join(dst, entry.name)));
		if (compiled.some((pattern) => pattern.matches(relPath, entry.isDirectory()))) continue;
		if (await pathExists(join(src, entry.name))) continue;
		await rm(join(dst, entry.name), { recursive: true, force: true });
	}
}

/**
 * Copy one file the way rsync does when the destination is a directory:
 * `rsync -a src dst/` puts the file *inside* dst. A non-directory dst is the
 * file's new path. A symlink source is copied as the link itself (`fs.cp`
 * would follow it); `-L` is what follows links, and we don't pass it.
 */
async function copyFileAsRsync(src: string, dst: string): Promise<void> {
	const to = (await isDirectory(dst)) ? join(dst, src.split("/").pop() ?? "") : dst;
	await removeObstacle(to, false);
	if (!(await isDirectory(dst))) await mkdir(dirname(to), { recursive: true });
	const sourceStat = await lstat(src);
	if (sourceStat.isSymbolicLink()) {
		await symlink(await readlink(src), to);
		return;
	}
	await cp(src, to, { recursive: true });
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
				await copyFileAsRsync(src, dst);
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
		this.host = safeHost(host);
		this.spawner = spawner;
	}

	async ssh(cmd: string[], opts?: SshOptions): Promise<RunResult> {
		if (opts?.tty && opts?.stdin !== undefined) {
			throw new RemoteError(
				"tty and stdin don't mix: a terminal would echo the input and mix it into the output. Use one or the other.",
			);
		}
		// One command string, each word quoted: ssh hands it to the remote shell,
		// which reproduces exactly the argv we passed. A remote `cwd` has to be a
		// `cd` in that string — it does not exist on this machine, so it can never
		// be the local child's cwd (that would fail with ENOENT) — and it must be
		// absolute, or the quoting would stop the remote shell from expanding `~`.
		const command = opts?.cwd
			? `cd -- ${shellQuote(absoluteCwd(this.host, opts.cwd))} && ${shellJoin(cmd)}`
			: shellJoin(cmd);
		return this.spawner({
			file: "ssh",
			// `-t` asks for a pty; without it an interactive remote command
			// (herdr/tmux attach, a prompt) dies with "not a terminal".
			args: [...(opts?.tty ? ["-t"] : []), this.host, "--", command],
			stdin: opts?.stdin,
			tty: opts?.tty,
		});
	}

	/**
	 * rsync and scp don't create missing destination parents on the old rsync
	 * this Mac ships (`--mkpath` is rsync 3.2.3+), so the parent is made over
	 * ssh first, exactly like LocalMachine's `mkdir` does locally. A parent that
	 * already exists costs one extra round trip and nothing else.
	 */
	private async ensureParent(dst: string): Promise<void> {
		const parent = dst.split("/").slice(0, -1).join("/") || "/";
		// Validated by the same charset as the transfer itself, and quoted for
		// the remote shell on top of it.
		if (!SAFE_REMOTE_PATH.test(parent)) throw new RemotePathError(this.host, parent);
		await this.ssh(["mkdir", "-p", "--", parent]);
	}

	async rsync(src: string, dst: string, opts?: RsyncOptions): Promise<RunResult> {
		// Validate the target first, so a bad path never spawns the mkdir.
		const target = remoteSpec(this.host, dst);
		// Only a local directory can be stat'ed; a remote source spec (`host:path`)
		// falls through as-is.
		const source = (await isDirectory(src)) ? withDirectorySlash(src) : src;
		await this.ensureParent(dst);
		return this.spawner({
			file: "rsync",
			args: rsyncArgs(source, target, opts),
		});
	}

	async scp(src: string, dst: string): Promise<RunResult> {
		const target = remoteSpec(this.host, dst);
		await this.ensureParent(dst);
		// `-r` matches LocalMachine.scp, which copies directories; `--` ends the
		// options so a source starting with `-` is still a path.
		return this.spawner({
			file: "scp",
			args: ["-r", "--", src, target],
		});
	}
}
