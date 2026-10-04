import { spawnSync } from "node:child_process";

import { existsSync, mkdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, type TestContext } from "vitest";
import {
	detectSpace,
	findSpaceRoot,
	isSpace,
	libPath,
	repoSlugOf,
	spaceLayout,
	spaceRepos,
	worktreesDir,
} from "#services/space";
import { initSpaceGitDir, spaceGit } from "#services/space-git";
import {
	fixturePath,
	initBare,
	makeBareSpace,
	makeBareSpaceWithWorktree,
	makeCheckout,
	makeMultiSpace,
	setupSpaceFixtures,
	teardownSpaceFixtures,
} from "#tests/tmp-space";

/**
 * Port of `agent-plugin/tests/test-a-detection.sh` (cases A1–A14b), asserting
 * that the TypeScript service agrees with the bash library on exactly the
 * fixtures the bash suite uses.
 *
 * Why this file exists (C-5): the agent-plugin now has NO copy of the bash
 * library — its scripts source the one inside `@hypercli/drive` via
 * `hyper space lib-path`. The CLI spawns that same library, so these two
 * suites can only stay in agreement if both drive the same bytes. Porting the
 * fixtures (rather than inventing new ones) is what makes that a real proof.
 */

beforeAll(() => {
	setupSpaceFixtures();
});

afterAll(() => {
	teardownSpaceFixtures();
});

describe("libPath", () => {
	it("resolves to the library shipped inside this package", () => {
		expect(libPath().endsWith("/packages/drive/scripts/hyper-lib.sh")).toBe(true);
	});

	it("resolves to the same file from src/ and from dist/ (installed)", async (ctx) => {
		// The whole claim of `libPath()` is that one relative specifier works
		// from both trees. Asserting the *shape* of the path proves nothing,
		// so load the built module and compare what it actually resolves to.
		// Skipped with a clear message when dist/ has not been built, which is
		// the normal state when vitest runs on its own. `ctx.skip()`, not
		// `expect.skip()`: the latter is not a vitest API and throws, so this
		// path used to fail the very test it was meant to skip.
		const built = join(import.meta.dirname, "..", "dist", "services", "space.js");
		if (!existsSync(built)) {
			ctx.skip("dist/services/space.js not built (run `bun run build` first)");
			return;
		}
		const distLib = (await import(built)).libPath();
		expect(distLib).toBe(libPath());
		expect(existsSync(distLib)).toBe(true);
	});
});

describe("bare layout", () => {
	it("A1: bare .git + worktrees/ is self-identifying", () => {
		const d = fixturePath("a1");
		makeBareSpace(d);
		expect(spaceLayout(d)).toBe("bare");
		expect(isSpace(d)).toBe(true);
	});

	it("A2: bare .git + HYPER.md marker, no worktrees/", () => {
		const d = fixturePath("a2");
		mkdirSync(d, { recursive: true });
		initBare(join(d, ".git"));
		writeFileSync(join(d, "HYPER.md"), "");
		expect(spaceLayout(d)).toBe("bare");
	});

	it("A3: a plain bare repo (mirror / hosting remote) is rejected", () => {
		const d = fixturePath("a3");
		mkdirSync(d, { recursive: true });
		initBare(join(d, ".git"));
		expect(spaceLayout(d)).toBeNull();
		expect(isSpace(d)).toBe(false);
	});

	it("A4: a checkout + marker is NOT a space (no marker-only fallback)", () => {
		const d = fixturePath("a4");
		makeCheckout(d);
		writeFileSync(join(d, "HYPER.md"), "");
		expect(spaceLayout(d)).toBeNull();
		expect(isSpace(d)).toBe(false);
	});

	it("A5: .claude/worktrees/ alone no longer opts a checkout in", () => {
		const d = fixturePath("a5");
		makeCheckout(d);
		mkdirSync(join(d, ".claude", "worktrees"), { recursive: true });
		expect(spaceLayout(d)).toBeNull();
		expect(isSpace(d)).toBe(false);
	});

	it("A6: a plain checkout is not a space", () => {
		const d = fixturePath("a6");
		makeCheckout(d);
		expect(spaceLayout(d)).toBeNull();
		expect(isSpace(d)).toBe(false);
	});

	it("A7: a linked worktree is rejected, and the walk reaches the bare root", () => {
		const d = fixturePath("a7");
		const wt = makeBareSpaceWithWorktree(d, "feat");
		// The case is about a `.git` FILE (a linked worktree), not a directory.
		// git 2.55 creates it even against a commitless bare repo, but older git
		// does not — and a silently-missing worktree would make this test pass
		// for the wrong reason, so assert the fixture is real before relying on it.
		expect(existsSync(join(wt, ".git"))).toBe(true);
		expect(statSync(join(wt, ".git")).isFile()).toBe(true);
		// A marker inside the worktree must still not make a space.
		writeFileSync(join(wt, "HYPER.md"), "");
		expect(spaceLayout(wt)).toBeNull();
		expect(isSpace(wt)).toBe(false);
		mkdirSync(join(wt, "sub"), { recursive: true });
		expect(findSpaceRoot(join(wt, "sub"))).toBe(d);
	});

	it("A8: a subdirectory of a marked checkout finds no space above it", () => {
		const d = fixturePath("a8");
		makeCheckout(d);
		writeFileSync(join(d, "HYPER.md"), "");
		mkdirSync(join(d, "src"), { recursive: true });
		expect(spaceLayout(join(d, "src"))).toBeNull();
		expect(findSpaceRoot(join(d, "src"))).toBeNull();
	});
});

describe("multi layout", () => {
	let d: string;

	beforeAll(() => {
		d = fixturePath("a9");
		makeMultiSpace(d, ["alpha", "beta"]);
	});

	it("A9: marker + bare repos under code/ is multi, and space_repos lists them", () => {
		expect(spaceLayout(d)).toBe("multi");
		expect(isSpace(d)).toBe(true);
		expect(spaceRepos(d)).toEqual(["alpha", "beta"]);
	});

	it("A9: space_repos prints nothing for a bare space", () => {
		const bare = fixturePath("a1");
		makeBareSpace(bare);
		expect(spaceRepos(bare)).toEqual([]);
	});

	it("A10: find_space_root reaches the root from every position", () => {
		mkdirSync(join(d, "notes", "deep"), { recursive: true });
		mkdirSync(join(d, "code", "beta", "worktrees", "main", "src", "deep"), {
			recursive: true,
		});
		expect(findSpaceRoot(d)).toBe(d);
		expect(findSpaceRoot(join(d, "notes"))).toBe(d);
		expect(findSpaceRoot(join(d, "notes", "deep"))).toBe(d);
		expect(findSpaceRoot(join(d, "code", "alpha"))).toBe(d);
		expect(findSpaceRoot(join(d, "code", "beta", "worktrees", "main"))).toBe(d);
		expect(findSpaceRoot(join(d, "code", "beta", "worktrees", "main", "src", "deep"))).toBe(d);
	});

	it("A11: repo_slug_of names the owning repo, and not elsewhere", () => {
		expect(repoSlugOf(d, join(d, "code", "beta", "worktrees", "main", "src", "deep"))).toBe("beta");
		expect(repoSlugOf(d, join(d, "code", "alpha"))).toBe("alpha");
		expect(repoSlugOf(d, d)).toBeNull();
		expect(repoSlugOf(d, join(d, "notes"))).toBeNull();
	});

	it("A11: worktrees_dir is per-repo in a multi space, needs a slug there", () => {
		expect(worktreesDir(d, "alpha")).toBe(join(d, "code", "alpha", "worktrees"));
		expect(worktreesDir(d)).toBeNull();
	});

	it("A11: worktrees_dir is the root's in a bare space", () => {
		const bare = fixturePath("a1");
		expect(worktreesDir(bare)).toBe(join(bare, "worktrees"));
	});

	it("A13: a root with its own .git is bare, never multi", () => {
		const a13 = fixturePath("a13");
		mkdirSync(join(a13, "code", "x"), { recursive: true });
		initBare(join(a13, ".git"));
		initBare(join(a13, "code", "x", ".git"));
		writeFileSync(join(a13, "HYPER.md"), "");
		expect(spaceLayout(a13)).toBe("bare");
	});

	it("A14: a non-bare repo under code/ is ignored, root is still multi", () => {
		const a14 = fixturePath("a14");
		mkdirSync(a14, { recursive: true });
		writeFileSync(join(a14, "HYPER.md"), "");
		makeCheckout(join(a14, "code", "y"));
		expect(spaceLayout(a14)).toBe("multi");
		expect(spaceRepos(a14)).toEqual([]);
	});

	it("A14b: an empty code/ is a real multi space", () => {
		const a14b = fixturePath("a14b");
		mkdirSync(join(a14b, "code"), { recursive: true });
		writeFileSync(join(a14b, "HYPER.md"), "");
		expect(spaceLayout(a14b)).toBe("multi");
		expect(isSpace(a14b)).toBe(true);
		expect(spaceRepos(a14b)).toEqual([]);
		expect(findSpaceRoot(a14b)).toBe(a14b);
	});

	it("A15: bare repos under code/ with no marker are not a space", () => {
		const a15 = fixturePath("a15");
		mkdirSync(join(a15, "code", "z"), { recursive: true });
		initBare(join(a15, "code", "z", ".git"));
		expect(spaceLayout(a15)).toBeNull();
	});

	it("A16: the legacy HYPERDEV.md marker still opts a multi space in", () => {
		const a16 = fixturePath("a16");
		makeMultiSpace(a16, ["solo"]);
		// rename marker HYPER.md -> HYPERDEV.md
		renameSync(join(a16, "HYPER.md"), join(a16, "HYPERDEV.md"));
		expect(spaceLayout(a16)).toBe("multi");
	});

	it("A18: a nested bare space resolves to itself, the worktree above it to the root", () => {
		const a18 = fixturePath("a18");
		makeMultiSpace(a18, ["alpha"]);
		const nested = join(a18, "code", "alpha", "worktrees", "main", "sub");
		makeBareSpace(nested);
		expect(findSpaceRoot(join(nested, "worktrees"))).toBe(nested);
		expect(findSpaceRoot(join(a18, "code", "alpha", "worktrees", "main"))).toBe(a18);
	});

	it("A19: an unrelated code/<name>/ bare repo resolves as bare", () => {
		const a19 = fixturePath("a19");
		mkdirSync(join(a19, "some", "unrelated", "code"), { recursive: true });
		const thing = join(a19, "some", "unrelated", "code", "thing");
		makeBareSpace(thing);
		expect(findSpaceRoot(thing)).toBe(thing);
		expect(isSpace(join(a19, "some", "unrelated"))).toBe(false);
		expect(spaceLayout(join(a19, "some", "unrelated"))).toBeNull();
	});
});

/**
 * Not ported, on purpose: test-a's A12 (`at_space_root`) and A17/A17b/A17c/A17d
 * (`write_hyper_md`, `scaffold_dirs`). Those exercise lib functions that write
 * files and shape a space; they are still bash-only by design (C-1 keeps the
 * plugin shelling out, C-5 keeps one library), and this suite covers the
 * detection surface only. If a future task wraps them in TS, this is where
 * its cases belong.
 */

describe("detectSpace", () => {
	it("reports a bare space from inside a worktree", () => {
		const d = fixturePath("detect-bare");
		makeBareSpace(d);
		const wt = makeBareSpaceWithWorktree(d, "main");
		expect(existsSync(join(wt, ".git"))).toBe(true);
		expect(detectSpace(wt)).toEqual({
			root: d,
			layout: "bare",
			repos: [],
			slug: null,
			worktreesDir: join(d, "worktrees"),
			// No `.hyper/space.git` yet: an uninitialised space names no git dir
			// and no cadence, which is how a caller learns to run `space init`.
			spaceGitDir: null,
			cadence: null,
		});
	});

	it("reports a multi space and its repos from the root", () => {
		const d = fixturePath("detect-multi");
		makeMultiSpace(d, ["alpha", "beta"]);
		expect(detectSpace(d)).toEqual({
			root: d,
			layout: "multi",
			repos: ["alpha", "beta"],
			slug: null,
			// No slug at the multi root: the lib refuses rather than guess.
			worktreesDir: null,
			spaceGitDir: null,
			cadence: null,
		});
	});

	it("reports a multi space from inside a repo dir, with slug and worktrees", () => {
		// Its own fixture: sharing the previous test's directory made this pass
		// or fail on that test's ordering rather than on its own setup.
		const d = fixturePath("detect-multi-inrepo");
		makeMultiSpace(d, ["alpha", "beta"]);
		const repo = join(d, "code", "alpha");
		expect(detectSpace(repo)).toEqual({
			root: d,
			layout: "multi",
			repos: ["alpha", "beta"],
			slug: "alpha",
			worktreesDir: join(d, "code", "alpha", "worktrees"),
			spaceGitDir: null,
			cadence: null,
		});
	});

	it("reports all-nulls for a plain directory (the case `space detect` exits 1 on)", () => {
		const d = fixturePath("detect-plain");
		mkdirSync(d, { recursive: true });
		expect(detectSpace(d)).toEqual({
			root: null,
			layout: null,
			repos: [],
			slug: null,
			worktreesDir: null,
			spaceGitDir: null,
			cadence: null,
		});
	});

	// The two fields pi's session-end extension reads: a caller that may not run
	// commands in a space learns where its history is and when it saves from one
	// read-only call. Additive for every other caller.
	it("reports the space git dir and cadence of an initialised space", () => {
		const d = fixturePath("detect-cadence");
		makeBareSpace(d);
		expect(detectSpace(d).spaceGitDir).toBeNull();
		initSpaceGitDir(d, { branch: "space/cadence" });
		spaceGit(d, ["config", "hyper.cadence", "session-end+push"]);
		const info = detectSpace(d);
		expect(info.spaceGitDir).toBe(join(d, ".hyper", "space.git"));
		expect(info.cadence).toBe("session-end+push");
	});

	it("reports a cadence it cannot accept as null rather than guessing", () => {
		const d = fixturePath("detect-bad-cadence");
		makeBareSpace(d);
		initSpaceGitDir(d, { branch: "space/bad-cadence" });
		spaceGit(d, ["config", "hyper.cadence", "sometimes"]);
		expect(detectSpace(d).cadence).toBeNull();
	});
});

describe("paths containing spaces", () => {
	// The reason every call passes paths as argv ("$@" inside bash -c) rather
	// than interpolating them into the script string. Under interpolation this
	// whole fixture would silently truncate at the first space.
	it("detects a bare space, and a multi space, under a path with spaces", () => {
		const root = fixturePath("a dir with spaces");
		const bare = join(root, "my space");
		makeBareSpace(bare);
		expect(spaceLayout(bare)).toBe("bare");
		expect(findSpaceRoot(bare)).toBe(bare);
		expect(worktreesDir(bare)).toBe(join(bare, "worktrees"));

		const multi = join(root, "multi space");
		makeMultiSpace(multi, ["alpha"]);
		expect(spaceLayout(multi)).toBe("multi");
		expect(spaceRepos(multi)).toEqual(["alpha"]);
		expect(repoSlugOf(multi, join(multi, "code", "alpha"))).toBe("alpha");
		expect(findSpaceRoot(join(multi, "code", "alpha"))).toBe(multi);
	});

	it("survives a directory name with a quote and a dollar sign", () => {
		const nasty = fixturePath(`qu'ote $var`);
		makeBareSpace(nasty);
		expect(spaceLayout(nasty)).toBe("bare");
		expect(findSpaceRoot(nasty)).toBe(nasty);
	});
});

describe("commands (spawned against the real CLI)", () => {
	// The service tests above exercise the library; these two run the built
	// entrypoint end to end, which is the only place the *contract with the
	// agent-plugin* is visible: one line out of `space lib-path` (a plugin does
	// `source "$(hyper space lib-path | tail -n 1)"` on it), and a friendly
	// non-zero exit rather than a stack trace for a plain directory.
	const cli = join(import.meta.dirname, "..", "..", "cli", "bin", "run.js");

	/**
	 * Run the CLI with colour forced OFF. Two reasons, both observed:
	 *
	 * 1. vitest's config sets FORCE_COLOR=true in the test env, and the spread
	 *    of process.env below would leak it into the child. On a wide terminal
	 *    that is harmless — nothing wraps — but CI runners both force colour
	 *    AND are narrow, so the error arrives as
	 *    "…\u001b[31m›\u001b[39m is\n\u001b[31m›\u001b[39m   not inside a hyper space",
	 *    which breaks every assertion about the rendered text.
	 * 2. The point of these assertions is what the command *says*, not how it
	 *    is styled; pinning the style off keeps that assertion immune to both.
	 *
	 * The flat() normalisation below still strips ANSI codes too, so the test
	 * survives even if some future oclif version colours output anyway.
	 */
	const spawnCli = (args: string[]): SpawnSyncReturns<string> =>
		spawnSync(process.execPath, [cli, ...args], {
			encoding: "utf8",
			env: {
				...process.env,
				AI_AGENT: undefined,
				CLAUDECODE: undefined,
				NO_COLOR: "1",
				FORCE_COLOR: "0",
			},
		});

	/**
	 * Reconstruct the CLI's human-facing sentence from oclif's rendered error.
	 *
	 * oclif renders errors through prettyPrint, which wraps to the width of
	 * whatever runs it, prefixes EVERY continuation line with its gutter
	 * (" ›   "), and colours that gutter — so on a runner the line actually
	 * begins "\u001b[31m›\u001b[39m   ", not " › ". On this machine the terminal
	 * is wide enough to leave the sentence intact, so a local run passes;
	 * a narrow CI runner splits it and the check fails.
	 *
	 * The order of operations matters:
	 *   1. strip ANSI escapes — without this the gutter regex sees
	 *      "\u001b[31m›" and never matches, and the gutter ends up embedded
	 *      inside the sentence,
	 *   2. strip the per-line gutter — "is not inside a hyper space" is broken
	 *      by " › " however many spaces a /\s+/ match allows,
	 *   3. then collapse whitespace.
	 */
	// 27 is ESC. Written via fromCharCode so the regex literal never contains a
	// control character, which biome (rightly) refuses to compile silently.
	const ANSI_RE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
	const stripAnsi = (s: string): string => s.replace(ANSI_RE, "");
	const flat = (s: string): string =>
		stripAnsi(s)
			.replace(/^\s*›\s*/gm, " ")
			.replace(/\s+/g, " ")
			.trim();

	const skipIfUnbuilt = (ctx: TestContext): boolean => {
		if (
			existsSync(cli) &&
			existsSync(join(import.meta.dirname, "..", "dist", "services", "space.js"))
		) {
			return false;
		}
		// `ctx.skip()` rather than `expect.skip()`: the latter does not exist in
		// vitest and throws, turning every skip into a failure.
		ctx.skip("cli/drive not built (run `bun run build` in drive and cli first)");
		return true;
	};

	it("`space lib-path` prints exactly one line, and that path exists", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		const r = spawnCli(["space", "lib-path"]);
		expect(r.status).toBe(0);
		// Exactly one trailing newline and nothing after it: a second line
		// would be sourced as a command by every plugin script.
		expect(r.stdout.endsWith("\n")).toBe(true);
		expect(r.stdout.trimEnd().split("\n")).toHaveLength(1);
		const printed = r.stdout.trimEnd();
		expect(printed).toBe(libPath());
		expect(existsSync(printed)).toBe(true);
		expect(statSync(printed).isFile()).toBe(true);
	});

	it("`space detect` exits 1 with a friendly message in a plain directory", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		// A deliberately long directory name, so the error wraps whatever width
		// the runner has. Without this the wrap only happens on a narrow
		// terminal and the test silently stops covering the case it was
		// written for — it passed locally and failed in CI for exactly that
		// reason.
		const plain = fixturePath("detect-plain-cli-with-a-very-long-name-so-the-error-message-wraps");
		mkdirSync(plain, { recursive: true });
		const r = spawnCli(["space", "detect", plain]);
		expect(r.status).toBe(1);
		const err = flat(r.stderr);
		// Prove the wrap really happened, so this test cannot quietly stop
		// exercising the normalisation it exists for. Counting is stronger than
		// toContain: one gutter line is just oclif's "Error:" prefix, two or more
		// proves a continuation line was actually wrapped. Strip ANSI first — a
		// coloured gutter never matches the /^\s*›/ check.
		const gutterLines = stripAnsi(r.stderr)
			.split("\n")
			.filter((l) => /^\s*›/.test(l));
		expect(gutterLines.length).toBeGreaterThanOrEqual(2);
		expect(err).toContain("is not inside a hyper space");
		// Friendly means no stack trace: the oclif error frame, not JS frames.
		expect(err).not.toContain("at Detect.run");
		expect(err).not.toContain("node:internal");
		// And nothing on stdout, so a `$(...)` capture stays clean.
		expect(r.stdout.trimEnd()).toBe("");
	});

	it("`space detect --json` answers in a bare space", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		const d = fixturePath("detect-bare-cli");
		makeBareSpace(d);
		const r = spawnCli(["space", "detect", d, "--json"]);
		expect(r.status).toBe(0);
		expect(JSON.parse(r.stdout)).toEqual({
			root: d,
			layout: "bare",
			repos: [],
			slug: null,
			worktreesDir: join(d, "worktrees"),
			spaceGitDir: null,
			cadence: null,
		});
	});

	it("`space detect --json` still prints JSON when it exits 1 outside a space", (ctx) => {
		if (skipIfUnbuilt(ctx)) return;
		const plain = fixturePath("detect-plain-json-cli");
		mkdirSync(plain, { recursive: true });
		const r = spawnCli(["space", "detect", plain, "--json"]);
		// Still a failure, so anything branching on the status is unaffected.
		expect(r.status).toBe(1);
		// But a machine caller gets JSON to read rather than an empty stream:
		// `hyper space detect --json | jq` should see nulls, not die.
		expect(JSON.parse(r.stdout)).toEqual({
			root: null,
			layout: null,
			spaceGitDir: null,
			cadence: null,
		});
		// Prose stays on stderr; it is not mixed into the JSON.
		expect(flat(r.stderr)).toContain("is not inside a hyper space");
	});
});
