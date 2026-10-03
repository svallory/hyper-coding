import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	findSpaceRoot,
	isSpace,
	libPath,
	repoSlugOf,
	spaceLayout,
	spaceRepos,
	worktreesDir,
} from "#services/space";
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

	it("resolves from src/ (tests) and dist/ (installed) alike", () => {
		// Two directories below the package root either way, so the same
		// relative specifier works for both. Guard against someone "fixing" it
		// for dist and breaking the other.
		expect(libPath()).toMatch(/\/scripts\/hyper-lib\.sh$/);
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
		// A bare space has no commits, so the worktree add cannot succeed — the
		// same "no ref to check out" situation the bash harness runs into.
		const wt = makeBareSpaceWithWorktree(d, "feat");
		// Put a marker in the worktree: it must still not make a space.
		mkdirSync(wt, { recursive: true });
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
