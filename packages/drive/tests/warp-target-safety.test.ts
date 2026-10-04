import { spawnSync } from "node:child_process";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalMachine, type MachineRunner } from "#services/remote";
import {
	TARGET_CONFLICTED,
	TARGET_IN_PROGRESS,
	TARGET_SUBMODULE_CHANGED,
	targetStashSnapshot,
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
	for (const dir of [src, tgt]) {
		mkdirSync(dir, { recursive: true });
		git(dir, "init", "-q", "-b", "main");
		write(join(dir, ".gitignore"), ".env\n*.secret\nnode_modules\n");
		write(join(dir, "a.txt"), "a\n");
		git(dir, "add", ".");
		git(dir, "commit", "-q", "-m", "a");
	}
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
		expect(result.failure?.step.summary).toContain("untracked or ignored files");
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
		expect(found).toEqual({ ok: true, paths: [] });
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
		const listed = found.paths.map((path) => `  ${path}`).join("\n");
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
