import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MachineRunner } from "#services/remote";
import type { LiveSession, OwnerMarker } from "#services/sessions";
import { TARGET_WORKTREE_STATE } from "#services/space-git";
import {
	describeFailure,
	describeSpace,
	describeStep,
	describeWarp,
	executeWarp,
	MarkerConflictError,
	PANE_PLACEHOLDER,
	type ProbeId,
	planWarp,
	REMOTE_CONTROL_FLAG,
	readPaneId,
	restoreMarker,
	resumeAgentArgs,
	spaceBarePath,
	swapMarker,
	type WarpDeps,
	type WarpExecution,
	type WarpInputs,
	type WarpPlan,
	type WarpSpaceInfo,
	type WarpStep,
} from "#services/warp";

/**
 * Warp's contract is ORDER: every refusal before the first change on either
 * machine. So most tests here EXECUTE a plan against a fake target that
 * answers each probe the way a scenario says, and assert on one event log in
 * which every call is tagged "probe" or "change". A recorded call list alone
 * proves nothing about order; this log does.
 */

/** The words a probe script hands to `test`, in order. */
function testWords(script: string): string[] {
	return [...script.matchAll(/test -[dw] (\S.*?)(?= \|\||$|;)/g)].map(
		(match) => match[1] as string,
	);
}

/**
 * git for the real-repo fixtures, isolated from the machine running the
 * tests: no system or global config (a signing helper there, like 1Password's,
 * makes every commit fail), a throwaway HOME, and an identity of its own.
 */
function isolatedGit(cwd: string, home: string) {
	const env = {
		...process.env,
		HOME: home,
		XDG_CONFIG_HOME: join(home, ".config"),
		GIT_CONFIG_NOSYSTEM: "1",
		GIT_CONFIG_GLOBAL: "/dev/null",
		GIT_AUTHOR_NAME: "t",
		GIT_AUTHOR_EMAIL: "t@e",
		GIT_COMMITTER_NAME: "t",
		GIT_COMMITTER_EMAIL: "t@e",
	};
	return (...args: string[]) => {
		const result = spawnSync("git", args, { cwd, encoding: "utf-8", env });
		if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
		return result;
	};
}

/** Run `line` through a real POSIX shell and report the argv it produced. */
function argvAfterShell(line: string): string[] {
	const result = spawnSync(
		"/bin/sh",
		["-c", `set -- ${line}; for a in "$@"; do printf "%s\\n" "$a"; done`],
		{ encoding: "utf-8" },
	);
	return result.stdout.split("\n").slice(0, -1);
}

const SESSION = "3d9c77a6-6975-4381-b884-214b3ca452d8";
/**
 * A fixture home: a plain string the planner compares paths against. It is
 * never read, and it is deliberately NOT the real home, so no test names (or
 * could touch) the operator's ~/.claude, and results don't depend on $HOME.
 */
const HOME = "/home/warp-fixture";
const CWD = `${HOME}/work/hyper`;
const FOLDER = `${HOME}/.claude/projects/-home-warp-fixture-work-hyper`;
const TRANSCRIPT = `${FOLDER}/${SESSION}.jsonl`;
const ROOT = `${HOME}/work/spaces/research`;
const WT = `${ROOT}/worktrees/feat-warp`;
const SPACE: WarpSpaceInfo = {
	root: ROOT,
	name: "research",
	barePath: `${ROOT}/.git`,
	branch: "feat-warp",
};
const TAB_JSON = JSON.stringify({
	result: { tab: { tab_id: "w1:t1" }, root_pane: { pane_id: "w1:p1", tab_id: "w1:t1" } },
});

/** Inputs that pass every pre-flight check, so a test can vary one thing. */
function inputs(overrides: Partial<WarpInputs> = {}): WarpInputs {
	return {
		cwd: CWD,
		selfName: "mac",
		selfHome: HOME,
		target: { name: "netcup", host: "me@box", home: HOME },
		sessionId: SESSION,
		transcriptPath: TRANSCRIPT,
		transcriptSubfolder: false,
		live: [],
		stop: false,
		force: false,
		remoteControl: false,
		owner: { state: "unowned", path: `${FOLDER}/${SESSION}.warp.json` },
		cwdKind: "plain-dir",
		space: null,
		excludes: ["node_modules"],
		syncSession: null,
		agentSuffix: "k1",
		...overrides,
	};
}

function planOf(overrides: Partial<WarpInputs> = {}): WarpPlan {
	const result = planWarp(inputs(overrides));
	if (!result.ok) throw new Error(`expected a plan, got a refusal: ${result.message}`);
	return result.plan;
}

function spacePlan(overrides: Partial<WarpInputs> = {}): WarpPlan {
	return planOf({ cwd: WT, cwdKind: "space-worktree", space: SPACE, ...overrides });
}

function refuseWith(overrides: Partial<WarpInputs> = {}) {
	const result = planWarp(inputs(overrides));
	if (result.ok) throw new Error("expected a refusal, got a plan");
	return result;
}

const kinds = (steps: WarpStep[]) => steps.map((step) => step.kind);
const probeOf = (plan: WarpPlan, id: ProbeId) =>
	plan.steps.find((step) => step.kind === "probe" && step.id === id) as
		| Extract<WarpStep, { kind: "probe" }>
		| undefined;

/** One call the executor made, tagged by whether it can change anything. */
interface Event {
	type: "probe" | "change";
	what: string;
}

/**
 * A fake target. Each probe is recognised by its argv (looked up in the plan)
 * and answered with the exit code the scenario gives its id (default 0).
 */
interface Scenario {
	probes?: Partial<Record<ProbeId, number>>;
	/** Exit code of every copy (default 0). */
	copyCode?: number;
	/** Exit code of remote commands, by argv[0]..argv[2] joined (default 0). */
	commands?: Record<string, number>;
	tabJson?: string;
	stopOutcome?: Awaited<ReturnType<NonNullable<WarpDeps["stop"]>>>;
	stillLive?: LiveSession[];
	pushFails?: string;
}

interface Run {
	deps: WarpDeps;
	events: Event[];
	ssh: string[][];
	/** ssh calls made in the change phase (not probes). */
	remote: string[][];
	copies: { src: string; dst: string; excludes: string[] }[];
	herdr: string[][];
	markers: { path: string; expected: OwnerMarker | null; next: OwnerMarker | null }[];
	pushes: { url: string; branch: string; checkedOutAtSamePath?: boolean; dryRun?: boolean }[];
	stops: number[];
}

function fakeTarget(plan: WarpPlan, scenario: Scenario = {}): Run {
	const probeByArgv = new Map<string, ProbeId>();
	for (const step of plan.steps) {
		if (step.kind === "probe") probeByArgv.set(JSON.stringify(step.argv), step.id);
	}
	const run: Run = {
		events: [],
		ssh: [],
		remote: [],
		copies: [],
		herdr: [],
		markers: [],
		pushes: [],
		stops: [],
		deps: undefined as unknown as WarpDeps,
	};
	const runner: MachineRunner = {
		async ssh(cmd) {
			run.ssh.push(cmd);
			// The same argv can be a probe AND, later, a post-clone check (the
			// bare-repo test). Before the first change it is the probe; after it,
			// a step of the change phase.
			const changed = run.events.some((event) => event.type === "change");
			const id = changed ? undefined : probeByArgv.get(JSON.stringify(cmd));
			if (id) {
				run.events.push({ type: "probe", what: id });
				return { code: scenario.probes?.[id] ?? 0, stdout: "", stderr: "" };
			}
			const key = cmd.slice(0, 3).join(" ");
			run.remote.push(cmd);
			run.events.push({ type: "change", what: `remote ${key}` });
			return { code: scenario.commands?.[key] ?? 0, stdout: "", stderr: "" };
		},
		async rsync(src, dst, opts) {
			run.copies.push({ src, dst, excludes: opts?.excludes ?? [] });
			run.events.push({ type: "change", what: `copy ${src}` });
			const code = scenario.copyCode ?? 0;
			return { code, stdout: "", stderr: code ? "some files could not be transferred" : "" };
		},
		async scp() {
			throw new Error("warp never uses scp");
		},
	};
	run.deps = {
		runner,
		async stop(pid) {
			run.stops.push(pid);
			run.events.push({ type: "change", what: `stop ${pid}` });
			return scenario.stopOutcome === undefined ? "terminated" : scenario.stopOutcome;
		},
		liveSessions: () => scenario.stillLive ?? [],
		swapMarker(path, expected, next) {
			run.markers.push({ path, expected, next });
			run.events.push({ type: "change", what: "marker" });
		},
		pushBranch(options) {
			run.pushes.push(options);
			run.events.push({
				type: options.dryRun ? "probe" : "change",
				what: options.dryRun ? "push-check" : "push",
			});
			if (scenario.pushFails && options.dryRun) throw new Error(scenario.pushFails);
			return { url: options.url, branch: options.branch, refspec: "" };
		},
		flushSync: async (session) => {
			run.events.push({ type: "change", what: `flush ${session}` });
		},
		runHerdr: async (argv) => {
			run.herdr.push(argv);
			const probe = argv.includes("pane") && argv.includes("list");
			run.events.push({ type: probe ? "probe" : "change", what: `herdr ${argv[2]} ${argv[3]}` });
			if (probe) return { code: scenario.probes?.herdr ?? 0, stdout: "", stderr: "" };
			if (argv.includes("tab"))
				return { code: 0, stdout: scenario.tabJson ?? TAB_JSON, stderr: "" };
			return { code: 0, stdout: "", stderr: "" };
		},
		now: () => "2026-10-04T12:00:00.000Z",
	};
	return run;
}

/** Every probe event precedes every change event. */
function expectProbesFirst(events: Event[]) {
	const lastProbe = events.map((event) => event.type).lastIndexOf("probe");
	const firstChange = events.findIndex((event) => event.type === "change");
	if (firstChange >= 0) expect(lastProbe, JSON.stringify(events)).toBeLessThan(firstChange);
}

const LIVE: LiveSession = { pid: 27145, cwd: `${HOME}/work`, startedAt: 1_700_000_000_000 };

describe("order: every check before the first change, for every kind of working directory", () => {
	const cases: [string, () => WarpPlan, Scenario][] = [
		["a plain directory", () => planOf({ stop: true, live: [LIVE] }), {}],
		["a plain git repo", () => planOf({ cwdKind: "git-repo", stop: true, live: [LIVE] }), {}],
		[
			"a space worktree whose space is on the target",
			() => spacePlan({ stop: true, live: [LIVE] }),
			{ probes: { worktree: 1 } },
		],
		[
			"a space worktree whose space is on the target, worktree already registered",
			() => spacePlan({ stop: true, live: [LIVE] }),
			{ probes: { worktree: 0 } },
		],
		[
			"a space worktree whose space is missing on the target",
			() => spacePlan({ stop: true, live: [LIVE] }),
			{ probes: { space: 1 } },
		],
		[
			"a plain directory with a config-sync session",
			() => planOf({ syncSession: "hyper-claude-netcup", stop: true, live: [LIVE] }),
			{},
		],
	];
	for (const [label, build, scenario] of cases) {
		it(`completes with every probe before the first change: ${label}`, async () => {
			const plan = build();
			const run = fakeTarget(plan, scenario);
			const result = await executeWarp(plan, run.deps);
			expect(result.failure, result.failure?.detail).toBeUndefined();
			expectProbesFirst(run.events);
			// The first change is the stop, then the marker.
			const changes = run.events.filter((event) => event.type === "change");
			expect(changes[0]?.what).toBe(`stop ${LIVE.pid}`);
			expect(changes[1]?.what).toBe("marker");
		});
	}

	// The two AC-16 cases the review reproduced in a container (blocker 1).
	it("refuses a space on the target with an unwritable worktrees/ dir BEFORE stopping or writing anything", async () => {
		const plan = spacePlan({ stop: true, live: [LIVE] });
		const run = fakeTarget(plan, { probes: { "space-parent": 67 } });
		const result = await executeWarp(plan, run.deps);
		expect(result.failure?.step.summary).toContain(`${ROOT}/worktrees`);
		expect(result.failure?.detail).toContain("isn't writable");
		expect(run.events.filter((event) => event.type === "change")).toEqual([]);
		expect(run.stops).toEqual([]);
		expect(run.markers).toEqual([]);
		expect(run.pushes.filter((push) => !push.dryRun)).toEqual([]);
		expect(result.copied).toBe(false);
	});

	it("refuses a missing space whose nearest existing ancestor is unwritable BEFORE stopping or writing anything", async () => {
		const plan = spacePlan({ stop: true, live: [LIVE] });
		const run = fakeTarget(plan, { probes: { space: 1, "space-ancestor": 67 } });
		const result = await executeWarp(plan, run.deps);
		expect(result.failure?.step.summary).toContain(`${ROOT} can be created`);
		expect(run.events.filter((event) => event.type === "change")).toEqual([]);
		expect(run.stops).toEqual([]);
		expect(run.markers).toEqual([]);
	});

	it("never places a probe after a mutating step, in any plan", () => {
		const plans = [
			planOf({ stop: true, live: [LIVE] }),
			planOf({ cwdKind: "git-repo" }),
			spacePlan({ stop: true, live: [LIVE], transcriptSubfolder: true }),
			planOf({ syncSession: "hyper-claude-netcup" }),
		];
		for (const plan of plans) {
			const order = kinds(plan.steps);
			const firstChange = order.findIndex((kind) => kind !== "probe");
			expect(order.lastIndexOf("probe")).toBeLessThan(firstChange);
		}
	});

	it("says nothing changed when a probe refuses, and never 'nothing needs undoing'", async () => {
		const plan = spacePlan({ stop: true, live: [LIVE] });
		const run = fakeTarget(plan, { probes: { "space-parent": 67 } });
		const result = await executeWarp(plan, run.deps);
		const message = describeFailure(plan, result, restoreMarker(plan, result));
		expect(message).toContain("Nothing was changed on either machine");
		expect(message).not.toContain("nothing needs undoing");
		expect(message).not.toContain("claude --resume");
	});
});

describe("the space worktree on the target is a real git worktree (blocker 3)", () => {
	it("first warp of a missing space: clone at a pinned path, verify the repo, push, add, reset, copy without .git", async () => {
		const plan = spacePlan();
		const run = fakeTarget(plan, { probes: { space: 1 } });
		const result = await executeWarp(plan, run.deps);
		expect(result.failure).toBeUndefined();
		const remote = run.remote;
		expect(remote[0]).toEqual(["hyper", "space", "clone", "--yes", "--", "research", ROOT]);
		expect(remote[1]).toEqual([
			"git",
			`--git-dir=${ROOT}/.git`,
			"rev-parse",
			"--is-bare-repository",
		]);
		expect(remote[2]?.slice(-6)).toEqual([
			"worktree",
			"add",
			"--no-checkout",
			"--",
			WT,
			"feat-warp",
		]);
		expect(remote[2]?.slice(0, 2)).toEqual(["git", `--git-dir=${ROOT}/.git`]);
		expect(remote[3]?.slice(-2)).toEqual(["reset", "-q"]);
		expect(remote[3]).toContain(WT);
		const changes = run.events
			.filter((event) => event.type === "change")
			.map((event) => event.what);
		const at = (prefix: string) => changes.findIndex((what) => what.startsWith(prefix));
		expect(at("remote hyper space clone")).toBeLessThan(at("push"));
		expect(at("push")).toBeLessThan(at(`remote git --git-dir=${ROOT}/.git -c`));
		expect(at(`remote git -C ${WT}`)).toBeLessThan(at(`copy ${WT}`));
		const worktreeCopy = run.copies.find((copy) => copy.src === `${WT}/`);
		expect(worktreeCopy?.excludes[0]).toBe("/.git");
		// The push never tells receive-pack to accept a checked-out branch here.
		expect(run.pushes.find((push) => !push.dryRun)?.checkedOutAtSamePath).toBe(false);
	});

	it("does not ask for hyper, nor clone, when the space is already there", async () => {
		const plan = spacePlan();
		const run = fakeTarget(plan, { probes: { worktree: 1 } });
		await executeWarp(plan, run.deps);
		const probed = run.events.filter((event) => event.type === "probe").map((event) => event.what);
		expect(probed).not.toContain("hyper");
		expect(probed).not.toContain("space-ancestor");
		expect(run.ssh.some((argv) => argv[0] === "hyper" || argv[0] === "command")).toBe(false);
	});

	it("re-warp into a registered worktree on the same branch: no add, push allowed to move the checked-out branch, reset", async () => {
		const plan = spacePlan({
			force: true,
			owner: { state: "owned", path: "/m", marker: { owner: "netcup", at: "t" } },
		});
		const run = fakeTarget(plan, { probes: { worktree: 0 } });
		const result = await executeWarp(plan, run.deps);
		expect(result.failure).toBeUndefined();
		expect(run.ssh.some((argv) => argv.includes("worktree") && argv.includes("add"))).toBe(false);
		expect(run.ssh.some((argv) => argv.includes("reset"))).toBe(true);
		expect(run.pushes.find((push) => !push.dryRun)?.checkedOutAtSamePath).toBe(true);
	});

	for (const [state, phrase] of [
		[TARGET_WORKTREE_STATE.otherBranchHere, "another branch"],
		[TARGET_WORKTREE_STATE.branchElsewhere, "checked out in another worktree"],
		[TARGET_WORKTREE_STATE.occupied, "isn't a worktree of the space"],
		[TARGET_WORKTREE_STATE.registeredButMissing, "worktree prune"],
	] as const) {
		it(`refuses in the probe block when the worktree state is ${state} (${phrase})`, async () => {
			const plan = spacePlan();
			const run = fakeTarget(plan, { probes: { worktree: state } });
			const result = await executeWarp(plan, run.deps);
			expect(result.failure?.detail).toContain(phrase);
			expect(run.events.filter((event) => event.type === "change")).toEqual([]);
		});
	}

	it("refuses a non-fast-forward push in the probe block (git push --dry-run)", async () => {
		const plan = spacePlan();
		const run = fakeTarget(plan, { pushFails: "! [rejected] feat-warp (fetch first)" });
		const result = await executeWarp(plan, run.deps);
		expect(result.failure?.step.summary).toContain("--dry-run");
		expect(result.failure?.detail).toContain("fetch first");
		expect(run.events.filter((event) => event.type === "change")).toEqual([]);
	});

	it("reports a worktrees/ dir the clone made unwritable as a step failure, with what completed", async () => {
		const plan = spacePlan();
		const run = fakeTarget(plan, {
			probes: { space: 1 },
			commands: { [`git --git-dir=${ROOT}/.git -c`]: 128 },
		});
		const result = await executeWarp(plan, run.deps);
		expect(result.failure?.step.summary).toContain("register");
		const message = describeFailure(plan, result, restoreMarker(plan, result));
		expect(message).toContain("Done before that:");
		expect(message).toContain("clone the space");
		expect(message).toContain(`branch feat-warp in ${ROOT}/.git`);
		expect(message).not.toContain("Nothing was changed");
	});

	it("pins the clone destination and keeps a space named like an option from parsing as one", () => {
		const plan = spacePlan({
			cwd: `${HOME}/sp/-x/worktrees/main`,
			space: { root: `${HOME}/sp/-x`, name: "-x", barePath: `${HOME}/sp/-x/.git`, branch: "main" },
		});
		const clone = plan.steps.find(
			(step) => step.kind === "remote-command" && step.argv[0] === "hyper",
		) as Extract<WarpStep, { kind: "remote-command" }>;
		expect(clone.argv).toEqual(["hyper", "space", "clone", "--yes", "--", "-x", `${HOME}/sp/-x`]);
		expect(clone.argv.indexOf("--")).toBeLessThan(clone.argv.indexOf("-x"));
	});

	it("says in the plan that the index does not travel", () => {
		expect(spacePlan().notes.join("\n")).toContain("the index does not travel");
	});
});

describe("ownership (blocker 2)", () => {
	it("refuses a re-warp to the machine that already owns the session", () => {
		const refusal = refuseWith({
			owner: { state: "owned", path: "/m", marker: { owner: "netcup", at: "2026-10-04" } },
		});
		expect(refusal.exit).toBe(2);
		expect(refusal.message).toContain("lives on netcup now");
		expect(refusal.message).toContain("Warp it back from there");
		expect(refusal.message).toContain("--force to overwrite netcup's copy with this machine's");
	});

	it("proceeds with --force, and the marker swap expects the old marker", async () => {
		const previous = { owner: "netcup", at: "2026-10-04" };
		const plan = planOf({ force: true, owner: { state: "owned", path: "/m", marker: previous } });
		const run = fakeTarget(plan);
		await executeWarp(plan, run.deps);
		expect(run.markers[0]?.expected).toEqual(previous);
		expect(run.markers[0]?.next).toEqual({ owner: "netcup", at: "2026-10-04T12:00:00.000Z" });
	});

	it("refuses a foreign owner (C-10)", () => {
		const refusal = refuseWith({
			owner: { state: "owned", path: "/m", marker: { owner: "other-box", at: "yesterday" } },
		});
		expect(refusal.exit).toBe(2);
		expect(refusal.message).toContain("other-box");
		expect(refusal.message).toContain("--force");
	});

	it("allows a session this machine owns, without --force", () => {
		const plan = planOf({
			owner: { state: "owned", path: "/m", marker: { owner: "mac", at: "yesterday" } },
		});
		expect(plan.target.name).toBe("netcup");
	});

	it("refuses a malformed ownership marker rather than guessing an owner", () => {
		const refusal = refuseWith({
			owner: { state: "malformed", path: "/m.json", reason: "not valid JSON" },
		});
		expect(refusal.exit).toBe(2);
		expect(refusal.message).toContain("not valid JSON");
	});

	it("copies only this session's files, never the project folder", () => {
		const plan = planOf({ transcriptSubfolder: true });
		const copies = plan.steps.filter((step) => step.kind === "copy");
		expect(copies.map((copy) => [copy.src, copy.tree])).toEqual([
			[TRANSCRIPT, false],
			[`${FOLDER}/${SESSION}`, true],
			[`${FOLDER}/${SESSION}.warp.json`, false],
			[CWD, true],
		]);
		expect(copies.some((copy) => copy.src === FOLDER)).toBe(false);
	});

	it("skips the session folder when there is none", () => {
		const plan = planOf();
		expect(plan.steps.filter((step) => step.kind === "copy").map((copy) => copy.src)).toEqual([
			TRANSCRIPT,
			`${FOLDER}/${SESSION}.warp.json`,
			CWD,
		]);
	});

	it("says in the plan that the target's directory is overwritten file by file, with no --delete", () => {
		const notes = planOf().notes.join("\n");
		expect(notes).toContain("overwritten file by file");
		expect(notes).toContain("no --delete");
		expect(JSON.stringify(planOf().steps)).not.toContain("--delete");
	});
});

describe("the ownership marker is compare-and-swap", () => {
	let dir: string;
	let path: string;
	const mine = { owner: "netcup", at: "2026-10-04T12:00:00.000Z" };
	const theirs = { owner: "other", at: "2026-10-04T12:00:01.000Z" };

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "warp-marker-"));
		path = join(dir, `${SESSION}.warp.json`);
	});
	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	const read = () => JSON.parse(readFileSync(path, "utf-8")) as OwnerMarker;

	it("creates a marker only when there is none (exclusive create)", () => {
		swapMarker(path, null, mine);
		expect(read()).toEqual(mine);
		expect(() => swapMarker(path, null, theirs)).toThrow(MarkerConflictError);
		expect(read()).toEqual(mine);
	});

	it("replaces a marker only when it is the expected one", () => {
		writeFileSync(path, JSON.stringify(theirs));
		expect(() => swapMarker(path, mine, { owner: "x", at: "y" })).toThrow(MarkerConflictError);
		expect(read()).toEqual(theirs);
		swapMarker(path, theirs, mine);
		expect(read()).toEqual(mine);
	});

	it("lets exactly one of two warps that read the same state win", () => {
		swapMarker(path, null, mine);
		expect(() => swapMarker(path, null, theirs)).toThrow(/changed while warp was running/);
		expect(read()).toEqual(mine);
	});

	it("leaves no temporary files behind, whichever way it goes", () => {
		swapMarker(path, null, mine);
		expect(() => swapMarker(path, theirs, mine)).toThrow();
		swapMarker(path, mine, null);
		expect(existsSync(path)).toBe(false);
		expect(spawnSync("ls", ["-A", dir], { encoding: "utf-8" }).stdout).toBe("");
	});

	it("restoreMarker never deletes a marker this run did not write", async () => {
		const plan = withMarkerAt(planOf(), path);
		const run = fakeTarget(plan, { copyCode: 0 });
		run.deps.swapMarker = swapMarker;
		// Make the first copy throw before any transfer, so nothing was copied.
		run.deps.runner = {
			...run.deps.runner,
			rsync: async () => {
				throw new Error("no route");
			},
		};
		const result = await executeWarp(plan, run.deps);
		// …but this run DID try the copy, so it counts as copied; drive the
		// undo directly to test the compare.
		const notCopied: WarpExecution = { ...result, copied: false };
		writeFileSync(path, JSON.stringify(theirs)); // another warp replaced it
		const undone = restoreMarker(plan, notCopied);
		expect(undone.restored).toBe(false);
		expect(undone.reason).toContain("changed while warp was running");
		expect(read()).toEqual(theirs);
	});

	it("restoreMarker removes the marker it wrote when nothing was copied and there was none before", () => {
		const plan = withMarkerAt(planOf(), path);
		swapMarker(path, null, mine);
		const execution: WarpExecution = {
			completed: [],
			skipped: [],
			copied: false,
			stopped: [],
			markerWritten: mine,
			agentName: plan.agentName,
			failure: { step: { kind: "flush-sync", summary: "x" }, detail: "y" },
		};
		expect(restoreMarker(plan, execution)).toEqual({ restored: true });
		expect(existsSync(path)).toBe(false);
	});

	it("restoreMarker puts the previous owner back when nothing was copied", () => {
		const previous = { owner: "other-box", at: "yesterday" };
		const plan = withMarkerAt(
			planOf({ force: true, owner: { state: "owned", path, marker: previous } }),
			path,
		);
		swapMarker(path, null, mine);
		const execution: WarpExecution = {
			completed: [],
			skipped: [],
			copied: false,
			stopped: [],
			markerWritten: mine,
			agentName: plan.agentName,
		};
		expect(restoreMarker(plan, execution).restored).toBe(true);
		expect(read()).toEqual(previous);
	});
});

/** Re-point a plan's marker at a temp file, so undo can be tested off-HOME. */
function withMarkerAt(plan: WarpPlan, path: string): WarpPlan {
	return {
		...plan,
		steps: plan.steps.map((entry) => (entry.kind === "write-marker" ? { ...entry, path } : entry)),
	};
}

describe("a copy that reached the transfer counts as copied (HIGH 5)", () => {
	for (const code of [23, 24, 12]) {
		it(`exit ${code} leaves the marker in place and says what may have arrived`, async () => {
			const plan = planOf();
			const run = fakeTarget(plan, { copyCode: code });
			const result = await executeWarp(plan, run.deps);
			expect(result.copied).toBe(true);
			const undo = restoreMarker(plan, result);
			expect(undo.restored).toBe(false);
			const message = describeFailure(plan, result, undo);
			expect(message).toContain("What may now be on netcup: possibly part of the transcript");
			expect(message).toContain("The ownership marker still says netcup owns this session");
			expect(message).toContain("hyper warp netcup --force");
			if (code === 23) expect(message).toContain("PARTIAL transfer");
		});
	}

	it("a working-directory copy that fails after the transcript arrived lists both", async () => {
		const plan = planOf();
		let calls = 0;
		const run = fakeTarget(plan);
		run.deps.runner = {
			...run.deps.runner,
			async rsync() {
				calls += 1;
				return calls < 3
					? { code: 0, stdout: "", stderr: "" }
					: { code: 23, stdout: "", stderr: "permission denied" };
			},
		};
		const result = await executeWarp(plan, run.deps);
		const message = describeFailure(plan, result, restoreMarker(plan, result));
		expect(message).toContain(`the transcript ${TRANSCRIPT}`);
		expect(message).toContain(`possibly part of files under ${CWD}`);
	});
});

describe("paths the remote side would refuse are refused at planning (HIGH 6)", () => {
	for (const cwd of [`${HOME}/my proj`, `${HOME}/it's`, `${HOME}/a@b`, `${HOME}/$(id)`]) {
		it(`refuses ${JSON.stringify(cwd)} before any step exists`, () => {
			const refusal = refuseWith({ cwd, transcriptPath: TRANSCRIPT });
			expect(refusal.exit).toBe(2);
			expect(refusal.message).toContain("can't be sent to netcup");
		});
	}

	it("refuses a transcript folder outside the rule too", () => {
		const refusal = refuseWith({
			transcriptPath: `${HOME}/.claude/projects/odd folder/${SESSION}.jsonl`,
		});
		expect(refusal.message).toContain("The transcript folder");
	});

	it("refuses a cwd with a newline in it", () => {
		const refusal = refuseWith({ cwd: `${HOME}/evil\nrm -rf ~` });
		expect(refusal.message).toContain("control character");
	});
});

describe("failure messages are built from what happened (HIGH 7)", () => {
	it("after --stop, a failed warp says how to resume here", async () => {
		const plan = planOf({ stop: true, live: [LIVE] });
		const run = fakeTarget(plan, { copyCode: 11 });
		const result = await executeWarp(plan, run.deps);
		const message = describeFailure(plan, result, restoreMarker(plan, result));
		expect(message).toContain(`claude --resume ${SESSION}`);
		expect(message).toContain(`stop session ${SESSION} (pid ${LIVE.pid})`);
	});

	it("a stop that fails says nothing was copied only through the step record", async () => {
		const plan = planOf({ stop: true, live: [LIVE] });
		const run = fakeTarget(plan, { stopOutcome: "survived" });
		const result = await executeWarp(plan, run.deps);
		expect(result.copied).toBe(false);
		expect(run.markers).toEqual([]);
		const message = describeFailure(plan, result, restoreMarker(plan, result));
		expect(message).toContain("No change had completed before that");
		expect(message).toContain("kill -9");
	});
});

describe("several live processes for one session (HIGH 9)", () => {
	const OTHER: LiveSession = { pid: 31337, cwd: CWD, startedAt: 1_700_000_100_000 };

	it("refuses without --stop and names every pid", () => {
		const refusal = refuseWith({ live: [LIVE, OTHER] });
		expect(refusal.message).toContain(String(LIVE.pid));
		expect(refusal.message).toContain(String(OTHER.pid));
		expect(refusal.message).toContain("2 processes");
	});

	it("with --stop, stops every one, then checks nothing survived", async () => {
		const plan = planOf({ stop: true, live: [LIVE, OTHER] });
		const run = fakeTarget(plan);
		const result = await executeWarp(plan, run.deps);
		expect(result.failure).toBeUndefined();
		expect(run.stops).toEqual([LIVE.pid, OTHER.pid]);
		expect(result.stopped).toEqual([LIVE.pid, OTHER.pid]);
	});

	it("treats a survivor as a hard error, before the marker", async () => {
		const plan = planOf({ stop: true, live: [LIVE, OTHER] });
		const run = fakeTarget(plan, { stillLive: [OTHER] });
		const result = await executeWarp(plan, run.deps);
		expect(result.failure?.detail).toContain(`pid ${OTHER.pid}`);
		expect(run.markers).toEqual([]);
		expect(run.copies).toEqual([]);
	});

	for (const outcome of ["survived", "mismatch", "unauthorized", null] as const) {
		it(`treats a stop outcome of ${outcome} as a hard error, with nothing copied`, async () => {
			const plan = planOf({ stop: true, live: [LIVE] });
			const run = fakeTarget(plan, { stopOutcome: outcome });
			const result = await executeWarp(plan, run.deps);
			expect(result.failure?.step.summary).toContain("stop session");
			expect(run.copies).toEqual([]);
			expect(run.markers).toEqual([]);
		});
	}
});

describe("Herdr resume (HIGH 4)", () => {
	it("passes only the agent's ARGUMENTS after --, never the binary name", async () => {
		const plan = planOf({ remoteControl: true });
		const run = fakeTarget(plan);
		await executeWarp(plan, run.deps);
		const start = run.herdr.at(-1) as string[];
		expect(start).toEqual([
			"--machine",
			"netcup",
			"agent",
			"start",
			plan.agentName,
			"--kind",
			"claude",
			"--pane",
			"w1:p1",
			"--",
			"--resume",
			SESSION,
			REMOTE_CONTROL_FLAG,
		]);
		expect(start.slice(start.indexOf("--") + 1)).not.toContain("claude");
	});

	it("creates the tab without stealing focus, at the cwd", async () => {
		const plan = planOf();
		const run = fakeTarget(plan);
		await executeWarp(plan, run.deps);
		const create = run.herdr.find((argv) => argv.includes("tab")) as string[];
		expect(create).toEqual([
			"--machine",
			"netcup",
			"tab",
			"create",
			"--cwd",
			CWD,
			"--label",
			plan.agentName,
			"--no-focus",
		]);
	});

	it("fails clearly, and starts no agent, when the tab JSON has no pane id", async () => {
		for (const json of ["{}", '{"result":{"root_pane":"w1:p1"}}', "pane_id: w1:p2", ""]) {
			const plan = planOf();
			const run = fakeTarget(plan, { tabJson: json });
			const result = await executeWarp(plan, run.deps);
			expect(result.failure?.detail, json).toContain(".result.root_pane.pane_id");
			expect(
				run.herdr.some((argv) => argv.includes("agent")),
				json,
			).toBe(false);
		}
	});

	it("names the agent in lowercase, valid for Herdr, and differently on a repeat warp", () => {
		const upper = planOf({
			sessionId: SESSION.toUpperCase(),
			transcriptPath: `${FOLDER}/${SESSION.toUpperCase()}.jsonl`,
		});
		expect(upper.agentName).toMatch(/^[a-z][a-z0-9_-]*$/);
		expect(upper.agentName).toBe("warp-3d9c77a6-k1");
		expect(planOf({ agentSuffix: "k2" }).agentName).not.toBe(
			planOf({ agentSuffix: "k1" }).agentName,
		);
	});

	it("refuses an agent suffix Herdr would reject", () => {
		expect(refuseWith({ agentSuffix: "K!" }).message).toContain("agent name");
	});

	it("points at `herdr machine add` when the target has no Herdr server, before any change", async () => {
		const plan = planOf();
		const run = fakeTarget(plan, { probes: { herdr: 1 } });
		const result = await executeWarp(plan, run.deps);
		expect(result.failure?.detail).toContain("herdr machine add");
		expect(run.events.filter((event) => event.type === "change")).toEqual([]);
	});

	it("reads .result.root_pane.pane_id and nothing else", () => {
		expect(readPaneId(TAB_JSON)).toBe("w1:p1");
		expect(readPaneId('{"result":{"root_pane":"w1:p1"}}')).toBeUndefined();
		expect(readPaneId("pane_id: w1:p2")).toBeUndefined();
		expect(readPaneId("{}")).toBeUndefined();
	});

	it("keeps the remote-control flag bare and last, and absent unless asked", () => {
		expect(resumeAgentArgs(SESSION, true)).toEqual(["--resume", SESSION, "--remote-control"]);
		expect(resumeAgentArgs(SESSION, false)).toEqual(["--resume", SESSION]);
	});

	it("the dry-run line shows the pane placeholder, not a guessed id", () => {
		const lines = describeWarp(planOf()).lines.join("\n");
		expect(lines).toContain(`--pane ${PANE_PLACEHOLDER} -- --resume ${SESSION}`);
	});
});

describe("unusual ssh targets", () => {
	for (const host of ["fe80::1", "me@::1", "[::1]", "me@[::1]"]) {
		it(`refuses the IPv6 literal ${host} clearly`, () => {
			const refusal = refuseWith({ target: { name: "netcup", host, home: HOME } });
			expect(refusal.message).toContain("IPv6");
			expect(refusal.message).toContain("~/.ssh/config");
		});
	}

	it("puts the port in the ssh:// URL when the machine named one", () => {
		const plan = spacePlan({ target: { name: "netcup", host: "me@box", port: 2222, home: HOME } });
		const push = plan.steps.find((step) => step.kind === "push-branch") as Extract<
			WarpStep,
			{ kind: "push-branch" }
		>;
		expect(push.url).toBe(`ssh://me@box:2222${ROOT}/.git`);
	});
});

describe("refusals that need no machine", () => {
	it("exits 2 and names the pid when the session is live (AC-13)", () => {
		const refusal = refuseWith({ live: [LIVE] });
		expect(refusal.exit).toBe(2);
		expect(refusal.message).toContain("27145");
		expect(refusal.message).toContain("--stop");
	});

	it("plans the stop with the process cwd from the sessions file", () => {
		const plan = planOf({ stop: true, live: [LIVE] });
		const stop = plan.steps.find((step) => step.kind === "stop-session") as Extract<
			WarpStep,
			{ kind: "stop-session" }
		>;
		expect(stop.cwd).toBe(`${HOME}/work`);
	});

	it("refuses a cwd outside this machine's home", () => {
		expect(refuseWith({ cwd: "/tmp/scratch" }).message).toContain(
			"isn't inside this machine's home",
		);
	});

	it("refuses a cwd outside the target's home", () => {
		const refusal = refuseWith({ target: { name: "netcup", host: "me@box", home: "/home/other" } });
		expect(refusal.message).toContain("isn't inside netcup's home");
	});

	it("refuses a relative home, because the paths have to match", () => {
		expect(refuseWith({ target: { name: "netcup", host: "me@box", home: "~" } }).message).toContain(
			"absolute",
		);
	});

	it("refuses a session id that is not a UUID", () => {
		const refusal = refuseWith({ sessionId: "../../.ssh/authorized_keys" });
		expect(refusal.message).toContain("UUID");
	});

	it("refuses a branch git would not accept", () => {
		const refusal = refuseWith({
			cwd: `${HOME}/sp/r/worktrees/main`,
			cwdKind: "space-worktree",
			space: { root: `${HOME}/sp/r`, name: "r", barePath: `${HOME}/sp/r/.git`, branch: "--force" },
		});
		expect(refusal.message).toContain("branch");
	});

	it("refuses a space worktree with no space details rather than guessing", () => {
		expect(refuseWith({ cwdKind: "space-worktree", space: null }).message).toContain("worktree");
	});

	it("refuses a machine name with a space, or one a shell would read as an option", () => {
		expect(
			refuseWith({ target: { name: "net cup", host: "me@box", home: HOME } }).message,
		).toContain("machine name");
		expect(
			refuseWith({ target: { name: "-oProxyCommand=x", host: "me@box", home: HOME } }).exit,
		).toBe(2);
		expect(refuseWith({ selfName: "mac; rm -rf /" }).exit).toBe(2);
	});
});

describe("probe scripts survive a real shell", () => {
	it("never writes `test --`, which dash (the default /bin/sh) rejects", () => {
		const plan = spacePlan();
		for (const probe of plan.steps.filter((step) => step.kind === "probe")) {
			const script = (probe as { argv: string[] }).argv.join(" ");
			expect(script, probe.summary).not.toMatch(/test -[dw] --/);
		}
	});

	it("the parent probe hands the real parent to `test`", () => {
		const script = probeOf(spacePlan(), "space-parent")?.argv[2] as string;
		const words = testWords(script);
		expect(words).toHaveLength(2);
		for (const word of words) expect(argvAfterShell(word)).toEqual([`${ROOT}/worktrees`]);
	});

	it("the nearest-writable probe finds the nearest existing ancestor and exits by its writability", () => {
		const dir = mkdtempSync(join(tmpdir(), "warp-ancestor-"));
		try {
			const plan = spacePlan();
			const argv = probeOf(plan, "space-ancestor")?.argv as string[];
			const script = (argv[2] as string).replace(ROOT, `${dir}/a/b/c`);
			expect(spawnSync("/bin/sh", ["-c", script]).status).toBe(0);
			spawnSync("chmod", ["0500", dir]);
			const refused = spawnSync("/bin/sh", ["-c", script], { encoding: "utf-8" });
			expect(refused.status).toBe(67);
			expect(refused.stdout.trim()).toBe(dir);
		} finally {
			spawnSync("chmod", ["0700", dir]);
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("the worktree-state probe answers through a real shell and git", () => {
		const dir = mkdtempSync(join(tmpdir(), "warp-wtstate-"));
		const git = isolatedGit(dir, dir);
		try {
			git("init", "-q", "--bare", "bare.git");
			git("init", "-q", "src");
			git(
				"-C",
				"src",
				"-c",
				"user.email=t@e",
				"-c",
				"user.name=t",
				"commit",
				"-q",
				"--allow-empty",
				"-m",
				"a",
			);
			git("-C", "src", "push", "-q", `${dir}/bare.git`, "HEAD:refs/heads/b");
			const wt = spawnSync("realpath", [dir], { encoding: "utf-8" }).stdout.trim();
			git("--git-dir=bare.git", "worktree", "add", "-q", "--no-checkout", `${wt}/wt`, "b");
			const state = (path: string, branch: string) => {
				const planned = spacePlan({
					selfHome: wt,
					target: { name: "netcup", host: "me@box", home: wt },
					transcriptPath: `${wt}/.claude/projects/x/${SESSION}.jsonl`,
					cwd: path,
					space: { root: wt, name: "x", barePath: `${wt}/bare.git`, branch },
				});
				const argv = probeOf(planned, "worktree")?.argv as string[];
				return spawnSync(argv[0] as string, argv.slice(1)).status;
			};
			expect(state(`${wt}/wt`, "b")).toBe(TARGET_WORKTREE_STATE.registeredHere);
			expect(state(`${wt}/wt`, "c")).toBe(TARGET_WORKTREE_STATE.otherBranchHere);
			expect(state(`${wt}/elsewhere`, "b")).toBe(TARGET_WORKTREE_STATE.branchElsewhere);
			expect(state(`${wt}/elsewhere`, "c")).toBe(TARGET_WORKTREE_STATE.absent);
			expect(state(`${wt}/src`, "c")).toBe(TARGET_WORKTREE_STATE.occupied);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("--dry-run", () => {
	it("prints every probe (with its condition), every copy with its exclusions, the clone and the push url", () => {
		const plan = spacePlan({ remoteControl: true, excludes: ["node_modules", ".turbo"] });
		const text = describeWarp(plan).lines.join("\n");
		expect(text).toContain("only if the space is missing on netcup");
		expect(text).toContain("only if the space is already on netcup");
		expect(text).toContain("command -v hyper");
		expect(text).toContain(`hyper space clone --yes -- research ${ROOT}`);
		expect(text).toContain("--exclude=/.git --exclude=node_modules --exclude=.turbo");
		expect(text).toContain(`ssh://me@box${ROOT}/.git`);
		expect(text).toContain("push --dry-run");
		expect(text).toContain("--remote-control");
	});

	it("runs nothing: describing a plan calls no dependency", () => {
		const plan = spacePlan({ stop: true, live: [LIVE] });
		const described = describeWarp(plan);
		expect(described.lines).toHaveLength(plan.steps.length);
		expect(described.notes.length).toBeGreaterThan(0);
	});

	it("shows a copy with its exclusions and without --delete", () => {
		const workdir = planOf({ excludes: ["node_modules"] })
			.steps.filter((step) => step.kind === "copy")
			.at(-1) as WarpStep;
		const text = describeStep(workdir);
		expect(text).toContain("--exclude=node_modules");
		expect(text).not.toContain("--delete");
	});
});

describe("a config-sync session replaces the transcript copy", () => {
	it("flushes instead of copying the transcript, but still copies the workdir", () => {
		const plan = planOf({ syncSession: "hyper-claude-netcup" });
		expect(plan.steps.some((step) => step.kind === "flush-sync")).toBe(true);
		const copies = plan.steps.filter((step) => step.kind === "copy");
		expect(copies.map((copy) => copy.src)).toEqual([CWD]);
		expect(probeOf(plan, "transcript-folder")).toBeUndefined();
	});
});

describe("spaceBarePath", () => {
	it("maps bare and multi layouts to their project repo", () => {
		expect(spaceBarePath("/sp/research", "code/api/worktrees/feat")).toBe(
			"/sp/research/code/api/.git",
		);
		expect(spaceBarePath("/sp/research", "worktrees/main")).toBe("/sp/research/.git");
		expect(spaceBarePath("/sp/research", "notes")).toBeNull();
	});
});

describe("a detached HEAD in a space worktree", () => {
	it("gets its own message, not 'couldn't work out which space'", () => {
		// Real warp cwds are realpaths; tmpdir() on macOS is behind a /var symlink.
		const dir = realpathSync(mkdtempSync(join(tmpdir(), "warp-detached-")));
		const git = isolatedGit(dir, dir);
		try {
			git("init", "-q", "--bare", "space/.git");
			spawnSync("mkdir", ["-p", join(dir, "space/worktrees")]);
			git("--git-dir=space/.git", "worktree", "add", "-q", "space/worktrees/main", "-b", "main");
			const wt = join(dir, "space/worktrees/main");
			git("-C", wt, "commit", "-q", "--allow-empty", "-m", "a");
			expect(describeSpace(wt)?.branch).toBe("main");
			git("-C", wt, "checkout", "-q", "--detach");
			expect(() => describeSpace(wt)).toThrow(/detached HEAD/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
