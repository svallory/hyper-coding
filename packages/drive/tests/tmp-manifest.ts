import { type SpawnSyncReturns, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "vitest";
import { shellJoin, shellQuote } from "#services/remote";

export interface ManifestFixture {
	root: string;
	remote: string;
	home: string;
	hyperHome: string;
	configFile: string;
	cleanup(): void;
}

export function git(args: string[], cwd: string): string {
	const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
	delete env.GIT_DIR;
	delete env.GIT_WORK_TREE;
	const r = spawnSync("git", args, { cwd, env, encoding: "utf8" });
	if (r.status !== 0) {
		throw new Error(`git ${args.join(" ")} failed (${r.status}): ${r.stderr || r.error}`);
	}
	return r.stdout;
}

export function withManifestFixture(): ManifestFixture {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "hyperdrive-manifest-")));
	const remote = join(root, "remote.git");
	const home = join(root, "home");
	const hyperHome = join(root, "hyper-home");
	const configFile = join(root, "config", "hyper", "drive.toml");
	mkdirSync(home, { recursive: true });
	git(["init", "--bare", remote], root);
	return {
		root,
		remote,
		home,
		hyperHome,
		configFile,
		cleanup: () => removeTree(root),
	};
}

/**
 * Stop the developer's real git config from reaching a test: a global
 * `commit.gpgsign=true` with an unreachable signer would fail commits here,
 * and a real `user.email` would be recorded in test fixtures. Both are read
 * with the suite's own config, so the tests describe a fresh machine.
 *
 * `gc.auto=0` is injected through GIT_CONFIG_COUNT so every git in the test —
 * including the ones a spawned CLI runs — skips the background `git gc`, which
 * otherwise detaches and keeps writing into `.git` after the command returned.
 */
export function isolateGitConfig(): void {
	process.env.GIT_CONFIG_GLOBAL = "/dev/null";
	process.env.GIT_CONFIG_NOSYSTEM = "1";
	process.env.GIT_CONFIG_COUNT = "1";
	process.env.GIT_CONFIG_KEY_0 = "gc.auto";
	process.env.GIT_CONFIG_VALUE_0 = "0";
}

/** Synchronous pause, for the retry loop below. */
function pause(ms: number): void {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Remove a fixture tree, tolerating a git process that is still writing into
 * it. A background `gc` or a closing hook can recreate a file between the
 * directory scan and the unlink, which is `ENOTEMPTY`; that is a fact about
 * the temp directory, not a reason to fail the test that used it.
 */
function removeTree(root: string): void {
	for (let attempt = 0; attempt < 5; attempt++) {
		try {
			rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
			if (!existsSync(root)) return;
		} catch {
			// Retry below; a leftover temp dir must never fail a test.
		}
		pause(200);
	}
}

const cli = join(import.meta.dirname, "..", "..", "cli", "bin", "run.js");
const ANSI_RE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
export const flat = (s: string): string =>
	s
		.replace(ANSI_RE, "")
		.replace(/^\s*›\s*/gm, " ")
		.replace(/\s+/g, " ")
		.trim();

export function spawnCli(args: string[], fixture: ManifestFixture): SpawnSyncReturns<string> {
	return spawnSync(process.execPath, [cli, ...args], {
		encoding: "utf8",
		env: {
			...process.env,
			HOME: fixture.home,
			XDG_CONFIG_HOME: join(fixture.root, "config"),
			HYPER_HOME: fixture.hyperHome,
			HYPER_DRIVE_CONFIG: fixture.configFile,
			AI_AGENT: undefined,
			CLAUDECODE: undefined,
			NO_COLOR: "1",
			FORCE_COLOR: "0",
		},
	});
}

/**
 * Run the CLI under a pseudo-terminal, the only way to exercise the prompts:
 * `isTTY` is false in a pipe, so a piped spawn skips the interactive branch
 * entirely and would prove nothing about answering a prompt.
 *
 * `script` needs a real shell pipe on its own stdin — handed a socket (as
 * `spawnSync`'s `input` does) it dies with "tcgetattr/ioctl: Operation not
 * supported on socket" and the child never runs. The input is therefore fed
 * by a `(sleep …; printf …)` group on the far side of the pipe, which also
 * delivers the answers only once the CLI is actually reading: bytes written
 * before the child starts are swallowed by the terminal.
 */
export function spawnCliOnTty(
	args: string[],
	fixture: ManifestFixture,
	answers: string[],
): SpawnSyncReturns<string> {
	// \r is the key a terminal sends for Enter; \n is not what readline expects.
	// The answers are spaced apart: written all at once they arrive before the
	// CLI is reading (the terminal swallows them) or before it has finished the
	// previous prompt, and the run then waits forever for an answer that was
	// already sent.
	const feeder = answers.map((answer) => `printf '${answer}\\r'; sleep 2`).join("; ");
	const child = shellJoin([process.execPath, cli, ...args]);
	// `script` is two different programs. BSD/macOS takes the command as
	// trailing arguments:  script -q /dev/null <cmd…>
	// util-linux (Debian/Ubuntu, i.e. the GitHub runner) takes it as ONE
	// -c string:                script -q -c "<cmd…>" /dev/null
	// Passing the macOS form on Linux fails with
	// "script: unexpected number of arguments".
	const script =
		process.platform === "darwin"
			? `script -q /dev/null ${child}`
			: `script -q -c ${shellQuote(child)} /dev/null`;
	const command = `(sleep 2; ${feeder}; sleep 3) | ${script}`;
	return spawnSync("/bin/sh", ["-c", command], {
		encoding: "utf8",
		// A prompt test must never be able to wedge the whole suite: if the CLI
		// stops asking, this kills it and the assertion fails instead.
		timeout: 60_000,
		killSignal: "SIGKILL",
		env: {
			...process.env,
			HOME: fixture.home,
			XDG_CONFIG_HOME: join(fixture.root, "config"),
			HYPER_HOME: fixture.hyperHome,
			HYPER_DRIVE_CONFIG: fixture.configFile,
			NO_COLOR: "1",
			FORCE_COLOR: "0",
		},
	});
}

/**
 * Skip a test that needs `script` when the machine has none, with a reason a
 * reader can act on. Both platforms here ship it; this keeps a slim container
 * from failing for a missing tool instead of a broken test.
 *
 * `ctx.skip()`, not `expect.skip()`: vitest's expect is Chai's plus a few
 * Jest-shaped additions, and `expect.skip` is NOT one of them — calling it
 * throws `expect.skip is not a function`, so every "skip when the tool is
 * missing" path used to fail the test it was meant to skip. The context is
 * the only supported way to skip from inside a running test.
 */
export function skipWithoutScript(ctx: TestContext): boolean {
	const found = spawnSync("/bin/sh", ["-c", "command -v script"], { encoding: "utf8" });
	if (found.status === 0) return false;
	ctx.skip("`script` is not installed, so no pseudo-terminal is available for the prompt test");
	return true;
}

/**
 * Skip a CLI-spawn test when the dists it spawns are missing.
 *
 * These tests run `packages/cli/bin/run.js`, which loads `dist/` — vitest's
 * own `#services/*` imports resolve to source, so an unbuilt package fails
 * here and nowhere else. Skipped through the test context for the reason
 * documented on {@link skipWithoutScript}.
 */
export function skipIfUnbuilt(ctx: TestContext): boolean {
	if (
		existsSync(cli) &&
		existsSync(join(import.meta.dirname, "..", "dist", "services", "manifest.js"))
	) {
		return false;
	}
	ctx.skip("cli/drive not built (run `bun run build` in drive and cli first)");
	return true;
}
