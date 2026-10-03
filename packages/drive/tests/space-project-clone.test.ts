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
		for (const call of mocked.mock.calls.slice(1)) {
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
	});
	it("inherits progress/authentication channels on a TTY", () => {
		cloneProjectRepoBare(join(root, ".git"), "ssh://git@example.invalid/project", "main", {
			allowLocal: false,
			interactive: true,
		});
		expect(mocked.mock.calls[1][1]).toContain("--progress");
		expect(mocked.mock.calls[1][2]).toMatchObject({
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
	it("cleans up only its own failed clone, without relaying credential-bearing stderr", () => {
		mocked
			.mockReturnValueOnce(result())
			.mockReturnValue(result({ status: 1, stderr: "fatal https://u:password@example.invalid" }));
		expect(() =>
			cloneProjectRepoBare(join(root, ".git"), "https://example.invalid/project", "main"),
		).toThrow("Credential prompts are disabled");
		expect(existsSync(join(root, ".git"))).toBe(false);
	});
});
