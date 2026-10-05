/**
 * Claude Code's per-user state under a space's `.claude/` never reaches the
 * space's history (ac-gaps item 7).
 *
 * The reproduction from the acceptance walk, end to end through the CLI: with
 * Claude pointed at a space's `.claude/` as its config dir, `hyper space
 * commit` used to commit `.claude.json`, shell snapshots, prompt history and
 * transcripts. Now the allowlist ignores them silently, the secret guard
 * refuses the credential-bearing ones when they are force-added past it, and
 * `hyper space init --refresh` moves an existing space to the new rules.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { canonicalGitignores, renderGitignore } from "#services/allowlist";
import { spaceGit } from "#services/space-git";
import {
	flat,
	isolateGitConfig,
	type ManifestFixture,
	spawnCli,
	withManifestFixture,
} from "#tests/tmp-manifest";
import { makeBareSpace } from "#tests/tmp-space";

/** What Claude writes into its config dir, as the walk's reproduction had it. */
const USER_STATE = [
	".claude/.claude.json",
	".claude/.credentials.json",
	".claude/shell-snapshots/snapshot-zsh.sh",
	".claude/history.jsonl",
	".claude/projects/-x/s.jsonl",
	".claude/todos/t.json",
	".claude/statsig/s",
	".claude/mcp-needs-auth-cache.json",
	".claude/file-history/abc/f",
	".claude/paste-cache/p",
	".claude/session-env/abc/env",
	".claude/plugins/installed_plugins.json",
];
/** The shareable project configuration that keeps travelling. */
const PROJECT_CONFIG = [
	".claude/settings.json",
	".claude/commands/c.md",
	".claude/agents/a.md",
	".claude/skills/s/SKILL.md",
	".claude/hooks/h.sh",
];

const cli = join(import.meta.dirname, "..", "..", "cli", "bin", "run.js");
let fixture: ManifestFixture;
let root: string;

beforeEach(() => {
	isolateGitConfig();
	process.env.GIT_AUTHOR_NAME = process.env.GIT_COMMITTER_NAME = "hyper test";
	process.env.GIT_AUTHOR_EMAIL = process.env.GIT_COMMITTER_EMAIL = "hyper-test@example.invalid";
	fixture = withManifestFixture();
	mkdirSync(dirname(fixture.configFile), { recursive: true });
	writeFileSync(fixture.configFile, `remote = ${JSON.stringify(fixture.remote)}\n`);
	root = join(fixture.root, "space");
	makeBareSpace(root);
	mkdirSync(join(root, "notes"));
	writeFileSync(join(root, "notes", "a.md"), "note\n");
});
afterEach(() => fixture.cleanup());

function write(paths: string[]): void {
	for (const path of paths) {
		mkdirSync(dirname(join(root, path)), { recursive: true });
		writeFileSync(join(root, path), `${path}\n`);
	}
}
function hyper(...args: string[]) {
	return spawnCli(["space", ...args, ...(args[0] === "init" ? [root] : [])], fixture);
}
function committed(): string[] {
	return spaceGit(root, ["ls-tree", "-r", "--name-only", "HEAD"])
		.stdout.split("\n")
		.filter(Boolean);
}

describe("Claude's user state in a space's .claude/", () => {
	it("is never committed by init or commit, while the project config is", () => {
		write([...USER_STATE, ...PROJECT_CONFIG]);
		const init = hyper("init", "--cadence", "manual");
		expect(init.status, flat(init.stderr)).toBe(0);
		let tree = committed();
		for (const path of USER_STATE) expect(tree, path).not.toContain(path);
		for (const path of PROJECT_CONFIG) expect(tree, path).toContain(path);

		// A later session writes more of both; a commit takes only the config.
		write([".claude/history.jsonl", ".claude/projects/-y/t.jsonl", ".claude/commands/d.md"]);
		writeFileSync(join(root, ".claude", "history.jsonl"), "changed\n");
		const result = spawnCliIn(root, ["space", "commit", "-m", "later"]);
		expect(result.status, flat(result.stderr)).toBe(0);
		tree = committed();
		expect(tree).toContain(".claude/commands/d.md");
		for (const path of [...USER_STATE, ".claude/projects/-y/t.jsonl"])
			expect(tree, path).not.toContain(path);
	});

	it.each([".claude/.claude.json", ".claude/shell-snapshots/snapshot-zsh.sh"])(
		"refuses %s when it is force-added past the allowlist",
		(path) => {
			const init = hyper("init", "--cadence", "manual");
			expect(init.status, flat(init.stderr)).toBe(0);
			write([path]);
			spaceGit(root, ["add", "-f", "--", path]);
			const head = spaceGit(root, ["rev-parse", "HEAD"]).stdout;
			const result = spawnCliIn(root, ["space", "commit", "-m", "forced"]);
			expect(result.status).not.toBe(0);
			expect(flat(result.stderr)).toContain(path);
			expect(flat(result.stderr)).toContain("secret guard");
			expect(spaceGit(root, ["rev-parse", "HEAD"]).stdout).toBe(head);
		},
	);

	it("`init --refresh` moves a space on the previous render to the new rules; committed files stay until removed", () => {
		const init = hyper("init", "--cadence", "manual");
		expect(init.status, flat(init.stderr)).toBe(0);
		// The space as an older CLI left it: the previous render, with a
		// transcript and the prompt history already in its history.
		writeFileSync(join(root, ".gitignore"), canonicalGitignores()[1]);
		write([".claude/history.jsonl", ".claude/projects/-x/s.jsonl"]);
		const old = spawnCliIn(root, ["space", "commit", "-m", "old rules"]);
		expect(old.status, flat(old.stderr)).toBe(0);
		expect(committed()).toContain(".claude/history.jsonl");

		const refresh = hyper("init", "--refresh");
		expect(refresh.status, flat(refresh.stderr)).toBe(0);
		expect(readFileSync(join(root, ".gitignore"), "utf8")).toBe(renderGitignore());
		// Ignore rules do not untrack: the files committed before stay in HEAD.
		expect(committed()).toContain(".claude/history.jsonl");

		// The manual step the README documents removes them from the tip.
		spaceGit(root, [
			"rm",
			"-r",
			"--cached",
			"-q",
			"--",
			".claude/history.jsonl",
			".claude/projects",
		]);
		const untrack = spawnCliIn(root, ["space", "commit", "-m", "stop tracking user state"]);
		expect(untrack.status, flat(untrack.stderr)).toBe(0);
		expect(committed()).not.toContain(".claude/history.jsonl");
		expect(committed()).not.toContain(".claude/projects/-x/s.jsonl");
		// The files themselves stay on disk.
		expect(readFileSync(join(root, ".claude", "history.jsonl"), "utf8")).toContain("history");
	});
});

/** The CLI run from inside `dir`, for the commands that act on the current space. */
function spawnCliIn(dir: string, args: string[]) {
	return spawnSync(process.execPath, [cli, ...args], {
		cwd: dir,
		encoding: "utf8",
		env: {
			...process.env,
			HOME: fixture.home,
			XDG_CONFIG_HOME: join(fixture.root, "config"),
			HYPER_HOME: fixture.hyperHome,
			HYPER_DRIVE_CONFIG: fixture.configFile,
			AI_AGENT: undefined,
			CLAUDECODE: undefined,
			NO_COLOR: "1",
			FORCE_COLOR: "0",
		},
	});
}
