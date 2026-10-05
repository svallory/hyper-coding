/**
 * The `config-sync` task of `hyper machine setup` (AC-21, design task table).
 *
 * The task delegates to the service `hyper drive sync-config` uses, so these
 * tests drive it through the real runner with an in-memory sync engine and a
 * recording machine runner, and pin what the design row promises: it creates
 * the two sessions the command would create, a second run changes nothing
 * (C-15), it never touches the target through the runner and never needs root,
 * and a local run or a fight with an existing session is reported, never
 * claimed as done.
 */

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { renderReport } from "#commands/machine/setup";
import { loadConfig } from "#config/index";
import { CLAUDE_SYNC_IGNORE, PI_SYNC_IGNORE } from "#config/schema";
import type { MachineInfo } from "#services/machine";
import { runSetup, type SetupPrompt } from "#services/machine/runner";
import { CONFIG_SYNC_LOCAL_MESSAGE, configSyncTask } from "#services/machine/tasks/config-sync";
import { allTasks } from "#services/machine/tasks/index";
import type { TaskContext } from "#services/machine/tasks/types";
import type { MachineRunner, RunResult } from "#services/remote";
import {
	type SyncCreateOptions,
	type SyncEngine,
	SyncEngineError,
	type SyncSession,
} from "#services/sync/engine";
import { withTempConfig } from "#tests/tmp-config";

const saved = process.env.HYPER_DRIVE_CONFIG;
afterEach(() => {
	if (saved === undefined) delete process.env.HYPER_DRIVE_CONFIG;
	else process.env.HYPER_DRIVE_CONFIG = saved;
});

const CONFIG = `remote = "git@example:x.git"

[self]
name = "laptop"
home = "/Users/me"

[machines.netcup]
home = "/home/me"
`;

const NETCUP: MachineInfo = {
	name: "netcup",
	host: "me@netcup",
	home: "/home/me",
	features: [],
	agentUser: "agent",
	agentKey: "",
	source: "both",
	herdr: true,
} as MachineInfo;

/** A sync engine that keeps its sessions in memory and records every create. */
function memoryEngine(initial: SyncSession[] = []) {
	const sessions = [...initial];
	const creates: { name: string; alpha: string; beta: string; options: SyncCreateOptions }[] = [];
	const engine: SyncEngine = {
		async create(name, alpha, beta, options) {
			creates.push({ name, alpha, beta, options });
			sessions.push({
				name,
				alpha,
				beta,
				status: "watching",
				mode: options.mode,
				ignore: [...options.ignore],
				paused: false,
				symlinkMode: options.symlinkMode,
				betaFileMode: options.betaFileMode,
				betaDirMode: options.betaDirMode,
				alphaConnected: true,
				betaConnected: true,
			});
		},
		async list() {
			return [...sessions];
		},
		async flush() {},
		async terminate() {},
		async status(name) {
			const found = sessions.find((session) => session.name === name);
			if (!found) throw new SyncEngineError(`no session ${name}`);
			return found;
		},
		async daemonReady() {
			return { registered: true, running: true };
		},
		async probe() {
			return { daemon: { registered: true, running: true }, sessions: [...sessions] };
		},
		fixHints: () => [],
		terminateHint: (name) => `terminate ${name} first`,
		validateSessionName: () => null,
		validateIgnore: () => null,
	};
	return { engine, sessions, creates };
}

/** A machine runner that records calls: the task must never need one. */
function recordingRunner() {
	const calls: string[] = [];
	const done = async (kind: string, args: unknown[]): Promise<RunResult> => {
		calls.push(`${kind} ${JSON.stringify(args)}`);
		return { code: 0, stdout: "", stderr: "" };
	};
	const runner: MachineRunner = {
		ssh: (...args) => done("ssh", args),
		rsync: (...args) => done("rsync", args),
		scp: (...args) => done("scp", args),
		asUser: (...args) => done("asUser", args),
	};
	return { runner, calls };
}

/** Root prompt that fails the test if setup ever asks it. */
const noRootPrompt: SetupPrompt = {
	async rootChoice() {
		throw new Error("config-sync must never produce root work");
	},
};

function ctxFor(
	machine: MachineInfo | null,
	engine: SyncEngine,
	runner: MachineRunner,
	logs: string[],
): TaskContext {
	return {
		machine,
		runner,
		config: loadConfig(),
		log: (line) => logs.push(line),
		syncEngine: engine,
	};
}

function scratch(): string {
	return mkdtempSync(join(tmpdir(), "drive-config-sync-"));
}

async function setup(ctx: TaskContext) {
	return runSetup(ctx, {
		features: ["config-sync"],
		tasks: allTasks().filter((task) => task.feature === "config-sync"),
		prompt: noRootPrompt,
		scratchDir: scratch(),
	});
}

describe("config-sync in the task registry", () => {
	it("is registered once, under its feature, and needs no root", () => {
		const tasks = allTasks().filter((task) => task.feature === "config-sync");
		expect(tasks.map((task) => task.id)).toEqual(["config-sync"]);
		expect(tasks[0].needsRoot).toBe(false);
		expect(tasks[0].rootScript).toBeUndefined();
		expect(tasks[0].rootFallback).toBeUndefined();
	});
});

describe("config-sync against a machine", () => {
	it("creates both sessions exactly as `hyper drive sync-config` would, then a second run changes nothing", async () => {
		withTempConfig(CONFIG);
		const { engine, creates } = memoryEngine();
		const { runner, calls } = recordingRunner();
		const logs: string[] = [];
		const ctx = ctxFor(NETCUP, engine, runner, logs);

		const first = await setup(ctx);
		expect(first.applied).toEqual(["config-sync"]);
		expect(first.skipped).toEqual([]);
		expect(first.rootScriptPath).toBeUndefined();
		expect(creates.map(({ name, alpha, beta }) => ({ name, alpha, beta }))).toEqual([
			{
				name: "hyper-claude-netcup",
				alpha: "/Users/me/.claude",
				beta: "me@netcup:/home/me/.claude",
			},
			{
				name: "hyper-pi-netcup",
				alpha: "/Users/me/.pi/agent",
				beta: "me@netcup:/home/me/.pi/agent",
			},
		]);
		for (const { options } of creates) {
			expect(options).toMatchObject({
				mode: "two-way-resolved",
				symlinkMode: "posix-raw",
				betaFileMode: "0660",
				betaDirMode: "0770",
			});
		}
		expect(creates[0].options.ignore).toEqual([...CLAUDE_SYNC_IGNORE]);
		expect(creates[1].options.ignore).toEqual([...PI_SYNC_IGNORE]);
		expect(logs.join("\n")).toContain("hyper-claude-netcup created");

		const second = await setup(ctx);
		expect(second.applied).toEqual([]);
		expect(second.alreadyOk).toEqual(["config-sync"]);
		expect(creates).toHaveLength(2);
		expect(renderReport(second, "netcup")[0]).toMatch(/^Nothing needed — netcup/);

		// The engine runs here and reaches the target itself: no ssh, scp or
		// rsync through the setup runner.
		expect(calls).toEqual([]);
	});

	it("finds sessions created by `sync-config` already settled", async () => {
		withTempConfig(CONFIG);
		const { engine, creates } = memoryEngine();
		const { runner } = recordingRunner();
		const ctx = ctxFor(NETCUP, engine, runner, []);
		// Create them through the task's apply once, then check from scratch.
		await configSyncTask.apply?.(ctx);
		expect(creates).toHaveLength(2);
		expect(await configSyncTask.check(ctx)).toBe(true);
	});

	it("creates only the missing half when one session already matches", async () => {
		withTempConfig(CONFIG);
		const { engine, creates } = memoryEngine();
		const ctx = ctxFor(NETCUP, engine, recordingRunner().runner, []);
		await configSyncTask.apply?.(ctx);
		// Drop the pi session, as if the user terminated it.
		const keep = (await engine.list()).filter((session) => session.name === "hyper-claude-netcup");
		const { engine: half, creates: halfCreates } = memoryEngine(keep);
		const report = await setup(ctxFor(NETCUP, half, recordingRunner().runner, []));
		expect(report.applied).toEqual(["config-sync"]);
		expect(halfCreates.map((create) => create.name)).toEqual(["hyper-pi-netcup"]);
		expect(creates).toHaveLength(2);
	});

	it("refuses to race a hand-made session on the same path: skipped, named, nothing created", async () => {
		withTempConfig(CONFIG);
		const foreign: SyncSession = {
			name: "claude-config",
			alpha: "/Users/me/.claude",
			beta: "me@netcup:/home/me/.claude",
			status: "watching",
			mode: "two-way-resolved",
			ignore: [],
			paused: false,
			symlinkMode: "posix-raw",
			betaFileMode: "0660",
			betaDirMode: "0770",
			alphaConnected: true,
			betaConnected: true,
		};
		const { engine, creates } = memoryEngine([foreign]);
		const logs: string[] = [];
		const report = await setup(ctxFor(NETCUP, engine, recordingRunner().runner, logs));
		expect(report.applied).toEqual([]);
		expect(report.skipped).toEqual(["config-sync"]);
		// The pi half had no conflict, so it was created; the Claude half was not.
		expect(creates.map((create) => create.name)).toEqual(["hyper-pi-netcup"]);
		expect(logs.join("\n")).toContain(
			'a session called "claude-config" already syncs this exact pair',
		);
		expect(logs.join("\n")).toContain("terminate claude-config first");
	});

	it("reports a missing sync engine as skipped with the engine's own message, without throwing", async () => {
		withTempConfig(CONFIG);
		const { engine } = memoryEngine();
		engine.list = async () => {
			throw new SyncEngineError("The sync engine isn't installed. Install mutagen first.");
		};
		const logs: string[] = [];
		const report = await setup(ctxFor(NETCUP, engine, recordingRunner().runner, logs));
		expect(report.skipped).toEqual(["config-sync"]);
		expect(logs).toContain("config-sync: The sync engine isn't installed. Install mutagen first.");
	});

	it("reports a machine without a home dir instead of syncing the whole remote home", async () => {
		withTempConfig(CONFIG);
		const { engine, creates } = memoryEngine();
		const logs: string[] = [];
		const report = await setup(
			ctxFor({ ...NETCUP, home: undefined }, engine, recordingRunner().runner, logs),
		);
		expect(report.skipped).toEqual(["config-sync"]);
		expect(creates).toEqual([]);
		expect(logs.join("\n")).toContain('The "netcup" machine has no home dir');
	});

	it("lets a programming error through rather than calling it skipped", async () => {
		withTempConfig(CONFIG);
		const { engine } = memoryEngine();
		engine.list = async () => {
			throw new TypeError("boom");
		};
		await expect(setup(ctxFor(NETCUP, engine, recordingRunner().runner, []))).rejects.toThrow(
			/config-sync.*boom/,
		);
	});
});

describe("config-sync on the local machine", () => {
	it("has nothing to pair with: says so, creates nothing, and is skipped, never 'nothing needed'", async () => {
		withTempConfig(CONFIG);
		const { engine, creates } = memoryEngine();
		const { runner, calls } = recordingRunner();
		const logs: string[] = [];
		const report = await setup(ctxFor(null, engine, runner, logs));
		expect(report.skipped).toEqual(["config-sync"]);
		expect(report.applied).toEqual([]);
		expect(creates).toEqual([]);
		expect(calls).toEqual([]);
		expect(logs).toContain(CONFIG_SYNC_LOCAL_MESSAGE);
		expect(renderReport(report, "this machine").join("\n")).not.toContain("Nothing needed");
	});
});
