import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import type { SpaceEntry } from "#config/schema";
import {
	flat,
	git,
	isolateGitConfig,
	type ManifestFixture,
	skipIfUnbuilt,
	spawnCli,
	withManifestFixture,
} from "#tests/tmp-manifest";
import { makeBareSpace, makeMultiSpace } from "#tests/tmp-space";

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
	return git(["--git-dir", fixture.remote, "ls-tree", "-r", "--name-only", branch], fixture.root)
		.split("\n")
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

describe("AC-1: the allowlist decides what the space branch holds", () => {
	it("commits only allowlisted paths, and no .env", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		writeConfig();
		const root = makeSpace("my-space");

		const result = spawnCli(["space", "init", root, "--cadence", "manual"], fixture);
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
		// The manifest keeps what the user typed (`extra/`); the renderer is
		// what normalises it, and re-rendering that value is idempotent.
		expect(manifestFromCheckout("tracked-space")?.tracked).toEqual(["extra/"]);
	});
});

describe("AC-2 / C-3: init leaves the project's own repo alone", () => {
	it("changes nothing under <root>/.git and leaves worktrunk alone", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		writeConfig();
		const root = makeSpace("untouched");
		// Give the project's bare repo an origin so the manifest can record it,
		// then snapshot everything C-3 is about.
		const projectRemote = join(fixture.root, "project.git");
		git(["init", "--bare", projectRemote], fixture.root);
		git(["--git-dir", join(root, ".git"), "remote", "add", "origin", projectRemote], root);
		const gitDir = join(root, ".git");
		const configBefore = hashFile(join(gitDir, "config"));
		const headBefore = hashFile(join(gitDir, "HEAD"));
		const listingBefore = listGitDir(gitDir);
		const hasWorktrunk = spawnSync("wt", ["list", "--format", "json"], { encoding: "utf8" });
		const wtBefore = hasWorktrunk.status === 0 ? hasWorktrunk.stdout : null;

		const result = spawnCli(["space", "init", root, "--cadence", "manual"], fixture);
		expect(result.status, flat(result.stderr)).toBe(0);

		expect(hashFile(join(gitDir, "config"))).toBe(configBefore);
		expect(hashFile(join(gitDir, "HEAD"))).toBe(headBefore);
		expect(listGitDir(gitDir)).toEqual(listingBefore);
		if (wtBefore === null) {
			// No worktrunk here; nothing to compare, and nothing to claim.
		} else {
			const after = spawnSync("wt", ["list", "--format", "json"], { encoding: "utf8" });
			expect(after.stdout).toBe(wtBefore);
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
			spawnCli(["space", "init", root, "--cadence", "manual"], fixture).status,
			"init should succeed",
		).toBe(0);
		expect(cadenceOf(root)).toBe("manual");
		expect(manifestFromCheckout("cadence-flag")?.cadence).toBe("manual");
	});

	it("[defaults] cadence applies without a prompt", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		writeConfig("", "[defaults]", 'cadence = "session-end"');
		const root = makeSpace("cadence-default");
		const result = spawnCli(["space", "init", root], fixture);
		expect(result.status, flat(result.stderr)).toBe(0);
		expect(cadenceOf(root)).toBe("session-end");
		// No prompt on a pipe — the whole point of the config default.
		expect(flat(result.stderr)).not.toContain("When should this space sync");
	});

	it("names --cadence when there is no flag, no default and no TTY", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		writeConfig();
		const root = makeSpace("cadence-missing");
		const result = spawnCli(["space", "init", root], fixture);
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
		expect(spawnCli(["space", "init", first, "--cadence", "manual"], fixture).status).toBe(0);
		// A second space on the hyperdrive, so the remote has more than one branch.
		const other = makeSpace("other");
		expect(spawnCli(["space", "init", other, "--cadence", "manual"], fixture).status).toBe(0);

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

		expect(spawnCli(["space", "init", root, "--cadence", "manual"], fixture).status).toBe(0);

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

		expect(spawnCli(["space", "init", root, "--cadence", "manual"], fixture).status).toBe(0);
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
		const notASpace = spawnCli(["space", "init", plain, "--cadence", "manual"], fixture);
		expect(notASpace.status).not.toBe(0);
		expect(flat(notASpace.stderr)).toContain("not inside a hyper space");

		writeConfig();
		const root = makeSpace("no-remote-space");
		mkdirSync(dirname(fixture.configFile), { recursive: true });
		writeFileSync(fixture.configFile, 'self = { name = "mac", home = "/tmp" }\n');
		const noRemote = spawnCli(["space", "init", root, "--cadence", "manual"], fixture);
		expect(noRemote.status).not.toBe(0);
		expect(flat(noRemote.stderr)).toContain("hyper drive init");
		expect(existsSync(join(root, ".hyper", "space.git"))).toBe(false);
	});

	it("refuses a name the manifest could never hold and says to pass --name", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		writeConfig();
		const root = makeSpace("not a valid name");
		const result = spawnCli(["space", "init", root, "--cadence", "manual"], fixture);
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
		expect(spawnCli(["space", "init", root, "--cadence", "manual"], fixture).status).toBe(0);

		const again = spawnCli(["space", "init", root, "--cadence", "manual"], fixture);
		expect(again.status).not.toBe(0);
		expect(flat(again.stderr)).toContain("--refresh");

		const commits = () =>
			git(["--git-dir", fixture.remote, "rev-list", "--count", "space/twice"], fixture.root).trim();
		const before = commits();
		const refresh = spawnCli(["space", "init", root, "--refresh"], fixture);
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
			spawnCli(["space", "init", root, "--name", "original", "--cadence", "manual"], fixture)
				.status,
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
		expect(spawnCli(["space", "init", root, "--cadence", "manual"], fixture).status).toBe(0);
		writeFileSync(join(root, "notes", "b.md"), "more\n");

		const refresh = spawnCli(["space", "init", root, "--refresh"], fixture);
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

		const result = spawnCli(["space", "init", root, "--cadence", "manual"], fixture);
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
		const human = spawnCli(["space", "init", root, "--cadence", "session-end"], fixture);
		expect(human.status, flat(human.stderr)).toBe(0);
		expect(flat(human.stdout)).toContain("Branch: space/chatty");
		expect(flat(human.stdout)).toContain(`Remote: ${fixture.remote}`);
		expect(flat(human.stdout)).toContain("Cadence: session-end");
		expect(flat(human.stdout)).toContain("Committed: 3 files");

		const other = makeSpace("chatty-json");
		const json = spawnCli(["space", "init", other, "--json", "--cadence", "manual"], fixture);
		expect(json.status, flat(json.stderr)).toBe(0);
		const parsed = JSON.parse(json.stdout);
		expect(parsed.name).toBe("chatty-json");
		expect(parsed.branch).toBe("space/chatty-json");
		expect(parsed.committed).toBe(3);
		expect(parsed.refreshed).toBe(false);
	});
});
