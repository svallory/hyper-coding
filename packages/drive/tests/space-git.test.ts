import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SyncCadence } from "#config/schema";
import {
	cleanGitEnv,
	hasSpaceGit,
	initSpaceGitDir,
	readCadence,
	SpaceGitError,
	spaceGit,
	spaceGitDir,
	writeCadence,
} from "#services/space-git";
import {
	fixturePath,
	initBare,
	isolateGitConfig,
	setupSpaceFixtures,
	teardownSpaceFixtures,
} from "#tests/tmp-space";

/**
 * The space git runner: create the git dir, never touch the space's own
 * `.git` (C-3), expose cadence, and fail with git's own words.
 */

const BRANCH = "space/hyper";

/** A bare-layout space root with the space git dir initialised. */
function makeSpace(): string {
	const root = fixturePath(`space-${Math.random().toString(36).slice(2)}`);
	mkdirSync(join(root, "notes"), { recursive: true });
	writeFileSync(join(root, "HYPER.md"), "# hyper\n");
	initSpaceGitDir(root, { branch: BRANCH });
	return root;
}

function sha256(file: string): string {
	return createHash("sha256").update(readFileSync(file)).digest("hex");
}

/** Every path under `dir`, recursively, sorted — for the "no new files" proof. */
function walk(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		const path = join(dir, entry.name);
		if (entry.isDirectory()) out.push(...walk(path));
		else out.push(path);
	}
	return out.sort();
}

let restoreGitConfig: () => void = () => {};

beforeAll(() => {
	setupSpaceFixtures();
	restoreGitConfig = isolateGitConfig();
});

afterAll(() => {
	restoreGitConfig();
	teardownSpaceFixtures();
});

describe("spaceGitDir", () => {
	it("lives at <space>/.hyper/space.git", () => {
		expect(spaceGitDir("/tmp/x")).toBe("/tmp/x/.hyper/space.git");
	});
});

describe("initSpaceGitDir", () => {
	it("creates the git dir with the expected config and an unborn HEAD", () => {
		const root = makeSpace();
		const gitDir = spaceGitDir(root);
		expect(existsSync(gitDir)).toBe(true);
		expect(hasSpaceGit(root)).toBe(true);

		expect(spaceGit(root, ["config", "--get", "core.bare"]).stdout.trim()).toBe("false");
		expect(spaceGit(root, ["config", "--get", "core.worktree"]).stdout.trim()).toBe("../..");
		expect(spaceGit(root, ["symbolic-ref", "HEAD"]).stdout.trim()).toBe(`refs/heads/${BRANCH}`);

		// The branch must not exist as a commit yet — the first space commit
		// belongs to `hyper space commit`.
		const rev = spaceGit(root, ["rev-parse", "HEAD"], { allowFailure: true });
		expect(rev.status).not.toBe(0);
	});

	it("records the remote and its upstream when given one", () => {
		const root = fixturePath("space-remote");
		mkdirSync(root, { recursive: true });
		initSpaceGitDir(root, {
			branch: BRANCH,
			remote: "git@github.com:svallory/hyperdrive.git",
		});
		expect(spaceGit(root, ["config", "--get", "remote.origin.url"]).stdout.trim()).toBe(
			"git@github.com:svallory/hyperdrive.git",
		);
		expect(spaceGit(root, ["config", "--get", `branch.${BRANCH}.remote`]).stdout.trim()).toBe(
			"origin",
		);
		expect(spaceGit(root, ["config", "--get", `branch.${BRANCH}.merge`]).stdout.trim()).toBe(
			`refs/heads/${BRANCH}`,
		);
	});

	it("is idempotent: a second call changes nothing", () => {
		const root = makeSpace();
		const gitDir = spaceGitDir(root);
		const before = {
			config: sha256(join(gitDir, "config")),
			head: sha256(join(gitDir, "HEAD")),
		};

		const again = initSpaceGitDir(root, { branch: "space/other", remote: "x" });

		expect(again).toEqual({ created: false });
		expect(sha256(join(gitDir, "config"))).toBe(before.config);
		expect(sha256(join(gitDir, "HEAD"))).toBe(before.head);
	});

	it("C-3: creates nothing at <space>/.git and changes nothing inside it", () => {
		const root = fixturePath("space-c3");
		mkdirSync(root, { recursive: true });
		// A bare layout space: the project repo is a bare `.git` at the root,
		// built by git itself rather than by hand.
		const projectGit = join(root, ".git");
		initBare(projectGit);

		const beforeFiles = walk(projectGit);
		const before = {
			config: sha256(join(projectGit, "config")),
			head: sha256(join(projectGit, "HEAD")),
		};

		const result = initSpaceGitDir(root, {
			branch: BRANCH,
			remote: "git@example.invalid:x.git",
		});

		expect(result.created).toBe(true);
		expect(sha256(join(projectGit, "config"))).toBe(before.config);
		expect(sha256(join(projectGit, "HEAD"))).toBe(before.head);
		expect(walk(projectGit)).toEqual(beforeFiles);
	});

	it("removes its own git dir when init fails part-way", () => {
		const root = fixturePath("space-fail");
		mkdirSync(root, { recursive: true });
		// A newline is not a legal ref name, so `symbolic-ref HEAD` fails after
		// the dir and its config are already written.
		expect(() => initSpaceGitDir(root, { branch: "space/bad\nname" })).toThrow(SpaceGitError);
		expect(() => initSpaceGitDir(root, { branch: "space/bad\nname" })).toThrow(
			/while setting up the space git dir/,
		);
		expect(existsSync(spaceGitDir(root))).toBe(false);

		// And a retry on the clean root succeeds — nothing is left to trip on.
		expect(initSpaceGitDir(root, { branch: BRANCH }).created).toBe(true);
	});

	it("refuses to adopt a git dir that is not a space's", () => {
		const root = fixturePath("space-foreign");
		const foreign = spaceGitDir(root);
		mkdirSync(foreign, { recursive: true });
		writeFileSync(join(foreign, "HEAD"), "ref: refs/heads/whatever\n");

		expect(() => initSpaceGitDir(root, { branch: BRANCH })).toThrow(/isn't a hyper space git dir/);
		expect(existsSync(join(foreign, "HEAD"))).toBe(true);
	});

	it("refuses a bare-initialised dir that was never set up as a space's", () => {
		const root = fixturePath("space-bare-only");
		const foreign = spaceGitDir(root);
		// A real `git init --bare`, stopped before the flips: it has a config and
		// a HEAD, but no core.worktree pointing at the space.
		initBare(foreign);

		expect(() => initSpaceGitDir(root, { branch: BRANCH })).toThrow(/move it aside/i);
		expect(existsSync(join(foreign, "config"))).toBe(true);
	});

	it("refuses a git dir whose worktree points somewhere else", () => {
		const root = fixturePath("space-elsewhere");
		const foreign = spaceGitDir(root);
		// A real repo whose work tree is some other directory. (git ignores a
		// core.worktree set while core.bare is true, so the fixture flips it
		// off the way initSpaceGitDir does.)
		initBare(foreign);
		spaceGit(root, ["config", "core.bare", "false"]);
		spaceGit(root, ["config", "core.worktree", "/elsewhere"]);
		expect(spaceGit(root, ["config", "--get", "core.worktree"]).stdout.trim()).toBe("/elsewhere");

		// The key exists this time — only its value says it isn't ours.
		expect(() => initSpaceGitDir(root, { branch: BRANCH })).toThrow(
			/isn't a hyper space git dir — its core\.worktree points at \/elsewhere/,
		);
		expect(existsSync(join(foreign, "config"))).toBe(true);
	});
});

describe("spaceGit failures", () => {
	it("returns a non-zero result with allowFailure instead of throwing", () => {
		const root = makeSpace();
		const result = spaceGit(root, ["rev-parse", "HEAD"], { allowFailure: true });
		expect(result.status).not.toBe(0);
		expect(result.stderr).toContain("HEAD");
	});

	it("throws a SpaceGitError whose message is git's stderr, without a stack", () => {
		const root = makeSpace();
		let thrown: unknown;
		try {
			spaceGit(root, ["rev-parse", "HEAD"]);
		} catch (err) {
			thrown = err;
		}
		expect(thrown).toBeInstanceOf(SpaceGitError);
		const error = thrown as SpaceGitError;
		expect(error.message).toContain("ambiguous argument 'HEAD'");
		expect(error.message).not.toContain("\n    at ");
		expect(error.stack).toBe(error.message);
	});

	it("leaves the caller's own environment untouched", () => {
		const source: NodeJS.ProcessEnv = { GIT_DIR: "/tmp/other", HOME: "/tmp/home" };
		const env = cleanGitEnv(source);
		expect(env.HOME).toBe("/tmp/home");
		expect(source.GIT_DIR).toBe("/tmp/other");
	});
});

describe("cleanGitEnv", () => {
	it("strips every repo-local git variable and disables terminal prompts", () => {
		const polluted: NodeJS.ProcessEnv = {
			HOME: "/tmp/home",
			PATH: "/usr/bin",
			GIT_ALTERNATE_OBJECT_DIRECTORIES: "/tmp/objs",
			GIT_COMMON_DIR: "/tmp/common",
			GIT_CONFIG: "/tmp/gitconfig",
			GIT_CONFIG_PARAMETERS: "'x'='y'",
			GIT_CONFIG_COUNT: "1",
			GIT_DIR: "/tmp/other-repo",
			GIT_GRAFT_FILE: "/tmp/grafts",
			GIT_IMPLICIT_WORK_TREE: "1",
			GIT_INDEX_FILE: "/tmp/index",
			GIT_INTERNAL_SUPER_PREFIX: "/tmp",
			GIT_NO_REPLACE_OBJECTS: "1",
			GIT_OBJECT_DIRECTORY: "/tmp/objects",
			GIT_PREFIX: "sub/",
			GIT_REPLACE_REF_BASE: "refs/replace/",
			GIT_SHALLOW_FILE: "/tmp/shallow",
			GIT_WORK_TREE: "/tmp/other-tree",
			GIT_TERMINAL_PROMPT: "1",
		};

		const env = cleanGitEnv(polluted);

		for (const key of Object.keys(polluted)) {
			if (!key.startsWith("GIT_") || key === "GIT_TERMINAL_PROMPT") continue;
			expect(env[key], `${key} should be stripped`).toBeUndefined();
		}
		expect(env.GIT_TERMINAL_PROMPT).toBe("0");
		expect(env.HOME).toBe("/tmp/home");
		expect(env.PATH).toBe("/usr/bin");
	});

	it("covers exactly what `git rev-parse --local-env-vars` lists", () => {
		const listed = spawnSync("git", ["rev-parse", "--local-env-vars"], { encoding: "utf8" });
		const variables = (listed.stdout ?? "")
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line !== "");
		expect(variables.length).toBeGreaterThan(0);

		const env = cleanGitEnv(Object.fromEntries(variables.map((name) => [name, "/tmp/leak"])));
		for (const name of variables) {
			expect(env[name], `${name} should be stripped`).toBeUndefined();
		}
	});
});

describe("cadence", () => {
	it("reads an unset cadence as the empty string", () => {
		const root = makeSpace();
		expect(readCadence(root)).toBe("");
	});

	it("round-trips a written cadence through the git dir config", () => {
		const root = makeSpace();
		writeCadence(root, "session-end");
		expect(readCadence(root)).toBe("session-end");
		writeCadence(root, "session-end+push");
		expect(readCadence(root)).toBe("session-end+push");
		writeCadence(root, "manual");
		expect(readCadence(root)).toBe("manual");
	});

	it("refuses a value that isn't a cadence", () => {
		const root = makeSpace();
		// Written with raw git: a hand-edit, or a stale writer from another tool.
		spaceGit(root, ["config", "--local", "hyper.cadence", "bogus"]);
		expect(() => readCadence(root)).toThrow(SpaceGitError);
		expect(() => readCadence(root)).toThrow(/isn't one of/);
	});

	it("refuses to write a value that isn't a cadence", () => {
		const root = makeSpace();
		expect(() => writeCadence(root, "hourly" as SyncCadence)).toThrow(/isn't a cadence I know/);
		expect(readCadence(root)).toBe("");
	});
});

describe("the space config is read with --local only", () => {
	// The probe behind this: a global `hyper.cadence = bogus` answered
	// readCadence, and a global `core.worktree = ../..` made an EMPTY
	// .hyper/space.git look initialised, so initSpaceGitDir adopted it. Both
	// reads must consult the space's own config and nothing else.
	const HOSTILE_GLOBAL = ["[hyper]", "\tcadence = bogus", "[core]", "\tworktree = ../..", ""].join(
		"\n",
	);

	function withHostileGlobal(fn: () => void): void {
		const file = join(fixturePath("hostile-gitconfig"), "global");
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, HOSTILE_GLOBAL);
		const saved = process.env.GIT_CONFIG_GLOBAL;
		process.env.GIT_CONFIG_GLOBAL = file;
		try {
			fn();
		} finally {
			if (saved === undefined) delete process.env.GIT_CONFIG_GLOBAL;
			else process.env.GIT_CONFIG_GLOBAL = saved;
		}
	}

	it("ignores a hostile global cadence", () => {
		withHostileGlobal(() => {
			const root = makeSpace();
			expect(readCadence(root)).toBe("");

			spaceGit(root, ["config", "--local", "hyper.cadence", "session-end"]);
			expect(readCadence(root)).toBe("session-end");
		});
	});

	it("does not let a hostile global worktree adopt an empty dir", () => {
		withHostileGlobal(() => {
			const root = fixturePath("space-hostile-adopt");
			const dir = spaceGitDir(root);
			mkdirSync(dir, { recursive: true });

			// Without --local this returned { created: false }: the global
			// core.worktree stood in for the missing one.
			expect(() => initSpaceGitDir(root, { branch: BRANCH })).toThrow(/move it aside/i);
		});
	});
});
