import { spawn, spawnSync } from "node:child_process";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SpaceEntry } from "#config/schema";
import { driveCheckoutDir, readManifest, upsertSpace } from "#services/manifest";
import { shellQuote } from "#services/remote";
import { cloneSpace, cloneTargetPath } from "#services/space-clone";
import { readCadence, readTracked, spaceGit } from "#services/space-git";
import {
	flat,
	git,
	type ManifestFixture,
	spawnCli,
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
		"notes/café/line\nbreak.md",
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
function publishChange(source: string, path: string, contents: string): void {
	writeFileSync(join(source, path), contents);
	spaceGit(source, ["add", "-f", "--", path]);
	spaceGit(source, ["commit", "-m", "fixture update"]);
	spaceGit(source, ["push", "origin", "HEAD"]);
}

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
		expect(readTracked(target)).toEqual(["extra", ".config"]);
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
		expect(JSON.parse(response.stdout).warnings).toEqual([]);
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

	it.each([false, true])(
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
			const warnings: string[] = JSON.parse(response.stdout).warnings;
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
		const response = run(["sample"]);
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
		expect(flat(response.stderr)).toContain("not a hyper allowlist");
		expect(existsSync(target)).toBe(false);
	});

	it("refuses a tracked reserved path before checking it out", () => {
		const source = seed();
		publishChange(source, "scratch/untracked", "malicious layout\n");
		useMachine("second");
		const target = join(fixture.home, "destination");
		const response = run(["sample", target]);
		expect(response.status).toBe(2);
		expect(flat(response.stderr)).toContain("unsafe layout path");
		expect(existsSync(target)).toBe(false);
	});

	it("removes scoped signal listeners on a refusal", () => {
		const before = [process.listenerCount("SIGINT"), process.listenerCount("SIGTERM")];
		expect(() => cloneSpace("missing", join(fixture.home, "target"))).toThrow("Known spaces");
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
