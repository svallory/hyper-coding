import { spawn, spawnSync } from "node:child_process";
import {
	chmodSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SpaceEntry } from "#config/schema";
import { renderGitignore } from "#services/allowlist";
import { driveCheckoutDir, readManifest, upsertSpace } from "#services/manifest";
import { shellQuote } from "#services/remote";
import { cloneSpace, cloneTargetPath } from "#services/space-clone";
import { REVIEW_PATHS_SHOWN, readCadence, readTracked, spaceGit } from "#services/space-git";
import {
	flat,
	git,
	type ManifestFixture,
	skipWithoutScript,
	spawnCli,
	spawnCliOnTty,
	withManifestFixture,
} from "#tests/tmp-manifest";
import { makeCheckout } from "#tests/tmp-space";

let fixture: ManifestFixture;
const cli = join(import.meta.dirname, "..", "..", "cli", "bin", "run.js");

function useMachine(label: string): void {
	fixture.home = join(fixture.root, label, "home");
	fixture.hyperHome = join(fixture.home, ".hyper");
	fixture.configFile = join(fixture.home, ".config", "hyper", "drive.toml");
	mkdirSync(dirname(fixture.configFile), { recursive: true });
	writeFileSync(
		fixture.configFile,
		`remote = ${JSON.stringify(fixture.remote)}\n[defaults]\ncadence = "manual"\n`,
	);
	for (const [key, value] of Object.entries({
		HOME: fixture.home,
		HYPER_HOME: fixture.hyperHome,
		HYPER_DRIVE_CONFIG: fixture.configFile,
		XDG_CONFIG_HOME: join(fixture.home, ".config"),
		XDG_DATA_HOME: join(fixture.home, ".local", "share"),
		ZDOTDIR: fixture.home,
		WORKTRUNK_CONFIG_PATH: join(fixture.home, ".config", "worktrunk", "config.toml"),
		WORKTRUNK_SYSTEM_CONFIG_PATH: join(fixture.home, "no-system-wt.toml"),
		CLAUDE_CONFIG_DIR: join(fixture.home, ".claude"),
		GIT_CONFIG_GLOBAL: join(fixture.home, ".gitconfig"),
		GIT_CONFIG_NOSYSTEM: "1",
		GIT_AUTHOR_NAME: "clone test",
		GIT_AUTHOR_EMAIL: "clone@example.invalid",
		GIT_COMMITTER_NAME: "clone test",
		GIT_COMMITTER_EMAIL: "clone@example.invalid",
	}))
		vi.stubEnv(key, value);
	vi.stubEnv("WORKTRUNK_WORKTREE_PATH", undefined);
	vi.stubEnv("WORKTRUNK_PROJECT_CONFIG_PATH", undefined);
	writeFileSync(
		process.env.GIT_CONFIG_GLOBAL!,
		"[init]\n defaultBranch = main\n[gc]\n auto = 0\n[commit]\n gpgsign = false\n",
	);
}

beforeEach(() => {
	fixture = withManifestFixture();
	useMachine("first");
});
afterEach(() => {
	vi.unstubAllEnvs();
	fixture.cleanup();
});

function run(args: string[]): ReturnType<typeof spawnCli> {
	return spawnCli(["space", "clone", ...args], fixture);
}
function success(result: ReturnType<typeof spawnCli>): void {
	expect(result.status, `${flat(result.stdout)} | ${flat(result.stderr)}`).toBe(0);
}

/** Real init + local project remotes, never a hand-authored replacement for init. */
function seed(layout: "bare" | "multi" = "bare", marker = true): string {
	const source = join(fixture.root, "source");
	mkdirSync(source);
	const slugs = layout === "bare" ? ["project"] : ["alpha", "beta"];
	for (const slug of slugs) {
		const project = join(fixture.root, `${slug}-remote`);
		makeCheckout(project);
		const repoRoot = layout === "bare" ? source : join(source, "code", slug);
		mkdirSync(repoRoot, { recursive: true });
		git(["clone", "--bare", project, join(repoRoot, ".git")], fixture.root);
		mkdirSync(join(repoRoot, "worktrees"));
	}
	if (marker || layout === "multi")
		writeFileSync(join(source, "HYPER.md"), "# Custom instructions — keep byte-for-byte\n");
	for (const path of [
		// Unicode and combining marks stay covered; a literal newline does NOT,
		// because incoming names with control characters are now refused (see
		// the round-3 note in the report: that is a behaviour change to ratify).
		"notes/café/line‍break.md",
		"data/test.json",
		"extra/read me.md",
		".hyper/memory/MEMORY.md",
		".config/wt.toml",
	]) {
		mkdirSync(dirname(join(source, path)), { recursive: true });
		writeFileSync(join(source, path), `# tracked ${path}\n`);
	}
	for (const path of ["scratch/untracked", "loose.txt", ".env", ".claude/settings.local.json"]) {
		mkdirSync(dirname(join(source, path)), { recursive: true });
		writeFileSync(join(source, path), "not backed up\n");
	}
	success(
		spawnCli(
			[
				"space",
				"init",
				source,
				"--name",
				"sample",
				"--group",
				"team",
				"--cadence",
				"session-end+push",
				"--tracked",
				"extra",
				"--tracked",
				".config",
				"--json",
			],
			fixture,
		),
	);
	return source;
}

function updateEntry(change: Partial<SpaceEntry>): void {
	const entry = readManifest().spaces[0];
	upsertSpace({ ...entry, ...change });
}
/** The project's bare repo HEAD, not the space's branch. */
function projectHead(target: string): string {
	return git(["--git-dir", join(target, ".git"), "symbolic-ref", "--short", "HEAD"], target).trim();
}

/** Config the clone wrote into the PROJECT repo, not the space's git dir. */
function projectConfig(target: string, key: string): string {
	return git(["--git-dir", join(target, ".git"), "config", "--get", key], target).trim();
}

function publishChange(source: string, path: string, contents: string): void {
	writeFileSync(join(source, path), contents);
	spaceGit(source, ["add", "-f", "--", path]);
	spaceGit(source, ["commit", "-m", "fixture update"]);
	spaceGit(source, ["push", "origin", "HEAD"]);
}

describe("untrusted clone branch", () => {
	it.each([
		"HYPER.md",
		"CLAUDE.md",
		"AGENTS.md",
		"notes/nested/HYPER.md",
		"extra/CLAUDE.md",
		"data/AGENTS.md",
		".claude/commands/review.md",
		".config/tool.json",
		"bin/run.sh",
	])("warns on every instruction or configuration path: %s", (path) => {
		const source = seed();
		mkdirSync(dirname(join(source, path)), { recursive: true });
		publishChange(source, path, "review before use\n");
		useMachine("second");
		const target = join(fixture.home, "destination");
		const result = run(["sample", target, "--json"]);
		success(result);
		expect(JSON.parse(result.stdout).untrustedConfiguration).toContain(path);
	});
	it("also names .hyper/memory, which the generated HYPER.md tells agents to read", () => {
		seed();
		useMachine("second");
		const target = join(fixture.home, "destination");
		const result = run(["sample", target, "--json"]);
		success(result);
		const warned: string[] = JSON.parse(result.stdout).untrustedConfiguration;
		expect(warned).toContain(".hyper/memory/MEMORY.md");
		expect(readFileSync(join(target, ".hyper", "memory", "MEMORY.md"), "utf8")).toContain(
			"tracked",
		);
	});
	it("keeps .claude/memory in the warning list too", () => {
		const source = seed();
		mkdirSync(join(source, ".claude", "memory"), { recursive: true });
		publishChange(source, ".claude/memory/note.md", "memory\n");
		useMachine("second");
		const target = join(fixture.home, "destination");
		const result = run(["sample", target, "--json"]);
		success(result);
		expect(JSON.parse(result.stdout).untrustedConfiguration).toContain(".claude/memory/note.md");
	});
	it("names worktrunk configuration, a nested CLAUDE.local.md and an executable outside bin/", () => {
		const source = seed();
		for (const path of ["notes/sub/CLAUDE.local.md", "data/tool.sh"]) {
			mkdirSync(dirname(join(source, path)), { recursive: true });
			writeFileSync(join(source, path), "review me\n");
		}
		chmodSync(join(source, "data/tool.sh"), 0o755);
		publishChange(source, "notes/sub/CLAUDE.local.md", "review me\n");
		publishChange(source, "data/tool.sh", "review me\n");
		useMachine("second");
		const result = run(["sample", join(fixture.home, "destination"), "--json"]);
		success(result);
		const warned: string[] = JSON.parse(result.stdout).untrustedConfiguration;
		expect(warned).toContain(".config/wt.toml");
		expect(warned).toContain("notes/sub/CLAUDE.local.md");
		// Executable outside bin/ can run when an agent reaches for it.
		expect(warned).toContain("data/tool.sh");
	});
	it("names a change hiding behind a directory symlink", () => {
		const source = seed();
		mkdirSync(join(source, "notes", "cmds"), { recursive: true });
		writeFileSync(join(source, "notes", "cmds", "one.md"), "# command\n");
		symlinkSync("../notes/cmds", join(source, ".claude", "commands"));
		publishChange(source, "notes/cmds/one.md", "# command\n");
		// Stage the link itself: writing through it would land in notes/cmds.
		spaceGit(source, ["add", "-f", "--", ".claude/commands"]);
		spaceGit(source, ["commit", "-m", "link published"]);
		spaceGit(source, ["push", "origin", "HEAD"]);
		useMachine("second");
		const result = run(["sample", join(fixture.home, "destination"), "--json"]);
		success(result);
		const warned: string[] = JSON.parse(result.stdout).untrustedConfiguration;
		expect(warned).toContain(".claude/commands");
		expect(warned).toContain("notes/cmds/one.md");
	});
	it("stages into the space's own git dir, never at .hyper/clone-*", () => {
		seed();
		useMachine("second");
		const target = join(fixture.home, "destination");
		const real = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
		const shim = join(fixture.root, "staging-shim");
		mkdirSync(shim);
		const seen = join(fixture.root, "work-trees.txt");
		writeFileSync(
			join(shim, "git"),
			`#!/bin/sh\ncase "$*" in *--work-tree*) printf '%s\\n' "$*" >> ${shellQuote(seen)};; esac\nexec ${shellQuote(real)} "$@"\n`,
			{ mode: 0o755 },
		);
		vi.stubEnv("PATH", `${shim}:${process.env.PATH}`);
		success(run(["sample", target, "--json"]));
		expect(readFileSync(seen, "utf8")).toContain(join(".hyper", "space.git", "clone-"));
		expect(readdirSync(join(target, ".hyper")).filter((name) => name.startsWith("clone-"))).toEqual(
			[],
		);
	});
	it("commits a .hyper/clone-* directory like any other space file", () => {
		// The exclusion was removed: new clones never stage there, and the glob
		// silently hid real files (a plan in .hyper/clone-notes/) with no warning.
		const source = seed();
		mkdirSync(join(source, ".hyper", "clone-notes"), { recursive: true });
		writeFileSync(join(source, ".hyper", "clone-notes", "plan.md"), "real work\n");
		const commit = spawnSync(process.execPath, [cli, "space", "commit", "-m", "with notes"], {
			cwd: source,
			encoding: "utf8",
			env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
		});
		expect(commit.status, flat(commit.stderr)).toBe(0);
		expect(spaceGit(source, ["show", "--name-only", "--format=", "HEAD"]).stdout).toContain(
			".hyper/clone-notes/plan.md",
		);
	});
	// Concatenated so the linter does not read the shell substitution below as
	// a template placeholder; it is a branch name a hostile remote could pick.
	// A 501-character name is absent on purpose: Git itself cannot create such
	// a ref (the filesystem rejects the name), so it can never be a remote HEAD.
	it.each([`evil$(touch${"$"}{IFS}x)`, "x;id", "it's", `-x`])(
		"refuses a hostile HEAD branch name %s instead of storing it",
		(hostile) => {
			const source = seed();
			// Real git: `update-ref` writes the ref with no option parsing, so
			// even a name starting with a dash really exists on the remote.
			git(["update-ref", `refs/heads/${hostile}`, "HEAD"], source);
			git(["symbolic-ref", "HEAD", `refs/heads/${hostile}`], join(fixture.root, "project-remote"));
			const entry = readManifest().spaces[0];
			updateEntry({ repos: [{ ...entry.repos[0], default_branch: "develop" }] });
			useMachine("second");
			const target = join(fixture.home, "destination");
			const response = run(["sample", target]);
			expect(response.status, `${hostile}: ${flat(response.stderr)}`).toBe(2);
			expect(existsSync(target), hostile).toBe(false);
		},
	);
	it("says an empty project repository has no commits", () => {
		seed();
		const empty = join(fixture.root, "empty-project.git");
		git(["init", "-q", "--bare", empty], fixture.root);
		const entry = readManifest().spaces[0];
		updateEntry({ repos: [{ ...entry.repos[0], url: empty, default_branch: "main" }] });
		useMachine("second");
		const target = join(fixture.home, "destination");
		const response = run(["sample", target]);
		expect(response.status).toBe(2);
		expect(flat(response.stderr)).toContain("no commits yet");
		expect(existsSync(target)).toBe(false);
	});
	it.each([
		["C1 CSI", "https://host.invalid/a\u009b[31mESCURL"],
		["bidi override", "https://host.invalid/a\u202egnp"],
		["DEL", "https://host.invalid/a\u007fb"],
		["ESC", "https://host.invalid/a\u001b]0;TITLE\u001b\\b"],
	])("refuses a url with %s and prints none of it raw", (name, hostile) => {
		seed();
		const entry = readManifest().spaces[0];
		updateEntry({ repos: [{ ...entry.repos[0], url: hostile }] });
		useMachine("second");
		const response = run(["sample", join(fixture.home, "destination")]);
		expect(response.status, name).toBe(2);
		// Both streams, and as raw bytes: `JSON.stringify` escapes C0 only, so
		// U+009B, U+202E and DEL used to be echoed verbatim.
		for (const stream of [response.stdout, response.stderr]) {
			expect(/[\p{Cc}\p{Cf}]/u.test(stream.replace(/[\n\t]/g, "")), name).toBe(false);
		}
		expect(flat(response.stderr), name).toContain("repos[0].url");
	});
	it("escapes an unknown manifest key instead of printing it raw", () => {
		seed();
		// An unknown key is manifest data: it runs through `warnUnknown`, which
		// both `space list` and `space clone` reach. It has to reach the other
		// machine through the drive remote, not by editing a local checkout.
		const checkout = driveCheckoutDir();
		const manifest = join(checkout, "spaces.yaml");
		writeFileSync(manifest, `${readFileSync(manifest, "utf8")}evil\u001b[]0;PWNED\u0007key: 1\n`);
		git(["add", "spaces.yaml"], checkout);
		git(["commit", "-qm", "unknown key"], checkout);
		git(["push", "origin", "HEAD:main"], checkout);
		useMachine("second");
		for (const args of [
			["space", "clone", "sample", join(fixture.home, "destination")],
			["space", "list"],
		]) {
			// ONE spawn: two would clone into the same target twice and mix streams.
			const response = spawnCli(args, fixture);
			const stream = flat(response.stdout + response.stderr);
			expect(stream, args.join(" ")).toContain("unknown key");
			expect(stream, args.join(" ")).not.toContain("evil\u001b[]0;PWNED\u0007key");
			expect(/[\p{Cc}\p{Cf}]/u.test(stream.replace(/[\n\t]/g, "")), args.join(" ")).toBe(false);
		}
	});
	it("refuses an incoming path containing a control character", () => {
		seed();
		const peer = join(fixture.root, "names-peer");
		git(
			["clone", "--single-branch", "--branch", "space/team/sample", fixture.remote, peer],
			fixture.root,
		);
		mkdirSync(join(peer, "bin"), { recursive: true });
		// The filename-spoofing trick, inside the tree we are about to warn about.
		writeFileSync(join(peer, "bin", "a\u009b[2Jgnp.sh"), "#!/bin/sh\ntouch pwned\n");
		git(["add", "-f", "bin"], peer);
		git(["commit", "-qm", "hostile name"], peer);
		git(["push", "origin", "HEAD"], peer);
		useMachine("second");
		const target = join(fixture.home, "destination");
		const response = run(["sample", target]);
		expect(response.status).toBe(2);
		expect(flat(response.stderr)).toContain("control character");
		// The refusal names the path and must not print it raw: as raw bytes,
		// no ESC, no DEL, no C1 (the CSI used to clear the very line naming it).
		for (const stream of [response.stdout, response.stderr])
			expect(
				/[\p{Cc}\p{Cf}]/u.test(stream.replace(/[\n\t]/g, "")),
				"raw control or format character",
			).toBe(false);
		expect(flat(response.stderr)).toContain('"bin/a\\u009b[2Jgnp.sh"');
		expect(existsSync(target)).toBe(false);
	});
	it("keeps an incoming format-character name but always prints it escaped", () => {
		seed();
		const peer = join(fixture.root, "bidi-peer");
		git(
			["clone", "--single-branch", "--branch", "space/team/sample", fixture.remote, peer],
			fixture.root,
		);
		mkdirSync(join(peer, "bin"), { recursive: true });
		writeFileSync(join(peer, "bin", "safe\u202egnp.sh"), "#!/bin/sh\n");
		git(["add", "-f", "bin"], peer);
		git(["commit", "-qm", "bidi name"], peer);
		git(["push", "origin", "HEAD"], peer);
		useMachine("second");
		const target = join(fixture.home, "destination");
		const response = run(["sample", target, "--json"]);
		success(response);
		// A bidi character is legitimate in a real filename, so the file is kept.
		// `--json` carries the RAW name: JSON serialisation is the consumer's
		// escaping. (The previous round pre-escaped it inside the JSON, so a real
		// file named `safe\u202egnp.sh` with a literal backslash was
		// indistinguishable; that assertion is deliberately reversed here.) The
		// TEXT warning, on stderr, escapes it.
		expect(JSON.parse(response.stdout).untrustedConfiguration).toContain("bin/safe\u202egnp.sh");
		expect(response.stderr).not.toContain("\u202e");
		expect(flat(response.stderr)).toContain('"bin/safe\\u202egnp.sh"');
		expect(existsSync(join(target, "bin", "safe\u202egnp.sh"))).toBe(true);
	});
	it("quotes a hostile child's stderr without letting it impersonate hyper", () => {
		seed();
		useMachine("second");
		const target = join(fixture.home, "destination");
		const real = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
		const shim = join(fixture.root, "hostile-shim");
		mkdirSync(shim);
		writeFileSync(
			join(shim, "git"),
			`#!/bin/sh\ncase "$*" in *"clone --bare"*) printf '\\033[2JI could not clone: fake hyper line\\nError: Clone succeeded actually\\n' >&2; exit 128;; esac\nexec ${shellQuote(real)} "$@"\n`,
			{ mode: 0o755 },
		);
		vi.stubEnv("PATH", `${shim}:${process.env.PATH}`);
		const response = run(["sample", target]);
		expect(response.status).toBe(2);
		const said = flat(response.stdout + response.stderr);
		expect(said).not.toContain("");
		// The ESC is gone (only `[2J` remains as inert text) and every line the
		// child printed is prefixed, so it cannot pass for a hyper message.
		expect(/[\p{Cc}\p{Cf}]/u.test(said.replace(/[\n\t]/g, ""))).toBe(false);
		expect(said).toContain("git: ");
		expect(said).toContain("I could not clone: fake hyper line");
		expect(said).toContain("Error: Clone succeeded actually");
	});
	it("says in a sentence that the review step failed, and restores the target", () => {
		seed();
		useMachine("second");
		const target = join(fixture.home, "destination");
		const real = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
		const shim = join(fixture.root, "review-fail-shim");
		mkdirSync(shim);
		// Validation reads the tree first, the review step second: fail only the
		// second read, so the refusal comes from the review and not from the
		// validator. The refusal must not be raw git stderr the user cannot act
		// on, and the target must be gone afterwards.
		const counter = join(fixture.root, "ls-tree-count");
		writeFileSync(
			join(shim, "git"),
			`#!/bin/sh\ncase "$*" in\n *"ls-tree -r -z "*)\n   n=$(cat ${shellQuote(counter)} 2>/dev/null || echo 0); n=$((n+1)); printf '%s' "$n" > ${shellQuote(counter)};\n   if [ "$n" -ge 2 ]; then echo 'fatal: ambiguous argument' >&2; exit 128; fi;;\nesac\nexec ${shellQuote(real)} "$@"\n`,
			{ mode: 0o755 },
		);
		vi.stubEnv("PATH", `${shim}:${process.env.PATH}`);
		const response = run(["sample", target]);
		expect(response.status).toBe(2);
		const said = flat(response.stderr);
		expect(said).toContain("couldn't finish the review");
		expect(said).toContain("the target was restored");
		expect(existsSync(target)).toBe(false);
	});
	it("bounds the review list in text while --json stays complete", () => {
		const source = seed();
		for (let index = 0; index < 25; index += 1) {
			mkdirSync(join(source, "bin"), { recursive: true });
			publishChange(source, `bin/tool-${index}.sh`, "#!/bin/sh\n");
		}
		useMachine("second");
		// `--json` first: it is the complete list, so the text run can be
		// checked against it rather than against an assumed order.
		const jsonTarget = join(fixture.home, "destination-2");
		const json = run(["sample", jsonTarget, "--json"]);
		success(json);
		const listed: string[] = JSON.parse(json.stdout).untrustedConfiguration;
		expect(listed.length).toBeGreaterThan(25);
		expect(listed).toContain("bin/tool-24.sh");

		const text = run(["sample", join(fixture.home, "destination")]);
		success(text);
		const line =
			flat(text.stderr)
				.split("\n")
				.find((value) => value.includes("came from the hyperdrive")) ?? "";
		// The list is sorted, so which names land past the limit is not something
		// this test should assume. What matters: exactly REVIEW_PATHS_SHOWN of
		// them are named, and the rest are counted, not silently dropped.
		const named = (line.match(/"[^"]+"/g) ?? [])
			.map((quoted) => JSON.parse(quoted))
			.filter((name) => listed.includes(name));
		expect(named).toHaveLength(REVIEW_PATHS_SHOWN);
		expect(line).toContain(`${listed.length - REVIEW_PATHS_SHOWN} more`);
		expect(line).toContain("--json");
	});
	it("never prints a project url's query values", () => {
		seed();
		const entry = readManifest().spaces[0];
		const token = "SECRETTOKENVALUE";
		updateEntry({
			repos: [{ ...entry.repos[0], url: `https://host.invalid/x?token=${token}` }],
		});
		useMachine("second");
		const target = join(fixture.home, "destination");
		const real = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
		const shim = join(fixture.root, "token-shim");
		mkdirSync(shim);
		writeFileSync(
			join(shim, "git"),
			`#!/bin/sh\ncase "$*" in *"clone --bare"*) echo "fatal: unable to access 'https://host.invalid/x?token=${token}/' (rejected)" >&2; exit 128;; esac\nexec ${shellQuote(real)} "$@"\n`,
			{ mode: 0o755 },
		);
		vi.stubEnv("PATH", `${shim}:${process.env.PATH}`);
		const response = run(["sample", target]);
		expect(response.status).toBe(2);
		expect(flat(response.stdout + response.stderr)).not.toContain(token);
	});
	it("falls back to the remote HEAD branch when the manifest's default branch is absent", () => {
		seed();
		const entry = readManifest().spaces[0];
		updateEntry({ repos: [{ ...entry.repos[0], default_branch: "gone-branch" }] });
		useMachine("second");
		const target = join(fixture.home, "destination");
		const result = run(["sample", target, "--json"]);
		success(result);
		const warnings: string = JSON.parse(result.stdout).warnings.join(" ");
		expect(warnings).toContain('"gone-branch"');
		expect(warnings).toContain('"main"');
		expect(projectHead(target)).toBe("main");
		expect(projectConfig(target, "worktrunk.default-branch")).toBe("main");
	});
	it("names both branches in the plain-text run too", () => {
		seed();
		const entry = readManifest().spaces[0];
		updateEntry({ repos: [{ ...entry.repos[0], default_branch: "gone-branch" }] });
		useMachine("second");
		const response = run(["sample", join(fixture.home, "destination")]);
		success(response);
		expect(flat(response.stderr)).toContain("gone-branch");
		expect(flat(response.stderr)).toContain("main");
	});
	it("keeps the happy path unchanged when the default branch exists", () => {
		seed();
		useMachine("second");
		const target = join(fixture.home, "destination");
		const result = run(["sample", target, "--json"]);
		success(result);
		expect(
			JSON.parse(result.stdout).warnings.filter((w: string) => w.includes("default branch")),
		).toEqual([]);
		expect(projectHead(target)).toBe("main");
	});
	it("fails with a clear reason and rolls back when the remote HEAD names no branch", () => {
		seed();
		// A bare repo with a commit on main, but HEAD detached at it.
		const project = join(fixture.root, "project-remote");
		git(["checkout", "-q", "--detach", "HEAD"], project);
		const entry = readManifest().spaces[0];
		updateEntry({ repos: [{ ...entry.repos[0], default_branch: "develop" }] });
		useMachine("second");
		const target = join(fixture.home, "destination");
		const response = run(["sample", target]);
		expect(response.status).toBe(2);
		expect(flat(response.stderr)).toContain("no usable HEAD");
		expect(flat(response.stderr)).toContain("develop");
		expect(existsSync(target)).toBe(false);
	});
	it("names the project and git's own reason when the clone fails off a TTY", () => {
		seed();
		const entry = readManifest().spaces[0];
		updateEntry({ repos: [{ ...entry.repos[0], url: join(fixture.root, "absent-project.git") }] });
		useMachine("second");
		const target = join(fixture.home, "destination");
		const response = run(["sample", target]);
		expect(response.status).toBe(2);
		expect(flat(response.stderr)).toContain("absent-project.git");
		expect(flat(response.stderr)).toContain("git: fatal:");
		expect(flat(response.stderr)).toContain("sample");
		expect(existsSync(target)).toBe(false);
	});
	it.each([
		"loose.txt",
		".hyper/space.git/config",
		".hyper/space.git/hooks/post-checkout",
		"notes/.GIT/config",
		"gitlink",
		".gitattributes",
		"notes/.gitmodules",
		"absolute-link",
		"escaping-link",
		"reserved-link",
		"absolute-notes",
		"marker-plus-wildcard",
		"reserved-tracked",
	])("refuses %s before any checkout and restores the target", (attack) => {
		seed();
		const peer = join(fixture.root, "hostile-peer");
		git(
			["clone", "--single-branch", "--branch", "space/team/sample", fixture.remote, peer],
			fixture.root,
		);
		let commit: string | undefined;
		if (attack === "notes/.GIT/config") {
			const makeTree = (input: string): string => {
				const result = spawnSync("git", ["mktree", "-z"], {
					cwd: peer,
					encoding: "utf8",
					env: process.env,
					input,
				});
				expect(result.status, result.stderr).toBe(0);
				return result.stdout.trim();
			};
			const blob = git(["rev-parse", "HEAD:.gitignore"], peer).trim();
			const configTree = makeTree(`100644 blob ${blob}\tconfig\0`);
			const nested = makeTree(`040000 tree ${configTree}\t.GIT\0`);
			const tree = makeTree(`100644 blob ${blob}\t.gitignore\0` + `040000 tree ${nested}\tnotes\0`);
			commit = git(["commit-tree", tree, "-p", "HEAD", "-m", "hostile tree"], peer).trim();
		} else if (attack === "gitlink") {
			const sha = git(["rev-parse", "HEAD"], peer).trim();
			git(["update-index", "--add", "--cacheinfo", `160000,${sha},notes/vendor`], peer);
		} else if (attack.endsWith("-link") || attack === "absolute-notes") {
			const path = attack === "absolute-notes" ? "notes" : "notes/link";
			if (attack === "absolute-notes") {
				git(["rm", "-r", "notes"], peer);
				rmSync(join(peer, "notes"), { recursive: true, force: true });
			}
			const link =
				attack === "escaping-link"
					? "../../outside"
					: attack === "reserved-link"
						? "../.hyper/space.git"
						: join(fixture.root, "outside");
			symlinkSync(link, join(peer, path));
			git(["add", "-f", "--", path], peer);
		} else {
			const path =
				attack === "marker-plus-wildcard" || attack === "reserved-tracked" ? ".gitignore" : attack;
			const contents =
				attack === "marker-plus-wildcard"
					? `${renderGitignore(["extra", ".config"])}!/**\n`
					: attack === "reserved-tracked"
						? `${renderGitignore(["extra", ".config"])}!/.hyper/space.git/\n!/.hyper/space.git/**\n`
						: "hostile data\n";
			mkdirSync(dirname(join(peer, path)), { recursive: true });
			writeFileSync(join(peer, path), contents);
			git(["add", "-f", "--", path], peer);
		}
		if (!commit) {
			git(["commit", "-qm", "hostile branch"], peer);
			commit = "HEAD";
		}
		git(["push", "origin", `${commit}:refs/heads/space/team/sample`], peer);
		useMachine("second");
		const target = join(fixture.home, "destination");
		const preexisting = attack.includes("link") || attack.includes("config");
		if (preexisting) mkdirSync(target);
		const real = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
		const shim = join(fixture.root, "checkout-guard");
		mkdirSync(shim);
		const marker = join(fixture.root, "checkout-ran");
		writeFileSync(
			join(shim, "git"),
			`#!/bin/sh\ncase "$*" in *space.git*checkout*) touch ${shellQuote(marker)}; exit 99;; esac\nexec ${shellQuote(real)} "$@"\n`,
			{ mode: 0o755 },
		);
		vi.stubEnv("PATH", `${shim}:${process.env.PATH}`);
		const result = run(["sample", target]);
		expect(result.status, flat(result.stderr)).toBe(2);
		expect(flat(result.stderr)).toContain("Clone refused before checkout");
		expect(existsSync(marker)).toBe(false);
		expect(existsSync(target)).toBe(preexisting);
		if (preexisting) expect(readdirSync(target)).toEqual([]);
	});
	it("trusts validated allowlist tracking instead of extra manifest claims", () => {
		seed();
		updateEntry({ tracked: ["extra", ".config", "unlisted"] });
		useMachine("second");
		const target = join(fixture.home, "destination");
		const result = run(["sample", target, "--json"]);
		success(result);
		expect(readTracked(target).sort()).toEqual([".config", "extra"]);
		expect(JSON.parse(result.stdout).warnings.join(" ")).toContain("not in the incoming allowlist");
	});
	it("accepts safe relative links and warns on instruction and configuration files", () => {
		const source = seed();
		for (const path of [
			"CLAUDE.md",
			"AGENTS.md",
			"notes/nested/HYPER.md",
			"extra/CLAUDE.md",
			"data/AGENTS.md",
			".claude/commands/review.md",
			".claude/memory/note.md",
			".config/tool.json",
			"bin/run.sh",
		]) {
			mkdirSync(dirname(join(source, path)), { recursive: true });
			publishChange(source, path, "review before use\n");
		}
		symlinkSync("../extra/read me.md", join(source, "notes", "link"));
		spaceGit(source, ["add", "notes/link"]);
		spaceGit(source, ["commit", "-m", "safe link"]);
		spaceGit(source, ["push", "origin", "HEAD"]);
		useMachine("second");
		const target = join(fixture.home, "destination");
		const result = run(["sample", target, "--json"]);
		success(result);
		expect(readFileSync(join(target, "notes/link"), "utf8")).toContain("tracked extra/read me.md");
		const warned: string[] = JSON.parse(result.stdout).untrustedConfiguration;
		for (const path of [
			"HYPER.md",
			"CLAUDE.md",
			"AGENTS.md",
			"notes/nested/HYPER.md",
			"extra/CLAUDE.md",
			"data/AGENTS.md",
			".claude/commands/review.md",
			".config/tool.json",
			"bin/run.sh",
		])
			expect(warned).toContain(path);
		expect(warned).toContain(".hyper/memory/MEMORY.md");
		// No memory exemption: a remote-supplied settings.json can point
		// autoMemoryDirectory at `.claude/memory`, so it steers agents too.
		expect(warned).toContain(".claude/memory/note.md");
	});
});

describe("round 1 clone security", () => {
	it.each([
		"/Users/old/.config/git",
		"/home/old/work/.hidden/space",
		"/Users/old/Library/LaunchAgents",
	])("refuses sensitive implicit destination %s even with --yes", (path) => {
		seed();
		updateEntry({ path });
		useMachine("second");
		const response = run(["sample", "--yes"]);
		expect(response.status).toBe(2);
		expect(flat(response.stderr)).toContain("explicit path");
	});
	it.each([".config", "Library"])("refuses implicit symlink parents entering %s", (directory) => {
		seed();
		updateEntry({ path: "/home/old/alias/sample" });
		useMachine("second");
		const protectedRoot = join(fixture.home, directory);
		mkdirSync(protectedRoot, { recursive: true });
		writeFileSync(join(protectedRoot, "keep"), "untouched");
		symlinkSync(protectedRoot, join(fixture.home, "alias"));
		const response = run(["sample", "--yes"]);
		expect(response.status).toBe(2);
		expect(flat(response.stderr)).toContain("protected HOME path");
		expect(existsSync(join(protectedRoot, "sample"))).toBe(false);
		expect(readFileSync(join(protectedRoot, "keep"), "utf8")).toBe("untouched");
	});
	it("requires --yes for a noninteractive manifest-derived target", () => {
		seed();
		updateEntry({ path: "/Users/old/work/sample" });
		useMachine("second");
		const response = run(["sample"]);
		expect(response.status).toBe(2);
		expect(flat(response.stderr)).toContain("--yes");
		expect(existsSync(join(fixture.home, "work", "sample"))).toBe(false);
	});
	it.for(["y", "n"])("confirms a manifest target on a TTY: %s", (answer, ctx) => {
		if (skipWithoutScript(ctx)) return;
		seed();
		updateEntry({ path: "/Users/old/work/sample" });
		useMachine("second");
		const response = spawnCliOnTty(["space", "clone", "sample"], fixture, [answer]);
		const said = flat(response.stdout + response.stderr);
		expect(said).toContain("Clone here?");
		expect(existsSync(join(fixture.home, "work", "sample"))).toBe(answer === "y");
		if (answer === "n") {
			// Declining is a decision, not a failure to repair: exit 1, plainly.
			expect(response.status).toBe(1);
			expect(said).toContain("Clone cancelled");
			expect(said).not.toContain("once the problem is fixed");
		}
	});
	it.each([
		{ field: "url", value: "evil-helper::payload" },
		{ field: "url", value: "ftp://example.invalid/repo" },
		{ field: "url", value: "https://user:secret-password@example.invalid/repo" },
		{ field: "url", value: "ssh://-oProxyCommand=touch-pwned@example.invalid/repo" },
		{ field: "url", value: "git@-oProxyCommand=touch-pwned@example.invalid:repo" },
		{ field: "default_branch", value: "$(x)" },
		{ field: "default_branch", value: "main;touch-x" },
		{ field: "default_branch", value: "a..b" },
	])("rejects hostile manifest $field before space git activity: $value", ({ field, value }) => {
		seed();
		const entry = readManifest().spaces[0];
		updateEntry({ repos: [{ ...entry.repos[0], [field]: value }] });
		useMachine("second");
		const real = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
		const shim = join(fixture.root, "security-shim");
		mkdirSync(shim);
		const touched = join(fixture.root, "space-git-ran");
		writeFileSync(
			join(shim, "git"),
			`#!/bin/sh\ncase "$*" in *space.git*|*"clone --bare"*) touch ${shellQuote(touched)}; exit 77;; esac\nexec ${shellQuote(real)} "$@"\n`,
			{ mode: 0o755 },
		);
		vi.stubEnv("PATH", `${shim}:${process.env.PATH}`);
		const target = join(fixture.home, "destination");
		const response = run(["sample", target]);
		expect(response.status).toBe(2);
		expect(existsSync(touched)).toBe(false);
		expect(existsSync(target)).toBe(false);
		expect(flat(response.stderr)).toContain(`repos[0].${field}`);
		expect(response.stderr).not.toContain("secret-password");
	});
	it("reports explicitly chosen symlinked parents and executable configuration", () => {
		const source = seed();
		mkdirSync(join(source, "bin"));
		mkdirSync(join(source, ".claude"), { recursive: true });
		publishChange(source, "bin/run.sh", "#!/bin/sh\\necho test\\n");
		publishChange(source, ".claude/settings.json", "{}");
		useMachine("second");
		const parent = join(fixture.home, "physical");
		mkdirSync(parent);
		const alias = join(fixture.home, "alias");
		symlinkSync(parent, alias);
		const response = run(["sample", join(alias, "destination"), "--json"]);
		success(response);
		const result = JSON.parse(response.stdout);
		expect(result.untrustedConfiguration.sort()).toEqual([
			".claude/settings.json",
			".config/wt.toml",
			".hyper/memory/MEMORY.md",
			"HYPER.md",
			"bin/run.sh",
		]);
		expect(result.warnings.join(" ")).toContain("symlinked parent");
		expect(result.warnings.join(" ")).toContain("review before trusting this space");
	});
	it("does not delete a user file at an incoming pathname after a checkout race", () => {
		seed();
		useMachine("second");
		const target = join(fixture.home, "empty");
		mkdirSync(target);
		const real = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
		const shim = join(fixture.root, "race-shim");
		mkdirSync(shim);
		writeFileSync(
			join(shim, "git"),
			`#!/bin/sh\ncase "$*" in *space.git*checkout*) printf 'USER FILE' > ${shellQuote(join(target, "HYPER.md"))}; echo 'injected failure' >&2; exit 1;; esac\nexec ${shellQuote(real)} "$@"\n`,
			{ mode: 0o755 },
		);
		vi.stubEnv("PATH", `${shim}:${process.env.PATH}`);
		const response = run(["sample", target]);
		expect(response.status).toBe(2);
		expect(readFileSync(join(target, "HYPER.md"), "utf8")).toBe("USER FILE");
		expect(readdirSync(target)).toEqual(["HYPER.md"]);
	});
});

describe("manifest path remapping", () => {
	it.each(["/Users/alice/work/sample", "/home/alice/work/sample", "/root/work/sample"])(
		"maps %s into the current HOME",
		(path) => {
			expect(cloneTargetPath(path)).toBe(join(fixture.home, "work", "sample"));
		},
	);
	it("keeps paths already under this HOME and lets an explicit path win", () => {
		const path = join(fixture.home, "sample");
		expect(cloneTargetPath(path)).toBe(path);
		expect(cloneTargetPath("/etc/cron.d/x", "relative choice")).toBe(resolve("relative choice"));
	});
	it.each([
		"/etc/cron.d/x",
		"/Users/x/../../etc",
		"/home/x/a\nb",
		"/home/x/a\0b",
		"/Users/x/a/",
		"/Users/x/a//b",
		"/Users/x/a/./b",
		"/Users/x/a ",
		"relative/path",
		"/home/x",
		"/root/",
		"/Users/x/../y/work",
	])("refuses unsafe default %j", (path) => {
		expect(() => cloneTargetPath(path)).toThrow(/explicit path/);
	});
});

describe("space clone", () => {
	it("round-trips init into a fresh HOME, restores config, and preserves every tracked byte", () => {
		const source = seed();
		spaceGit(source, ["config", "clone-test.must-not-copy", "source-only"]);
		const paths = spaceGit(source, ["ls-files", "-z"]).stdout.split("\0").filter(Boolean);
		const oldManifest = readFileSync(join(driveCheckoutDir(), "spaces.yaml"), "utf8");
		useMachine("second");
		expect(existsSync(fixture.hyperHome)).toBe(false);
		const target = join(fixture.home, "a space 'quoted'");
		const response = run(["sample", target, "--json"]);
		success(response);
		const result = JSON.parse(response.stdout);
		expect(result).toMatchObject({
			path: target,
			branch: "space/team/sample",
			cadence: "session-end+push",
			reposCloned: ["sample"],
			worktrees: [join(target, "worktrees")],
			libraryWrites: [join(target, ".git", "config")],
		});
		for (const path of paths)
			expect(readFileSync(join(target, path))).toEqual(readFileSync(join(source, path)));
		for (const path of ["scratch", "loose.txt", ".env", ".claude/settings.local.json"])
			expect(existsSync(join(target, path)), path).toBe(false);
		expect(readCadence(target)).toBe("session-end+push");
		expect(readTracked(target).sort()).toEqual([".config", "extra"]);
		expect(readFileSync(join(target, ".hyper", "memory", "MEMORY.md"), "utf8")).toContain(
			"tracked",
		);
		expect(spaceGit(target, ["config", "--get", "core.worktree"]).stdout.trim()).toBe("../..");
		expect(
			spaceGit(target, ["config", "--get", "clone-test.must-not-copy"], { allowFailure: true })
				.status,
		).toBe(1);
		const status = spawnSync(process.execPath, [cli, "space", "status"], {
			cwd: target,
			encoding: "utf8",
			env: process.env,
		});
		success(status);
		expect(flat(status.stdout)).toContain("space/team/sample");
		expect(flat(status.stdout)).toContain("session-end+push");
		expect(flat(status.stdout)).toContain("as of the last contact");
		expect(spaceGit(target, ["status", "--porcelain", "-z"]).stdout).toBe("");
		expect(spaceGit(target, ["rev-parse", "--abbrev-ref", "@{upstream}"]).stdout.trim()).toBe(
			"origin/space/team/sample",
		);
		expect(
			spaceGit(target, ["for-each-ref", "--format=%(refname)", "refs/remotes"]).stdout.trim(),
		).toBe("refs/remotes/origin/space/team/sample");
		expect(readFileSync(join(driveCheckoutDir(), "spaces.yaml"), "utf8")).toBe(oldManifest);
		const config = git(
			["--git-dir", join(target, ".git"), "config", "--get", "remote.origin.fetch"],
			target,
		).trim();
		expect(config).toBe("+refs/heads/*:refs/remotes/origin/*");
		expect(
			git(["--git-dir", join(target, ".git"), "rev-parse", "origin/main"], target).trim(),
		).not.toBe("");
		expect(
			git(
				["--git-dir", join(target, ".git"), "config", "--get", "worktrunk.default-branch"],
				target,
			).trim(),
		).toBe("main");
	});

	it("wt switch main succeeds in a recreated space", (ctx) => {
		if (spawnSync("sh", ["-c", "command -v wt"], { encoding: "utf8" }).status !== 0)
			return ctx.skip(
				"wt is absent; clone/config tests still run, worktrunk switch cannot be asserted",
			);
		seed();
		useMachine("second");
		const config = process.env.WORKTRUNK_CONFIG_PATH!;
		mkdirSync(dirname(config), { recursive: true });
		const configText = 'worktree-path = "{{ repo_path }}/../worktrees/{{ branch | sanitize }}"\n';
		writeFileSync(config, configText);
		const target = join(fixture.home, "destination");
		const response = run(["sample", target, "--json"]);
		success(response);
		expect(
			JSON.parse(response.stdout).warnings.filter(
				(warning: string) => !warning.includes("came from the hyperdrive"),
			),
		).toEqual([]);
		expect(readFileSync(config, "utf8")).toBe(configText);
		const switched = spawnSync("wt", ["switch", "main"], {
			cwd: target,
			encoding: "utf8",
			env: process.env,
		});
		expect(switched.status, `${switched.stdout} ${switched.stderr}`).toBe(0);
		expect(existsSync(join(target, "worktrees", "main", ".git"))).toBe(true);
		expect(readFileSync(join(target, "worktrees", "main", "file.txt"), "utf8")).toBe("hello\n");
	});

	// `it.for`, not `it.each`: only `for` passes the test context as the last
	// argument, and CI has no `wt`, so this skip is the path CI actually takes.
	it.for([false, true])(
		"warns about worktrunk placement without changing user config (per-project=%s)",
		(perProject, ctx) => {
			if (spawnSync("sh", ["-c", "command -v wt"], { encoding: "utf8" }).status !== 0)
				return ctx.skip("wt is absent; cannot verify its real placement warning");
			seed();
			useMachine("second");
			const config = process.env.WORKTRUNK_CONFIG_PATH!;
			const project = join(fixture.root, "project-remote");
			const configText = `worktree-path = "{{ repo_path }}/../worktrees/{{ branch | sanitize }}"\n[projects.${JSON.stringify(project)}]\nworktree-path = "{{ repo_path }}/../custom/{{ branch | sanitize }}"\n`;
			if (perProject) {
				mkdirSync(dirname(config), { recursive: true });
				writeFileSync(config, configText);
			}
			const target = join(fixture.home, "destination");
			const response = run(["sample", target, "--json"]);
			success(response);
			const warnings: string[] = JSON.parse(response.stdout).warnings.filter(
				(warning: string) => !warning.includes("came from the hyperdrive"),
			);
			expect(warnings).toHaveLength(1);
			const actual = perProject ? join(target, "custom", "main") : join(target, ".git.main");
			expect(warnings[0]).toContain(actual);
			expect(warnings[0]).toContain(
				'worktree-path = "{{ repo_path }}/../worktrees/{{ branch | sanitize }}"',
			);
			expect(warnings[0]).toContain(`[projects.${JSON.stringify(project)}]`);
			expect(warnings[0]).toContain(config);
			expect(flat(response.stderr)).toContain("Worktrees for");
			expect(existsSync(config)).toBe(perProject);
			if (perProject) expect(readFileSync(config, "utf8")).toBe(configText);
			// The warning describes what wt really does, not an invented default.
			const switched = spawnSync("wt", ["switch", "main"], {
				cwd: target,
				encoding: "utf8",
				env: process.env,
			});
			expect(switched.status, switched.stderr).toBe(0);
			expect(existsSync(join(actual, ".git"))).toBe(true);
		},
	);

	it("recreates multi repos separately with their worktrees directories", () => {
		seed("multi");
		useMachine("second");
		const target = join(fixture.home, "multi");
		const response = run(["sample", target, "--json"]);
		success(response);
		expect(JSON.parse(response.stdout).reposCloned).toEqual(["alpha", "beta"]);
		for (const slug of ["alpha", "beta"]) {
			expect(existsSync(join(target, "code", slug, ".git", "HEAD"))).toBe(true);
			expect(existsSync(join(target, "code", slug, "worktrees"))).toBe(true);
		}
		expect(existsSync(join(target, ".git"))).toBe(false);
		expect(existsSync(join(target, "worktrees"))).toBe(false);
	});

	it.each(["bare", "multi"] as const)(
		"fills an absent HYPER.md via the %s bash writer",
		(layout) => {
			const source = seed(layout, false);
			if (layout === "multi") {
				spaceGit(source, ["rm", "HYPER.md"]);
				spaceGit(source, ["commit", "-m", "no marker"]);
				spaceGit(source, ["push", "origin", "HEAD"]);
			}
			useMachine("second");
			const target = join(fixture.home, "destination");
			const response = run(["sample", target, "--json"]);
			success(response);
			expect(JSON.parse(response.stdout).libraryWrites).toContain(join(target, "HYPER.md"));
			expect(readFileSync(join(target, "HYPER.md"), "utf8")).toContain(
				layout === "bare" ? "bare layout" : "multi-repo layout",
			);
		},
	);

	it("prints the final and remapped path, cadence and library writes", () => {
		seed();
		updateEntry({ path: "/Users/previous/work/sample" });
		useMachine("second");
		const response = run(["sample", "--yes"]);
		success(response);
		expect(response.stdout).toContain(join(fixture.home, "work", "sample"));
		expect(response.stdout).toContain("/Users/previous/work/sample");
		expect(response.stdout).toContain("Cadence: session-end+push");
		expect(response.stdout).toContain("Library wrote:");
	});

	it("rejects a remapped path whose ancestor symlink leaves HOME", () => {
		seed();
		updateEntry({ path: "/home/old/escape/sample" });
		useMachine("second");
		const outside = join(fixture.root, "outside");
		mkdirSync(outside);
		symlinkSync(outside, join(fixture.home, "escape"));
		const response = run(["sample"]);
		expect(response.status).toBe(2);
		expect(flat(response.stderr)).toContain("outside HOME");
		expect(readdirSync(outside)).toEqual([]);
	});

	it("lists known names for an unknown space and refuses nonempty targets untouched", () => {
		seed();
		useMachine("second");
		const target = join(fixture.home, "destination");
		mkdirSync(target);
		writeFileSync(join(target, "mine"), "keep me");
		const unknown = run(["missing", target]);
		expect(unknown.status).toBe(2);
		expect(flat(unknown.stderr)).toContain("Known spaces: sample");
		const occupied = run(["sample", target]);
		expect(occupied.status).toBe(2);
		expect(flat(occupied.stderr)).toContain("empty directory");
		expect(readdirSync(target)).toEqual(["mine"]);
		expect(readFileSync(join(target, "mine"), "utf8")).toBe("keep me");
	});

	it("accepts an existing empty directory, refuses its symlink, and leaves the source intact", () => {
		const source = seed();
		useMachine("second");
		const target = join(fixture.home, "empty");
		mkdirSync(target);
		const link = join(fixture.home, "link");
		symlinkSync(target, link);
		expect(run(["sample", link]).status).toBe(2);
		expect(readdirSync(target)).toEqual([]);
		success(run(["sample", target]));
		expect(existsSync(join(source, ".git"))).toBe(true);
		expect(lstatSync(link).isSymbolicLink()).toBe(true);
	});

	it("skips a repo with an omitted URL and warns", () => {
		seed("multi");
		const entry = readManifest().spaces[0];
		const missing = { ...entry.repos[1] };
		Reflect.deleteProperty(missing, "url");
		updateEntry({ repos: [entry.repos[0], missing] });
		const listed = spawnCli(["space", "list", "--json"], fixture);
		success(listed);
		expect(flat(listed.stderr)).toContain("has no project URL");
		useMachine("second");
		const target = join(fixture.home, "destination");
		const response = run(["sample", target, "--json"]);
		success(response);
		expect(JSON.parse(response.stdout).reposCloned).toEqual(["alpha"]);
		expect(flat(response.stderr)).toContain("Skipping beta");
		expect(existsSync(join(target, "code", "beta"))).toBe(false);
	});

	it.each(["../outside", "/absolute", "alpha", "ALPHA"])(
		"refuses unsafe or duplicate repo slug %s before creating the target",
		(slug) => {
			seed("multi");
			const entry = readManifest().spaces[0];
			updateEntry({ repos: [entry.repos[0], { ...entry.repos[1], slug }] });
			useMachine("second");
			const target = join(fixture.home, "destination");
			const response = run(["sample", target]);
			expect(response.status).toBe(2);
			expect(flat(response.stderr)).toContain("slug");
			expect(existsSync(target)).toBe(false);
		},
	);

	it.each([false, true])("missing branch rolls back the target (preexisting=%s)", (preexisting) => {
		seed();
		git(
			["--git-dir", fixture.remote, "update-ref", "-d", "refs/heads/space/team/sample"],
			fixture.root,
		);
		useMachine("second");
		const parent = join(fixture.home, "new-parent");
		const target = join(parent, "destination");
		if (preexisting) mkdirSync(target, { recursive: true });
		const response = run(["sample", target]);
		expect(response.status).toBe(2);
		expect(flat(response.stderr)).toContain("branch is missing");
		expect(existsSync(target)).toBe(preexisting);
		if (preexisting) expect(readdirSync(target)).toEqual([]);
		else expect(existsSync(parent)).toBe(false);
	});

	it("reports an unreachable drive without creating a destination", () => {
		seed();
		useMachine("second");
		renameSync(fixture.remote, `${fixture.remote}.away`);
		const target = join(fixture.home, "destination");
		const response = run(["sample", target]);
		expect(response.status).toBe(2);
		expect(flat(response.stderr)).toContain("couldn't reach your hyperdrive");
		expect(existsSync(target)).toBe(false);
	});

	it("rolls back after a later project clone fails, including an earlier successful clone", () => {
		seed("multi");
		const entry = readManifest().spaces[0];
		updateEntry({
			repos: [entry.repos[0], { ...entry.repos[1], url: join(fixture.root, "missing.git") }],
		});
		useMachine("second");
		const target = join(fixture.home, "destination");
		const response = run(["sample", target]);
		expect(response.status).toBe(2);
		expect(flat(response.stderr)).toContain("recreate the project repository");
		expect(existsSync(target)).toBe(false);
	});

	it("wraps a checkout failure and preserves unrelated files added to a preexisting target", () => {
		seed();
		useMachine("second");
		const target = join(fixture.home, "empty");
		mkdirSync(target);
		const real = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
		const shim = join(fixture.root, "checkout-shim");
		mkdirSync(shim);
		writeFileSync(
			join(shim, "git"),
			`#!/bin/sh\ncase "$*" in *"space.git"*"checkout"*)\n${shellQuote(real)} "$@" || exit $?\nprintf 'belongs to someone else' > ${shellQuote(join(target, "arrived.txt"))}\necho 'fatal: injected checkout failure' >&2\nexit 1;; esac\nexec ${shellQuote(real)} "$@"\n`,
			{ mode: 0o755 },
		);
		vi.stubEnv("PATH", `${shim}:${process.env.PATH}`);
		const response = run(["sample", target]);
		expect(response.status).toBe(2);
		expect(flat(response.stderr)).toContain("couldn't clone");
		expect(flat(response.stderr)).toContain("run hyper space clone again");
		expect(readdirSync(target)).toEqual(["arrived.txt"]);
		expect(readFileSync(join(target, "arrived.txt"), "utf8")).toBe("belongs to someone else");
	});

	it("rejects a foreign allowlist and removes the checkout", () => {
		const source = seed();
		publishChange(source, ".gitignore", "*\n");
		useMachine("second");
		const target = join(fixture.home, "destination");
		const response = run(["sample", target]);
		expect(response.status).toBe(2);
		expect(flat(response.stderr)).toContain("is not hyper's allowlist");
		expect(existsSync(target)).toBe(false);
	});

	it("refuses a tracked reserved path before checking it out", () => {
		const source = seed();
		publishChange(source, "scratch/untracked", "malicious layout\n");
		useMachine("second");
		const target = join(fixture.home, "destination");
		const response = run(["sample", target]);
		expect(response.status).toBe(2);
		expect(flat(response.stderr)).toContain("Refusing incoming space history");
		expect(existsSync(target)).toBe(false);
	});

	it("removes scoped signal listeners on a refusal", async () => {
		const before = [process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")];
		await expect(cloneSpace("missing", join(fixture.home, "target"))).rejects.toThrow(
			"Known spaces",
		);
		expect([process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")]).toEqual(before);
	});
});

/** POSIX process-group signals: the synchronous git child's signal drives rollback. */
describe("interrupted clone", () => {
	it.each(["manifest", "init", "fetch", "checkout", "project", "library"])(
		"restores the target after SIGINT during %s",
		async (phase) => {
			seed();
			useMachine("second");
			const target = join(fixture.home, "destination");
			const shimDir = join(fixture.root, "shim-bin");
			mkdirSync(shimDir);
			const ready = join(fixture.root, "ready");
			const blocker = join(fixture.root, "block.cjs");
			writeFileSync(
				blocker,
				`require('node:fs').writeFileSync(${JSON.stringify(ready)}, 'ready'); setInterval(() => {}, 1000);`,
			);
			const binary = phase === "library" ? "bash" : "git";
			const real = spawnSync("sh", ["-c", `command -v ${binary}`], {
				encoding: "utf8",
			}).stdout.trim();
			const pattern =
				phase === "manifest"
					? '*"ls-remote"*'
					: phase === "project"
						? '*"clone --bare"*'
						: phase === "library"
							? '*"ensure_worktrunk_config"*'
							: `*"space.git"*"${phase}"*`;
			writeFileSync(
				join(shimDir, binary),
				`#!/bin/sh\ncase "$*" in ${pattern}) exec ${shellQuote(process.execPath)} ${shellQuote(blocker)};; esac\nexec ${shellQuote(real)} "$@"\n`,
				{ mode: 0o755 },
			);
			// init's args put the command BEFORE space.git, unlike the other calls.
			if (phase === "init")
				writeFileSync(
					join(shimDir, binary),
					`#!/bin/sh\ncase "$*" in *"init --bare"*"space.git"*) exec ${shellQuote(process.execPath)} ${shellQuote(blocker)};; esac\nexec ${shellQuote(real)} "$@"\n`,
					{ mode: 0o755 },
				);
			const child = spawn(process.execPath, [cli, "space", "clone", "sample", target], {
				detached: true,
				stdio: ["ignore", "pipe", "pipe"],
				env: {
					...process.env,
					PATH: `${shimDir}:${process.env.PATH}`,
					NO_COLOR: "1",
					FORCE_COLOR: "0",
					AI_AGENT: undefined,
					CLAUDECODE: undefined,
				},
			});
			let stderr = "";
			child.stderr.on("data", (chunk) => {
				stderr += chunk;
			});
			const closed = new Promise<{ code: number | null; signal: string | null }>(
				(resolve, reject) => {
					child.on("error", reject);
					child.on("close", (code, signal) => resolve({ code, signal }));
				},
			);
			try {
				await expect.poll(() => existsSync(ready), { timeout: 10_000 }).toBe(true);
				process.kill(-child.pid!, "SIGINT");
				expect(await closed, flat(stderr)).toEqual({ code: 130, signal: null });
				expect(flat(stderr)).toContain("Clone interrupted");
				expect(existsSync(target)).toBe(false);
			} finally {
				try {
					process.kill(-child.pid!, "SIGKILL");
				} catch {
					/* Already exited. */
				}
				await closed;
			}
		},
		20_000,
	);
});
