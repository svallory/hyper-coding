/**
 * Claude Code's per-user state under a space's `.claude/` never enters a
 * space's history (ac-gaps item 7, round 2).
 *
 * Enforced in code at every commit and at every pull, not by the rendered
 * `.gitignore`, which an incoming tip can replace. Driven through the CLI:
 * - a commit stages none of it, at any depth, whatever `.gitignore` says;
 * - user state already tracked (an old space, a planted file) is untracked by
 *   the next commit, with one line naming the count, and kept on disk;
 * - `--allow-secret` cannot bring it back;
 * - a pull refuses a range that adds or changes it (the review's hostile
 *   downgrade), but accepts one that only touches other files of an old space
 *   that still tracks some, and one that deletes it;
 * - a clone of an old space works, and its first commit cleans it up.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderGitignore } from "#services/allowlist";
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

const cli = join(import.meta.dirname, "..", "..", "cli", "bin", "run.js");

/** What Claude writes into its config dir, including the review's 18 misses. */
const USER_STATE = [
	".claude/.claude.json",
	".claude/.credentials.json",
	".claude/shell-snapshots/snapshot-zsh.sh",
	".claude/history.jsonl",
	".claude/projects/-x/s.jsonl",
	".claude/todos/t.json",
	".claude/session-env/abc/env",
	".claude/statsig/s",
	".claude/plugins/installed_plugins.json",
	".claude/daemon.log",
	".claude/policy-limits.json",
	".claude/remote-settings.json",
	".claude/.last-update",
	".claude/jobs/j.json",
	".claude/feedback/f.json",
	".claude/settings.json.bak",
	".claude/.anthropic/a",
	".claude/local/claude",
	".claude/tasks/t.json",
	".claude/teams/t.json",
	".claude/security_warnings_state_abc.json",
	"notes/sub/.claude/history.jsonl",
	"data/.claude/todos/t.json",
];
/** The shareable project configuration that keeps travelling. */
const PROJECT_CONFIG = [
	".claude/settings.json",
	".claude/commands/c.md",
	".claude/agents/a.md",
	".claude/skills/s/SKILL.md",
	".claude/hooks/h.sh",
	".claude/epic/plan.md",
];

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

function write(dir: string, paths: string[], content?: string): void {
	for (const path of paths) {
		mkdirSync(dirname(join(dir, path)), { recursive: true });
		writeFileSync(join(dir, path), content ?? `${path}\n`);
	}
}
/** The CLI run from inside `dir`, for the commands that act on the current space. */
function hyperIn(dir: string, args: string[]) {
	return spawnSync(process.execPath, [cli, ...args], {
		cwd: dir,
		encoding: "utf8",
		env: {
			...process.env,
			HOME: fixture.home,
			XDG_CONFIG_HOME: join(fixture.root, "config"),
			HYPER_HOME: fixture.hyperHome,
			HYPER_DRIVE_CONFIG: fixture.configFile,
			HYPER_SKIP_NEW_VERSION_CHECK: "1",
			AI_AGENT: undefined,
			CLAUDECODE: undefined,
			NO_COLOR: "1",
			FORCE_COLOR: "0",
		},
	});
}
function ok(result: ReturnType<typeof hyperIn>): void {
	expect(result.status, `${flat(result.stdout)} | ${flat(result.stderr)}`).toBe(0);
}
function init(): void {
	ok(spawnCli(["space", "init", root, "--cadence", "manual"], fixture));
}
function tree(dir = root): string[] {
	return spaceGit(dir, ["ls-tree", "-r", "--name-only", "HEAD"]).stdout.split("\n").filter(Boolean);
}
/** A raw-git clone of the space branch: a peer that runs whatever hyper it likes. */
function peerClone(): string {
	const peer = join(fixture.root, "peer");
	git(
		["clone", "-q", "--single-branch", "--branch", "space/space", fixture.remote, peer],
		fixture.root,
	);
	return peer;
}
function peerPublish(peer: string, paths: string[], message: string): string {
	git(["add", "-f", "--", ...paths], peer);
	git(["commit", "-qm", message], peer);
	git(["push", "-q", "origin", "HEAD"], peer);
	return git(["rev-parse", "HEAD"], peer).trim();
}

describe("committing a space with Claude user state in it", () => {
	it("stages none of it, at any depth, and all of the project config", () => {
		// The rendered allowlist is main's, byte for byte: it re-includes all of
		// .claude/, so everything below is the code's doing, not the file's.
		expect(renderGitignore()).toContain("!/.claude/**\n/.claude/settings.local.json\n");
		write(root, [...USER_STATE, ...PROJECT_CONFIG]);
		init();
		for (const path of USER_STATE) expect(tree(), path).not.toContain(path);
		for (const path of PROJECT_CONFIG) expect(tree(), path).toContain(path);
		write(
			root,
			[".claude/history.jsonl", ".claude/projects/-y/t.jsonl", ".claude/commands/d.md"],
			"later\n",
		);
		ok(hyperIn(root, ["space", "commit", "-m", "later"]));
		expect(tree()).toContain(".claude/commands/d.md");
		expect(tree()).not.toContain(".claude/projects/-y/t.jsonl");
		expect(tree()).not.toContain(".claude/history.jsonl");
	});

	it("untracks user state that is already tracked, says so in one line, and keeps the files", () => {
		init();
		// Planted the way an older CLI or a peer leaves it: tracked in HEAD.
		write(root, [".claude/todos/y.json", ".claude/session-env/q/env", ".claude/history.jsonl"]);
		spaceGit(root, [
			"add",
			"-f",
			"--",
			".claude/todos/y.json",
			".claude/session-env/q/env",
			".claude/history.jsonl",
		]);
		spaceGit(root, ["-c", "core.hooksPath=/dev/null", "commit", "-qm", "planted"]);
		expect(tree()).toContain(".claude/todos/y.json");
		write(root, [".claude/session-env/q/env"], "changed\n");
		const result = hyperIn(root, ["space", "commit", "-m", "next"]);
		ok(result);
		const notes = flat(result.stderr)
			.split(/(?=note:)/)
			.filter((line) => line.startsWith("note:"));
		expect(notes).toHaveLength(1);
		expect(notes[0]).toContain(
			"stopped tracking 3 Claude user-state files under .claude/ (kept on disk)",
		);
		for (const path of [
			".claude/todos/y.json",
			".claude/session-env/q/env",
			".claude/history.jsonl",
		]) {
			expect(tree(), path).not.toContain(path);
			expect(existsSync(join(root, path)), path).toBe(true);
		}
		expect(readFileSync(join(root, ".claude/session-env/q/env"), "utf8")).toBe("changed\n");
	});

	it("is not brought back by --allow-secret", () => {
		init();
		write(root, [".claude/.claude.json", ".claude/history.jsonl"]);
		spaceGit(root, ["add", "-f", "--", ".claude/.claude.json", ".claude/history.jsonl"]);
		ok(
			hyperIn(root, [
				"space",
				"commit",
				"-m",
				"forced",
				"--allow-secret",
				".claude/.claude.json",
				"--allow-secret",
				".claude/history.jsonl",
			]),
		);
		expect(tree()).not.toContain(".claude/.claude.json");
		expect(tree()).not.toContain(".claude/history.jsonl");
	});

	it("still refuses the two secret patterns outside .claude/, with --allow-secret as the override", () => {
		init();
		write(root, ["notes/.claude.json"]);
		const refused = hyperIn(root, ["space", "commit", "-m", "x"]);
		expect(refused.status).not.toBe(0);
		expect(flat(refused.stderr)).toContain("notes/.claude.json");
		ok(hyperIn(root, ["space", "commit", "-m", "x", "--allow-secret", "notes/.claude.json"]));
		expect(tree()).toContain("notes/.claude.json");
	});
});

describe("incoming history with Claude user state", () => {
	it("refuses a pull that adds user state (the review's hostile downgrade), naming the path and the commit", () => {
		init();
		ok(hyperIn(root, ["space", "push"]));
		const peer = peerClone();
		write(peer, [".claude/history.jsonl", ".claude/todos/x.json"]);
		const sha = peerPublish(peer, [".claude/history.jsonl", ".claude/todos/x.json"], "hostile");
		const head = spaceGit(root, ["rev-parse", "HEAD"]).stdout;
		const result = hyperIn(root, ["space", "pull"]);
		expect(result.status).toBe(2);
		const err = flat(result.stderr);
		expect(err).toContain(".claude/history.jsonl");
		expect(err).toContain(sha.slice(0, 12));
		expect(err).toContain("update hyper on the machine that pushed it");
		expect(spaceGit(root, ["rev-parse", "HEAD"]).stdout).toBe(head);
		expect(existsSync(join(root, ".claude/history.jsonl"))).toBe(false);
	});

	it("accepts an old space's changes to other files, and its deletion of user state", () => {
		// An old space: user state already in its history (main's CLI).
		write(root, [".claude/history.jsonl"]);
		init();
		spaceGit(root, ["add", "-f", "--", ".claude/history.jsonl"]);
		spaceGit(root, ["-c", "core.hooksPath=/dev/null", "commit", "-qm", "old space"]);
		spaceGit(root, ["push", "-q", "origin", "HEAD"]);
		const peer = peerClone();
		write(peer, ["notes/b.md"]);
		peerPublish(peer, ["notes/b.md"], "notes only");
		ok(hyperIn(root, ["space", "pull"]));
		expect(readFileSync(join(root, "notes/b.md"), "utf8")).toBe("notes/b.md\n");
		// The peer runs a current hyper: its commit deletes the user state.
		git(["rm", "-q", "--cached", "--", ".claude/history.jsonl"], peer);
		git(["commit", "-qm", "untrack"], peer);
		git(["push", "-q", "origin", "HEAD"], peer);
		ok(hyperIn(root, ["space", "pull"]));
		expect(tree()).not.toContain(".claude/history.jsonl");
	});

	it("clones an old space that still tracks user state, and its first commit cleans it up", () => {
		write(root, [".claude/history.jsonl", ".claude/commands/c.md"]);
		init();
		spaceGit(root, ["add", "-f", "--", ".claude/history.jsonl"]);
		spaceGit(root, ["-c", "core.hooksPath=/dev/null", "commit", "-qm", "old space"]);
		spaceGit(root, ["push", "-q", "origin", "HEAD"]);
		const target = join(fixture.home, "clone");
		const clone = spawnCli(["space", "clone", "space", target, "--yes"], fixture);
		ok(clone);
		expect(tree(target)).toContain(".claude/history.jsonl");
		// The fixture's project has no origin, so clone made no `.git`; give the
		// clone the same bare layout so it is detected as a space.
		makeBareSpace(target);
		const commit = hyperIn(target, ["space", "commit", "-m", "clean"]);
		ok(commit);
		expect(flat(commit.stderr)).toContain("stopped tracking 1 Claude user-state file");
		expect(tree(target)).not.toContain(".claude/history.jsonl");
		expect(tree(target)).toContain(".claude/commands/c.md");
	});
});
