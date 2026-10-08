import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stringify as stringifyYaml } from "yaml";
import type { SpaceEntry } from "#config/schema";
import { driveCheckoutDir, upsertSpace } from "#services/manifest";
import {
	flat,
	git,
	isolateGitConfig,
	type ManifestFixture,
	skipIfUnbuilt,
	spawnCli,
	withManifestFixture,
} from "#tests/tmp-manifest";

let fixture: ManifestFixture;
let previousHyperHome: string | undefined;

beforeEach(() => {
	isolateGitConfig();
	fixture = withManifestFixture();
	previousHyperHome = process.env.HYPER_HOME;
});

afterEach(() => {
	if (previousHyperHome === undefined) delete process.env.HYPER_HOME;
	else process.env.HYPER_HOME = previousHyperHome;
	fixture.cleanup();
});

function init(): void {
	const result = spawnCli(
		["drive", "setup", "--remote", fixture.remote, "--name", "mac", "--home", fixture.home],
		fixture,
	);
	expect(result.status, flat(result.stderr)).toBe(0);
}

const entry: SpaceEntry = {
	name: "research",
	branch: "space/research",
	group: null,
	path: "/tmp/spaces/research",
	layout: "bare",
	repos: [{ url: "git@example.com:research.git", default_branch: "main" }],
	cadence: "manual",
	tracked: [],
	public: [],
};

describe("hyper space list", () => {
	it("prints an entry in a table and as parseable JSON", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		init();
		process.env.HYPER_HOME = fixture.hyperHome;
		upsertSpace(entry);

		const table = spawnCli(["space", "list"], fixture);
		expect(table.status, flat(table.stderr)).toBe(0);
		for (const column of ["NAME", "BRANCH", "LAYOUT", "PATH", "CADENCE"]) {
			expect(table.stdout).toContain(column);
		}
		for (const value of [entry.name, entry.branch, entry.layout, entry.path, entry.cadence]) {
			expect(table.stdout).toContain(value);
		}
		const json = spawnCli(["space", "list", "--json"], fixture);
		expect(json.status, flat(json.stderr)).toBe(0);
		expect(JSON.parse(json.stdout)).toEqual({ spaces: [entry] });
	});

	it("escapes hostile manifest values in the table and warnings, and keeps --json raw", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		init();
		process.env.HYPER_HOME = fixture.hyperHome;
		// Values `space clone` would refuse, but `space list` still echoes them,
		// so they must not drive the terminal that prints them.
		const hostile: SpaceEntry = {
			...entry,
			branch: "space/re\u202ehcraes",
			path: "/tmp/spaces/a\u009b2J\u001b]0;TITLE\u0007b",
			repos: [{ url: "", default_branch: "main", slug: "s\u001b[31mred" }],
		};
		upsertSpace(entry);
		const manifest = join(driveCheckoutDir(), "spaces.yaml");
		writeFileSync(manifest, stringifyYaml({ spaces: [hostile] }));
		const table = spawnCli(["space", "list"], fixture);
		expect(table.status, flat(table.stderr)).toBe(0);
		for (const stream of [table.stdout, table.stderr])
			expect(
				/[\p{Cc}\p{Cf}]/u.test(stream.replace(/[\n\t]/g, "")),
				"raw control or format character",
			).toBe(false);
		expect(table.stdout).toContain("space/re\\u202ehcraes");
		expect(table.stdout).toContain("/tmp/spaces/a\\u009b2J\\u001b]0;TITLE\\u0007b");
		expect(flat(table.stderr)).toContain("research/s\\u001b[31mred has no project URL");
		const json = spawnCli(["space", "list", "--json"], fixture);
		expect(json.status, flat(json.stderr)).toBe(0);
		expect(JSON.parse(json.stdout)).toEqual({ spaces: [hostile] });
	});

	it("prints 'no spaces yet' for an empty manifest", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		init();
		const result = spawnCli(["space", "list"], fixture);
		expect(result.status, flat(result.stderr)).toBe(0);
		expect(result.stdout).toContain("no spaces yet");
	});

	it("errors when the checkout's origin does not match the config", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		init();
		// Point the config at a DIFFERENT hyperdrive: listing the old checkout
		// while the config names a new remote is how a half-finished
		// `drive setup` used to look like a working setup.
		const other = join(fixture.root, "other.git");
		mkdirSync(dirname(other), { recursive: true });
		git(["init", "--bare", other], fixture.root);
		mkdirSync(dirname(fixture.configFile), { recursive: true });
		writeFileSync(fixture.configFile, `remote = ${JSON.stringify(other)}\n`);
		const result = spawnCli(["space", "list"], fixture);
		expect(result.status).not.toBe(0);
		expect(flat(result.stderr)).toContain("hyper drive setup");
	});

	it("points to hyper drive setup when remote is absent", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		const result = spawnCli(["space", "list"], fixture);
		expect(result.status).not.toBe(0);
		expect(flat(result.stderr)).toContain("hyper drive setup");
	});

	it("points to hyper drive setup when the checkout is absent", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		mkdirSync(dirname(fixture.configFile), { recursive: true });
		writeFileSync(fixture.configFile, `remote = ${JSON.stringify(fixture.remote)}\n`);
		const result = spawnCli(["space", "list"], fixture);
		expect(result.status).not.toBe(0);
		expect(flat(result.stderr)).toContain("hyper drive setup");
	});
});
