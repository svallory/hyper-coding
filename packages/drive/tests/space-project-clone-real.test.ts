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

/** Clone something only reachable over ssh; the fake always refuses. */
function cloneThroughFakeSsh(): string {
	rmSync(join(root, "project.git"), { recursive: true, force: true });
	rmSync(recorder, { force: true });
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
	const bin = join(root, "bin");
	mkdirSync(bin, { recursive: true });
	mkdirSync(join(root, "home"));
	// `ssh` on PATH and an absolute wrapper both record, so every case routes
	// through something this test controls — no real ssh, no network.
	for (const name of ["ssh", "recording-ssh"]) {
		const script = join(bin, name);
		writeFileSync(
			script,
			`#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(recorder)}\nexit 1\n`,
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
});
