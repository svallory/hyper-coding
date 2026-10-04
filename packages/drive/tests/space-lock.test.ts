/**
 * B1 of the PR #45 review: concurrent writers of one space index. Real git,
 * real CLI processes, no mocks; windows are widened with a git wrapper on a
 * fixture-private PATH, the way the review reproduced the secret race.
 */
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderGitignore } from "#services/allowlist";
import { initSpaceGitDir, spaceGit, spaceGitDir } from "#services/space-git";
import {
	type LockOwner,
	type LockProbe,
	ownerStaleReason,
	processStartId,
	SPACE_LOCK_FILE,
	SpaceLockTimeoutError,
	STALE_AFTER_MS,
	utcLstartSeconds,
	withSpaceLock,
} from "#services/space-lock";
import { commitSpace, pushSpace } from "#services/space-sync";
import { git } from "#tests/tmp-manifest";
import { makeBareSpace } from "#tests/tmp-space";

const repository = join(import.meta.dirname, "../../..");
const cli = join(repository, "packages/cli/bin/run.js");
const realGit = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
let directory: string;

beforeEach(() => {
	directory = realpathSync(mkdtempSync(join(tmpdir(), "hyper-space-lock-")));
	for (const [key, value] of Object.entries({
		HOME: join(directory, "home"),
		HYPER_HOME: join(directory, "hyper"),
		HYPER_DRIVE_CONFIG: join(directory, "drive.toml"),
		XDG_CONFIG_HOME: join(directory, "config"),
		CLAUDE_CONFIG_DIR: join(directory, "claude"),
		GIT_CONFIG_GLOBAL: "/dev/null",
		GIT_CONFIG_NOSYSTEM: "1",
		GIT_AUTHOR_NAME: "lock test",
		GIT_COMMITTER_NAME: "lock test",
		GIT_AUTHOR_EMAIL: "lock@example.invalid",
		GIT_COMMITTER_EMAIL: "lock@example.invalid",
		// The CLI's update check spawns a detached writer into HOME.
		HYPER_SKIP_NEW_VERSION_CHECK: "1",
		NO_COLOR: "1",
		FORCE_COLOR: "0",
	}))
		vi.stubEnv(key, value);
	mkdirSync(process.env.HOME!, { recursive: true });
	mkdirSync(process.env.CLAUDE_CONFIG_DIR!, { recursive: true });
});
afterEach(() => {
	vi.unstubAllEnvs();
	rmSync(directory, { recursive: true, force: true });
});

async function makeSpace() {
	const root = join(directory, "space");
	const remote = join(directory, "remote.git");
	git(["init", "--bare", remote], directory);
	makeBareSpace(root);
	mkdirSync(join(root, "notes"));
	writeFileSync(join(root, "notes/a.md"), "initial\n");
	writeFileSync(join(root, ".gitignore"), renderGitignore());
	initSpaceGitDir(root, { branch: "space/lock", remote });
	spaceGit(root, ["config", "gc.auto", "0"]);
	await commitSpace(root, "space/lock", "initial");
	pushSpace(root, remote, "space/lock");
	return { root, remote };
}

/** A git on PATH that sleeps before running when its argv contains `pattern`. */
function slowGit(name: string, pattern: string, seconds: number): NodeJS.ProcessEnv {
	const bin = join(directory, name);
	mkdirSync(bin);
	writeFileSync(
		join(bin, "git"),
		`#!/bin/sh\ncase " $* " in *"${pattern}"*) sleep ${seconds};; esac\nexec '${realGit}' "$@"\n`,
		{ mode: 0o755 },
	);
	return { ...process.env, PATH: `${bin}:${process.env.PATH}` };
}

interface Finished {
	status: number | null;
	stdout: string;
	stderr: string;
}
function start(root: string, args: string[], env: NodeJS.ProcessEnv = process.env) {
	const child: ChildProcess = spawn(process.execPath, [cli, ...args], {
		cwd: root,
		env,
		stdio: ["ignore", "pipe", "pipe"],
	});
	let stdout = "";
	let stderr = "";
	child.stdout!.on("data", (chunk) => {
		stdout += chunk;
	});
	child.stderr!.on("data", (chunk) => {
		stderr += chunk;
	});
	return new Promise<Finished>((resolve) =>
		child.on("close", (status) => resolve({ status, stdout, stderr })),
	);
}
function committedFiles(root: string): string[] {
	return spaceGit(root, ["ls-tree", "-r", "--name-only", "-z", "HEAD"])
		.stdout.split("\0")
		.filter(Boolean);
}
function deadPid(): number {
	const child = spawnSync("true");
	return child.pid!;
}
function writeLock(
	root: string,
	pid: number,
	started = Date.now(),
	extra: { procStart?: string; pidNs?: string } = {},
) {
	writeFileSync(
		join(spaceGitDir(root), SPACE_LOCK_FILE),
		`${JSON.stringify({ pid, host: hostname(), started, token: "test-token", ...extra })}\n`,
	);
}
/** A live process this test owns; killed in `finally` by the caller. */
function liveChild(): ChildProcess {
	return spawn("/bin/sleep", ["120"], { stdio: "ignore" });
}

describe("space lock: concurrent commits", () => {
	it("N concurrent `hyper space commit` processes: every file committed, none fails, fsck clean", async () => {
		const { root } = await makeSpace();
		const count = 5;
		for (let index = 0; index < count; index++)
			writeFileSync(join(root, `notes/p${index}.md`), `process ${index}\n`);
		// Widen the stage-to-commit window so the processes really overlap.
		const env = slowGit("slow", " commit -m ", 0.3);
		const results = await Promise.all(
			Array.from({ length: count }, (_, index) =>
				start(root, ["space", "commit", "-m", `p${index}`], env),
			),
		);
		for (const result of results) {
			expect(result.status, result.stderr).toBe(0);
			expect(result.stderr).not.toMatch(/lock|index/i);
		}
		const files = committedFiles(root);
		for (let index = 0; index < count; index++) expect(files).toContain(`notes/p${index}.md`);
		expect(spaceGit(root, ["status", "--porcelain"]).stdout).toBe("");
		expect(spawnSync("git", ["--git-dir", spaceGitDir(root), "fsck", "--no-progress"]).status).toBe(
			0,
		);
		expect(existsSync(join(spaceGitDir(root), SPACE_LOCK_FILE))).toBe(false);
	}, 60_000);

	it("a secret staged while another process is between inspection and commit is never committed", async () => {
		const { root } = await makeSpace();
		writeFileSync(join(root, "notes/a.md"), "legit change\n");
		// P1 inspects a clean index, then sleeps 3 s before `git commit`.
		const first = start(
			root,
			["space", "commit", "-m", "p1 legit"],
			slowGit("s1", " commit -m ", 3),
		);
		const lock = join(spaceGitDir(root), SPACE_LOCK_FILE);
		const deadline = Date.now() + 10_000;
		while (!existsSync(lock) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
		expect(existsSync(lock)).toBe(true);
		await new Promise((r) => setTimeout(r, 1500));
		// Now P1 is inside its window. P2 stages a .env (its own inspection slowed).
		writeFileSync(join(root, "notes/.env"), "AWS_SECRET=abc\n");
		const second = start(
			root,
			["space", "commit", "-m", "p2"],
			slowGit("s2", "cat-file --batch-check", 1),
		);
		const [one, two] = await Promise.all([first, second]);
		expect(one.status, one.stderr).toBe(0);
		expect(one.stdout).toContain("Committed 1 file");
		expect(committedFiles(root)).not.toContain("notes/.env");
		expect(
			spaceGit(root, ["show", "--name-only", "--format=", "HEAD"]).stdout.trim().split("\n"),
		).toEqual(["notes/a.md"]);
		expect(two.status).not.toBe(0);
		expect(two.stderr).toContain("secret guard");
		expect(spaceGit(root, ["diff", "--cached", "--name-only", "-z"]).stdout).toBe("");
	}, 60_000);

	it("takes over a stale lock from a dead pid, and the index.lock its git left behind", async () => {
		const { root } = await makeSpace();
		const started = Date.now() - 5_000;
		writeLock(root, deadPid(), started);
		const indexLock = join(spaceGitDir(root), "index.lock");
		writeFileSync(indexLock, "");
		utimesSync(indexLock, new Date(started + 1000), new Date(started + 1000));
		writeFileSync(join(root, "notes/b.md"), "after a crash\n");
		const result = await start(root, ["space", "commit", "-m", "after crash"]);
		expect(result.status, result.stderr).toBe(0);
		expect(result.stderr.trim().split("\n"), result.stderr).toHaveLength(1);
		expect(result.stderr).toMatch(/took over a stale space lock .*is no longer running/);
		expect(committedFiles(root)).toContain("notes/b.md");
		expect(existsSync(indexLock)).toBe(false);
		expect(existsSync(join(spaceGitDir(root), SPACE_LOCK_FILE))).toBe(false);
	}, 30_000);

	it("a lock from an older CLI (no recorded start time) keeps the age rule even when its pid is alive", async () => {
		const { root } = await makeSpace();
		writeLock(root, process.pid, Date.now() - 31 * 60 * 1000);
		writeFileSync(join(root, "notes/c.md"), "old lock\n");
		const result = await start(root, ["space", "commit", "-m", "old lock"]);
		expect(result.status, result.stderr).toBe(0);
		expect(result.stderr).toMatch(/older than 30 minutes/);
	}, 30_000);

	it("a live lock held past the bound: commit and pull give one clear line, exit non-zero, index untouched", async () => {
		const { root } = await makeSpace();
		writeLock(root, process.pid);
		writeFileSync(join(root, "notes/a.md"), "waiting\n");
		writeFileSync(join(root, "notes/new.md"), "waiting\n");
		const started = Date.now();
		const [commit, pull] = await Promise.all([
			start(root, ["space", "commit", "-m", "blocked"]),
			start(root, ["space", "pull"]),
		]);
		const elapsed = Date.now() - started;
		for (const result of [commit, pull]) {
			expect(result.status).not.toBe(0);
			// oclif wraps its one error message to the terminal width; unwrap it.
			const message = result.stderr.replace(/\s+/g, " ").trim();
			expect(message.match(/Error:/g)).toHaveLength(1);
			expect(message).toContain(`hyper process ${process.pid} has held this space's lock for`);
			expect(message).toMatch(
				/and is still running, so I did not .* \(waited 15 s; nothing was changed\)/,
			);
			// Never an invitation to delete a live owner's lock.
			expect(message).toContain(`only if process ${process.pid} is gone`);
			expect(message).not.toMatch(/if no hyper process is running, delete/);
		}
		expect(elapsed).toBeGreaterThanOrEqual(14_000);
		expect(elapsed).toBeLessThan(40_000);
		expect(spaceGit(root, ["diff", "--cached", "--name-only", "-z"]).stdout).toBe("");
		expect(spaceGit(root, ["rev-list", "--count", "HEAD"]).stdout.trim()).toBe("1");
		// The lock that was never ours is still in place.
		expect(existsSync(join(spaceGitDir(root), SPACE_LOCK_FILE))).toBe(true);
	}, 60_000);
});

describe("withSpaceLock", () => {
	it("releases after an async action and after a throw, and times out without running", async () => {
		const { root } = await makeSpace();
		const lock = join(spaceGitDir(root), SPACE_LOCK_FILE);
		await withSpaceLock(root, "test", async () => {
			expect(existsSync(lock)).toBe(true);
		});
		expect(existsSync(lock)).toBe(false);
		expect(() =>
			withSpaceLock(root, "test", () => {
				throw new Error("inside");
			}),
		).toThrow("inside");
		expect(existsSync(lock)).toBe(false);
		writeLock(root, process.pid);
		let ran = false;
		expect(() =>
			withSpaceLock(
				root,
				"run the test action",
				() => {
					ran = true;
				},
				{ waitMs: 200 },
			),
		).toThrow(SpaceLockTimeoutError);
		expect(ran).toBe(false);
	});
});

describe("space lock: a live owner is never taken over", () => {
	const thirtyOneMinutesAgo = () => Date.now() - 31 * 60 * 1000;

	it("a live child holding the lock past the age limit keeps it", async () => {
		const { root } = await makeSpace();
		const child = liveChild();
		try {
			const procStart = processStartId(child.pid!);
			expect(procStart).not.toBeNull();
			writeLock(root, child.pid!, thirtyOneMinutesAgo(), { procStart: procStart! });
			let ran = false;
			const notes: string[] = [];
			expect(() =>
				withSpaceLock(
					root,
					"run the test action",
					() => {
						ran = true;
					},
					{ waitMs: 500, note: (message) => notes.push(message) },
				),
			).toThrow(new RegExp(`hyper process ${child.pid} has held`));
			expect(ran).toBe(false);
			expect(notes).toEqual([]);
			expect(existsSync(join(spaceGitDir(root), SPACE_LOCK_FILE))).toBe(true);
		} finally {
			child.kill("SIGKILL");
		}
	});

	it("a live pid with a different start time (reused pid) is taken over", async () => {
		const { root } = await makeSpace();
		const child = liveChild();
		try {
			writeLock(root, child.pid!, Date.now(), { procStart: "ps:Thu Jan 1 00:00:00 1970" });
			const notes: string[] = [];
			let ran = false;
			withSpaceLock(
				root,
				"test",
				() => {
					ran = true;
				},
				{ waitMs: 500, note: (message) => notes.push(message) },
			);
			expect(ran).toBe(true);
			expect(notes).toHaveLength(1);
			expect(notes[0]).toMatch(/that pid now belongs to another process/);
		} finally {
			child.kill("SIGKILL");
		}
	});

	it("a dead owner that recorded its start time is taken over at once", async () => {
		const { root } = await makeSpace();
		writeLock(root, deadPid(), Date.now(), { procStart: "ps:Thu Jan 1 00:00:00 1970" });
		const notes: string[] = [];
		withSpaceLock(root, "test", () => undefined, {
			waitMs: 500,
			note: (message) => notes.push(message),
		});
		expect(notes.join("\n")).toMatch(/is no longer running/);
	});

	it("records this process's start time and pid namespace in the lock it writes", async () => {
		const { root } = await makeSpace();
		const lock = join(spaceGitDir(root), SPACE_LOCK_FILE);
		const owner = withSpaceLock(
			root,
			"test",
			() => JSON.parse(readFileSync(lock, "utf8")) as LockOwner,
		);
		expect(owner.pid).toBe(process.pid);
		expect(owner.procStart).toBe(processStartId(process.pid));
		if (process.platform === "linux") expect(owner.pidNs).toMatch(/^pid:\[\d+\]$/);
	});

	describe("ownerStaleReason", () => {
		const now = Date.now();
		const owner = (extra: Partial<LockOwner> = {}): LockOwner => ({
			pid: 4242,
			host: "here",
			started: now,
			token: "t",
			procStart: "ps:A",
			...extra,
		});
		const probe = (extra: Partial<LockProbe> = {}): LockProbe => ({
			host: "here",
			pidNs: null,
			now,
			isAlive: () => true,
			startOf: () => "ps:A",
			...extra,
		});
		const old = now - STALE_AFTER_MS - 1;

		it("same host, live pid, same start: never stale, however old", () => {
			expect(ownerStaleReason(owner(), probe())).toBeNull();
			expect(ownerStaleReason(owner({ started: old }), probe())).toBeNull();
		});
		it("same host, dead pid: stale at once", () => {
			expect(ownerStaleReason(owner(), probe({ isAlive: () => false }))).toMatch(
				/no longer running/,
			);
		});
		it("same host, live pid, different start: stale (pid reuse)", () => {
			expect(ownerStaleReason(owner(), probe({ startOf: () => "ps:B" }))).toMatch(
				/another process/,
			);
		});
		it("falls back to the age rule when liveness cannot be judged", () => {
			for (const [o, p] of [
				[owner({ host: "elsewhere" }), probe({ isAlive: () => false })],
				[owner({ pidNs: "pid:[1]" }), probe({ pidNs: "pid:[2]", isAlive: () => false })],
				[owner({ procStart: undefined }), probe()],
				[owner(), probe({ startOf: () => null })],
			] as const) {
				expect(ownerStaleReason(o, p)).toBeNull();
				expect(ownerStaleReason({ ...o, started: old }, p)).toMatch(/older than 30 minutes/);
			}
		});
		it("the same pid namespace (or an unknown one) is judged by the pid", () => {
			expect(
				ownerStaleReason(
					owner({ pidNs: "pid:[1]" }),
					probe({ pidNs: "pid:[1]", isAlive: () => false }),
				),
			).toMatch(/no longer running/);
			expect(
				ownerStaleReason(owner({ pidNs: "pid:[1]" }), probe({ isAlive: () => false })),
			).toMatch(/no longer running/);
		});
	});
});

describe("space lock: PR #52 review round 2", () => {
	const distLock = join(import.meta.dirname, "..", "dist", "services", "space-lock.js");
	const asRoot = process.getuid?.() === 0;
	const oneMinuteAgo = () => new Date(Date.now() - 60_000);

	/** A node child that runs `body` with the built space-lock module as `m`. */
	function lockChild(tz: string, body: string): ChildProcess {
		return spawn(
			process.execPath,
			["-e", `import(${JSON.stringify(distLock)}).then(async (m) => { ${body} })`],
			{
				env: { ...process.env, TZ: tz },
				stdio: ["ignore", "pipe", "pipe"],
			},
		);
	}
	function output(
		child: ChildProcess,
	): Promise<{ status: number | null; stdout: string; stderr: string }> {
		let stdout = "";
		let stderr = "";
		child.stdout!.on("data", (chunk) => {
			stdout += chunk;
		});
		child.stderr!.on("data", (chunk) => {
			stderr += chunk;
		});
		return new Promise((resolve) =>
			child.on("close", (status) => resolve({ status, stdout, stderr })),
		);
	}

	it("parses ps lstart printed under TZ=UTC0 into epoch seconds", () => {
		expect(utcLstartSeconds("Sun Oct  4 23:03:55 2026\n")).toBe(
			Date.UTC(2026, 9, 4, 23, 3, 55) / 1000,
		);
		expect(utcLstartSeconds("Mon Jan 12 00:00:01 2026")).toBe(
			Date.UTC(2026, 0, 12, 0, 0, 1) / 1000,
		);
		expect(utcLstartSeconds("dim. 4 oct. 2026")).toBeNull();
		expect(utcLstartSeconds("")).toBeNull();
	});

	it("a writer and a waiter in different time zones agree the owner is alive, and its index.lock survives", async (ctx) => {
		if (!existsSync(distLock)) return ctx.skip("dist not built");
		const { root } = await makeSpace();
		const indexLock = join(spaceGitDir(root), "index.lock");
		const holder = lockChild(
			"UTC",
			`m.withSpaceLock(${JSON.stringify(root)}, "hold", () => {
				require("node:fs").writeFileSync(${JSON.stringify(indexLock)}, "");
				console.log("held");
				Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 6000);
			});`,
		);
		const held = output(holder);
		try {
			const deadline = Date.now() + 15_000;
			while (!existsSync(indexLock) && Date.now() < deadline)
				await new Promise((r) => setTimeout(r, 50));
			expect(existsSync(indexLock)).toBe(true);
			const waiter = await output(
				lockChild(
					"America/New_York",
					`try { m.withSpaceLock(${JSON.stringify(root)}, "wait", () => console.log("WAITER GOT THE LOCK"), { waitMs: 1500, note: (n) => console.log("NOTE " + n) }); } catch (e) { console.log("TIMEOUT " + e.message); }`,
				),
			);
			expect(waiter.stdout, waiter.stderr).toContain("TIMEOUT hyper process");
			expect(waiter.stdout).not.toContain("WAITER GOT THE LOCK");
			expect(waiter.stdout).not.toContain("NOTE");
			expect(existsSync(indexLock)).toBe(true);
		} finally {
			holder.kill("SIGKILL");
			await held;
		}
	}, 30_000);

	it.skipIf(asRoot)("a lock the waiter cannot read is never taken over, however old", async () => {
		const { root } = await makeSpace();
		const lock = join(spaceGitDir(root), SPACE_LOCK_FILE);
		writeFileSync(
			lock,
			`${JSON.stringify({ pid: process.pid, host: hostname(), started: Date.now(), token: "t" })}\n`,
		);
		utimesSync(lock, oneMinuteAgo(), oneMinuteAgo());
		chmodSync(lock, 0o000);
		try {
			const notes: string[] = [];
			expect(() =>
				withSpaceLock(root, "commit this space", () => undefined, {
					waitMs: 300,
					note: (n) => notes.push(n),
				}),
			).toThrow(
				/I can't read the space lock .* \(EACCES\), so I can't tell whether its owner is still running/,
			);
			expect(notes).toEqual([]);
			expect(existsSync(lock)).toBe(true);
		} finally {
			chmodSync(lock, 0o600);
		}
	});

	it("a lock holding garbage is never taken over, however old", async () => {
		const { root } = await makeSpace();
		const lock = join(spaceGitDir(root), SPACE_LOCK_FILE);
		writeFileSync(lock, "not a lock record\n");
		utimesSync(lock, oneMinuteAgo(), oneMinuteAgo());
		expect(() =>
			withSpaceLock(root, "commit this space", () => undefined, { waitMs: 300 }),
		).toThrow(/holds something that is not a hyper lock record/);
		expect(readFileSync(lock, "utf8")).toBe("not a lock record\n");
	});

	it("an empty lock (created, never written) is still taken over after the grace period", async () => {
		const { root } = await makeSpace();
		const lock = join(spaceGitDir(root), SPACE_LOCK_FILE);
		writeFileSync(lock, "");
		utimesSync(lock, oneMinuteAgo(), oneMinuteAgo());
		const notes: string[] = [];
		withSpaceLock(root, "test", () => undefined, { waitMs: 300, note: (n) => notes.push(n) });
		expect(notes.join("\n")).toMatch(/it records no owner/);
	});
});
