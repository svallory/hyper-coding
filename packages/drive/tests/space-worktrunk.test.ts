import { type SpawnSyncReturns, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SpaceGitInterruptedError } from "#services/space-git";
import { spaceWorktrunkWarning } from "#services/space-worktrunk";

vi.mock("node:child_process", () => ({ spawnSync: vi.fn() }));
let root: string;
const correct = "{{ repo_path }}/../worktrees/{{ branch | sanitize }}";
const wrong = "{{ repo_path }}/../custom/{{ branch | sanitize }}";
const mockedSpawn = vi.mocked(spawnSync);
function result(overrides: Partial<SpawnSyncReturns<string>> = {}): SpawnSyncReturns<string> {
	return { pid: 1, output: [], stdout: "", stderr: "", status: 0, signal: null, ...overrides };
}

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "hyper-clone-wt-"));
	const home = join(root, "home");
	mkdirSync(home);
	for (const [key, value] of Object.entries({
		HOME: home,
		HYPER_HOME: join(home, ".hyper"),
		HYPER_DRIVE_CONFIG: join(home, "drive.toml"),
		XDG_CONFIG_HOME: join(home, ".config"),
		WORKTRUNK_CONFIG_PATH: join(home, ".config", "worktrunk", "config.toml"),
	}))
		vi.stubEnv(key, value);
	vi.stubEnv("WORKTRUNK_WORKTREE_PATH", undefined);
	mockedSpawn.mockReset();
});
afterEach(() => {
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
	rmSync(root, { recursive: true, force: true });
});

/** Only wt evaluates templates; the service must never spawn a shell or git. */
function configuration(user: object = {}, system: object = {}): string[] {
	const evaluated: string[] = [];
	mockedSpawn.mockImplementation((binary, args) => {
		expect(binary).toBe("wt");
		const argv = args as string[];
		if (argv.includes("show"))
			return result({
				stdout: JSON.stringify({
					user: { path: process.env.WORKTRUNK_CONFIG_PATH, config: user },
					system: { config: system },
					project: { identifier: "github.com/team/project" },
				}),
			});
		expect(argv).toContain("eval");
		const template = argv.at(-1)!;
		evaluated.push(template);
		return result({
			stdout: JSON.stringify({
				result: join(root, template === correct ? "worktrees/main" : "custom/main"),
			}),
		});
	});
	return evaluated;
}

describe("read-only worktrunk placement advice", () => {
	it("uses system defaults and user global overrides", () => {
		configuration({}, { "worktree-path": correct });
		expect(spaceWorktrunkWarning(root)).toBeNull();
		configuration({ "worktree-path": wrong }, { "worktree-path": correct });
		expect(spaceWorktrunkWarning(root)).toContain(join(root, "custom/main"));
	});
	it("lets exact project settings beat wildcard settings and global defaults", () => {
		const evaluated = configuration({
			"worktree-path": wrong,
			projects: {
				"github.com/*": { "worktree-path": wrong },
				"github.com/team/*": { "worktree-path": wrong },
				"github.com/team/project": { "worktree-path": correct },
			},
		});
		expect(spaceWorktrunkWarning(root)).toBeNull();
		expect(evaluated).toEqual([correct, correct]);
	});
	it("honours the environment path override without changing any settings", () => {
		configuration({ "worktree-path": correct });
		vi.stubEnv("WORKTRUNK_WORKTREE_PATH", wrong);
		const warning = spaceWorktrunkWarning(root);
		expect(warning).toContain(join(root, "custom/main"));
		expect(warning).toContain("Unset or update WORKTRUNK_WORKTREE_PATH first");
	});
	it.each(["missing", "old", "malformed", "timeout"])(
		"warns, rather than failing the clone, when wt is %s",
		(kind) => {
			mockedSpawn.mockReturnValue(
				result(
					kind === "malformed"
						? { stdout: "not json" }
						: kind === "timeout"
							? { error: new Error("timeout"), signal: "SIGKILL", status: null }
							: { error: new Error(kind), status: 1 },
				),
			);
			expect(spaceWorktrunkWarning(root)).toContain("couldn't verify worktrunk placement");
			expect(spaceWorktrunkWarning(root)).toContain(`worktree-path = ${JSON.stringify(correct)}`);
			expect(mockedSpawn.mock.calls[0][2]).toMatchObject({
				timeout: 10_000,
				killSignal: "SIGKILL",
			});
		},
	);
	it.each(["SIGINT", "SIGTERM"] as const)(
		"propagates a real %s instead of swallowing it as optional advice",
		(signal) => {
			mockedSpawn.mockReturnValue(result({ signal, status: null }));
			expect(() => spaceWorktrunkWarning(root)).toThrow(SpaceGitInterruptedError);
		},
	);
});
