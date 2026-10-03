/**
 * The tool registry: what setup may install, and what it may not.
 *
 * The registry is the one place in hyperdrive that writes to a user's machine
 * outside the space, so its rules are checked here rather than trusted: no root
 * anywhere in a recipe (C-6), everything through the runner (C-16), and every
 * install gated on a `detect` that says null (C-15). The parity table is here
 * too because it is the other half of the same feature: the numbers the recipes
 * produce are what the table prints.
 */

import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { DriveConfig } from "#config/schema";
import { compareVersions, parityTable, renderParity, statusFor } from "#services/machine/parity";
import { runSetup } from "#services/machine/runner";
import { allTasks, selectedToolTasks, toolTask } from "#services/machine/tasks/index";
import { PATH_LINE, pathTask } from "#services/machine/tasks/tools-path";
import { rsyncRootScript, rsyncSpec, rsyncTask } from "#services/machine/tasks/tools-rsync";
import type { Task, TaskContext } from "#services/machine/tasks/types";
import { detectPlatform, findTool, normaliseVersion, TOOLS } from "#services/machine/tools";
import type { MachineRunner, RsyncOptions, RunResult, SshOptions } from "#services/remote";

/** The fixture `~/.prototools` pins node for; the value never reaches a command. */
const CONFIG = { remote: "git@example:x.git" } as DriveConfig;

/**
 * A runner that records every script and answers from a script.
 *
 * The answers matter: a recipe asks `uname -s`/`uname -m` before it knows which
 * release to fetch, and a recipe that can't be read is a recipe nobody checked.
 */
class RecordingRunner implements MachineRunner {
	readonly scripts: string[] = [];
	private readonly answers: [RegExp, RunResult][];

	constructor(answers: [RegExp, RunResult][] = []) {
		this.answers = answers;
	}

	async ssh(cmd: string[], _opts?: SshOptions): Promise<RunResult> {
		const script = cmd.join(" ");
		this.scripts.push(script);
		for (const [pattern, result] of this.answers) {
			if (pattern.test(script)) return result;
		}
		return { code: 0, stdout: "", stderr: "" };
	}

	async rsync(_src: string, _dst: string, _opts?: RsyncOptions): Promise<RunResult> {
		return { code: 0, stdout: "", stderr: "" };
	}

	async scp(_src: string, _dst: string): Promise<RunResult> {
		return { code: 0, stdout: "", stderr: "" };
	}

	/** Every script, joined — what the C-6 grep reads. */
	get all(): string {
		return this.scripts.join("\n");
	}
}

function ctxWith(runner: MachineRunner): TaskContext {
	return { machine: null, runner, config: CONFIG, log: () => {} };
}

/** A Darwin/arm64 machine, which is the shape every recipe here was written for. */
const DARWIN_ARM: [RegExp, RunResult][] = [
	// `ssh(cmd)` records the argv joined, so the pattern matches the whole
	// `sh -c uname -s; uname -m` line rather than the script alone.
	[/uname -s; uname -m/, { code: 0, stdout: "Darwin\narm64\n", stderr: "" }],
];

describe("the tool registry", () => {
	it("has unique ids, and a detect and an install for every one", () => {
		const ids = TOOLS.map((tool) => tool.id);
		expect(new Set(ids).size).toBe(ids.length);
		for (const tool of TOOLS) {
			expect(typeof tool.detect, tool.id).toBe("function");
			expect(typeof tool.install, tool.id).toBe("function");
			expect(tool.title.length).toBeGreaterThan(0);
		}
	});

	it("covers every tool the parity table is supposed to have a row for", () => {
		const ids = TOOLS.map((tool) => tool.id);
		for (const id of [
			"claude",
			"pi",
			"rtk",
			"bd",
			"herdr",
			"but",
			"wt",
			"gh",
			"jq",
			"fzf",
			"rg",
			"fd",
			"mise",
			"mutagen",
			"bun",
		]) {
			expect(ids, id).toContain(id);
		}
	});

	it("never reaches for root: no apt, brew or sudo in any recipe (C-6)", async () => {
		for (const tool of TOOLS) {
			const runner = new RecordingRunner(DARWIN_ARM);
			await tool.install(ctxWith(runner));
			const scripts = runner.all;
			expect(scripts, `${tool.id} ran no commands`).not.toBe("");
			// Every way a recipe could ask for root, not just the two spellings the
			// old grep caught: `apt-get` is not `apt `.
			expect(scripts, tool.id).not.toMatch(
				/(^|[\s|;&(])(apt|apt-get|brew|dnf|yum|apk|pacman|zypper|sudo|doas)\s/,
			);
		}
	});

	it("puts tools in ~/.local/bin, not a system directory", async () => {
		for (const tool of TOOLS) {
			const runner = new RecordingRunner(DARWIN_ARM);
			await tool.install(ctxWith(runner));
			expect(runner.all, tool.id).toContain("$HOME/.local/bin");
			expect(runner.all, tool.id).not.toMatch(/\/usr\/(local\/)?bin\//);
			expect(runner.all, tool.id).not.toContain("/etc/");
		}
	});

	it("adds the PATH line to the rc files idempotently, and only once", async () => {
		const runner = new RecordingRunner(DARWIN_ARM);
		await findTool("wt")?.install(ctxWith(runner));
		const script = runner.all;
		expect(script).toContain(".local/bin");
		// Every write is guarded by a grep for the line being there already: that
		// is what makes a second setup run a no-op (C-15).
		expect(script).toMatch(/grep -qF[^\n]*\.local\/bin/);
	});

	it("picks the release for the machine's OS and arch, read through the runner", async () => {
		const arm = new RecordingRunner(DARWIN_ARM);
		await findTool("rtk")?.install(ctxWith(arm));
		expect(arm.all).toContain("uname -s; uname -m");
		expect(arm.all).toContain("rtk-aarch64-apple-darwin.tar.gz");

		const linux = new RecordingRunner([
			[/uname -s; uname -m/, { code: 0, stdout: "Linux\nx86_64\n", stderr: "" }],
		]);
		await findTool("mutagen")?.install(ctxWith(linux));
		expect(linux.all).toContain("mutagen_linux_amd64_@TAG@.tar.gz");
	});

	it("puts the five mise-managed tools through mise", async () => {
		for (const id of ["gh", "jq", "fzf", "rg", "fd"]) {
			const runner = new RecordingRunner();
			await findTool(id)?.install(ctxWith(runner));
			expect(runner.all, id).toContain("mise use -g ");
			expect(runner.all, id).toContain("mise which ");
		}
		// ripgrep's registry name isn't its binary name; the recipe has to use both.
		const runner = new RecordingRunner();
		await findTool("rg")?.install(ctxWith(runner));
		expect(runner.all).toContain("mise use -g ripgrep@latest");
	});

	it("installs mise before the tools that need it", async () => {
		const runner = new RecordingRunner([
			[/command -v mise/, { code: 1, stdout: "", stderr: "not installed" }],
		]);
		await findTool("jq")?.install(ctxWith(runner));
		expect(runner.all).toContain("https://mise.run");
	});

	it("normalises every tool's version output to a bare semver", () => {
		expect(normaliseVersion("jq-1.8.2")).toBe("1.8.2");
		expect(normaliseVersion("wt v0.73.0")).toBe("0.73.0");
		expect(normaliseVersion("gh version 2.97.0 (2026-07-31)")).toBe("2.97.0");
		expect(normaliseVersion("Mutagen version 0.18.1")).toBe("0.18.1");
		expect(normaliseVersion("ripgrep 15.2.0")).toBe("15.2.0");
		expect(normaliseVersion("2.1.288 (Claude Code)")).toBe("2.1.288");
		expect(normaliseVersion("0.74.2")).toBe("0.74.2");
		expect(normaliseVersion("no numbers here")).toBeNull();
		expect(normaliseVersion(null)).toBeNull();
	});

	it("detects a missing tool as null rather than throwing", async () => {
		const missing = new RecordingRunner([[/./, { code: 127, stdout: "", stderr: "not found" }]]);
		for (const tool of TOOLS) {
			expect(await tool.detect(ctxWith(missing)), tool.id).toBeNull();
		}
	});

	it("reads the platform from the target machine, not from this process", async () => {
		expect(await detectPlatform(ctxWith(new RecordingRunner(DARWIN_ARM)))).toEqual({
			os: "Darwin",
			arch: "arm64",
		});
		const runner = new RecordingRunner([
			[/uname/, { code: 0, stdout: "Linux\naarch64\n", stderr: "" }],
		]);
		// `uname -m` says aarch64 on Linux; the recipes want one spelling.
		expect(await detectPlatform(ctxWith(runner))).toEqual({ os: "Linux", arch: "arm64" });
	});
});

describe("the tool tasks", () => {
	it("are one per registry entry, all user-level (C-6)", () => {
		const tasks = selectedToolTasks();
		expect(tasks).toHaveLength(TOOLS.length);
		expect(tasks.map((task) => task.id)).toContain("tools.jq");
		for (const task of tasks) {
			expect(task.feature, task.id).toBe("tools");
			expect(task.needsRoot, task.id).toBe(false);
			expect(task.apply, task.id).toBeTypeOf("function");
		}
	});

	it("keep the noop task", () => {
		expect(allTasks().map((task) => task.id)).toContain("noop.check");
	});

	it("run the install recipe exactly once when detect is null, then detect again (C-15)", async () => {
		const jq = findTool("jq");
		expect(jq).toBeDefined();
		// Detect answers null, then a version: the machine gains jq from the recipe.
		let detects = 0;
		let installs = 0;
		const task: Task = {
			...toolTask(jq as NonNullable<typeof jq>),
			check: async () => {
				detects++;
				return detects > 1;
			},
			apply: async () => {
				installs++;
			},
		};
		const runner = new RecordingRunner();
		const report = await runSetup(ctxWith(runner), {
			features: ["tools"],
			tasks: [task],
			prompt: { rootChoice: async () => "skip" },
			scratchDir: join("/tmp", "hyper-tools-test"),
		});
		expect(installs).toBe(1);
		expect(detects).toBe(2);
		expect(report.applied).toEqual(["tools.jq"]);
	});

	it("run nothing when detect already answers a version (C-15)", async () => {
		let installs = 0;
		const task: Task = {
			...toolTask(findTool("wt") as NonNullable<ReturnType<typeof findTool>>),
			check: async () => true,
			apply: async () => {
				installs++;
			},
		};
		const runner = new RecordingRunner();
		const report = await runSetup(ctxWith(runner), {
			features: ["tools"],
			tasks: [task],
			prompt: { rootChoice: async () => "skip" },
			scratchDir: join("/tmp", "hyper-tools-test"),
		});
		expect(installs).toBe(0);
		expect(runner.scripts).toEqual([]);
		expect(report.alreadyOk).toEqual(["tools.wt"]);
	});
});

describe("the parity table", () => {
	it("says ok when both machines are on the same version", () => {
		expect(statusFor("2.97.0", "2.97.0")).toBe("ok");
		expect(parityTable({ gh: "2.97.0" }, { gh: "2.97.0" })[0].status).toBe("ok");
	});

	it("says missing when the other machine doesn't have the tool at all", () => {
		expect(statusFor("2.97.0", null)).toBe("missing");
		expect(parityTable({ rg: "15.2.0" }, {})).toEqual([
			{ tool: "rg", local: "15.2.0", remote: null, status: "missing" },
		]);
	});

	it("says older when the other machine is behind", () => {
		expect(statusFor("2.97.0", "2.46.0")).toBe("older");
		expect(statusFor("15.2.0", "15.1.0")).toBe("older");
	});

	it("says newer when the other machine is ahead", () => {
		expect(statusFor("1.3.0", "1.4.0")).toBe("newer");
		expect(statusFor("15.1.0", "15.2.0")).toBe("newer");
	});

	it("says n/a for a tool only this machine has", () => {
		expect(statusFor("0.18.1", null)).toBe("missing");
		expect(statusFor(null, "0.18.1")).toBe("n/a");
		expect(parityTable({}, { but: "0.22.3" })).toEqual([
			{ tool: "but", local: null, remote: "0.22.3", status: "n/a" },
		]);
	});

	it("compares semver numerically, not lexically", () => {
		// "0.10.0" < "0.9.0" as strings; as versions it is the other way round.
		expect(compareVersions("0.10.0", "0.9.0")).toBe(1);
		expect(statusFor("0.10.0", "0.9.0")).toBe("older");
		expect(compareVersions("1.0", "1.0.0")).toBe(0);
		expect(compareVersions("unversioned", "1.0.0")).toBeNull();
	});

	it("has a row per tool on either side, and renders aligned columns", () => {
		const rows = parityTable({ jq: "1.8.2", rtk: "0.51.0" }, { jq: "1.8.1", fd: "10.4.2" });
		expect(rows.map((row) => `${row.tool}:${row.status}`)).toEqual([
			"fd:n/a",
			"jq:older",
			"rtk:missing",
		]);
		const lines = renderParity(rows);
		expect(lines[0]).toContain("tool");
		expect(lines[1]).toContain("fd");
		expect(renderParity([])).toEqual([]);
	});
});
describe("the rsync task", () => {
	it("asks the target machine, and is root work rather than a recipe", async () => {
		const present = new RecordingRunner([
			[/command -v rsync/, { code: 0, stdout: "", stderr: "" }],
		]);
		expect(await rsyncTask.check(ctxWith(present))).toBe(true);
		expect(present.scripts[0]).toContain("command -v rsync");

		const absent = new RecordingRunner([[/command -v rsync/, { code: 1, stdout: "", stderr: "" }]]);
		expect(await rsyncTask.check(ctxWith(absent))).toBe(false);

		expect(rsyncTask.needsRoot).toBe(true);
		expect(rsyncTask.feature).toBe("tools");
		expect(rsyncTask.apply).toBeUndefined();
	});

	it("offers a root script that picks the distro's own package manager", () => {
		const script = rsyncRootScript();
		expect(script).toBe(rsyncTask.rootScript?.({} as TaskContext));
		expect(script).toContain("/etc/debian_version");
		expect(script).toContain("apt-get install -y rsync");
		expect(script).toContain("dnf install -y rsync");
		// And says so plainly when it recognises neither, rather than guessing.
		expect(script).toMatch(/don't know how to install rsync/);
	});

	it("reports a version for the parity table", async () => {
		const runner = new RecordingRunner([
			[
				/rsync --version/,
				{ code: 0, stdout: "rsync  version 3.2.7  protocol version 31\n", stderr: "" },
			],
		]);
		expect(await rsyncSpec.detect(ctxWith(runner))).toBe("3.2.7");
		expect(await rsyncSpec.detect(ctxWith(new RecordingRunner()))).toBeNull();
	});

	it("stays out of the registry, so the no-root grep over tools.ts is still clean", () => {
		expect(TOOLS.map((tool) => tool.id)).not.toContain("rsync");
	});
});

/**
 * The asset names below were read off `gh api repos/<repo>/releases/latest` on
 * 2026-10-03 and are pinned here so the table cannot rot unnoticed. The vitest
 * suite stays offline: this is a table, not a download.
 */
const ASSETS = [
	{
		tool: "rtk",
		version: "v0.51.0",
		linuxArm: "rtk-aarch64-unknown-linux-gnu.tar.gz",
		linuxIntel: "rtk-x86_64-unknown-linux-musl.tar.gz",
		darwinArm: "rtk-aarch64-apple-darwin.tar.gz",
	},
	{
		tool: "wt",
		version: "v0.80.0",
		linuxArm: "worktrunk-aarch64-unknown-linux-musl.tar.xz",
		linuxIntel: "worktrunk-x86_64-unknown-linux-musl.tar.xz",
		darwinArm: "worktrunk-aarch64-apple-darwin.tar.xz",
	},
	// beads and mutagen put the version *inside* the asset name, and the recipe
	// substitutes it on the machine from the tag it resolves — so the pinned name
	// is checked around the placeholder, which is where the platform lives.
	{
		tool: "bd",
		version: "v1.3.1",
		linuxArm: "@TAGV@_linux_arm64.tar.gz",
		linuxIntel: "@TAGV@_linux_amd64.tar.gz",
		darwinArm: "@TAGV@_darwin_arm64.tar.gz",
	},
	{
		tool: "mutagen",
		version: "v0.18.1",
		linuxArm: "linux_arm64_@TAG@.tar.gz",
		linuxIntel: "linux_amd64_@TAG@.tar.gz",
		darwinArm: "darwin_arm64_@TAG@.tar.gz",
	},
];

/** A runner that reports the given platform and nothing else. */
function onPlatform(os: string, arch: string): RecordingRunner {
	return new RecordingRunner([
		[/uname -s; uname -m/, { code: 0, stdout: `${os}\n${arch}\n`, stderr: "" }],
	]);
}

describe("release assets (B1)", () => {
	for (const asset of ASSETS) {
		it(`${asset.tool} picks the asset that actually exists on each platform`, async () => {
			const cases: [string, string, string][] = [
				["Linux", "arm64", asset.linuxArm],
				["Linux", "x86_64", asset.linuxIntel],
				["Darwin", "arm64", asset.darwinArm],
			];
			for (const [platform, arch, expected] of cases) {
				const runner = onPlatform(platform, arch);
				const spec = findTool(asset.tool);
				expect(spec, asset.tool).toBeDefined();
				await (spec as NonNullable<typeof spec>).install(ctxWith(runner));
				expect(runner.all, `${asset.tool} on ${platform}/${arch}`).toContain(expected);
			}
		});
	}

	it("refuses a platform it has no recipe for, rather than handing it a Linux binary", async () => {
		const runner = onPlatform("FreeBSD", "x86_64");
		await expect(findTool("rtk")?.install(ctxWith(runner))).rejects.toThrow(
			/covers macOS and Linux only/,
		);
	});
});

describe("installer scripts (B2, M1)", () => {
	it("runs a bash installer with bash, and an sh installer with sh", async () => {
		for (const [id, shell] of [
			["claude", "bash"],
			["bun", "bash"],
			["herdr", "sh"],
			["but", "sh"],
			["mise", "sh"],
		] as const) {
			const runner = new RecordingRunner();
			await findTool(id)?.install(ctxWith(runner));
			// A `curl … | sh` line would be the bug: on Debian `sh` is dash.
			expect(runner.all, id).not.toMatch(/curl[^\n]*\|\s*sh/);
			expect(runner.all, id).toContain(`${shell} "$installer"`);
		}
	});

	it("downloads to a file first, with a timeout, and says so when curl is missing", async () => {
		const runner = new RecordingRunner();
		await findTool("claude")?.install(ctxWith(runner));
		expect(runner.all).toContain("curl -fsSL --max-time 300");
		expect(runner.all).toContain('-o "$installer"');
		expect(runner.all).toContain("curl isn't installed");
		// An empty download must not be run as a script.
		expect(runner.all).toContain('[ -s "$installer" ]');
	});

	it("fails when the download itself fails", async () => {
		const runner = new RecordingRunner([
			[/mkdir -p/, { code: 22, stdout: "", stderr: "HTTP 404" }],
		]);
		await expect(findTool("claude")?.install(ctxWith(runner))).rejects.toThrow(/claude/);
	});
});

describe("mutagen's agents (M6)", () => {
	it("installs the agent bundle next to the binary", async () => {
		const runner = onPlatform("Darwin", "arm64");
		await findTool("mutagen")?.install(ctxWith(runner));
		expect(runner.all).toContain("mutagen-agents.tar.gz");
		expect(runner.all).toContain("mutagen-agent");
		expect(runner.all).toContain("$HOME/.local/libexec/mutagen");
		// …and the binary is linked from there into ~/.local/bin.
		expect(runner.all).toContain('"$HOME/.local/bin/mutagen"');
	});
});

describe("mise tools (m1, m8)", () => {
	it("detects through the mise store when the tool is not on PATH", async () => {
		const runner = new RecordingRunner([
			[
				/mise which/,
				{ code: 0, stdout: "/home/u/.local/share/mise/installs/ripgrep/15.2.0/rg\n", stderr: "" },
			],
		]);
		expect(await findTool("rg")?.detect(ctxWith(runner))).toBe("15.2.0");
		// The version must come from the binary mise pointed at, not from `rg`
		// being (possibly) absent from PATH.
		expect(runner.all).toContain('"$p" --version');
		expect(runner.all).not.toMatch(/ripgrep --version/);
	});
});

/** node:fs/promises has no `exists`; this is the honest spelling. */
async function fileExists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

describe("the PATH task (m4)", () => {
	const dirs: string[] = [];
	afterEach(async () => {
		for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
	});

	/** A runner that actually executes PATH_TASK's script against a temp HOME. */
	function homeRunner(home: string): RecordingRunner {
		const runner = new RecordingRunner();
		const real = runner.ssh.bind(runner);
		runner.ssh = async (cmd, _opts) => {
			// The script is the third word: `["sh", "-c", script]`. Joining the
			// whole argv would hand the child a command line that starts with
			// `sh -c set -eu`, which runs happily and does nothing.
			const script = cmd[0] === "sh" && cmd[1] === "-c" ? (cmd[2] ?? "") : cmd.join(" ");
			runner.scripts.push(script);
			void real;
			// Run the apply script for real, in a shell, with HOME pointed at the
			// temp dir. It is the file the user ends up with that matters.
			const result = await new Promise<RunResult>((resolvePromise) => {
				const child = spawn("sh", ["-c", script], {
					env: { ...process.env, HOME: home },
				});
				let stdout = "";
				let stderr = "";
				child.stdout.on("data", (c: Buffer) => (stdout += c));
				child.stderr.on("data", (c: Buffer) => (stderr += c));
				child.on("close", (code: number) => resolvePromise({ code, stdout, stderr }));
			});
			return result;
		};
		return runner;
	}

	it("prepends the line above Debian's non-interactive guard, and only once", async () => {
		const home = await mkdtemp(join(tmpdir(), "hyper-path-"));
		dirs.push(home);
		// Debian's stock .bashrc: everything after this is skipped for a
		// non-interactive shell.
		await writeFile(
			join(home, ".bashrc"),
			"case $- in\n    *i*) ;;\n      *) return;;\nesac\n\nalias ll='ls -l'\n",
		);
		await mkdir(join(home, ".local", "bin"), { recursive: true });
		const ctx = ctxWith(homeRunner(home));
		await pathTask.apply?.(ctx);
		await pathTask.apply?.(ctx);
		const written = await readFile(join(home, ".bashrc"), "utf-8");
		expect(written.indexOf(PATH_LINE)).toBeLessThan(written.indexOf("case $-"));
		expect(written.split(PATH_LINE)).toHaveLength(2); // exactly once
		expect(written).toContain("alias ll="); // the user's own lines survive
	});

	it("does not create an rc file the user does not have, except ~/.profile", async () => {
		const home = await mkdtemp(join(tmpdir(), "hyper-path-bare-"));
		dirs.push(home);
		await mkdir(join(home, ".local", "bin"), { recursive: true });
		await pathTask.apply?.(ctxWith(homeRunner(home)));
		expect(await fileExists(join(home, ".bashrc"))).toBe(false);
		expect(await fileExists(join(home, ".profile"))).toBe(true);
		expect(await readFile(join(home, ".profile"), "utf-8")).toContain(PATH_LINE);
	});

	it("is satisfied when ~/.local/bin does not exist yet", async () => {
		const home = await mkdtemp(join(tmpdir(), "hyper-path-none-"));
		dirs.push(home);
		expect(await pathTask.check(ctxWith(homeRunner(home)))).toBe(true);
	});
});
