import { spawnSync } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { exitCodeFor, parityVersions, renderReport } from "#commands/machine/setup";
import { runSetup } from "#services/machine/runner";
import { toolTask } from "#services/machine/tasks/index";
import type { TaskContext } from "#services/machine/tasks/types";
import { findTool, type ToolSpec } from "#services/machine/tools";
import type { MachineRunner, RunResult } from "#services/remote";
import { blockInstallers } from "#tests/offline-installers";

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
	it.each(["local", "remote"])(
		"uses the real reference PATH but a strict %s target/check",
		async (destination) => {
			const scripts: string[] = [];
			const here = context(async (cmd) => {
				scripts.push(cmd[2]);
				const reference = cmd[2].includes('PATH="$PATH:');
				return { code: reference ? 0 : 1, stdout: reference ? "2.0.0" : "", stderr: "" };
			});
			const target = {
				...here,
				machine: destination === "local" ? null : ({ name: "remote" } as TaskContext["machine"]),
			};
			const spec = findTool("pi") as ToolSpec;
			const [reference, other] = await parityVersions([spec], here, target);
			expect(reference.pi).toBe("2.0.0");
			expect(other.pi).toBeNull();
			expect(await toolTask(spec).check(target)).toBe(false);
			expect(
				scripts.filter((s) => s.includes('PATH="$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin"')),
			).toHaveLength(2);
			expect(scripts[0]).toContain(".pi/agent");
		},
	);

	it.each([
		"project PATH",
		"relative PATH",
		"project symlink",
		"temporary symlink",
		"temporary mise override",
	])("never links a transient binary: %s", async (kind) => {
		const root = await mkdtemp(join(tmpdir(), "hyper-link-safety-"));
		try {
			const home = join(root, "home");
			const project = join(root, "project");
			const privateBin = join(home, ".pi/agent/bin");
			const transient = kind.startsWith("temporary")
				? join(root, "transient/shims")
				: kind === "relative PATH"
					? project
					: join(project, "node_modules/.bin");
			await mkdir(privateBin, { recursive: true });
			await mkdir(project, { recursive: true });
			await mkdir(transient, { recursive: true });
			await mkdir(join(root, "claude"));
			await writeFile(join(transient, "pi"), "#!/bin/sh\necho 99.98.97\n", { mode: 0o755 });
			if (kind.endsWith("symlink")) await symlink(join(transient, "pi"), join(privateBin, "pi"));
			const ctx = context(async (cmd) => {
				if (cmd[2].includes("installer=") || cmd[2].includes("mise use"))
					throw new Error("blocked installer");
				const r = spawnSync("sh", ["-c", cmd[2]], {
					encoding: "utf8",
					cwd: project,
					env: {
						HOME: home,
						CLAUDE_CONFIG_DIR: join(root, "claude"),
						TMPDIR: root,
						PATH: `${kind === "relative PATH" ? "." : transient}:/usr/bin:/bin`,
						...(kind === "temporary mise override"
							? { MISE_DATA_DIR: join(root, "transient") }
							: {}),
					},
				});
				return { code: r.status ?? 1, stdout: r.stdout, stderr: r.stderr };
			});
			await expect(findTool("pi")?.install(ctx)).rejects.toThrow("blocked installer");
			await expect(lstat(join(home, ".local/bin/pi"))).rejects.toThrow();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("offline CLI blockers fail loudly before reaching any real installer", async () => {
		const home = await mkdtemp(join(tmpdir(), "hyper-installer-blockers-"));
		try {
			await mkdir(join(home, "claude"));
			blockInstallers(home);
			for (const tool of ["curl", "mise"]) {
				const result = spawnSync("sh", ["-c", `${tool} --version`], {
					encoding: "utf8",
					env: {
						HOME: home,
						CLAUDE_CONFIG_DIR: join(home, "claude"),
						PATH: `${home}:/usr/bin:/bin`,
					},
				});
				expect(result.status).toBe(99);
				expect(result.stderr).toContain(`BLOCKED unexpected ${tool}`);
			}
		} finally {
			await rm(home, { recursive: true, force: true });
		}
	});

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
