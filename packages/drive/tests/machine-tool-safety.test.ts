import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { exitCodeFor, renderReport } from "#commands/machine/setup";
import { runSetup } from "#services/machine/runner";
import type { TaskContext } from "#services/machine/tasks/types";
import { findTool } from "#services/machine/tools";
import type { MachineRunner, RunResult } from "#services/remote";

function context(ssh: MachineRunner["ssh"]): TaskContext {
	const unused = async (): Promise<RunResult> => {
		throw new Error("unexpected transfer");
	};
	return {
		machine: null,
		config: { remote: "git@example:x.git" } as TaskContext["config"],
		log: () => {},
		runner: { ssh, scp: unused, rsync: unused },
	};
}

describe("PR33 safety regressions", () => {
	it("preserves curl's archive error and resolves latest via Location without the API", async () => {
		const home = await mkdtemp(join(tmpdir(), "hyper-curl-failure-"));
		try {
			await mkdir(join(home, "bin"));
			await mkdir(join(home, "claude"));
			await writeFile(
				join(home, "bin/curl"),
				`#!/bin/sh
case "$*" in
  */releases/latest*) printf 'Location: https://github.com/rtk-ai/rtk/releases/tag/v1.2.3\\r\\n'; exit 0 ;;
esac
echo 'curl: (22) archive HTTP 503 fixture' >&2
exit 22
`,
				{ mode: 0o755 },
			);
			const scripts: string[] = [];
			const ctx = context(async (cmd) => {
				const script = cmd[2];
				scripts.push(script);
				if (script.includes("uname -s")) return { code: 0, stdout: "Linux\nx86_64\n", stderr: "" };
				if (!script.includes("unpack_one")) return { code: 1, stdout: "", stderr: "" };
				const r = spawnSync("sh", ["-c", script], {
					encoding: "utf8",
					env: {
						HOME: home,
						CLAUDE_CONFIG_DIR: join(home, "claude"),
						PATH: `${home}/bin:/usr/bin:/bin`,
					},
				});
				return { code: r.status ?? 1, stdout: r.stdout, stderr: r.stderr };
			});
			await expect(findTool("rtk")?.install(ctx)).rejects.toThrow(
				"curl: (22) archive HTTP 503 fixture",
			);
			expect(scripts.join("\n")).not.toContain("api.github.com");
			expect(scripts.join("\n")).toContain("--proto '=https' --proto-redir '=https'");
		} finally {
			await rm(home, { recursive: true, force: true });
		}
	});

	it("turns a failed post-apply check into exit 4 and one report entry (H4)", async () => {
		const report = await runSetup(
			context(async () => {
				throw new Error("unexpected command");
			}),
			{
				features: ["tools"],
				tasks: [
					{
						id: "tools.fake",
						feature: "tools",
						title: "fake",
						needsRoot: false,
						check: async () => false,
						apply: async () => {},
						unmetReason: "binary still unreachable",
					},
				],
				prompt: { rootChoice: async () => "skip" },
				scratchDir: "/unused",
			},
		);
		expect(report.failed).toEqual([{ id: "tools.fake", reason: "binary still unreachable" }]);
		expect(report.skipped).toEqual([]);
		expect(exitCodeFor(null, report.failed.length)).toBe(4);
		expect(renderReport(report, "test").filter((line) => line.includes("tools.fake"))).toHaveLength(
			1,
		);
	});

	it("e2e entrypoint uses an environment allowlist (syntax only; never runs e2e)", async () => {
		const file = join(import.meta.dirname, "e2e/tools.sh");
		const script = await readFile(file, "utf8");
		expect(script).toContain('env -i HOME="$home" CLAUDE_CONFIG_DIR="$CLAUDE_CONFIG_DIR"');
		const invocation = script.slice(
			script.indexOf("run_setup()"),
			script.indexOf('echo "# first run'),
		);
		for (const key of [
			"MISE_DATA_DIR",
			"MISE_GLOBAL_CONFIG_FILE",
			"MISE_CONFIG_DIR",
			"MISE_INSTALL_PATH",
		])
			expect(invocation).not.toContain(key);
		expect(spawnSync("bash", ["-n", file]).status).toBe(0);
	});
});
