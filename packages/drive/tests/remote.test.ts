import { spawnSync } from "node:child_process";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	readlinkSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	exitCodeForSignal,
	isExcluded,
	LocalMachine,
	RemoteMachine,
	RemotePathError,
	type RunResult,
	remoteSpec,
	type SpawnRequest,
	shellJoin,
	shellQuote,
} from "#services/remote";

/** A fake spawner: records argv, never touches a real binary. */
function recordingSpawner(result?: Partial<RunResult>) {
	const calls: SpawnRequest[] = [];
	const spawner = async (request: SpawnRequest): Promise<RunResult> => {
		calls.push(request);
		return { code: 0, stdout: "", stderr: "", ...result };
	};
	return { calls, spawner };
}

/** Every temp dir a test creates, removed afterwards. */
const tmpDirs: string[] = [];
function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "drive-remote-"));
	tmpDirs.push(dir);
	return dir;
}

function writeFile(path: string, contents: string): void {
	mkdirSync(join(path, ".."), { recursive: true });
	writeFileSync(path, contents, "utf-8");
}

afterEach(() => {
	while (tmpDirs.length > 0) {
		const dir = tmpDirs.pop();
		if (dir) rmSync(dir, { recursive: true, force: true });
	}
});

describe("shellQuote", () => {
	const samples = [
		"plain",
		"with space",
		"it's",
		`say "hi"`,
		"$HOME",
		"`whoami`",
		"a;b",
		"a&b",
		"back\\slash",
		"",
		"new\nline",
		"$(rm -rf /)",
	];

	it("round-trips through a real shell", () => {
		for (const sample of samples) {
			const result = spawnSync("/bin/sh", ["-c", `printf %s ${shellQuote(sample)}`], {
				encoding: "utf-8",
			});
			expect(result.status).toBe(0);
			expect(result.stdout).toBe(sample);
		}
	});

	it("leaves shell-safe words untouched", () => {
		expect(shellQuote("plain")).toBe("plain");
		expect(shellQuote("/usr/bin/env")).toBe("/usr/bin/env");
		expect(shellQuote("")).toBe("''");
	});

	it("wraps anything else in single quotes", () => {
		expect(shellQuote("a b")).toBe("'a b'");
		expect(shellQuote("it's")).toBe(`'it'\\''s'`);
	});

	it("quotes every word of an argv array", () => {
		expect(shellJoin(["echo", "hello world"])).toBe("echo 'hello world'");
	});
});

describe("remoteSpec", () => {
	it("passes a safe path through raw", () => {
		expect(remoteSpec("netcup", "/home/agent/hyperdrive")).toBe("netcup:/home/agent/hyperdrive");
		expect(remoteSpec("netcup", "~/hyperdrive")).toBe("netcup:~/hyperdrive");
		expect(remoteSpec("netcup", "/srv/a-b_c.1/+dir")).toBe("netcup:/srv/a-b_c.1/+dir");
	});

	it("refuses a path it cannot send safely, naming the path", () => {
		// Quoting is not an option here: OpenSSH 10.2's scp (SFTP mode) writes the
		// quotes into the filename, and rsync >= 3.2.4 escapes them itself.
		for (const bad of ["/home/agent/my drive", "/home/$(whoami)", "/home/a`b`", "/home/a'b", ""]) {
			expect(() => remoteSpec("netcup", bad)).toThrow(RemotePathError);
			try {
				remoteSpec("netcup", bad);
			} catch (err) {
				expect((err as Error).message).toContain(bad);
				expect((err as Error).message).toContain("netcup");
			}
		}
	});
});

describe("isExcluded", () => {
	it("matches a bare name at any depth", () => {
		expect(isExcluded("node_modules", ["node_modules"])).toBe(true);
		expect(isExcluded("packages/app/node_modules", ["node_modules"])).toBe(true);
		expect(isExcluded("node_modules_other", ["node_modules"])).toBe(false);
	});

	it("supports globs", () => {
		expect(isExcluded("debug.log", ["*.log"])).toBe(true);
		expect(isExcluded("logs/debug.log", ["*.log"])).toBe(true);
		expect(isExcluded("a/b/c.txt", ["**/*.txt"])).toBe(true);
		expect(isExcluded("c.txt", ["**/*.txt"])).toBe(true);
	});

	it("anchors patterns that contain a slash", () => {
		expect(isExcluded("build/out.js", ["build/**"])).toBe(true);
		expect(isExcluded("src/build/out.js", ["build/**"])).toBe(false);
	});

	it("treats a leading slash as anchoring, not as part of the name", () => {
		expect(isExcluded("build/out.js", ["/build/**"])).toBe(true);
		expect(isExcluded("src/build/out.js", ["/build/**"])).toBe(false);
		// The anchor survives the slash being stripped: /build is NOT "build"
		// at any depth.
		expect(isExcluded("build", ["/build"])).toBe(true);
		expect(isExcluded("src/build", ["/build"])).toBe(false);
	});

	it("applies a trailing-slash pattern to directories only", () => {
		expect(isExcluded("cache", ["cache/"], true)).toBe(true);
		expect(isExcluded("cache", ["cache/"], false)).toBe(false);
		expect(isExcluded("nested/cache", ["cache/"], true)).toBe(true);
		expect(isExcluded("cache", ["cache"], false)).toBe(true);
	});
});

describe("exitCodeForSignal", () => {
	it("uses the shell's 128 + signal convention", () => {
		expect(exitCodeForSignal("SIGTERM")).toBe(143);
		expect(exitCodeForSignal("SIGHUP")).toBe(129);
		expect(exitCodeForSignal("SIGKILL")).toBe(137);
		expect(exitCodeForSignal(null)).toBe(0);
	});
});

describe("LocalMachine", () => {
	it("copies a tree honouring excludes and keeps extra destination files", async () => {
		const src = tempDir();
		const dst = tempDir();
		writeFile(join(src, "keep.txt"), "keep");
		writeFile(join(src, "debug.log"), "log");
		writeFile(join(src, "nested/deep.txt"), "deep");
		writeFile(join(dst, "already-here.txt"), "mine");

		const machine = new LocalMachine(recordingSpawner().spawner);
		const result = await machine.rsync(src, dst, { excludes: ["*.log"] });

		expect(result.code).toBe(0);
		expect(readFileSync(join(dst, "keep.txt"), "utf-8")).toBe("keep");
		expect(readFileSync(join(dst, "nested/deep.txt"), "utf-8")).toBe("deep");
		expect(existsSync(join(dst, "debug.log"))).toBe(false);
		// No --delete was asked for, so the destination's own file survives.
		expect(existsSync(join(dst, "already-here.txt"))).toBe(true);
	});

	it("copies the contents of src, never a nested basename", async () => {
		const src = tempDir();
		const dst = tempDir();
		writeFile(join(src, "file.txt"), "x");

		await new LocalMachine(recordingSpawner().spawner).rsync(src, dst);

		// Matches `rsync -a src/ dst` — and RemoteMachine adds the trailing slash
		// to its argv for exactly this reason.
		expect(existsSync(join(dst, "file.txt"))).toBe(true);
		expect(existsSync(join(dst, basename(src)))).toBe(false);
	});

	it("removes extraneous destination files only when delete is true", async () => {
		const src = tempDir();
		const dst = tempDir();
		writeFile(join(src, "keep.txt"), "keep");
		writeFile(join(dst, "stale.txt"), "stale");

		const machine = new LocalMachine(recordingSpawner().spawner);
		await machine.rsync(src, dst);
		expect(existsSync(join(dst, "stale.txt"))).toBe(true);

		await machine.rsync(src, dst, { delete: true });
		expect(existsSync(join(dst, "stale.txt"))).toBe(false);
		expect(readdirSync(dst)).toEqual(["keep.txt"]);
	});

	it("copies symlinks as symlinks, including dangling ones", async () => {
		const src = tempDir();
		const dst = tempDir();
		writeFile(join(src, "real.txt"), "real");
		symlinkSync("real.txt", join(src, "link-to-file"));
		symlinkSync("nowhere.txt", join(src, "dangling"));
		mkdirSync(join(src, "dir"));
		symlinkSync("dir", join(src, "link-to-dir"));

		const result = await new LocalMachine(recordingSpawner().spawner).rsync(src, dst);
		expect(result.code).toBe(0);

		expect(lstatSync(join(dst, "link-to-file")).isSymbolicLink()).toBe(true);
		expect(readFileSync(join(dst, "link-to-file"), "utf-8")).toBe("real");
		expect(lstatSync(join(dst, "dangling")).isSymbolicLink()).toBe(true);
		expect(readlinkSync(join(dst, "dangling"))).toBe("nowhere.txt");
		expect(lstatSync(join(dst, "link-to-dir")).isSymbolicLink()).toBe(true);
	});

	it("a symlink at the destination never redirects a write outside it", async () => {
		const src = tempDir();
		const dst = tempDir();
		const outside = tempDir();
		writeFile(join(src, "config"), "new");
		// dst/config -> <outside>/target : without the fix the write would
		// follow the link and land outside the destination tree.
		symlinkSync(join(outside, "target"), join(dst, "config"));

		await new LocalMachine(recordingSpawner().spawner).rsync(src, dst);

		expect(lstatSync(join(dst, "config")).isSymbolicLink()).toBe(false);
		expect(readFileSync(join(dst, "config"), "utf-8")).toBe("new");
		expect(existsSync(join(outside, "target"))).toBe(false);
	});

	it("a destination directory where a source file belongs is replaced", async () => {
		const src = tempDir();
		const dst = tempDir();
		writeFile(join(src, "data.txt"), "file");
		mkdirSync(join(dst, "data.txt", "inside"), { recursive: true });

		await new LocalMachine(recordingSpawner().spawner).rsync(src, dst);

		expect(lstatSync(join(dst, "data.txt")).isDirectory()).toBe(false);
		expect(readFileSync(join(dst, "data.txt"), "utf-8")).toBe("file");
	});

	it("follows a top-level destination symlink, like rsync", async () => {
		const src = tempDir();
		const dst = join(tempDir(), "link");
		const realDst = tempDir();
		writeFile(join(src, "file.txt"), "through");
		symlinkSync(realDst, dst);

		const result = await new LocalMachine(recordingSpawner().spawner).rsync(src, dst);

		expect(result.code).toBe(0);
		// The link stays a link; the file lands through it.
		expect(lstatSync(dst).isSymbolicLink()).toBe(true);
		expect(readFileSync(join(realDst, "file.txt"), "utf-8")).toBe("through");
	});

	it("copies a symlink source as the link itself, not the file it points to", async () => {
		const src = tempDir();
		const dst = tempDir();
		writeFile(join(src, "real.txt"), "real");
		symlinkSync("real.txt", join(src, "link.txt"));

		// rsync -a keeps the link; only `-L` would follow it.
		await new LocalMachine(recordingSpawner().spawner).rsync(
			join(src, "link.txt"),
			join(dst, "link.txt"),
		);

		expect(lstatSync(join(dst, "link.txt")).isSymbolicLink()).toBe(true);
		expect(readlinkSync(join(dst, "link.txt"))).toBe("real.txt");
	});

	it("puts a file inside the destination when the destination is a directory", async () => {
		const src = tempDir();
		const dst = tempDir();
		writeFile(join(src, "data.txt"), "data");

		// `rsync -a src dst` with an existing directory dst creates dst/data.txt;
		// without that, a file copy onto a directory fails with EISDIR.
		const result = await new LocalMachine(recordingSpawner().spawner).rsync(
			join(src, "data.txt"),
			dst,
		);

		expect(result.code).toBe(0);
		expect(readFileSync(join(dst, "data.txt"), "utf-8")).toBe("data");
	});

	it("excludes a symlink like any other entry", async () => {
		const src = tempDir();
		const dst = tempDir();
		writeFile(join(src, "keep.txt"), "keep");
		symlinkSync("keep.txt", join(src, "skip.txt"));

		await new LocalMachine(recordingSpawner().spawner).rsync(src, dst, { excludes: ["skip.txt"] });

		expect(existsSync(join(dst, "keep.txt"))).toBe(true);
		expect(existsSync(join(dst, "skip.txt"))).toBe(false);
	});

	it("runs commands locally without ssh", async () => {
		const { calls, spawner } = recordingSpawner({ stdout: "hi" });
		const machine = new LocalMachine(spawner);

		const result = await machine.ssh(["echo", "hello world"], { cwd: "/tmp" });

		expect(result.stdout).toBe("hi");
		expect(calls).toHaveLength(1);
		expect(calls[0].file).toBe("echo");
		expect(calls[0].args).toEqual(["hello world"]);
		// A local cwd is just the child's working directory — it exists here.
		expect(calls[0].cwd).toBe("/tmp");
	});

	it("reports a signal-killed command as a failure, not a success", async () => {
		// The real spawner here: this test is about the exit code Node reports.
		const machine = new LocalMachine();

		const result = await machine.ssh(["/bin/sh", "-c", "kill -TERM $$"]);

		expect(result.code).toBe(143);
		expect(result.code).not.toBe(0);
	});

	it("copies a single file with scp", async () => {
		const dir = tempDir();
		const src = join(dir, "one.txt");
		writeFileSync(src, "content", "utf-8");
		const dst = join(dir, "copy.txt");

		const result = await new LocalMachine(recordingSpawner().spawner).scp(src, dst);

		expect(result.code).toBe(0);
		expect(readFileSync(dst, "utf-8")).toBe("content");
	});

	it("reports a missing source instead of throwing", async () => {
		const machine = new LocalMachine(recordingSpawner().spawner);

		const rsync = await machine.rsync(join(tempDir(), "nope"), tempDir());
		expect(rsync.code).not.toBe(0);
		expect(rsync.stderr).toMatch(/doesn't exist/);

		const scp = await machine.scp(join(tempDir(), "nope"), tempDir());
		expect(scp.code).not.toBe(0);
		expect(scp.stderr).toMatch(/doesn't exist/);
	});

	it("turns filesystem errors into a non-zero result", async () => {
		const src = tempDir();
		writeFile(join(src, "file.txt"), "x");
		// A file where the destination directory should be.
		const dst = join(src, "file.txt", "nested");

		const result = await new LocalMachine(recordingSpawner().spawner).rsync(src, dst);

		expect(result.code).not.toBe(0);
		expect(result.stderr).toMatch(/Couldn't copy/);
	});
});

describe("RemoteMachine", () => {
	it("builds an ssh argv with the command quoted as one remote line", async () => {
		const { calls, spawner } = recordingSpawner({ code: 0 });
		const machine = new RemoteMachine("netcup", spawner);

		await machine.ssh(["git", "push", "origin", "main"], { stdin: "in" });

		expect(calls).toEqual([
			{
				file: "ssh",
				args: ["netcup", "--", "git push origin main"],
				stdin: "in",
				tty: undefined,
			},
		]);
	});

	it("asks for a pty when tty is set, so interactive commands work", async () => {
		const { calls, spawner } = recordingSpawner();
		await new RemoteMachine("netcup", spawner).ssh(["tmux", "attach"], { tty: true });

		// Without `-t` the remote command dies with "not a terminal".
		expect(calls[0].args).toEqual(["-t", "netcup", "--", "tmux attach"]);
		expect(calls[0].tty).toBe(true);
	});

	it("rejects tty and stdin together", async () => {
		const { calls, spawner } = recordingSpawner();
		const machine = new RemoteMachine("netcup", spawner);

		await expect(machine.ssh(["ls"], { tty: true, stdin: "x" })).rejects.toThrow(/tty and stdin/);
		expect(calls).toEqual([]);
	});

	it("quotes words that would otherwise break in the remote shell", async () => {
		const { calls, spawner } = recordingSpawner();
		await new RemoteMachine("netcup", spawner).ssh(["sh", "-c", "echo $HOME && ls '/tmp/a b'"]);

		expect(calls[0].args).toEqual([
			"netcup",
			"--",
			`sh -c ${shellQuote("echo $HOME && ls '/tmp/a b'")}`,
		]);
	});

	it("runs a remote cwd with cd, never as the local process cwd", async () => {
		const { calls, spawner } = recordingSpawner();
		await new RemoteMachine("netcup", spawner).ssh(["ls"], { cwd: "/srv/hyper drive" });

		expect(calls[0].args).toEqual(["netcup", "--", "cd -- '/srv/hyper drive' && ls"]);
		// The local spawn must not get a cwd: that directory exists only remotely,
		// and passing it would fail locally with ENOENT before ssh ever started.
		expect(calls[0].cwd).toBeUndefined();
	});

	it("requires an absolute remote cwd", async () => {
		const { calls, spawner } = recordingSpawner();
		const machine = new RemoteMachine("netcup", spawner);

		await expect(machine.ssh(["ls"], { cwd: "~/x" })).rejects.toThrow(/absolute/);
		await expect(machine.ssh(["ls"], { cwd: "relative/dir" })).rejects.toThrow(/absolute/);
		expect(calls).toEqual([]);
	});

	it("creates the destination parent over ssh before an rsync", async () => {
		const { calls, spawner } = recordingSpawner();
		const machine = new RemoteMachine("netcup", spawner);

		await machine.rsync("/srv/hyperdrive", "/home/svallory/hyperdrive");

		// `--mkpath` is rsync 3.2.3+; openrsync and rsync 3.2.3 don't have it, so
		// the parent is made over ssh first, like LocalMachine's mkdir.
		expect(calls).toHaveLength(2);
		expect(calls[0].file).toBe("ssh");
		expect(calls[0].args).toEqual([
			"netcup",
			"--",
			`sh -c ${shellQuote("mkdir -p -- /home/svallory")}`,
		]);
		expect(calls[1].file).toBe("rsync");
	});

	it("expands a leading ~ on the remote, never quoting it", async () => {
		const { calls, spawner } = recordingSpawner();
		const machine = new RemoteMachine("netcup", spawner);

		await machine.rsync("/srv/hyperdrive", "~/spaces/foo");

		// Quoting the ~ would create a literal `~` directory under $HOME.
		expect(calls[0].args).toEqual(["netcup", "--", `sh -c ${shellQuote("mkdir -p -- ~/spaces")}`]);
		expect(calls[0].args[2]).toContain("~/");
		expect(calls[0].args[2]).not.toContain("'~/");
	});

	it("skips the mkdir when there is no parent to create", async () => {
		const { calls, spawner } = recordingSpawner();
		const machine = new RemoteMachine("netcup", spawner);

		// `~` and `~/x` land in the remote home; `/a.txt` in `/`; `file.txt` in cwd.
		for (const dst of ["~", "~/x", "/a.txt", "file.txt"]) {
			await machine.scp("/tmp/a.txt", dst);
		}

		expect(calls.every((c) => c.file === "scp")).toBe(true);
		expect(calls).toHaveLength(4);
	});

	it("stops the transfer when the parent mkdir fails", async () => {
		const { calls, spawner } = recordingSpawner({ code: 1, stderr: "disk full" });
		const machine = new RemoteMachine("netcup", spawner);

		const result = await machine.rsync("/a", "/home/agent/b");

		expect(result.code).toBe(1);
		expect(result.stderr).toBe("disk full");
		expect(calls).toHaveLength(1);
		expect(calls[0].file).toBe("ssh");
	});

	it("builds portable rsync args with no version-specific flags", async () => {
		const { calls, spawner } = recordingSpawner();
		const machine = new RemoteMachine("netcup", spawner);

		await machine.rsync("/srv/hyperdrive", "/home/svallory/hyperdrive", {
			excludes: ["node_modules", "*.log"],
		});

		expect(calls[1].args).toEqual([
			"-a",
			"--stats",
			"-e",
			"ssh",
			"--exclude=node_modules",
			"--exclude=*.log",
			"--",
			"/srv/hyperdrive",
			"netcup:/home/svallory/hyperdrive",
		]);
		// --info=stats1 is rsync 3.1+; this Mac has openrsync and rejects it.
		expect(calls[1].args.join(" ")).not.toContain("--info=");
		expect(calls[1].args).not.toContain("--delete");
	});

	it("passes --delete only when explicitly asked", async () => {
		const { calls, spawner } = recordingSpawner();
		await new RemoteMachine("netcup", spawner).rsync("/a", "/home/agent/b", { delete: true });

		expect(calls[1].args).toContain("--delete");
		// It must come before the `--` that ends the options.
		expect(calls[1].args.indexOf("--delete")).toBeLessThan(calls[1].args.indexOf("--"));
	});

	it("ends options with -- so a leading dash in a path is still a path", async () => {
		const { calls, spawner } = recordingSpawner();
		await new RemoteMachine("netcup", spawner).rsync("-weird", "/home/agent/x");

		const sep = calls[1].args.indexOf("--");
		expect(calls[1].args.slice(sep + 1)).toEqual(["-weird", "netcup:/home/agent/x"]);
	});

	it("adds a trailing slash for a directory source so contents land in dst", async () => {
		const { calls, spawner } = recordingSpawner();
		const src = tempDir();
		writeFile(join(src, "file.txt"), "x");

		await new RemoteMachine("netcup", spawner).rsync(src, "/home/agent/hyperdrive");

		// `rsync -a src dst` without the slash would create dst/<basename>/… and
		// disagree with LocalMachine, which copies contents.
		expect(calls[1].args).toContain(`${src}/`);
		expect(calls[1].args.at(-2)).toBe(`${src}/`);
	});

	it("rejects a remote path it cannot send safely", async () => {
		const { calls, spawner } = recordingSpawner();

		await expect(
			new RemoteMachine("netcup", spawner).rsync("/a", "/home/agent/my drive"),
		).rejects.toThrow(/my drive/);
		await expect(new RemoteMachine("netcup", spawner).rsync("/a", "/home/$(id)")).rejects.toThrow(
			RemotePathError,
		);
		// Nothing was spawned: the path never reaches a process.
		expect(calls).toEqual([]);
	});

	it("builds scp args with -r, -- and the remote path raw", async () => {
		const { calls, spawner } = recordingSpawner();
		await new RemoteMachine("netcup", spawner).scp("/tmp/a.txt", "/home/svallory/hyperdrive");

		// calls[0] is the ssh mkdir for the destination parent; the scp itself
		// follows with the same `-r --` shape rsync gets.
		expect(calls[1].file).toBe("scp");
		expect(calls[1].args).toEqual(["-r", "--", "/tmp/a.txt", "netcup:/home/svallory/hyperdrive"]);
	});

	it("rejects an scp path with a space instead of quoting it", async () => {
		const { calls, spawner } = recordingSpawner();

		await expect(
			new RemoteMachine("netcup", spawner).scp("/tmp/a.txt", "/home/svallory/my file.txt"),
		).rejects.toThrow(/my file\.txt/);
		expect(calls).toEqual([]);
	});

	it("rejects a host that starts with a dash, so it can't be an option", () => {
		const { calls, spawner } = recordingSpawner();

		// The constructor refuses, so nothing can ever be spawned for it.
		expect(() => new RemoteMachine("-evil", spawner)).toThrow(/machine names can't start with/);
		expect(calls).toEqual([]);
	});

	it("exposes the host it was built with", () => {
		expect(new RemoteMachine("netcup", recordingSpawner().spawner).host).toBe("netcup");
	});
});

function basename(path: string): string {
	return path.split("/").pop() ?? path;
}
