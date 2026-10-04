import { type SpawnSyncReturns, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	cloneProjectRepoBare,
	describeReviewPaths,
	escapeControlCharacters,
	quoteChildOutput,
	redactGitSecrets,
	reviewPathClass,
	sanitizeForTerminal,
} from "#services/space-git";

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
	it("disables credential prompts off-TTY and leaves a non-ssh command alone", () => {
		vi.stubEnv("GIT_SSH_COMMAND", "custom-ssh -i /tmp/test-key");
		cloneProjectRepoBare(join(root, ".git"), "ssh://git@example.invalid/project", "main", {
			allowLocal: false,
			interactive: false,
		});
		// A wrapper need not understand `-o`, so nothing is inserted.
		expect(
			mocked.mock.calls.find((call) => (call[1] as string[]).includes("clone"))![2],
		).toMatchObject({
			env: { GIT_TERMINAL_PROMPT: "0", GIT_SSH_COMMAND: "custom-ssh -i /tmp/test-key" },
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
	it("refuses when the remote names a HEAD branch that does not exist locally", () => {
		mocked.mockImplementation((_command: string, args: readonly string[] = []) => {
			if (args.includes("ls-remote"))
				return result({ stdout: "ref: refs/heads/other\tHEAD\nabc123\tHEAD\n" });
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
	it("says an empty advertisement means the repository has no commits", () => {
		mocked.mockImplementation((_command: string, args: readonly string[] = []) => {
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
		).toThrow(/no commits yet/);
	});
	it("refuses a HEAD branch name hyper could not have chosen", () => {
		mocked.mockImplementation((_command: string, args: readonly string[] = []) => {
			if (args.includes("ls-remote"))
				return result({ stdout: "ref: refs/heads/evil$(x)\tHEAD\nabc123\tHEAD\n" });
			// The manifest's branch is missing, so the fallback path is taken.
			if (args.includes("--verify")) return result({ status: 1, stderr: "" });
			return result();
		});
		expect(() =>
			cloneProjectRepoBare(join(root, ".git"), "https://example.invalid/project", "gone-branch", {
				allowLocal: false,
				interactive: false,
			}),
		).toThrow(/cannot use/);
		expect(existsSync(join(root, ".git"))).toBe(false);
	});
	it.each([
		{
			name: "leaves a non-ssh GIT_SSH_COMMAND alone",
			env: { GIT_SSH_COMMAND: "custom-ssh -i /tmp/test-key" },
			config: "configured-ssh",
			expect: "custom-ssh -i /tmp/test-key",
		},
		{
			name: "inserts BatchMode right after an ssh command",
			env: { GIT_SSH_COMMAND: "ssh -o BatchMode=no" },
			config: "",
			expect: "ssh -o BatchMode=yes -o BatchMode=no",
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
	it.each([
		["https://user:password-value@example.invalid/project", "password-value"],
		["https://host.invalid/x?token=SECRETTOKEN", "SECRETTOKEN"],
		["https://host.invalid/x?a=1&sig=SECRETSIG", "SECRETSIG"],
		["https://user:hunter2@example.invalid/repo", "hunter2"],
	])("redacts %s", (value, secret) => {
		expect(redactGitSecrets(value)).not.toContain(secret);
	});
	it.each([
		// An `@` in the PATH is not userinfo: masking it would invent a host
		// the user never configured and hide where they were actually cloning.
		["https://host.invalid/a@b/c", "https://host.invalid/a@b/c"],
		["git@host.invalid:x", "git@host.invalid:x"],
		["no credentials here at all", "no credentials here at all"],
		[
			"fatal: could not read from git@host.invalid:org/repo.git",
			"fatal: could not read from git@host.invalid:org/repo.git",
		],
	])("leaves %s exactly as written", (value, expected) => {
		expect(redactGitSecrets(value)).toBe(expected);
	});
	it.each([
		// Two urls on one line: the second used to slip through, because only
		// the authority after the FIRST `://` was examined.
		[
			"fatal: https://user:first-password-value@example.invalid/x and https://user:second-password-value@example.invalid/y",
			"fatal: https://[redacted]@example.invalid/x and https://[redacted]@example.invalid/y",
		],
		// A url in the middle of a sentence, followed by more prose.
		[
			"remote: could not reach https://alice:password-value@example.invalid/repo.git today, retrying",
			"remote: could not reach https://[redacted]@example.invalid/repo.git today, retrying",
		],
		// An unencoded `@` inside the password is still userinfo.
		[
			"fatal: https://user:prefix@password-value@example.invalid/r",
			"fatal: https://[redacted]@example.invalid/r",
		],
		// Percent-encoded userinfo is still userinfo.
		[
			"fatal: https://user%40corp:password%2Fvalue%3A@example.invalid/r",
			"fatal: https://[redacted]@example.invalid/r",
		],
		// A path `@` after a credentialed url on the same line stays put.
		[
			"https://user:password-value@example.invalid/a@b/c then https://example.invalid/a@b/c",
			"https://[redacted]@example.invalid/a@b/c then https://example.invalid/a@b/c",
		],
		// Query masking still applies, alongside userinfo.
		[
			"https://user:password-value@example.invalid/x?token=token-value https://example.invalid/y?sig=signature-value",
			"https://[redacted]@example.invalid/x?token=[redacted] https://example.invalid/y?sig=[redacted]",
		],
	])("redacts every url on the line: %s", (value, expected) => {
		expect(redactGitSecrets(value)).toBe(expected);
	});
	it("redacts per line, so a later @ cannot mask or expose another line", () => {
		const text = "fatal: user:pass1@host one\nunrelated mention of a@b here";
		const redacted = redactGitSecrets(text);
		expect(redacted).not.toContain("pass1");
		expect(redacted).toContain("unrelated mention of a@b here");
	});
	it("strips control characters but keeps newlines and tabs", () => {
		// The escape byte is gone; printable characters around it remain, which
		// is harmless: they cannot move a cursor or set a window title.
		const cleaned = sanitizeForTerminal("a\u001b]2Jb\tc\nd\u007fe\u009bf");
		expect(cleaned).toBe("a]2Jb\tc\ndef");
	});
	it.each([
		["C1 CSI", "[2J"],
		["bidi override", "a‮gnp.sh"],
		["DEL", "ab"],
		["ESC", "ab"],
		["zero-width joiner", "a‍b"],
	])("escapes %s rather than printing it", (_name, raw) => {
		// `JSON.stringify` escapes C0 only, which is precisely why this
		// function exists: these bytes used to reach the terminal raw.
		const expected = raw.replace(
			/[\p{Cc}\p{Cf}]/gu,
			(c) => `\\u${c.codePointAt(0)!.toString(16).padStart(4, "0")}`,
		);
		expect(escapeControlCharacters(raw)).toBe(expected);
		expect(escapeControlCharacters(raw)).not.toBe(raw);
	});
	it("caps one quoted child line and says that it cut it", () => {
		const quoted = quoteChildOutput(`git: ${"x".repeat(9_000)}`);
		expect(quoted.length).toBeLessThan(2_100);
		expect(quoted).toContain("[truncated]");
	});
	it("leaves a short quoted line untouched", () => {
		expect(quoteChildOutput("fatal: not a git repository")).toBe(
			"git: fatal: not a git repository",
		);
	});
	it("names the count, the first 20 paths, and points at --json", () => {
		// Zero-padded so the alphabetical order within one class is the
		// numeric one: the list is now sorted inside each risk class rather
		// than kept in input order (the previous version of this test relied on
		// input order).
		const many = Array.from(
			{ length: 251 },
			(_, index) => `bin/tool-${String(index).padStart(3, "0")}.sh`,
		);
		const described = describeReviewPaths(many);
		expect(described).toContain('"bin/tool-000.sh"');
		expect(described).toContain('"bin/tool-019.sh"');
		expect(described).not.toContain('"bin/tool-020.sh"');
		expect(described).toContain("and 231 more: 231 executables");
		expect(described).toContain("--json");
	});
	it("ranks settings, executables, symlinks and instructions ahead of the rest before cutting", () => {
		// The review's reproduction: 25 command files sort before everything
		// dangerous, so an alphabetical cut hid settings, payload and hooks.
		const commands = Array.from(
			{ length: 25 },
			(_, index) => `.claude/commands/a${String(index + 1).padStart(2, "0")}.md`,
		);
		const paths = [
			...commands,
			".claude/settings.json",
			".hyper/hooks.sh",
			"bin/payload",
			"data/run.sh",
			"notes/link",
			"notes/readme.txt",
		].sort();
		const facts = new Map([
			["data/run.sh", { executable: true, symlink: false, throughLink: false }],
			["notes/link", { executable: false, symlink: true, throughLink: false }],
			["bin/payload", { executable: true, symlink: false, throughLink: false }],
		]);
		const described = describeReviewPaths(paths, facts);
		const named = (described.match(/"[^"]+"/g) ?? []).map((quoted) => quoted.slice(1, -1));
		expect(named.slice(0, 6)).toEqual([
			".claude/settings.json",
			".hyper/hooks.sh",
			"bin/payload",
			"data/run.sh",
			"notes/link",
			".claude/commands/a01.md",
		]);
		expect(named).toHaveLength(20);
		expect(named).not.toContain("notes/readme.txt");
		expect(described).toContain("and 11 more: 10 instruction files, 1 other file; run with --json");
		// The input — what `--json` prints — is left exactly as it was.
		expect(paths[0]).toBe(".claude/commands/a01.md");
	});
	it.each([
		[".claude/settings.local.json", 0],
		[".claude/hooks/pre.sh", 0],
		[".config/wt.toml", 0],
		[".vscode/settings.json", 0],
		[".cursor/rules.json", 0],
		[".codex/config.toml", 0],
		[".pi/settings.json", 0],
		[".hyper/post-merge-hook", 0],
		["bin/tool", 1],
		["CLAUDE.md", 3],
		["sub/AGENTS.md", 3],
		[".claude/skills/x/SKILL.md", 3],
		[".claude/agents/reviewer.md", 3],
		[".hyper/memory/MEMORY.md", 3],
		[".cursor/notes.md", 3],
		["notes/plain.txt", 4],
	])("classifies %s as risk class %i", (path, rank) => {
		expect(reviewPathClass(path)).toBe(rank);
	});
	it("says so plainly when nothing is hidden", () => {
		expect(describeReviewPaths(["bin/a.sh"])).toBe(
			'"bin/a.sh": these came from the hyperdrive; review before trusting this space.',
		);
	});
	it("cleans up only its own failed clone, without relaying credential-bearing stderr", () => {
		mocked
			.mockReturnValueOnce(result())
			.mockReturnValue(
				result({ status: 1, stderr: "fatal https://user:secret-password@example.invalid/x" }),
			);
		let message = "";
		try {
			cloneProjectRepoBare(
				join(root, ".git"),
				"https://user:secret-password@example.invalid/x",
				"main",
			);
			throw new Error("should refuse");
		} catch (error) {
			message = String(error);
		}
		// The test's title has always claimed this; assert it properly. The
		// secret must be absent from the whole message, not merely unmatched by
		// a loose regex.
		expect(message).not.toContain("secret-password");
		expect(message).toContain("[redacted]");
		expect(existsSync(join(root, ".git"))).toBe(false);
	});
});
