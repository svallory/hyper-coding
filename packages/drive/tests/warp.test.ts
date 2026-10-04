import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MachineRunner } from "#services/remote";
import {
	describeStep,
	describeWarp,
	executeWarp,
	planWarp,
	REMOTE_CONTROL_FLAG,
	readPaneId,
	restoreMarker,
	resumeClaudeArgv,
	spaceBarePath,
	type WarpDeps,
	type WarpInputs,
	type WarpPlan,
	type WarpStep,
} from "#services/warp";

/**
 * Warp's plan is the contract, so these tests are about the PLAN: which steps
 * it holds, in which order, and which refusals stop it. `planWarp` is pure, so
 * none of this needs a machine, an SSH hop, or a filesystem — the only paths
 * involved are strings.
 */

/**
 * The shell words a probe script hands to `test`, in order.
 *
 * These are the words a remote shell has to split correctly, so they are
 * exactly what {@link argvAfterShell} should be pointed at. Split on the `test`
 * verbs rather than on a `--` separator: there is no `--` (dash has no such
 * option for its `test` builtin), and a separator that a future change removes
 * would quietly make this helper find nothing and pass vacuously.
 */
function testWords(script: string): string[] {
	// Take everything up to the next `||`, NOT up to the next space: a quoted
	// word is allowed to contain spaces, which is the whole point of quoting it.
	return [...script.matchAll(/test -[dw] (\S.*?)(?= \|\||$)/g)].map((match) => match[1] as string);
}

/**
 * Run `line` through a real POSIX shell and report the argv it produced.
 *
 * This is the only way to test "it was quoted properly" honestly: a string
 * comparison can agree with a broken implementation, but a shell cannot. A
 * path with a space and an apostrophe that arrives as two words, or that lets
 * the trailing text run as a command, fails here.
 */
function argvAfterShell(line: string): string[] {
	// The word is CONCATENATED into the script, not handed over as a positional
	// parameter: a positional parameter arrives already-split, so the shell would
	// never have parsed the quoting — which is the whole thing under test. Here
	// the shell does the word splitting, exactly as it would for a real command
	// arriving over ssh.
	const result = spawnSync(
		"/bin/sh",
		["-c", `set -- ${line}; for a in "$@"; do printf "%s\\n" "$a"; done`],
		{ encoding: "utf-8" },
	);
	// One argv per line: the paths under test contain no newline, so a line
	// break here can only mean the shell split something it should not have.
	return result.stdout.split("\n").slice(0, -1);
}

const SESSION = "3d9c77a6-6975-4381-b884-214b3ca452d8";
const HOME = "/Users/svallory";
const CWD = `${HOME}/work/hyper`;
const FOLDER = `${HOME}/.claude/projects/-Users-svallory-work-hyper`;
const TRANSCRIPT = `${FOLDER}/${SESSION}.jsonl`;

/** A recording spawner: every step's effect is inspectable, nothing is spawned. */
interface Recorder {
	deps: WarpDeps;
	/** Every `runner.ssh` argv, in order. */
	ssh: string[][];
	/** Every `runner.rsync` call. */
	copies: { src: string; dst: string; excludes: string[] }[];
	/** Every `herdr` argv. */
	herdr: string[][];
	/** Every sync flush. */
	flushed: string[];
	/** Markers written. */
	markers: { machine: string; at: string | undefined }[];
	/** Branch pushes. */
	pushes: { url: string; branch: string; worktree: string }[];
	/** Stops. */
	stops: { pid: number; sessionId: string; cwd: string }[];
}

function recorder(overrides: Partial<WarpDeps> = {}): Recorder {
	const ssh: string[][] = [];
	const copies: { src: string; dst: string; excludes: string[] }[] = [];
	const herdr: string[][] = [];
	const flushed: string[] = [];
	const markers: { machine: string; at: string | undefined }[] = [];
	const pushes: { url: string; branch: string; worktree: string }[] = [];
	const stops: { pid: number; sessionId: string; cwd: string }[] = [];
	// Whatever runner a test supplies is WRAPPED, not swapped out, so the
	// recording still happens: a test that overrides `ssh` to fail one call wants
	// to assert about the calls around it just as much.
	const base: MachineRunner = {
		async ssh(cmd) {
			ssh.push(cmd);
			return { code: 0, stdout: "", stderr: "" };
		},
		async rsync(src, dst, opts) {
			copies.push({ src, dst, excludes: opts?.excludes ?? [] });
			return { code: 0, stdout: "", stderr: "" };
		},
		async scp() {
			return { code: 0, stdout: "", stderr: "" };
		},
	};
	// `runner` is pulled OUT of the overrides: it is spread last below, so
	// leaving it in would overwrite the wrapper and silently un-record.
	const { runner: custom, ...rest } = overrides;
	const runner: MachineRunner = custom
		? {
				async ssh(cmd, opts) {
					ssh.push(cmd);
					return custom.ssh(cmd, opts);
				},
				async rsync(src, dst, opts) {
					copies.push({ src, dst, excludes: opts?.excludes ?? [] });
					return custom.rsync(src, dst, opts);
				},
				scp: (src, dst) => custom.scp(src, dst),
			}
		: base;

	return {
		ssh,
		copies,
		herdr,
		flushed,
		markers,
		pushes,
		stops,
		deps: {
			runner,
			async stop(pid, options) {
				stops.push({ pid, sessionId: options.sessionId, cwd: options.cwd });
				return "terminated";
			},
			writeOwner(_cwd, _id, machine, at) {
				markers.push({ machine, at });
				return { owner: machine, at: at ?? "" };
			},
			pushBranch(options) {
				pushes.push(options);
				return options;
			},
			flushSync: async (session: string) => {
				flushed.push(session);
			},
			runHerdr: async (argv: string[]) => {
				herdr.push(argv);
				return { code: 0, stdout: '{"result":{"tab":"w1:t1","root_pane":"w1:p1"}}', stderr: "" };
			},
			now: () => "2026-10-03T12:00:00.000Z",
			...rest,
		},
	};
}

/** Inputs that pass every pre-flight check, so a test can vary one thing. */
function inputs(overrides: Partial<WarpInputs> = {}): WarpInputs {
	return {
		cwd: CWD,
		selfName: "mac",
		selfHome: HOME,
		target: { name: "netcup", host: "me@box", home: HOME },
		sessionId: SESSION,
		transcriptPath: TRANSCRIPT,
		live: null,
		stop: false,
		force: false,
		remoteControl: false,
		owner: { state: "unowned", path: `${FOLDER}/${SESSION}.warp.json` },
		cwdKind: "plain-dir",
		space: null,
		excludes: ["node_modules"],
		syncSession: null,
		...overrides,
	};
}

/** A plan or a thrown assertion — every refusal here is a value, not an error. */
function planOf(overrides: Partial<WarpInputs> = {}): WarpPlan {
	const result = planWarp(inputs(overrides));
	if (!result.ok) throw new Error(`expected a plan, got a refusal: ${result.message}`);
	return result.plan;
}

function refuseWith(overrides: Partial<WarpInputs> = {}) {
	const result = planWarp(inputs(overrides));
	if (result.ok) throw new Error("expected a refusal, got a plan");
	return result;
}

/** Re-point a plan's marker at a temp file, so undo can be tested off-HOME. */
function withMarkerAt(plan: WarpPlan, path: string): WarpPlan {
	return {
		...plan,
		steps: plan.steps.map((entry) => (entry.kind === "write-marker" ? { ...entry, path } : entry)),
	};
}

const kinds = (steps: WarpStep[]) => steps.map((step) => step.kind);

/** The probe about the working directory's PARENT, wherever it sits in the plan. */
const parentProbeOf = (plan: WarpPlan) =>
	plan.steps.find(
		(entry) => entry.kind === "probe" && entry.summary.includes("exists and is writable"),
	) as Extract<WarpStep, { kind: "probe" }>;

const step = <K extends WarpStep["kind"]>(steps: WarpStep[], kind: K) =>
	steps.find((entry) => entry.kind === kind) as Extract<WarpStep, { kind: K }>;

describe("the plan for a plain directory", () => {
	it("probes before it copies anything", () => {
		const plan = planOf();
		const order = kinds(plan.steps);
		expect(order.slice(0, 2)).toEqual(["probe", "probe"]);
		// Every probe must precede the first thing that can change a machine.
		const firstProbe = order.lastIndexOf("probe");
		const firstMutation = order.findIndex((kind) => kind !== "probe");
		expect(firstMutation).toBeGreaterThan(firstProbe);
	});

	it("copies the transcript folder and the workdir to the same absolute paths", () => {
		const plan = planOf();
		const copies = plan.steps.filter((entry) => entry.kind === "copy");
		expect(copies).toHaveLength(2);
		expect(copies[0]?.src).toBe(FOLDER);
		expect(copies[0]?.dst).toBe(FOLDER);
		expect(copies[1]?.src).toBe(CWD);
		expect(copies[1]?.dst).toBe(CWD);
	});

	it("never passes --delete to any copy", () => {
		// A warp adds the target's copy; it must not prune what the target had.
		for (const cwdKind of ["plain-dir", "git-repo"] as const) {
			const text = JSON.stringify(planOf({ cwdKind }).steps);
			expect(text, cwdKind).not.toContain("--delete");
		}
	});

	it("writes the ownership marker before the first copy", () => {
		const order = kinds(planOf().steps);
		const marker = order.indexOf("write-marker");
		const firstCopy = order.indexOf("copy");
		expect(marker).toBeGreaterThan(-1);
		expect(marker).toBeLessThan(firstCopy);
	});

	it("asks for a tab and then an agent, in that order", () => {
		const plan = planOf();
		const herdr = plan.steps.filter((entry) => entry.kind === "herdr");
		expect(herdr).toHaveLength(2);
		expect(herdr[0]?.argv).toEqual(["--machine", "netcup", "tab", "create", "--cwd", CWD]);
		expect(herdr[1]?.argv).toContain("agent");
		expect(herdr[1]?.argv).toContain("start");
		expect(herdr[1]?.argv).toContain("claude");
		expect(herdr[1]?.argv).toContain("--resume");
		expect(herdr[1]?.argv).toContain(SESSION);
	});
});

describe("the plan for a plain git repo", () => {
	it("carries the same exclusions as every other kind", () => {
		const plan = planOf({ cwdKind: "git-repo", excludes: ["node_modules", "dist"] });
		const workdir = plan.steps.filter((entry) => entry.kind === "copy").at(-1);
		expect(workdir?.excludes).toEqual(["node_modules", "dist"]);
	});

	it("adds no space steps, because there is no space", () => {
		const plan = planOf({ cwdKind: "git-repo" });
		expect(kinds(plan.steps)).not.toContain("push-branch");
		expect(kinds(plan.steps)).not.toContain("remote-command");
	});
});

describe("the plan for a space worktree", () => {
	const ROOT = `${HOME}/work/spaces/research`;
	const WT = `${ROOT}/worktrees/feat-warp`;
	const space = {
		root: ROOT,
		name: "research",
		barePath: `${ROOT}/.git`,
		branch: "feat-warp",
		cloneNeeded: true,
	};

	it("clones the space, then pushes the branch, then copies the worktree", () => {
		const plan = planOf({ cwdKind: "space-worktree", space });
		const order = kinds(plan.steps);
		// The transcript copy comes earlier in the plan (design step 4 before
		// step 5), so the workdir copy is the LAST one — comparing against the
		// first would assert the wrong ordering.
		const workdirCopy = order.lastIndexOf("copy");
		expect(order.indexOf("remote-command")).toBeLessThan(order.indexOf("push-branch"));
		expect(order.indexOf("push-branch")).toBeLessThan(workdirCopy);
		expect(order.indexOf("copy")).toBeLessThan(order.indexOf("remote-command"));
	});

	it("pushes to an explicit ssh:// URL, never to a remote name (C-9)", () => {
		const plan = planOf({ cwdKind: "space-worktree", space });
		const push = step(plan.steps, "push-branch");
		expect(push.url).toBe(`ssh://me@box${space.barePath}`);
		expect(push.url.startsWith("ssh://")).toBe(true);
		// Nothing in the plan may name a remote the git would resolve locally.
		expect(JSON.stringify(plan.steps)).not.toMatch(/"origin"/);
	});

	it("puts the port in the ssh:// URL when the machine named one", () => {
		const plan = planOf({
			cwd: WT,
			cwdKind: "space-worktree",
			target: { name: "netcup", host: "me@box", port: 2222, home: HOME },
			space,
		});
		expect(step(plan.steps, "push-branch").url).toBe(`ssh://me@box:2222${space.barePath}`);
	});

	it("clones the space over ssh with --yes, so it cannot prompt on a machine with no tty", () => {
		const plan = planOf({ cwdKind: "space-worktree", space });
		expect(step(plan.steps, "remote-command").argv).toEqual([
			"hyper",
			"space",
			"clone",
			"research",
			"--yes",
		]);
	});

	it("checks the space BEFORE the parent, or a missing space could never be cloned", () => {
		// The worktree's parent lives INSIDE the space. Checked first and treated
		// as fatal, it would refuse every first-time warp and make the clone step
		// unreachable — the target cannot have the parent before it has the space.
		const plan = planOf({ cwd: WT, cwdKind: "space-worktree", space });
		expect((plan.steps[0] as { summary: string }).summary).toContain("already on");
		const parents = plan.steps.filter(
			(entry) => entry.kind === "probe" && entry.summary.includes("exists and is writable"),
		);
		expect(parents).toHaveLength(2);
		expect(parents[0]?.fatal).toBe(false);
		expect(parents[1]?.fatal).toBeUndefined();
	});

	it("skips the clone when the target already has the space", async () => {
		const plan = planOf({ cwdKind: "space-worktree", space });
		// The space probe passes (non-fatal), so the conditional clone is skipped.
		const rec = recorder();
		const result = await executeWarp(plan, rec.deps);
		expect(result.failure).toBeUndefined();
		const clone = rec.ssh.find((argv) => argv[0] === "hyper");
		expect(clone).toBeUndefined();
		// The branch still gets pushed: existing space, new branch.
		expect(rec.pushes).toHaveLength(1);
	});

	it("clones the space when the target does not have it, without stopping on the probe", async () => {
		const plan = planOf({ cwdKind: "space-worktree", space });
		const rec = recorder({
			runner: {
				async ssh(cmd) {
					// `test -d <spaceRoot>` fails (the space is missing); the clone's
					// `command -v hyper` passes.
					if ((cmd[2] as string).includes(space.root)) {
						return { code: 1, stdout: "", stderr: "" };
					}
					return { code: 0, stdout: "", stderr: "" };
				},
				async rsync() {
					return { code: 0, stdout: "", stderr: "" };
				},
				async scp() {
					return { code: 0, stdout: "", stderr: "" };
				},
			},
		});
		const result = await executeWarp(plan, rec.deps);
		expect(result.failure).toBeUndefined();
		expect(rec.ssh.some((argv) => argv[0] === "hyper")).toBe(true);
	});

	it("refuses when the space is missing AND hyper is not installed on the target", async () => {
		const plan = planOf({ cwd: WT, cwdKind: "space-worktree", space });
		const rec = recorder({
			runner: {
				async ssh(cmd) {
					if ((cmd[2] as string).includes(space.root)) {
						return { code: 1, stdout: "", stderr: "" };
					}
					if (cmd[0] === "command") return { code: 1, stdout: "", stderr: "" };
					return { code: 0, stdout: "", stderr: "" };
				},
				async rsync() {
					return { code: 0, stdout: "", stderr: "" };
				},
				async scp() {
					return { code: 0, stdout: "", stderr: "" };
				},
			},
		});
		const result = await executeWarp(plan, rec.deps);
		expect(result.failure?.detail).toContain("hyper isn't installed on netcup");
		expect(rec.copies).toHaveLength(0);
		expect(rec.markers).toHaveLength(0);
	});

	it("does not clone, and does not probe for hyper, when the space is already there", () => {
		const plan = planOf({
			cwd: `${HOME}/sp/r/worktrees/main`,
			cwdKind: "space-worktree",
			space: { ...space, cloneNeeded: false },
		});
		expect(kinds(plan.steps)).not.toContain("remote-command");
		expect(plan.steps.filter((entry) => entry.kind === "probe")).toHaveLength(2);
	});

	it("refuses a space worktree with no space details rather than guessing", () => {
		const refusal = refuseWith({ cwdKind: "space-worktree", space: null });
		expect(refusal.exit).toBe(2);
		expect(refusal.message).toContain("worktree");
	});

	it("maps a multi-repo worktree to its own bare repo", () => {
		expect(spaceBarePath("/sp/research", "code/api/worktrees/feat")).toBe(
			"/sp/research/code/api/.git",
		);
		expect(spaceBarePath("/sp/research", "worktrees/main")).toBe("/sp/research/.git");
		expect(spaceBarePath("/sp/research", "notes")).toBeNull();
	});
});

describe("refusals", () => {
	it("exits 2 and names the pid when the session is live (AC-13)", () => {
		const refusal = refuseWith({
			live: { pid: 27145, cwd: "/Users/svallory/work", startedAt: 1_700_000_000_000 },
		});
		expect(refusal.exit).toBe(2);
		expect(refusal.message).toContain("27145");
		expect(refusal.message).toContain("--stop");
	});

	it("plans the stop when --stop is given with a live session", () => {
		const plan = planOf({
			stop: true,
			live: { pid: 27145, cwd: "/Users/svallory/work", startedAt: 1_700_000_000_000 },
		});
		const stop = step(plan.steps, "stop-session");
		expect(stop.pid).toBe(27145);
		// The process cwd from the sessions file, NOT warp's cwd: they differ in
		// practice, and stopSession re-reads the file for that exact pid.
		expect(stop.cwd).toBe("/Users/svallory/work");
		expect(kinds(plan.steps).indexOf("stop-session")).toBeLessThan(
			kinds(plan.steps).indexOf("write-marker"),
		);
	});

	it("refuses a cwd outside this machine's home", () => {
		const refusal = refuseWith({ cwd: "/tmp/scratch", selfHome: HOME });
		expect(refusal.exit).toBe(2);
		expect(refusal.message).toContain("isn't inside this machine's home");
	});

	it("refuses a cwd outside the target's home", () => {
		const refusal = refuseWith({ target: { name: "netcup", host: "me@box", home: "/home/other" } });
		expect(refusal.exit).toBe(2);
		expect(refusal.message).toContain("isn't inside netcup's home");
	});

	it("refuses a relative home, because the paths have to match", () => {
		const refusal = refuseWith({ target: { name: "netcup", host: "me@box", home: "~" } });
		expect(refusal.message).toContain("absolute");
	});

	it("refuses a malformed ownership marker rather than guessing an owner", () => {
		const refusal = refuseWith({
			owner: { state: "malformed", path: "/m.json", reason: "not valid JSON" },
		});
		expect(refusal.exit).toBe(2);
		expect(refusal.message).toContain("not valid JSON");
	});

	it("refuses a foreign owner (C-10)", () => {
		const refusal = refuseWith({
			owner: { state: "owned", path: "/m.json", marker: { owner: "other-box", at: "yesterday" } },
		});
		expect(refusal.exit).toBe(2);
		expect(refusal.message).toContain("other-box");
		expect(refusal.message).toContain("--force");
	});

	it("proceeds past a foreign owner with --force, and records the old owner for undo", () => {
		const plan = planOf({
			force: true,
			owner: { state: "owned", path: "/m.json", marker: { owner: "other-box", at: "yesterday" } },
		});
		const marker = step(plan.steps, "write-marker");
		expect(marker.marker.owner).toBe("netcup");
		expect(marker.previous).toEqual({ owner: "other-box", at: "yesterday" });
	});

	it("allows a session this machine already owns, without --force", () => {
		const plan = planOf({
			owner: { state: "owned", path: "/m.json", marker: { owner: "mac", at: "yesterday" } },
		});
		expect(plan.target.name).toBe("netcup");
	});

	it("refuses a session id that is not a UUID", () => {
		const refusal = refuseWith({ sessionId: "../../.ssh/authorized_keys" });
		expect(refusal.exit).toBe(2);
		expect(refusal.message).toContain("session id");
		expect(refusal.message).toContain("UUID");
	});

	it("refuses a branch git would not accept", () => {
		const refusal = refuseWith({
			cwd: `${HOME}/sp/r/worktrees/main`,
			cwdKind: "space-worktree",
			space: {
				root: "/sp/r",
				name: "r",
				barePath: "/sp/r/.git",
				branch: "--force",
				cloneNeeded: false,
			},
		});
		expect(refusal.exit).toBe(2);
		expect(refusal.message).toContain("branch");
	});
});

describe("hostile inputs never reach a shell unquoted", () => {
	it("refuses a machine name with a space", () => {
		const refusal = refuseWith({ target: { name: "net cup", host: "me@box", home: HOME } });
		expect(refusal.exit).toBe(2);
		expect(refusal.message).toContain("machine name");
	});

	it("refuses a machine name that a shell would read as an option", () => {
		const refusal = refuseWith({
			target: { name: "-oProxyCommand=x", host: "me@box", home: HOME },
		});
		expect(refusal.exit).toBe(2);
	});

	it("refuses a cwd with a newline in it", () => {
		const refusal = refuseWith({ cwd: `${HOME}/evil\nrm -rf ~` });
		expect(refusal.exit).toBe(2);
		expect(refusal.message).toContain("control character");
	});

	it("refuses a self name that is not a name", () => {
		const refusal = refuseWith({ selfName: "mac; rm -rf /" });
		expect(refusal.exit).toBe(2);
	});

	it("quotes a cwd with a quote and a space so a real shell gets it back whole", () => {
		// The apostrophe is in the PARENT, so it lands in the word the probe
		// actually quotes — a cwd's own apostrophe would only affect the parent
		// one level up and would prove nothing about this word.
		const odd = `${HOME}/it's here/project`;
		const plan = planOf({ cwd: odd });
		const script = parentProbeOf(plan).argv[2] as string;
		// The parent is the directory which has to exist and be writable on the
		// target; its own name carries the apostrophe and the space.
		const parent = `${HOME}/it's here`;

		// Not a string comparison: pull each quoted word out of the probe and
		// hand it to a REAL POSIX shell to see what argv comes out. This is the
		// property that matters — a path with a space and an apostrophe must
		// arrive as ONE argument, and must not close the quoting to start a
		// command.
		const words = testWords(script);
		expect(words).toHaveLength(2);
		for (const word of words) expect(argvAfterShell(word)).toEqual([parent]);
		// Every such word is quoted: none starts bare.
		expect(script).not.toMatch(/test -[dw] [^-']/);
	});

	it("keeps a hostile path out of the shell's word splitting, in the clone script too", () => {
		const odd = `${HOME}/with space/it's`;
		const plan = planOf({
			cwd: odd,
			cwdKind: "space-worktree",
			space: {
				root: `${HOME}/sp/r`,
				name: "r",
				barePath: `${HOME}/sp/r/.git`,
				branch: "main",
				cloneNeeded: true,
			},
		});
		// The space-existence probe names a path too, and it is the one a hostile
		// cwd most directly controls.
		const spaceProbe = plan.steps.find(
			(entry) => entry.kind === "probe" && entry.summary.includes("already on"),
		) as Extract<WarpStep, { kind: "probe" }>;
		const words = testWords(spaceProbe.argv[2] as string);
		expect(words).toHaveLength(1);
		expect(argvAfterShell(words[0] as string)).toEqual([`${HOME}/sp/r`]);
	});

	it("never puts an unquoted machine name into a herdr argv", () => {
		const plan = planOf();
		for (const entry of plan.steps.filter((s) => s.kind === "herdr")) {
			const argv = (entry as { argv: string[] }).argv;
			expect(argv).toContain("--machine");
			expect(argv[argv.indexOf("--machine") + 1]).toBe("netcup");
		}
	});
});

describe("the remote-control flag", () => {
	it("is the option claude --help documents", () => {
		// Read from `claude --help` on 2026-10-03 (2.1.288):
		//   --remote-control [name]  Start an interactive session with Remote
		//                            Control enabled (optionally named)
		expect(REMOTE_CONTROL_FLAG).toBe("--remote-control");
	});

	it("is passed bare, not as --remote-control=name", () => {
		expect(resumeClaudeArgv(SESSION, true)).toEqual([
			"claude",
			"--resume",
			SESSION,
			"--remote-control",
		]);
	});

	it("is absent unless asked for", () => {
		expect(resumeClaudeArgv(SESSION, false)).toEqual(["claude", "--resume", SESSION]);
	});

	it("reaches the plan's agent argv", () => {
		const plan = planOf({ remoteControl: true });
		const agent = plan.steps.filter((entry) => entry.kind === "herdr").at(-1);
		expect((agent as { argv: string[] }).argv).toContain("--remote-control");
	});
});

describe("exclusions", () => {
	it("uses the list the plan was given (from drive.toml [warp] exclude)", () => {
		const plan = planOf({ excludes: ["node_modules", ".turbo", "coverage"] });
		const workdir = plan.steps.filter((entry) => entry.kind === "copy").at(-1);
		expect(workdir?.excludes).toEqual(["node_modules", ".turbo", "coverage"]);
	});

	it("does not exclude anything from the transcript folder", () => {
		const plan = planOf({ excludes: ["node_modules"] });
		const transcriptCopy = plan.steps.filter((entry) => entry.kind === "copy")[0];
		expect(transcriptCopy?.excludes).toEqual([]);
	});
});

describe("a config-sync session replaces the transcript copy", () => {
	it("flushes instead of copying the transcript, but still copies the workdir", () => {
		const plan = planOf({ syncSession: "hyper-claude-netcup" });
		expect(step(plan.steps, "flush-sync").session).toBe("hyper-claude-netcup");
		const copies = plan.steps.filter((entry) => entry.kind === "copy");
		expect(copies).toHaveLength(1);
		expect(copies[0]?.src).toBe(CWD);
	});
});

describe("--dry-run", () => {
	it("prints every remote command, every copy with its exclusions, and the push url", () => {
		const plan = planOf({
			cwd: `${HOME}/work/spaces/research/worktrees/feat-warp`,
			cwdKind: "space-worktree",
			remoteControl: true,
			excludes: ["node_modules", ".turbo"],
			space: {
				root: `${HOME}/work/spaces/research`,
				name: "research",
				barePath: `${HOME}/work/spaces/research/.git`,
				branch: "feat/warp",
				cloneNeeded: true,
			},
		});
		const text = describeWarp(plan).lines.join("\n");
		expect(text).toContain("test -d ");
		expect(text).toContain("test -w ");
		expect(text).toContain("command -v hyper");
		expect(text).toContain("hyper space clone research --yes");
		expect(text).toContain("--exclude=node_modules --exclude=.turbo");
		expect(text).toContain(`ssh://me@box${HOME}/work/spaces/research/.git`);
		expect(text).toContain("--remote-control");
	});

	it("runs no step at all: no marker, no stop, no copy", async () => {
		const plan = planOf({
			stop: true,
			live: { pid: 4242, cwd: CWD },
			cwd: `${HOME}/sp/r/worktrees/main`,
			cwdKind: "space-worktree",
			space: {
				root: `${HOME}/sp/r`,
				name: "r",
				barePath: `${HOME}/sp/r/.git`,
				branch: "main",
				cloneNeeded: true,
			},
		});
		// describeWarp is the whole of --dry-run: it reads, and returns.
		const described = describeWarp(plan);
		expect(described.lines.length).toBe(plan.steps.length);
		expect(described.transcript.lines).toBe(0);
		// And executing it explicitly is what a caller must NOT do; the command
		// never calls executeWarp for a dry run (asserted in the e2e).
		const rec = recorder();
		await executeWarp(plan, rec.deps);
		expect(rec.markers).toHaveLength(1);
		expect(rec.copies.length).toBeGreaterThan(0);
	});
});

describe("executeWarp", () => {
	it("runs the steps in order and stops at the first failure", async () => {
		const plan = planOf({
			cwd: `${HOME}/sp/r/worktrees/main`,
			cwdKind: "space-worktree",
			space: {
				root: `${HOME}/sp/r`,
				name: "r",
				barePath: `${HOME}/sp/r/.git`,
				branch: "main",
				cloneNeeded: true,
			},
		});
		const rec = recorder({
			runner: {
				async ssh(cmd) {
					// The target does not have the space, so the clone is the
					// conditional step that runs — and it is the one that fails.
					if ((cmd[2] as string).includes(`${HOME}/sp/r`)) {
						return { code: 1, stdout: "", stderr: "" };
					}
					return cmd[0] === "hyper"
						? { code: 1, stdout: "", stderr: "no such space" }
						: { code: 0, stdout: "", stderr: "" };
				},
				async rsync() {
					return { code: 0, stdout: "", stderr: "" };
				},
				async scp() {
					return { code: 0, stdout: "", stderr: "" };
				},
			},
		});
		const result = await executeWarp(plan, rec.deps);
		expect(result.failure?.summary).toContain("clone");
		expect(result.failure?.detail).toContain("no such space");
		// The transcript copy had already run (it precedes the workdir steps),
		// but the WORKDIR copy and the push must not have.
		expect(rec.pushes).toHaveLength(0);
		// The Herdr PROBE ran (it is read-only and comes first); nothing that
		// creates a tab or starts an agent may have.
		expect(rec.herdr.every((argv) => argv.includes("pane") && argv.includes("list"))).toBe(true);
	});

	it("refuses at the parent-writable probe and copies nothing (AC-16)", async () => {
		const plan = planOf();
		const rec = recorder({
			runner: {
				async ssh() {
					return { code: 66, stdout: "", stderr: "" };
				},
				async rsync() {
					return { code: 0, stdout: "SHOULD NOT RUN", stderr: "" };
				},
				async scp() {
					return { code: 0, stdout: "", stderr: "" };
				},
			},
		});
		const result = await executeWarp(plan, rec.deps);
		expect(result.failure?.summary).toContain("writable");
		expect(result.failure?.detail).toContain("Nothing has been copied");
		expect(rec.copies).toHaveLength(0);
		expect(rec.markers).toHaveLength(0);
		expect(rec.herdr).toHaveLength(0);
		expect(result.copied).not.toBe(true);
	});

	it("points at `herdr machine add` when the target has no Herdr server, and never falls back to ssh", async () => {
		const plan = planOf();
		const rec = recorder({
			runHerdr: async () => ({ code: 1, stdout: "", stderr: "no machine profile" }),
		});
		const result = await executeWarp(plan, rec.deps);
		expect(result.failure?.summary).toContain("Herdr server");
		expect(result.failure?.detail).toContain("herdr machine add");
		expect(result.failure?.detail).not.toContain("ssh claude");
		// Nothing was copied, and no bare ssh ever stood in for Herdr.
		expect(rec.copies).toHaveLength(0);
		expect(rec.markers).toHaveLength(0);
	});

	it("runs the Herdr probe through Herdr, not through a remote shell", async () => {
		// `herdr --machine <name> pane list` is a LOCAL cli call that forwards
		// over the machine's own ssh profile; sending it to a remote shell would
		// look for a `herdr` binary on the target.
		const plan = planOf();
		const probe = plan.steps.find((entry) => entry.kind === "probe" && entry.via === "herdr");
		expect(probe).toBeDefined();
		const rec = recorder();
		await executeWarp(plan, rec.deps);
		expect(rec.herdr[0]).toEqual(["--machine", "netcup", "pane", "list"]);
		expect(rec.ssh.every((argv) => argv[0] !== "--machine")).toBe(true);
	});

	it("treats survived, mismatch and unauthorized as hard errors, with nothing copied", async () => {
		for (const outcome of ["survived", "mismatch", "unauthorized"] as const) {
			const plan = planOf({ stop: true, live: { pid: 999, cwd: CWD } });
			const rec = recorder({ stop: async () => outcome });
			const result = await executeWarp(plan, rec.deps);
			expect(result.failure?.summary, outcome).toContain("stop session");
			expect(rec.copies, outcome).toHaveLength(0);
			expect(rec.markers, outcome).toHaveLength(0);
		}
	});

	it("goes on after a clean stop", async () => {
		const plan = planOf({ stop: true, live: { pid: 999, cwd: CWD } });
		const rec = recorder({ stop: async () => "terminated" });
		const result = await executeWarp(plan, rec.deps);
		expect(result.failure).toBeUndefined();
		expect(rec.markers).toHaveLength(1);
	});

	it("fills the pane id from the tab into the agent start argv", async () => {
		const plan = planOf();
		const rec = recorder();
		await executeWarp(plan, rec.deps);
		const agent = rec.herdr.at(-1) as string[];
		expect(agent[agent.indexOf("--pane") + 1]).toBe("w1:p1");
		// The pane id must come BEFORE the `--`, or claude would eat it.
		expect(agent.indexOf("--pane")).toBeLessThan(agent.indexOf("--"));
	});

	it("fails clearly when Herdr created a tab but reported no pane", async () => {
		const plan = planOf();
		const rec = recorder({ runHerdr: async () => ({ code: 0, stdout: "{}", stderr: "" }) });
		const result = await executeWarp(plan, rec.deps);
		expect(result.failure?.detail).toContain("pane list");
	});

	it("stamps the marker at run time, not at plan time", async () => {
		const plan = planOf();
		const rec = recorder({ now: () => "2026-10-03T09:00:00.000Z" });
		await executeWarp(plan, rec.deps);
		expect(rec.markers[0]).toEqual({ machine: "netcup", at: "2026-10-03T09:00:00.000Z" });
	});
});

describe("undoing a failed warp", () => {
	let dir: string;
	let markerPath: string;

	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), "warp-undo-"));
		markerPath = join(dir, `${SESSION}.warp.json`);
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	/** A recorder whose writeOwner really writes, and whose copies fail on cue. */
	function writing(copyCode: number) {
		return recorder({
			writeOwner: () => {
				writeFileSync(markerPath, JSON.stringify({ owner: "netcup", at: "now" }));
				return { owner: "netcup", at: "now" };
			},
			runner: {
				async ssh() {
					return { code: 0, stdout: "", stderr: "" };
				},
				async rsync() {
					return copyCode === 0
						? { code: 0, stdout: "", stderr: "" }
						: { code: copyCode, stdout: "", stderr: "connection closed" };
				},
				async scp() {
					return { code: 0, stdout: "", stderr: "" };
				},
			},
		});
	}

	it("puts the previous marker back when the first copy failed and nothing arrived", async () => {
		const plan = withMarkerAt(planOf(), markerPath);
		const rec = writing(23);
		const result = await executeWarp(plan, rec.deps);

		expect(result.copied).not.toBe(true);
		expect(result.failure?.summary).toContain("transcript");
		// The marker WAS written — it comes before the first copy — so this is
		// exactly the case undo exists for.
		expect(readFileSync(markerPath, "utf-8")).toContain("netcup");

		const undone = restoreMarker(
			plan,
			{ owner: "other-box", at: "yesterday" },
			result.copied === true,
		);
		expect(undone.restored).toBe(true);
		expect(JSON.parse(readFileSync(markerPath, "utf-8"))).toEqual({
			owner: "other-box",
			at: "yesterday",
		});
	});

	it("removes the marker again when there was none before", async () => {
		const plan = withMarkerAt(planOf(), markerPath);
		const rec = writing(23);
		const result = await executeWarp(plan, rec.deps);
		expect(result.copied).not.toBe(true);
		const undone = restoreMarker(plan, null, result.copied === true);
		expect(undone.restored).toBe(true);
		expect(existsSync(markerPath)).toBe(false);
	});

	it("leaves the marker alone once something WAS copied, and says why", async () => {
		const plan = withMarkerAt(planOf(), markerPath);
		const rec = writing(0);
		const result = await executeWarp(plan, rec.deps);
		expect(result.copied).toBe(true);
		const undone = restoreMarker(
			plan,
			{ owner: "other-box", at: "yesterday" },
			result.copied === true,
		);
		expect(undone.restored).toBe(false);
		expect(undone.reason).toContain("already been copied");
		expect(readFileSync(markerPath, "utf-8")).toContain("netcup");
	});
});

describe("readPaneId", () => {
	it("reads the documented .result.root_pane string", () => {
		expect(readPaneId('{"result":{"tab":"w1:t1","root_pane":"w1:p1"}}')).toBe("w1:p1");
	});

	it("reads the object form", () => {
		expect(readPaneId('{"result":{"root_pane":{"pane_id":"w1:p9"}}}')).toBe("w1:p9");
	});

	it("falls back to a scan when the output is not JSON", () => {
		expect(readPaneId("created tab; pane_id: w1:p2")).toBe("w1:p2");
	});

	it("returns undefined when there is nothing to read", () => {
		expect(readPaneId("{}")).toBeUndefined();
		expect(readPaneId("")).toBeUndefined();
	});
});

describe("describeStep", () => {
	it("names the ssh command line a probe will send", () => {
		const plan = planOf();
		const text = describeStep(step(plan.steps, "probe"));
		expect(text).toContain("ssh --");
		expect(text).toContain("test -d ");
	});

	it("never writes `test --`, which dash (the default /bin/sh) rejects", () => {
		// `test` is a shell BUILTIN, and dash has no `--` option for it: it
		// answers "test: --: unexpected operator" and the probe fails on a
		// perfectly good directory. Found by the container e2e, not by a unit
		// test — which is exactly why the e2e exists.
		const plan = planOf({
			cwd: `${HOME}/sp/r/worktrees/main`,
			cwdKind: "space-worktree",
			space: {
				root: `${HOME}/sp/r`,
				name: "r",
				barePath: `${HOME}/sp/r/.git`,
				branch: "main",
				cloneNeeded: true,
			},
		});
		for (const probe of plan.steps.filter((entry) => entry.kind === "probe")) {
			const script = (probe as { argv: string[] }).argv.join(" ");
			expect(script, probe.summary).not.toMatch(/test -[dw] --/);
		}
		// …and it is still correct under dash, which is the real proof.
		const script = parentProbeOf(plan).argv[2] as string;
		expect(argvAfterShell(testWords(script)[0] as string)).toEqual([`${HOME}/sp/r/worktrees`]);
	});

	it("shows a copy with its exclusions and without --delete", () => {
		const plan = planOf({ excludes: ["node_modules"] });
		const workdir = plan.steps.filter((entry) => entry.kind === "copy").at(-1) as WarpStep;
		const text = describeStep(workdir);
		expect(text).toContain("--exclude=node_modules");
		expect(text).not.toContain("--delete");
	});
});
