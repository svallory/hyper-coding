/**
 * B1 of the PR #45 review: concurrent writers of one space index. Real git,
 * real CLI processes, no mocks; windows are widened with a git wrapper on a
 * fixture-private PATH, the way the review reproduced the secret race.
 */
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
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
import { SPACE_LOCK_FILE, SpaceLockTimeoutError, withSpaceLock } from "#services/space-lock";
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
function writeLock(root: string, pid: number, started = Date.now()) {
	writeFileSync(
		join(spaceGitDir(root), SPACE_LOCK_FILE),
		`${JSON.stringify({ pid, host: hostname(), started, token: "test-token" })}\n`,
	);
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

	it("a lock older than the stale age is taken over even when its pid is alive", async () => {
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
			expect(message).toContain(`pid ${process.pid}`);
			expect(message).toMatch(
				/is still writing this space, so I did not .* \(waited 15 s; nothing was changed\)/,
			);
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
