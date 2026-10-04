import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { renderGitignore } from "#services/allowlist";
import { shellQuote } from "#services/remote";
import { initSpaceGitDir, spaceGit } from "#services/space-git";
import { incomingReviewPaths } from "#services/space-incoming";
import { isolateGitConfig, type ManifestFixture, withManifestFixture } from "#tests/tmp-manifest";

let fixture: ManifestFixture;
let root: string;
beforeEach(() => {
	isolateGitConfig();
	process.env.GIT_AUTHOR_NAME = process.env.GIT_COMMITTER_NAME = "hyper test";
	process.env.GIT_AUTHOR_EMAIL = process.env.GIT_COMMITTER_EMAIL = "hyper-test@example.invalid";
	fixture = withManifestFixture();
	root = join(fixture.root, "cost");
	mkdirSync(root);
	initSpaceGitDir(root, { branch: "space/cost" });
}, 120_000);
afterEach(() => fixture.cleanup());

/**
 * Clone-shaped cost: many reviewed links over one directory, and a very large
 * tip. The previous implementation compared every link against every changed
 * path (quadratic); the bound below is generous for a loaded machine yet still
 * fails that shape, which measured ~20 s here.
 */
it("reports a large clone tip in bounded time", async () => {
	const files = 32_000;
	const links = 2_000;
	let script =
		"commit c0\nmark :c0\nauthor hyper test <hyper-test@example.invalid> 0 +0000\ncommitter hyper test <hyper-test@example.invalid> 0 +0000\ndata 4\nroot\n";
	for (let index = 0; index < files; index++)
		script += `M 100644 inline notes/f${index}.md\ndata 1\nx\n`;
	const allowlist = spaceGit(root, ["hash-object", "-w", "--stdin"], {
		input: renderGitignore(["notes", "bin"]),
	}).stdout.trim();
	script += `M 100644 ${allowlist} .gitignore\n`;
	// Every bin/ entry is a link to the same directory: the shape that made the
	// old second loop quadratic.
	for (let index = 0; index < links; index++) {
		const target = "../notes/f0.md";
		script += `M 120000 inline bin/t${index}\ndata ${target.length}\n${target}\n`;
	}
	writeFileSync(join(root, "stream.fi"), `${script}done\n`);
	const imported = spawnSync(
		"sh",
		[
			"-c",
			`git --git-dir ${shellQuote(join(root, ".hyper", "space.git"))} --work-tree ${shellQuote(root)} fast-import --quiet --done < stream.fi`,
		],
		{ cwd: root, encoding: "utf8" },
	);
	expect(imported.status, imported.stderr).toBe(0);
	const tip = spaceGit(root, ["rev-parse", "c0"]).stdout.trim();

	const started = Date.now();
	const paths = await incomingReviewPaths(root, tip);
	const elapsed = Date.now() - started;
	console.log(`clone report over ${files} files and ${links} links: ${elapsed}ms`);
	expect(paths).toContain("bin/t0");
	expect(paths).toContain("notes/f0.md");
	expect(elapsed).toBeLessThan(12_000);
}, 300_000);

/** 5,000 reviewed links plus one resolving to `.`: the shape that starved the loop. */
it("stays bounded with many reviewed links and one link to its own directory", async () => {
	const links = 5_000;
	let script =
		"commit c0\nmark :c0\nauthor hyper test <hyper-test@example.invalid> 0 +0000\ncommitter hyper test <hyper-test@example.invalid> 0 +0000\ndata 4\nroot\n";
	const allowlist = spaceGit(root, ["hash-object", "-w", "--stdin"], {
		input: renderGitignore(["notes", "bin", "data"]),
	}).stdout.trim();
	script += `M 100644 ${allowlist} .gitignore\nM 100644 inline notes/target.md\ndata 1\nx\nM 100644 inline data/secretdir/x.md\ndata 1\ny\n`;
	for (let index = 0; index < links; index++) {
		const target = "../notes/target.md";
		script += `M 120000 inline bin/t${index}\ndata ${target.length}\n${target}\n`;
	}
	script += "M 120000 inline bin/zz\ndata 1\n.\n";
	script += "M 120000 inline .claude/aaa\ndata 17\n../data/secretdir\n";
	writeFileSync(join(root, "stream.fi"), `${script}done\n`);
	const imported = spawnSync(
		"sh",
		[
			"-c",
			`git --git-dir ${shellQuote(join(root, ".hyper", "space.git"))} --work-tree ${shellQuote(root)} fast-import --quiet --done < stream.fi`,
		],
		{ cwd: root, encoding: "utf8" },
	);
	expect(imported.status, imported.stderr).toBe(0);
	const tip = spaceGit(root, ["rev-parse", "c0"]).stdout.trim();
	const started = Date.now();
	const paths = await incomingReviewPaths(root, tip);
	const elapsed = Date.now() - started;
	console.log(`${links} links plus one link to '.': ${elapsed}ms`);
	// The .claude link sorts before every bin link: if the loop budget can be
	// exhausted by re-queued duplicates, its target is silently dropped.
	expect(paths).toContain("data/secretdir/x.md");
	expect(elapsed).toBeLessThan(12_000);
}, 300_000);
