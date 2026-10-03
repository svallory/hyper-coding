import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findSecretPaths } from "#services/allowlist";
import { shellQuote } from "#services/remote";
import { initSpaceGitDir, readStagedBlobPrefix, spaceGit } from "#services/space-git";
import { inspectStagedFiles } from "#services/space-sync";
import {
	flat,
	git,
	isolateGitConfig,
	type ManifestFixture,
	spawnCli,
	withManifestFixture,
} from "#tests/tmp-manifest";
import { makeBareSpace } from "#tests/tmp-space";

let fixture: ManifestFixture;
const cli = join(import.meta.dirname, "..", "..", "cli", "bin", "run.js");
beforeEach(() => {
	isolateGitConfig();
	process.env.GIT_AUTHOR_NAME = process.env.GIT_COMMITTER_NAME = "hyper test";
	process.env.GIT_AUTHOR_EMAIL = process.env.GIT_COMMITTER_EMAIL = "hyper-test@example.invalid";
	fixture = withManifestFixture();
	mkdirSync(dirname(fixture.configFile), { recursive: true });
	writeFileSync(fixture.configFile, `remote = ${JSON.stringify(fixture.remote)}\n`);
});
afterEach(() => fixture.cleanup());
function environment(): NodeJS.ProcessEnv {
	return {
		...process.env,
		HOME: fixture.home,
		HYPER_HOME: fixture.hyperHome,
		HYPER_DRIVE_CONFIG: fixture.configFile,
		XDG_CONFIG_HOME: join(fixture.root, "config"),
		NO_COLOR: "1",
		FORCE_COLOR: "0",
		AI_AGENT: undefined,
		CLAUDECODE: undefined,
	};
}
function run(root: string, command: string, ...args: string[]) {
	return spawnSync(process.execPath, [cli, "space", command, ...args], {
		cwd: root,
		env: environment(),
		encoding: "utf8",
	});
}
function makeSpace(name = "daily"): string {
	const root = join(fixture.root, name);
	makeBareSpace(root);
	mkdirSync(join(root, "notes"));
	writeFileSync(join(root, "notes", "a.md"), "first\n");
	const result = spawnCli(["space", "init", root, "--cadence", "session-end"], fixture);
	expect(result.status, flat(result.stderr)).toBe(0);
	spaceGit(root, ["config", "gc.auto", "0"]);
	return root;
}
function count(root: string): number {
	return Number(spaceGit(root, ["rev-list", "--count", "HEAD"]).stdout);
}
function head(root: string): string {
	return spaceGit(root, ["rev-parse", "HEAD"]).stdout;
}
function peer(root: string): string {
	const path = join(fixture.root, "peer");
	git(
		[
			"clone",
			"--single-branch",
			"--branch",
			`space/${root.split("/").at(-1)}`,
			fixture.remote,
			path,
		],
		fixture.root,
	);
	return path;
}
function peerCommit(path: string, file = "notes/a.md"): void {
	writeFileSync(join(path, file), "from peer\n");
	git(["add", "-A"], path);
	git(["-c", "commit.gpgsign=false", "commit", "-qm", "peer change"], path);
	git(["push", "origin", "HEAD"], path);
}

describe("space commit", () => {
	it("is an exit-zero no-op, then creates exactly one default-message commit", () => {
		const root = makeSpace();
		const before = head(root);
		const noop = run(root, "commit", "--json");
		expect(noop.status, flat(noop.stderr)).toBe(0);
		expect(JSON.parse(noop.stdout).committed).toBe(0);
		expect(head(root)).toBe(before);
		writeFileSync(join(root, "notes", "a.md"), "second\n");
		expect(run(join(root, "notes"), "commit").status).toBe(0);
		expect(count(root)).toBe(2);
		expect(spaceGit(root, ["log", "-1", "--format=%s"]).stdout.trim()).toBe("space: update");
		expect(
			git(["--git-dir", fixture.remote, "rev-list", "--count", "space/daily"], fixture.root).trim(),
		).toBe("1");
	});
	it("uses -m and disables signing and hooks", () => {
		const root = makeSpace();
		spaceGit(root, ["config", "commit.gpgsign", "true"]);
		writeFileSync(join(root, ".hyper", "space.git", "hooks", "pre-commit"), "#!/bin/sh\nexit 1\n", {
			mode: 0o755,
		});
		writeFileSync(join(root, "notes", "a.md"), "changed\n");
		const result = run(root, "commit", "-m", "my message");
		expect(result.status, flat(result.stderr)).toBe(0);
		expect(spaceGit(root, ["log", "-1", "--format=%s"]).stdout.trim()).toBe("my message");
	});
	it("refuses names and content, permits only exact acknowledged paths", () => {
		const root = makeSpace();
		mkdirSync(join(root, "notes", "clé"));
		for (const file of ["notes/.env", "notes/clé/server.pem", "notes/readme.txt"])
			writeFileSync(join(root, file), "-----BEGIN RSA PRIVATE KEY-----\n");
		const refused = run(root, "commit", "--allow-secret", "notes/readme.txt");
		expect(refused.status).toBe(2);
		expect(flat(refused.stderr)).toContain("notes/.env");
		expect(flat(refused.stderr)).toContain("notes/clé/server.pem");
		expect(count(root)).toBe(1);
		rmSync(join(root, "notes", ".env"));
		rmSync(join(root, "notes", "clé"), { recursive: true });
		const content = run(root, "commit");
		expect(content.status).toBe(2);
		expect(flat(content.stderr)).toContain("notes/readme.txt");
		expect(run(root, "commit", "--allow-secret", "notes/*").status).toBe(2);
		const allowed = run(root, "commit", "--allow-secret", "notes/readme.txt", "--json");
		expect(allowed.status, flat(allowed.stderr)).toBe(0);
		expect(JSON.parse(allowed.stdout).allowedSecrets).toEqual(["notes/readme.txt"]);
		expect(flat(allowed.stderr)).toContain("notes/readme.txt");
		expect(count(root)).toBe(2);
	});
	it("inspects staged bytes, not changed disk content, within a 4 KB cap", () => {
		const root = makeSpace();
		const path = "notes/readme.txt";
		writeFileSync(join(root, path), "-----BEGIN OPENSSH PRIVATE KEY-----\n");
		spaceGit(root, ["add", path]);
		writeFileSync(join(root, path), "safe on disk\n");
		expect(inspectStagedFiles(root, [path]).secrets).toEqual([path]);
		spaceGit(root, ["add", path]);
		writeFileSync(join(root, path), "-----BEGIN PRIVATE KEY-----\n");
		expect(inspectStagedFiles(root, [path]).secrets).toEqual([]);
		writeFileSync(join(root, path), `${"a".repeat(4096)}-----BEGIN PRIVATE KEY-----\n`);
		spaceGit(root, ["add", path]);
		expect(readStagedBlobPrefix(root, path)).toHaveLength(4096);
		expect(inspectStagedFiles(root, [path]).secrets).toEqual([]);
		writeFileSync(join(root, path), "-----BEGIN RSA\n PRIVATE KEY-----\n");
		spaceGit(root, ["add", path]);
		expect(inspectStagedFiles(root, [path]).secrets).toEqual([]);
	});
	it("matches backup suffixes and trailing dots/spaces without widening exact overrides", () => {
		const paths = [
			"notes/a.pem~",
			"notes/a.key~",
			"notes/a.pem.bak",
			"notes/a.key.bak",
			"notes/a.pem.copy",
			"notes/a.key.copy",
			"notes/a.pem. ",
			"notes/a.key ",
		];
		expect(findSecretPaths(paths)).toEqual(paths);
		expect(findSecretPaths(paths, ["notes/a.key"])).toEqual(paths);
	});
	it("can delete a previously explicitly allowed secret", () => {
		const root = makeSpace();
		writeFileSync(join(root, "notes", ".env"), "secret\n");
		expect(run(root, "commit", "--allow-secret", "notes/.env").status).toBe(0);
		rmSync(join(root, "notes", ".env"));
		const result = run(root, "commit");
		expect(result.status, flat(result.stderr)).toBe(0);
		expect(count(root)).toBe(3);
	});
	it("unstages gitlinks and reports nested repositories as skipped", () => {
		const root = makeSpace();
		const nested = join(root, "notes", "vendor");
		git(["init", nested], root);
		writeFileSync(join(nested, "a"), "nested\n");
		git(["add", "a"], nested);
		git(["commit", "-qm", "nested"], nested);
		spaceGit(root, ["add", "notes/vendor"]);
		const result = run(root, "commit", "--json");
		expect(result.status, flat(result.stderr)).toBe(0);
		expect(JSON.parse(result.stdout).skipped).toContain("notes/vendor");
		expect(flat(result.stderr)).toContain("its own git repository");
		expect(spaceGit(root, ["ls-files", "-s", "-z"]).stdout).not.toContain("160000");
		expect(count(root)).toBe(1);
	});
	it("warns for each staged file above 50 MB but commits", () => {
		const root = makeSpace();
		for (const name of ["large-a", "large-b"])
			writeFileSync(join(root, "notes", name), Buffer.alloc(50 * 1024 * 1024 + 1, 65));
		const result = run(root, "commit", "--json");
		expect(result.status, flat(result.stderr)).toBe(0);
		expect(flat(result.stderr)).toContain("notes/large-a");
		expect(flat(result.stderr)).toContain("notes/large-b");
		expect(flat(result.stderr)).toContain("50 MB");
		expect(count(root)).toBe(2);
	});
	it("explains a missing git identity", () => {
		const root = makeSpace();
		spaceGit(root, ["config", "user.useConfigOnly", "true"]);
		writeFileSync(join(root, "notes", "a.md"), "second\n");
		const env = environment();
		for (const key of [
			"GIT_AUTHOR_NAME",
			"GIT_AUTHOR_EMAIL",
			"GIT_COMMITTER_NAME",
			"GIT_COMMITTER_EMAIL",
			"EMAIL",
		])
			delete env[key];
		const result = spawnSync(process.execPath, [cli, "space", "commit"], {
			cwd: root,
			env,
			encoding: "utf8",
		});
		expect(result.status).toBe(2);
		expect(flat(result.stderr)).toContain("git has no identity");
		expect(flat(result.stderr)).toContain("git config --global user.email");
	});
});

describe("space push and pull", () => {
	it("pushes only its own branch and refuses a newer peer without rewriting either history", () => {
		const root = makeSpace();
		writeFileSync(join(root, "notes", "new.md"), "local\n");
		expect(run(root, "commit").status).toBe(0);
		expect(run(root, "push").status).toBe(0);
		const other = peer(root);
		peerCommit(other);
		writeFileSync(join(root, "notes", "local.md"), "diverge\n");
		expect(run(root, "commit").status).toBe(0);
		const before = head(root);
		const remote = git(["--git-dir", fixture.remote, "rev-parse", "space/daily"], fixture.root);
		const result = run(root, "push");
		expect(result.status).toBe(2);
		expect(flat(result.stderr)).toContain("another machine pushed");
		expect(head(root)).toBe(before);
		expect(git(["--git-dir", fixture.remote, "rev-parse", "space/daily"], fixture.root)).toBe(
			remote,
		);
	});
	it("classifies hooks mentioning fetch first before contention", () => {
		const root = makeSpace();
		writeFileSync(join(root, "notes", "a.md"), "changed\n");
		expect(run(root, "commit").status).toBe(0);
		writeFileSync(
			join(fixture.remote, "hooks", "pre-receive"),
			'#!/bin/sh\necho "fetch first please"\nexit 1\n',
			{ mode: 0o755 },
		);
		const result = run(root, "push");
		expect(result.status).toBe(2);
		expect(flat(result.stderr)).toContain("hook declined");
		expect(flat(result.stderr)).not.toContain("another machine");
	});
	it("fast-forwards behind spaces and preserves unrelated dirty work", () => {
		const root = makeSpace();
		peerCommit(peer(root));
		writeFileSync(join(root, "notes", "local.md"), "uncommitted\n");
		const result = run(root, "pull");
		expect(result.status, flat(result.stderr)).toBe(0);
		expect(readFileSync(join(root, "notes", "a.md"), "utf8")).toBe("from peer\n");
		expect(readFileSync(join(root, "notes", "local.md"), "utf8")).toBe("uncommitted\n");
		expect(count(root)).toBe(2);
	});
	it("refuses divergence with HEAD, index and work tree unchanged", () => {
		const root = makeSpace();
		peerCommit(peer(root));
		writeFileSync(join(root, "notes", "local.md"), "local\n");
		expect(run(root, "commit").status).toBe(0);
		const before = head(root);
		const index = readFileSync(join(root, ".hyper", "space.git", "index"));
		const result = run(root, "pull");
		expect(result.status).toBe(2);
		expect(flat(result.stderr)).toContain("diverged");
		expect(head(root)).toBe(before);
		expect(readFileSync(join(root, ".hyper", "space.git", "index"))).toEqual(index);
		expect(readFileSync(join(root, "notes", "a.md"), "utf8")).toBe("first\n");
	});
	it("refuses a fast-forward that would overwrite an untracked file", () => {
		const root = makeSpace();
		peerCommit(peer(root), "notes/new.md");
		writeFileSync(join(root, "notes", "new.md"), "local untracked work\n");
		const before = head(root);
		const result = run(root, "pull");
		expect(result.status).toBe(2);
		expect(flat(result.stderr)).toContain("overwritten");
		expect(head(root)).toBe(before);
		expect(readFileSync(join(root, "notes", "new.md"), "utf8")).toBe("local untracked work\n");
	});
	it.each([false, true])("refuses to overwrite local work (staged=%s)", (staged: boolean) => {
		const root = makeSpace();
		peerCommit(peer(root));
		writeFileSync(join(root, "notes", "a.md"), "my dirty work\n");
		if (staged) spaceGit(root, ["add", "notes/a.md"]);
		const before = head(root);
		const result = run(root, "pull");
		expect(result.status).toBe(2);
		expect(flat(result.stderr)).toContain("overwritten");
		expect(head(root)).toBe(before);
		expect(readFileSync(join(root, "notes", "a.md"), "utf8")).toBe("my dirty work\n");
	});
	it.each(["push", "pull", "status"])("reports an unreachable remote for %s", (command: string) => {
		const root = makeSpace();
		renameSync(fixture.remote, `${fixture.remote}.away`);
		const result = run(root, command, ...(command === "status" ? ["--fetch"] : []));
		expect(result.status).toBe(2);
		expect(flat(result.stderr)).toContain("couldn't reach your hyperdrive");
	});
});

describe("space status and log", () => {
	it("reports cadence, branch, status and unknown upstream without fetching", () => {
		const root = makeSpace();
		spaceGit(root, ["update-ref", "-d", "refs/remotes/origin/space/daily"]);
		writeFileSync(join(root, "notes", "a.md"), "changed\n");
		writeFileSync(join(root, "notes", "odd\nname.md"), "new\n");
		renameSync(fixture.remote, `${fixture.remote}.away`);
		const result = run(root, "status", "--json");
		expect(result.status, flat(result.stderr)).toBe(0);
		const status = JSON.parse(result.stdout);
		expect(status.branch).toBe("space/daily");
		expect(status.cadence).toBe("session-end");
		expect(status.ahead).toBeNull();
		expect(status.behind).toBeNull();
		expect(status.status).toEqual(
			expect.arrayContaining([
				{ code: " M", path: "notes/a.md" },
				{ code: "??", path: "notes/odd\nname.md" },
			]),
		);
		const text = run(root, "status");
		expect(flat(text.stdout)).toContain("has not exchanged this branch");
		expect(flat(text.stdout)).toContain("Cadence: session-end");
		expect(flat(text.stdout)).toContain("Branch: space/daily");
	});
	it.each(["absent", "wide"])(
		"supports legacy %s fetch refspecs without fetching other spaces",
		(kind: string) => {
			const root = makeSpace();
			makeSpace("other");
			if (kind === "absent") spaceGit(root, ["config", "--unset-all", "remote.origin.fetch"]);
			else spaceGit(root, ["config", "remote.origin.fetch", "refs/heads/*:refs/remotes/origin/*"]);
			spaceGit(root, ["update-ref", "-d", "refs/remotes/origin/space/daily"]);
			expect(JSON.parse(run(root, "status", "--json").stdout).upstreamKnown).toBe(false);
			expect(run(root, "status", "--fetch").status).toBe(0);
			expect(run(root, "pull").status).toBe(0);
			expect(JSON.parse(run(root, "status", "--json").stdout)).toMatchObject({
				upstreamKnown: true,
				ahead: 0,
				behind: 0,
			});
			expect(spaceGit(root, ["for-each-ref", "--format=%(refname)"]).stdout).not.toContain(
				"space/other",
			);
		},
	);
	it("reports latest push contact without requiring a fetch", () => {
		const root = makeSpace();
		expect(JSON.parse(run(root, "status", "--json").stdout)).toMatchObject({
			upstreamKnown: true,
			ahead: 0,
			behind: 0,
		});
		writeFileSync(join(root, "notes", "a.md"), "new\n");
		expect(run(root, "commit").status).toBe(0);
		expect(JSON.parse(run(root, "status", "--json").stdout)).toMatchObject({ ahead: 1, behind: 0 });
		expect(run(root, "push").status).toBe(0);
		expect(JSON.parse(run(root, "status", "--json").stdout)).toMatchObject({ ahead: 0, behind: 0 });
		expect(flat(run(root, "status").stdout)).toContain(
			"as of the last contact with the hyperdrive",
		);
	});
	it("reports ahead/behind from the last contact and does not fetch implicitly", () => {
		const root = makeSpace();
		const other = peer(root);
		let result = run(root, "status", "--fetch", "--json");
		expect(result.status, flat(result.stderr)).toBe(0);
		expect(JSON.parse(result.stdout)).toMatchObject({ ahead: 0, behind: 0 });
		peerCommit(other);
		writeFileSync(join(root, "notes", "local.md"), "local\n");
		expect(run(root, "commit").status).toBe(0);
		result = run(root, "status", "--json");
		expect(JSON.parse(result.stdout)).toMatchObject({ ahead: 1, behind: 0 });
		result = run(root, "status", "--fetch", "--json");
		expect(JSON.parse(result.stdout)).toMatchObject({ ahead: 1, behind: 1 });
		expect(flat(run(root, "status").stdout)).toContain("ahead 1, behind 1");
	});
	it("logs only this space on a shared remote and keeps the fetch refspec narrow", () => {
		const root = makeSpace();
		const other = makeSpace("other");
		writeFileSync(join(other, "notes", "a.md"), "other\n");
		expect(run(other, "commit", "-m", "only other").status).toBe(0);
		expect(run(other, "push").status).toBe(0);
		const refspec = "refs/heads/space/daily:refs/remotes/origin/space/daily";
		expect(spaceGit(root, ["config", "--get-all", "remote.origin.fetch"]).stdout.trim()).toBe(
			refspec,
		);
		expect(run(root, "pull").status).toBe(0);
		expect(run(root, "status", "--fetch").status).toBe(0);
		expect(spaceGit(root, ["config", "--get-all", "remote.origin.fetch"]).stdout.trim()).toBe(
			refspec,
		);
		expect(spaceGit(root, ["for-each-ref", "--format=%(refname)"]).stdout).not.toContain(
			"space/other",
		);
		const log = run(root, "log", "--oneline", "-n", "5");
		expect(log.status, flat(log.stderr)).toBe(0);
		expect(log.stdout).toContain("space: init daily");
		expect(log.stdout).not.toContain("only other");
		for (const args of [
			["--all"],
			["--reflog"],
			["--branches"],
			["--branches=space/*"],
			["--remotes"],
			["--tags"],
			["--glob=*"],
			["--exclude=*"],
			["-g"],
			["--walk-reflogs"],
			["--alternate-refs"],
			["--stdin"],
		]) {
			const result = run(root, "log", ...args);
			expect(result.status).toBe(2);
		}
		expect(run(root, "log", "--format=%s", "--", "notes/a.md").stdout.trim()).toBe(
			"space: init daily",
		);
		expect(run(root, "log", "--format=%s", "HEAD").stdout.trim()).toBe("space: init daily");
		expect(run(root, "log", "--", "--all").status).toBe(0);
		const invalid = run(root, "log", "--not-a-real-git-option");
		expect(invalid.status).toBe(128);
		expect(invalid.stderr).toContain("unrecognized argument");
	});
});

it.each(["commit", "push", "pull", "log", "status"])(
	"%s refuses outside, uninitialised and unborn spaces",
	(command: string) => {
		const outside = run(fixture.home, command);
		expect(outside.status).toBe(2);
		expect(flat(outside.stderr)).toContain("not inside a hyper space");
		const root = join(fixture.root, "unfinished");
		makeBareSpace(root);
		const uninitialised = run(root, command);
		expect(uninitialised.status).toBe(2);
		expect(flat(uninitialised.stderr)).toContain("hyper space init");
		initSpaceGitDir(root, { branch: "space/unfinished", remote: fixture.remote });
		const unborn = run(root, command);
		expect(unborn.status).toBe(2);
		expect(flat(unborn.stderr)).toContain("hyper space init");
		expect(flat(unborn.stderr)).toContain("unfinished");
	},
);

it.each(
	["commit", "push", "pull", "log", "status"].flatMap((command) =>
		(["SIGINT", "SIGTERM"] as const).map((signal) => ({ command, signal })),
	),
)(
	"$command exits 130 for a git child interrupted by $signal",
	async ({ command, signal }: { command: string; signal: "SIGINT" | "SIGTERM" }) => {
		const root = makeSpace();
		const real = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
		const ready = join(fixture.root, "ready");
		const blocker = join(fixture.root, "blocker.cjs");
		writeFileSync(
			blocker,
			`require('node:fs').writeFileSync(${JSON.stringify(ready)}, 'ready'); setInterval(() => {}, 1000);`,
		);
		const bin = join(fixture.root, "bin");
		mkdirSync(bin);
		const operation = command === "commit" ? "add" : command === "pull" ? "fetch" : command;
		writeFileSync(
			join(bin, "git"),
			`#!/bin/sh\ncase " $* " in *space.git*" ${operation} "*) exec ${shellQuote(process.execPath)} ${shellQuote(blocker)};; esac\nexec ${shellQuote(real)} "$@"\n`,
			{ mode: 0o755 },
		);
		const child = spawn(process.execPath, [cli, "space", command], {
			cwd: root,
			detached: true,
			env: { ...environment(), PATH: `${bin}:${process.env.PATH}` },
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stderr = "";
		child.stderr.on("data", (data) => {
			stderr += data;
		});
		const closed = new Promise<number | null>((resolve, reject) => {
			child.on("error", reject);
			child.on("close", resolve);
		});
		try {
			await expect.poll(() => existsSync(ready), { timeout: 10000 }).toBe(true);
			process.kill(-child.pid!, signal);
			expect(await closed, flat(stderr)).toBe(130);
			expect(flat(stderr)).toContain("interrupted");
		} finally {
			try {
				process.kill(-child.pid!, "SIGKILL");
			} catch {
				/* already exited */
			}
			await closed;
		}
	},
);
