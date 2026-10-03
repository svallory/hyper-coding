import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SpaceEntry } from "#config/schema";
import { upsertSpace } from "#services/manifest";
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
		["drive", "init", "--remote", fixture.remote, "--name", "mac", "--home", fixture.home],
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
	it("prints an entry in a table and as parseable JSON", () => {
		if (skipIfUnbuilt()) return;
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

	it("prints 'no spaces yet' for an empty manifest", () => {
		if (skipIfUnbuilt()) return;
		init();
		const result = spawnCli(["space", "list"], fixture);
		expect(result.status, flat(result.stderr)).toBe(0);
		expect(result.stdout).toContain("no spaces yet");
	});

	it("errors when the checkout's origin does not match the config", () => {
		if (skipIfUnbuilt()) return;
		init();
		// Point the config at a DIFFERENT hyperdrive: listing the old checkout
		// while the config names a new remote is how a half-finished
		// `drive init` used to look like a working setup.
		const other = join(fixture.root, "other.git");
		mkdirSync(dirname(other), { recursive: true });
		git(["init", "--bare", other], fixture.root);
		mkdirSync(dirname(fixture.configFile), { recursive: true });
		writeFileSync(fixture.configFile, `remote = ${JSON.stringify(other)}\n`);
		const result = spawnCli(["space", "list"], fixture);
		expect(result.status).not.toBe(0);
		expect(flat(result.stderr)).toContain("hyper drive init");
	});

	it("points to hyper drive init when remote is absent", () => {
		if (skipIfUnbuilt()) return;
		const result = spawnCli(["space", "list"], fixture);
		expect(result.status).not.toBe(0);
		expect(flat(result.stderr)).toContain("hyper drive init");
	});

	it("points to hyper drive init when the checkout is absent", () => {
		if (skipIfUnbuilt()) return;
		mkdirSync(dirname(fixture.configFile), { recursive: true });
		writeFileSync(fixture.configFile, `remote = ${JSON.stringify(fixture.remote)}\n`);
		const result = spawnCli(["space", "list"], fixture);
		expect(result.status).not.toBe(0);
		expect(flat(result.stderr)).toContain("hyper drive init");
	});
});
