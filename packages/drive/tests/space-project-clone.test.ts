import { type SpawnSyncReturns, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cloneProjectRepoBare } from "#services/space-git";

vi.mock("node:child_process", () => ({ spawnSync: vi.fn() }));
const mocked = vi.mocked(spawnSync);
let root: string;
function result(overrides: Partial<SpawnSyncReturns<string>> = {}): SpawnSyncReturns<string> {
	return { pid: 1, status: 0, signal: null, stdout: "", stderr: "", output: [], ...overrides };
}
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "hyper-clone-transport-"));
	mkdirSync(join(root, "home"));
	for (const [key, value] of Object.entries({
		HOME: join(root, "home"),
		HYPER_HOME: join(root, "hyper"),
		HYPER_DRIVE_CONFIG: join(root, "drive.toml"),
		XDG_CONFIG_HOME: join(root, "config"),
	}))
		vi.stubEnv(key, value);
	mocked.mockReset();
	mocked.mockReturnValue(result());
});
afterEach(() => {
	vi.unstubAllEnvs();
	rmSync(root, { recursive: true, force: true });
});
describe("project transport and terminal policy", () => {
	it.each([false, true])("uses a closed protocol allowlist (local=%s)", (allowLocal) => {
		vi.stubEnv("GIT_ALLOW_PROTOCOL", "ext");
		cloneProjectRepoBare(join(root, ".git"), "https://example.invalid/project", "main", {
			allowLocal,
			interactive: false,
		});
		for (const call of mocked.mock.calls) {
			if (!(call[1] as string[]).includes("clone")) continue;
			expect(call[1]).toEqual(
				expect.arrayContaining(["core.fsmonitor=false", "core.hooksPath=/dev/null"]),
			);
		}
		// `check-ref-format` and the core.sshCommand lookup are separate raw
		// spawns that never carry the protocol policy; only `run` calls do.
		for (const call of mocked.mock.calls.filter(
			(c) =>
				!(c[1] as string[]).includes("config") && !(c[1] as string[]).includes("check-ref-format"),
		)) {
			expect(call[1]).toEqual(
				expect.arrayContaining([
					"protocol.allow=never",
					"protocol.https.allow=always",
					"protocol.ssh.allow=always",
				]),
			);
			expect((call[1] as string[]).includes("protocol.file.allow=always")).toBe(allowLocal);
			expect(call[2]).toMatchObject({
				env: { GIT_ALLOW_PROTOCOL: allowLocal ? "https:ssh:file" : "https:ssh" },
			});
		}
	});
	it("disables credential prompts and extends an existing SSH command off-TTY", () => {
		vi.stubEnv("GIT_SSH_COMMAND", "custom-ssh -i /tmp/test-key");
		cloneProjectRepoBare(join(root, ".git"), "ssh://git@example.invalid/project", "main", {
			allowLocal: false,
			interactive: false,
		});
		expect(mocked.mock.calls[1][2]).toMatchObject({
			env: {
				GIT_TERMINAL_PROMPT: "0",
				GIT_SSH_COMMAND: "custom-ssh -i /tmp/test-key -o BatchMode=yes",
			},
			stdio: ["ignore", "pipe", "pipe"],
		});
		expect(
			mocked.mock.calls.some((call) => (call[1] as string[]).includes("core.sshCommand")),
		).toBe(false);
	});
	it("inherits progress/authentication channels on a TTY", () => {
		cloneProjectRepoBare(join(root, ".git"), "ssh://git@example.invalid/project", "main", {
			allowLocal: false,
			interactive: true,
		});
		expect(mocked.mock.calls.find((call) => (call[1] as string[]).includes("clone"))![1]).toContain(
			"--progress",
		);
		expect(
			mocked.mock.calls.find((call) => (call[1] as string[]).includes("clone"))![2],
		).toMatchObject({
			env: { GIT_TERMINAL_PROMPT: "1" },
			stdio: ["inherit", "pipe", "inherit"],
		});
	});
	it("validates the branch before creating a directory or cloning", () => {
		expect(() =>
			cloneProjectRepoBare(join(root, ".git"), "https://example.invalid/project", "$(x)"),
		).toThrow("Invalid project default branch");
		expect(existsSync(join(root, ".git"))).toBe(false);
		expect(mocked).not.toHaveBeenCalled();
	});
	it("falls back to the remote HEAD branch and says so", () => {
		mocked.mockImplementation((_command: string, args: readonly string[] = []) => {
			if (args.includes("ls-remote"))
				return result({ stdout: "ref: refs/heads/trunk\tHEAD\nabc123\tHEAD\n" });
			// The manifest's branch is the one verification that fails.
			if (args.includes("--verify")) {
				return args.some((arg) => arg.includes("gone-branch"))
					? result({ status: 1, stderr: "" })
					: result();
			}
			return result();
		});
		const cloned = cloneProjectRepoBare(
			join(root, ".git"),
			"https://example.invalid/project",
			"gone-branch",
			{ allowLocal: false, interactive: false },
		);
		expect(cloned).toEqual({ branch: "trunk", requestedBranch: "gone-branch", fellBack: true });
		const head = mocked.mock.calls.find((call) => (call[1] as string[]).includes("symbolic-ref"))!;
		expect(head[1]).toContain("refs/heads/trunk");
	});
	it("keeps the requested branch when the remote really has it", () => {
		const cloned = cloneProjectRepoBare(
			join(root, ".git"),
			"https://example.invalid/project",
			"main",
			{
				allowLocal: false,
				interactive: false,
			},
		);
		expect(cloned).toEqual({ branch: "main", requestedBranch: "main", fellBack: false });
		expect(mocked.mock.calls.some((call) => (call[1] as string[]).includes("ls-remote"))).toBe(
			false,
		);
	});
	it("refuses when neither the branch nor a remote HEAD exists", () => {
		mocked.mockImplementation((_command: string, args: readonly string[] = []) => {
			// The remote answers, but with no HEAD symref at all.
			if (args.includes("ls-remote")) return result({ stdout: "" });
			if (args.includes("--verify")) return result({ status: 1, stderr: "" });
			return result();
		});
		expect(() =>
			cloneProjectRepoBare(join(root, ".git"), "https://example.invalid/project", "gone-branch", {
				allowLocal: false,
				interactive: false,
				label: "sample",
			}),
		).toThrow(/no usable HEAD/);
		expect(existsSync(join(root, ".git"))).toBe(false);
	});
	it.each([
		{
			name: "keeps GIT_SSH_COMMAND",
			env: { GIT_SSH_COMMAND: "custom-ssh -i /tmp/test-key" },
			config: "configured-ssh",
			expect: "custom-ssh -i /tmp/test-key -o BatchMode=yes",
		},
		{
			name: "keeps the user's core.sshCommand",
			env: {},
			config: "configured-ssh -F /tmp/ssh_config",
			expect: "configured-ssh -F /tmp/ssh_config -o BatchMode=yes",
		},
		{
			name: "leaves a GIT_SSH wrapper alone",
			env: { GIT_SSH: "wrapper-ssh" },
			config: "configured-ssh",
			expect: undefined,
		},
	])("$name off a TTY", ({ env, config, expect: expected }) => {
		for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
		mocked.mockImplementation((_command: string, args: readonly string[] = []) =>
			args.includes("core.sshCommand") ? result({ stdout: `${config}\n` }) : result(),
		);
		cloneProjectRepoBare(join(root, ".git"), "ssh://git@example.invalid/project", "main", {
			allowLocal: false,
			interactive: false,
		});
		const cloneCall = mocked.mock.calls.find((call) => (call[1] as string[]).includes("clone"))!;
		const command = (cloneCall[2] as { env: NodeJS.ProcessEnv }).env.GIT_SSH_COMMAND;
		if (expected === undefined) expect(command).toBeUndefined();
		else expect(command).toBe(expected);
		if (env.GIT_SSH)
			expect((cloneCall[2] as { env: NodeJS.ProcessEnv }).env.GIT_SSH).toBe("wrapper-ssh");
	});
	it("defaults to BatchMode-only SSH when the user configured none", () => {
		cloneProjectRepoBare(join(root, ".git"), "ssh://git@example.invalid/project", "main", {
			allowLocal: false,
			interactive: false,
		});
		const cloneCall = mocked.mock.calls.find((call) => (call[1] as string[]).includes("clone"))!;
		expect((cloneCall[2] as { env: NodeJS.ProcessEnv }).env.GIT_SSH_COMMAND).toBe(
			"ssh -o BatchMode=yes",
		);
	});
	it("quotes git's own reason with the slug and a credential-free url", () => {
		mocked.mockImplementation((_command: string, args: readonly string[] = []) =>
			args.includes("clone")
				? result({
						status: 128,
						stderr: "fatal: unable to access https://user:hunter2@example.invalid/x/",
					})
				: result(),
		);
		try {
			cloneProjectRepoBare(
				join(root, ".git"),
				"https://user:hunter2@example.invalid/project",
				"main",
				{
					allowLocal: false,
					interactive: false,
					label: "alpha",
				},
			);
			throw new Error("should refuse");
		} catch (error) {
			const message = String(error);
			expect(message).toContain("alpha");
			expect(message).toContain("[redacted]");
			expect(message).toContain("unable to access");
			expect(message).not.toContain("hunter2");
		}
	});
	it("cleans up only its own failed clone, without relaying credential-bearing stderr", () => {
		mocked
			.mockReturnValueOnce(result())
			.mockReturnValue(result({ status: 1, stderr: "fatal https://u:password@example.invalid" }));
		expect(() =>
			cloneProjectRepoBare(join(root, ".git"), "https://example.invalid/project", "main"),
		).toThrow(/git said|Credential prompts are disabled/);
		expect(existsSync(join(root, ".git"))).toBe(false);
	});
});
