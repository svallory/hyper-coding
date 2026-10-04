import { spawnSync } from "node:child_process";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
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
	root = join(fixture.root, "followups");
	makeBareSpace(root);
	mkdirSync(join(root, "notes"));
	writeFileSync(join(root, "notes", "a.md"), "local\n");
	expect(spawnCli(["space", "init", root, "--cadence", "manual"], fixture).status).toBe(0);
	peer = join(fixture.root, "peer");
	git(
		["clone", "--single-branch", "--branch", "space/followups", fixture.remote, peer],
		fixture.root,
	);
}, 120_000);
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
function peerFile(path: string, content = "remote\n"): void {
	mkdirSync(dirname(join(peer, path)), { recursive: true });
	writeFileSync(join(peer, path), content);
	git(["add", "-f", "--", path], peer);
}
function publish(): void {
	git(["add", "-A"], peer);
	git(["commit", "-qm", "peer update"], peer);
	git(["push", "origin", "HEAD"], peer);
}
function track(entry: string): void {
	writeFileSync(join(peer, ".gitignore"), renderGitignore([entry]));
	publish();
}
function ignoredFiles(entry: string): void {
	mkdirSync(join(root, entry), { recursive: true });
	for (const name of ["a.txt", "b.txt"]) writeFileSync(join(root, entry, name), "local\n");
	mkdirSync(join(root, entry, "nested"));
	writeFileSync(join(root, entry, "nested", "c.txt"), "local\n");
}
function config(key: string): string | null {
	return (
		spaceGit(root, ["config", "--local", "--get", key], { allowFailure: true }).stdout.trim() ||
		null
	);
}

describe("pull follow-ups", () => {
	it("refuses to adopt a peer's tracked entry without consent and lists its ignored files", () => {
		ignoredFiles("private");
		track("private");
		const head = spaceGit(root, ["rev-parse", "HEAD"]).stdout;
		const refused = run("pull");
		expect(refused.status, flat(refused.stderr)).toBe(2);
		expect(flat(refused.stderr)).toContain(
			'"private": 3 local files would become eligible for commit',
		);
		expect(flat(refused.stderr)).toContain("--accept-tracked");
		expect(spaceGit(root, ["rev-parse", "HEAD"]).stdout).toBe(head);
		expect(config("hyper.tracked")).toBe(null);
		const accepted = run("pull", "--accept-tracked", "--json");
		expect(accepted.status, flat(accepted.stderr)).toBe(0);
		expect(JSON.parse(accepted.stdout).addedTracked).toEqual([{ path: "private", localFiles: 3 }]);
		expect(spaceGit(root, ["config", "--get-all", "hyper.tracked"]).stdout.trim()).toBe("private");
	});
	it("shows a peer's executable and instruction files after a successful pull", () => {
		peerFile(".claude/hooks/session.sh", "#!/bin/sh\n");
		peerFile("bin/tool", "x\n");
		peerFile("CLAUDE.md", "obey\n");
		peerFile("notes/safe.md");
		publish();
		const result = run("pull");
		expect(result.status, flat(result.stderr)).toBe(0);
		expect(result.stdout).toContain("These can run commands or instruct agents; review them:");
		expect(result.stdout).toContain(".claude/hooks/session.sh");
		expect(result.stdout).not.toContain("notes/safe.md");
	});
	it("keeps local tracked entries and re-renders the allowlist when the incoming lacks them", () => {
		spaceGit(root, ["config", "--add", "hyper.tracked", "local-only"]);
		ignoredFiles("local-only");
		track("extra");
		const result = run("pull", "--accept-tracked");
		expect(result.status, flat(result.stderr)).toBe(0);
		expect(
			spaceGit(root, ["config", "--get-all", "hyper.tracked"]).stdout.trim().split("\n"),
		).toEqual(["extra", "local-only"]);
		expect(readFileSync(join(root, ".gitignore"), "utf8")).toBe(
			renderGitignore(["extra", "local-only"]),
		);
		expect(spaceGit(root, ["status", "--porcelain"]).stdout).toContain(".gitignore");
		expect(result.stdout).toContain("local modification");
	});
	it("reports a refused tip through status until the tracking ref moves", () => {
		peerFile("loose.txt", "hostile\n");
		publish();
		expect(run("pull").status).toBe(2);
		expect(config("hyper.refusedTip")).toBe(
			git(["rev-parse", "origin/space/followups"], peer).trim(),
		);
		const text = run("status");
		expect(text.status, flat(text.stderr)).toBe(0);
		expect(text.stdout).toContain(
			"behind 1: the newest commit on the hyperdrive was refused by the last pull",
		);
		expect(text.stdout).toContain("loose.txt");
		expect(JSON.parse(run("status", "--json").stdout).refused).toMatchObject({
			reason: expect.stringContaining("loose.txt"),
		});
	});
	it("clears the refusal once the remote tip changes", () => {
		peerFile("loose.txt", "hostile\n");
		publish();
		expect(run("pull").status).toBe(2);
		git(["rm", "-q", "loose.txt"], peer);
		publish();
		expect(run("status", "--fetch", "--json").status).toBe(0);
		expect(JSON.parse(run("status", "--json").stdout).refused).toBeNull();
		expect(config("hyper.refusedTip")).not.toBe(
			git(["rev-parse", "origin/space/followups"], peer).trim(),
		);
	});
	it("validates a large long history bounded by the tip tree", () => {
		for (let round = 0; round < 30; round++) {
			for (let index = 0; index < 20; index++) peerFile(`notes/bulk/${round}-${index}.md`);
			git(["commit", "-qm", `bulk ${round}`], peer);
			git(["push", "-q", "origin", "HEAD"], peer);
		}
		peerFile("loose.txt", "hostile\n");
		publish();
		const started = Date.now();
		expect(run("pull").status).toBe(2);
		expect(Date.now() - started).toBeLessThan(60_000);
	}, 120_000);
	it("reports control characters in status paths as escapes", () => {
		const path = "notes/we\u0007ird\u001b[31m.md";
		mkdirSync(join(root, "notes"), { recursive: true });
		writeFileSync(join(root, path), "x\n");
		const result = run("status");
		expect(result.status, flat(result.stderr)).toBe(0);
		expect(result.stdout).toContain('"notes/we\\u0007ird\\u001b[31m.md"');
		expect(result.stdout).not.toContain("\u001b[31m.md");
	});
	it("escapes a hostile filename in pull's refusal text", () => {
		const path = "loose\u0007.txt";
		peerFile(path, "hostile\n");
		publish();
		const result = run("pull");
		expect(result.status).toBe(2);
		expect(result.stderr).not.toContain("\u0007");
		expect(result.stderr).toContain("\\u0007");
	});
	it("names a C1 or DEL path in pull's refusal escaped, never raw", () => {
		// JSON.stringify escapes C0 only: U+009B and DEL used to reach stderr as
		// themselves inside the very refusal that named them.
		for (const [path, escaped] of [
			["bin/b\u009b2Jx", '"bin/b\\u009b2Jx"'],
			["bin/c\u007f", '"bin/c\\u007f"'],
		]) {
			peerFile(path, "#!/bin/sh\n");
			publish();
			const result = run("pull");
			expect(result.status, path).toBe(2);
			for (const stream of [result.stdout, result.stderr])
				expect(/[\p{Cc}\p{Cf}]/u.test(stream.replace(/[\n\t]/g, "")), path).toBe(false);
			expect(flat(result.stderr), path).toContain(escaped);
			git(["rm", "-q", "--", path], peer);
			publish();
		}
	});
	it("prints a bidi review path escaped in text and raw in --json", () => {
		// The spoof the warning exists to catch: `bin/run<RLO>hs.txt` displays as
		// `bin/runtxt.sh` when printed raw.
		const path = "bin/run‮hs.txt";
		peerFile(path, "#!/bin/sh\n");
		publish();
		const text = run("pull");
		expect(text.status, flat(text.stderr)).toBe(0);
		for (const stream of [text.stdout, text.stderr]) expect(stream).not.toContain("‮");
		expect(text.stdout).toContain('"bin/run\\u202ehs.txt"');
		// The next change, read as JSON: the raw name, recoverable.
		peerFile("bin/other‮txt.sh", "#!/bin/sh\n");
		publish();
		const json = run("pull", "--json");
		expect(json.status, flat(json.stderr)).toBe(0);
		expect(JSON.parse(json.stdout).reviewPaths).toEqual(["bin/other‮txt.sh"]);
	});
	it("ranks settings, hooks and executables first in pull's bounded report", () => {
		for (let index = 1; index <= 25; index += 1)
			peerFile(`.claude/commands/a${String(index).padStart(2, "0")}.md`, "obey\n");
		peerFile(".claude/settings.json", "{}\n");
		peerFile(".hyper/hooks.sh", "#!/bin/sh\n");
		peerFile("bin/payload", "#!/bin/sh\n");
		chmodSync(join(peer, "bin", "payload"), 0o755);
		git(["add", "-f", "--", "bin/payload"], peer);
		publish();
		const before = spaceGit(root, ["rev-parse", "HEAD"]).stdout.trim();
		const text = run("pull");
		expect(text.status, flat(text.stderr)).toBe(0);
		const shown = text.stdout
			.split("\n")
			.filter((line) => line.startsWith('  "'))
			.map((line) => line.trim().slice(1, -1));
		expect(shown).toHaveLength(20);
		expect(shown.slice(0, 3)).toEqual([".claude/settings.json", ".hyper/hooks.sh", "bin/payload"]);
		expect(text.stdout).toContain(
			"  … and 8 more: 8 instruction files; run with --json to see them all",
		);
		// The same change as JSON: complete and in its plain sorted order.
		spaceGit(root, ["reset", "-q", "--hard", before]);
		const json = run("pull", "--json");
		expect(json.status, flat(json.stderr)).toBe(0);
		const listed: string[] = JSON.parse(json.stdout).reviewPaths;
		expect(listed).toHaveLength(28);
		expect(listed).toEqual([...listed].sort());
		expect(JSON.parse(json.stdout)).not.toHaveProperty("reviewFacts");
	});
	it("prints status paths escaped in text and raw in --json", () => {
		const path = "notes/bidi‮\\u202e.md";
		mkdirSync(join(root, "notes"), { recursive: true });
		writeFileSync(join(root, path), "x\n");
		const text = run("status");
		expect(text.status, flat(text.stderr)).toBe(0);
		expect(text.stdout).not.toContain("‮");
		// The real U+202E and the literal backslash-u text print differently.
		expect(text.stdout).toContain('"notes/bidi\\u202e\\\\u202e.md"');
		const json = run("status", "--json");
		expect(json.status, flat(json.stderr)).toBe(0);
		const paths = JSON.parse(json.stdout).status.map((entry: { path: string }) => entry.path);
		expect(paths).toContain(path);
	});
	it("refuses a symlink whose target is an ancestor of reserved metadata", () => {
		symlinkSync("../.hyper", join(peer, "notes", "up"));
		publish();
		expect(run("pull").status).toBe(2);
		expect(flat(run("pull").stderr)).toContain("notes/up");
	});
	it("reports untracked files git would lose as a local-overwrite refusal", () => {
		peerFile("notes/new.md", "incoming\n");
		publish();
		writeFileSync(join(root, "notes", "new.md"), "mine\n");
		const result = run("pull");
		expect(result.status, flat(result.stderr)).toBe(2);
		expect(flat(result.stderr)).toContain("would be overwritten by the fast-forward");
		expect(readFileSync(join(root, "notes", "new.md"), "utf8")).toBe("mine\n");
	});
	it("tells a refresh refusal to pull, and a first init to change the name", () => {
		const sha = git(["rev-parse", "HEAD"], peer).trim();
		const tree = git(["rev-parse", "HEAD^{tree}"], peer).trim();
		const other = git(["commit-tree", tree, "-m", "another machine"], peer).trim();
		git(["push", "-q", "origin", `+${other}:refs/heads/space/followups`], peer);
		const refreshed = spawnCli(
			["space", "init", root, "--refresh", "--cadence", "manual"],
			fixture,
		);
		expect(refreshed.status).toBe(2);
		expect(flat(refreshed.stderr)).toContain("hyper space pull");
		expect(sha).not.toBe(other);
	});
	it("does not claim a rename for a daily push ref conflict", () => {
		const sha = git(["rev-parse", "HEAD"], peer).trim();
		git(
			["--git-dir", fixture.remote, "update-ref", "-d", "refs/heads/space/followups"],
			fixture.root,
		);
		git(
			["--git-dir", fixture.remote, "update-ref", "refs/heads/space/followups/child", sha],
			fixture.root,
		);
		const result = run("push");
		expect(result.status).toBe(2);
		expect(flat(result.stderr)).toContain("no space rename command");
		expect(flat(result.stderr)).not.toContain("--name");
	});
	it("answers each refusal kind with its own reason slug", () => {
		ignoredFiles("private");
		track("private");
		const consent = run("pull", "--json");
		expect(consent.status).toBe(2);
		expect(JSON.parse(consent.stdout)).toMatchObject({ ok: false, reason: "consent-required" });

		spaceGit(root, ["config", "remote.origin.url", join(fixture.root, "gone.git")]);
		expect(JSON.parse(run("pull", "--json").stdout)).toMatchObject({ reason: "unreachable" });

		spaceGit(root, ["config", "remote.origin.url", fixture.remote]);
		peerFile("loose.txt", "hostile\n");
		publish();
		expect(JSON.parse(run("pull", "--json").stdout)).toMatchObject({
			reason: "incoming-history-refused",
		});

		git(
			["--git-dir", fixture.remote, "update-ref", "-d", "refs/heads/space/followups"],
			fixture.root,
		);
		spaceGit(root, ["update-ref", "-d", "refs/remotes/origin/space/followups"]);
		const sha = git(["rev-parse", "HEAD"], peer).trim();
		const tree = git(["rev-parse", "HEAD^{tree}"], peer).trim();
		const other = git(["commit-tree", tree, "-m", "divergent"], peer).trim();
		git(["push", "-q", "origin", `+${other}:refs/heads/space/followups`], peer);
		expect(sha).not.toBe(other);
		expect(JSON.parse(run("pull", "--json").stdout)).toMatchObject({ reason: "diverged" });
	});
	it("reports ok true on a successful json pull", () => {
		peerFile("notes/new.md", "incoming\n");
		publish();
		const result = run("pull", "--json");
		expect(result.status, flat(result.stderr)).toBe(0);
		expect(JSON.parse(result.stdout)).toMatchObject({ ok: true, updated: true });
	});
	it("reports local-changes when a fast-forward would overwrite local work", () => {
		peerFile("notes/clash.md", "incoming\n");
		publish();
		writeFileSync(join(root, "notes", "clash.md"), "mine\n");
		const result = run("pull", "--json");
		expect(result.status).toBe(2);
		expect(JSON.parse(result.stdout)).toMatchObject({ reason: "local-changes" });
	});
	it("keeps the refusal recorded when the hyperdrive cannot be reached", () => {
		peerFile("loose.txt", "hostile\n");
		publish();
		expect(run("pull").status).toBe(2);
		spaceGit(root, ["config", "remote.origin.url", join(fixture.root, "gone.git")]);
		const unreachable = run("pull");
		expect(unreachable.status).toBe(2);
		expect(config("hyper.refusedTip")).toBe(
			git(["rev-parse", "origin/space/followups"], peer).trim(),
		);
		expect(JSON.parse(run("status", "--json").stdout).refused).toMatchObject({
			reason: expect.stringContaining("loose.txt"),
		});
	});
	it("answers a refusal with JSON when --json is set", () => {
		peerFile("loose.txt", "hostile\n");
		publish();
		const refused = run("pull", "--json");
		expect(refused.status).toBe(2);
		expect(JSON.parse(refused.stdout)).toMatchObject({
			ok: false,
			reason: "incoming-history-refused",
			message: expect.stringContaining("loose.txt"),
		});
	});
	it("names hyper space commit when a kept tracked entry blocks the next pull", () => {
		spaceGit(root, ["config", "--add", "hyper.tracked", "local-only"]);
		ignoredFiles("local-only");
		track("extra");
		expect(run("pull", "--accept-tracked").status).toBe(0);
		writeFileSync(join(peer, "notes", "a.md"), "remote moved on\n");
		publish();
		const blocked = run("pull", "--accept-tracked");
		expect(blocked.status, flat(blocked.stderr)).toBe(2);
		expect(flat(blocked.stderr)).toContain("hyper space commit");
	});
	it("keeps the refused tip out of local history but still reports behind", () => {
		peerFile("loose.txt", "hostile\n");
		publish();
		expect(run("pull").status).toBe(2);
		expect(existsSync(join(root, "loose.txt"))).toBe(false);
		expect(spaceGit(root, ["rev-list", "--count", "HEAD"]).stdout.trim()).toBe("1");
	});
});
