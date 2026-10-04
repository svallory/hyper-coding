import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderGitignore } from "#services/allowlist";
import { initSpaceGitDir, spaceGit } from "#services/space-git";
import { validateIncomingSpace } from "#services/space-incoming";
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
let peer: string;
const cli = join(import.meta.dirname, "..", "..", "cli", "bin", "run.js");
beforeEach(() => {
	isolateGitConfig();
	process.env.GIT_AUTHOR_NAME = process.env.GIT_COMMITTER_NAME = "hyper test";
	process.env.GIT_AUTHOR_EMAIL = process.env.GIT_COMMITTER_EMAIL = "hyper-test@example.invalid";
	fixture = withManifestFixture();
	mkdirSync(dirname(fixture.configFile), { recursive: true });
	writeFileSync(fixture.configFile, `remote = ${JSON.stringify(fixture.remote)}\n`);
	root = join(fixture.root, "incoming");
	makeBareSpace(root);
	mkdirSync(join(root, "notes"));
	writeFileSync(join(root, "notes", "a.md"), "local\n");
	expect(spawnCli(["space", "init", root, "--cadence", "manual"], fixture).status).toBe(0);
	peer = join(fixture.root, "peer");
	git(
		["clone", "--single-branch", "--branch", "space/incoming", fixture.remote, peer],
		fixture.root,
	);
});
afterEach(() => fixture.cleanup());
function run(command: string, ...args: string[]) {
	return spawnSync(process.execPath, [cli, "space", command, ...args], {
		cwd: root,
		encoding: "utf8",
		env: {
			...process.env,
			HOME: fixture.home,
			HYPER_HOME: fixture.hyperHome,
			HYPER_DRIVE_CONFIG: fixture.configFile,
			XDG_CONFIG_HOME: join(fixture.root, "config"),
			NO_COLOR: "1",
			FORCE_COLOR: "0",
			AI_AGENT: undefined,
			CLAUDECODE: undefined,
		},
	});
}
function publish(): string {
	git(["add", "-A"], peer);
	git(["commit", "-qm", "peer update"], peer);
	git(["push", "origin", "HEAD"], peer);
	return git(["rev-parse", "HEAD"], peer).trim();
}
function peerFile(path: string, content = "remote\n"): void {
	mkdirSync(dirname(join(peer, path)), { recursive: true });
	writeFileSync(join(peer, path), content);
	git(["add", "-f", "--", path], peer);
}
function configWithoutRefusal(): string[] {
	return spaceGit(root, ["config", "--local", "--list", "-z"])
		.stdout.split("\0")
		.filter((record) => !/^hyper\.refused(?:tip|reason)\n/i.test(record));
}
function expectRefused(path: string, ...args: string[]): void {
	const head = spaceGit(root, ["rev-parse", "HEAD"]).stdout;
	const index = readFileSync(join(root, ".hyper", "space.git", "index"));
	const config = configWithoutRefusal();
	const result = run("pull", ...args);
	expect(result.status, flat(result.stderr)).toBe(2);
	expect(flat(result.stderr)).toContain(path);
	expect(spaceGit(root, ["rev-parse", "HEAD"]).stdout).toBe(head);
	expect(readFileSync(join(root, ".hyper", "space.git", "index"))).toEqual(index);
	expect(configWithoutRefusal()).toEqual(config);
}

describe("untrusted incoming history", () => {
	it.each([
		"worktrees/main/app.ts",
		"scratch/private.txt",
		"code/app/source.ts",
		".claude/settings.local.json",
		"loose.txt",
		".Hyper/Space.git/protected.txt",
		".hyper/space.git/hooks/post-commit",
		"notes/.gitattributes",
		"notes/.gitmodules",
		".gitmodules",
	])("refuses forced path %s", (path: string) => {
		mkdirSync(dirname(join(root, path)), { recursive: true });
		writeFileSync(join(root, path), "uncommitted local work\n");
		peerFile(path);
		publish();
		expectRefused(path);
		expect(readFileSync(join(root, path), "utf8")).toBe("uncommitted local work\n");
	});
	it("does not overwrite an ignored file newly allowlisted by the incoming commit", () => {
		mkdirSync(join(root, "extra"));
		writeFileSync(join(root, "extra", "local.txt"), "irreplaceable\n");
		writeFileSync(join(peer, ".gitignore"), renderGitignore(["extra"]));
		peerFile("extra/local.txt");
		publish();
		expectRefused("overwritten", "--accept-tracked");
		expect(readFileSync(join(root, "extra", "local.txt"), "utf8")).toBe("irreplaceable\n");
	});
	it("refuses live Git config replacement and never invokes injected fsmonitor", () => {
		const marker = join(fixture.root, "executed");
		peerFile(
			".hyper/space.git/config",
			`[core]\n bare = false\n worktree = ../..\n fsmonitor = touch ${marker}\n[branch "space/incoming"]\n merge = refs/heads/space/incoming\n`,
		);
		publish();
		expectRefused(".hyper/space.git/config");
		run("status");
		expect(existsSync(marker)).toBe(false);
	});
	it("disables fsmonitor and hooks even in already-tampered local config", () => {
		const marker = join(fixture.root, "monitor");
		const hook = join(fixture.root, "hook");
		spaceGit(root, ["config", "core.fsmonitor", `touch ${marker}`]);
		writeFileSync(
			join(root, ".hyper", "space.git", "hooks", "post-checkout"),
			`#!/bin/sh\ntouch '${hook}'\n`,
			{ mode: 0o755 },
		);
		expect(run("status").status).toBe(0);
		spaceGit(root, ["checkout", "--", "notes/a.md"]);
		expect(existsSync(marker)).toBe(false);
		expect(existsSync(hook)).toBe(false);
	});
	it.each(["marker-only", "reserved", "foreign"])(
		"refuses %s incoming allowlist",
		(kind: string) => {
			const valid = renderGitignore();
			const content =
				kind === "marker-only"
					? `*\n!/**\n${valid.trimEnd().split("\n").at(-1)}\n`
					: kind === "reserved"
						? valid.replace("!/notes/", "!/worktrees/")
						: "*\n!/notes/**\n";
			writeFileSync(join(peer, ".gitignore"), content);
			publish();
			expectRefused(".gitignore");
		},
	);
	it.each(["/tmp/outside", "../../outside"])("refuses symlink target %s", (target: string) => {
		symlinkSync(target, join(peer, "notes", "link"));
		publish();
		expectRefused("notes/link");
	});
	it("accepts a safe relative symlink and a new canonical tracked directory, restoring tracked config", () => {
		writeFileSync(join(peer, ".gitignore"), renderGitignore(["extra"]));
		peerFile("extra/a.md");
		symlinkSync("../extra/a.md", join(peer, "notes", "link"));
		publish();
		spaceGit(root, ["config", "merge.verifySignatures", "true"]);
		spaceGit(root, ["config", "--add", "hyper.tracked", "existing"]);
		const result = run("pull", "--accept-tracked");
		expect(result.status, flat(result.stderr)).toBe(0);
		expect(
			spaceGit(root, ["config", "--get-all", "hyper.tracked"]).stdout.trim().split("\n"),
		).toEqual(["extra", "existing"]);
		expect(readFileSync(join(root, ".gitignore"), "utf8")).toBe(
			renderGitignore(["extra", "existing"]),
		);
		expect(spaceGit(root, ["diff", "--name-only"]).stdout).toContain(".gitignore");
		expect(result.stdout).toContain("local modification");
		expect(readFileSync(join(root, "notes", "link"), "utf8")).toBe("remote\n");
	});
	it("refuses gitlinks", () => {
		const sha = git(["rev-parse", "HEAD"], peer).trim();
		git(["update-index", "--add", "--cacheinfo", `160000,${sha},notes/vendor`], peer);
		git(["commit", "-qm", "gitlink"], peer);
		git(["push", "origin", "HEAD"], peer);
		expectRefused("notes/vendor");
	});
	it("rejects nested .git tree entries built by real Git plumbing", async () => {
		const blob = spaceGit(root, ["rev-parse", "HEAD:notes/a.md"]).stdout.trim();
		const ignore = spaceGit(root, ["rev-parse", "HEAD:.gitignore"]).stdout.trim();
		const nested = spaceGit(root, ["mktree", "-z"], {
			input: `100644 blob ${blob}\t.git\0`,
		}).stdout.trim();
		const tree = spaceGit(root, ["mktree", "-z"], {
			input: `100644 blob ${ignore}\t.gitignore\0` + `040000 tree ${nested}\tnotes\0`,
		}).stdout.trim();
		const commit = spaceGit(root, [
			"commit-tree",
			tree,
			"-p",
			"HEAD",
			"-m",
			"hostile tree",
		]).stdout.trim();
		await expect(validateIncomingSpace(root, commit, "HEAD")).rejects.toThrow("notes/.git");
	});
	it("accepts .hyper memory in pull and in an un-checked-out clone", async () => {
		peerFile(".hyper/memory/note.md", "space memory\n");
		publish();
		const pulled = run("pull");
		expect(pulled.status, flat(pulled.stderr)).toBe(0);
		expect(readFileSync(join(root, ".hyper", "memory", "note.md"), "utf8")).toBe("space memory\n");
		const destination = join(fixture.root, "memory-clone");
		mkdirSync(destination);
		initSpaceGitDir(destination, { branch: "space/incoming", remote: fixture.remote });
		spaceGit(destination, ["fetch", "--no-tags", "origin", "refs/heads/space/incoming"]);
		await expect(validateIncomingSpace(destination, "FETCH_HEAD")).resolves.toMatchObject({
			tracked: [],
		});
	});
	it("refuses a regular file traversing a local symlink into reserved metadata", () => {
		symlinkSync("../.hyper", join(root, "notes", "cache"));
		peerFile("notes/cache/space.git/sentinel", "hostile\n");
		publish();
		expectRefused("notes/cache/space.git/sentinel");
		expect(existsSync(join(root, ".hyper", "space.git", "sentinel"))).toBe(false);
	});
	it("refuses a symlink into live space Git metadata", () => {
		symlinkSync("../.hyper/space.git", join(peer, "notes", "config-link"));
		publish();
		expectRefused("notes/config-link");
	});
	it("refuses a symlink chain whose dot-dot resolves outside despite a safe lexical target", () => {
		symlinkSync("..", join(peer, "notes", "parent"));
		symlinkSync("parent/../outside", join(peer, "notes", "escape"));
		publish();
		expectRefused("notes/escape");
	});
	it("accepts bad historical paths removed at the tip without materializing them", () => {
		peerFile("notes/.gitattributes", "* filter=evil\n");
		publish();
		git(["rm", "notes/.gitattributes"], peer);
		publish();
		const result = run("pull");
		expect(result.status, flat(result.stderr)).toBe(0);
		expect(existsSync(join(root, "notes", ".gitattributes"))).toBe(false);
	});
	it("validates an un-checked-out commit for clone", async () => {
		const destination = join(fixture.root, "clone");
		mkdirSync(destination);
		initSpaceGitDir(destination, { branch: "space/incoming", remote: fixture.remote });
		spaceGit(destination, ["fetch", "--no-tags", "origin", "refs/heads/space/incoming"]);
		expect(await validateIncomingSpace(destination, "FETCH_HEAD")).toMatchObject({ tracked: [] });
		expect(existsSync(join(destination, ".gitignore"))).toBe(false);
	});
});
