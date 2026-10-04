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
import { basename, dirname, join, relative, sep } from "node:path";

/** Result of any runner operation. `code` is the process exit code (0 = ok). */
export interface RunResult {
	code: number;
	stdout: string;
	stderr: string;
}

export interface SshOptions {
	/** Bound a probe's lifetime; the spawned command is killed when this expires. */
	timeoutMs?: number;
	/** Written to the command's stdin, then stdin is closed. Mutually exclusive with `tty`. */
	stdin?: string;
	/**
	 * Extra environment variables for a LOCAL command (merged over
	 * `process.env`). Ignored for a remote command, where the environment is
	 * the remote shell's business, not ours.
	 */
	env?: Record<string, string>;
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

/**
 * An SSH target split into the two parts the three binaries each need
 * differently: `host` (what ssh/rsync name) and `port` (what only ssh and
 * git know how to spell).
 *
 * `host:port` is scp's and rsync's remote-spec grammar, NOT ssh's: handing
 * `box:2222` to `ssh` makes it look for a host literally named `box:2222`
 * and fail with "could not resolve hostname". A Herdr machine may legitimately
 * be saved on a non-default port, so the two have to be split here rather than
 * passed through whole.
 */
export interface SshTarget {
	/** `user@host`, `host`, or `[ipv6]` — exactly what `ssh` accepts. */
	host: string;
	/** Port when the target carried one; undefined means ssh's default. */
	port?: number;
}

/** A `host:port` we refuse to split, because it can't be split safely. */
export class SshTargetError extends Error {
	constructor(target: string, reason: string) {
		super(`"${target}" isn't an SSH target hyperdrive can use: ${reason}.`);
		this.name = "SshTargetError";
	}
}

const MAX_PORT = 65_535;

/**
 * Split an SSH target into host and port.
 *
 * The port is only recognised as one when the part after the LAST colon is
 * entirely digits, and only when there is exactly one colon outside brackets —
 * so `user@host`, `host`, `ssh://…`-free forms and a bare IPv6 address
 * (`::1`, `fe80::1`) are all left whole. `[::1]:2222` is the bracketed IPv6 form
 * and is split into `[::1]` and `2222`.
 *
 * Anything else with a colon is refused rather than guessed: `box:notaport` and
 * `a:b:c` are typos, and passing them to `ssh` as a hostname produces a
 * confusing DNS failure that points nowhere near the real problem.
 */
export function splitSshTarget(target: string): SshTarget {
	const trimmed = target.trim();
	if (trimmed === "") throw new SshTargetError(target, "it is empty");

	// Bracketed IPv6 with an optional port: `[::1]`, `[::1]:2222`, and the same
	// with a `user@` in front (`me@[::1]:2222`). The user part is kept on the
	// host, exactly like `me@box`; only the brackets decide where the port is.
	const at = trimmed.indexOf("@");
	const bracket = trimmed.indexOf("[");
	if (bracket === 0 || (bracket > 0 && at === bracket - 1)) {
		const close = trimmed.indexOf("]");
		if (close < 0) throw new SshTargetError(target, "the '[' has no matching ']'");
		const host = trimmed.slice(0, close + 1);
		const rest = trimmed.slice(close + 1);
		if (rest === "") return { host };
		if (!rest.startsWith(":")) {
			throw new SshTargetError(target, "an IPv6 address must end at its ']'");
		}
		return { host, port: parsePort(target, rest.slice(1)) };
	}

	const colons = [...trimmed].filter((char) => char === ":").length;
	if (colons === 0) return { host: trimmed };
	// Two or more colons and no brackets: a bare IPv6 address, never a port.
	if (colons > 1) return { host: trimmed };

	const separator = trimmed.lastIndexOf(":");
	const host = trimmed.slice(0, separator);
	const port = trimmed.slice(separator + 1);
	if (host === "") throw new SshTargetError(target, "there is no host before the ':'");
	if (!/^\d+$/.test(port)) {
		throw new SshTargetError(target, `"${port}" is not a port number`);
	}
	return { host, port: parsePort(target, port) };
}

function parsePort(target: string, digits: string): number {
	const port = Number(digits);
	if (port < 1 || port > MAX_PORT) {
		throw new SshTargetError(target, `${port} is not a port between 1 and ${MAX_PORT}`);
	}
	return port;
}

/**
 * The `ssh://` URL for a target, for the one thing that speaks URL and not
 * shell: git.
 *
 * C-9 makes this load-bearing. Warp pushes a worktree branch to a bare repo on
 * the target, and it must do that with an EXPLICIT URL built from the machine
 * entry — never with a remote *name*, which would mean writing to whatever
 * `origin` happens to be on the target (or, far worse, on this machine).
 *
 * scp's `user@host:path` is not a URL and git would read the whole thing as a
 * local path; `ssh://user@host:port/path` is what git's ssh transport parses,
 * and the port has to be in it because git runs its own ssh.
 */
export function sshUrl(target: SshTarget, path: string): string {
	if (!SAFE_REMOTE_PATH.test(path)) throw new RemotePathError(target.host, path);
	if (!path.startsWith("/")) {
		throw new RemotePathError(target.host, `${path} (an ssh:// URL needs an absolute path)`);
	}
	// A bare IPv6 literal (`fe80::1`, `me@::1`) has to be bracketed in a URL,
	// or git reads its last group as a port: `ssh://fe80::1/x` is not a URL.
	const host = bracketIpv6(target.host);
	const authority = target.port === undefined ? host : `${host}:${target.port}`;
	return `ssh://${authority}${path}`;
}

/** How commands reach a machine, local or remote. */
export interface MachineRunner {
	ssh(cmd: string[], opts?: SshOptions): Promise<RunResult>;
	rsync(src: string, dst: string, opts?: RsyncOptions): Promise<RunResult>;
	scp(src: string, dst: string): Promise<RunResult>;
	/**
	 * Run a command as ANOTHER user on the same machine.
	 *
	 * This is what makes the unattended agent reachable: `dockerd-rootless-setuptool.sh
	 * install` has to run inside a real login session of the agent user, and the
	 * only way to open one from here is ssh as that user. Remote machines do it
	 * by substituting the user in the ssh target; a LOCAL machine cannot, because
	 * becoming another user needs root — so `LocalMachine` refuses by name rather
	 * than spawning anything (C-6).
	 */
	asUser(user: string, cmd: string[], opts?: SshOptions): Promise<RunResult>;
}

/** One spawned process, described so a fake spawner can assert on it. */
export interface SpawnRequest {
	timeoutMs?: number;
	file: string;
	args: string[];
	stdin?: string;
	cwd?: string;
	tty?: boolean;
	/** Extra env vars, merged over process.env when spawning. */
	env?: Record<string, string>;
}

/** Injection seam for tests: replaces the real child_process spawn. */
export type Spawner = (request: SpawnRequest) => Promise<RunResult>;

/** Characters that need no quoting in a POSIX shell. */
const SHELL_SAFE = /^[A-Za-z0-9_@%+=:,./-]+$/;

/**
 * What an ssh user name may look like. The same rule as the agent user in
 * `config/schema.ts`, kept local here because this is the ssh surface: a value
 * carrying shell syntax would become part of an ssh target word.
 */
const SSH_USER_PATTERN = /^[a-z_][a-z0-9_-]{0,31}$/;

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
			timeout: request.timeoutMs,
			killSignal: "SIGKILL",
			stdio: request.tty ? "inherit" : ["pipe", "pipe", "pipe"],
			...(request.env ? { env: { ...process.env, ...request.env } } : {}),
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

/** Reject an ssh user that would be read as more than a user name. */
function safeSshUser(user: string): string {
	if (!SSH_USER_PATTERN.test(user)) {
		throw new RemoteError(
			`"${user}" isn't a user hyperdrive can ssh as: a user name is lower case, starts with a letter or underscore, and contains only letters, digits, underscores and dashes.`,
		);
	}
	return user;
}

/**
 * The ssh target for the SAME machine with a different user.
 *
 * `machine.host` is whatever Herdr saved — usually `user@host`, sometimes a bare
 * hostname, possibly an ssh alias. The user part is REPLACED (up to the last
 * `@`, so an alias containing one still works) rather than appended to, because
 * `agent@svallory@host` is not an ssh target. Nothing is quoted: the result is
 * one argv word handed to ssh, which is the only form it accepts.
 */
export function targetWithUser(host: string, user: string): string {
	const safe = safeHost(host);
	const safeUser = safeSshUser(user);
	const at = safe.lastIndexOf("@");
	return at >= 0 ? `${safeUser}@${safe.slice(at + 1)}` : `${safeUser}@${safe}`;
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
function rsyncArgs(
	src: string,
	dst: string,
	opts?: RsyncOptions,
	otherUser = false,
	port?: number,
): string[] {
	// rsync runs its own ssh, and the port has to be told to THAT ssh: a
	// `-p 2222` here would be an rsync option, and rsync has none.
	const sshCommand = [
		"ssh",
		...(otherUser ? OTHER_USER_SSH_OPTIONS : []),
		...(port === undefined ? [] : ["-p", String(port)]),
	].join(" ");
	const args = ["-a", "--stats", "-e", sshCommand];
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
	// Below the root, a symlink or type mismatch at the destination is replaced
	// before writing (rsync -a replaces the link). At the root, rsync FOLLOWS a
	// destination symlink, so a symlinked dst keeps its identity.
	if (src !== root) await removeObstacle(dst, true);
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
			env: opts?.env,
			...(opts?.timeoutMs === undefined ? {} : { timeoutMs: opts.timeoutMs }),
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

	async asUser(user: string): Promise<RunResult> {
		// Refusing is the whole implementation, and it is deliberate: the only way
		// to become another user HERE is `su`/`runuser`, which needs root. Naming
		// the flag and the way out is more useful than a permission error from a
		// child process, and it keeps hyper out of privilege escalation (C-6).
		throw new RemoteError(
			`I can't run a command as ${user} on this machine: becoming another user here needs root, and hyper never runs as root (C-6). Set this machine up over ssh instead: \`hyper machine setup <machine> --features docker-rootless\`.`,
		);
	}
}

/**
 * The options every session opened as ANOTHER user on the machine carries.
 *
 * hyper reaches the agent user with the operator's own ssh client, so without
 * these the session inherits whatever the operator's `~/.ssh/config` says for
 * that host — and two of those settings break the agent's isolation:
 *
 * - **agent forwarding** (`ForwardAgent yes`, common for dev servers) hands the
 *   operator's ssh-agent socket to a session of the agent user. Any process of
 *   the agent's could authenticate with the operator's keys for as long as the
 *   session lasts — including as the primary user on the same machine.
 * - **connection sharing** (`ControlMaster`/`ControlPath` without `%r`) can
 *   reuse the PRIMARY user's open connection, so commands meant for the agent
 *   run as the primary.
 *
 * `-a` and `ForwardAgent=no` close the first (ssh honours the first value, and
 * command-line options come before the config file); `ClearAllForwardings`
 * drops any configured port forwardings; `-x` (`ForwardX11=no`) closes the one
 * forwarding `ClearAllForwardings` does not cover, so an operator config with
 * `ForwardX11 yes` never hands the agent the operator's X display;
 * `ControlMaster=no` with `ControlPath=none` never joins or creates a shared
 * connection. Sessions as the primary user keep the operator's configuration
 * exactly as it is.
 */
export const OTHER_USER_SSH_OPTIONS = [
	"-a",
	"-x",
	"-o",
	"ForwardAgent=no",
	"-o",
	"ClearAllForwardings=yes",
	"-o",
	"ControlMaster=no",
	"-o",
	"ControlPath=none",
] as const;

/** How a {@link RemoteMachine} connects. */
export interface RemoteMachineOptions {
	/**
	 * True when the host's user is NOT the operator's own account on that
	 * machine (the agent user). Every ssh, scp and rsync then carries
	 * {@link OTHER_USER_SSH_OPTIONS}.
	 */
	otherUser?: boolean;
	/**
	 * Non-default ssh port. When absent, a `host:port` target is split for it;
	 * when both are absent, ssh's default applies and no `-p` is passed.
	 */
	port?: number;
}

/** Commands on a remote machine over SSH. `host` is whatever `ssh` accepts. */
export class RemoteMachine implements MachineRunner {
	readonly kind = "remote" as const;
	readonly host: string;
	/**
	 * The ssh port, when the machine entry named one. Undefined means ssh's
	 * default, in which case no `-p` is passed at all — a `-p 22` would be
	 * correct but would also show up in every transcript and in every test
	 * assertion about the argv.
	 */
	readonly port: number | undefined;
	private readonly spawner: Spawner;
	private readonly otherUser: boolean;

	/**
	 * `host` may be the whole target as saved (including `user@` and, when the
	 * caller did not split it, `host:port`). A `host:port` pair is split here
	 * so a caller that forgets to split still reaches the machine instead of
	 * asking ssh to resolve a host literally named `box:2222`.
	 */
	constructor(host: string, spawner: Spawner = spawnProcess, options: RemoteMachineOptions = {}) {
		const split = splitSshTarget(host);
		this.host = safeHost(split.host);
		this.port = options.port ?? split.port;
		this.spawner = spawner;
		this.otherUser = options.otherUser === true;
	}

	async ssh(cmd: string[], opts?: SshOptions): Promise<RunResult> {
		return this.sshTo(this.host, cmd, opts, this.otherUser);
	}

	/** Run one command over ssh as `user` on this same machine. */
	async asUser(user: string, cmd: string[], opts?: SshOptions): Promise<RunResult> {
		return this.sshTo(targetWithUser(this.host, user), cmd, opts, true);
	}

	/**
	 * The one spawn for every ssh command, whoever it runs as, so the quoting,
	 * the `--` separator, the tty rules and the remote `cd` are identical
	 * whichever user the command is for.
	 */
	private async sshTo(
		target: string,
		cmd: string[],
		opts: SshOptions | undefined,
		otherUser: boolean,
	): Promise<RunResult> {
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
			? `cd -- ${shellQuote(absoluteCwd(target, opts.cwd))} && ${shellJoin(cmd)}`
			: shellJoin(cmd);
		return this.spawner({
			file: "ssh",
			// `-t` asks for a pty; without it an interactive remote command
			// (herdr/tmux attach, a prompt) dies with "not a terminal".
			// `-p` comes before the host: after it, ssh reads it as part of the
			// destination and stops parsing options.
			args: [
				...(otherUser ? OTHER_USER_SSH_OPTIONS : []),
				...(opts?.tty ? ["-t"] : []),
				...(this.port === undefined ? [] : ["-p", String(this.port)]),
				target,
				"--",
				command,
			],
			...(opts?.timeoutMs === undefined ? {} : { timeoutMs: opts.timeoutMs }),
			stdin: opts?.stdin,
			tty: opts?.tty,
		});
	}

	/**
	 * rsync and scp don't create missing destination parents on the old rsync
	 * this Mac ships (`--mkpath` is rsync 3.2.3+), so the parent is made over
	 * ssh first, exactly like LocalMachine's `mkdir` does locally. A parent that
	 * already exists costs one extra round trip and nothing else. Returns the
	 * mkdir's result when it failed, so the transfer is never attempted anyway.
	 */
	private async ensureParent(dst: string): Promise<RunResult | null> {
		const parent = dst.split("/").slice(0, -1).join("/");
		// Nothing to create: `~` and `~/x` land in the remote home, an absolute
		// path at the root lands in `/`, and a bare filename lands in the cwd.
		if (parent === "" || parent === "/" || parent === "~") return null;
		if (!SAFE_REMOTE_PATH.test(parent)) throw new RemotePathError(this.host, parent);
		// A leading `~` must reach the remote shell UNQUOTED — only it can expand
		// it into the remote user's home. Quoting it (the round-3 bug) created a
		// literal directory named `~` under $HOME. The rest is quoted as usual.
		const quoted = parent.startsWith("~/")
			? `~/${shellQuote(parent.slice(2))}`
			: shellQuote(parent);
		const result = await this.ssh(["sh", "-c", `mkdir -p -- ${quoted}`]);
		return result.code === 0 ? null : result;
	}

	async rsync(src: string, dst: string, opts?: RsyncOptions): Promise<RunResult> {
		// Validate the target first, so a bad path never spawns the mkdir.
		const target = remoteSpec(this.host, dst);
		// Only a local directory can be stat'ed; a remote source spec (`host:path`)
		// falls through as-is.
		const source = (await isDirectory(src)) ? withDirectorySlash(src) : src;
		const mkdirFailed = await this.ensureParent(dst);
		if (mkdirFailed) return mkdirFailed;
		return this.spawner({
			file: "rsync",
			args: rsyncArgs(source, target, opts, this.otherUser, this.port),
		});
	}

	async scp(src: string, dst: string): Promise<RunResult> {
		const target = remoteSpec(this.host, dst);
		const mkdirFailed = await this.ensureParent(dst);
		if (mkdirFailed) return mkdirFailed;
		// `-r` matches LocalMachine.scp, which copies directories; `--` ends the
		// options so a source starting with `-` is still a path.
		return this.spawner({
			file: "scp",
			// scp has no `-a` and no `-x`; use `-o ForwardX11=no` for its
			// underlying ssh, alongside the same other -o isolation options.
			// `-P` is scp's port spelling (its `-p` preserves modes) and goes where
			// scp is still reading options: before `-r`, before `--`. Without it the
			// copy goes to port 22 while the ssh that runs the script goes to the
			// configured one — on a host where 22 is another sshd, the root script
			// lands on the wrong machine.
			args: [
				...(this.otherUser
					? [
							...OTHER_USER_SSH_OPTIONS.filter((option) => option !== "-a" && option !== "-x"),
							"-o",
							"ForwardX11=no",
						]
					: []),
				...(this.port === undefined ? [] : ["-P", String(this.port)]),
				"-r",
				"--",
				src,
				target,
			],
		});
	}
}

/**
 * The OpenSSH client as a command word. Only this file may name it (C-16:
 * `tests/remote-exec.test.ts` fails on any quoted `ssh`/`rsync`/`scp` outside
 * `services/remote.ts`), so callers that need to reason about an SSH command
 * import this instead of spelling the program themselves.
 */
const SSH_CLIENT = "ssh";

/**
 * One shell word as written: where it starts and ends in the ORIGINAL string,
 * what a shell would make of it once quotes and escapes are removed, and
 * whether it is a `NAME=value` assignment (decided on the raw text, because
 * `"A"=1` is a command word to a shell, not an assignment).
 */
interface ShellWord {
	start: number;
	end: number;
	value: string;
	assignment: boolean;
}

/**
 * Read the words of a simple command, or `null` when this cannot be done
 * with confidence: an unterminated quote, a trailing backslash, a command
 * substitution, or an operator that makes it more than one simple command
 * (a pipeline, a list, a subshell, a newline). Parameter expansions such as
 * `$HOME` are kept literally; they only matter for the program word, and a
 * program reached through one is simply not recognised as ssh.
 */
function shellWords(command: string): ShellWord[] | null {
	const words: ShellWord[] = [];
	let index = 0;
	while (index < command.length) {
		const character = command[index]!;
		if (character === " " || character === "\t") {
			index += 1;
			continue;
		}
		if ("|&;()`\n\r".includes(character)) return null;
		const start = index;
		let value = "";
		while (index < command.length) {
			const current = command[index]!;
			if (current === " " || current === "\t") break;
			if ("|&;()`\n\r".includes(current)) return null;
			if (current === "\\") {
				if (index + 1 >= command.length) return null;
				value += command[index + 1];
				index += 2;
				continue;
			}
			if (current === "'") {
				const close = command.indexOf("'", index + 1);
				if (close < 0) return null;
				value += command.slice(index + 1, close);
				index = close + 1;
				continue;
			}
			if (current === '"') {
				index += 1;
				let closed = false;
				while (index < command.length) {
					const inner = command[index]!;
					if (inner === '"') {
						closed = true;
						index += 1;
						break;
					}
					if (inner === "`" || (inner === "$" && command[index + 1] === "(")) return null;
					if (
						inner === "\\" &&
						index + 1 < command.length &&
						'"\\$`'.includes(command[index + 1]!)
					) {
						value += command[index + 1];
						index += 2;
						continue;
					}
					value += inner;
					index += 1;
				}
				if (!closed) return null;
				continue;
			}
			if (current === "$" && command[index + 1] === "(") return null;
			value += current;
			index += 1;
		}
		words.push({
			start,
			end: index,
			value,
			assignment: /^[A-Za-z_][A-Za-z0-9_]*=/.test(command.slice(start, index)),
		});
	}
	return words;
}

/**
 * BatchMode belongs in a `GIT_SSH_COMMAND` so a clone that cannot authenticate
 * fails instead of waiting for a password that will never arrive on a
 * noninteractive machine.
 *
 * ssh honours the FIRST value of a repeated option, so the option is inserted
 * immediately after the program word rather than appended: a user who already
 * wrote `-o BatchMode=no` must not win over the setting meant to apply here.
 * A command whose program is something else — a wrapper, `sshpass`, a company
 * fork — is returned unchanged, because it need not understand `-o` at all.
 *
 * The user's words are never rewritten: git hands this string to a shell, so
 * removing a quote changes what runs. The words are read only to FIND the
 * program word — leading `NAME=value` assignments (and an `env` followed by
 * assignments) are skipped, quotes and escapes are honoured — and ` -o
 * BatchMode=yes` is inserted at that word's end offset in the original string.
 * The comparison is on the unquoted basename, case-insensitively, because a
 * case-insensitive filesystem happily runs `SSH`. Anything the scanner cannot
 * read with confidence is returned unchanged.
 *
 * Pure: no process, no environment, no filesystem. `undefined` in means the
 * user configured nothing, and the default command out.
 */
export function sshCommandWithBatchMode(command: string | undefined): string | undefined {
	if (command === undefined || command.trim() === "") return `${SSH_CLIENT} -o BatchMode=yes`;
	const words = shellWords(command);
	if (words === null) return command;
	let index = 0;
	while (index < words.length && words[index]!.assignment) index += 1;
	if (index < words.length && basename(words[index]!.value) === "env") {
		index += 1;
		// `env -i`, `env -u NAME`: options change what follows; not guessed at.
		if (index < words.length && words[index]!.value.startsWith("-")) return command;
		while (index < words.length && words[index]!.assignment) index += 1;
	}
	const program = words[index];
	if (program === undefined) return command;
	if (basename(program.value).toLowerCase() !== SSH_CLIENT) return command;
	return `${command.slice(0, program.end)} -o BatchMode=yes${command.slice(program.end)}`;
}

/**
 * A bounded connection attempt for space remote operations: an unreachable
 * hyperdrive host must fail in seconds, not after the operating system's TCP
 * timeout (75 s on macOS, measured by the PR #45 review).
 *
 * Unlike BatchMode, a user's own `ConnectTimeout` wins: it is a deliberate
 * choice for a slow link, not a setting that could make a hook wait for a
 * password. The option is otherwise inserted right after the program word,
 * like `sshCommandWithBatchMode`, and a wrapper program is left alone.
 */
export function sshCommandWithConnectTimeout(
	command: string | undefined,
	seconds: number,
): string | undefined {
	if (command === undefined || command.trim() === "")
		return `${SSH_CLIENT} -o ConnectTimeout=${seconds}`;
	const trimmed = command.trim();
	const program = trimmed.split(/\s+/)[0] ?? "";
	if (basename(program) !== SSH_CLIENT || /connecttimeout/i.test(trimmed)) return command;
	return `${program} -o ConnectTimeout=${seconds}${trimmed.slice(program.length)}`;
}

/** `fe80::1` -> `[fe80::1]`, `me@::1` -> `me@[::1]`; anything else unchanged. */
function bracketIpv6(host: string): string {
	const at = host.lastIndexOf("@");
	const user = at < 0 ? "" : host.slice(0, at + 1);
	const address = at < 0 ? host : host.slice(at + 1);
	if (!address.includes(":") || address.startsWith("[")) return host;
	return `${user}[${address}]`;
}

/**
 * True when `host` (with or without `user@`, bracketed or not) is an IPv6
 * literal.
 *
 * Callers that hand a host to rsync's `host:path` grammar need to know: an
 * unbracketed `fe80::1:/path` is ambiguous there, and a bracketed one is not
 * something ssh itself accepts as a destination. Warp refuses such targets
 * with a clear message instead of failing halfway (see services/warp.ts).
 */
export function isIpv6Literal(host: string): boolean {
	const at = host.lastIndexOf("@");
	const address = at < 0 ? host : host.slice(at + 1);
	return address.startsWith("[") || address.includes(":");
}

/**
 * The same rule {@link remoteSpec} and `RemoteMachine` enforce on a remote
 * path, exported so a planner can refuse a path BEFORE it runs anything.
 *
 * Warp checks its working directory and transcript folder with this at
 * planning time: otherwise a path with a space passes `--dry-run`, writes the
 * marker and copies the transcript, and only then fails at the working
 * directory copy.
 */
export function isSafeRemotePath(path: string): boolean {
	return SAFE_REMOTE_PATH.test(path);
}

/** The characters {@link isSafeRemotePath} allows, for error messages. */
export const SAFE_REMOTE_PATH_DESCRIPTION = "letters, digits and . _ / ~ + -";
