import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	addHint,
	listMachines,
	MachineError,
	resolveMachine,
	runnerFor,
	self,
} from "#services/machine";
import { LocalMachine, RemoteMachine } from "#services/remote";
import { withTempConfig } from "#tests/tmp-config";

const FIXTURE = `
remote = "git@github.com:example/hyperdrive.git"

[self]
name = "test-machine"
home = "/home/tester"

[machines.netcup]
home = "/home/svallory"
features = ["docker", "mutagen"]
agent_user = "agent"

# Herdr doesn't know this one — resolveMachine must say so.
[machines.spare]
home = "/home/spare"
`;

/** Temp dirs (fake herdr scripts, isolated PATHs) to remove afterwards. */
const tmpDirs: string[] = [];
function track(dir: string): string {
	tmpDirs.push(dir);
	return dir;
}

/**
 * Put a fake `herdr` on PATH that prints this JSON for `machine list --json`.
 * The body is the shape `herdr machine` documents for a saved machine: label,
 * SSH target, explicit session, enabled state.
 */
function fakeHerdrOnPath(json: string, { exitCode = 0, stderr = "" } = {}): string {
	const dir = track(mkdtempSync(join(tmpdir(), "drive-herdr-")));
	const script = join(dir, "herdr");
	writeFileSync(
		script,
		`#!/bin/sh\ncat <<'JSON'\n${json}\nJSON\n[ -n "${stderr}" ] && cat >&2 <<'ERR'\n${stderr}\nERR\n\nexit ${exitCode}\n`,
		"utf-8",
	);
	chmodSync(script, 0o755);
	process.env.PATH = `${dir}:${process.env.PATH ?? ""}`;
	return dir;
}

/** A PATH with no herdr at all. */
function pathWithoutHerdr(): string {
	const dir = track(mkdtempSync(join(tmpdir(), "drive-nopath-")));
	process.env.PATH = dir;
	return dir;
}

const saved = { path: process.env.PATH, config: process.env.HYPER_DRIVE_CONFIG };

afterEach(() => {
	if (saved.path === undefined) delete process.env.PATH;
	else process.env.PATH = saved.path;
	if (saved.config === undefined) delete process.env.HYPER_DRIVE_CONFIG;
	else process.env.HYPER_DRIVE_CONFIG = saved.config;
	while (tmpDirs.length > 0) {
		const dir = tmpDirs.pop();
		if (dir) rmSync(dir, { recursive: true, force: true });
	}
});

describe("listMachines", () => {
	it("merges Herdr's machines with drive.toml", () => {
		fakeHerdrOnPath(
			JSON.stringify([
				{ label: "netcup", target: "agent@netcup.example.com", enabled: true },
				{ label: "workbox", target: "agent@workbox.example.com", enabled: true },
			]),
		);
		withTempConfig(FIXTURE);

		const machines = listMachines();

		expect(machines.map((m) => m.name)).toEqual(["netcup", "spare", "workbox"]);

		const netcup = machines.find((m) => m.name === "netcup");
		expect(netcup).toMatchObject({
			host: "agent@netcup.example.com",
			home: "/home/svallory",
			features: ["docker", "mutagen"],
			agentUser: "agent",
			source: "both",
			herdr: true,
		});

		// Config-only: no host yet, so nothing can reach it.
		expect(machines.find((m) => m.name === "spare")).toMatchObject({
			host: undefined,
			home: "/home/spare",
			source: "config",
			herdr: false,
		});

		// Herdr-only: reachable, but no hyperdrive details.
		expect(machines.find((m) => m.name === "workbox")).toMatchObject({
			host: "agent@workbox.example.com",
			home: undefined,
			features: [],
			agentUser: "agent",
			source: "herdr",
			herdr: true,
		});
	});

	it("leaves out machines Herdr has disabled", () => {
		fakeHerdrOnPath(
			JSON.stringify([
				{ label: "netcup", target: "agent@netcup.example.com", enabled: true },
				{ label: "retired", target: "agent@retired.example.com", enabled: false },
			]),
		);
		withTempConfig(FIXTURE);

		// Disabled means Herdr won't route to it; `herdr machine enable retired`
		// brings it back. A config-only entry still shows up.
		expect(listMachines().map((m) => m.name)).toEqual(["netcup", "spare"]);
	});

	it("returns only config entries when Herdr isn't installed", () => {
		pathWithoutHerdr();
		withTempConfig(FIXTURE);

		const machines = listMachines();

		expect(machines.map((m) => m.name)).toEqual(["netcup", "spare"]);
		for (const machine of machines) expect(machine.herdr).toBe(false);
	});

	it("survives Herdr printing something unexpected", () => {
		fakeHerdrOnPath("not json at all");
		withTempConfig(FIXTURE);

		expect(listMachines().map((m) => m.name)).toEqual(["netcup", "spare"]);
	});

	it("survives Herdr failing, and doesn't blame a missing install", () => {
		fakeHerdrOnPath("[]", { exitCode: 3, stderr: "machine store is locked" });
		withTempConfig(FIXTURE);

		expect(listMachines().map((m) => m.name)).toEqual(["netcup", "spare"]);

		try {
			resolveMachine("netcup");
			expect.unreachable("resolveMachine should have thrown");
		} catch (err) {
			const message = (err as Error).message;
			expect(message).toMatch(/machine store is locked/);
			// Herdr is installed here; only ENOENT means "not installed".
			expect(message).not.toMatch(/doesn't seem to be installed/);
		}
	});
});

describe("resolveMachine", () => {
	it("returns a Herdr-only machine without a home dir", () => {
		fakeHerdrOnPath(JSON.stringify([{ label: "workbox", target: "agent@workbox.example.com" }]));
		withTempConfig(FIXTURE);

		expect(resolveMachine("workbox")).toMatchObject({
			name: "workbox",
			host: "agent@workbox.example.com",
			home: undefined,
			source: "herdr",
		});
	});

	it("tells the user how to add a config-only machine to Herdr", () => {
		fakeHerdrOnPath(JSON.stringify([{ label: "netcup", target: "agent@netcup.example.com" }]));
		withTempConfig(FIXTURE);

		expect(() => resolveMachine("spare")).toThrow(MachineError);
		// Real usage is `herdr machine add <ssh-target> --label <label>`.
		expect(() => resolveMachine("spare")).toThrow(/herdr machine add <user@host> --label spare/);
	});

	it("spells the add hint the way Herdr's own help does", () => {
		expect(addHint("spare")).toBe("herdr machine add <user@host> --label spare");
	});

	it("says so when Herdr isn't installed at all", () => {
		pathWithoutHerdr();
		withTempConfig(FIXTURE);

		try {
			resolveMachine("netcup");
			expect.unreachable("resolveMachine should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(MachineError);
			expect((err as Error).message).toMatch(/herdr machine add <user@host> --label netcup/);
			expect((err as Error).message).toMatch(/doesn't seem to be installed/);
		}
	});

	it("lists the known machines for an unknown name", () => {
		fakeHerdrOnPath(JSON.stringify([{ label: "netcup", target: "agent@netcup.example.com" }]));
		withTempConfig(FIXTURE);

		try {
			resolveMachine("nope");
			expect.unreachable("resolveMachine should have thrown");
		} catch (err) {
			expect((err as Error).message).toMatch(/no machine called "nope"/);
			expect((err as Error).message).toMatch(/netcup/);
		}
	});
});

describe("self", () => {
	it("returns the configured machine and home", () => {
		fakeHerdrOnPath("[]");
		withTempConfig(FIXTURE);

		expect(self()).toEqual({ name: "test-machine", home: "/home/tester" });
	});

	it("asks for `hyper drive init` when self.name is empty", () => {
		fakeHerdrOnPath("[]");
		withTempConfig('remote = "git@example.com:x/y.git"\n');

		expect(() => self()).toThrow(/hyper drive init/);
	});
});

describe("runnerFor", () => {
	it("is local with no target", () => {
		fakeHerdrOnPath("[]");
		withTempConfig(FIXTURE);

		expect(runnerFor()).toBeInstanceOf(LocalMachine);
		expect(runnerFor(undefined)).toBeInstanceOf(LocalMachine);
	});

	it("is local for this machine's own name", () => {
		fakeHerdrOnPath("[]");
		withTempConfig(FIXTURE);

		expect(runnerFor("test-machine")).toBeInstanceOf(LocalMachine);
	});

	it("is a remote runner for another machine", () => {
		fakeHerdrOnPath(JSON.stringify([{ label: "netcup", target: "agent@netcup.example.com" }]));
		withTempConfig(FIXTURE);

		const runner = runnerFor("netcup");
		expect(runner).toBeInstanceOf(RemoteMachine);
		expect((runner as RemoteMachine).host).toBe("agent@netcup.example.com");
	});

	it("works for another machine even when self.name is unset", () => {
		fakeHerdrOnPath(JSON.stringify([{ label: "netcup", target: "agent@netcup.example.com" }]));
		// No [self] section: `hyper drive init` hasn't run here yet.
		withTempConfig('[machines.netcup]\nhome = "/home/svallory"\n');

		// self() is the right place to complain about an unset self.name —
		// asking for a remote machine is not.
		expect(() => self()).toThrow(/hyper drive init/);
		expect(runnerFor("netcup")).toBeInstanceOf(RemoteMachine);
	});
});
