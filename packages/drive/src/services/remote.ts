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
import { constants as FS } from "node:fs";
import { access, copyFile, cp, mkdir, readdir, rm, stat } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

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
	/** Working directory for the command. */
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
		child.on("close", (code) => {
			resolvePromise({ code: code ?? 0, stdout, stderr });
		});

		if (request.tty) return;
		child.stdin?.on("error", () => {
			// The command may exit before reading all of stdin; that's not our failure.
		});
		if (request.stdin !== undefined) child.stdin?.end(request.stdin);
		else child.stdin?.end();
	});

function rsyncArgs(src: string, dst: string, opts?: RsyncOptions): string[] {
	const args = ["-a", "--info=stats1"];
	for (const pattern of opts?.excludes ?? []) {
		args.push(`--exclude=${pattern}`);
	}
	// Safety: never pass --delete unless the caller explicitly asked. Mirroring a
	// half-sent tree destroys whatever the destination had that we didn't send.
	if (opts?.delete === true) args.push("--delete");
	args.push(src, dst);
	return args;
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
 * component, a pattern with one is anchored at the transfer root.
 */
export function isExcluded(relPath: string, patterns: readonly string[]): boolean {
	for (const raw of patterns) {
		const pattern = raw.replace(/^\.\//, "").replace(/\/+$/, "");
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

async function pathExists(path: string): Promise<boolean> {
	try {
		await access(path, FS.F_OK);
		return true;
	} catch {
		return false;
	}
}

async function isDirectory(path: string): Promise<boolean> {
	try {
		return (await stat(path)).isDirectory();
	} catch {
		return false;
	}
}

/**
 * Copy `src` into `dst` the way `rsync -a` would: recurse, preserve the relative
 * layout, honour excludes, and delete extraneous destination entries only when
 * `delete` is explicitly true.
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
		const relPath = relative(root, from).split(sep).join("/");
		if (isExcluded(relPath, excludes)) continue;
		if (entry.isDirectory()) {
			await copyTree(from, to, excludes, deleteExtraneous, root);
			continue;
		}
		await copyFile(from, to);
	}

	if (!deleteExtraneous) return;
	// Only a directory destination can have extraneous entries; a file
	// destination is either overwritten or an error, exactly like rsync.
	if (!(await isDirectory(dst))) return;
	for (const entry of await readdir(dst, { withFileTypes: true })) {
		const relPath = relative(root, join(dst, entry.name)).split(sep).join("/");
		if (isExcluded(relPath, excludes)) continue;
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
		return this.spawner({
			file,
			args,
			stdin: opts?.stdin,
			cwd: opts?.cwd ? resolve(opts.cwd) : undefined,
			tty: opts?.tty,
		});
	}

	async rsync(src: string, dst: string, opts?: RsyncOptions): Promise<RunResult> {
		if (!(await pathExists(src))) {
			return { code: 23, stdout: "", stderr: `${src} doesn't exist, so there's nothing to copy.` };
		}
		if (!(await isDirectory(src))) {
			await mkdir(dirname(resolve(dst)), { recursive: true });
			await copyFile(src, dst);
			return { code: 0, stdout: `copied ${src} to ${dst}`, stderr: "" };
		}
		// Like `rsync -a src/ dst`: the contents of src land inside dst.
		await copyTree(src, dst, opts?.excludes ?? [], opts?.delete === true);
		return { code: 0, stdout: `copied ${src} to ${dst}`, stderr: "" };
	}

	async scp(src: string, dst: string): Promise<RunResult> {
		if (!(await pathExists(src))) {
			return { code: 1, stdout: "", stderr: `${src} doesn't exist, so there's nothing to copy.` };
		}
		const target = dst;
		if (!(await isDirectory(src))) await mkdir(dirname(resolve(target)), { recursive: true });
		await cp(src, target, { recursive: true });
		return { code: 0, stdout: `copied ${src} to ${target}`, stderr: "" };
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
		// `--` ends ssh's own options; each argv word is quoted so the remote
		// shell reconstructs exactly the arguments we passed.
		return this.spawner({
			file: "ssh",
			args: [this.host, "--", ...cmd.map(shellQuote)],
			stdin: opts?.stdin,
			cwd: opts?.cwd,
			tty: opts?.tty,
		});
	}

	async rsync(src: string, dst: string, opts?: RsyncOptions): Promise<RunResult> {
		return this.spawner({
			file: "rsync",
			args: rsyncArgs(src, `${this.host}:${dst}`, opts),
		});
	}

	async scp(src: string, dst: string): Promise<RunResult> {
		return this.spawner({ file: "scp", args: [src, `${this.host}:${dst}`] });
	}
}
