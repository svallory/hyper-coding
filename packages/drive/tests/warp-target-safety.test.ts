import { spawnSync } from "node:child_process";
import {
	chmodSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	readlinkSync,
	realpathSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalMachine, type MachineRunner } from "#services/remote";
import {
	refsNotCoveredHere,
	TARGET_CONFLICTED,
	TARGET_IN_PROGRESS,
	TARGET_REFTABLE,
	TARGET_SUBMODULE_CHANGED,
	targetBackupCopy,
	targetRefs,
	targetStashSnapshot,
	targetUntrackedPaths,
} from "#services/space-git";
import {
	describeFailure,
	executeWarp,
	findCollisions,
	planWarp,
	targetCompareFiles,
	type WarpDeps,
	type WarpInputs,
	type WarpPlan,
	type WarpStep,
} from "#services/warp";

/**
 * Real git, real shell, real files: a warp whose "target" is a second
 * directory on this machine. Warp copies to the SAME absolute path, so the
 * runner here maps every path under the source home to the target home before
 * it runs anything: the probes and the backup run their real scripts against
 * the target directory, and the copy really writes there. Only Herdr, the
 * marker swap and the branch push are fakes.
 *
 * Every git call is isolated from the machine running the tests (no system or
 * global config, throwaway HOME).
 */

const SESSION = "3d9c77a6-6975-4381-b884-214b3ca452d8";
const STARTED = "2026-10-04T12:00:00.000Z";
const WARP_ID = `${SESSION}-20261004T120000000Z`;

let base: string;
let srcHome: string;
let tgtHome: string;
let env: Record<string, string>;

beforeEach(() => {
	base = realpathSync(mkdtempSync(join(tmpdir(), "warp-safety-")));
	srcHome = join(base, "src-home");
	tgtHome = join(base, "tgt-home");
	mkdirSync(srcHome, { recursive: true });
	mkdirSync(tgtHome, { recursive: true });
	env = {
		HOME: base,
		XDG_CONFIG_HOME: join(base, ".config"),
		GIT_CONFIG_NOSYSTEM: "1",
		GIT_CONFIG_GLOBAL: "/dev/null",
		GIT_AUTHOR_NAME: "t",
		GIT_AUTHOR_EMAIL: "t@e",
		GIT_COMMITTER_NAME: "t",
		GIT_COMMITTER_EMAIL: "t@e",
	};
});

afterEach(() => {
	rmSync(base, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]) {
	const result = spawnSync("git", args, {
		cwd,
		encoding: "utf-8",
		env: { ...process.env, ...env },
	});
	if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
	return result.stdout;
}

function write(path: string, content: string) {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, content);
}

/** Map the source home to the target home in every string. */
const toTarget = (value: string) => value.split(srcHome).join(tgtHome);

/** A runner that "reaches" the target home: the real LocalMachine, paths mapped. */
function mappedRunner(log: string[]): MachineRunner {
	const local = new LocalMachine();
	return {
		async ssh(cmd, opts) {
			log.push(`ssh ${cmd[0]}`);
			return local.ssh(cmd.map(toTarget), { ...opts, env: { ...env, ...(opts?.env ?? {}) } });
		},
		async rsync(src, dst, opts) {
			log.push(`copy ${src}`);
			return local.rsync(src, toTarget(dst), opts);
		},
		async scp() {
			throw new Error("warp never uses scp");
		},
	};
}

interface World {
	run: (plan: WarpPlan) => ReturnType<typeof executeWarp>;
	changes: string[];
	log: string[];
}

function world(): World {
	const log: string[] = [];
	const changes: string[] = [];
	const deps: WarpDeps = {
		runner: mappedRunner(log),
		swapMarker(path, _expected, next) {
			changes.push("marker");
			if (next) write(path, JSON.stringify(next));
		},
		pushBranch(options) {
			if (!options.dryRun) changes.push("push");
			return { url: options.url, branch: options.branch, refspec: "" };
		},
		runHerdr: async (argv) => {
			if (argv.includes("tab")) {
				changes.push("herdr tab");
				return {
					code: 0,
					stdout: JSON.stringify({ result: { root_pane: { pane_id: "w1:p1" } } }),
					stderr: "",
				};
			}
			if (argv.includes("agent")) changes.push("herdr agent");
			return { code: 0, stdout: "", stderr: "" };
		},
		now: () => STARTED,
	};
	return { run: (plan) => executeWarp(plan, deps), changes, log };
}

function transcript(): string {
	const path = join(srcHome, ".claude/projects/p", `${SESSION}.jsonl`);
	write(path, '{"type":"user"}\n');
	return path;
}

function plainRepoPlan(cwdRel: string, overrides: Partial<WarpInputs> = {}): WarpPlan {
	const result = planWarp({
		cwd: join(srcHome, cwdRel),
		selfName: "mac",
		selfHome: srcHome,
		target: { name: "box", host: "me@box", home: srcHome },
		sessionId: SESSION,
		transcriptPath: transcript(),
		transcriptSubfolder: false,
		live: [],
		stop: false,
		force: false,
		remoteControl: false,
		owner: { state: "unowned", path: join(srcHome, ".claude/projects/p", `${SESSION}.warp.json`) },
		strayMarker: null,
		cwdKind: "git-repo",
		space: null,
		spaceInManifest: null,
		excludes: ["node_modules", "dist"],
		trackedUnderExcludes: [],
		syncSession: null,
		agentSuffix: "k1",
		startedAt: STARTED,
		...overrides,
	});
	if (!result.ok) throw new Error(result.message);
	return result.plan;
}

/** Every path and every byte under `root`, plus file modes. */
function snapshot(root: string): Record<string, string> {
	const out: Record<string, string> = {};
	const walk = (dir: string) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) walk(path);
			else if (entry.isSymbolicLink()) out[relative(root, path)] = `-> ${readlinkSync(path)}`;
			else out[relative(root, path)] = readFileSync(path, "base64");
		}
	};
	walk(root);
	return out;
}

/**
 * The same project on both sides, as separate repositories (a plain repo's
 * `.git` travels with it): committed `a.txt`, ignore rules for `.env`,
 * `*.secret` and `node_modules`.
 */
function twinRepos(rel = "work/repo") {
	const src = join(srcHome, rel);
	const tgt = join(tgtHome, rel);
	mkdirSync(src, { recursive: true });
	git(src, "init", "-q", "-b", "main");
	write(join(src, ".gitignore"), ".env\n*.secret\nnode_modules\n");
	write(join(src, "a.txt"), "a\n");
	git(src, "add", ".");
	git(src, "commit", "-q", "-m", "a");
	// The target has the same history (the same refs), as after an earlier warp.
	mkdirSync(tgt, { recursive: true });
	git(tgt, "init", "-q", "-b", "main");
	git(tgt, "fetch", "-q", "--update-head-ok", src, "main:main");
	git(tgt, "reset", "-q", "--hard");
	// git writes objects 0444, and both sides hold the same objects. rsync
	// replaces a file through a temporary and a rename; the Node copy this
	// runner uses writes in place, so it needs them writable.
	spawnSync("chmod", ["-R", "u+w", join(tgt, ".git")]);
	return { src, tgt };
}

describe("ignored and untracked files on the target (items 1 and 2)", () => {
	function populate(src: string, tgt: string) {
		// Collides: ignored on the target, different content.
		write(join(src, ".env"), "API_KEY=local-placeholder\n");
		write(join(tgt, ".env"), "API_KEY=target-placeholder\n");
		// Collides: untracked on the target, different content.
		write(join(src, "notes/todo.txt"), "local todo\n");
		write(join(tgt, "notes/todo.txt"), "target todo, longer\n");
		// Identical on both sides: not a collision.
		write(join(src, "same.txt"), "same\n");
		write(join(tgt, "same.txt"), "same\n");
		// Excluded by the copy (default node_modules): never a collision.
		write(join(src, "node_modules/x.js"), "local\n");
		write(join(tgt, "node_modules/x.js"), "target\n");
		// Ignored on the target, but the copy does not write it: not a collision.
		write(join(tgt, "keep.secret"), "target only\n");
	}

	it("refuses an ignored .env alone without --force, and the target's .env is intact", async () => {
		const { src, tgt } = twinRepos();
		write(join(src, ".env"), "API_KEY=local-placeholder\n");
		write(join(tgt, ".env"), "API_KEY=target-placeholder\n");
		const w = world();
		const result = await w.run(plainRepoPlan("work/repo"));
		expect(readFileSync(join(tgt, ".env"), "utf-8")).toBe("API_KEY=target-placeholder\n");
		expect(result.failure?.detail).toContain("  .env");
		expect(w.changes).toEqual([]);
	});

	it("refuses without --force, naming exactly the colliding paths, and changes nothing on either side", async () => {
		const { src, tgt } = twinRepos();
		populate(src, tgt);
		// Untracked files alone already make the target "dirty" without --force
		// (git status lists them); leave only ignored ones for this check.
		write(join(src, "notes/todo.secret"), "local todo\n");
		write(join(tgt, "notes/todo.secret"), "target todo, longer\n");
		rmSync(join(src, "notes/todo.txt"));
		rmSync(join(tgt, "notes/todo.txt"));
		rmSync(join(src, "same.txt"));
		rmSync(join(tgt, "same.txt"));
		write(join(src, "same.secret"), "same\n");
		write(join(tgt, "same.secret"), "same\n");
		const before = snapshot(tgt);
		const w = world();
		const result = await w.run(plainRepoPlan("work/repo"));
		expect(result.failure?.step.summary).toContain("untracked or ignored entries");
		expect(result.failure?.detail).toContain("  .env");
		expect(result.failure?.detail).toContain("  notes/todo.secret");
		expect(result.failure?.detail).not.toContain("same.secret");
		expect(result.failure?.detail).not.toContain("node_modules");
		expect(result.failure?.detail).not.toContain("keep.secret");
		expect(w.changes).toEqual([]);
		expect(w.log.some((entry) => entry.startsWith("copy"))).toBe(false);
		expect(snapshot(tgt)).toEqual(before);
		expect(readFileSync(join(tgt, ".env"), "utf-8")).toBe("API_KEY=target-placeholder\n");
	});

	it("with --force, copies the colliding files aside (0700, byte-identical) before overwriting them, and says where", async () => {
		const { src, tgt } = twinRepos();
		populate(src, tgt);
		// The target repo's own .git must keep the backup: the local .git has a
		// stale one that must not travel.
		write(join(src, ".git/hyper-warp-backup/old/x"), "stale\n");
		const w = world();
		const result = await w.run(plainRepoPlan("work/repo", { force: true }));
		expect(result.failure, result.failure?.detail).toBeUndefined();
		const backup = join(tgt, ".git/hyper-warp-backup", WARP_ID);
		expect(readFileSync(join(backup, ".env"), "utf-8")).toBe("API_KEY=target-placeholder\n");
		expect(readFileSync(join(backup, "notes/todo.txt"), "utf-8")).toBe("target todo, longer\n");
		expect(readdirSync(backup).sort()).toEqual([".env", "notes"]);
		expect(statSync(backup).mode & 0o777).toBe(0o700);
		expect(statSync(join(backup, "notes")).mode & 0o777).toBe(0o700);
		expect(statSync(join(tgt, ".git/hyper-warp-backup")).mode & 0o777).toBe(0o700);
		// ...and then the copy did overwrite them.
		expect(readFileSync(join(tgt, ".env"), "utf-8")).toBe("API_KEY=local-placeholder\n");
		expect(readFileSync(join(tgt, "node_modules/x.js"), "utf-8")).toBe("target\n");
		expect(readFileSync(join(tgt, "keep.secret"), "utf-8")).toBe("target only\n");
		expect(() => statSync(join(tgt, ".git/hyper-warp-backup/old"))).toThrow();
		expect(result.notices.join("\n")).toContain(`(2) were first copied to ${backup}`);
	});

	it("with --force and no collision, makes no backup", async () => {
		const { src, tgt } = twinRepos();
		write(join(src, "same.txt"), "same\n");
		write(join(tgt, "same.txt"), "same\n");
		const w = world();
		const result = await w.run(plainRepoPlan("work/repo", { force: true }));
		expect(result.failure, result.failure?.detail).toBeUndefined();
		expect(() => statSync(join(tgt, ".git/hyper-warp-backup"))).toThrow();
		expect(result.skipped.some((summary) => summary.includes("aside"))).toBe(true);
	});

	it("default excludes never collide, even with an ignored dir full of different files", async () => {
		const { src, tgt } = twinRepos();
		for (const dir of ["node_modules/pkg", "dist", "sub/node_modules"]) {
			write(join(src, dir, "f.js"), "local\n");
			write(join(tgt, dir, "f.js"), "target\n");
		}
		writeFileSync(join(tgt, ".gitignore"), ".env\n*.secret\nnode_modules\ndist\n");
		git(tgt, "commit", "-qam", "ignore dist");
		writeFileSync(join(src, ".gitignore"), ".env\n*.secret\nnode_modules\ndist\n");
		git(src, "commit", "-qam", "ignore dist");
		const found = await findCollisions(
			mappedRunner([]),
			plainRepoPlan("work/repo").steps.find(
				(step): step is Extract<WarpStep, { kind: "probe" }> =>
					step.kind === "probe" && step.id === "collisions",
			)?.argv as string[],
			{
				src,
				dst: src,
				excludes: ["node_modules", "dist"],
				compareArgv: targetCompareFiles(src),
				refuse: true,
			},
		);
		expect(found).toEqual({ ok: true, collisions: [] });
	});

	it("compares symlinks by their link text, and an untracked directory file by file", async () => {
		const { src, tgt } = twinRepos();
		const { symlinkSync } = await import("node:fs");
		symlinkSync("a.txt", join(src, "link-same"));
		symlinkSync("a.txt", join(tgt, "link-same"));
		symlinkSync("a.txt", join(src, "link-diff"));
		symlinkSync(".gitignore", join(tgt, "link-diff"));
		write(join(src, "build/one.txt"), "1\n");
		write(join(src, "build/two.txt"), "2\n");
		write(join(tgt, "build/one.txt"), "1\n");
		write(join(tgt, "build/two.txt"), "two\n");
		const plan = plainRepoPlan("work/repo", { force: true });
		const step = plan.steps.find(
			(entry): entry is Extract<WarpStep, { kind: "probe" }> =>
				entry.kind === "probe" && entry.id === "collisions",
		) as Extract<WarpStep, { kind: "probe" }>;
		const found = await findCollisions(mappedRunner([]), step.argv, {
			...(step.collisions as NonNullable<typeof step.collisions>),
			compareArgv: targetCompareFiles(src),
		});
		if (!found.ok) throw new Error(found.stderr);
		const listed = found.collisions.map((entry) => `  ${entry.path}`).join("\n");
		expect(listed).toContain("  link-diff");
		expect(listed).toContain("  build/two.txt");
		expect(listed).not.toContain("link-same");
		expect(listed).not.toContain("build/one.txt");
	});
});

describe("git state on the target that nothing can save (items 3, 5, 6)", () => {
	it("refuses a merge in progress, --force or not, naming it, before any change on either side", async () => {
		const { tgt } = twinRepos();
		git(tgt, "checkout", "-q", "-b", "side");
		write(join(tgt, "side.txt"), "side\n");
		git(tgt, "add", ".");
		git(tgt, "commit", "-q", "-m", "side");
		git(tgt, "checkout", "-q", "main");
		git(tgt, "merge", "-q", "--no-ff", "--no-commit", "side");
		const before = snapshot(tgt);
		for (const force of [false, true]) {
			const w = world();
			const result = await w.run(plainRepoPlan("work/repo", { force }));
			expect(result.failure?.step.summary).toContain("no git operation in progress");
			expect(result.failure?.detail).toContain("in the middle of a git operation");
			expect(result.failure?.detail).toContain("a merge is in progress");
			expect(w.changes).toEqual([]);
			expect(w.log.some((entry) => entry.startsWith("copy"))).toBe(false);
			expect(snapshot(tgt)).toEqual(before);
		}
	});

	it("names a cherry-pick and a bisect too", async () => {
		const { tgt } = twinRepos();
		git(tgt, "bisect", "start");
		const w = world();
		const result = await w.run(plainRepoPlan("work/repo", { force: true }));
		expect(result.failure?.detail).toContain("a bisect is in progress");
		git(tgt, "bisect", "reset");
		writeFileSync(join(tgt, ".git/CHERRY_PICK_HEAD"), `${git(tgt, "rev-parse", "HEAD")}`);
		const again = await world().run(plainRepoPlan("work/repo", { force: true }));
		expect(again.failure?.detail).toContain("a cherry-pick is in progress");
	});

	it("refuses an index with unresolved conflicts under --force (no merge state: a conflicted stash pop), before overwriting anything", async () => {
		const { tgt } = twinRepos();
		writeFileSync(join(tgt, "a.txt"), "stashed\n");
		git(tgt, "stash", "-q");
		writeFileSync(join(tgt, "a.txt"), "committed later\n");
		git(tgt, "commit", "-qam", "later");
		spawnSync("git", ["stash", "pop", "-q"], { cwd: tgt, env: { ...process.env, ...env } });
		expect(git(tgt, "ls-files", "--unmerged")).not.toBe("");
		const before = snapshot(tgt);
		const w = world();
		const result = await w.run(plainRepoPlan("work/repo", { force: true }));
		expect(result.failure?.detail).toContain("unresolved conflicts");
		expect(result.failure?.detail).toContain("  a.txt");
		expect(
			describeFailure(plainRepoPlan("work/repo", { force: true }), result, { restored: false }),
		).toContain("Nothing was changed on either machine");
		expect(w.changes).toEqual([]);
		expect(snapshot(tgt)).toEqual(before);
	});

	it("the stash snapshot itself also stops on a conflicted index (the backstop the review read)", () => {
		const { tgt } = twinRepos();
		writeFileSync(join(tgt, "a.txt"), "stashed\n");
		git(tgt, "stash", "-q");
		writeFileSync(join(tgt, "a.txt"), "committed later\n");
		git(tgt, "commit", "-qam", "later");
		spawnSync("git", ["stash", "pop", "-q"], { cwd: tgt, env: { ...process.env, ...env } });
		const argv = targetStashSnapshot(tgt, "m");
		const result = spawnSync(argv[0] as string, argv.slice(1), {
			encoding: "utf-8",
			env: { ...process.env, ...env },
		});
		expect(result.status).not.toBe(0);
	});

	it("refuses a submodule with changes inside it, with and without --force, saying nothing inside is saved", async () => {
		const { tgt } = twinRepos();
		const lib = join(base, "lib");
		mkdirSync(lib);
		git(lib, "init", "-q", "-b", "main");
		write(join(lib, "l.txt"), "l\n");
		git(lib, "add", ".");
		git(lib, "commit", "-q", "-m", "l");
		git(tgt, "-c", "protocol.file.allow=always", "submodule", "add", "-q", lib, "lib");
		git(tgt, "commit", "-q", "-m", "sub");
		writeFileSync(join(tgt, "lib/l.txt"), "edited inside the submodule\n");
		const before = snapshot(tgt);
		for (const force of [false, true]) {
			const w = world();
			const result = await w.run(plainRepoPlan("work/repo", { force }));
			expect(result.failure?.detail).toContain("has changes in submodules");
			expect(result.failure?.detail).toContain(
				"nothing inside a submodule is ever saved before it is overwritten",
			);
			expect(result.failure?.detail).toContain("  lib");
			expect(w.changes).toEqual([]);
			expect(snapshot(tgt)).toEqual(before);
		}
	});

	it("the status probe never runs a hook or fsmonitor the target configured, and writes no index lock", () => {
		const { tgt } = twinRepos();
		const marker = join(base, "fsmonitor-ran");
		const hook = join(base, "fsmonitor.sh");
		writeFileSync(hook, `#!/bin/sh\ntouch '${marker}'\nexit 1\n`);
		chmodSync(hook, 0o755);
		git(tgt, "config", "core.fsmonitor", hook);
		const plan = plainRepoPlan("work/repo");
		for (const id of ["target-clean", "collisions"]) {
			const step = plan.steps.find((entry) => entry.kind === "probe" && entry.id === id) as Extract<
				WarpStep,
				{ kind: "probe" }
			>;
			const argv = step.argv.map(toTarget);
			const result = spawnSync(argv[0] as string, argv.slice(1), {
				encoding: "utf-8",
				env: { ...process.env, ...env },
			});
			expect(result.status, result.stderr).toBe(0);
		}
		expect(() => statSync(marker)).toThrow();
	});
});

describe("exit codes of the status probe", () => {
	it("are distinct", () => {
		expect(new Set([TARGET_IN_PROGRESS, TARGET_CONFLICTED, TARGET_SUBMODULE_CHANGED]).size).toBe(3);
	});
});

describe("a type change on the target is a collision (PR #51 review, BLOCKER 1)", () => {
	/**
	 * Three type changes, all ignored on the target (its info/exclude), so the
	 * dirty check is clean and only the collision check can see them:
	 *  - typx: a file there, a directory here;
	 *  - lnk:  a symlink there (pointing outside the repo), a directory here;
	 *  - typd: a directory there, a file here.
	 */
	function typeChanges() {
		const { src, tgt } = twinRepos();
		const outside = join(base, "outside");
		write(join(outside, "keep.txt"), "outside the repo\n");
		write(join(tgt, ".git/info/exclude"), "typx\nlnk\ntypd\n");
		write(join(tgt, "typx"), "T-file-x\n");
		write(join(src, "typx/child"), "local child\n");
		symlinkSync(outside, join(tgt, "lnk"));
		write(join(src, "lnk/inside.txt"), "local, inside lnk/\n");
		write(join(tgt, "typd/inner"), "T-inner\n");
		write(join(src, "typd"), "local file typd\n");
		return { src, tgt, outside };
	}

	it("refuses all three without --force, saying what differs, and changes nothing on either side", async () => {
		const { tgt, outside } = typeChanges();
		const before = snapshot(tgt);
		const w = world();
		const result = await w.run(plainRepoPlan("work/repo"));
		const detail = result.failure?.detail ?? "";
		expect(detail).toContain("  typx (a file there, a directory here)");
		expect(detail).toContain("  lnk (a symlink there, a directory here)");
		expect(detail).toContain("  typd (a directory there, a file here)");
		expect(w.changes).toEqual([]);
		expect(w.log.some((entry) => entry.startsWith("copy"))).toBe(false);
		expect(snapshot(tgt)).toEqual(before);
		expect(readdirSync(outside)).toEqual(["keep.txt"]);
	});

	it("with --force, copies each aside (cp -pPR), removes it, and the copy then writes this machine's type", async () => {
		const { tgt, outside } = typeChanges();
		const w = world();
		const result = await w.run(plainRepoPlan("work/repo", { force: true }));
		expect(result.failure, result.failure?.detail).toBeUndefined();
		const backup = join(tgt, ".git/hyper-warp-backup", WARP_ID);
		expect(readFileSync(join(backup, "typx"), "utf-8")).toBe("T-file-x\n");
		expect(readlinkSync(join(backup, "lnk"))).toBe(outside);
		expect(readFileSync(join(backup, "typd/inner"), "utf-8")).toBe("T-inner\n");
		// The backup root is 0700; what cp -pPR copies under it keeps its own modes.
		expect(statSync(backup).mode & 0o777).toBe(0o700);
		expect(readFileSync(join(tgt, "typx/child"), "utf-8")).toBe("local child\n");
		expect(lstatSync(join(tgt, "lnk")).isDirectory()).toBe(true);
		expect(readFileSync(join(tgt, "lnk/inside.txt"), "utf-8")).toBe("local, inside lnk/\n");
		expect(readFileSync(join(tgt, "typd"), "utf-8")).toBe("local file typd\n");
		// Nothing was written through the target's symlink.
		expect(readdirSync(outside)).toEqual(["keep.txt"]);
		expect(result.notices.join("\n")).toContain(`(3) were first copied to ${backup}`);
	});

	it("catches a file here where the target's TRACKED directory holds an untracked file", async () => {
		const { src, tgt } = twinRepos();
		write(join(src, "dir/t.txt"), "tracked\n");
		git(src, "add", ".");
		git(src, "commit", "-q", "-m", "dir");
		git(tgt, "fetch", "-q", "--update-head-ok", src, "main:main");
		git(tgt, "reset", "-q", "--hard");
		write(join(tgt, "dir/extra.secret"), "untracked inside a tracked dir\n");
		git(src, "rm", "-q", "-r", "dir");
		write(join(src, "dir"), "now a file\n");
		const found = await findCollisions(
			mappedRunner([]),
			plainRepoPlan("work/repo").steps.find(
				(step): step is Extract<WarpStep, { kind: "probe" }> =>
					step.kind === "probe" && step.id === "collisions",
			)?.argv as string[],
			{ src, dst: src, excludes: [], compareArgv: targetCompareFiles(src), refuse: true },
		);
		expect(found).toEqual({
			ok: true,
			collisions: [{ path: "dir", replace: true, note: "a directory there, a file here" }],
		});
	});
});

describe("a plain repo's refs on the target (PR #51 review, HIGH 2)", () => {
	function targetOnlyCommit() {
		const { src, tgt } = twinRepos();
		write(join(tgt, "t.txt"), "committed only on the target\n");
		git(tgt, "add", "t.txt");
		git(tgt, "commit", "-q", "-m", "target only");
		git(tgt, "branch", "only-there");
		return { src, tgt, commit: git(tgt, "rev-parse", "HEAD").trim() };
	}

	it("refuses a target-only commit and a target-only branch without --force, changing nothing", async () => {
		const { tgt } = targetOnlyCommit();
		const before = snapshot(tgt);
		const w = world();
		const result = await w.run(plainRepoPlan("work/repo"));
		expect(result.failure?.detail).toContain("refs/heads/main (has commits this machine doesn't)");
		expect(result.failure?.detail).toContain("refs/heads/only-there (only there)");
		expect(w.changes).toEqual([]);
		expect(snapshot(tgt)).toEqual(before);
	});

	it("with --force, the target-only commit stays reachable from the backup refs afterwards", async () => {
		const { src, tgt, commit } = targetOnlyCommit();
		const w = world();
		const result = await w.run(plainRepoPlan("work/repo", { force: true }));
		expect(result.failure, result.failure?.detail).toBeUndefined();
		// The copy replaced the target's main with this machine's...
		expect(git(tgt, "rev-parse", "refs/heads/main").trim()).toBe(
			git(src, "rev-parse", "HEAD").trim(),
		);
		// ...and the target's commit is still reachable, by name.
		const ns = `refs/hyper-warp-backup/${WARP_ID}`;
		expect(git(tgt, "rev-parse", `${ns}/heads/main`).trim()).toBe(commit);
		expect(git(tgt, "rev-parse", `${ns}/heads/only-there`).trim()).toBe(commit);
		expect(git(tgt, "cat-file", "-p", `${ns}/heads/main:t.txt`)).toBe(
			"committed only on the target\n",
		);
		expect(result.notices.join("\n")).toContain(`saved there under ${ns}/`);
	});

	it("covered refs (same commit, or behind this machine's) pass without --force", async () => {
		const { src, tgt } = twinRepos();
		write(join(src, "b.txt"), "ahead here\n");
		git(src, "add", "b.txt");
		git(src, "commit", "-q", "-m", "ahead");
		const refs = git(tgt, "for-each-ref", "--format=%(objectname) %(refname)")
			.trim()
			.split("\n")
			.map((line) => {
				const [object, name] = line.split(" ");
				return { object: object as string, name: name as string };
			});
		expect(refsNotCoveredHere(src, refs)).toEqual([]);
		expect(refsNotCoveredHere(src, [{ object: "0".repeat(40), name: "refs/heads/main" }])).toEqual([
			{ name: "refs/heads/main", reason: "has commits this machine doesn't" },
		]);
	});

	it("a detached HEAD on a target-only commit is refused too", async () => {
		const { tgt } = targetOnlyCommit();
		git(tgt, "checkout", "-q", "--detach");
		git(tgt, "branch", "-q", "-f", "main", "HEAD~1");
		git(tgt, "branch", "-q", "-D", "only-there");
		const result = await world().run(plainRepoPlan("work/repo"));
		expect(result.failure?.detail).toContain("HEAD (has commits this machine doesn't)");
	});
});

describe("the --force stash never runs the target's fsmonitor (PR #51 review, suggestion)", () => {
	it("passes core.fsmonitor=false to the stash commands, and a configured hook does not run", () => {
		const argv = targetStashSnapshot("/x", "m");
		expect(argv.join(" ")).toContain("-c core.fsmonitor=false");
		const { tgt } = twinRepos();
		const marker = join(base, "fsmonitor-ran");
		const hook = join(base, "fsmonitor.sh");
		writeFileSync(hook, `#!/bin/sh\ntouch '${marker}'\nexit 1\n`);
		chmodSync(hook, 0o755);
		git(tgt, "config", "core.fsmonitor", hook);
		writeFileSync(join(tgt, "a.txt"), "changed\n");
		const real = targetStashSnapshot(tgt, "m");
		const result = spawnSync(real[0] as string, real.slice(1), {
			encoding: "utf-8",
			env: { ...process.env, ...env },
		});
		expect(result.status, result.stderr).toBe(0);
		expect(() => statSync(marker)).toThrow();
	});
});

/** Run a target script (argv from space-git) here, with the isolated git env. */
function runScript(argv: string[], input?: string) {
	return spawnSync(argv[0] as string, argv.slice(1), {
		encoding: "utf-8",
		env: { ...process.env, ...env },
		...(input === undefined ? {} : { input }),
	});
}

describe("a tracked directory on the target where this machine has a file (fw-warp-2 item 1)", () => {
	/**
	 * Both sides committed `trk/t.txt`; this machine then replaced the
	 * directory with a file `trk` and committed that. The target is clean, at
	 * the older commit: nothing there is untracked, so only the tracked-
	 * directory listing can see the type change.
	 */
	function trackedDirectoryHere() {
		const { src, tgt } = twinRepos();
		write(join(src, "trk/t.txt"), "tracked in a directory\n");
		git(src, "add", ".");
		git(src, "commit", "-q", "-m", "trk dir");
		git(tgt, "fetch", "-q", "--update-head-ok", src, "main:main");
		git(tgt, "reset", "-q", "--hard");
		spawnSync("chmod", ["-R", "u+w", join(tgt, ".git")]);
		git(src, "rm", "-q", "-r", "trk");
		write(join(src, "trk"), "now a file here\n");
		git(src, "add", "trk");
		git(src, "commit", "-q", "-m", "trk file");
		return { src, tgt };
	}

	it("the listing names the target's tracked directories with a leading /", () => {
		const { tgt } = trackedDirectoryHere();
		write(join(tgt, "deep/er/x.txt"), "x\n");
		git(tgt, "add", ".");
		git(tgt, "commit", "-q", "-m", "deep");
		const listed = runScript(targetUntrackedPaths(tgt));
		expect(listed.status, listed.stderr).toBe(0);
		const entries = listed.stdout.split("\0").filter(Boolean);
		expect(entries).toContain("/trk");
		expect(entries).toContain("/deep/er");
		// Files at the top level have no parent directory to report.
		expect(entries.some((entry) => entry === "/" || entry === "/a.txt")).toBe(false);
	});

	it("refuses without --force before any change, naming the path and the type change", async () => {
		const { tgt } = trackedDirectoryHere();
		const before = snapshot(tgt);
		const w = world();
		const result = await w.run(plainRepoPlan("work/repo"));
		expect(result.failure?.step.summary).toContain("tracked directories");
		expect(result.failure?.detail).toContain("  trk (a directory there, a file here)");
		expect(w.changes).toEqual([]);
		expect(w.log.some((entry) => entry.startsWith("copy"))).toBe(false);
		expect(snapshot(tgt)).toEqual(before);
	});

	it("with --force, copies the tracked directory aside, removes it, and the copy writes this machine's file", async () => {
		const { src, tgt } = trackedDirectoryHere();
		const w = world();
		const result = await w.run(plainRepoPlan("work/repo", { force: true }));
		expect(result.failure, result.failure?.detail).toBeUndefined();
		const backup = join(tgt, ".git/hyper-warp-backup", WARP_ID);
		expect(readFileSync(join(backup, "trk/t.txt"), "utf-8")).toBe("tracked in a directory\n");
		expect(readFileSync(join(tgt, "trk"), "utf-8")).toBe("now a file here\n");
		expect(git(tgt, "rev-parse", "HEAD")).toBe(git(src, "rev-parse", "HEAD"));
		expect(git(tgt, "status", "--porcelain")).toBe("");
		expect(result.notices.join("\n")).toContain(`(1) were first copied to ${backup}`);
	});

	it("a target left half-way (its .git already this machine's, the directory still there) recovers with --force", async () => {
		const { src, tgt } = trackedDirectoryHere();
		// What the old behaviour left: the copy replaced .git, then failed on trk.
		spawnSync("cp", ["-pR", `${join(src, ".git")}/.`, join(tgt, ".git")]);
		spawnSync("chmod", ["-R", "u+w", join(tgt, ".git")]);
		expect(git(tgt, "status", "--porcelain")).toBe(" D trk\n");
		// Not untracked any more: the index records trk as a file.
		expect(runScript(targetUntrackedPaths(tgt)).stdout.split("\0")).toContain("/trk");
		const before = snapshot(tgt);
		const refused = world();
		const without = await refused.run(plainRepoPlan("work/repo"));
		expect(without.failure?.detail).toContain("uncommitted work");
		expect(refused.changes).toEqual([]);
		expect(snapshot(tgt)).toEqual(before);
		const result = await world().run(plainRepoPlan("work/repo", { force: true }));
		expect(result.failure, result.failure?.detail).toBeUndefined();
		expect(readFileSync(join(tgt, "trk"), "utf-8")).toBe("now a file here\n");
		expect(readFileSync(join(tgt, ".git/hyper-warp-backup", WARP_ID, "trk/t.txt"), "utf-8")).toBe(
			"tracked in a directory\n",
		);
		expect(git(tgt, "status", "--porcelain")).toBe("");
	});

	it("the reverse (a tracked FILE there, a directory here) is not a collision: git has the file", async () => {
		const { src, tgt } = twinRepos();
		write(join(src, "rev"), "a tracked file\n");
		git(src, "add", ".");
		git(src, "commit", "-q", "-m", "rev file");
		git(tgt, "fetch", "-q", "--update-head-ok", src, "main:main");
		git(tgt, "reset", "-q", "--hard");
		git(src, "rm", "-q", "rev");
		write(join(src, "rev/inner.txt"), "now a directory here\n");
		git(src, "add", ".");
		git(src, "commit", "-q", "-m", "rev dir");
		const step = plainRepoPlan("work/repo").steps.find(
			(entry): entry is Extract<WarpStep, { kind: "probe" }> =>
				entry.kind === "probe" && entry.id === "collisions",
		) as Extract<WarpStep, { kind: "probe" }>;
		const found = await findCollisions(mappedRunner([]), step.argv, {
			src,
			dst: src,
			excludes: [],
			compareArgv: targetCompareFiles(src),
			refuse: true,
		});
		expect(found).toEqual({ ok: true, collisions: [] });
	});

	it("an excluded tracked directory is not a candidate", async () => {
		const { src, tgt } = twinRepos();
		write(join(tgt, "dist/keep.txt"), "tracked under an excluded dir\n");
		git(tgt, "add", "-f", "dist");
		git(tgt, "commit", "-q", "-m", "dist");
		write(join(src, "dist"), "a file here, but the copy excludes dist\n");
		const found = await findCollisions(mappedRunner([]), targetUntrackedPaths(src), {
			src,
			dst: src,
			excludes: ["dist"],
			compareArgv: targetCompareFiles(src),
			refuse: true,
		});
		expect(found).toEqual({ ok: true, collisions: [] });
	});
});

describe("saved refs survive a target pack-refs and a later warp (fw-warp-2 item 2)", () => {
	it("save, git pack-refs --all on the target, warp again: the saved commits are still reachable by name", async () => {
		const { src, tgt } = twinRepos();
		write(join(tgt, "t.txt"), "committed only on the target\n");
		git(tgt, "add", "t.txt");
		git(tgt, "commit", "-q", "-m", "target only");
		const commit = git(tgt, "rev-parse", "HEAD").trim();
		const first = await world().run(plainRepoPlan("work/repo", { force: true }));
		expect(first.failure, first.failure?.detail).toBeUndefined();
		const ns = `refs/hyper-warp-backup/${WARP_ID}`;
		git(tgt, "pack-refs", "--all");
		// This machine's refs are packed too (as after any gc), so the next
		// copy really replaces the target's packed-refs.
		git(src, "pack-refs", "--all");
		// Packed: the loose file the copy leaves alone is gone.
		expect(() => statSync(join(tgt, ".git", ns, "heads/main"))).toThrow();
		expect(readFileSync(join(tgt, ".git/packed-refs"), "utf-8")).toContain(`${ns}/heads/main`);
		// A second warp (nothing uncovered now, so no --force needed). The
		// target's t.txt is in the saved commit; untracked now, it would make
		// the target dirty.
		rmSync(join(tgt, "t.txt"));
		spawnSync("chmod", ["-R", "u+w", join(tgt, ".git")]);
		const later = world();
		const second = await later.run(
			plainRepoPlan("work/repo", { startedAt: "2026-10-04T13:00:00.000Z" }),
		);
		expect(second.failure, second.failure?.detail).toBeUndefined();
		// The copy replaced packed-refs with this machine's, which has no backups...
		expect(readFileSync(join(tgt, ".git/packed-refs"), "utf-8")).not.toContain(ns);
		// ...and the saved ref is still there, loose, at the target's commit.
		expect(readFileSync(join(tgt, ".git", ns, "heads/main"), "utf-8")).toBe(`${commit}\n`);
		expect(git(tgt, "rev-parse", `${ns}/heads/main`).trim()).toBe(commit);
		expect(git(tgt, "cat-file", "-p", `${ns}/heads/main:t.txt`)).toBe(
			"committed only on the target\n",
		);
		// The pin step ran before the copy.
		const pin = later.log.findIndex((entry) => entry.startsWith("ssh sh"));
		expect(pin).toBeGreaterThanOrEqual(0);
	});

	it("leaves an already-loose saved ref alone and prints nothing", () => {
		const { tgt } = twinRepos();
		git(tgt, "update-ref", "refs/hyper-warp-backup/x/heads/main", "HEAD");
		const plan = plainRepoPlan("work/repo");
		const pin = plan.steps.find(
			(entry) => entry.kind === "remote-command" && entry.summary.startsWith("keep earlier warps"),
		) as Extract<WarpStep, { kind: "remote-command" }>;
		const result = runScript(pin.argv.map(toTarget));
		expect(result.status, result.stderr).toBe(0);
		expect(result.stdout).toBe("");
	});

	it("runs in every plain-repo warp, after the saves and right before the copy", () => {
		for (const force of [false, true]) {
			const steps = plainRepoPlan("work/repo", { force }).steps;
			const pin = steps.findIndex(
				(entry) =>
					entry.kind === "remote-command" && entry.summary.startsWith("keep earlier warps"),
			);
			const copy = steps.findIndex(
				(entry) => entry.kind === "copy" && entry.summary.startsWith("copy git-repo"),
			);
			expect(pin).toBeGreaterThan(0);
			expect(copy).toBe(pin + 1);
		}
	});
});

describe("a reftable repository on the target (fw-warp-2 item 3)", () => {
	function reftableTarget() {
		const { src } = twinRepos();
		const tgt = join(tgtHome, "work/repo");
		rmSync(tgt, { recursive: true, force: true });
		mkdirSync(tgt, { recursive: true });
		git(tgt, "init", "-q", "-b", "main", "--ref-format=reftable");
		git(tgt, "fetch", "-q", "--update-head-ok", src, "main:main");
		git(tgt, "reset", "-q", "--hard");
		return { src, tgt };
	}

	it("the refs probe exits TARGET_REFTABLE before listing anything", (ctx) => {
		const probe = spawnSync("git", ["init", "-q", "--ref-format=reftable", join(base, "probe")], {
			env: { ...process.env, ...env },
		});
		if (probe.status !== 0) ctx.skip("this git has no reftable support");
		const { tgt } = reftableTarget();
		const result = runScript(targetRefs(tgt));
		expect(result.status).toBe(TARGET_REFTABLE);
		expect(result.stdout).toBe("extensions.refStorage=reftable\n");
	});

	it("is refused with and without --force, naming the format, and nothing changes", async (ctx) => {
		const probe = spawnSync("git", ["init", "-q", "--ref-format=reftable", join(base, "probe")], {
			env: { ...process.env, ...env },
		});
		if (probe.status !== 0) ctx.skip("this git has no reftable support");
		const { tgt } = reftableTarget();
		const before = snapshot(tgt);
		for (const force of [false, true]) {
			const w = world();
			const result = await w.run(plainRepoPlan("work/repo", { force }));
			expect(result.failure?.step.summary).toContain("check every ref");
			expect(result.failure?.detail).toContain("keeps its refs in the reftable format");
			expect(result.failure?.detail).toContain("with or without --force");
			expect(w.changes).toEqual([]);
			expect(w.log.some((entry) => entry.startsWith("copy"))).toBe(false);
			expect(snapshot(tgt)).toEqual(before);
		}
	});
});

describe("target-only refs at commits this machine reaches are covered (fw-warp-2 item 4)", () => {
	it("a remote-tracking ref and a tag only the target has, at commits this machine has, pass without --force", async () => {
		const { src, tgt } = twinRepos();
		const older = git(src, "rev-parse", "HEAD").trim();
		write(join(src, "b.txt"), "ahead here\n");
		git(src, "add", "b.txt");
		git(src, "commit", "-q", "-m", "ahead");
		const newer = git(src, "rev-parse", "HEAD").trim();
		// The target fetched more recently: it has refs this machine lacks, at
		// commits this machine has (one its main reaches, one an ancestor).
		git(tgt, "fetch", "-q", src, "main");
		git(tgt, "update-ref", "refs/remotes/origin/main", newer);
		git(tgt, "tag", "t-only", older);
		git(tgt, "tag", "-a", "-m", "annotated", "a-only", older);
		const refs = runScript(targetRefs(tgt))
			.stdout.trim()
			.split("\n")
			.map((line) => {
				const [object, name, peeled] = line.split(" ");
				return { object: object as string, name: name as string, peeled };
			});
		// The annotated tag's object exists only there; the commit it tags is here.
		expect(refs.find((ref) => ref.name === "refs/tags/a-only")?.peeled).toBe(older);
		expect(refs.map((ref) => ref.name)).toEqual(
			expect.arrayContaining(["refs/remotes/origin/main", "refs/tags/t-only", "refs/tags/a-only"]),
		);
		expect(refsNotCoveredHere(src, refs)).toEqual([]);
		spawnSync("chmod", ["-R", "u+w", join(tgt, ".git")]);
		const w = world();
		const result = await w.run(plainRepoPlan("work/repo"));
		expect(result.failure, result.failure?.detail).toBeUndefined();
	});

	it("a same-name ref at a commit another of this machine's refs reaches is covered", () => {
		const { src } = twinRepos();
		const base0 = git(src, "rev-parse", "HEAD").trim();
		git(src, "checkout", "-q", "-b", "side");
		write(join(src, "s.txt"), "side\n");
		git(src, "add", "s.txt");
		git(src, "commit", "-q", "-m", "side");
		const side = git(src, "rev-parse", "HEAD").trim();
		git(src, "checkout", "-q", "main");
		// The target's main is at `side`, which is not behind this machine's
		// main, but this machine's `side` branch reaches it.
		expect(refsNotCoveredHere(src, [{ object: side, name: "refs/heads/main" }])).toEqual([]);
		expect(refsNotCoveredHere(src, [{ object: base0, name: "refs/heads/main" }])).toEqual([]);
	});

	it("a target-only ref at a commit this machine lacks is still refused, without --force", async () => {
		const { tgt } = twinRepos();
		write(join(tgt, "t.txt"), "only there\n");
		git(tgt, "add", "t.txt");
		git(tgt, "commit", "-q", "-m", "only there");
		git(tgt, "update-ref", "refs/remotes/origin/feature", "HEAD");
		git(tgt, "reset", "-q", "--hard", "HEAD~1");
		const before = snapshot(tgt);
		const w = world();
		const result = await w.run(plainRepoPlan("work/repo"));
		expect(result.failure?.detail).toContain("refs/remotes/origin/feature (only there)");
		expect(result.failure?.detail).not.toContain("refs/heads/main");
		expect(w.changes).toEqual([]);
		expect(snapshot(tgt)).toEqual(before);
	});

	it("a commit this machine has but no ref of it reaches is not covered", () => {
		const { src } = twinRepos();
		write(join(src, "d.txt"), "dangling\n");
		git(src, "add", "d.txt");
		git(src, "commit", "-q", "-m", "dangling");
		const dangling = git(src, "rev-parse", "HEAD").trim();
		git(src, "reset", "-q", "--hard", "HEAD~1");
		git(src, "reflog", "expire", "--expire=now", "--all");
		expect(refsNotCoveredHere(src, [{ object: dangling, name: "refs/tags/x" }])).toEqual([
			{ name: "refs/tags/x", reason: "only there" },
		]);
	});
});

describe("the backup script refuses paths outside the repository (fw-warp-2 item 5)", () => {
	for (const bad of ["R../outside", "K/etc/hosts", "Ra/../../outside", "R..", "K", "Xa.txt"]) {
		it(`refuses ${JSON.stringify(bad)} before copying or removing anything`, () => {
			const { tgt } = twinRepos();
			write(join(tgt, "keep.secret"), "kept\n");
			const outside = join(tgtHome, "work/outside");
			write(outside, "outside\n");
			const result = runScript(targetBackupCopy(tgt, "id1"), `Rkeep.secret\0${bad}\0`);
			expect(result.status).toBe(7);
			expect(readFileSync(outside, "utf-8")).toBe("outside\n");
			expect(readFileSync(join(tgt, "keep.secret"), "utf-8")).toBe("kept\n");
			expect(() => statSync(join(tgt, ".git/hyper-warp-backup/id1"))).toThrow();
		});
	}

	it("still accepts names that only look like it (a..b, .hidden, -dash)", () => {
		const { tgt } = twinRepos();
		for (const name of ["a..b", ".hidden", "-dash"]) write(join(tgt, name), `${name}\n`);
		const result = runScript(targetBackupCopy(tgt, "id2"), "Ka..b\0K.hidden\0R-dash\0");
		expect(result.status, result.stderr).toBe(0);
		const backup = join(tgt, ".git/hyper-warp-backup/id2");
		expect(readFileSync(join(backup, "a..b"), "utf-8")).toBe("a..b\n");
		expect(readFileSync(join(backup, "-dash"), "utf-8")).toBe("-dash\n");
		expect(() => statSync(join(tgt, "-dash"))).toThrow();
	});
});
