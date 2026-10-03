/**
 * `hyper machine add`, spawned as the real CLI against a fake Herdr.
 *
 * The order this command gets right is Herdr first, config second, and these
 * tests exist mostly to hold that line: a machine the CLI happily writes but
 * can't connect to is one the user discovers later, from an error that mentions
 * Herdr rather than what they just ran. So the unknown-name case must fail with
 * `addHint`, and must not have touched the config file.
 */

import { type SpawnSyncReturns, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { withTempConfig } from "#tests/tmp-config";

const cli = join(import.meta.dirname, "..", "..", "cli", "bin", "run.js");

const HERDR_JSON = JSON.stringify([
	{ label: "netcup", target: "user@host", enabled: true },
	{ label: "spare", target: "user@spare", enabled: true },
]);

const saved = { path: process.env.PATH, config: process.env.HYPER_DRIVE_CONFIG };
afterEach(() => {
	if (saved.path === undefined) delete process.env.PATH;
	else process.env.PATH = saved.path;
	if (saved.config === undefined) delete process.env.HYPER_DRIVE_CONFIG;
	else process.env.HYPER_DRIVE_CONFIG = saved.config;
});

/**
 * A fake `herdr` on PATH that knows `json`. PATH is prepended rather than
 * replaced so `node` and the rest of the CLI still resolve.
 */
function fakeHerdr(json = HERDR_JSON): string {
	const dir = mkdtempSync(join(tmpdir(), "drive-add-herdr-"));
	const script = join(dir, "herdr");
	writeFileSync(script, `#!/bin/sh\ncat <<'JSON'\n${json}\nJSON\n`, "utf-8");
	chmodSync(script, 0o755);
	process.env.PATH = `${dir}:${saved.path ?? ""}`;
	return dir;
}

const spawnCli = (args: string[]): SpawnSyncReturns<string> =>
	spawnSync(process.execPath, [cli, ...args], {
		encoding: "utf8",
		env: {
			...process.env,
			AI_AGENT: undefined,
			CLAUDECODE: undefined,
			NO_COLOR: "1",
			FORCE_COLOR: "0",
		},
	});

const ANSI_RE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
const flat = (s: string): string =>
	s
		.replace(ANSI_RE, "")
		.replace(/^\s*›\s*/gm, " ")
		.replace(/\s+/g, " ")
		.trim();

function skipIfUnbuilt(): boolean {
	if (
		existsSync(cli) &&
		existsSync(join(import.meta.dirname, "..", "dist", "commands", "machine", "add.js"))
	) {
		return false;
	}
	expect.skip("cli/drive not built (run `bun run build` in drive and cli first)");
	return true;
}

describe("machine add", () => {
	it("writes [machines.<name>] for a machine Herdr knows", () => {
		if (skipIfUnbuilt()) return;
		fakeHerdr();
		const configPath = withTempConfig('remote = "git@example:x.git"\n');
		const before = readFileSync(configPath, "utf-8");

		const r = spawnCli([
			"machine",
			"add",
			"netcup",
			"--home",
			"/home/svallory",
			"--features",
			"tools,docker-rootless",
		]);

		expect(r.status).toBe(0);
		const written = readFileSync(configPath, "utf-8");
		expect(written).toContain("[machines.netcup]");
		expect(written).toContain("/home/svallory");
		expect(written).toContain("tools");
		expect(written).toContain("docker-rootless");
		// The parts that were already there survive the write.
		expect(written).toContain("git@example:x.git");
		expect(before).not.toContain("netcup");
		expect(flat(r.stdout)).toContain("netcup");
	});

	it("records the agent user, defaulting to `agent`", () => {
		if (skipIfUnbuilt()) return;
		fakeHerdr();
		const configPath = withTempConfig('remote = "git@example:x.git"\n');

		expect(spawnCli(["machine", "add", "spare", "--agent-user", "agent"]).status).toBe(0);
		expect(readFileSync(configPath, "utf-8")).toContain('agent_user = "agent"');

		expect(spawnCli(["machine", "add", "spare", "--agent-user", "bot"]).status).toBe(0);
		expect(readFileSync(configPath, "utf-8")).toContain('agent_user = "bot"');
	});

	it("re-running add with one flag changes only that field", () => {
		if (skipIfUnbuilt()) return;
		fakeHerdr();
		const configPath = withTempConfig('remote = "git@example:x.git"\n');

		expect(
			spawnCli(["machine", "add", "netcup", "--home", "/home/svallory", "--features", "tools"])
				.status,
		).toBe(0);
		const first = readFileSync(configPath, "utf-8");
		expect(first).toContain("/home/svallory");

		// The hints below tell people to fix one field at a time, so a second run
		// that omitted --home must not blank it out.
		expect(spawnCli(["machine", "add", "netcup", "--agent-user", "bob"]).status).toBe(0);
		const second = readFileSync(configPath, "utf-8");
		expect(second).toContain("/home/svallory");
		expect(second).toContain("tools");
		expect(second).toContain('agent_user = "bob"');
	});

	it("writes every key of the config, defaults included", () => {
		if (skipIfUnbuilt()) return;
		fakeHerdr();
		const configPath = withTempConfig('remote = "git@example:x.git"\n');

		expect(spawnCli(["machine", "add", "netcup", "--home", "/home/svallory"]).status).toBe(0);
		const written = readFileSync(configPath, "utf-8");
		// The file is a complete config a human can read, not a diff needing the
		// code that wrote it.
		expect(written).toContain("remote");
		expect(written).toContain("[warp]");
		expect(written).toContain("[machines.netcup]");
	});

	it("a second --features replaces the list rather than adding to it", () => {
		if (skipIfUnbuilt()) return;
		fakeHerdr();
		const configPath = withTempConfig('remote = "git@example:x.git"\n');

		expect(spawnCli(["machine", "add", "netcup", "--features", "tools"]).status).toBe(0);
		expect(spawnCli(["machine", "add", "netcup", "--features", "docker-rootless"]).status).toBe(0);

		// Appending would leave the file claiming the machine has a feature the
		// user just removed.
		const written = readFileSync(configPath, "utf-8");
		expect(written).toContain("docker-rootless");
		expect(written).not.toContain('"tools"');
	});

	it("rejects a feature that isn't one", () => {
		if (skipIfUnbuilt()) return;
		fakeHerdr();
		const configPath = withTempConfig('remote = "git@example:x.git"\n');

		const r = spawnCli(["machine", "add", "netcup", "--features", "bogus"]);
		// 2, not 1: a typo the user can fix is not a crash, and an unhandled throw
		// here would print a MachineError: prefix and a stack.
		expect(r.status).toBe(2);
		expect(flat(r.stderr)).toContain("bogus");
		expect(flat(r.stderr)).toContain("docker-rootless");
		expect(flat(r.stderr)).not.toContain("MachineError:");
		expect(flat(r.stderr)).not.toContain("at MachineAdd");
		// A typo must not become a feature nothing will ever pick up.
		expect(readFileSync(configPath, "utf-8")).not.toContain("bogus");
	});

	it("creates the config when there isn't one yet", () => {
		if (skipIfUnbuilt()) return;
		fakeHerdr();
		// A path that does not exist: no drive.toml at all, so the write has to
		// start from the schema defaults and create every parent it needs.
		const dir = mkdtempSync(join(tmpdir(), "drive-nofile-"));
		process.env.HYPER_DRIVE_CONFIG = join(dir, "nested", "drive.toml");

		const r = spawnCli(["machine", "add", "netcup", "--home", "/home/svallory"]);
		expect(r.status).toBe(0);
		expect(existsSync(process.env.HYPER_DRIVE_CONFIG as string)).toBe(true);
		expect(readFileSync(process.env.HYPER_DRIVE_CONFIG as string, "utf-8")).toContain(
			"[machines.netcup]",
		);
	});

	it("keeps keys this version doesn't know about", () => {
		if (skipIfUnbuilt()) return;
		fakeHerdr();
		const configPath = withTempConfig(
			'remote = "git@example:x.git"\n\n[experimental]\nsparkle = true\n',
		);

		expect(spawnCli(["machine", "add", "netcup", "--home", "/home/svallory"]).status).toBe(0);
		const written = readFileSync(configPath, "utf-8");
		expect(written).toContain("sparkle");
		expect(written).toContain("[machines.netcup]");
	});

	it("an unknown name fails with addHint and writes nothing", () => {
		if (skipIfUnbuilt()) return;
		fakeHerdr();
		const configPath = withTempConfig('remote = "git@example:x.git"\n');

		const r = spawnCli(["machine", "add", "nosuch"]);

		expect(r.status).not.toBe(0);
		expect(flat(r.stderr)).toContain("nosuch");
		expect(flat(r.stderr)).toContain("herdr machine add");
		expect(flat(r.stderr)).toContain("--label nosuch");
		// The whole point of checking Herdr first: no entry for a machine we
		// can't connect to.
		expect(readFileSync(configPath, "utf-8")).not.toContain("nosuch");
	});

	it("says so plainly when Herdr isn't installed", () => {
		if (skipIfUnbuilt()) return;
		// PATH with no herdr on it at all: execvp fails rather than finding the
		// real one further down PATH.
		process.env.PATH = mkdtempSync(join(tmpdir(), "drive-nopath-"));
		withTempConfig('remote = "git@example:x.git"\n');

		const r = spawnCli(["machine", "add", "netcup"]);
		expect(r.status).not.toBe(0);
		expect(flat(r.stderr)).toContain("herdr");
	});
});
