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
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { PENDING_ROOT_EXIT, pendingRootMessage } from "#commands/machine/setup";
import { withTempConfig } from "#tests/tmp-config";

const cli = join(import.meta.dirname, "..", "..", "cli", "bin", "run.js");

/**
 * Colour off, for the reason space.test.ts documents: vitest forces FORCE_COLOR
 * and CI runners are narrow, so a coloured gutter lands inside the sentence
 * every assertion here is about.
 */
const spawnCli = (args: string[], env: Record<string, string> = {}): SpawnSyncReturns<string> =>
	spawnSync(process.execPath, [cli, ...args], {
		encoding: "utf8",
		env: {
			...process.env,
			AI_AGENT: undefined,
			CLAUDECODE: undefined,
			NO_COLOR: "1",
			FORCE_COLOR: "0",
			...env,
		},
	});

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
		// The one shipped task is already satisfied, so nothing was written.
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

	it("`setup --yes` locally still needs --features, and says why", () => {
		if (skipIfUnbuilt()) return;
		withTempConfig(CONFIG);
		const r = spawnCli(["machine", "setup", "--yes"]);

		expect(r.status).not.toBe(0);
		expect(flat(r.stderr)).toContain("--features");
	});

	it("unattended root work: exit 3 and a message naming the script", () => {
		if (skipIfUnbuilt()) return;
		withTempConfig(CONFIG);
		// No root task ships yet, so the command can't reach this path end to end
		// from the CLI alone — which is exactly why these two are pinned directly.
		// The end-to-end version arrives with T-16's real root tasks.
		expect(PENDING_ROOT_EXIT).toBe(3);
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

		expect(r.status).not.toBe(0);
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
