import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import type { SpaceEntry } from "#config/schema";
import { ALLOWLIST_MARKER } from "#services/allowlist";
import { shellQuote } from "#services/remote";
import {
	flat,
	git,
	isolateGitConfig,
	type ManifestFixture,
	skipIfUnbuilt,
	spawnCli,
	withManifestFixture,
} from "#tests/tmp-manifest";
import { makeBareSpace, makeCheckout, makeMultiSpace } from "#tests/tmp-space";

/**
 * `hyper space init` — the command that puts a space under the hyperdrive.
 *
 * These are CLI-spawn tests on purpose. The wiring this command adds lives in
 * the ORDER of the calls (checkout before the space, clash check before the
 * commit, cleanup on refusal), and none of that is observable by importing the
 * functions: only the spawned process can leave a half-built space behind.
 */

let fixture: ManifestFixture;

/** A space whose files make AC-1/C-4 visible at a glance. */
function makeSpace(name: string): string {
	const root = join(fixture.root, name);
	makeBareSpace(root);
	mkdirSync(join(root, "notes"), { recursive: true });
	mkdirSync(join(root, "data"), { recursive: true });
	mkdirSync(join(root, "scratch"), { recursive: true });
	mkdirSync(join(root, "worktrees", "m"), { recursive: true });
	writeFileSync(join(root, ".env"), "TOKEN=secret\n");
	writeFileSync(join(root, "notes", "a.md"), "notes\n");
	writeFileSync(join(root, "data", "d.json"), "{}\n");
	writeFileSync(join(root, "scratch", "x"), "throwaway\n");
	writeFileSync(join(root, "worktrees", "m", "x"), "throwaway\n");
	return root;
}

/** A drive.toml naming this fixture's remote, plus any extra lines. */
function writeConfig(...extra: string[]): void {
	mkdirSync(join(fixture.root, "config", "hyper"), { recursive: true });
	writeFileSync(
		fixture.configFile,
		[`remote = ${JSON.stringify(fixture.remote)}`, ...extra].join("\n") + "\n",
	);
}

/** What the hyperdrive's own copy of the manifest holds, read off the remote. */
function manifestEntry(name: string): SpaceEntry | undefined {
	const yaml = git(["--git-dir", fixture.remote, "show", "main:spaces.yaml"], fixture.root);
	const spaces = parseYaml(yaml) as { spaces?: SpaceEntry[] };
	return spaces.spaces?.find((space) => space.name === name);
}

/** The manifest as the CLI reads it back, through the checkout it wrote. */
function manifestFromCheckout(name: string): SpaceEntry | undefined {
	const path = join(fixture.hyperHome, "drive", "spaces.yaml");
	if (!existsSync(path)) return undefined;
	const spaces = parseYaml(readFileSync(path, "utf-8")) as { spaces?: SpaceEntry[] };
	return spaces.spaces?.find((space) => space.name === name);
}

/** The paths the hyperdrive's copy of the space branch holds. */
function remoteTree(branch: string): string[] {
	// `-z`, for the same reason the secret guard uses it: without it a path
	// holding a non-ASCII byte comes back C-quoted, and every comparison here
	// would quietly miss it.
	return git(
		["--git-dir", fixture.remote, "ls-tree", "-r", "--name-only", "-z", branch],
		fixture.root,
	)
		.split("\0")
		.map((line) => line.trim())
		.filter((line) => line !== "")
		.sort();
}

/** Does the hyperdrive have this branch? (`rev-parse` exits 128 when it does not.) */
function remoteHasRef(branch: string): boolean {
	const refs = git(
		["--git-dir", fixture.remote, "for-each-ref", "--format=%(refname)", "refs/heads"],
		fixture.root,
	);
	return refs.split("\n").some((ref) => ref.trim() === `refs/heads/${branch}`);
}

/** How many commits the SPACE's own branch has locally. */
function localCount(root: string): number {
	return Number(
		git(
			["--git-dir", join(root, ".hyper", "space.git"), "rev-list", "--count", "HEAD"],
			root,
		).trim(),
	);
}

/** `hyper.tracked` in the space's own git dir — the list, read as hyper wrote it. */
function localTracked(root: string): string[] {
	// Not the shared `git()` helper: it throws on any non-zero exit, and git
	// exits 1 for "key not found" — which is a space that tracks nothing, and
	// exactly what several of these tests are asserting.
	const result = spawnSync(
		"git",
		[
			"--git-dir",
			join(root, ".hyper", "space.git"),
			"config",
			"--local",
			"--get-all",
			"hyper.tracked",
		],
		{ encoding: "utf8", cwd: root },
	);
	if (result.status !== 0) return [];
	return (result.stdout ?? "")
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "");
}

/** `hyper.cadence` in the space's own git dir — the cadence the space runs on. */
function cadenceIn(root: string): string {
	return git(
		["--git-dir", join(root, ".hyper", "space.git"), "config", "--local", "--get", "hyper.cadence"],
		root,
	).trim();
}

/**
 * Make the hyperdrive accept its `main` and refuse every `space/*` branch,
 * the way a server-side hook would.
 *
 * Scoped to space branches on purpose: the manifest's `main` push has to keep
 * working, or the test would be proving that a broken hyperdrive refuses to
 * initialise rather than that a refused push is recoverable.
 */
function rejectSpacePushes(on: boolean): void {
	const hook = join(fixture.remote, "hooks", "pre-receive");
	if (!on) {
		rmSync(hook, { force: true });
		return;
	}
	writeFileSync(
		hook,
		'#!/bin/sh\nwhile read old new ref; do\n\tcase "$ref" in\n\t\trefs/heads/space/*) echo "space branches are closed"; exit 1;;\n\tesac\ndone\nexit 0\n',
		{ mode: 0o755 },
	);
}

function hashFile(path: string): string {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function listGitDir(path: string): string[] {
	return readdirSync(path).sort();
}

beforeEach(() => {
	isolateGitConfig();
	// `isolateGitConfig` empties the global config on purpose. The seed checkouts
	// in `makeMultiSpace` therefore need `init.defaultBranch` handed to them the
	// way CI hands it: through GIT_CONFIG_COUNT, which the spawned CLI inherits
	// too, so the fixtures and the command under test agree on what `main` is.
	process.env.GIT_CONFIG_COUNT = "2";
	process.env.GIT_CONFIG_KEY_1 = "init.defaultBranch";
	process.env.GIT_CONFIG_VALUE_1 = "main";
	// The space's own commits need an identity for the same reason.
	process.env.GIT_AUTHOR_NAME = "hyper test";
	process.env.GIT_AUTHOR_EMAIL = "hyper-test@example.invalid";
	process.env.GIT_COMMITTER_NAME = "hyper test";
	process.env.GIT_COMMITTER_EMAIL = "hyper-test@example.invalid";
	fixture = withManifestFixture();
});

afterEach(() => {
	fixture.cleanup();
});

/**
 * Put a `git` on PATH that runs every push for real and then reports failure.
 *
 * The ambiguous failure this reproduces cannot be arranged with a hook: when the
 * remote already holds the commit, git never contacts it, so a rejecting hook is
 * never invoked and the push exits 0. What a real machine sees is the opposite —
 * the objects ARE on the remote and the client never learned it.
 *
 * Returns a function that puts the real PATH back.
 */
function pushFailsAfterLanding(): () => void {
	const real = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
	const dir = join(fixture.root, "shim-bin");
	mkdirSync(dir, { recursive: true });
	const shim = join(dir, "git");
	writeFileSync(
		shim,
		`#!/bin/sh
for arg in "$@"; do
	if [ "$arg" = "push" ]; then
		"${real}" "$@" >/dev/null 2>&1
		exit 1
	fi
done
exec "${real}" "$@"
`,
		{ mode: 0o755 },
	);
	const saved = process.env.PATH;
	process.env.PATH = `${dir}:${saved ?? ""}`;
	return () => {
		if (saved === undefined) delete process.env.PATH;
		else process.env.PATH = saved;
	};
}

/** A nested repository with one commit — the shape git stages as a gitlink. */
function makeNestedRepo(dir: string, content: string): void {
	mkdirSync(dir, { recursive: true });
	run2("git", ["init", "-q", dir]);
	writeFileSync(join(dir, "index.js"), content);
	run2("git", ["-C", dir, "add", "-A"]);
	run2("git", [
		"-C",
		dir,
		"-c",
		"user.name=nested",
		"-c",
		"user.email=nested@example.invalid",
		"commit",
		"-qm",
		"nested",
	]);
}

function run2(cmd: string, args: string[]): void {
	const r = spawnSync(cmd, args, { encoding: "utf8" });
	if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")}: ${r.stderr}`);
}

/** The branch a space directory would use: `space/<name>`. */
function remoteBranchFor(root: string): string {
	return `space/${basename(root)}`;
}

/**
 * What an interrupted first init leaves behind: a space git dir with an
 * UNBORN HEAD, and nothing else — no commit, no allowlist, no cadence.
 *
 * Built with the same git calls `initSpaceGitDir` makes, so the test is about
 * hyper's reaction to that state rather than about a hand-made imitation.
 */
function initOrphanSpaceGitDir(root: string): void {
	const gitDir = join(root, ".hyper", "space.git");
	mkdirSync(gitDir, { recursive: true });
	spawnSync("git", ["init", "-q", "--bare", gitDir], { encoding: "utf8" });
	for (const [key, value] of [
		["core.bare", "false"],
		["core.worktree", "../.."],
		["remote.origin.url", fixture.remote],
	] as const) {
		spawnSync("git", ["--git-dir", gitDir, "config", "--local", key, value], {
			encoding: "utf8",
			cwd: root,
		});
	}
	spawnSync(
		"git",
		["--git-dir", gitDir, "symbolic-ref", "HEAD", `refs/heads/${remoteBranchFor(root)}`],
		{
			encoding: "utf8",
			cwd: root,
		},
	);
}

/**
 * Run the CLI, then pin `gc.auto=0` in whatever space git dir the run created.
 *
 * `isolateGitConfig()` injects `gc.auto=0` through GIT_CONFIG_COUNT for the gits
 * THIS PROCESS runs, but a spawned CLI does not inherit it: `services/
 * space-git.ts` strips every repo-local `GIT_*` variable from the child env on
 * purpose. So the space git dir gets it from its own config, which is where the
 * setting actually has to live — otherwise a background `git gc` detaches,
 * keeps writing into a fixture after the command returned, and the teardown's
 * retry loop has to paper over it.
 */
function run(args: string[], _fixture = fixture): ReturnType<typeof spawnCli> {
	const result = spawnCli(args, fixture);
	pinSpaceGc(args);
	return result;
}

function pinSpaceGc(args: string[]): void {
	const spaceArg = args[0] === "space" && args[1] === "init" ? args[2] : undefined;
	const candidates = spaceArg ? [spaceArg] : [];
	for (const candidate of candidates) {
		const gitDir = join(candidate, ".hyper", "space.git");
		if (!existsSync(gitDir)) continue;
		spawnSync("git", ["--git-dir", gitDir, "config", "--local", "gc.auto", "0"], {
			encoding: "utf8",
			cwd: candidate,
		});
	}
}

describe("AC-1: the allowlist decides what the space branch holds", () => {
	it("commits only allowlisted paths, and no .env", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		writeConfig();
		const root = makeSpace("my-space");

		const result = run(["space", "init", root, "--cadence", "manual"], fixture);
		expect(result.status, `${flat(result.stdout)} | ${flat(result.stderr)}`).toBe(0);

		// The branch exists on the hyperdrive itself, not just locally.
		expect(
			git(["--git-dir", fixture.remote, "rev-parse", "--verify", "space/my-space"], fixture.root),
		).not.toBe("");
		const tree = remoteTree("space/my-space");
		expect(tree).toEqual([".gitignore", "data/d.json", "notes/a.md"]);
		expect(tree.some((path) => path.includes(".env"))).toBe(false);
		expect(tree.some((path) => path.startsWith("scratch/"))).toBe(false);
		expect(tree.some((path) => path.startsWith("worktrees/"))).toBe(false);
		// The space's own git dir and the project's bare repo stay out.
		expect(tree.some((path) => path.startsWith(".hyper/space.git"))).toBe(false);
		expect(tree.some((path) => path.startsWith(".git/"))).toBe(false);
	});

	it("adds --tracked entries to the allowlist and to the manifest", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		writeConfig();
		const root = makeSpace("tracked-space");
		mkdirSync(join(root, "extra", "deep"), { recursive: true });
		writeFileSync(join(root, "extra", "deep", "e.md"), "extra\n");

		const result = spawnCli(
			["space", "init", root, "--cadence", "manual", "--tracked", "extra/"],
			fixture,
		);
		expect(result.status, flat(result.stderr)).toBe(0);
		expect(remoteTree("space/tracked-space")).toContain("extra/deep/e.md");
		// Rendered as the `!` pair the renderer emits, trailing slash normalised.
		const ignore = readFileSync(join(root, ".gitignore"), "utf-8");
		expect(ignore).toContain("!/extra/");
		expect(ignore).toContain("!/extra/**");
		// The manifest stores the NORMALISED entry (`extra`, not the `extra/`
		// that was typed): a list that keeps `extra` and `extra/` as two entries
		// would render one directory twice and merge wrongly later.
		expect(manifestFromCheckout("tracked-space")?.tracked).toEqual(["extra"]);
	});
});

describe("AC-2 / C-3: init leaves the project's own repo alone", () => {
	it("changes nothing under <root>/.git and leaves its worktrees and worktrunk alone", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		writeConfig();
		const root = makeSpace("untouched");
		// Give the project's bare repo an origin so the manifest can record it,
		// then snapshot everything C-3 is about.
		const projectRemote = join(fixture.root, "project.git");
		git(["init", "--bare", projectRemote], fixture.root);
		git(["--git-dir", join(root, ".git"), "remote", "add", "origin", projectRemote], root);

		// A REAL worktree with a real dirty file. Running `wt` in the test
		// process's own cwd (the hyper repo) proved nothing: it never touched
		// the space, and it could only pass because nothing there changed. The
		// claim is that hyper leaves this repo's worktrees alone, so the
		// worktree has to be here, in the space, holding uncommitted work.
		const seed = join(fixture.root, "seed");
		makeCheckout(seed);
		git(
			["--git-dir", join(root, ".git"), "fetch", "-q", seed, "refs/heads/main:refs/heads/main"],
			root,
		);
		const worktree = join(root, "worktrees", "main");
		git(["--git-dir", join(root, ".git"), "worktree", "add", "-q", worktree, "main"], root);
		writeFileSync(join(worktree, "dirty.txt"), "uncommitted work\n");
		const dirtyBefore = git(["-C", worktree, "status", "--porcelain"], worktree).trim();
		expect(dirtyBefore).toContain("dirty.txt");

		// `wt` run IN the space, on its own repo. When it is not installed (or
		// refuses this repo) there is nothing to compare and nothing claimed.
		//
		// It runs BEFORE the hashes are taken, deliberately: worktrunk writes
		// its own config into the repo it adopts, and hashing first would then
		// be measuring the test's own setup rather than what hyper did.
		const wtBefore = spawnSync("wt", ["list", "--format", "json"], {
			cwd: root,
			encoding: "utf8",
		});
		const worktrunkRan = wtBefore.status === 0;

		const gitDir = join(root, ".git");
		const configBefore = hashFile(join(gitDir, "config"));
		const headBefore = hashFile(join(gitDir, "HEAD"));
		const listingBefore = listGitDir(gitDir);

		const result = run(["space", "init", root, "--cadence", "manual"], fixture);
		expect(result.status, flat(result.stderr)).toBe(0);

		expect(hashFile(join(gitDir, "config"))).toBe(configBefore);
		expect(hashFile(join(gitDir, "HEAD"))).toBe(headBefore);
		expect(listGitDir(gitDir)).toEqual(listingBefore);
		// The worktree still exists, still has its uncommitted file, and still
		// reports exactly the same status.
		expect(existsSync(join(worktree, ".git"))).toBe(true);
		expect(git(["-C", worktree, "status", "--porcelain"], worktree).trim()).toBe(dirtyBefore);
		if (worktrunkRan) {
			const after = spawnSync("wt", ["list", "--format", "json"], {
				cwd: root,
				encoding: "utf8",
			});
			expect(after.stdout).toBe(wtBefore.stdout);
		}
	});
});

describe("AC-4: the cadence lands in the space git dir's config", () => {
	const cadenceOf = (root: string): string =>
		git(
			[
				"--git-dir",
				join(root, ".hyper", "space.git"),
				"config",
				"--local",
				"--get",
				"hyper.cadence",
			],
			root,
		).trim();

	it("--cadence wins over [defaults] cadence", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		writeConfig("", "[defaults]", 'cadence = "session-end"');
		const root = makeSpace("cadence-flag");
		expect(
			run(["space", "init", root, "--cadence", "manual"], fixture).status,
			"init should succeed",
		).toBe(0);
		expect(cadenceOf(root)).toBe("manual");
		expect(manifestFromCheckout("cadence-flag")?.cadence).toBe("manual");
	});

	it("[defaults] cadence applies without a prompt", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		writeConfig("", "[defaults]", 'cadence = "session-end"');
		const root = makeSpace("cadence-default");
		const result = run(["space", "init", root], fixture);
		expect(result.status, flat(result.stderr)).toBe(0);
		expect(cadenceOf(root)).toBe("session-end");
	});

	it("names --cadence when there is no flag, no default and no TTY", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		writeConfig();
		const root = makeSpace("cadence-missing");
		const result = run(["space", "init", root], fixture);
		expect(result.status).not.toBe(0);
		expect(flat(result.stderr)).toContain("--cadence");
		// Nothing was created on the way out.
		expect(existsSync(join(root, ".hyper", "space.git"))).toBe(false);
	});
});

describe("AC-7: a ref that would be ambiguous is refused by name", () => {
	it("refuses --group g when space/g is already a space", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		writeConfig();
		const first = makeSpace("existing");
		expect(run(["space", "init", first, "--cadence", "manual"], fixture).status).toBe(0);
		// A second space on the hyperdrive, so the remote has more than one branch.
		const other = makeSpace("other");
		expect(run(["space", "init", other, "--cadence", "manual"], fixture).status).toBe(0);

		const clash = makeSpace("clash-group");
		const result = spawnCli(
			["space", "init", clash, "--name", "x", "--group", "existing", "--cadence", "manual"],
			fixture,
		);
		expect(result.status).not.toBe(0);
		expect(flat(result.stderr)).toContain("space/existing");
		// Nothing left behind under .hyper/ by the refused run.
		expect(existsSync(join(clash, ".hyper", "space.git"))).toBe(false);
	});

	it("refuses --name foo when space/foo is already a group", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		writeConfig();
		const parent = makeSpace("parent");
		expect(
			spawnCli(
				["space", "init", parent, "--name", "child", "--group", "foo", "--cadence", "manual"],
				fixture,
			).status,
		).toBe(0);

		const clash = makeSpace("clash-name");
		const result = spawnCli(
			["space", "init", clash, "--name", "foo", "--cadence", "manual"],
			fixture,
		);
		expect(result.status).not.toBe(0);
		expect(flat(result.stderr)).toContain("space/foo/child");
		expect(existsSync(join(clash, ".hyper", "space.git"))).toBe(false);
	});
});

describe("the manifest entry", () => {
	it("records the space exactly as it was created", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		writeConfig();
		const root = makeSpace("recorded");
		const projectRemote = join(fixture.root, "project.git");
		git(["init", "--bare", projectRemote], fixture.root);
		git(["--git-dir", join(root, ".git"), "remote", "add", "origin", projectRemote], root);

		expect(run(["space", "init", root, "--cadence", "manual"], fixture).status).toBe(0);

		const entry = manifestFromCheckout("recorded");
		expect(entry).toEqual({
			name: "recorded",
			branch: "space/recorded",
			group: null,
			path: root,
			layout: "bare",
			repos: [{ url: projectRemote, default_branch: "main" }],
			cadence: "manual",
			tracked: [],
			public: [],
		});
		// And it is on the remote, not only in the local checkout.
		expect(manifestEntry("recorded")).toEqual(entry);
	});

	it("gives a multi space one entry per repo, with slugs", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		writeConfig();
		const root = join(fixture.root, "multi-space");
		makeMultiSpace(root, ["alpha", "beta"]);
		for (const slug of ["alpha", "beta"]) {
			git(
				["--git-dir", join(root, "code", slug, ".git"), "remote", "add", "origin", `${slug}.git`],
				root,
			);
		}

		expect(run(["space", "init", root, "--cadence", "manual"], fixture).status).toBe(0);
		const entry = manifestFromCheckout("multi-space");
		expect(entry?.layout).toBe("multi");
		expect(entry?.repos).toEqual([
			{ url: "alpha.git", default_branch: "main", slug: "alpha" },
			{ url: "beta.git", default_branch: "main", slug: "beta" },
		]);
	});
});

describe("refusals and refresh", () => {
	it("refuses a directory that is not a space, and points at hyper drive init with no remote", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		const plain = join(fixture.root, "plain");
		mkdirSync(plain, { recursive: true });
		const notASpace = run(["space", "init", plain, "--cadence", "manual"], fixture);
		expect(notASpace.status).not.toBe(0);
		expect(flat(notASpace.stderr)).toContain("not inside a hyper space");

		writeConfig();
		const root = makeSpace("no-remote-space");
		mkdirSync(dirname(fixture.configFile), { recursive: true });
		writeFileSync(fixture.configFile, 'self = { name = "mac", home = "/tmp" }\n');
		const noRemote = run(["space", "init", root, "--cadence", "manual"], fixture);
		expect(noRemote.status).not.toBe(0);
		expect(flat(noRemote.stderr)).toContain("hyper drive init");
		expect(existsSync(join(root, ".hyper", "space.git"))).toBe(false);
	});

	it("refuses a name the manifest could never hold and says to pass --name", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		writeConfig();
		const root = makeSpace("not a valid name");
		const result = run(["space", "init", root, "--cadence", "manual"], fixture);
		expect(result.status).not.toBe(0);
		expect(flat(result.stderr)).toContain("--name");

		// And an explicitly bad --group is refused too.
		const good = makeSpace("good-name");
		const badGroup = spawnCli(
			["space", "init", good, "--group", "../evil", "--cadence", "manual"],
			fixture,
		);
		expect(badGroup.status).not.toBe(0);
		expect(flat(badGroup.stderr)).toContain("--group");
	});

	it("refuses an already-initialised space without --refresh, and is idempotent with it", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		writeConfig();
		const root = makeSpace("twice");
		expect(run(["space", "init", root, "--cadence", "manual"], fixture).status).toBe(0);

		const again = run(["space", "init", root, "--cadence", "manual"], fixture);
		expect(again.status).not.toBe(0);
		expect(flat(again.stderr)).toContain("--refresh");

		const commits = () =>
			git(["--git-dir", fixture.remote, "rev-list", "--count", "space/twice"], fixture.root).trim();
		const before = commits();
		const refresh = run(["space", "init", root, "--refresh"], fixture);
		expect(refresh.status, flat(refresh.stderr)).toBe(0);
		// Nothing changed, so nothing was committed.
		expect(commits()).toBe(before);
		expect(manifestFromCheckout("twice")?.cadence).toBe("manual");
	});

	it("--refresh refuses when the computed branch differs from the space's own", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		writeConfig();
		const root = makeSpace("renamed");
		expect(
			run(["space", "init", root, "--name", "original", "--cadence", "manual"], fixture).status,
		).toBe(0);

		const result = spawnCli(
			["space", "init", root, "--name", "different", "--refresh", "--cadence", "manual"],
			fixture,
		);
		expect(result.status).not.toBe(0);
		expect(flat(result.stderr)).toContain("space/original");
		expect(flat(result.stderr)).toContain("space/different");
		// The space kept its branch and its git dir.
		expect(existsSync(join(root, ".hyper", "space.git"))).toBe(true);
		expect(remoteTree("space/original")).toEqual([".gitignore", "data/d.json", "notes/a.md"]);
	});

	it("commits on --refresh when the space has changed", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		writeConfig();
		const root = makeSpace("growing");
		expect(run(["space", "init", root, "--cadence", "manual"], fixture).status).toBe(0);
		writeFileSync(join(root, "notes", "b.md"), "more\n");

		const refresh = run(["space", "init", root, "--refresh"], fixture);
		expect(refresh.status, flat(refresh.stderr)).toBe(0);
		expect(remoteTree("space/growing")).toEqual([
			".gitignore",
			"data/d.json",
			"notes/a.md",
			"notes/b.md",
		]);
	});
});

describe("the secret guard", () => {
	it("refuses the first commit when an allowlisted path looks like a secret", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		writeConfig();
		const root = makeSpace("leaky");
		// notes/ IS allowlisted, so this one only the secret guard can catch.
		writeFileSync(join(root, "notes", ".env"), "TOKEN=secret\n");

		const result = run(["space", "init", root, "--cadence", "manual"], fixture);
		expect(result.status).not.toBe(0);
		expect(flat(result.stderr)).toContain("notes/.env");
		expect(flat(result.stderr)).toContain("secret guard");
		// Nothing was pushed and no git dir was left holding the staged secret.
		expect(remoteHasRef("space/leaky")).toBe(false);
		expect(existsSync(join(root, ".hyper", "space.git"))).toBe(false);
	});
});

describe("output", () => {
	it("summarises what it did, and prints JSON with --json", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		writeConfig();
		const root = makeSpace("chatty");
		const human = run(["space", "init", root, "--cadence", "session-end"], fixture);
		expect(human.status, flat(human.stderr)).toBe(0);
		expect(flat(human.stdout)).toContain("Branch: space/chatty");
		expect(flat(human.stdout)).toContain(`Remote: ${fixture.remote}`);
		expect(flat(human.stdout)).toContain("Cadence: session-end");
		expect(flat(human.stdout)).toContain("Committed: 3 files");

		const other = makeSpace("chatty-json");
		const json = run(["space", "init", other, "--json", "--cadence", "manual"], fixture);
		expect(json.status, flat(json.stderr)).toBe(0);
		const parsed = JSON.parse(json.stdout);
		expect(parsed.name).toBe("chatty-json");
		expect(parsed.branch).toBe("space/chatty-json");
		expect(parsed.committed).toBe(3);
		expect(parsed.refreshed).toBe(false);
	});
});

/**
 * Round-1 review probes. Each of these was a MAJOR/MINOR on the first
 * `--refresh` implementation: the flows below are the ones a first init never
 * exercises, so they only exist as tests.
 */
describe("a refresh keeps what the space already decided", () => {
	it("the space's own cadence outranks [defaults] cadence on a refresh", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		// The machine default says `session-end`; the space was created with
		// `session-end+push`. A refresh that applied the default would silently
		// downgrade the space (C-11: the git dir's config is the truth).
		writeConfig("", "[defaults]", 'cadence = "session-end"');
		const root = makeSpace("sticky-cadence");
		expect(
			run(["space", "init", root, "--cadence", "session-end+push"], fixture).status,
			"init should succeed",
		).toBe(0);

		const refresh = run(["space", "init", root, "--refresh"], fixture);
		expect(refresh.status, flat(refresh.stderr)).toBe(0);
		expect(
			git(
				[
					"--git-dir",
					join(root, ".hyper", "space.git"),
					"config",
					"--local",
					"--get",
					"hyper.cadence",
				],
				root,
			).trim(),
		).toBe("session-end+push");
		expect(manifestFromCheckout("sticky-cadence")?.cadence).toBe("session-end+push");
		// The default is not dead config: a space that has never had a cadence
		// still takes it (covered by "[defaults] cadence applies without a
		// prompt" above), because that path never reads a git dir.
	});

	it("a refresh without --tracked keeps the space's tracked list", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		writeConfig();
		const root = makeSpace("kept-tracked");
		mkdirSync(join(root, "extra"), { recursive: true });
		writeFileSync(join(root, "extra", "e.md"), "extra\n");
		expect(
			run(["space", "init", root, "--cadence", "manual", "--tracked", "extra"], fixture).status,
		).toBe(0);

		const refresh = run(["space", "init", root, "--refresh"], fixture);
		expect(refresh.status, flat(refresh.stderr)).toBe(0);
		expect(manifestFromCheckout("kept-tracked")?.tracked).toEqual(["extra"]);
		// Still allowlisted, so a file written under it now is still tracked.
		expect(readFileSync(join(root, ".gitignore"), "utf-8")).toContain("!/extra/**");
		writeFileSync(join(root, "extra", "later.md"), "later\n");
		expect(run(["space", "init", root, "--refresh"], fixture).status).toBe(0);
		expect(remoteTree("space/kept-tracked")).toContain("extra/later.md");
	});

	it("--tracked on a refresh adds to the space's tracked list", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		writeConfig();
		const root = makeSpace("added-tracked");
		mkdirSync(join(root, "extra"), { recursive: true });
		mkdirSync(join(root, "more"), { recursive: true });
		writeFileSync(join(root, "extra", "e.md"), "extra\n");
		writeFileSync(join(root, "more", "m.md"), "more\n");
		expect(
			run(["space", "init", root, "--cadence", "manual", "--tracked", "extra"], fixture).status,
		).toBe(0);

		const refresh = run(["space", "init", root, "--refresh", "--tracked", "more"], fixture);
		expect(refresh.status, flat(refresh.stderr)).toBe(0);
		expect(manifestFromCheckout("added-tracked")?.tracked).toEqual(["extra", "more"]);
		expect(remoteTree("space/added-tracked")).toEqual(
			expect.arrayContaining(["extra/e.md", "more/m.md"]),
		);
	});
});

describe("a push that failed is published by the next refresh", () => {
	it("a refresh publishes an unpublished commit even with nothing staged", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		writeConfig();
		const root = makeSpace("retry-push");
		expect(run(["space", "init", root, "--cadence", "manual"], fixture).status).toBe(0);

		// The hyperdrive refuses space branches; the space keeps working.
		rejectSpacePushes(true);
		mkdirSync(join(root, "later"), { recursive: true });
		writeFileSync(join(root, "later", "kept.md"), "written offline\n");
		writeFileSync(join(root, "notes", "unpublished.md"), "written offline\n");
		// `--tracked` so this run ALSO re-renders the allowlist: a refusal that
		// deleted or kept the new render would be caught here, not only by the
		// dedicated MAJOR 1 test.
		const before = readFileSync(join(root, ".gitignore"), "utf-8");
		const failed = run(["space", "init", root, "--refresh", "--tracked", "later"], fixture);
		expect(failed.status).not.toBe(0);
		// This run COMMITTED (the commit is what the refused push was carrying),
		// so it keeps what it wrote: the file exists, and the work tree agrees
		// with the HEAD that expects the new render. "Unchanged" is the wrong
		// expectation here — the round-3 N2 test covers the two branches of that
		// rule, and this one covers the commit branch.
		expect(existsSync(join(root, ".gitignore"))).toBe(true);
		expect(readFileSync(join(root, ".gitignore"), "utf-8")).not.toBe(before);
		expect(
			git(["--git-dir", join(root, ".hyper", "space.git"), "status", "--porcelain"], root).trim(),
		).not.toContain(".gitignore");
		// The commit is kept locally: losing it would make the next refresh
		// unable to publish anything.
		expect(existsSync(join(root, ".hyper", "space.git"))).toBe(true);
		expect(localCount(root)).toBe(2);
		expect(remoteHasRef("space/retry-push")).toBe(true);
		expect(remoteTree("space/retry-push")).not.toContain("notes/unpublished.md");

		// The hyperdrive accepts again. Nothing is staged this time, and that
		// must not read as "nothing to do".
		rejectSpacePushes(false);
		const recovered = run(["space", "init", root, "--refresh"], fixture);
		expect(recovered.status, flat(recovered.stderr)).toBe(0);
		expect(flat(recovered.stdout)).toContain("pushed what the hyperdrive was missing");
		expect(remoteTree("space/retry-push")).toContain("notes/unpublished.md");
		// `later` was tracked by a run that never reached the manifest, and the
		// recovery still has it.
		expect(remoteTree("space/retry-push")).toContain("later/kept.md");
		expect(localTracked(root)).toEqual(["later"]);
		// And a refresh that really is level says so, rather than claiming work.
		const settled = run(["space", "init", root, "--refresh"], fixture);
		expect(settled.status, flat(settled.stderr)).toBe(0);
		expect(flat(settled.stdout)).toContain("already up to date");
	});

	it("a first init whose push is definitely refused restores its original state", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		writeConfig();
		rejectSpacePushes(true);
		const root = makeSpace("failed-first-push");
		const result = run(["space", "init", root, "--cadence", "manual"], fixture);
		expect(result.status).not.toBe(0);
		expect(existsSync(join(root, ".hyper", "space.git"))).toBe(false);
		expect(existsSync(join(root, ".gitignore"))).toBe(false);
		expect(flat(result.stderr)).not.toContain("--refresh");
		expect(remoteHasRef("space/failed-first-push")).toBe(false);
		expect(manifestFromCheckout("failed-first-push")).toBeUndefined();
	});
});

describe("the .gitignore the space already has", () => {
	it("a first init refuses to overwrite a .gitignore it did not write", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		writeConfig();
		const root = makeSpace("own-gitignore");
		const mine = "notes/local-scratch.txt\n";
		writeFileSync(join(root, ".gitignore"), mine);

		const result = run(["space", "init", root, "--cadence", "manual"], fixture);
		expect(result.status).not.toBe(0);
		expect(flat(result.stderr)).toContain(".gitignore.pre-hyper");
		// Untouched, and nothing else written either.
		expect(readFileSync(join(root, ".gitignore"), "utf-8")).toBe(mine);
		expect(existsSync(join(root, ".hyper", "space.git"))).toBe(false);
	});

	it("re-renders an allowlist that still carries hyper's marker", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		writeConfig();
		const root = makeSpace("refresh-gitignore");
		expect(run(["space", "init", root, "--cadence", "manual"], fixture).status).toBe(0);
		// The user added a line but did not remove the marker: the file is still
		// hyper's, so a refresh re-renders it.
		writeFileSync(join(root, ".gitignore"), `edited by hand\n${ALLOWLIST_MARKER}\n`);
		expect(run(["space", "init", root, "--refresh"], fixture).status).toBe(0);
		expect(readFileSync(join(root, ".gitignore"), "utf-8")).toContain("!/notes/**");
	});

	it("a refresh refuses a .gitignore whose marker is gone", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		writeConfig();
		const root = makeSpace("foreign-refresh");
		expect(run(["space", "init", root, "--cadence", "manual"], fixture).status).toBe(0);
		// Ownership is decided from THE FILE, on a refresh exactly as on a first
		// init: a replaced file that no longer says it is hyper's gets the same
		// advice, not a silent overwrite.
		writeFileSync(join(root, ".gitignore"), "someone else's rules\n");
		const result = run(["space", "init", root, "--refresh"], fixture);
		expect(result.status).not.toBe(0);
		const err = flat(result.stderr);
		expect(err).toContain(".gitignore.pre-hyper");
		expect(readFileSync(join(root, ".gitignore"), "utf-8")).toBe("someone else's rules\n");
	});
});

describe("a failure after the branch is pushed", () => {
	it("a failed manifest write says the space is safe and names the command that finishes it", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		// root ignores the mode bits, so a read-only `.git` would still be
		// writable and the test would pass for the wrong reason.
		if (process.getuid?.() === 0) {
			ctx.skip("running as root: a read-only .git is still writable");
			return;
		}
		writeConfig();
		const root = makeSpace("manifest-fails");
		mkdirSync(join(root, "extra"), { recursive: true });
		writeFileSync(join(root, "extra", "e.md"), "extra\n");
		// A real checkout first, then take away its ability to write: every step
		// before the manifest write then succeeds, which is the whole point —
		// the branch is already on the hyperdrive when the write fails.
		expect(
			spawnCli(
				["drive", "init", "--remote", fixture.remote, "--name", "m", "--home", "/tmp"],
				fixture,
			).status,
		).toBe(0);
		// Read-only `.git`, so the manifest LOCK cannot be taken. (Replacing
		// spaces.yaml with a directory does not work: the manifest's replay
		// path runs `git reset --hard`, which puts the file straight back.)
		const driveGitDir = join(fixture.hyperHome, "drive", ".git");
		chmodSync(driveGitDir, 0o500);

		try {
			const result = spawnCli(
				["space", "init", root, "--cadence", "manual", "--tracked", "extra"],
				fixture,
			);
			expect(result.status).not.toBe(0);
			const err = flat(result.stderr);
			expect(err).toContain("space/manifest-fails");
			expect(err).toContain("--refresh");
			expect(err).not.toContain("at Init.run");
			// The truth of the claim: the branch IS on the hyperdrive, and it
			// carries the tracked directory the manifest never got to record.
			expect(remoteTree("space/manifest-fails")).toEqual([
				".gitignore",
				"data/d.json",
				"extra/e.md",
				"notes/a.md",
			]);

			// NIT 9: run the recovery the message prescribes. `extra` exists only
			// in the space's own git dir so far, so this is the assertion that a
			// lost manifest write loses nothing.
			chmodSync(driveGitDir, 0o700);
			const recovery = run(["space", "init", root, "--refresh"], fixture);
			expect(recovery.status, flat(recovery.stderr)).toBe(0);
			expect(localTracked(root)).toEqual(["extra"]);
			expect(manifestFromCheckout("manifest-fails")?.tracked).toEqual(["extra"]);
		} finally {
			// Restored even when an assertion above throws, so the fixture's
			// cleanup is not left fighting a read-only directory.
			chmodSync(driveGitDir, 0o700);
		}
	});
});

describe("probes from round 1", () => {
	it("a space whose branch is not on the remote yet gets the clash probe", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		writeConfig();
		const root = makeSpace("lost-branch");
		expect(
			run(["space", "init", root, "--group", "team", "--cadence", "manual"], fixture).status,
		).toBe(0);
		expect(remoteHasRef("space/team/lost-branch")).toBe(true);

		// The branch goes missing from the hyperdrive (a pruned ref, a remote
		// that lost it) while another space takes the name this one's group
		// wants. The refresh is about to re-create `space/team/lost-branch`, so
		// it must see the clash — even though this is not a first init.
		git(
			["--git-dir", fixture.remote, "update-ref", "-d", "refs/heads/space/team/lost-branch"],
			fixture.root,
		);
		const main = git(["--git-dir", fixture.remote, "rev-parse", "main"], fixture.root).trim();
		git(["--git-dir", fixture.remote, "update-ref", "refs/heads/space/team", main], fixture.root);

		const refresh = run(["space", "init", root, "--group", "team", "--refresh"], fixture);
		expect(refresh.status).not.toBe(0);
		expect(flat(refresh.stderr)).toContain("space/team");
		expect(remoteHasRef("space/team/lost-branch")).toBe(false);
	});

	it("a repo with no origin is warned about once per init, not on every refresh", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		writeConfig();
		// makeSpace gives the project's bare repo no `remote.origin.url`.
		const root = makeSpace("no-origin");
		const first = run(["space", "init", root, "--cadence", "manual"], fixture);
		expect(first.status, flat(first.stderr)).toBe(0);
		expect(flat(first.stderr)).toContain("no remote.origin.url");

		const refresh = run(["space", "init", root, "--refresh"], fixture);
		expect(refresh.status, flat(refresh.stderr)).toBe(0);
		expect(flat(refresh.stderr)).not.toContain("no remote.origin.url");
		// Still recorded truthfully as no repos, not invented.
		expect(manifestFromCheckout("no-origin")?.repos).toEqual([]);
	});
});

/**
 * Round-2 review. Every one of these fails against the round-1 code, which is
 * the point: they are written as the reviewer's reproductions, not as a
 * description of the fix.
 */
describe("a failed run puts the space back", () => {
	it("a refused refresh restores the .gitignore it replaced", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		writeConfig();
		const root = makeSpace("restore-allowlist");
		expect(run(["space", "init", root, "--cadence", "manual"], fixture).status).toBe(0);
		const before = readFileSync(join(root, ".gitignore"), "utf-8");

		// Repro A: the secret guard refuses AFTER the allowlist was re-rendered.
		mkdirSync(join(root, "extra"), { recursive: true });
		writeFileSync(join(root, "extra", ".env"), "TOKEN=secret\n");
		const refused = run(["space", "init", root, "--refresh", "--tracked", "extra"], fixture);
		expect(refused.status).not.toBe(0);
		// The allowlist is exactly what it was — not deleted, not half-rendered.
		expect(readFileSync(join(root, ".gitignore"), "utf-8")).toBe(before);
		expect(existsSync(join(root, ".hyper", "space.git"))).toBe(true);

		// Repro B: the same, with a push the hyperdrive refuses. The new file
		// has to be ALLOWLISTED (`notes/`, not `extra/`): after Repro A's
		// rollback `extra` is no longer tracked, so a file under it is ignored,
		// nothing is committed, and the push is a no-op git happily accepts —
		// which would test nothing about a refused push.
		rmSync(join(root, "extra", ".env"), { force: true });
		rejectSpacePushes(true);
		writeFileSync(join(root, "notes", "new.md"), "new\n");
		writeFileSync(join(root, "extra", "note.md"), "still ignored\n");
		const pushRefused = run(["space", "init", root, "--refresh"], fixture);
		expect(pushRefused.status).not.toBe(0);
		expect(readFileSync(join(root, ".gitignore"), "utf-8")).toBe(before);
		// And the space is still safe to re-run: the worktrees are still ignored.
		// Checked per PATH, not against a literal element: `not.toContain(
		// "worktrees/")` compares whole elements and could never fail, because
		// no element of a tree listing IS "worktrees/".
		rejectSpacePushes(false);
		expect(run(["space", "init", root, "--refresh"], fixture).status).toBe(0);
		const tree = remoteTree("space/restore-allowlist");
		expect(tree.some((path) => path.startsWith("worktrees/"))).toBe(false);
		expect(tree.some((path) => path.startsWith("scratch/"))).toBe(false);
		expect(tree.some((path) => path.includes(".env"))).toBe(false);
	});

	it("a --tracked added by a refused run survives into the next one", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		writeConfig();
		const root = makeSpace("sticky-tracked");
		expect(run(["space", "init", root, "--cadence", "manual"], fixture).status).toBe(0);

		// The push the hyperdrive refuses: `more` is added, and the run dies
		// before the manifest is ever written.
		rejectSpacePushes(true);
		mkdirSync(join(root, "more"), { recursive: true });
		writeFileSync(join(root, "more", "m.md"), "more\n");
		const failed = run(["space", "init", root, "--refresh", "--tracked", "more"], fixture);
		expect(failed.status).not.toBe(0);
		expect(manifestFromCheckout("sticky-tracked")?.tracked ?? []).toEqual([]);
		// The truth is in the space's OWN git dir (C-11), which the run wrote
		// before the commit.
		expect(localTracked(root)).toEqual(["more"]);
		// So the recovery the error message prescribes keeps it.
		rejectSpacePushes(false);
		const recovered = run(["space", "init", root, "--refresh"], fixture);
		expect(recovered.status, flat(recovered.stderr)).toBe(0);
		expect(localTracked(root)).toEqual(["more"]);
		expect(manifestFromCheckout("sticky-tracked")?.tracked).toEqual(["more"]);
		expect(readFileSync(join(root, ".gitignore"), "utf-8")).toContain("!/more/**");
		expect(remoteTree("space/sticky-tracked")).toContain("more/m.md");
	});

	it("a first init against an unreachable hyperdrive leaves no git dir behind", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		writeConfig();
		// A real checkout first: `ensureDriveCheckout` then only warns about the
		// missing remote, and the failure has to happen further in.
		expect(
			spawnCli(
				["drive", "init", "--remote", fixture.remote, "--name", "m", "--home", "/tmp"],
				fixture,
			).status,
		).toBe(0);
		const root = makeSpace("unreachable");

		const moved = `${fixture.remote}.away`;
		renameSync(fixture.remote, moved);
		const offline = run(["space", "init", root, "--cadence", "manual"], fixture);
		renameSync(moved, fixture.remote);
		expect(offline.status).not.toBe(0);
		expect(flat(offline.stderr)).toContain("hyperdrive");
		// The whole point: nothing was left for the next run to trip over.
		expect(existsSync(join(root, ".hyper", "space.git"))).toBe(false);
		expect(existsSync(join(root, ".gitignore"))).toBe(false);

		// And with the hyperdrive back, plain init works.
		expect(run(["space", "init", root, "--cadence", "manual"], fixture).status).toBe(0);
		expect(remoteHasRef("space/unreachable")).toBe(true);
	});
});

describe("one name, one branch", () => {
	it("a name already recorded on another branch is refused", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		writeConfig();
		const first = makeSpace("in-a");
		expect(
			spawnCli(
				["space", "init", first, "--name", "shared", "--group", "a", "--cadence", "manual"],
				fixture,
			).status,
		).toBe(0);

		// A different directory, the same name, a different group.
		const second = makeSpace("in-b");
		const clash = spawnCli(
			["space", "init", second, "--name", "shared", "--group", "b", "--cadence", "manual"],
			fixture,
		);
		expect(clash.status).not.toBe(0);
		const err = flat(clash.stderr);
		expect(err).toContain("space/a/shared");
		expect(err).toContain("--name");
		// The first space's entry is untouched — not overwritten by the second.
		expect(manifestFromCheckout("shared")?.branch).toBe("space/a/shared");
		expect(existsSync(join(second, ".hyper", "space.git"))).toBe(false);

		// And refreshing the first keeps ITS OWN tracked list, not the other's.
		mkdirSync(join(first, "only-a"), { recursive: true });
		expect(
			spawnCli(
				[
					"space",
					"init",
					first,
					"--group",
					"a",
					"--name",
					"shared",
					"--refresh",
					"--tracked",
					"only-a",
				],
				fixture,
			).status,
		).toBe(0);
		expect(manifestFromCheckout("shared")?.tracked).toEqual(["only-a"]);
		expect(localTracked(first)).toEqual(["only-a"]);
	});
});

describe("failures that reach the hyperdrive", () => {
	it("a branch that moved on says so, and names no command that does not exist", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		writeConfig();
		const root = makeSpace("moved-on");
		expect(run(["space", "init", root, "--cadence", "manual"], fixture).status).toBe(0);

		// Another machine pushed a different history onto this branch.
		const main = git(["--git-dir", fixture.remote, "rev-parse", "main"], fixture.root).trim();
		git(
			["--git-dir", fixture.remote, "update-ref", "refs/heads/space/moved-on", main],
			fixture.root,
		);
		git(
			["--git-dir", fixture.remote, "update-ref", "refs/remotes/origin/space/moved-on", main],
			fixture.root,
		);
		writeFileSync(join(root, "notes", "diverge.md"), "mine\n");

		const result = run(["space", "init", root, "--refresh"], fixture);
		expect(result.status).not.toBe(0);
		const err = flat(result.stderr);
		expect(err).toContain("moved on");
		expect(err).toContain("another machine");
		// git's own hint names `git pull`, which for a space branch is not a
		// thing anyone should be told to type.
		expect(err).not.toContain("git pull");
		expect(err).not.toContain("non-fast-forward");
	});

	it("an unreachable hyperdrive says where it could not reach", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		writeConfig();
		expect(
			spawnCli(
				["drive", "init", "--remote", fixture.remote, "--name", "m", "--home", "/tmp"],
				fixture,
			).status,
		).toBe(0);
		const root = makeSpace("gone-remote");
		const moved = `${fixture.remote}.away`;
		renameSync(fixture.remote, moved);
		const offline = run(["space", "init", root, "--cadence", "manual"], fixture);
		renameSync(moved, fixture.remote);
		expect(offline.status).not.toBe(0);
		const err = flat(offline.stderr);
		expect(err).toContain("couldn't reach your hyperdrive");
		expect(err).toContain(fixture.remote);
		expect(err).not.toContain("No such file or directory");
	});
});

describe("hyper's own allowlist", () => {
	it("a hyper-written .gitignore is recognised even when it differs", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		writeConfig();
		const root = makeSpace("own-render");
		expect(
			run(["space", "init", root, "--cadence", "manual", "--tracked", "extra"], fixture).status,
		).toBe(0);

		// Lose the git dir (a machine that re-inits from scratch) and init again
		// with no --tracked: today's render differs from the file on disk, and
		// the marker says the file is still hyper's.
		rmSync(join(root, ".hyper", "space.git"), { recursive: true, force: true });
		// The branch goes with it: a space re-initialised from nothing has no
		// history to push over the one already there, and that is a different
		// story (T-7's) than the one this test is about.
		git(
			["--git-dir", fixture.remote, "update-ref", "-d", "refs/heads/space/own-render"],
			fixture.root,
		);
		const again = run(["space", "init", root, "--cadence", "manual"], fixture);
		expect(again.status, flat(again.stderr)).toBe(0);
		// And the space keeps what it had: `hyper.tracked` was in the git dir we
		// just deleted, but the manifest still has it.
		expect(manifestFromCheckout("own-render")?.tracked).toEqual(["extra"]);
		expect(readFileSync(join(root, ".gitignore"), "utf-8")).toContain("!/extra/**");
	});
});

describe("tracked entries are normalised", () => {
	it("`extra` and `extra/` are one tracked entry everywhere", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		writeConfig();
		const root = makeSpace("normalised");
		expect(
			spawnCli(
				[
					"space",
					"init",
					root,
					"--cadence",
					"manual",
					"--tracked",
					"extra",
					"--tracked",
					"./more/",
				],
				fixture,
			).status,
		).toBe(0);
		expect(run(["space", "init", root, "--refresh", "--tracked", "extra/"], fixture).status).toBe(
			0,
		);
		expect(localTracked(root)).toEqual(["extra", "more"]);
		expect(manifestFromCheckout("normalised")?.tracked).toEqual(["extra", "more"]);
	});
});

/**
 * Round-3 review. The three reproductions N1/N2/K3 and the two state rules, each
 * written so it fails against the round-2 code.
 */
describe("a refusal changes nothing at all", () => {
	it("a refused refresh leaves an unchanged allowlist in place", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		writeConfig();
		const root = makeSpace("unchanged-allowlist");
		expect(run(["space", "init", root, "--cadence", "manual"], fixture).status).toBe(0);
		const before = readFileSync(join(root, ".gitignore"), "utf-8");

		// No --tracked, so the render does not change at all: this is the case
		// where "the file equals the render" and "the file is gone" looked the
		// same to the rollback.
		writeFileSync(join(root, "notes", ".env"), "TOKEN=secret\n");
		const refused = run(["space", "init", root, "--refresh"], fixture);
		expect(refused.status).not.toBe(0);
		expect(existsSync(join(root, ".gitignore"))).toBe(true);
		expect(readFileSync(join(root, ".gitignore"), "utf-8")).toBe(before);
	});

	it("a refused push after a commit leaves the allowlist HEAD expects", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		writeConfig();
		const root = makeSpace("commit-keeps-render");
		mkdirSync(join(root, "extra"), { recursive: true });
		writeFileSync(join(root, "extra", "e.md"), "extra\n");
		expect(run(["space", "init", root, "--cadence", "manual"], fixture).status).toBe(0);
		const before = readFileSync(join(root, ".gitignore"), "utf-8");

		// A run that COMMITS and then finds the push refused keeps everything it
		// wrote: HEAD holds the new render, so restoring the old one would leave
		// `git status` dirty against its own history.
		rejectSpacePushes(true);
		writeFileSync(join(root, "extra", "later.md"), "later\n");
		const refused = run(["space", "init", root, "--refresh", "--tracked", "more"], fixture);
		expect(refused.status).not.toBe(0);
		expect(localCount(root)).toBe(2);
		const status = git(
			["--git-dir", join(root, ".hyper", "space.git"), "status", "--porcelain"],
			root,
		);
		expect(status.trim()).not.toContain(".gitignore");
		expect(status.trim()).not.toContain("M ");
		// Whatever the outcome, the file exists and is one of the two renders —
		// never missing.
		expect(existsSync(join(root, ".gitignore"))).toBe(true);
		expect([before, readFileSync(join(root, ".gitignore"), "utf-8")]).toContain(
			readFileSync(join(root, ".gitignore"), "utf-8"),
		);
	});

	it("a definitely refused first-init push preserves the existing allowlist but removes its git dir", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		writeConfig();
		// A hyper-written allowlist that is already exactly what this init would
		// render: the foreign-file refusal must not fire, and the refusal that
		// follows must not delete a file this run never wrote.
		const root = makeSpace("identical-allowlist");
		const first = run(["space", "init", root, "--cadence", "manual"], fixture);
		expect(first.status, flat(first.stderr)).toBe(0);
		const allowlist = readFileSync(join(root, ".gitignore"), "utf-8");
		rmSync(join(root, ".hyper"), { recursive: true, force: true });
		rejectSpacePushes(true);
		writeFileSync(join(root, "notes", "b.md"), "more\n");

		const refused = run(["space", "init", root, "--cadence", "manual"], fixture);
		expect(refused.status).not.toBe(0);
		expect(readFileSync(join(root, ".gitignore"), "utf-8")).toBe(allowlist);
		// The final ruling distinguishes a definite refusal from an unknown
		// push outcome: first-init refusals remove new history, not this file.
		expect(existsSync(join(root, ".hyper"))).toBe(false);
		expect(flat(refused.stderr)).not.toContain("--refresh");
	});
});

describe("state a refusal must not leave behind", () => {
	it("a refused --tracked is rolled back, so a later refresh works", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		writeConfig();
		const root = makeSpace("rollback-tracked");
		expect(run(["space", "init", root, "--cadence", "manual"], fixture).status).toBe(0);
		const before = readFileSync(join(root, ".gitignore"), "utf-8");

		// `--tracked extra` where the directory holds a secret: refused BEFORE the
		// commit, so `hyper.tracked` must not keep `extra` — otherwise every
		// later plain `--refresh` fails the same way with nothing to remove it.
		mkdirSync(join(root, "extra"), { recursive: true });
		writeFileSync(join(root, "extra", ".env"), "TOKEN=secret\n");
		const refused = run(["space", "init", root, "--refresh", "--tracked", "extra"], fixture);
		expect(refused.status).not.toBe(0);
		expect(localTracked(root)).toEqual([]);
		expect(readFileSync(join(root, ".gitignore"), "utf-8")).toBe(before);

		// Remove the secret and a plain refresh succeeds with the OLD list.
		rmSync(join(root, "extra", ".env"), { force: true });
		const recovered = run(["space", "init", root, "--refresh"], fixture);
		expect(recovered.status, flat(recovered.stderr)).toBe(0);
		expect(localTracked(root)).toEqual([]);
		expect(manifestFromCheckout("rollback-tracked")?.tracked).toEqual([]);
	});

	it("a refused --cadence is rolled back too", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		writeConfig();
		const root = makeSpace("rollback-cadence");
		expect(run(["space", "init", root, "--cadence", "manual"], fixture).status).toBe(0);
		writeFileSync(join(root, "notes", ".env"), "TOKEN=secret\n");
		const refused = spawnCli(
			["space", "init", root, "--refresh", "--cadence", "session-end+push"],
			fixture,
		);
		expect(refused.status).not.toBe(0);
		expect(cadenceIn(root)).toBe("manual");
	});
});

describe("a push the hyperdrive declines", () => {
	it("says the hyperdrive refused it, and quotes the hook's reason", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		writeConfig();
		const root = makeSpace("declined");
		expect(run(["space", "init", root, "--cadence", "manual"], fixture).status).toBe(0);

		// A hook that DECLINES with a reason, and that can still take `main` so
		// the manifest checkout is unaffected.
		const hook = join(fixture.remote, "hooks", "pre-receive");
		writeFileSync(
			hook,
			'#!/bin/sh\nwhile read o n r; do\n\tcase "$r" in refs/heads/space/*) echo "spaces are closed for maintenance"; exit 1;; esac\ndone\nexit 0\n',
			{ mode: 0o755 },
		);
		writeFileSync(join(root, "notes", "blocked.md"), "blocked\n");
		const result = run(["space", "init", root, "--refresh"], fixture);

		const err = flat(result.stderr);
		expect(result.status).not.toBe(0);
		// Reached and refused is not unreachable.
		expect(err).not.toContain("couldn't reach your hyperdrive");
		expect(err).toContain("refused to take space/declined");
		expect(err).toContain("spaces are closed for maintenance");
		rmSync(hook, { force: true });
	});

	it("says 'without --group' when the other space has no group", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		writeConfig();
		const first = makeSpace("plain");
		expect(run(["space", "init", first, "--cadence", "manual"], fixture).status).toBe(0);
		const clash = makeSpace("grouped");
		// The SAME name as the first space: names are unique across groups, so
		// this is the collision the advice is written for.
		const result = spawnCli(
			["space", "init", clash, "--name", "plain", "--group", "somewhere", "--cadence", "manual"],
			fixture,
		);
		expect(result.status).not.toBe(0);
		const err = flat(result.stderr);
		// The advice must not print an empty `--group `; it says "without
		// `--group`" for a space that has no group of its own.
		expect(err).toContain("without `--group`");
		expect(err).not.toContain("--group somewhere");
	});
});

/**
 * PR #32 cold-read findings. Every test here fails against `e41be5ee`.
 */
describe("paths git would quote", () => {
	it("refuses a secret whose path has a non-ASCII character", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		writeConfig();
		for (const [label, path] of [
			["non-ASCII", "notes/clé/server.pem"],
			["a space", "notes/with space/secret.key"],
			["a quote", 'notes/it\'s "quoted"/secret.key'],
			["a trailing space", "notes/trailing /secret.key"],
		] as const) {
			const root = makeSpace(`quoted-${label.toLowerCase().replace(/\W+/g, "-")}`);
			mkdirSync(dirname(join(root, path)), { recursive: true });
			writeFileSync(join(root, path), "-----BEGIN PRIVATE KEY-----\n");
			const result = run(["space", "init", root, "--cadence", "manual"], fixture);
			expect(result.status, `${label}: ${flat(result.stderr)}`).not.toBe(0);
			expect(flat(result.stderr), label).toContain("secret guard");
			// And, decisively: nothing was pushed. `remoteHasRef` rather than
			// listing the tree — the branch should not exist at all, and
			// `ls-tree` on a missing ref is an error, not an empty result.
			expect(remoteHasRef(remoteBranchFor(root))).toBe(false);
		}
	});

	it("a benign path with the same characters is tracked normally", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		// The other half of the story: the guard must not become a blanket
		// refusal of unusual names, or every non-ASCII path is unsaveable.
		writeConfig();
		const root = makeSpace("benign-unicode");
		const path = "notes/café/résumé.md";
		mkdirSync(dirname(join(root, path)), { recursive: true });
		writeFileSync(join(root, path), "fine\n");
		expect(run(["space", "init", root, "--cadence", "manual"], fixture).status).toBe(0);
		expect(remoteTree(remoteBranchFor(root))).toContain(path);
	});
});

describe("an interrupted first init", () => {
	it("plain init resumes a git dir with no commit instead of refusing", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		writeConfig();
		// Nothing has been pushed for this space, so the resumed first init has
		// a branch to create — which is the situation an interruption leaves.
		const root = makeSpace("interrupted");
		initOrphanSpaceGitDir(root);
		writeFileSync(join(root, "notes", "after.md"), "after\n");

		const resumed = run(["space", "init", root, "--cadence", "manual"], fixture);
		expect(resumed.status, flat(resumed.stderr)).toBe(0);
		expect(remoteTree("space/interrupted")).toContain("notes/after.md");
		expect(manifestFromCheckout("interrupted")?.branch).toBe("space/interrupted");
	});

	it("--refresh on an unfinished first init behaves as a first init", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		writeConfig();
		const root = makeSpace("interrupted-refresh");
		initOrphanSpaceGitDir(root);
		// A user's own .gitignore, and the marker is absent: a refresh that
		// skipped the foreign-file guard would overwrite this and then report a
		// space it never registered.
		writeFileSync(join(root, ".gitignore"), "mine\n");

		const result = run(["space", "init", root, "--refresh", "--cadence", "manual"], fixture);
		expect(result.status).not.toBe(0);
		expect(result.stderr).toContain(
			`warning: ${join(root, ".hyper", "space.git")} has no commit yet`,
		);
		expect(flat(result.stderr)).toContain(".gitignore.pre-hyper");
		expect(readFileSync(join(root, ".gitignore"), "utf-8")).toBe("mine\n");
	});
});

describe("a nested repository under an allowlisted directory", () => {
	it("is unstaged, named in the warning, and never committed as a gitlink", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		writeConfig();
		const root = makeSpace("with-vendor");
		const vendor = join(root, "notes", "vendor");
		mkdirSync(vendor, { recursive: true });
		makeNestedRepo(vendor, "module.exports = 1;\n");

		const result = run(["space", "init", root, "--cadence", "manual"], fixture);
		expect(result.status, flat(result.stderr)).toBe(0);
		// Named, so the reader knows what is NOT being backed up.
		expect(flat(result.stderr)).toContain("notes/vendor");
		expect(flat(result.stderr)).toContain("its own git repository");
		// And it is a mode-160000 entry nowhere in the branch.
		const modes = git(
			["--git-dir", fixture.remote, "ls-tree", "-r", "space/with-vendor"],
			fixture.root,
		);
		expect(modes).not.toContain("160000");
		expect(remoteTree("space/with-vendor")).not.toContain("notes/vendor");

		// In `--json` it is reported as skipped, not silently dropped.
		const other = makeSpace("with-vendor-json");
		const vendor2 = join(other, "notes", "vendor");
		mkdirSync(vendor2, { recursive: true });
		makeNestedRepo(vendor2, "");
		const json = run(["space", "init", other, "--json", "--cadence", "manual"], fixture);
		expect(JSON.parse(json.stdout).skipped).toEqual(["notes/vendor"]);
	});
});

describe("an ambiguous push failure", () => {
	it("treats a push that failed after landing as done", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		writeConfig();
		const root = makeSpace("half-pushed");
		expect(run(["space", "init", root, "--cadence", "manual"], fixture).status).toBe(0);

		// The hard case: the push REALLY lands and then reports failure — a
		// dropped connection, a killed client. A hook cannot reproduce it (git
		// never contacts the remote when it is already up to date, so no hook
		// runs and the push exits 0), so `git` itself is shimmed: the push runs
		// for real, then exits non-zero.
		writeFileSync(join(root, "notes", "landed.md"), "landed\n");
		const restore = pushFailsAfterLanding();
		try {
			const result = run(["space", "init", root, "--refresh"], fixture);
			// The commit is on the hyperdrive, so the one thing that matters
			// happened: this is not a failure, and the command says so.
			expect(result.status, flat(result.stderr)).toBe(0);
			expect(remoteTree("space/half-pushed")).toContain("notes/landed.md");
			// The only local copy of that commit survives.
			expect(existsSync(join(root, ".hyper", "space.git"))).toBe(true);
			// And the run finishes the job it was asked for.
			expect(manifestFromCheckout("half-pushed")?.branch).toBe("space/half-pushed");
			expect(flat(result.stderr)).toContain("Continuing");
		} finally {
			restore();
		}
	});
});

describe("one name, one branch, checked under the lock", () => {
	it("refuses a colliding name even when the checkout was stale", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		writeConfig();
		const first = makeSpace("locked-a");
		expect(
			run(
				["space", "init", first, "--name", "shared", "--group", "a", "--cadence", "manual"],
				fixture,
			).status,
		).toBe(0);

		// A SECOND checkout whose `main` is behind the remote: its pre-check reads
		// a manifest with no entry for `shared`, so only the check under the lock
		// — against the freshly-fetched base — can catch this.
		const staleHome = join(fixture.root, "stale-home");
		mkdirSync(staleHome, { recursive: true });
		const staleDir = join(staleHome, "drive");
		spawnSync("git", ["clone", "--branch", "main", "--single-branch", fixture.remote, staleDir], {
			encoding: "utf8",
		});
		// Make the stale checkout genuinely stale: drop the entry it just cloned.
		rmSync(join(staleDir, "spaces.yaml"), { force: true });
		spawnSync("git", ["-C", staleDir, "commit", "-qm", "drop manifest"], { encoding: "utf8" });

		const second = makeSpace("locked-b");
		const withHome = { ...process.env, HYPER_HOME: staleHome };
		const result = spawnSync(
			process.execPath,
			[
				join(import.meta.dirname, "..", "..", "cli", "bin", "run.js"),
				"space",
				"init",
				second,
				"--name",
				"shared",
				"--group",
				"b",
				"--cadence",
				"manual",
			],
			{
				encoding: "utf8",
				env: {
					...withHome,
					HOME: fixture.home,
					// The real `~/.config/hyper/drive.toml` must never be reachable
					// from a fixture: this spawn runs outside `spawnCli`, which is
					// what normally points HYPER_DRIVE_CONFIG at the temp tree.
					HYPER_DRIVE_CONFIG: fixture.configFile,
					XDG_CONFIG_HOME: join(fixture.root, "config"),
					NO_COLOR: "1",
					FORCE_COLOR: "0",
				},
			},
		);
		expect(result.status).not.toBe(0);
		expect(flat(result.stderr)).toContain("space/a/shared");
		// The first space's entry survived.
		expect(manifestFromCheckout("shared")?.branch).toBe("space/a/shared");
	});
});

/** Private PATH shim; only space-git calls enter the injected script. */
function spaceGitShim(script: string, spaceOnly = true): () => void {
	const real = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
	const dir = join(fixture.root, "r5-shim");
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, "git"),
		`#!/bin/sh\nREAL=${shellQuote(real)}\ncase "$*" in\n  ${spaceOnly ? "*space.git*" : "*"})\n${script}\n;;\nesac\nexec "$REAL" "$@"\n`,
		{ mode: 0o755 },
	);
	const saved = process.env.PATH;
	process.env.PATH = `${dir}:${saved ?? ""}`;
	return () => {
		if (saved === undefined) delete process.env.PATH;
		else process.env.PATH = saved;
	};
}

function initialiseDrive(): void {
	expect(
		spawnCli(
			["drive", "init", "--remote", fixture.remote, "--name", "m", "--home", fixture.home],
			fixture,
		).status,
	).toBe(0);
}

/** Ready-to-push competing manifest, created without publishing it yet. */
function prepareNameRace(): string {
	initialiseDrive();
	const other = join(fixture.root, "racer");
	git(["clone", "--branch", "main", fixture.remote, other], fixture.root);
	const entry: SpaceEntry = {
		name: "raced",
		branch: "space/winner/raced",
		group: "winner",
		path: "/other/machine",
		layout: "bare",
		repos: [],
		cadence: "manual",
		tracked: [],
		public: [],
	};
	// JSON is valid YAML, and the fixture's schema is exactly a manifest's.
	writeFileSync(join(other, "spaces.yaml"), JSON.stringify({ spaces: [entry] }));
	git(["add", "spaces.yaml"], other);
	git(["commit", "-qm", "register the competing space"], other);
	return other;
}

// These tests reproduce failures through the built CLI, not a mocked command.
describe("space init recovery regressions", () => {
	it.for(["unreachable", "different-sha"])(
		"does not register an unconfirmed push: %s",
		(mode, ctx) => {
			if (skipIfUnbuilt(ctx)) return;
			writeConfig();
			initialiseDrive();
			const root = makeSpace("unconfirmed");
			const failed = join(fixture.root, "push-failed");
			const restore = spaceGitShim(`
case " $* " in
  *" push "*) touch ${shellQuote(failed)}; echo 'Could not resolve host' >&2; exit 1;;
  *" ls-remote "*)
    if [ -f ${shellQuote(failed)} ]; then
      ${mode === "unreachable" ? "echo 'Could not resolve host' >&2; exit 1" : "printf '1111111111111111111111111111111111111111\\trefs/heads/space/unconfirmed\\n'; exit 0"}
    fi;;
esac`);
			try {
				const result = run(["space", "init", root, "--cadence", "manual"]);
				expect(result.status, flat(result.stderr)).not.toBe(0);
				expect(flat(result.stderr)).toContain("couldn't confirm the push");
				expect(flat(result.stderr)).toContain("commit is kept locally");
				expect(flat(result.stderr)).toContain("hyper space init --refresh");
				expect(result.stdout).not.toContain("Manifest:");
				expect(localCount(root)).toBe(1);
				expect(remoteHasRef("space/unconfirmed")).toBe(false);
				expect(manifestFromCheckout("unconfirmed")).toBeUndefined();
				expect(manifestEntry("unconfirmed")).toBeUndefined();
			} finally {
				restore();
			}
			const retry = run(["space", "init", root, "--refresh"]);
			expect(retry.status, flat(retry.stderr)).toBe(0);
			expect(localCount(root)).toBe(1);
			expect(flat(retry.stdout)).toContain("Manifest: registered");
			expect(manifestEntry("unconfirmed")?.branch).toBe("space/unconfirmed");
		},
	);

	it("resumes an unborn space with this run's name, not the abandoned branch", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		writeConfig();
		const root = makeSpace("abandoned");
		initOrphanSpaceGitDir(root);
		const result = run(["space", "init", root, "--name", "renamed", "--cadence", "manual"]);
		expect(result.status, flat(result.stderr)).toBe(0);
		expect(remoteHasRef("space/abandoned")).toBe(false);
		expect(remoteTree("space/renamed")).toContain("notes/a.md");
		expect(manifestEntry("renamed")?.branch).toBe("space/renamed");
	});

	it.for(["other-history", "broken-head"])(
		"does not recreate an unreadable HEAD with %s",
		(kind, ctx) => {
			if (skipIfUnbuilt(ctx)) return;
			writeConfig();
			const root = makeSpace("keep-history");
			expect(run(["space", "init", root, "--cadence", "manual"]).status).toBe(0);
			const gitDir = join(root, ".hyper", "space.git");
			const before = git(["--git-dir", gitDir, "rev-parse", "refs/heads/space/keep-history"], root);
			if (kind === "other-history")
				git(["--git-dir", gitDir, "symbolic-ref", "HEAD", "refs/heads/unfinished"], root);
			else writeFileSync(join(gitDir, "HEAD"), "not a valid ref\n");
			const head = readFileSync(join(gitDir, "HEAD"), "utf8");
			const config = readFileSync(join(gitDir, "config"), "utf8");
			const result = spawnCli(
				["space", "init", root, "--name", "another", "--cadence", "manual"],
				fixture,
			);
			expect(result.status).not.toBe(0);
			expect(flat(result.stderr)).toContain("left untouched");
			expect(readFileSync(join(gitDir, "HEAD"), "utf8")).toBe(head);
			expect(readFileSync(join(gitDir, "config"), "utf8")).toBe(config);
			// Read the ref file directly: Git rejects the deliberately malformed HEAD.
			expect(readFileSync(join(gitDir, "refs", "heads", "space", "keep-history"), "utf8")).toBe(
				before,
			);
			expect(remoteHasRef("space/another")).toBe(false);
		},
	);

	it("resumes an unborn space on the newly configured hyperdrive", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		writeConfig();
		const root = makeSpace("new-remote");
		initOrphanSpaceGitDir(root);
		const oldRemote = fixture.remote;
		const newRemote = join(fixture.root, "new-remote.git");
		git(["init", "--bare", newRemote], fixture.root);
		fixture.remote = newRemote;
		writeConfig();
		const result = run(["space", "init", root, "--cadence", "manual"]);
		expect(result.status, flat(result.stderr)).toBe(0);
		expect(git(["--git-dir", oldRemote, "for-each-ref", "refs/heads/space"], fixture.root)).toBe(
			"",
		);
		expect(remoteTree("space/new-remote")).toContain("notes/a.md");
		expect(manifestEntry("new-remote")?.branch).toBe("space/new-remote");
	});

	it.for(["before", "after"])("handles a name race %s the space push", (when, ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		writeConfig();
		const racer = prepareNameRace();
		const root = makeSpace("loser");
		const restore = spaceGitShim(`
case " $* " in
  *" ${when === "before" ? "commit" : "push"} "*)
    "$REAL" "$@" || exit $?
    "$REAL" -C ${shellQuote(racer)} push origin main >/dev/null 2>&1 || exit $?
    exit 0;;
esac`);
		try {
			const result = run([
				"space",
				"init",
				root,
				"--name",
				"raced",
				"--group",
				"loser",
				"--cadence",
				"manual",
			]);
			expect(result.status).not.toBe(0);
			const err = flat(result.stderr);
			expect(err).toContain("space/winner/raced");
			expect(manifestEntry("raced")?.branch).toBe("space/winner/raced");
			expect(remoteHasRef("space/loser/raced")).toBe(when === "after");
			if (when === "after") {
				expect(err).toContain("space/loser/raced was pushed");
				expect(err).toContain('name "raced" now belongs to space/winner/raced');
				// oclif inserts whitespace even INSIDE long path tokens. Compare
				// every non-whitespace byte of the full path and deletion command.
				const unwrapped = err.replace(/\s/g, "");
				expect(unwrapped).toContain(join(root, ".hyper", "space.git").replace(/\s/g, ""));
				expect(err).toContain("hyper space init --name <another>");
				expect(unwrapped).toContain(
					`git push ${shellQuote(fixture.remote)} --delete space/loser/raced`.replace(/\s/g, ""),
				);
				expect(err).not.toContain("--refresh");
				expect(localCount(root)).toBe(1);
			}
		} finally {
			restore();
		}
		if (when === "after") {
			// Follow the actual recovery; hyper must not remove the old remote ref.
			rmSync(join(root, ".hyper", "space.git"), { recursive: true });
			const retry = run(["space", "init", root, "--name", "another", "--cadence", "manual"]);
			expect(retry.status, flat(retry.stderr)).toBe(0);
			expect(manifestEntry("another")?.branch).toBe("space/another");
			expect(remoteHasRef("space/loser/raced")).toBe(true);
		}
	});

	it("skips unborn nested repositories, including empty and unusual paths", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		writeConfig();
		const root = makeSpace("unborn-vendor");
		const paths = ["notes/vendor", "notes/empty", "extra/deep/a [vendor]\n"];
		for (const path of paths) {
			git(["init", "-q", join(root, path)], root);
			if (path !== "notes/empty") writeFileSync(join(root, path, "local.txt"), "keep locally\n");
		}
		const result = run([
			"space",
			"init",
			root,
			"--tracked",
			"extra",
			"--cadence",
			"manual",
			"--json",
		]);
		expect(result.status, flat(result.stderr)).toBe(0);
		expect(JSON.parse(result.stdout).skipped.sort()).toEqual(paths.sort());
		for (const path of paths) expect(result.stderr).toContain(path);
		expect(result.stderr).toContain("its files are not saved in the space");
		expect(result.stderr).not.toContain("does not have a commit checked out");
		expect(remoteTree("space/unborn-vendor")).toEqual([".gitignore", "data/d.json", "notes/a.md"]);
		for (const path of paths) expect(existsSync(join(root, path, ".git"))).toBe(true);
	});

	it.for([
		{ signal: "SIGINT", phase: "init", refresh: false },
		{ signal: "SIGTERM", phase: "init", refresh: false },
		{ signal: "SIGINT", phase: "setup", refresh: false },
		{ signal: "SIGTERM", phase: "setup", refresh: false },
		{ signal: "SIGINT", phase: "recreate", refresh: false },
		{ signal: "SIGTERM", phase: "recreate", refresh: false },
		{ signal: "SIGINT", phase: "manifest-pull", refresh: false },
		{ signal: "SIGTERM", phase: "manifest-pull", refresh: false },
		{ signal: "SIGINT", phase: "cleanup", refresh: false },
		{ signal: "SIGTERM", phase: "cleanup", refresh: false },
		{ signal: "SIGINT", phase: "cleanup", refresh: true },
		{ signal: "SIGTERM", phase: "cleanup", refresh: true },
		{ signal: "SIGINT", phase: "ls-remote", refresh: false },
		{ signal: "SIGTERM", phase: "ls-remote", refresh: false },
		{ signal: "SIGINT", phase: "push", refresh: false },
		{ signal: "SIGTERM", phase: "push", refresh: false },
		{ signal: "SIGINT", phase: "add", refresh: true },
		{ signal: "SIGTERM", phase: "add", refresh: true },
	] as const)(
		"handles a process-group $signal during $phase (refresh=$refresh)",
		async ({ signal, phase, refresh }, ctx) => {
			if (skipIfUnbuilt(ctx)) return;
			if (process.platform === "win32") return ctx.skip("POSIX process-group signals required");
			writeConfig();
			initialiseDrive();
			const root = makeSpace("interrupted-group");
			if (refresh) expect(run(["space", "init", root, "--cadence", "manual"]).status).toBe(0);
			const before = refresh ? readFileSync(join(root, ".gitignore"), "utf8") : "";
			if (phase === "recreate") initOrphanSpaceGitDir(root);
			mkdirSync(join(root, "extra"));
			writeFileSync(join(root, "extra", "kept.md"), "local file\n");
			const ready = join(fixture.root, "git-ready");
			const blocker = join(fixture.root, "block.cjs");
			writeFileSync(
				blocker,
				`require('node:fs').writeFileSync(${JSON.stringify(ready)}, 'ready'); setInterval(() => {}, 1000);`,
			);
			const cleanupReady = join(fixture.root, "cleanup-ready");
			const cleanupBlocker = join(fixture.root, "cleanup-block.cjs");
			writeFileSync(
				cleanupBlocker,
				`require('node:fs').writeFileSync(${JSON.stringify(cleanupReady)}, 'ready'); setInterval(() => {}, 1000);`,
			);
			const command =
				phase === "setup"
					? "config --local core.bare"
					: phase === "recreate"
						? "config --local --get core.worktree"
						: phase === "manifest-pull"
							? "pull"
							: phase === "cleanup"
								? refresh
									? "add"
									: "ls-remote"
								: phase;
			const restore = spaceGitShim(
				`
${
	phase === "cleanup"
		? `if [ -f ${shellQuote(ready)} ]; then
  case " $* " in
    *" ${refresh ? "config --local --unset-all hyper.tracked" : "reset"} "*) exec ${shellQuote(process.execPath)} ${shellQuote(cleanupBlocker)};;
  esac
fi`
		: ""
}
case " $* " in
  *" ${command} "*)
    ${phase === "manifest-pull" ? `[ -d ${shellQuote(join(root, ".hyper", "space.git"))} ] || exec "$REAL" "$@"` : ""}
    exec ${shellQuote(process.execPath)} ${shellQuote(blocker)};;
esac`,
				phase !== "manifest-pull",
			);
			const child = spawn(
				process.execPath,
				[
					join(import.meta.dirname, "..", "..", "cli", "bin", "run.js"),
					"space",
					"init",
					root,
					"--cadence",
					"session-end",
					"--tracked",
					"extra",
					...(refresh ? ["--refresh"] : []),
				],
				{
					detached: true,
					stdio: ["ignore", "pipe", "pipe"],
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
				},
			);
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
				process.kill(-child.pid!, signal);
				if (phase === "cleanup") {
					await expect.poll(() => existsSync(cleanupReady), { timeout: 10_000 }).toBe(true);
					process.kill(-child.pid!, signal);
				}
				const result = await Promise.race([
					closed,
					new Promise<never>((_, reject) => {
						const timer = setTimeout(
							() => reject(new Error("interrupted CLI did not exit")),
							10_000,
						);
						timer.unref();
					}),
				]);
				expect(result, flat(stderr)).toEqual({ code: 130, signal: null });
				expect(flat(stderr)).not.toContain("couldn't reach");
				if (phase === "push" || phase === "manifest-pull") {
					expect(flat(stderr)).toContain("interrupted: your commit is kept locally");
					expect(flat(stderr)).toContain("hyper space init --refresh");
					expect(localCount(root)).toBe(1);
					expect(localTracked(root)).toEqual(["extra"]);
					expect(cadenceIn(root)).toBe("session-end");
					expect(readFileSync(join(root, ".gitignore"), "utf8")).toContain("!/extra/");
				} else if (phase === "cleanup") {
					expect(flat(stderr)).toContain("interrupted during cleanup:");
					expect(flat(stderr)).not.toContain("nothing was changed");
					if (refresh) {
						expect(flat(stderr)).toContain("hyper.tracked may not be restored");
						expect(localTracked(root)).toEqual(["extra"]);
						expect(cadenceIn(root)).toBe("manual");
						expect(readFileSync(join(root, ".gitignore"), "utf8")).toBe(before);
					} else {
						expect(flat(stderr)).toContain("no space git dir remains");
						expect(existsSync(join(root, ".hyper"))).toBe(false);
						expect(existsSync(join(root, ".gitignore"))).toBe(false);
					}
				} else {
					expect(flat(stderr)).toContain("interrupted: nothing was changed");
					if (refresh) {
						expect(localCount(root)).toBe(1);
						expect(readFileSync(join(root, ".gitignore"), "utf8")).toBe(before);
						expect(localTracked(root)).toEqual([]);
						expect(cadenceIn(root)).toBe("manual");
					} else {
						expect(existsSync(join(root, ".hyper"))).toBe(phase === "recreate");
						expect(existsSync(join(root, ".gitignore"))).toBe(false);
					}
				}
				expect(flat(stderr)).not.toContain("couldn't fast-forward");
				expect(remoteHasRef("space/interrupted-group")).toBe(refresh);
				if (refresh) expect(manifestEntry("interrupted-group")?.cadence).toBe("manual");
				else expect(manifestEntry("interrupted-group")).toBeUndefined();
			} finally {
				try {
					process.kill(-child.pid!, "SIGKILL");
				} catch {
					/* Already exited. */
				}
				await closed;
				restore();
			}
			if (phase === "push" || phase === "manifest-pull") {
				const retry = run(["space", "init", root, "--refresh"]);
				expect(retry.status, flat(retry.stderr)).toBe(0);
				expect(localCount(root)).toBe(1);
				expect(remoteTree("space/interrupted-group")).toContain("extra/kept.md");
			}
		},
		25_000,
	);
});

describe("definite push refusals", () => {
	it.for([
		{ reason: "ahead", refresh: false },
		{ reason: "hook", refresh: false },
		{ reason: "ref-conflict", refresh: false },
		{ reason: "ahead", refresh: true },
		{ reason: "hook", refresh: true },
		{ reason: "ref-conflict", refresh: true },
	] as const)(
		"handles $reason (refresh=$refresh) without uncertain-push advice",
		({ reason, refresh }, ctx) => {
			if (skipIfUnbuilt(ctx)) return;
			writeConfig();
			initialiseDrive();
			const root = makeSpace("refusal");
			if (refresh) expect(run(["space", "init", root, "--cadence", "manual"]).status).toBe(0);
			if (reason === "ahead") {
				const seed = join(fixture.root, "other-machine");
				if (refresh)
					git(["clone", "--branch", "space/refusal", fixture.remote, seed], fixture.root);
				else makeCheckout(seed);
				mkdirSync(join(seed, "notes"), { recursive: true });
				writeFileSync(join(seed, "notes", "remote.md"), "from another machine\n");
				git(["add", "notes/remote.md"], seed);
				git(["commit", "-qm", "other machine pushed first"], seed);
				git(["push", fixture.remote, "HEAD:refs/heads/space/refusal"], seed);
			}
			if (reason === "hook") rejectSpacePushes(true);
			mkdirSync(join(root, "extra"));
			writeFileSync(join(root, "extra", "kept.md"), "local work\n");
			const restore =
				reason === "ref-conflict"
					? spaceGitShim(`
case " $* " in
  *" push "*) echo 'remote: error: cannot lock ref: refname conflict' >&2; exit 1;;
esac`)
					: () => {};
			try {
				const result = run([
					"space",
					"init",
					root,
					"--cadence",
					"session-end",
					"--tracked",
					"extra",
					...(refresh ? ["--refresh"] : []),
				]);
				expect(result.status).toBe(2);
				const err = flat(result.stderr);
				expect(err).not.toContain("--refresh");
				expect(err).not.toContain("couldn't confirm the push");
				expect(err).toContain(
					reason === "ahead"
						? "another machine pushed"
						: reason === "hook"
							? "hook declined"
							: "collides with",
				);
				if (refresh) {
					expect(err).not.toContain("--name");
					expect(err).toContain("local history was kept");
					expect(localCount(root)).toBe(2);
					expect(localTracked(root)).toEqual(["extra"]);
					expect(cadenceIn(root)).toBe("session-end");
					expect(readFileSync(join(root, ".gitignore"), "utf8")).toBe(
						git(["--git-dir", join(root, ".hyper", "space.git"), "show", "HEAD:.gitignore"], root),
					);
					expect(manifestEntry("refusal")?.cadence).toBe("manual");
				} else {
					expect(existsSync(join(root, ".hyper"))).toBe(false);
					expect(existsSync(join(root, ".gitignore"))).toBe(false);
					expect(manifestEntry("refusal")).toBeUndefined();
				}
			} finally {
				restore();
				rejectSpacePushes(false);
			}
			if (!refresh) {
				const retry = run(["space", "init", root, "--name", "other", "--cadence", "manual"]);
				expect(retry.status, flat(retry.stderr)).toBe(0);
				expect(manifestEntry("other")?.branch).toBe("space/other");
			}
		},
	);
});
