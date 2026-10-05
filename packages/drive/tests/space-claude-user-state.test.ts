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

import { spawn, spawnSync } from "node:child_process";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	readlinkSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
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
			"3 Claude user-state paths under .claude/ are not tracked (3 stopped being tracked by this commit); kept on disk",
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
		expect(flat(commit.stderr)).toContain("(1 stopped being tracked by this commit)");
		expect(tree(target)).not.toContain(".claude/history.jsonl");
		expect(tree(target)).toContain(".claude/commands/c.md");
	});
});

/** Byte snapshot of the given paths under `dir` (null when absent). */
function bytes(dir: string, paths: string[]): (string | null)[] {
	return paths.map((path) =>
		existsSync(join(dir, path)) ? readFileSync(join(dir, path), "latin1") : null,
	);
}

describe("a peer's untracking commit never deletes Claude user state here (review N1)", () => {
	const STATE = [
		".claude/projects/-p/s1.jsonl",
		".claude/history.jsonl",
		".claude/plugins/installed_plugins.json",
	];

	/** Machine A (root): a legacy space that tracked user state, pushed. Machine B: a clone that commits the untracking and pushes it. */
	function legacyPairWithPeerUntrack(): string {
		write(root, [...STATE, ".claude/commands/c.md"]);
		init();
		spaceGit(root, ["add", "-f", "--", ...STATE]);
		spaceGit(root, ["-c", "core.hooksPath=/dev/null", "commit", "-qm", "older hyper"]);
		spaceGit(root, ["push", "-q", "origin", "HEAD"]);
		spaceGit(root, ["fetch", "-q", "origin"]);
		const peer = join(fixture.home, "peer-space");
		ok(spawnCli(["space", "clone", "space", peer, "--yes"], fixture));
		makeBareSpace(peer);
		ok(hyperIn(peer, ["space", "commit", "-m", "untrack on B"]));
		expect(tree(peer)).not.toContain(".claude/history.jsonl");
		ok(hyperIn(peer, ["space", "push"]));
		return peer;
	}

	it("clean: the pull keeps every file byte for byte and stops tracking them here", () => {
		legacyPairWithPeerUntrack();
		const before = bytes(root, STATE);
		const pull = hyperIn(root, ["space", "pull"]);
		ok(pull);
		expect(bytes(root, STATE)).toEqual(before);
		expect(flat(pull.stdout)).toContain("Kept 3 Claude user-state files on disk");
		for (const path of STATE) expect(tree(), path).not.toContain(path);
		expect(tree()).toContain(".claude/commands/c.md");
	});

	it("dirty: a locally modified history.jsonl survives the pull with its new bytes", () => {
		legacyPairWithPeerUntrack();
		writeFileSync(join(root, ".claude/history.jsonl"), "a prompt written here after the upgrade\n");
		const before = bytes(root, STATE);
		ok(hyperIn(root, ["space", "pull"]));
		expect(bytes(root, STATE)).toEqual(before);
		expect(readFileSync(join(root, ".claude/history.jsonl"), "utf8")).toBe(
			"a prompt written here after the upgrade\n",
		);
	});

	it("committed first: both machines untracked it; the pull is not a divergence and keeps the files", () => {
		legacyPairWithPeerUntrack();
		ok(hyperIn(root, ["space", "commit", "-m", "untrack on A"]));
		const before = bytes(root, STATE);
		const pull = hyperIn(root, ["space", "pull"]);
		ok(pull);
		expect(flat(pull.stdout)).toContain(
			"Dropped 1 local commit that only stopped tracking Claude user state",
		);
		expect(bytes(root, STATE)).toEqual(before);
		expect(spaceGit(root, ["rev-parse", "HEAD"]).stdout).toBe(
			spaceGit(root, ["rev-parse", "refs/remotes/origin/space/space"]).stdout,
		);
	});

	it("a real divergence is still reported plainly", () => {
		legacyPairWithPeerUntrack();
		write(root, ["notes/local.md"]);
		ok(hyperIn(root, ["space", "commit", "-m", "real local work"]));
		const pull = hyperIn(root, ["space", "pull"]);
		expect(pull.status).toBe(2);
		expect(flat(pull.stderr)).toContain("have diverged");
		expect(bytes(root, STATE).every((content) => content !== null)).toBe(true);
	});
});

describe("push refuses unpushed history that holds user state or secrets (review N2)", () => {
	it("refuses a plain-git commit, names it, and the documented fix publishes it without the user state", () => {
		init();
		ok(hyperIn(root, ["space", "push"]));
		write(root, [".claude/history.jsonl", "notes/b.md"]);
		spaceGit(root, ["add", "-f", "--", ".claude/history.jsonl", "notes/b.md"]);
		spaceGit(root, ["-c", "core.hooksPath=/dev/null", "commit", "-qm", "older hyper"]);
		const sha = spaceGit(root, ["rev-parse", "HEAD"]).stdout.trim();
		const remoteBefore = git(
			["--git-dir", fixture.remote, "rev-parse", "space/space"],
			fixture.root,
		);
		const refused = hyperIn(root, ["space", "push"]);
		expect(refused.status).not.toBe(0);
		const err = flat(refused.stderr);
		expect(err).toContain(sha.slice(0, 12));
		expect(err).toContain(".claude/history.jsonl");
		expect(err).toContain("reset --soft");
		expect(git(["--git-dir", fixture.remote, "rev-parse", "space/space"], fixture.root)).toBe(
			remoteBefore,
		);
		// The documented fix: fold the unpushed commits, recommit, push.
		const upstream = spaceGit(root, ["rev-parse", "refs/remotes/origin/space/space"]).stdout.trim();
		spaceGit(root, ["reset", "-q", "--soft", upstream]);
		ok(hyperIn(root, ["space", "commit", "-m", "notes only"]));
		ok(hyperIn(root, ["space", "push"]));
		const published = git(
			["--git-dir", fixture.remote, "ls-tree", "-r", "--name-only", "space/space"],
			fixture.root,
		);
		expect(published).toContain("notes/b.md");
		expect(published).not.toContain(".claude/history.jsonl");
		expect(readFileSync(join(root, ".claude/history.jsonl"), "utf8")).toContain("history.jsonl");
	});

	it("refuses a secret in an unpushed plain-git commit; --allow-secret <path> publishes that one", () => {
		init();
		ok(hyperIn(root, ["space", "push"]));
		write(root, ["notes/.env"]);
		spaceGit(root, ["add", "-f", "--", "notes/.env"]);
		spaceGit(root, ["-c", "core.hooksPath=/dev/null", "commit", "-qm", "plain git secret"]);
		const refused = hyperIn(root, ["space", "push"]);
		expect(refused.status).not.toBe(0);
		expect(flat(refused.stderr)).toContain("notes/.env");
		const allowed = hyperIn(root, ["space", "push", "--allow-secret", "notes/.env"]);
		ok(allowed);
		// R6: as loud as commit's allowance, naming the path.
		expect(flat(allowed.stderr)).toContain(
			'--allow-secret: publishing secret-looking path "notes/.env"',
		);
	});

	it("--allow-user-state-history publishes it, loudly", () => {
		init();
		ok(hyperIn(root, ["space", "push"]));
		write(root, [".claude/todos/t.json"]);
		spaceGit(root, ["add", "-f", "--", ".claude/todos/t.json"]);
		spaceGit(root, ["-c", "core.hooksPath=/dev/null", "commit", "-qm", "older hyper"]);
		const result = hyperIn(root, ["space", "push", "--allow-user-state-history"]);
		ok(result);
		expect(flat(result.stderr)).toContain("cannot be taken back");
	});
});

describe("status, clone and generic names (review N3, N4, N5)", () => {
	it("status counts user state once instead of listing it as untracked", () => {
		init();
		write(root, [".claude/history.jsonl", ".claude/projects/-x/s.jsonl", "notes/new.md"]);
		const text = hyperIn(root, ["space", "status"]);
		ok(text);
		expect(flat(text.stdout)).toContain("Not tracked (Claude user state under .claude/): 2");
		expect(flat(text.stdout)).not.toContain("?? .claude/history.jsonl");
		expect(flat(text.stdout)).toContain("?? notes/new.md");
		const json = JSON.parse(hyperIn(root, ["space", "status", "--json"]).stdout);
		expect([...json.userState].sort()).toEqual([
			".claude/history.jsonl",
			".claude/projects/-x/s.jsonl",
		]);
	});

	it("clone of a tip that holds user state says what it is, not the generic warning", () => {
		write(root, [".claude/history.jsonl"]);
		init();
		spaceGit(root, ["add", "-f", "--", ".claude/history.jsonl"]);
		spaceGit(root, ["-c", "core.hooksPath=/dev/null", "commit", "-qm", "older hyper"]);
		spaceGit(root, ["push", "-q", "origin", "HEAD"]);
		const clone = spawnCli(["space", "clone", "space", join(fixture.home, "c"), "--yes"], fixture);
		ok(clone);
		const err = flat(clone.stderr);
		expect(err).toContain("Claude user-state file from another machine");
		expect(err).not.toMatch(/"\.claude\/history\.jsonl"[^.]*these came from the hyperdrive/);
	});

	it("tracks a project's generic names in a nested .claude/, and every exclusion is one counted line", () => {
		init();
		write(root, [
			"notes/proj/.claude/plans/p.md",
			"notes/proj/.claude/tasks/t.md",
			".claude/statusline.sh",
			".claude/plans/p.md",
		]);
		const result = hyperIn(root, ["space", "commit", "-m", "generic"]);
		ok(result);
		expect(tree()).toContain("notes/proj/.claude/plans/p.md");
		expect(tree()).toContain("notes/proj/.claude/tasks/t.md");
		expect(tree()).toContain(".claude/statusline.sh");
		expect(tree()).not.toContain(".claude/plans/p.md");
		const notes = flat(result.stderr)
			.split(/(?=note:)/)
			.filter((line) => line.startsWith("note:"));
		expect(notes).toHaveLength(1);
		expect(notes[0]).toContain("1 Claude user-state path under .claude/ is not tracked");
	});
});

describe("the pull touches no Claude user-state file, whatever stops it (review R1, R2)", () => {
	const STATE = [".claude/projects/-p/s1.jsonl", ".claude/history.jsonl", ".claude/todos/t.json"];

	function legacyPair(): void {
		write(root, [...STATE, "notes/n.md"]);
		init();
		spaceGit(root, ["add", "-f", "--", ...STATE]);
		spaceGit(root, ["-c", "core.hooksPath=/dev/null", "commit", "-qm", "older hyper"]);
		spaceGit(root, ["push", "-q", "origin", "HEAD"]);
		spaceGit(root, ["fetch", "-q", "origin"]);
		const peer = join(fixture.home, "peer-space");
		ok(spawnCli(["space", "clone", "space", peer, "--yes"], fixture));
		makeBareSpace(peer);
		write(peer, ["notes/n.md"], "changed on B\n");
		ok(hyperIn(peer, ["space", "commit", "-m", "untrack on B"]));
		ok(hyperIn(peer, ["space", "push"]));
		// This machine edits its history after the upgrade, and narrows a mode.
		writeFileSync(join(root, ".claude/history.jsonl"), "edited here\n");
	}
	function snapshot(): { path: string; content: string | null; mode: number | null }[] {
		return STATE.map((path) => {
			const full = join(root, path);
			return existsSync(full)
				? { path, content: readFileSync(full, "latin1"), mode: statSync(full).mode }
				: { path, content: null, mode: null };
		});
	}
	/**
	 * Start the BUILT pull in its own process group through the test-only
	 * runner, which stops it after `step` (an injected `onStep`; the product
	 * has no environment switch for this), then signal the group.
	 */
	async function interruptedPull(step: string, signal: NodeJS.Signals): Promise<void> {
		const marker = join(fixture.root, `paused-${step}-${Date.now()}`);
		const child = spawn(
			"bun",
			[join(import.meta.dirname, "pull-step-runner.ts"), root, "space/space", step, marker],
			{
				cwd: root,
				detached: true,
				stdio: "ignore",
				env: {
					...process.env,
					HOME: fixture.home,
					XDG_CONFIG_HOME: join(fixture.root, "config"),
					HYPER_HOME: fixture.hyperHome,
					HYPER_DRIVE_CONFIG: fixture.configFile,
					HYPER_SKIP_NEW_VERSION_CHECK: "1",
				},
			},
		);
		const exited = new Promise<void>((resolve) => child.on("exit", () => resolve()));
		const deadline = Date.now() + 30_000;
		while (!existsSync(marker)) {
			if (Date.now() > deadline) throw new Error(`the pull never reached ${step}`);
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
		process.kill(-(child.pid as number), signal);
		await exited;
	}

	it("an environment variable alone cannot pause a shipped pull (review M2)", () => {
		legacyPair();
		const result = spawnSync(process.execPath, [cli, "space", "pull"], {
			cwd: root,
			encoding: "utf8",
			timeout: 30_000,
			env: {
				...process.env,
				HOME: fixture.home,
				XDG_CONFIG_HOME: join(fixture.root, "config"),
				HYPER_HOME: fixture.hyperHome,
				HYPER_DRIVE_CONFIG: fixture.configFile,
				HYPER_SKIP_NEW_VERSION_CHECK: "1",
				HYPER_TEST_PULL_PAUSE_AT: "untracked",
			},
		});
		ok(result);
	});

	it("a kill between read-tree and update-ref is finished by the next commit, not recorded as local work (review M1)", async () => {
		legacyPair();
		const before = snapshot();
		await interruptedPull("read-tree", "SIGKILL");
		const commit = hyperIn(root, ["space", "commit", "-m", "after the kill"]);
		ok(commit);
		expect(flat(commit.stderr)).toContain("finished a pull that was interrupted");
		const tip = spaceGit(root, ["rev-parse", "refs/remotes/origin/space/space"]).stdout;
		// Nothing of the peer's tip was committed as local work: HEAD IS the tip.
		expect(spaceGit(root, ["rev-parse", "HEAD"]).stdout).toBe(tip);
		const pull = hyperIn(root, ["space", "pull"]);
		ok(pull);
		expect(flat(pull.stdout)).toContain("already up to date");
		expect(snapshot()).toEqual(before);
	}, 60_000);

	it("the same kill followed by a session-end save is finished too", async () => {
		legacyPair();
		await interruptedPull("read-tree", "SIGKILL");
		const payload = join(root, ".hyper", "space.git", "session-end-payload.tail");
		writeFileSync(
			payload,
			JSON.stringify({
				session_id: "1b4e28ba-2fa1-11d2-883f-0016d3cca427",
				hook_event_name: "SessionEnd",
				reason: "prompt_input_exit",
				cwd: root,
			}),
		);
		ok(hyperIn(root, ["space", "commit", "--session-end", "--payload-file", payload]));
		const tip = spaceGit(root, ["rev-parse", "refs/remotes/origin/space/space"]).stdout;
		expect(spaceGit(root, ["rev-parse", "HEAD"]).stdout).toBe(tip);
		expect(flat(hyperIn(root, ["space", "pull"]).stdout)).toContain("already up to date");
	}, 60_000);

	it("status finishes it as well, and then reports truthfully", async () => {
		legacyPair();
		await interruptedPull("read-tree", "SIGKILL");
		ok(hyperIn(root, ["space", "status"]));
		const tip = spaceGit(root, ["rev-parse", "refs/remotes/origin/space/space"]).stdout;
		expect(spaceGit(root, ["rev-parse", "HEAD"]).stdout).toBe(tip);
	}, 60_000);

	it("a stale index.lock gives one friendly line naming it, and is not deleted (review M3)", () => {
		init();
		write(root, ["notes/new.md"]);
		const lock = join(root, ".hyper", "space.git", "index.lock");
		writeFileSync(lock, "");
		const result = hyperIn(root, ["space", "commit", "-m", "x"]);
		expect(result.status).not.toBe(0);
		const err = flat(result.stderr);
		expect(err).toContain("index is locked by");
		expect(err).toContain("index.lock");
		expect(err).toContain("If no hyper or git process is working on this space, remove that file");
		expect(err).not.toContain("fatal:");
		expect(existsSync(lock)).toBe(true);
	});

	for (const step of ["base", "untracked", "read-tree"]) {
		for (const signal of ["SIGKILL", "SIGHUP"] as const) {
			it(`${signal} after the "${step}" step leaves every file in place, byte for byte; the next pull completes`, async () => {
				legacyPair();
				const before = snapshot();
				await interruptedPull(step, signal);
				// No recovery step: the files never moved.
				expect(snapshot()).toEqual(before);
				const pull = hyperIn(root, ["space", "pull"]);
				ok(pull);
				expect(snapshot()).toEqual(before);
				for (const path of STATE) expect(tree(), path).not.toContain(path);
				expect(readFileSync(join(root, "notes/n.md"), "utf8")).toBe("changed on B\n");
			}, 60_000);
		}
	}

	it("a tip that turns a nested .claude into a file is refused clearly; nothing is lost and status is truthful", () => {
		write(root, ["notes/x/.claude/history.jsonl", "notes/n.md"]);
		init();
		spaceGit(root, ["add", "-f", "--", "notes/x/.claude/history.jsonl"]);
		spaceGit(root, ["-c", "core.hooksPath=/dev/null", "commit", "-qm", "older hyper"]);
		spaceGit(root, ["push", "-q", "origin", "HEAD"]);
		const peer = join(fixture.root, "plain-peer");
		git(
			["clone", "-q", "--single-branch", "--branch", "space/space", fixture.remote, peer],
			fixture.root,
		);
		git(["rm", "-q", "--cached", "--", "notes/x/.claude/history.jsonl"], peer);
		git(["-c", "core.hooksPath=/dev/null", "commit", "-qm", "untrack"], peer);
		git(["rm", "-q", "-r", "--ignore-unmatch", "--", "notes/x/.claude"], peer);
		rmSync(join(peer, "notes/x/.claude"), { recursive: true, force: true });
		writeFileSync(join(peer, "notes/x/.claude"), "now a file\n");
		git(["add", "--", "notes/x/.claude"], peer);
		git(["-c", "core.hooksPath=/dev/null", "commit", "-qm", "dir to file"], peer);
		git(["push", "-q", "origin", "HEAD"], peer);
		const head = spaceGit(root, ["rev-parse", "HEAD"]).stdout;
		const pull = hyperIn(root, ["space", "pull"]);
		expect(pull.status).toBe(2);
		expect(flat(pull.stderr)).toContain(
			"replaces a directory that holds this machine's Claude user state with a file",
		);
		expect(readFileSync(join(root, "notes/x/.claude/history.jsonl"), "utf8")).toBe(
			"notes/x/.claude/history.jsonl\n",
		);
		expect(spaceGit(root, ["rev-parse", "HEAD"]).stdout).toBe(head);
		// The index is as before the pull: still tracked, nothing staged.
		expect(spaceGit(root, ["ls-files", "--", "notes/x/.claude/history.jsonl"]).stdout.trim()).toBe(
			"notes/x/.claude/history.jsonl",
		);
		expect(spaceGit(root, ["diff", "--cached", "--name-only"]).stdout.trim()).toBe("");
	});

	it("never moves or follows symlinked user state", () => {
		const elsewhere = join(fixture.root, "elsewhere");
		write(elsewhere, ["-p/s1.jsonl"], "outside the space\n");
		mkdirSync(join(root, ".claude"), { recursive: true });
		symlinkSync(elsewhere, join(root, ".claude/projects"));
		write(root, [".claude/history.jsonl"]);
		init();
		spaceGit(root, ["add", "-f", "--", ".claude/projects", ".claude/history.jsonl"]);
		spaceGit(root, ["-c", "core.hooksPath=/dev/null", "commit", "-qm", "older hyper"]);
		spaceGit(root, ["push", "-q", "origin", "HEAD"]);
		const peer = join(fixture.root, "plain-peer2");
		git(
			["clone", "-q", "--single-branch", "--branch", "space/space", fixture.remote, peer],
			fixture.root,
		);
		git(["rm", "-q", "--cached", "--", ".claude/projects", ".claude/history.jsonl"], peer);
		git(["-c", "core.hooksPath=/dev/null", "commit", "-qm", "untrack"], peer);
		git(["push", "-q", "origin", "HEAD"], peer);
		ok(hyperIn(root, ["space", "pull"]));
		expect(lstatSync(join(root, ".claude/projects")).isSymbolicLink()).toBe(true);
		expect(readlinkSync(join(root, ".claude/projects"))).toBe(elsewhere);
		expect(readFileSync(join(elsewhere, "-p/s1.jsonl"), "utf8")).toBe("outside the space\n");
	});
});

describe("the push guard asks the remote what is unpushed (review R3, R5)", () => {
	function dropTrackingRefs(): void {
		for (const ref of spaceGit(root, ["for-each-ref", "--format=%(refname)", "refs/remotes/"])
			.stdout.split("\n")
			.filter(Boolean))
			spaceGit(root, ["update-ref", "-d", ref]);
	}

	it("without tracking refs, a commit already on the hyperdrive is never called unpushed", () => {
		init();
		write(root, [".claude/todos/t.json"]);
		spaceGit(root, ["add", "-f", "--", ".claude/todos/t.json"]);
		spaceGit(root, ["-c", "core.hooksPath=/dev/null", "commit", "-qm", "older hyper, published"]);
		ok(hyperIn(root, ["space", "push", "--allow-user-state-history"]));
		dropTrackingRefs();
		write(root, ["notes/clean.md"]);
		spaceGit(root, ["add", "--", "notes/clean.md"]);
		spaceGit(root, ["-c", "core.hooksPath=/dev/null", "commit", "-qm", "clean"]);
		ok(hyperIn(root, ["space", "push"]));
	});

	it("without tracking refs, only the truly unpushed commit is named, and the fix starts at the remote's tip", () => {
		init();
		ok(hyperIn(root, ["space", "push"]));
		const remoteTip = git(
			["--git-dir", fixture.remote, "rev-parse", "space/space"],
			fixture.root,
		).trim();
		dropTrackingRefs();
		write(root, [".claude/history.jsonl"]);
		spaceGit(root, ["add", "-f", "--", ".claude/history.jsonl"]);
		spaceGit(root, ["-c", "core.hooksPath=/dev/null", "commit", "-qm", "older hyper"]);
		const refused = hyperIn(root, ["space", "push"]);
		expect(refused.status).not.toBe(0);
		const err = flat(refused.stderr);
		expect(err).toContain("a commit not yet on the hyperdrive");
		expect(err).toContain(`reset --soft ${remoteTip.slice(0, 12)}`);
	});

	it("gives the session-end log one readable line: the reason, the paths, and where the steps are", async () => {
		init();
		ok(hyperIn(root, ["space", "push"]));
		write(root, [".claude/history.jsonl"]);
		spaceGit(root, ["add", "-f", "--", ".claude/history.jsonl"]);
		spaceGit(root, ["-c", "core.hooksPath=/dev/null", "commit", "-qm", "older hyper"]);
		const { pushSpaceBounded, UnsafeOutgoingError } = await import("#services/space-sync");
		const error = await pushSpaceBounded(root, fixture.remote, "space/space", 30_000).catch(
			(e) => e,
		);
		expect(error).toBeInstanceOf(UnsafeOutgoingError);
		expect(error.summary).not.toContain("\n");
		expect(error.summary).toContain(".claude/history.jsonl");
		expect(error.summary).toContain("run `hyper space push` for the fix");
	});
});
