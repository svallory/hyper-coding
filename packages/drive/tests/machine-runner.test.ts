/**
 * The machine-setup runner, driven with fake tasks and a scripted prompt.
 *
 * These tests are the reason the runner takes its `prompt` and its task list as
 * arguments: the real command talks to a TTY and to the machine, and neither is
 * available (or desirable) in a test. What is being pinned here is the flow —
 * what runs, in what order, what gets written, and above all the one rule that
 * the whole design exists for (C-6): hyper asks for a password only when the
 * user picks "run it for me".
 */

import { existsSync, mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "#config/index";
import type { MachineInfo } from "#services/machine";
import {
	ROOT_SCRIPT_NAME,
	type RootChoice,
	type RootQuestion,
	runSetup,
	type SetupPrompt,
} from "#services/machine/runner";
import {
	type Feature,
	type Task,
	type TaskContext,
	TaskError,
} from "#services/machine/tasks/types";
import {
	LocalMachine,
	type MachineRunner,
	type RunResult,
	type SpawnRequest,
} from "#services/remote";
import { withTempConfig } from "#tests/tmp-config";

const saved = process.env.HYPER_DRIVE_CONFIG;
afterEach(() => {
	if (saved === undefined) delete process.env.HYPER_DRIVE_CONFIG;
	else process.env.HYPER_DRIVE_CONFIG = saved;
});

/** A fresh directory for the root script; created by the runner, not by us. */
function scratch(): string {
	return mkdtempSync(join(tmpdir(), "drive-setup-"));
}

/**
 * A task whose check answers from a list, so a test can say "fails, then passes"
 * — which is what `apply` looks like from the runner's side.
 */
interface FakeTaskSpec {
	id: string;
	feature?: Feature;
	needsRoot?: boolean;
	title?: string;
	/** check() results in order; the last one repeats once exhausted. */
	checks?: boolean[];
	script?: string;
	applyMakesCheckPass?: boolean;
	throwInCheck?: boolean;
	throwInApply?: boolean;
	throwInRootScript?: boolean;
}

interface FakeTask extends Task {
	checks: number[];
	/** How many times check() was actually called — an assertion target. */
	checkCalls: number;
	applies: number;
	rootScriptCalls: number;
}

function fakeTask(spec: FakeTaskSpec): FakeTask {
	const checks = [...(spec.checks ?? [true])];
	const task: FakeTask = {
		id: spec.id,
		feature: spec.feature ?? "tools",
		needsRoot: spec.needsRoot ?? false,
		title: spec.title ?? spec.id,
		checks,
		checkCalls: 0,
		applies: 0,
		rootScriptCalls: 0,
		async check(): Promise<boolean> {
			task.checkCalls += 1;
			if (spec.throwInCheck === true) throw new Error("disk is on fire");
			return checks.length > 1 ? (checks.shift() as boolean) : (checks[0] ?? true);
		},
		apply: async () => {
			task.applies += 1;
			if (spec.throwInApply === true) throw new Error("install failed halfway");
			if (spec.applyMakesCheckPass !== false && checks[0] === false) checks[0] = true;
		},
		...(spec.needsRoot === true
			? {
					rootScript: () => {
						task.rootScriptCalls += 1;
						if (spec.throwInRootScript === true) throw new Error("can't read /etc/shadow");
						return spec.script ?? `echo "doing ${spec.id}"`;
					},
				}
			: {}),
	};
	return task;
}

/** A prompt that hands back a scripted sequence, and records what it was asked. */
function scriptedPrompt(answers: RootChoice[]): SetupPrompt & { asked: RootQuestion[] } {
	const asked: RootQuestion[] = [];
	let i = 0;
	return {
		asked,
		async rootChoice(question: RootQuestion): Promise<RootChoice> {
			asked.push(question);
			const answer = answers[Math.min(i, answers.length - 1)];
			i += 1;
			return answer;
		},
	};
}

/** A runner that records instead of running, and answers a $HOME probe. */
function fakeRunner(home = "/home/svallory"): MachineRunner & {
	sshCalls: { cmd: string[]; opts?: unknown }[];
	scpCalls: [string, string][];
} {
	const runner = {
		home,
		sshCalls: [] as { cmd: string[]; opts?: unknown }[],
		scpCalls: [] as [string, string][],
		async ssh(cmd: string[], opts?: unknown): Promise<RunResult> {
			runner.sshCalls.push({ cmd, opts });
			// The only command the runner probes with is `echo $HOME`.
			return { code: 0, stdout: `${home}\n`, stderr: "" };
		},
		async scp(src: string, dst: string): Promise<RunResult> {
			runner.scpCalls.push([src, dst]);
			return { code: 0, stdout: "", stderr: "" };
		},
		async rsync(): Promise<RunResult> {
			return { code: 0, stdout: "", stderr: "" };
		},
	};
	return runner as unknown as MachineRunner & {
		sshCalls: { cmd: string[]; opts?: unknown }[];
		scpCalls: [string, string][];
	};
}

const REMOTE: MachineInfo = {
	name: "netcup",
	host: "user@host",
	home: "",
	features: [],
	agentUser: "agent",
	source: "both",
	herdr: true,
};

function localCtx(runner: MachineRunner, logs: string[]): TaskContext {
	return { machine: null, runner, config: loadConfig(), log: (line) => logs.push(line) };
}

function remoteCtx(runner: MachineRunner, logs: string[]): TaskContext {
	return { machine: REMOTE, runner, config: loadConfig(), log: (line) => logs.push(line) };
}

const ALL_FEATURES: Feature[] = [
	"tools",
	"config-sync",
	"agent-user",
	"docker-rootless",
	"home-path",
];

describe("runSetup — nothing to do (C-15)", () => {
	it("with every check true: no apply, no root script, and the report says so", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const task = fakeTask({ id: "tools.claude" });
		const logs: string[] = [];
		const runner = fakeRunner();

		const report = await runSetup(localCtx(runner, logs), {
			features: ["tools"],
			tasks: [task],
			prompt: scriptedPrompt([]),
			scratchDir: scratch(),
		});

		expect(task.applies).toBe(0);
		expect(task.rootScriptCalls).toBe(0);
		expect(report.applied).toEqual([]);
		expect(report.skipped).toEqual([]);
		expect(report.alreadyOk).toEqual(["tools.claude"]);
		expect(report.rootScriptPath).toBeUndefined();
	});

	it("runs twice with no change the second time: the second run does nothing (C-15)", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		// check says false, then apply fixes it, then every later check is true.
		const task = fakeTask({ id: "tools.pi", checks: [false], applyMakesCheckPass: true });
		const opts = {
			features: ["tools"],
			tasks: [task],
			prompt: scriptedPrompt([]),
			scratchDir: scratch(),
		};
		const runner = fakeRunner();

		const first = await runSetup(localCtx(runner, []), opts);
		expect(first.applied).toEqual(["tools.pi"]);
		const second = await runSetup(localCtx(runner, []), opts);
		expect(second.applied).toEqual([]);
		expect(second.alreadyOk).toEqual(["tools.pi"]);
		expect(task.applies).toBe(1);
	});

	it("ignores tasks whose feature wasn't selected", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const docker = fakeTask({ id: "docker.install", feature: "docker-rootless", checks: [false] });
		await runSetup(localCtx(fakeRunner(), []), {
			features: ["tools"],
			tasks: [docker],
			prompt: scriptedPrompt([]),
			scratchDir: scratch(),
		});
		expect(docker.applies).toBe(0);
		expect(docker.checks).toHaveLength(1);
	});
});

describe("runSetup — tasks it can do itself", () => {
	it("applies a failing non-root task once, then finds it passing", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const task = fakeTask({ id: "tools.jq", checks: [false], applyMakesCheckPass: true });
		const logs: string[] = [];

		const report = await runSetup(localCtx(fakeRunner(), logs), {
			features: ["tools"],
			tasks: [task],
			prompt: scriptedPrompt([]),
			scratchDir: scratch(),
		});

		expect(task.applies).toBe(1);
		expect(report.applied).toEqual(["tools.jq"]);
		expect(report.rootScriptPath).toBeUndefined();
	});

	it("reports a task whose apply didn't take as skipped, not applied", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		// apply runs but check stays false: claiming it worked would be a lie.
		const task = fakeTask({ id: "tools.fzf", checks: [false], applyMakesCheckPass: false });
		const report = await runSetup(localCtx(fakeRunner(), []), {
			features: ["tools"],
			tasks: [task],
			prompt: scriptedPrompt([]),
			scratchDir: scratch(),
		});
		expect(task.applies).toBe(1);
		expect(report.applied).toEqual([]);
		expect(report.skipped).toEqual(["tools.fzf"]);
	});

	it("never calls apply on a task that needs root", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const task = fakeTask({ id: "agent-user.create", needsRoot: true, checks: [false] });
		await runSetup(localCtx(fakeRunner(), []), {
			features: ["tools"],
			tasks: [task],
			prompt: scriptedPrompt(["skip"]),
			scratchDir: scratch(),
		});
		expect(task.applies).toBe(0);
	});
});

describe("runSetup — the root script", () => {
	it("writes one script naming the machine, feature and task, and prints it (C-6)", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const dir = scratch();
		const task = fakeTask({
			id: "agent-user.create",
			feature: "agent-user",
			needsRoot: true,
			checks: [false],
			script: "useradd --system agent",
		});
		const logs: string[] = [];

		const report = await runSetup(remoteCtx(fakeRunner(), logs), {
			features: ["agent-user"],
			tasks: [task],
			prompt: scriptedPrompt(["skip"]),
			scratchDir: dir,
		});

		const path = join(dir, ROOT_SCRIPT_NAME);
		expect(report.rootScriptPath).toBe(path);
		expect(existsSync(path)).toBe(true);
		expect(statSync(path).mode & 0o777).toBe(0o700);

		const script = readFileSync(path, "utf-8");
		expect(script.startsWith("#!/usr/bin/env bash\nset -euo pipefail")).toBe(true);
		expect(script).toContain("netcup");
		expect(script).toContain("features: agent-user");
		expect(script).toContain("# --- agent-user.create ---");
		expect(script).toContain("useradd --system agent");

		// The user must see the whole thing before choosing anything.
		expect(logs.join("\n")).toContain("useradd --system agent");
		expect(logs.join("\n")).toContain(path);
	});

	it("collects every failing root task into that one script", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const dir = scratch();
		const one = fakeTask({
			id: "docker.packages",
			feature: "docker-rootless",
			needsRoot: true,
			checks: [false],
			script: "apt install uidmap",
		});
		const two = fakeTask({
			id: "home-path.create",
			feature: "home-path",
			needsRoot: true,
			checks: [false],
			script: "mkdir /Users/svallory",
		});
		const ok = fakeTask({ id: "tools.rg", checks: [true] });

		await runSetup(remoteCtx(fakeRunner(), []), {
			features: ALL_FEATURES,
			tasks: [one, two, ok],
			prompt: scriptedPrompt(["skip"]),
			scratchDir: dir,
		});

		const script = readFileSync(join(dir, ROOT_SCRIPT_NAME), "utf-8");
		expect(script).toContain("# --- docker.packages ---");
		expect(script).toContain("# --- home-path.create ---");
		expect(script).toContain("features: docker-rootless, home-path");
	});

	it("'ran' with the check still failing asks again; 'skip' then leaves it skipped", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const task = fakeTask({ id: "agent-user.create", needsRoot: true, checks: [false] });
		const prompt = scriptedPrompt(["ran", "skip"]);

		const report = await runSetup(remoteCtx(fakeRunner(), []), {
			features: ["tools"],
			tasks: [task],
			prompt,
			scratchDir: scratch(),
		});

		expect(prompt.asked).toHaveLength(2);
		expect(prompt.asked[0].tasks).toEqual(["agent-user.create"]);
		expect(report.skipped).toEqual(["agent-user.create"]);
		expect(report.applied).toEqual([]);
	});

	it("'ran' with the check now passing reports the task as applied and stops asking", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const task = fakeTask({ id: "agent-user.create", needsRoot: true, checks: [false] });
		const prompt = scriptedPrompt(["ran"]);
		// The user ran it: the next check sees the world fixed.
		const runner = fakeRunner();
		const original = task.check;
		let calls = 0;
		task.check = async () => {
			calls += 1;
			return calls > 1 ? true : original({} as TaskContext);
		};

		const report = await runSetup(remoteCtx(runner, []), {
			features: ["tools"],
			tasks: [task],
			prompt,
			scratchDir: scratch(),
		});

		expect(prompt.asked).toHaveLength(1);
		expect(report.applied).toEqual(["agent-user.create"]);
		expect(report.skipped).toEqual([]);
	});

	it("asks once, with only the still-failing task ids", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		// The labels and the default are asserted in machine-setup.test.ts, against
		// the exported option list. What the runner owns is what it asks and with
		// what: the question it hands the prompt has to name the machine and every
		// task still outstanding, so "run it for me" can't cover a task that
		// already passed.
		const task = fakeTask({ id: "agent-user.create", needsRoot: true, checks: [false] });
		const prompt = scriptedPrompt(["skip"]);
		await runSetup(remoteCtx(fakeRunner(), []), {
			features: ["tools"],
			tasks: [task],
			prompt,
			scratchDir: scratch(),
		});
		expect(prompt.asked[0]).toMatchObject({ machine: "netcup" });
		expect(prompt.asked[0].path.endsWith(ROOT_SCRIPT_NAME)).toBe(true);
	});

	it("prints the copy and run commands for a remote target", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const dir = scratch();
		const task = fakeTask({ id: "agent-user.create", needsRoot: true, checks: [false] });
		const logs: string[] = [];

		await runSetup(remoteCtx(fakeRunner(), logs), {
			features: ["tools"],
			tasks: [task],
			prompt: scriptedPrompt(["skip"]),
			scratchDir: dir,
		});

		// The script exists here, not there: "I've run it" is meaningless without
		// saying how to get it over first.
		const out = logs.join("\n");
		expect(out).toContain("mkdir -p ~/.hyper");
		expect(out).toContain(`scp ${join(dir, ROOT_SCRIPT_NAME)} user@host:`);
		expect(out).toContain("ssh -t user@host");
	});

	it("prints a single local command when the target is this machine", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const dir = scratch();
		const task = fakeTask({ id: "agent-user.create", needsRoot: true, checks: [false] });
		const logs: string[] = [];

		await runSetup(localCtx(fakeRunner(), logs), {
			features: ["tools"],
			tasks: [task],
			prompt: scriptedPrompt(["skip"]),
			scratchDir: dir,
		});

		const out = logs.join("\n");
		expect(out).toContain(`sudo bash ${join(dir, ROOT_SCRIPT_NAME)}`);
		expect(out).not.toContain("scp ");
	});

	it("prints a local recipe with a space in the path as one command", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const dir = mkdtempSync(join(tmpdir(), "drive setup ")); // the space is the point
		const task = fakeTask({ id: "agent-user.create", needsRoot: true, checks: [false] });
		const logs: string[] = [];

		await runSetup(localCtx(fakeRunner(), logs), {
			features: ["tools"],
			tasks: [task],
			prompt: scriptedPrompt(["skip"]),
			scratchDir: dir,
		});

		const out = logs.join("\n");
		// Unquoted, `sudo bash /tmp/drive setup …/hyper-machine-root.sh` runs the
		// first word as root and passes the second as $0. Every word is quoted.
		expect(out).toContain(`sudo bash '${join(dir, ROOT_SCRIPT_NAME)}'`);
		expect(out).not.toContain(`sudo bash ${join(dir, ROOT_SCRIPT_NAME)}`);
	});

	it("prints a remote recipe with a space in the path as one scp source", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const dir = mkdtempSync(join(tmpdir(), "drive setup "));
		const task = fakeTask({ id: "agent-user.create", needsRoot: true, checks: [false] });
		const logs: string[] = [];

		await runSetup(remoteCtx(fakeRunner(), logs), {
			features: ["tools"],
			tasks: [task],
			prompt: scriptedPrompt(["skip"]),
			scratchDir: dir,
		});

		const out = logs.join("\n");
		expect(out).toContain(`scp '${join(dir, ROOT_SCRIPT_NAME)}' user@host:`);
		// The remote half keeps its ~ unquoted: the whole line is single-quoted so
		// the remote shell expands it. Quoting it here would break that.
		expect(out).toContain("ssh -t user@host 'sudo bash ~/.hyper/hyper-machine-root.sh'");
	});

	it("an unattended skip leaves the root task in `skipped`, with the script written", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const dir = scratch();
		const task = fakeTask({ id: "agent-user.create", needsRoot: true, checks: [false] });
		// What the command's rootChoice does with no terminal.
		const unattended = scriptedPrompt(["skip"]);

		const report = await runSetup(localCtx(fakeRunner(), []), {
			features: ["tools"],
			tasks: [task],
			prompt: unattended,
			scratchDir: dir,
		});

		expect(report.skipped).toEqual(["agent-user.create"]);
		expect(report.rootScriptPath).toBe(join(dir, ROOT_SCRIPT_NAME));
		expect(existsSync(report.rootScriptPath as string)).toBe(true);
		// Nothing was run on the user's behalf.
		expect(unattended.asked).toHaveLength(1);
	});
});

describe("runSetup — 'run it for me' (C-6)", () => {
	it("remote: copies the script, then runs exactly one privileged command on a tty", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const dir = scratch();
		const task = fakeTask({ id: "agent-user.create", needsRoot: true, checks: [false] });
		const runner = fakeRunner("/home/svallory");
		let checks = 0;
		task.check = async () => {
			checks += 1;
			return checks > 1;
		};

		await runSetup(remoteCtx(runner, []), {
			features: ["tools"],
			tasks: [task],
			prompt: scriptedPrompt(["run-for-me"]),
			scratchDir: dir,
		});

		expect(runner.scpCalls).toHaveLength(1);
		expect(runner.scpCalls[0][0]).toBe(join(dir, ROOT_SCRIPT_NAME));

		const privileged = runner.sshCalls.filter((call) => call.cmd[0] === "sudo");
		expect(privileged).toHaveLength(1);
		expect(privileged[0].cmd).toEqual([
			"sudo",
			"bash",
			"/home/svallory/.hyper/hyper-machine-root.sh",
		]);
		// Without a tty sudo fails with "no tty present" instead of prompting.
		expect(privileged[0].opts).toEqual({ tty: true });
	});

	it("remote: a failed copy stops the run and never runs anything privileged", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const task = fakeTask({ id: "agent-user.create", needsRoot: true, checks: [false] });
		const runner = fakeRunner();
		// scp failed: the script is not on the other machine, so the privileged
		// command would fail with a confusing "No such file" instead of saying the
		// transfer broke.
		runner.scp = async () => ({ code: 255, stdout: "", stderr: "Permission denied" });

		await expect(
			runSetup(remoteCtx(runner, []), {
				features: ["tools"],
				tasks: [task],
				prompt: scriptedPrompt(["run-for-me"]),
				scratchDir: scratch(),
			}),
		).rejects.toThrow(/Permission denied/);

		expect(runner.sshCalls.some((call) => call.cmd[0] === "sudo")).toBe(false);
	});

	it("remote: an unanswerable $HOME probe fails with a way out, not a stray path", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const task = fakeTask({
			id: "home-path.create",
			feature: "home-path",
			needsRoot: true,
			checks: [false],
		});
		const runner = fakeRunner();
		// Empty stdout and non-zero: guessing here would put the script somewhere
		// the privileged command can't reach it.
		runner.ssh = async () => ({ code: 255, stdout: "\n", stderr: "connection closed" });

		await expect(
			runSetup(remoteCtx(runner, []), {
				features: ["home-path"],
				tasks: [task],
				prompt: scriptedPrompt(["run-for-me"]),
				scratchDir: scratch(),
			}),
		).rejects.toThrow(/home directory/);

		expect(runner.scpCalls).toHaveLength(0);
		expect(runner.sshCalls.some((call) => call.cmd[0] === "sudo")).toBe(false);
	});

	it("remote: asks the machine for its home when drive.toml doesn't know it", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const task = fakeTask({
			id: "home-path.create",
			feature: "home-path",
			needsRoot: true,
			checks: [false],
		});
		const runner = fakeRunner("/home/agent");
		let checks = 0;
		task.check = async () => {
			checks += 1;
			return checks > 1;
		};

		await runSetup(remoteCtx(runner, []), {
			features: ["home-path"],
			tasks: [task],
			prompt: scriptedPrompt(["run-for-me"]),
			scratchDir: scratch(),
		});

		const probe = runner.sshCalls.find((call) => call.cmd[0] === "sh");
		expect(probe?.cmd).toEqual(["sh", "-c", "echo $HOME"]);
		expect(runner.scpCalls[0][1]).toBe("/home/agent/.hyper/hyper-machine-root.sh");
	});

	it("local: spawns one `sudo bash <path>` and nothing else", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const dir = scratch();
		const task = fakeTask({ id: "agent-user.create", needsRoot: true, checks: [false] });
		const spawned: SpawnRequest[] = [];
		let checks = 0;
		task.check = async () => {
			checks += 1;
			return checks > 1;
		};

		await runSetup(
			localCtx(
				new LocalMachine(async (request) => {
					spawned.push(request);
					return { code: 0, stdout: "", stderr: "" };
				}),
				[],
			),
			{
				features: ["tools"],
				tasks: [task],
				prompt: scriptedPrompt(["run-for-me"]),
				scratchDir: dir,
			},
		);

		expect(spawned).toHaveLength(1);
		expect(spawned[0].file).toBe("sudo");
		expect(spawned[0].args).toEqual(["bash", join(dir, ROOT_SCRIPT_NAME)]);
		// stdio inherited: the user types the password themselves.
		expect(spawned[0].tty).toBe(true);
	});

	it("says what the privileged command returned before re-checking", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const dir = scratch();
		const task = fakeTask({ id: "agent-user.create", needsRoot: true, checks: [false] });
		const logs: string[] = [];

		// Three wrong passwords, then skip: "Still to do" on its own would hide the
		// only useful line in the output.
		await runSetup(
			localCtx(
				new LocalMachine(async () => ({ code: 1, stdout: "", stderr: "Sorry, try again." })),
				logs,
			),
			{
				features: ["tools"],
				tasks: [task],
				prompt: scriptedPrompt(["run-for-me", "skip"]),
				scratchDir: dir,
			},
		);

		const out = logs.join("\n");
		expect(out).toContain("exited 1");
		expect(out).toContain("Sorry, try again.");
	});
});

describe("runSetup — failures", () => {
	it("names the task when its check throws, and runs nothing after it", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const broken = fakeTask({ id: "tools.fd", throwInCheck: true });
		const after = fakeTask({ id: "tools.rg", checks: [false] });
		const logs: string[] = [];

		await expect(
			runSetup(localCtx(fakeRunner(), logs), {
				features: ["tools"],
				tasks: [broken, after],
				prompt: scriptedPrompt([]),
				scratchDir: scratch(),
			}),
		).rejects.toThrow(TaskError);

		await expect(
			runSetup(localCtx(fakeRunner(), logs), {
				features: ["tools"],
				tasks: [broken, after],
				prompt: scriptedPrompt([]),
				scratchDir: scratch(),
			}),
		).rejects.toThrow(/tools\.fd/);

		// The task after the broken one must not have run at all — not even a
		// check. `checks` holding its answer says nothing about whether check()
		// was called, which is what this is about.
		expect(after.applies).toBe(0);
		expect(after.checkCalls).toBe(0);
	});

	it("names the task when apply throws, and doesn't re-check it", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const task = fakeTask({ id: "tools.mise", checks: [false], throwInApply: true });

		await expect(
			runSetup(localCtx(fakeRunner(), []), {
				features: ["tools"],
				tasks: [task],
				prompt: scriptedPrompt([]),
				scratchDir: scratch(),
			}),
		).rejects.toThrow(/tools\.mise/);

		// Exactly one check: the one that found the work to do. Re-checking after a
		// failed apply would report on a state nobody reached.
		expect(task.checkCalls).toBe(1);
		expect(task.applies).toBe(1);
	});

	it("names the task when its rootScript throws", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const task = fakeTask({
			id: "docker.packages",
			feature: "docker-rootless",
			needsRoot: true,
			checks: [false],
			throwInRootScript: true,
		});

		await expect(
			runSetup(remoteCtx(fakeRunner(), []), {
				features: ["docker-rootless"],
				tasks: [task],
				prompt: scriptedPrompt([]),
				scratchDir: scratch(),
			}),
		).rejects.toThrow(/docker\.packages/);
	});
});
