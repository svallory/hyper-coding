import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { renderGitignore } from "#services/allowlist";
import { shellQuote } from "#services/remote";
import { initSpaceGitDir, spaceGit } from "#services/space-git";
import { validateIncomingSpace } from "#services/space-incoming";
import { isolateGitConfig, type ManifestFixture, withManifestFixture } from "#tests/tmp-manifest";

let fixture: ManifestFixture;
let root: string;
beforeEach(() => {
	isolateGitConfig();
	process.env.GIT_AUTHOR_NAME = process.env.GIT_COMMITTER_NAME = "hyper test";
	process.env.GIT_AUTHOR_EMAIL = process.env.GIT_COMMITTER_EMAIL = "hyper-test@example.invalid";
	fixture = withManifestFixture();
	root = join(fixture.root, "scale");
	mkdirSync(root);
	initSpaceGitDir(root, { branch: "space/scale" });
}, 120_000);
afterEach(() => fixture.cleanup());

/** Build a deep history and a wide tip with one fast-import, no per-file Git spawns. */
function buildHistory(commits: number, filesPerCommit: number, tipFiles: number): string {
	const commit = (mark: string, parent: string | null): string => {
		const message = parent === null ? "root" : `from :${parent}`;
		return `commit ${mark}\nmark :${mark}\nauthor hyper test <hyper-test@example.invalid> 0 +0000\ncommitter hyper test <hyper-test@example.invalid> 0 +0000\ndata ${message.length}\n${message}\n`;
	};
	let script = "";
	let previous: string | null = null;
	for (let round = 0; round < commits; round++) {
		const mark = `c${round}`;
		script += commit(mark, previous);
		for (let index = 0; index < filesPerCommit; index++)
			script += `M 100644 inline notes/${round}-${index}.md\ndata 1\nx\n`;
		previous = mark;
	}
	script += commit("tip", previous);
	for (let index = 0; index < tipFiles; index++)
		script += `M 100644 inline notes/tip-${index}.md\ndata 1\ny\n`;
	// A real space tip always carries hyper's allowlist; without it the
	// validator refuses before it measures anything. Referenced by blob id so
	// no multi-line inline data appears in the stream.
	const allowlist = spaceGit(root, ["hash-object", "-w", "--stdin"], {
		input: renderGitignore(),
	}).stdout.trim();
	script += `M 100644 ${allowlist} .gitignore\n`;
	writeFileSync(join(root, "stream.fi"), `${script}done\n`);
	// Redirected rather than piped: a multi-megabyte stream written into a
	// synchronous pipe can EPIPE here, and fixture cost must not look like a
	// validation cost.
	const imported = spawnSync(
		"sh",
		[
			"-c",
			`git --git-dir ${shellQuote(join(root, ".hyper", "space.git"))} --work-tree ${shellQuote(root)} fast-import --quiet --done < stream.fi`,
		],
		{ cwd: root, encoding: "utf8" },
	);
	expect(imported.status, imported.stderr).toBe(0);
	rmSync(join(root, "stream.fi"));
	return spaceGit(root, ["rev-parse", "tip"]).stdout.trim();
}

function countingGit(): { calls: string } {
	const real = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
	const bin = join(fixture.root, "bin");
	mkdirSync(bin, { recursive: true });
	const calls = join(fixture.root, "git-calls");
	writeFileSync(
		join(bin, "git"),
		`#!/bin/sh\nprintf '%s\\n' "$*" >> ${shellQuote(calls)}\nexec ${shellQuote(real)} "$@"\n`,
		{ mode: 0o755 },
	);
	// spaceGit builds the child environment from process.env, so the wrapper has
	// to lead on PATH rather than be passed down through a spawn option.
	process.env.PATH = `${bin}:${process.env.PATH}`;
	return { calls };
}

it("validates a wide, deep tip with a bounded number of git processes", async () => {
	const tip = buildHistory(300, 100, 30_000);
	const { calls } = countingGit();
	const started = Date.now();
	const validation = await validateIncomingSpace(root, tip);
	const elapsed = Date.now() - started;
	const commands = readFileSync(calls, "utf8").trim().split("\n");
	console.log(`30,000-file tip over 301 commits: ${elapsed}ms, ${commands.length} git processes`);
	expect(validation.tip).toBe(tip);
	expect(commands.filter((line) => line.startsWith("ls-tree")).length).toBeLessThanOrEqual(2);
	expect(
		commands.filter((line) => line.includes("cat-file --batch-check")).length,
	).toBeLessThanOrEqual(1);
	expect(commands.filter((line) => line.endsWith("cat-file --batch"))).toHaveLength(1);
	expect(commands.length).toBeLessThanOrEqual(8);
	expect(elapsed).toBeLessThan(20_000);
}, 180_000);
