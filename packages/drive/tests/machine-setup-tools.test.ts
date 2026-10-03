/**
 * `hyper machine setup`, as the command wires the tools feature together.
 *
 * The runner's own behaviour is covered in machine-runner.test.ts and the
 * registry's in machine-tools.test.ts. What is pinned here is the wiring
 * between them: which tools a run picks, what it says when it has nothing to
 * pick from, and how many machines it asks at once. Those are the decisions the
 * user experiences, and none of them is visible from running the registry.
 */

import { type SpawnSyncReturns, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
	emptySelectionMessage,
	featurePromptOptions,
	parityVersions,
	parseTools,
	printableHookWord,
	toolPromptOptions,
	toolsFromScan,
	versionsFor,
} from "#commands/machine/setup";
import type { HookScan } from "#services/machine/hooks-scan";
import { infrastructureTasks } from "#services/machine/tasks/index";
import type { Versioned } from "#services/machine/tasks/tools-rsync";
import type { TaskContext } from "#services/machine/tasks/types";
import { TOOLS } from "#services/machine/tools";
import type { MachineRunner, RunResult } from "#services/remote";
import { blockInstallers } from "#tests/offline-installers";
import { withTempConfig } from "#tests/tmp-config";

const cli = join(import.meta.dirname, "..", "..", "cli", "bin", "run.js");

const spawnCli = (args: string[], env: Record<string, string> = {}): SpawnSyncReturns<string> => {
	const bin = scratchDir();
	blockInstallers(bin);
	return spawnSync(process.execPath, [cli, ...args], {
		encoding: "utf8",
		env: {
			...process.env,
			AI_AGENT: undefined,
			CLAUDECODE: undefined,
			NO_COLOR: "1",
			FORCE_COLOR: "0",
			...env,
			HOME: scratchDir(),
			CLAUDE_CONFIG_DIR: scratchDir(),
			PATH: `${bin}:${env.PATH ?? process.env.PATH ?? "/usr/bin:/bin"}`,
		},
	});
};

const tempDirs: string[] = [];
function scratchDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "drive-setup-t15-"));
	tempDirs.push(dir);
	return dir;
}
afterAll(() => {
	for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function skipIfUnbuilt(): boolean {
	if (
		existsSync(cli) &&
		existsSync(join(import.meta.dirname, "..", "dist", "services", "machine", "runner.js"))
	) {
		return false;
	}
	expect.skip("cli/drive not built");
	return true;
}

const CONFIG = 'remote = "git@example:x.git"\n';

/** An empty scan, as a machine whose hooks aren't synced yet would produce. */
function scan(over: Partial<HookScan> = {}): HookScan {
	return {
		commandCount: 0,
		preselect: [],
		unknown: [],
		resolvesAfterClone: [],
		configSync: [],
		files: [],
		warnings: [],
		...over,
	};
}

describe("which tools a run picks (m3)", () => {
	it.each(["", ",", " , "])("rejects an empty explicit tool list %j (H5)", (value) => {
		expect(() => parseTools(value)).toThrow(/pass `--tools all` explicitly/);
		if (skipIfUnbuilt()) return;
		withTempConfig(CONFIG);
		const r = spawnCli(["machine", "setup", "--features", "tools", "--tools", value, "--yes"]);
		expect(r.status).toBe(2);
		expect(r.stderr.replace(/\s+/g, " ")).toContain("pass `--tools all` explicitly");
	});

	it("distinguishes empty hooks from unmapped hooks and strips terminal controls", () => {
		expect(emptySelectionMessage(scan())).toContain("no hooks found");
		expect(emptySelectionMessage(scan({ commandCount: 1 }))).toContain("hooks found, none maps");
		expect(printableHookWord("\u001b[2Junknown\n\u0007\u009bword")).toBe("[2Junknownword");
	});

	it("`--tools` names real tools, and `all` means all of them", () => {
		expect(parseTools("jq,wt")).toEqual(["jq", "wt"]);
		expect(parseTools(" all ")).toEqual(["all"]);
		expect(() => parseTools("")).toThrow(/pass `--tools all` explicitly/);
	});

	it("names the valid tools when it is given one that doesn't exist", () => {
		expect(() => parseTools("jq,nope")).toThrow(/Unknown tool: nope/);
		expect(() => parseTools("jq,nope")).toThrow(/jq/);
	});

	it("an empty hook scan selects nothing at all, rather than everything", () => {
		expect(toolsFromScan(scan())).toEqual([]);
		expect(toolsFromScan(scan({ preselect: ["jq", "rtk"] }))).toEqual(["jq", "rtk"]);
		// A word the registry doesn't know is not a tool to install.
		expect(toolsFromScan(scan({ preselect: ["orbita"] }))).toEqual([]);
	});

	it("`--tools` without the tools feature is a usage error, not a silent no-op", () => {
		if (skipIfUnbuilt()) return;
		withTempConfig(CONFIG);
		const result = spawnCli(["machine", "setup", "--tools", "jq"], {
			HYPER_MACHINE_SCRATCH: scratchDir(),
		});
		expect(result.status).toBe(2);
		expect(result.stderr).toMatch(/--features/);
	});
});

describe("resolved feature selection", () => {
	it.each([
		["--features", "config-sync", "--tools", "jq"],
		["--features", "", "--tools", "jq"],
		["configured", "--yes", "--tools", "jq"],
	])("rejects --tools after resolving %j", (...args) => {
		if (skipIfUnbuilt()) return;
		withTempConfig(
			`${CONFIG}\n[machines.configured]\nfeatures = ["config-sync"]\nhome = "/home/test"\n`,
		);
		const bin = scratchDir();
		writeFileSync(
			join(bin, "herdr"),
			`#!/bin/sh\nprintf '%s\\n' '[{"label":"configured","target":"test@fake","enabled":true}]'\n`,
			{ mode: 0o755 },
		);
		// Fail closed even if a regression reaches a remote command.
		writeFileSync(join(bin, "ssh"), "#!/bin/sh\nexit 99\n", { mode: 0o755 });
		const r = spawnCli(["machine", "setup", ...args], { PATH: `${bin}:${process.env.PATH}` });
		expect(r.status).toBe(2);
		expect(r.stderr).toMatch(/--features tools/);
	});
});

describe("the infrastructure tasks", () => {
	it("are always offered, local machine included: the PATH line and the copy tool", () => {
		const ids = infrastructureTasks().map((task) => task.id);
		expect(ids).toEqual(["tools.path", "tools.rsync"]);
		expect(infrastructureTasks().find((task) => task.id === "tools.rsync")?.needsRoot).toBe(true);
	});
});

describe("the prompts (B3)", () => {
	it("puts the tool preselection in the multiselect's own initialValues", () => {
		// `@clack/prompts` reads the top-level `initialValues` and ignores an
		// `initialValue` set on any single option, so a tick on an option never
		// appears and the hook scan's answer silently vanished.
		const tools = toolPromptOptions(["jq", "rtk"]);
		// In registry order, not the caller's order: the list is a subset of the
		// options the prompt shows.
		expect(tools.initialValues).toEqual(["rtk", "jq"]);
		expect(tools.options).toHaveLength(TOOLS.length);
		// No per-option initialValue: that is the flag that does nothing.
		for (const option of tools.options) expect(Object.keys(option)).not.toContain("initialValue");
	});

	it("puts the machine's configured features in the feature multiselect's initialValues", () => {
		const features = featurePromptOptions(["tools"]);
		expect(features.initialValues).toEqual(["tools"]);
		for (const option of features.options)
			expect(Object.keys(option)).not.toContain("initialValue");
		expect(featurePromptOptions([]).initialValues).toEqual([]);
	});
});

describe("detecting versions (M5)", () => {
	/** A runner that counts how many detects are in flight at once. */
	class CountingRunner implements MachineRunner {
		live = 0;
		peak = 0;
		calls = 0;
		async ssh(): Promise<RunResult> {
			this.live++;
			this.calls++;
			this.peak = Math.max(this.peak, this.live);
			await new Promise((resolve) => setTimeout(resolve, 1));
			this.live--;
			return { code: 0, stdout: "1.0.0", stderr: "" };
		}
		async rsync(): Promise<RunResult> {
			return { code: 0, stdout: "", stderr: "" };
		}
		async scp(): Promise<RunResult> {
			return { code: 0, stdout: "", stderr: "" };
		}
	}

	const specs: Versioned[] = TOOLS.slice(0, 12).map((tool) => ({
		id: tool.id,
		detect: tool.detect,
	}));

	it("probes both reference and target even when the target is local", async () => {
		const runner = new CountingRunner();
		const ctx = { machine: null, runner, config: {}, log: () => {} } as TaskContext;
		const [local, remote] = await parityVersions(specs, ctx, ctx);
		expect(local).not.toBe(remote);
		expect(runner.calls).toBe(specs.length * 2);
	});

	it("turns a rejected detection into null plus a warning, without losing other versions", async () => {
		const warnings: string[] = [];
		const ctx = {
			machine: null,
			runner: new CountingRunner(),
			config: {},
			log: (line: string) => warnings.push(line),
		} as TaskContext;
		const result = await versionsFor(
			[
				{
					id: "broken",
					detect: async () => {
						throw new Error("connection refused");
					},
				},
				{ id: "fine", detect: async () => "1.2.3" },
			],
			ctx,
		);
		expect(result).toEqual({ broken: null, fine: "1.2.3" });
		expect(warnings.join("\n")).toMatch(/warning.*broken.*connection refused/);
	});

	it("never opens more than four connections at once", async () => {
		const runner = new CountingRunner();
		const ctx = { machine: null, runner, config: {}, log: () => {} } as unknown as TaskContext;
		const versions = await versionsFor(specs, ctx);
		expect(Object.keys(versions)).toHaveLength(specs.length);
		// sshd's default MaxStartups is 10; sixteen at once is how a parity table
		// ends up calling every tool "missing" on a machine that has them all.
		expect(runner.peak).toBeLessThanOrEqual(4);
		expect(runner.calls).toBe(specs.length);
	});
});
