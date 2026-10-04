import { spawnSync } from "node:child_process";
import { lstatSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { libPath } from "#services/space";
import {
	isolateGitConfig,
	type ManifestFixture,
	skipIfUnbuilt,
	spawnCli,
	withManifestFixture,
} from "#tests/tmp-manifest";
import { makeBareSpace, makeMultiSpace } from "#tests/tmp-space";

/**
 * `hyper space init` re-renders the backup bullet of an existing HYPER.md
 * (PR #47 review, item 7). HYPER.md is written at scaffold time, before the
 * space has a branch, so without this its "nothing here is committed or
 * backed up until you run `hyper space init`" is committed and travels to
 * every clone after init made it false. Only that bullet may change.
 */

let fixture: ManifestFixture;

beforeEach(() => {
	isolateGitConfig();
	process.env.GIT_CONFIG_COUNT = "2";
	process.env.GIT_CONFIG_KEY_1 = "init.defaultBranch";
	process.env.GIT_CONFIG_VALUE_1 = "main";
	process.env.GIT_AUTHOR_NAME = "hyper test";
	process.env.GIT_AUTHOR_EMAIL = "hyper-test@example.invalid";
	process.env.GIT_COMMITTER_NAME = "hyper test";
	process.env.GIT_COMMITTER_EMAIL = "hyper-test@example.invalid";
	fixture = withManifestFixture();
	mkdirSync(join(fixture.root, "config", "hyper"), { recursive: true });
	writeFileSync(fixture.configFile, `remote = ${JSON.stringify(fixture.remote)}\n`);
});
afterEach(() => {
	fixture.cleanup();
});

/** Run one hyper-lib.sh function, the way the plugin and clone write HYPER.md. */
function lib(fn: string, ...args: string[]): string {
	const result = spawnSync("bash", ["-c", `source "$0"; set +e; ${fn} "$@"`, libPath(), ...args], {
		encoding: "utf8",
	});
	expect(result.status, result.stderr).toBe(0);
	return result.stdout;
}

function space(layout: "bare" | "multi", name: string): string {
	const root = join(fixture.root, name);
	if (layout === "bare") makeBareSpace(root);
	else makeMultiSpace(root, ["alpha"]);
	mkdirSync(join(root, "notes"), { recursive: true });
	writeFileSync(join(root, "notes", "a.md"), "notes\n");
	// Scaffold time: no `.hyper/space.git` yet, so this is the no-branch text.
	lib(layout === "bare" ? "write_hyper_md_bare" : "write_hyper_md_multi", root, name);
	return root;
}

function hyperMd(root: string): string {
	return readFileSync(join(root, "HYPER.md"), "utf8");
}

function init(root: string, ...extra: string[]) {
	return spawnCli(["space", "init", root, "--cadence", "manual", ...extra], fixture);
}

describe.each(["bare", "multi"] as const)("space init and HYPER.md (%s layout)", (layout) => {
	it("re-renders only the backup bullet, after init and again after --refresh", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		const root = space(layout, `md-${layout}`);
		const before = hyperMd(root);
		const stale = lib("hyper_md_backup_rule", root, layout, "none");
		const fresh = lib("hyper_md_backup_rule", root, layout, "branch");
		expect(before).toContain(stale);

		const result = init(root);
		expect(result.status, result.stderr).toBe(0);
		expect(result.stdout).toContain(
			"HYPER.md: its backup rule now says this space commits to its branch",
		);
		const after = hyperMd(root);
		expect(after).toBe(before.replace(stale, fresh));
		expect(after).not.toContain("until you run");

		const again = init(root, "--refresh", "--json");
		expect(again.status, again.stderr).toBe(0);
		expect(JSON.parse(again.stdout).hyperMd).toBe("current");
		expect(hyperMd(root)).toBe(after);
	});

	it("re-renders the older single bullet written before the branch wording", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		const root = space(layout, `legacy-${layout}`);
		const legacy = lib("hyper_md_backup_rule", root, layout, "legacy");
		const original = hyperMd(root).replace(
			lib("hyper_md_backup_rule", root, layout, "none"),
			legacy,
		);
		writeFileSync(join(root, "HYPER.md"), original);
		expect(init(root).status).toBe(0);
		expect(hyperMd(root)).toBe(
			original.replace(legacy, lib("hyper_md_backup_rule", root, layout, "branch")),
		);
	});

	it("leaves a hand-edited bullet alone and says so in one line", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		const root = space(layout, `edited-${layout}`);
		const edited = hyperMd(root).replace(
			"never reach the project's remote",
			"never leave this laptop",
		);
		writeFileSync(join(root, "HYPER.md"), edited);
		const result = init(root);
		expect(result.status, result.stderr).toBe(0);
		expect(hyperMd(root)).toBe(edited);
		const lines = result.stdout.split("\n").filter((line) => line.startsWith("HYPER.md:"));
		expect(lines).toEqual([
			"HYPER.md: its backup rule is not one hyper wrote, so I left it; check that it still says what this space commits.",
		]);
	});
});

describe("space init and HYPER.md: what is never touched", () => {
	it("a space without HYPER.md gets none, and a symlinked HYPER.md is not replaced", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		const bare = join(fixture.root, "no-md");
		makeBareSpace(bare);
		mkdirSync(join(bare, "notes"));
		writeFileSync(join(bare, "notes", "a.md"), "notes\n");
		const result = init(bare, "--json");
		expect(result.status, result.stderr).toBe(0);
		expect(JSON.parse(result.stdout).hyperMd).toBe("absent");
		expect(() => lstatSync(join(bare, "HYPER.md"))).toThrow();

		const linked = space("bare", "linked");
		writeFileSync(join(fixture.root, "outside.md"), hyperMd(linked));
		const outside = readFileSync(join(fixture.root, "outside.md"), "utf8");
		const marker = join(linked, "HYPER.md");
		rmSync(marker);
		symlinkSync(join(fixture.root, "outside.md"), marker);
		expect(init(linked).status).toBe(0);
		expect(lstatSync(marker).isSymbolicLink()).toBe(true);
		expect(readFileSync(join(fixture.root, "outside.md"), "utf8")).toBe(outside);
	});
});
