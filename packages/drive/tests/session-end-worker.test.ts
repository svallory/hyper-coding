/**
 * The detached session-end worker's file handling (PR #45 confirm review):
 * a payload is only read and removed once it is known to belong to the space
 * the worker runs in, and a space git dir that refuses writes gives one
 * friendly line instead of a raw EACCES/EROFS, for the lock, the payload and
 * the log.
 */
import { spawnSync } from "node:child_process";
import {
	chmodSync,
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
import { appendSessionEndLog } from "#services/session-end-log";
import { runSessionEndWorker } from "#services/session-end-worker";
import { initSpaceGitDir, SpaceGitError, spaceGit, spaceGitDir } from "#services/space-git";
import { withSpaceLock } from "#services/space-lock";
import { commitSpace } from "#services/space-sync";
import { git } from "#tests/tmp-manifest";
import { makeBareSpace } from "#tests/tmp-space";

const id = "ba0efb18-103b-43b5-b5a0-fc3a08a2b00b";
const repository = join(import.meta.dirname, "../../..");
const cli = join(repository, "packages/cli/bin/run.js");
const payload = JSON.stringify({ session_id: id, reason: "logout" });
// Permission bits do not stop root; those cases cannot be shown as root.
const asRoot = process.getuid?.() === 0;
let directory: string;
const readOnly: string[] = [];

beforeEach(() => {
	directory = realpathSync(mkdtempSync(join(tmpdir(), "hyper-session-end-worker-")));
	for (const [key, value] of Object.entries({
		HOME: join(directory, "home"),
		HYPER_HOME: join(directory, "hyper"),
		HYPER_DRIVE_CONFIG: join(directory, "drive.toml"),
		XDG_CONFIG_HOME: join(directory, "config"),
		CLAUDE_CONFIG_DIR: join(directory, "claude"),
		GIT_CONFIG_GLOBAL: "/dev/null",
		GIT_CONFIG_NOSYSTEM: "1",
		GIT_AUTHOR_NAME: "worker test",
		GIT_COMMITTER_NAME: "worker test",
		GIT_AUTHOR_EMAIL: "worker@example.invalid",
		GIT_COMMITTER_EMAIL: "worker@example.invalid",
		HYPER_SKIP_NEW_VERSION_CHECK: "1",
		NO_COLOR: "1",
		FORCE_COLOR: "0",
	}))
		vi.stubEnv(key, value);
	mkdirSync(process.env.HOME!, { recursive: true });
	mkdirSync(process.env.CLAUDE_CONFIG_DIR!, { recursive: true });
});
afterEach(() => {
	for (const path of readOnly.splice(0)) chmodSync(path, 0o755);
	vi.unstubAllEnvs();
	rmSync(directory, { recursive: true, force: true });
});

async function makeSpace(name: string) {
	const root = join(directory, name);
	const remote = join(directory, `${name}-remote.git`);
	git(["init", "--bare", remote], directory);
	makeBareSpace(root);
	mkdirSync(join(root, "notes"));
	writeFileSync(join(root, "notes/a.md"), "initial\n");
	writeFileSync(join(root, ".gitignore"), renderGitignore());
	initSpaceGitDir(root, { branch: `space/${name}`, remote });
	spaceGit(root, ["config", "gc.auto", "0"]);
	await commitSpace(root, `space/${name}`, "initial");
	return { root, gitDir: spaceGitDir(root) };
}
function commits(root: string): number {
	return Number(spaceGit(root, ["rev-list", "--count", "HEAD"]).stdout.trim());
}
function makeReadOnly(path: string): void {
	chmodSync(path, 0o555);
	readOnly.push(path);
}

describe("session-end worker: payload ownership is checked first", () => {
	it("a payload of another space is left in place, logged there, and nothing is committed", async () => {
		const a = await makeSpace("a");
		const b = await makeSpace("b");
		const file = join(b.gitDir, "session-end-payload.other");
		writeFileSync(file, payload);
		writeFileSync(join(a.root, "notes/a.md"), "changed in a\n");
		writeFileSync(join(b.root, "notes/a.md"), "changed in b\n");
		const entry = await runSessionEndWorker(file, a.root);
		expect(entry.outcome).toBe("failed");
		expect(entry.detail).toMatch(/the payload belongs to .* was left in place\./);
		expect(readFileSync(file, "utf8")).toBe(payload);
		expect(readFileSync(join(b.gitDir, "session-end.log"), "utf8")).toContain("\tfailed\t");
		expect(existsSync(join(a.gitDir, "session-end.log"))).toBe(false);
		expect([commits(a.root), commits(b.root)]).toEqual([1, 1]);
	});

	it("a worker outside any initialised space leaves the payload in place", async () => {
		const b = await makeSpace("b");
		const file = join(b.gitDir, "session-end-payload.outside");
		writeFileSync(file, payload);
		const outside = join(directory, "outside");
		mkdirSync(outside);
		const entry = await runSessionEndWorker(file, outside);
		expect(entry.outcome).toBe("failed");
		expect(entry.detail).toContain("was left in place");
		expect(existsSync(file)).toBe(true);
	});

	it("its own payload is still removed and committed", async () => {
		const a = await makeSpace("a");
		const file = join(a.gitDir, "session-end-payload.own");
		writeFileSync(file, payload);
		writeFileSync(join(a.root, "notes/a.md"), "changed\n");
		const entry = await runSessionEndWorker(file, join(a.root, "notes"));
		expect(entry.outcome).toBe("committed");
		expect(existsSync(file)).toBe(false);
		expect(commits(a.root)).toBe(2);
	});
});

describe.skipIf(asRoot)("session-end worker: a space git dir that refuses writes", () => {
	const friendly =
		/^I can't write to the space git dir .* \(permission denied\), so I did not .*; nothing was changed\./;

	it("the lock gives one friendly line, not a raw EACCES", async () => {
		const a = await makeSpace("a");
		makeReadOnly(a.gitDir);
		let thrown: unknown;
		try {
			withSpaceLock(a.root, "commit this space", () => undefined, { waitMs: 200 });
		} catch (error) {
			thrown = error;
		}
		expect(thrown).toBeInstanceOf(SpaceGitError);
		expect((thrown as Error).message).toMatch(friendly);
		expect((thrown as Error).message).not.toMatch(/EACCES/);
	});

	it("`hyper space commit` prints that line once and exits 2", async () => {
		const a = await makeSpace("a");
		writeFileSync(join(a.root, "notes/a.md"), "changed\n");
		makeReadOnly(a.gitDir);
		const result = spawnSync(process.execPath, [cli, "space", "commit", "-m", "x"], {
			cwd: a.root,
			env: process.env,
			encoding: "utf8",
			timeout: 30_000,
		});
		expect(result.status).toBe(2);
		const text = result.stderr.replace(/\s+/g, " ");
		expect(text).toContain("I can't write to the space git dir");
		expect(text).toContain("(permission denied)");
		expect(text).not.toMatch(/EACCES/);
		expect(commits(a.root)).toBe(1);
	});

	it("the log gives one friendly line", async () => {
		const a = await makeSpace("a");
		makeReadOnly(a.gitDir);
		expect(() =>
			appendSessionEndLog(a.gitDir, { session: id, outcome: "failed", detail: "x" }),
		).toThrow(friendly);
	});

	it("a payload that cannot be removed gives one friendly line and commits nothing", async () => {
		const a = await makeSpace("a");
		const file = join(a.gitDir, "session-end-payload.stuck");
		writeFileSync(file, payload);
		writeFileSync(join(a.root, "notes/a.md"), "changed\n");
		makeReadOnly(a.gitDir);
		await expect(runSessionEndWorker(file, a.root)).rejects.toThrow(friendly);
		expect(commits(a.root)).toBe(1);
	});
});
