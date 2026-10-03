import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	isExcluded,
	LocalMachine,
	RemoteMachine,
	type RunResult,
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

function tempDir(): string {
	return mkdtempSync(join(tmpdir(), "drive-remote-"));
}

function writeFile(path: string, contents: string): void {
	mkdirSync(join(path, ".."), { recursive: true });
	writeFileSync(path, contents, "utf-8");
}

const tmpDirs: string[] = [];
function trackedDir(): string {
	const dir = tempDir();
	tmpDirs.push(dir);
	return dir;
}

afterEach(() => {
	while (tmpDirs.length > 0) {
		const dir = tmpDirs.pop();
		if (dir) spawnSync("rm", ["-rf", dir]);
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

	it("runs commands locally without ssh", async () => {
		const { calls, spawner } = recordingSpawner({ stdout: "hi" });
		const machine = new LocalMachine(spawner);

		const result = await machine.ssh(["echo", "hello world"], { cwd: "/tmp" });

		expect(result.stdout).toBe("hi");
		expect(calls).toHaveLength(1);
		expect(calls[0].file).toBe("echo");
		expect(calls[0].args).toEqual(["hello world"]);
		expect(calls[0].cwd).toBe("/tmp");
	});

	it("copies a single file with scp", async () => {
		const dir = trackedDir();
		const src = join(dir, "one.txt");
		writeFileSync(src, "content", "utf-8");
		const dst = join(dir, "copy.txt");

		const result = await new LocalMachine(recordingSpawner().spawner).scp(src, dst);

		expect(result.code).toBe(0);
		expect(readFileSync(dst, "utf-8")).toBe("content");
	});

	it("reports a missing source instead of throwing", async () => {
		const result = await new LocalMachine(recordingSpawner().spawner).rsync(
			join(tempDir(), "nope"),
			tempDir(),
		);
		expect(result.code).not.toBe(0);
	});
});

describe("RemoteMachine", () => {
	it("builds an ssh argv with every word quoted", async () => {
		const { calls, spawner } = recordingSpawner({ code: 0 });
		const machine = new RemoteMachine("netcup", spawner);

		await machine.ssh(["git", "push", "origin", "main"], { stdin: "in", cwd: "/srv" });

		expect(calls).toEqual([
			{
				file: "ssh",
				args: ["netcup", "--", "git", "push", "origin", "main"],
				stdin: "in",
				cwd: "/srv",
				tty: undefined,
			},
		]);
	});

	it("quotes words that would otherwise break in the remote shell", async () => {
		const { calls, spawner } = recordingSpawner();
		await new RemoteMachine("netcup", spawner).ssh(["sh", "-c", "echo $HOME && ls '/tmp/a b'"]);

		expect(calls[0].args).toEqual([
			"netcup",
			"--",
			"sh",
			"-c",
			shellQuote("echo $HOME && ls '/tmp/a b'"),
		]);
	});

	it("builds rsync args and never passes --delete by default", async () => {
		const { calls, spawner } = recordingSpawner();
		const machine = new RemoteMachine("netcup", spawner);

		await machine.rsync("/srv/hyperdrive", "/home/svallory/hyperdrive", {
			excludes: ["node_modules", "*.log"],
		});

		expect(calls[0].file).toBe("rsync");
		expect(calls[0].args).toEqual([
			"-a",
			"--info=stats1",
			"--exclude=node_modules",
			"--exclude=*.log",
			"/srv/hyperdrive",
			"netcup:/home/svallory/hyperdrive",
		]);
		expect(calls[0].args).not.toContain("--delete");
	});

	it("passes --delete only when explicitly asked", async () => {
		const { calls, spawner } = recordingSpawner();
		await new RemoteMachine("netcup", spawner).rsync("/a", "/b", { delete: true });

		expect(calls[0].args).toContain("--delete");
		expect(calls[0].args.indexOf("--delete")).toBe(calls[0].args.length - 3);
	});

	it("builds scp args", async () => {
		const { calls, spawner } = recordingSpawner();
		await new RemoteMachine("netcup", spawner).scp("/tmp/a.txt", "/home/svallory/a.txt");

		expect(calls[0].file).toBe("scp");
		expect(calls[0].args).toEqual(["/tmp/a.txt", "netcup:/home/svallory/a.txt"]);
	});

	it("exposes the host it was built with", () => {
		expect(new RemoteMachine("netcup", recordingSpawner().spawner).host).toBe("netcup");
	});
});
