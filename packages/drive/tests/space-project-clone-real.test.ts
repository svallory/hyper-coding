import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cloneProjectRepoBare } from "#services/space-git";
import { git } from "#tests/tmp-manifest";

/**
 * The ssh policy runs against real git and a fake `ssh` that records the
 * arguments git actually passes it. Mocking `spawnSync` cannot answer the
 * question that matters: ssh honours the FIRST value of a repeated option, so
 * where BatchMode lands decides whether it applies at all.
 */
let root: string;
let recorder: string;
/** What the fake ssh saw of `$FOO` and `$VAR`, one `FOO|VAR` line per run. */
let environmentLog: string;

/** Clone something only reachable over ssh; the fake always refuses. */
function cloneThroughFakeSsh(): string {
	rmSync(join(root, "project.git"), { recursive: true, force: true });
	rmSync(recorder, { force: true });
	rmSync(environmentLog, { force: true });
	try {
		cloneProjectRepoBare(join(root, "project.git"), "ssh://git@example.invalid/project", "main", {
			allowLocal: false,
			interactive: false,
		});
	} catch {
		// The fake ssh fails by design; the clone is supposed to.
	}
	return exists(recorder) ? readFileSync(recorder, "utf8").trim() : "";
}
function exists(path: string): boolean {
	try {
		readFileSync(path);
		return true;
	} catch {
		return false;
	}
}

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "hyper-clone-ssh-"));
	recorder = join(root, "ssh.log");
	environmentLog = join(root, "ssh-env.log");
	const bin = join(root, "bin");
	mkdirSync(bin, { recursive: true });
	mkdirSync(join(root, "home"));
	// `ssh` on PATH and an absolute wrapper both record, so every case routes
	// through something this test controls — no real ssh, no network.
	// A directory with a space in its name holds a third one: a quoted program
	// path must reach the shell still quoted, or it splits in two.
	mkdirSync(join(root, "with space"));
	for (const script of [
		join(bin, "ssh"),
		join(bin, "recording-ssh"),
		join(root, "with space", "ssh"),
	]) {
		writeFileSync(
			script,
			`#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(recorder)}\n` +
				`printf '%s|%s\\n' "$FOO" "$VAR" >> ${JSON.stringify(environmentLog)}\nexit 1\n`,
			{ mode: 0o755 },
		);
		chmodSync(script, 0o755);
	}
	const globalConfig = join(root, "gitconfig");
	writeFileSync(globalConfig, "");
	for (const [key, value] of Object.entries({
		HOME: join(root, "home"),
		HYPER_HOME: join(root, "hyper"),
		HYPER_DRIVE_CONFIG: join(root, "drive.toml"),
		XDG_CONFIG_HOME: join(root, "config"),
		PATH: `${bin}:${process.env.PATH ?? ""}`,
		GIT_CONFIG_GLOBAL: globalConfig,
		GIT_CONFIG_NOSYSTEM: "1",
		GIT_SSH_COMMAND: undefined,
		GIT_SSH: undefined,
	}))
		vi.stubEnv(key, value);
});

afterEach(() => {
	vi.unstubAllEnvs();
	rmSync(root, { recursive: true, force: true });
});

describe("the user's own ssh command, against real git", () => {
	it("defaults to BatchMode when nothing is configured", () => {
		expect(cloneThroughFakeSsh()).toContain("-o BatchMode=yes");
	});
	it("puts BatchMode before a user's own -o BatchMode=no, which would otherwise win", () => {
		vi.stubEnv("GIT_SSH_COMMAND", "ssh -o BatchMode=no -i /tmp/test-key");
		const logged = cloneThroughFakeSsh();
		expect(logged).toContain("-i /tmp/test-key");
		expect(logged).toContain("-o BatchMode=yes");
		expect(logged.indexOf("-o BatchMode=yes")).toBeLessThan(logged.indexOf("-o BatchMode=no"));
	});
	it("honours a global core.sshCommand and keeps the rest of it", () => {
		writeFileSync(
			process.env.GIT_CONFIG_GLOBAL!,
			"[core]\n\tsshCommand = ssh -i /tmp/global-key\n",
		);
		const logged = cloneThroughFakeSsh();
		expect(logged).toContain("-i /tmp/global-key");
		expect(logged).toContain("-o BatchMode=yes");
	});
	it("honours a core.sshCommand that lives in an INCLUDED config file", () => {
		// `git config --global --get` ignores `[include]` unless `--includes` is
		// passed, so without it a perfectly ordinary dotfile setup loses its
		// identity and hyper's default silently overrides it.
		const included = join(root, "included.cfg");
		writeFileSync(included, "[core]\n\tsshCommand = ssh -o FromInclude=1\n");
		writeFileSync(process.env.GIT_CONFIG_GLOBAL!, `[include]\n\tpath = ${included}\n`);
		const logged = cloneThroughFakeSsh();
		expect(logged).toContain("-o FromInclude=1");
		expect(logged).toContain("-o BatchMode=yes");
		expect(logged.indexOf("-o BatchMode=yes")).toBeLessThan(logged.indexOf("-o FromInclude=1"));
	});
	it("ignores a core.sshCommand set in the repository we happen to run inside", () => {
		const elsewhere = join(root, "elsewhere");
		git(["init", "-q", elsewhere], root);
		git(["-C", elsewhere, "config", "--local", "core.sshCommand", "ssh -o FromCwdRepo=1"], root);
		const cwd = process.cwd();
		let logged = "";
		try {
			process.chdir(elsewhere);
			logged = cloneThroughFakeSsh();
		} finally {
			process.chdir(cwd);
		}
		// Plain `git clone` ignores it in this directory, so hyper must too.
		expect(logged).not.toContain("FromCwdRepo");
		expect(logged).toContain("-o BatchMode=yes");
	});
	it("leaves a wrapper command alone: it need not understand -o", () => {
		vi.stubEnv("GIT_SSH_COMMAND", `${join(root, "bin", "recording-ssh")} -i /tmp/key`);
		const logged = cloneThroughFakeSsh();
		expect(logged).toContain("-i /tmp/key");
		expect(logged).not.toContain("BatchMode");
	});
	it("leaves GIT_SSH alone when it is the only ssh setting", () => {
		vi.stubEnv("GIT_SSH", join(root, "bin", "recording-ssh"));
		const logged = cloneThroughFakeSsh();
		expect(logged).not.toBe("");
		expect(logged).not.toContain("BatchMode");
	});
	it("applies the rule to GIT_SSH_COMMAND even when GIT_SSH is also set", () => {
		vi.stubEnv("GIT_SSH", join(root, "bin", "unused-wrapper"));
		vi.stubEnv("GIT_SSH_COMMAND", "ssh -o BatchMode=no");
		const logged = cloneThroughFakeSsh();
		expect(logged).toContain("-o BatchMode=yes");
		expect(logged.indexOf("-o BatchMode=yes")).toBeLessThan(logged.indexOf("-o BatchMode=no"));
	});
	it("keeps a quoted program path with a space quoted, and still adds BatchMode", () => {
		// The shell must see ONE word. Unquoting it (the round-3 regression)
		// made git run `/…/with` and the clone failed before ssh was reached.
		vi.stubEnv("GIT_SSH_COMMAND", `"${join(root, "with space", "ssh")}" -i /tmp/key`);
		const logged = cloneThroughFakeSsh();
		expect(logged).not.toBe("");
		expect(logged.startsWith("-o BatchMode=yes -i /tmp/key")).toBe(true);
	});
	it("finds the program after an assignment whose value is ssh", () => {
		// `indexOf("ssh")` used to land inside `X=ssh` and put `-o` in front of
		// the program, which the shell then ran as a command.
		vi.stubEnv("GIT_SSH_COMMAND", "X=ssh ssh -i /tmp/key");
		const logged = cloneThroughFakeSsh();
		expect(logged.startsWith("-o BatchMode=yes -i /tmp/key")).toBe(true);
	});
	it("reads `env FOO=1 ssh` like an assignment and keeps the variable", () => {
		vi.stubEnv("GIT_SSH_COMMAND", "env FOO=1 ssh -i /tmp/key");
		const logged = cloneThroughFakeSsh();
		expect(logged.startsWith("-o BatchMode=yes -i /tmp/key")).toBe(true);
		expect(readFileSync(environmentLog, "utf8").split("\n")[0]).toBe("1|");
	});
	it("keeps a quoted assignment value whole", () => {
		vi.stubEnv("GIT_SSH_COMMAND", 'VAR="a b" ssh -i /tmp/key');
		const logged = cloneThroughFakeSsh();
		expect(logged.startsWith("-o BatchMode=yes -i /tmp/key")).toBe(true);
		expect(readFileSync(environmentLog, "utf8").split("\n")[0]).toBe("|a b");
	});
	it("redacts every credentialed url git relays from ssh, not only the first", () => {
		// Real git relays the transport's stderr verbatim, so a hostile or
		// chatty server can put several urls on one line.
		const noisy = join(root, "bin", "noisy-transport");
		writeFileSync(
			noisy,
			"#!/bin/sh\necho 'fatal: https://user:first-password-value@example.invalid/x and https://user:second-password-value@example.invalid/y' >&2\nexit 1\n",
			{ mode: 0o755 },
		);
		chmodSync(noisy, 0o755);
		vi.stubEnv("GIT_SSH_COMMAND", noisy);
		let message = "";
		try {
			cloneProjectRepoBare(join(root, "project.git"), "ssh://git@example.invalid/project", "main", {
				allowLocal: false,
				interactive: false,
			});
		} catch (error) {
			message = String(error);
		}
		expect(message).toContain(
			"https://[redacted]@example.invalid/x and https://[redacted]@example.invalid/y",
		);
		expect(message).not.toContain("first-password-value");
		expect(message).not.toContain("second-password-value");
	});
});
