import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { shellQuote } from "#services/remote";
import { spaceGit } from "#services/space-git";
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
let root: string;
const cli = join(import.meta.dirname, "..", "..", "cli", "bin", "run.js");
beforeEach(() => {
	isolateGitConfig();
	process.env.GIT_AUTHOR_NAME = process.env.GIT_COMMITTER_NAME = "hyper test";
	process.env.GIT_AUTHOR_EMAIL = process.env.GIT_COMMITTER_EMAIL = "hyper-test@example.invalid";
	fixture = withManifestFixture();
	mkdirSync(dirname(fixture.configFile), { recursive: true });
	writeFileSync(fixture.configFile, `remote = ${JSON.stringify(fixture.remote)}\n`);
	root = join(fixture.root, "review");
	makeBareSpace(root);
	mkdirSync(join(root, "notes"));
	writeFileSync(join(root, "notes", "a.md"), "first\n");
	expect(spawnCli(["space", "init", root, "--cadence", "manual"], fixture).status).toBe(0);
});
afterEach(() => fixture.cleanup());
function environment(): NodeJS.ProcessEnv {
	return {
		...process.env,
		HOME: fixture.home,
		HYPER_HOME: fixture.hyperHome,
		HYPER_DRIVE_CONFIG: fixture.configFile,
		XDG_CONFIG_HOME: join(fixture.root, "config"),
		CLAUDE_CONFIG_DIR: join(fixture.root, "claude"),
		NO_COLOR: "1",
		FORCE_COLOR: "0",
		AI_AGENT: undefined,
		CLAUDECODE: undefined,
	};
}
function run(command: string, ...args: string[]) {
	return spawnSync(process.execPath, [cli, "space", command, ...args], {
		cwd: root,
		env: environment(),
		encoding: "utf8",
	});
}
function fresh(): string {
	const path = join(fixture.root, "fresh");
	makeBareSpace(path);
	mkdirSync(join(path, "notes"));
	return path;
}
function init(path: string) {
	return spawnCli(["space", "init", path, "--cadence", "manual"], fixture);
}

describe("PR34 high and smaller findings", () => {
	it("classifies a real remote refname conflict before hook rejection", () => {
		const sha = spaceGit(root, ["rev-parse", "HEAD"]).stdout.trim();
		git(["--git-dir", fixture.remote, "update-ref", "-d", "refs/heads/space/review"], fixture.root);
		git(
			["--git-dir", fixture.remote, "update-ref", "refs/heads/space/review/child", sha],
			fixture.root,
		);
		const result = run("push");
		expect(result.status).toBe(2);
		expect(flat(result.stderr)).toContain("collides with");
		expect(flat(result.stderr)).not.toContain("hook declined");
	});
	it("updates status after a push without any configured fetch mapping", () => {
		spaceGit(root, ["config", "--unset-all", "remote.origin.fetch"]);
		spaceGit(root, ["update-ref", "-d", "refs/remotes/origin/space/review"]);
		writeFileSync(join(root, "notes", "a.md"), "second\n");
		expect(run("commit").status).toBe(0);
		expect(run("push").status).toBe(0);
		expect(JSON.parse(run("status", "--json").stdout)).toMatchObject({
			upstreamKnown: true,
			ahead: 0,
			behind: 0,
		});
	});
	it("clears staged secrets and all other staged changes on refusal", () => {
		writeFileSync(join(root, "notes", ".env"), "secret\n");
		writeFileSync(join(root, "notes", "a.md"), "changed\n");
		expect(run("commit").status).toBe(2);
		expect(spaceGit(root, ["diff", "--cached", "--name-only", "-z"]).stdout).toBe("");
		expect(readFileSync(join(root, "notes", ".env"), "utf8")).toBe("secret\n");
	});
	it("validates empty messages before touching the index", () => {
		writeFileSync(join(root, "notes", "a.md"), "changed\n");
		const before = readFileSync(join(root, ".hyper", "space.git", "index"));
		expect(run("commit", "-m", "").status).toBe(2);
		expect(readFileSync(join(root, ".hyper", "space.git", "index"))).toEqual(before);
	});
	it("does not expose init's unborn field in commit JSON", () => {
		expect(JSON.parse(run("commit", "--json").stdout)).not.toHaveProperty("unborn");
	});
	it("rejects PGP private-key blocks even at the start of a large blob", () => {
		writeFileSync(
			join(root, "notes", "readme.txt"),
			`-----BEGIN PGP PRIVATE KEY BLOCK-----\n${"x".repeat(2 * 1024 * 1024)}`,
		);
		const result = run("commit");
		expect(result.status).toBe(2);
		expect(flat(result.stderr)).toContain("notes/readme.txt");
	});
	it("uses a bounded number of Git processes for 2000 different staged blobs", () => {
		for (let index = 0; index < 2000; index++)
			writeFileSync(join(root, "notes", `${index}.txt`), `blob ${index}\n`);
		const real = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
		const bin = join(fixture.root, "bin");
		mkdirSync(bin);
		const calls = join(fixture.root, "git-calls");
		writeFileSync(
			join(bin, "git"),
			`#!/bin/sh\ncase "$*" in *space.git*) printf '%s\\n' "$*" >> ${shellQuote(calls)};; esac\nexec ${shellQuote(real)} "$@"\n`,
			{ mode: 0o755 },
		);
		const start = Date.now();
		const result = spawnSync(process.execPath, [cli, "space", "commit", "--json"], {
			cwd: root,
			env: { ...environment(), PATH: `${bin}:${process.env.PATH}` },
			encoding: "utf8",
		});
		expect(result.status, flat(result.stderr)).toBe(0);
		const commands = readFileSync(calls, "utf8").trim().split("\n");
		expect(commands.length).toBeLessThanOrEqual(20);
		expect(commands.filter((line) => line.includes("cat-file --batch-check"))).toHaveLength(1);
		expect(commands.filter((line) => line.endsWith("cat-file --batch"))).toHaveLength(1);
		console.log(
			`2000-file commit: ${Date.now() - start}ms, ${commands.length} space Git processes`,
		);
	});
	it("propagates a parent-only SIGINT during asynchronous blob inspection", () => {
		writeFileSync(join(root, "notes", "a.md"), "changed\n");
		const real = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
		const bin = join(fixture.root, "signal-bin");
		mkdirSync(bin);
		writeFileSync(
			join(bin, "git"),
			`#!/bin/sh\ncase "$*" in *'cat-file --batch') kill -INT "$PPID"; exec sleep 10;; esac\nexec ${shellQuote(real)} "$@"\n`,
			{ mode: 0o755 },
		);
		const result = spawnSync(process.execPath, [cli, "space", "commit"], {
			cwd: root,
			env: { ...environment(), PATH: `${bin}:${process.env.PATH}` },
			encoding: "utf8",
		});
		expect(result.status).toBe(130);
		expect(spaceGit(root, ["diff", "--cached", "--name-only", "-z"]).stdout).toBe("");
	});
	it("does not refresh the index during read-only status", () => {
		writeFileSync(join(root, "notes", "a.md"), "first\n");
		const before = readFileSync(join(root, ".hyper", "space.git", "index"));
		expect(run("status").status).toBe(0);
		expect(readFileSync(join(root, ".hyper", "space.git", "index"))).toEqual(before);
	});
	it("refuses another space-prefixed HEAD without its recorded identity", () => {
		spaceGit(root, ["checkout", "-b", "space/not-this-space"]);
		const result = run("status");
		expect(result.status).toBe(2);
		expect(flat(result.stderr)).toContain("recorded branch");
	});
	it("accepts rewritten remote tracking history and reports divergence", () => {
		const tree = spaceGit(root, ["rev-parse", "HEAD^{tree}"]).stdout.trim();
		const unrelated = spaceGit(root, [
			"commit-tree",
			tree,
			"-m",
			"unrelated remote history",
		]).stdout.trim();
		spaceGit(root, ["push", "origin", `${unrelated}:refs/heads/space/temporary`]);
		git(
			["--git-dir", fixture.remote, "update-ref", "refs/heads/space/review", unrelated],
			fixture.root,
		);
		const result = run("pull");
		expect(result.status).toBe(2);
		expect(flat(result.stderr)).toContain("diverged");
		expect(spaceGit(root, ["rev-parse", "refs/remotes/origin/space/review"]).stdout.trim()).toBe(
			unrelated,
		);
	});
	it("denies --bisect but leaves pathspecs after -- alone", () => {
		expect(run("log", "--bisect").status).toBe(2);
		expect(run("log", "--", "--bisect").status).toBe(0);
	});
	it("exits zero when a reader closes the log pipe", () => {
		writeFileSync(join(root, "notes", "large.txt"), "a long line\n".repeat(20000));
		expect(run("commit").status).toBe(0);
		const command = `set -o pipefail; ${shellQuote(process.execPath)} ${shellQuote(cli)} space log -p | head -1`;
		const result = spawnSync("bash", ["-c", command], {
			cwd: root,
			env: environment(),
			encoding: "utf8",
		});
		expect(result.status, flat(result.stderr)).toBe(0);
	});
	it("init secret advice does not recommend commands requiring its removed git dir", () => {
		const path = fresh();
		writeFileSync(join(path, "notes", ".env"), "secret\n");
		const result = init(path);
		expect(result.status).toBe(2);
		expect(existsSync(join(path, ".hyper", "space.git"))).toBe(false);
		for (const command of ["space commit", "space status", "space pull"])
			expect(flat(result.stderr)).not.toContain(command);
	});
	it("init first-commit failure advice does not recommend status on a removed git dir", () => {
		const path = fresh();
		writeFileSync(join(path, "notes", "a.md"), "first\n");
		const result = spawnSync(
			process.execPath,
			[cli, "space", "init", path, "--cadence", "manual"],
			{
				cwd: fixture.root,
				env: {
					...environment(),
					GIT_AUTHOR_DATE: "invalid-date",
					GIT_COMMITTER_DATE: "invalid-date",
				},
				encoding: "utf8",
			},
		);
		expect(result.status).toBe(2);
		expect(flat(result.stderr)).toContain("invalid date format");
		expect(flat(result.stderr)).not.toContain("space status");
		expect(existsSync(join(path, ".hyper", "space.git"))).toBe(false);
	});
	it("init first-push contention advice does not point at a pull that would refuse", () => {
		const path = fresh();
		writeFileSync(join(path, "notes", "a.md"), "local\n");
		const sha = git(
			["--git-dir", fixture.remote, "rev-parse", "space/review"],
			fixture.root,
		).trim();
		git(["--git-dir", fixture.remote, "update-ref", "refs/heads/space/fresh", sha], fixture.root);
		const result = init(path);
		expect(result.status).toBe(2);
		expect(flat(result.stderr)).toContain("another machine");
		expect(flat(result.stderr)).not.toContain("space pull");
	});
});
