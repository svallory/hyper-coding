/**
 * `hyper machine setup`, spawned as the real CLI.
 *
 * These are the command's contracts with the outside world, which is the only
 * place they can be checked: a non-interactive terminal can't answer a prompt,
 * so a command that forgets to handle that fails loudly in CI and hangs a user.
 * That's the case the `--features` error exists for.
 *
 * The runner's own behaviour is covered in machine-runner.test.ts; what's pinned
 * here is the wiring — flag parsing, the non-TTY error, and the report the user
 * actually reads.
 */

import { type SpawnSyncReturns, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
	DEFAULT_ROOT_CHOICE,
	exitCodeFor,
	PENDING_ROOT_EXIT,
	pendingRootMessage,
	ROOT_CHOICE_OPTIONS,
	rootPrompt,
} from "#commands/machine/setup";
import { blockInstallers } from "#tests/offline-installers";
import { withTempConfig } from "#tests/tmp-config";

const cli = join(import.meta.dirname, "..", "..", "cli", "bin", "run.js");

/**
 * Colour off, for the reason space.test.ts documents: vitest forces FORCE_COLOR
 * and CI runners are narrow, so a coloured gutter lands inside the sentence
 * every assertion here is about.
 */
const spawnCli = (args: string[], env: Record<string, string> = {}): SpawnSyncReturns<string> => {
	const bin = scratchDir();
	blockInstallers(bin);
	// The no-op test must not depend on a system copy tool or produce root work.
	writeFileSync(join(bin, "rsync"), "#!/bin/sh\necho 'rsync version 99.0.0'\n", { mode: 0o755 });
	return spawnSync(process.execPath, [cli, ...args], {
		encoding: "utf8",
		env: {
			...process.env,
			AI_AGENT: undefined,
			CLAUDECODE: undefined,
			NO_COLOR: "1",
			FORCE_COLOR: "0",
			...env,
			// Never let a setup subprocess inspect hooks or install into the real home.
			HOME: scratchDir(),
			CLAUDE_CONFIG_DIR: scratchDir(),
			PATH: `${bin}:${env.PATH ?? process.env.PATH ?? "/usr/bin:/bin"}`,
		},
	});
};

// 27 is ESC, built via fromCharCode so the regex holds no literal control char.
const ANSI_RE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
const stripAnsi = (s: string): string => s.replace(ANSI_RE, "");
const flat = (s: string): string =>
	stripAnsi(s)
		.replace(/^\s*›\s*/gm, " ")
		.replace(/\s+/g, " ")
		.trim();

function skipIfUnbuilt(): boolean {
	if (
		existsSync(cli) &&
		existsSync(join(import.meta.dirname, "..", "dist", "services", "machine", "runner.js"))
	) {
		return false;
	}
	expect.skip("cli/drive not built (run `bun run build` in drive and cli first)");
	return true;
}

const CONFIG = 'remote = "git@example:x.git"\n';

/** A scratch dir that cleans up after itself, rather than a path into the space. */
function scratchDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "drive-setup-scratch-"));
	tempDirs.push(dir);
	return dir;
}
const tempDirs: string[] = [];

afterAll(() => {
	for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

describe("machine setup", () => {
	it("`setup --features tools --yes` on a machine that needs nothing: exit 0 and says so (C-15)", () => {
		if (skipIfUnbuilt()) return;
		withTempConfig(CONFIG);
		const scratch = scratchDir();
		const r = spawnCli(["machine", "setup", "--features", "tools", "--yes"], {
			HYPER_MACHINE_SCRATCH: scratch,
		});

		expect(r.status).toBe(0);
		expect(flat(r.stdout)).toContain("Nothing needed");
		expect(flat(r.stdout)).toContain("no hooks found");
		expect(flat(r.stdout)).not.toContain("doing it now");
		expect(flat(r.stdout)).not.toContain("tools.path");
		expect(flat(r.stdout)).toContain("99.0.0"); // the stub, never the host binary
		// The empty isolated hooks select no tool tasks, so nothing was written.
		expect(existsSync(join(scratch, "hyper-machine-root.sh"))).toBe(false);
	});

	it("without --features and no TTY: a friendly error naming the flag, not a stack", () => {
		if (skipIfUnbuilt()) return;
		withTempConfig(CONFIG);
		// stdin/stdout are pipes here, which is exactly what CI and a pipe give us.
		const r = spawnCli(["machine", "setup"]);

		expect(r.status).not.toBe(0);
		expect(flat(r.stderr)).toContain("--features");
		expect(flat(r.stderr)).toContain("interactive terminal");
		// The message must not send the user to --yes: with no machine named and no
		// config entry, there are no defaults for it to take, and the only fix is
		// the flag this message already names.
		expect(flat(r.stderr)).not.toContain("--yes");
	});

	it("`setup --yes` works without a terminal: that's the case it exists for", () => {
		if (skipIfUnbuilt()) return;
		withTempConfig(CONFIG);
		// Pipes for stdin/stdout, exactly as CI sees it. --yes picks the defaults
		// (`tools` locally) without asking, so gating it on a TTY made the one
		// invocation that matters — the unattended one — the one that failed.
		const r = spawnCli(["machine", "setup", "--yes"]);

		expect(r.status).toBe(0);
		expect(flat(r.stdout)).toContain("Nothing needed");
		expect(flat(r.stdout)).toContain("no hooks found");
		expect(flat(r.stdout)).not.toContain("doing it now");
		expect(flat(r.stdout)).not.toContain("tools.path");
		// Locally the default is `tools`, which is why the noop task was checked.
		expect(flat(r.stdout)).toContain("noop.check");
	});

	it.each([
		[null, 0, null],
		["/tmp/root.sh", 0, 3],
		[null, 1, 4],
		["/tmp/root.sh", 1, 4],
	] as const)("exit precedence: pending=%s failures=%s -> %s", (pending, failed, expected) => {
		expect(exitCodeFor(pending, failed)).toBe(expected);
	});

	it("the root prompt offers exactly three answers, defaulting to 'I've run it'", () => {
		// Asserted against the exported list rather than by driving the prompt: the
		// order and the initial value are the C-6 guarantee that pressing enter
		// never asks for a password, and that is invisible from running the command.
		expect(ROOT_CHOICE_OPTIONS.map((option) => option.value)).toEqual([
			"ran",
			"run-for-me",
			"skip",
		]);
		expect(ROOT_CHOICE_OPTIONS.map((option) => option.label)).toEqual([
			"I've run it",
			"Run it for me (asks for your password)",
			"Skip",
		]);
		expect(DEFAULT_ROOT_CHOICE).toBe("ran");
		expect(DEFAULT_ROOT_CHOICE).toBe(ROOT_CHOICE_OPTIONS[0].value);
	});

	it("without a terminal the root prompt skips, reports the path, and exits 3", async () => {
		// The decision extracted into rootPrompt()/exitCodeFor(), tested directly:
		// no shipped task needs root yet, so the spawned CLI cannot reach this end
		// to end. This is the branch that used to hang, so it matters most.
		const seen: string[] = [];
		const prompt = rootPrompt(false, (path) => seen.push(path));
		const answer = await prompt.rootChoice({
			machine: "netcup",
			path: "/tmp/hyper-machine-root.sh",
			tasks: ["agent-user.create"],
		});

		expect(answer).toBe("skip");
		expect(seen).toEqual(["/tmp/hyper-machine-root.sh"]);
		expect(exitCodeFor("/tmp/hyper-machine-root.sh")).toBe(PENDING_ROOT_EXIT);
		expect(PENDING_ROOT_EXIT).toBe(3);
		// And a run that left nothing pending is not an error at all.
		expect(exitCodeFor(null)).toBeNull();

		const message = pendingRootMessage("netcup", "/tmp/hyper-machine-root.sh");
		expect(message).toContain("netcup");
		expect(message).toContain("/tmp/hyper-machine-root.sh");
		expect(message).toContain("still need root");
		expect(message).toContain("Nothing was run");
	});

	it("an unknown feature is rejected by name", () => {
		if (skipIfUnbuilt()) return;
		withTempConfig(CONFIG);
		const r = spawnCli(["machine", "setup", "--features", "nope"]);

		// 2, not just non-zero: this is a user error the caller can fix.
		expect(r.status).toBe(2);
		expect(flat(r.stderr)).toContain("nope");
		expect(flat(r.stderr)).toContain("docker-rootless");
	});

	it("an unknown machine names the machines that do exist", () => {
		if (skipIfUnbuilt()) return;
		withTempConfig(`${CONFIG}\n[machines.netcup]\nhome = "/home/svallory"\n`);
		const r = spawnCli(["machine", "setup", "nope", "--features", "tools"]);

		expect(r.status).not.toBe(0);
		expect(flat(r.stderr)).toContain("nope");
		expect(flat(r.stderr)).toContain("netcup");
	});
});
