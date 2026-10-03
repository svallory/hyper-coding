import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parse as parseYaml } from "yaml";
import type { SpaceEntry } from "#config/schema";
import {
	driveCheckoutDir,
	ensureDriveCheckout,
	readManifest,
	removeSpace,
	upsertSpace,
} from "#services/manifest";
import {
	git,
	isolateGitConfig,
	type ManifestFixture,
	withManifestFixture,
} from "#tests/tmp-manifest";

let fixture: ManifestFixture;
let previousHome: string | undefined;
let previousConfig: string | undefined;

const sample = (name = "alpha"): SpaceEntry => ({
	name,
	branch: `space/${name}`,
	group: null,
	path: `/tmp/spaces/${name}`,
	layout: "bare",
	repos: [{ url: `git@example.com:${name}.git`, default_branch: "main" }],
	cadence: "session-end",
	tracked: ["research/"],
	public: [],
});

/** Entry names as the REMOTE holds them — the state both machines must agree on. */
function remoteNames(): string[] {
	const yaml = git(["--git-dir", fixture.remote, "show", "main:spaces.yaml"], fixture.root);
	return (parseYaml(yaml) as { spaces: Array<{ name: string }> }).spaces.map((space) => space.name);
}

/** Entry names in a given machine's checkout. */
function namesIn(hyperHome: string): string[] {
	process.env.HYPER_HOME = hyperHome;
	return readManifest().spaces.map((space) => space.name);
}

beforeEach(() => {
	isolateGitConfig();
	fixture = withManifestFixture();
	previousHome = process.env.HYPER_HOME;
	previousConfig = process.env.HYPER_DRIVE_CONFIG;
	process.env.HYPER_HOME = fixture.hyperHome;
	process.env.HYPER_DRIVE_CONFIG = fixture.configFile;
});

afterEach(() => {
	if (previousHome === undefined) delete process.env.HYPER_HOME;
	else process.env.HYPER_HOME = previousHome;
	if (previousConfig === undefined) delete process.env.HYPER_DRIVE_CONFIG;
	else process.env.HYPER_DRIVE_CONFIG = previousConfig;
	vi.restoreAllMocks();
	fixture.cleanup();
});

describe("ensureDriveCheckout", () => {
	it("initialises an empty bare remote and is a no-op on the second call", () => {
		const first = ensureDriveCheckout(fixture.remote);
		expect(first).toEqual({ dir: driveCheckoutDir(), created: true });
		expect(existsSync(join(first.dir, ".git"))).toBe(true);
		expect(existsSync(join(first.dir, "README.md"))).toBe(true);
		expect(readFileSync(join(first.dir, "spaces.yaml"), "utf-8")).toContain("spaces: []");
		expect(
			git(["--git-dir", fixture.remote, "log", "main", "--format=%s"], fixture.root).trim(),
		).toBe("manifest: initialise hyperdrive");
		expect(ensureDriveCheckout(fixture.remote)).toEqual({ dir: first.dir, created: false });
		expect(
			git(["--git-dir", fixture.remote, "rev-list", "--count", "main"], fixture.root).trim(),
		).toBe("1");
	});

	it("clones an existing main into a fresh HYPER_HOME and rejects a mismatched origin", () => {
		ensureDriveCheckout(fixture.remote);
		process.env.HYPER_HOME = join(fixture.root, "second-hyper-home");
		const clone = ensureDriveCheckout(fixture.remote);
		expect(clone.created).toBe(true);
		expect(readManifest()).toEqual({ spaces: [] });
		expect(() => ensureDriveCheckout(join(fixture.root, "different.git"))).toThrow(
			/match|clone of|config points at/,
		);
	});

	it("does not inherit a caller's GIT_DIR or GIT_WORK_TREE", () => {
		const previousDir = process.env.GIT_DIR;
		const previousTree = process.env.GIT_WORK_TREE;
		try {
			process.env.GIT_DIR = join(fixture.root, "unrelated.git");
			process.env.GIT_WORK_TREE = join(fixture.root, "unrelated-tree");
			expect(ensureDriveCheckout(fixture.remote).created).toBe(true);
			expect(readManifest()).toEqual({ spaces: [] });
		} finally {
			if (previousDir === undefined) delete process.env.GIT_DIR;
			else process.env.GIT_DIR = previousDir;
			if (previousTree === undefined) delete process.env.GIT_WORK_TREE;
			else process.env.GIT_WORK_TREE = previousTree;
		}
	});

	it("resumes a half-created checkout instead of calling it finished", () => {
		// The state a failed first commit leaves behind: a `.git` with an unborn
		// branch and the files staged, because an unavailable signer (or a crash)
		// aborted the commit. Treating any `.git` as finished would report success
		// forever while the remote still has no `main` at all.
		const remoteState = () =>
			git(["ls-remote", "--heads", fixture.remote, "main"], fixture.root).trim();
		mkdirSync(driveCheckoutDir(), { recursive: true });
		git(["init", "-b", "main"], driveCheckoutDir());
		git(["remote", "add", "origin", fixture.remote], driveCheckoutDir());
		writeFileSync(join(driveCheckoutDir(), "README.md"), "# Hyperdrive\n");
		writeFileSync(join(driveCheckoutDir(), "spaces.yaml"), "spaces: []\n");
		git(["add", "README.md", "spaces.yaml"], driveCheckoutDir());
		expect(remoteState()).toBe("");

		const resumed = ensureDriveCheckout(fixture.remote);
		expect(resumed.created).toBe(true);
		expect(remoteState()).toContain("refs/heads/main");
		expect(
			git(["--git-dir", fixture.remote, "log", "main", "--format=%s"], fixture.root),
		).toContain("manifest: initialise hyperdrive");
		expect(readManifest()).toEqual({ spaces: [] });
		// The remote's main is now this machine's upstream, so a bare
		// `pull --ff-only` resolves instead of warning about no tracking branch.
		expect(git(["rev-parse", "--abbrev-ref", "main@{upstream}"], driveCheckoutDir()).trim()).toBe(
			"origin/main",
		);
	});

	it("keeps every entry when two clones that BOTH predate the writes publish", () => {
		// Both machines clone the hyperdrive BEFORE either writes. B is therefore
		// stale the whole time, and reads a manifest that has never heard of A.
		// The bug this pins: B computed its file from that stale read and pushed
		// over A's entry, because the sync happened after the read.
		ensureDriveCheckout(fixture.remote);
		const bHome = join(fixture.root, "machine-b");
		process.env.HYPER_HOME = bHome;
		ensureDriveCheckout(fixture.remote);
		expect(readManifest()).toEqual({ spaces: [] });

		process.env.HYPER_HOME = fixture.hyperHome;
		upsertSpace(sample("fromA"));

		process.env.HYPER_HOME = bHome;
		upsertSpace(sample("fromB"));
		upsertSpace(sample("fromB2"));

		// The REMOTE is the thing that matters: every entry has to be in it.
		expect(remoteNames()).toEqual(["fromA", "fromB", "fromB2"]);
		expect(namesIn(bHome)).toEqual(["fromA", "fromB", "fromB2"]);
	});

	it("recovers from an offline write that later meets a moving remote", () => {
		// The stuck-rebase scenario: B records an entry while offline, A publishes
		// in the meantime, and B's next write has to reconcile both. It must end
		// with every entry on the remote and B back on `main` — not on a detached
		// HEAD in the middle of a rebase, which is where the old pull --rebase left
		// it.
		ensureDriveCheckout(fixture.remote);
		const bHome = join(fixture.root, "machine-b");
		process.env.HYPER_HOME = bHome;
		ensureDriveCheckout(fixture.remote);

		const hidden = join(fixture.root, "remote-hidden.git");
		renameSync(fixture.remote, hidden);
		upsertSpace(sample("offB"));
		renameSync(hidden, fixture.remote);

		process.env.HYPER_HOME = fixture.hyperHome;
		upsertSpace(sample("onA"));

		process.env.HYPER_HOME = bHome;
		upsertSpace(sample("laterB"));

		expect(remoteNames()).toEqual(["laterB", "offB", "onA"]);
		// B is on its branch again, not stranded mid-rebase.
		expect(git(["symbolic-ref", "--short", "HEAD"], driveCheckoutDir()).trim()).toBe("main");
		expect(existsSync(join(driveCheckoutDir(), ".git", "rebase-merge"))).toBe(false);
		expect(existsSync(join(driveCheckoutDir(), ".git", "rebase-apply"))).toBe(false);
		// And nothing is left pending: every mutation reached the remote.
		expect(existsSync(join(driveCheckoutDir(), ".hyper-pending.jsonl"))).toBe(false);
	});

	it("names an unreachable remote in its friendly error", () => {
		const missing = join(fixture.root, "missing.git");
		expect(() => ensureDriveCheckout(missing)).toThrow(missing);
	});
});

describe("manifest writes", () => {
	beforeEach(() => {
		ensureDriveCheckout(fixture.remote);
	});

	it("adds, updates, skips identical content, removes, sorts, and pushes every commit", () => {
		const zeta = sample("zeta");
		const alpha = sample("alpha");
		upsertSpace(zeta);
		upsertSpace(alpha);
		expect(readManifest().spaces.map((space) => space.name)).toEqual(["alpha", "zeta"]);

		const updated = { ...alpha, path: "/tmp/new-path" };
		upsertSpace(updated);
		expect(readManifest().spaces).toHaveLength(2);
		expect(readManifest().spaces[0]).toEqual(updated);
		const before = git(
			["--git-dir", fixture.remote, "rev-list", "--count", "main"],
			fixture.root,
		).trim();
		upsertSpace(updated);
		expect(
			git(["--git-dir", fixture.remote, "rev-list", "--count", "main"], fixture.root).trim(),
		).toBe(before);

		removeSpace("zeta");
		removeSpace("zeta"); // unknown name is a no-op
		expect(readManifest().spaces).toEqual([updated]);
		const log = git(["--git-dir", fixture.remote, "log", "main", "--format=%s"], fixture.root);
		for (const message of [
			"manifest: initialise hyperdrive",
			"manifest: add zeta",
			"manifest: add alpha",
			"manifest: update alpha",
			"manifest: remove zeta",
		]) {
			expect(log).toContain(message);
		}
	});

	it("publishes a pending offline entry even when the next write adds nothing new", () => {
		upsertSpace(sample("alpha"));
		const hidden = join(fixture.root, "remote-hidden.git");
		renameSync(fixture.remote, hidden);
		upsertSpace(sample("beta"));
		renameSync(hidden, fixture.remote);
		expect(remoteNames()).toEqual(["alpha"]);

		// Re-upserting `alpha` unchanged adds nothing to the manifest, but the
		// offline `beta` still has to reach the remote rather than wait for some
		// future change. The assertion is on the REMOTE's entries, not on a
		// commit subject: a republished entry is committed under the verb of the
		// write that finally carried it.
		upsertSpace(sample("alpha"));
		expect(remoteNames()).toEqual(["alpha", "beta"]);
		expect(existsSync(join(driveCheckoutDir(), ".hyper-pending.jsonl"))).toBe(false);
	});

	it("warns while offline, keeps the entry locally, and publishes it later", () => {
		upsertSpace(sample("alpha"));
		const hidden = join(fixture.root, "remote-hidden.git");
		renameSync(fixture.remote, hidden);
		const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		upsertSpace(sample("beta"));
		// Offline is named as offline, and never as a merge problem.
		expect(stderr).toHaveBeenCalledWith(expect.stringContaining("unreachable"));
		expect(stderr).not.toHaveBeenCalledWith(expect.stringContaining("rebas"));
		// Recorded locally, so the write is not lost even though the push failed.
		expect(existsSync(join(driveCheckoutDir(), ".hyper-pending.jsonl"))).toBe(true);
		expect(namesIn(fixture.hyperHome)).toEqual(["alpha", "beta"]);

		renameSync(hidden, fixture.remote);
		upsertSpace(sample("gamma"));
		// Every entry the offline run recorded is now on the remote, together with
		// the new one.
		expect(remoteNames()).toEqual(["alpha", "beta", "gamma"]);
		expect(existsSync(join(driveCheckoutDir(), ".hyper-pending.jsonl"))).toBe(false);
	});

	it("a no-op write while offline neither throws nor leaves a pending line", () => {
		upsertSpace(sample("alpha"));
		const hidden = join(fixture.root, "remote-hidden.git");
		renameSync(fixture.remote, hidden);

		// Re-recording what is already in the manifest is a no-op: git answers
		// "nothing to commit" on stdout, which used to surface as
		// `committing the manifest failed: ` with an empty reason, and used to
		// append a junk line that the next write would replay.
		const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		expect(() => upsertSpace(sample("alpha"))).not.toThrow();
		expect(existsSync(join(driveCheckoutDir(), ".hyper-pending.jsonl"))).toBe(false);
		expect(stderr).not.toHaveBeenCalledWith(
			expect.stringContaining("committing the manifest failed"),
		);
		renameSync(hidden, fixture.remote);
	});

	it("gives every replayed mutation its own commit on the remote", () => {
		// B goes offline and records two mutations; A publishes in between. The
		// remote's history must show both of B's messages, not one commit
		// labelled with whichever write happened to carry them.
		const bHome = join(fixture.root, "machine-b");
		process.env.HYPER_HOME = bHome;
		ensureDriveCheckout(fixture.remote);
		const hidden = join(fixture.root, "remote-hidden.git");
		renameSync(fixture.remote, hidden);
		upsertSpace(sample("offB"));
		upsertSpace(sample("offB2"));
		renameSync(hidden, fixture.remote);

		process.env.HYPER_HOME = fixture.hyperHome;
		upsertSpace(sample("onA"));
		process.env.HYPER_HOME = bHome;
		upsertSpace(sample("laterB"));

		const remoteLog = git(
			["--git-dir", fixture.remote, "log", "main", "--format=%s"],
			fixture.root,
		);
		for (const message of [
			"manifest: add offB",
			"manifest: add offB2",
			"manifest: add onA",
			"manifest: add laterB",
		]) {
			expect(remoteLog).toContain(message);
		}
		expect(remoteNames()).toEqual(["laterB", "offB", "offB2", "onA"]);
	});

	it("round-trips every field, including group and repo slug", () => {
		const entry: SpaceEntry = {
			...sample("team/docs"),
			branch: "space/team/docs",
			group: "team",
			layout: "multi",
			repos: [
				{ url: "git@example.com:docs.git", default_branch: "trunk", slug: "docs" },
				{ url: "git@example.com:api.git", default_branch: "main", slug: "api" },
			],
			cadence: "session-end+push",
			tracked: ["assets/", "references/"],
			public: ["notes/public/"],
		};
		upsertSpace(entry);
		expect(readManifest()).toEqual({ spaces: [entry] });
	});
});

describe("manifest validation", () => {
	beforeEach(() => {
		ensureDriveCheckout(fixture.remote);
	});

	const yaml = (extra: string) =>
		`spaces:\n  - name: alpha\n    branch: space/alpha\n    group: null\n    path: /tmp/alpha\n    layout: bare\n    repos: []\n    cadence: manual\n    tracked: []\n    public: []\n${extra}`;

	it("rejects a wrong-typed layout with the key named", () => {
		writeFileSync(
			join(driveCheckoutDir(), "spaces.yaml"),
			yaml("").replace("layout: bare", "layout: 42"),
		);
		expect(() => readManifest()).toThrow(/`layout`/);
	});

	it("warns on an unknown key but still loads", () => {
		const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
		writeFileSync(join(driveCheckoutDir(), "spaces.yaml"), yaml("    extra_field: hi\n"));
		expect(readManifest().spaces[0]?.name).toBe("alpha");
		expect(stderr).toHaveBeenCalledWith(expect.stringContaining("extra_field"));
	});
});
