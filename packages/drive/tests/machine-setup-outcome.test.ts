/** Command output/exit ordering with every machine boundary replaced: no installers. */
import type { Config } from "@oclif/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import MachineSetup from "#commands/machine/setup";
import { runSetup, type SetupReport } from "#services/machine/runner";
import { TaskError } from "#services/machine/tasks/types";

vi.mock("#config/index", async (original) => ({
	...(await original<typeof import("#config/index")>()),
	loadConfig: () => ({ remote: "git@example:x.git" }),
}));
vi.mock("#services/machine/runner", async (original) => ({
	...(await original<typeof import("#services/machine/runner")>()),
	runSetup: vi.fn(),
}));
vi.mock("#services/machine", async (original) => ({
	...(await original<typeof import("#services/machine")>()),
	runnerFor: () => ({ ssh: async () => ({ code: 0, stdout: "1.2.3", stderr: "" }) }),
}));
vi.mock("#services/remote", async (original) => ({
	...(await original<typeof import("#services/remote")>()),
	LocalMachine: class {
		async ssh() {
			return { code: 0, stdout: "1.2.3", stderr: "" };
		}
	},
}));

afterEach(() => vi.restoreAllMocks());

function command() {
	const cmd = new MachineSetup([], {} as Config);
	vi.spyOn(cmd, "parse").mockResolvedValue({
		argv: [],
		flags: { features: "tools", tools: "jq", yes: true, debug: false },
	} as never);
	const output: string[] = [];
	vi.spyOn(cmd, "log").mockImplementation((line) => {
		output.push(String(line));
	});
	const error = vi.spyOn(cmd, "error").mockImplementation((message, options) => {
		output.push(`EXIT ${options?.exit}: ${message}`);
		throw new Error(`exit ${options?.exit}`);
	});
	return { cmd, output, error };
}

describe("setup outcomes (N4)", () => {
	it.each([
		[false, false, null],
		[false, true, 3],
		[true, false, 4],
		[true, true, 4],
	] as const)("failed=%s root=%s exits %s after report/parity", async (failed, pending, exit) => {
		const { cmd, output } = command();
		vi.mocked(runSetup).mockImplementationOnce(async (_ctx, options) => {
			if (pending)
				await options.prompt.rootChoice({
					machine: "test",
					path: "/tmp/root.sh",
					tasks: ["tools.rsync"],
				});
			return {
				applied: [],
				alreadyOk: ["noop.check"],
				skipped: pending ? ["tools.rsync"] : [],
				failed: failed ? [{ id: "tools.jq", reason: "HTTP 404" }] : [],
			} satisfies SetupReport;
		});
		if (exit === null) await cmd.run();
		else await expect(cmd.run()).rejects.toThrow(`exit ${exit}`);
		expect(output.join("\n")).toContain("already fine");
		expect(output.join("\n")).toContain("Tool versions on this machine");
		if (exit !== null) {
			expect(output.at(-1)).toContain(`EXIT ${exit}`);
			if (pending) expect(output.at(-1)).toContain("still need root");
			if (failed) {
				expect(output.at(-1)).toContain("could not be completed");
				expect(output.findIndex((line) => line.includes("FAILED:"))).toBeLessThan(
					output.length - 1,
				);
			}
		}
	});

	it("a programming error exits 1, never the failed-tools code", async () => {
		const { cmd, output } = command();
		vi.mocked(runSetup).mockRejectedValueOnce(new TaskError("tools.jq", "programming bug"));
		await expect(cmd.run()).rejects.toThrow("exit 1");
		expect(output.at(-1)).toContain("programming bug");
	});

	it("documents every exit code in help", () => {
		for (const code of [0, 1, 2, 3, 4]) expect(MachineSetup.description).toContain(`${code} `);
	});
});
