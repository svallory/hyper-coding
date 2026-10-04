/**
 * B2 of the PR #45 review: space remote operations are bounded. A fake ssh on
 * a fixture-private PATH stands in for a host that never answers; one test
 * uses the real ssh against 192.0.2.1 (TEST-NET-1, nothing answers there).
 */
import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderGitignore } from "#services/allowlist";
import { initSpaceGitDir, spaceGit, spaceGitDir, spaceRemoteEnv } from "#services/space-git";
import { commitSpace, pushSpace, pushSpaceBounded } from "#services/space-sync";
import { git } from "#tests/tmp-manifest";
import { makeBareSpace } from "#tests/tmp-space";

const repository = join(import.meta.dirname, "../../..");
const cli = join(repository, "packages/cli/bin/run.js");
const unreachable = "ssh://git@192.0.2.1/x.git";
const id = "ba0efb18-103b-43b5-b5a0-fc3a08a2b00b";
let directory: string;
let originalPath: string | undefined;

beforeEach(() => {
	directory = realpathSync(mkdtempSync(join(tmpdir(), "hyper-remote-bound-")));
	originalPath = process.env.PATH;
	for (const [key, value] of Object.entries({
		HOME: join(directory, "home"),
		HYPER_HOME: join(directory, "hyper"),
		HYPER_DRIVE_CONFIG: join(directory, "drive.toml"),
		XDG_CONFIG_HOME: join(directory, "config"),
		CLAUDE_CONFIG_DIR: join(directory, "claude"),
		GIT_CONFIG_GLOBAL: "/dev/null",
		GIT_CONFIG_NOSYSTEM: "1",
		GIT_AUTHOR_NAME: "bound test",
		GIT_COMMITTER_NAME: "bound test",
		GIT_AUTHOR_EMAIL: "bound@example.invalid",
		GIT_COMMITTER_EMAIL: "bound@example.invalid",
		HYPER_SKIP_NEW_VERSION_CHECK: "1",
		NO_COLOR: "1",
		FORCE_COLOR: "0",
	}))
		vi.stubEnv(key, value);
	vi.stubEnv("GIT_SSH_COMMAND", undefined);
	vi.stubEnv("GIT_SSH", undefined);
	mkdirSync(process.env.HOME!, { recursive: true });
	mkdirSync(process.env.CLAUDE_CONFIG_DIR!, { recursive: true });
});
afterEach(() => {
	vi.unstubAllEnvs();
	process.env.PATH = originalPath;
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
	initSpaceGitDir(root, { branch: "space/bound", remote });
	spaceGit(root, ["config", "gc.auto", "0"]);
	await commitSpace(root, "space/bound", "initial");
	pushSpace(root, remote, "space/bound");
	spaceGit(root, ["config", "remote.origin.url", unreachable]);
	return root;
}

/** An ssh on PATH that records its argv and pid, then hangs (or fails at once). */
function fakeSsh(mode: "hang" | "fail"): { argv: string; pid: string } {
	const bin = join(directory, "fake-bin");
	mkdirSync(bin, { recursive: true });
	const argv = join(directory, "ssh-argv");
	const pid = join(directory, "ssh-pid");
	writeFileSync(
		join(bin, "ssh"),
		`#!/bin/sh\nprintf '%s\\n' "$*" >> '${argv}'\necho $$ > '${pid}'\n${mode === "hang" ? "exec sleep 600" : "echo 'ssh: connect to host 192.0.2.1 port 22: Operation timed out' >&2; exit 255"}\n`,
		{ mode: 0o755 },
	);
	process.env.PATH = `${bin}:${originalPath}`;
	return { argv, pid };
}

function alive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

describe("bounded space remote operations", () => {
	it("hook-mode push to a host that never answers stops at its bound and kills ssh's whole group", async () => {
		const root = await makeSpace();
		const fake = fakeSsh("hang");
		const started = Date.now();
		const error = await pushSpaceBounded(root, unreachable, "space/bound", 2_000).catch(
			(caught: Error) => caught,
		);
		const elapsed = Date.now() - started;
		expect(error).toBeInstanceOf(Error);
		expect((error as Error).message).toBe(
			`the push to ${unreachable} did not finish within 2 s, so I stopped it. The commit is saved locally and will be pushed next time.`,
		);
		expect(elapsed).toBeLessThan(8_000);
		const argv = readFileSync(fake.argv, "utf8");
		expect(argv).toContain("-o BatchMode=yes");
		expect(argv).toContain("-o ConnectTimeout=10");
		const pid = Number(readFileSync(fake.pid, "utf8"));
		const deadline = Date.now() + 5_000;
		while (alive(pid) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
		expect(alive(pid)).toBe(false);
		expect(existsSync(join(spaceGitDir(root), "hyper.lock"))).toBe(false);
	}, 30_000);

	it("`hyper space push` off a terminal gets BatchMode and a connect timeout", async () => {
		const root = await makeSpace();
		const fake = fakeSsh("fail");
		const result = spawnSync(process.execPath, [cli, "space", "push"], {
			cwd: root,
			env: process.env,
			encoding: "utf8",
			timeout: 30_000,
		});
		expect(result.status).toBe(2);
		expect(result.stderr.replace(/\s+/g, " ")).toContain(
			`I couldn't reach your hyperdrive at ${unreachable} to push space/bound`,
		);
		const argv = readFileSync(fake.argv, "utf8");
		expect(argv).toContain("-o BatchMode=yes");
		expect(argv).toContain("-o ConnectTimeout=10");
	}, 30_000);

	it("on a terminal only the connect timeout is added; the user's ssh command and GIT_SSH are kept", async () => {
		const root = await makeSpace();
		expect(spaceRemoteEnv(root, true).GIT_SSH_COMMAND).toBe("ssh -o ConnectTimeout=10");
		expect(spaceRemoteEnv(root, false).GIT_SSH_COMMAND).toBe(
			"ssh -o BatchMode=yes -o ConnectTimeout=10",
		);
		spaceGit(root, ["config", "core.sshCommand", "ssh -i /tmp/key"]);
		expect(spaceRemoteEnv(root, true).GIT_SSH_COMMAND).toBe("ssh -o ConnectTimeout=10 -i /tmp/key");
		spaceGit(root, ["config", "core.sshCommand", "ssh -o ConnectTimeout=3"]);
		expect(spaceRemoteEnv(root, false).GIT_SSH_COMMAND).toBe(
			"ssh -o BatchMode=yes -o ConnectTimeout=3",
		);
		vi.stubEnv("GIT_SSH", "/opt/wrapper");
		expect(spaceRemoteEnv(root, false).GIT_SSH_COMMAND).toBeUndefined();
	});

	it("the detached worker records a failed push, keeps the commit, and status shows it", async () => {
		const root = await makeSpace();
		spaceGit(root, ["config", "hyper.cadence", "session-end+push"]);
		fakeSsh("fail");
		writeFileSync(join(root, "notes/a.md"), "saved locally\n");
		const file = join(spaceGitDir(root), "session-end-payload.bound");
		writeFileSync(file, JSON.stringify({ session_id: id, reason: "other" }));
		const result = spawnSync(
			process.execPath,
			[cli, "space", "commit", "--session-end", "--payload-file", file],
			{ cwd: root, env: process.env, encoding: "utf8", timeout: 60_000 },
		);
		expect(result.status).toBe(2);
		expect(spaceGit(root, ["rev-list", "--count", "HEAD"]).stdout.trim()).toBe("2");
		const line = readFileSync(join(spaceGitDir(root), "session-end.log"), "utf8").trim();
		expect(line.split("\t").slice(1, 3)).toEqual([id, "push-failed"]);
		expect(line).toContain("committed 1 file; push failed: I couldn't reach your hyperdrive");
		const status = spawnSync(process.execPath, [cli, "space", "status"], {
			cwd: root,
			env: process.env,
			encoding: "utf8",
		});
		expect(status.stdout).toMatch(/^Last session end \(.*, session ba0efb18-.*\): push failed: /m);
	}, 60_000);

	it("real ssh to an unroutable address fails within the connect timeout, in one line", async (context) => {
		if (spawnSync("sh", ["-c", "command -v ssh"]).status !== 0) context.skip("no ssh on PATH");
		const root = await makeSpace();
		const started = Date.now();
		const error = await pushSpaceBounded(root, unreachable, "space/bound").catch(
			(caught: Error) => caught,
		);
		const elapsed = Date.now() - started;
		console.log(`real ssh to 192.0.2.1: ${elapsed} ms: ${(error as Error).message}`);
		expect(error).toBeInstanceOf(Error);
		// ConnectTimeout is 10 s; the push's own bound is 30 s; the review measured 75.8 s.
		expect(elapsed).toBeLessThan(25_000);
	}, 40_000);
});
