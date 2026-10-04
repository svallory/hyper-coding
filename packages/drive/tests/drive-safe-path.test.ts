import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { absolutePathEntries, keepAbsolutePathEntries } from "#lib/safe-path";
import {
	isolateGitConfig,
	type ManifestFixture,
	skipIfUnbuilt,
	withManifestFixture,
} from "#tests/tmp-manifest";
import { makeBareSpace } from "#tests/tmp-space";

/**
 * PR #52 review, H2: a drive command run from a space root must not run the
 * space's own `bin/bash` or `bin/git` through a relative PATH entry. The
 * operator's PATH really has `./bin`, and a space's `bin/` is synced content.
 * BaseCommand.init() keeps only absolute entries before the command runs.
 */

const cli = join(import.meta.dirname, "..", "..", "cli", "bin", "run.js");
const PLANTED = ["bash", "sh", "git", "env", "wt", "ps", "node"];
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

function hyper(args: string[], cwd: string, path: string) {
	return spawnSync(process.execPath, [cli, ...args], {
		cwd,
		encoding: "utf8",
		timeout: 60_000,
		env: {
			...process.env,
			PATH: path,
			HOME: fixture.home,
			XDG_CONFIG_HOME: join(fixture.root, "config"),
			HYPER_HOME: fixture.hyperHome,
			HYPER_DRIVE_CONFIG: fixture.configFile,
			HYPER_SKIP_NEW_VERSION_CHECK: "1",
			AI_AGENT: undefined,
			CLAUDECODE: undefined,
			NO_COLOR: "1",
			FORCE_COLOR: "0",
		},
	});
}

/** Executables in each dir that only append "PLANTED <name> <args>" to `log`. */
function plant(log: string, ...dirs: string[]): void {
	for (const dir of dirs) {
		mkdirSync(dir, { recursive: true });
		for (const name of PLANTED) {
			writeFileSync(join(dir, name), `#!/bin/sh\necho "PLANTED ${name} $*" >> "${log}"\n`);
			chmodSync(join(dir, name), 0o755);
		}
	}
}

describe("absolutePathEntries", () => {
	it("keeps absolute entries in order and drops empty, dot, relative and ~ entries", () => {
		const value = [
			"./bin",
			".",
			"",
			"./node_modules/.bin",
			"~/bin",
			"bin",
			"/a b/c",
			"/usr/bin",
			"",
		].join(delimiter);
		expect(absolutePathEntries(value)).toEqual(["/a b/c", "/usr/bin"]);
		expect(absolutePathEntries("./bin::.")).toEqual(["/usr/bin", "/bin", "/usr/sbin", "/sbin"]);
		expect(absolutePathEntries(undefined)).toEqual(["/usr/bin", "/bin", "/usr/sbin", "/sbin"]);
		const env: NodeJS.ProcessEnv = { PATH: `./bin${delimiter}/opt/x` };
		keepAbsolutePathEntries(env);
		expect(env.PATH).toBe("/opt/x");
	});
});

describe("drive commands under a hostile PATH, run from the space root", () => {
	it("space status and space init --refresh never run the space's bin/bash or bin/git", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		const root = join(fixture.root, "hostile");
		makeBareSpace(root);
		mkdirSync(join(root, "notes"));
		writeFileSync(join(root, "notes", "a.md"), "notes\n");
		const clean = process.env.PATH ?? "";
		const first = hyper(["space", "init", root, "--cadence", "manual"], fixture.root, clean);
		expect(first.status, first.stderr).toBe(0);

		const log = join(fixture.root, "planted.log");
		plant(log, join(root, "bin"), join(root, "node_modules", ".bin"), root);
		const hostile = ["./bin", ".", "", "./node_modules/.bin", clean].join(delimiter);

		const status = hyper(["space", "status"], root, hostile);
		expect(status.status, status.stderr).toBe(0);
		expect(status.stdout).toContain("Branch:  space/hostile");

		const refresh = hyper(["space", "init", "--refresh"], root, hostile);
		expect(refresh.status, refresh.stderr).toBe(0);
		expect(refresh.stdout).toContain("Manifest: refreshed");

		expect(existsSync(log) ? readFileSync(log, "utf8") : "").toBe("");
	});
});
