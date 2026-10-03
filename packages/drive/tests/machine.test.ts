import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listMachines, MachineError, resolveMachine, runnerFor, self } from "#services/machine";
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

/** Put a fake `herdr` on PATH that prints this JSON for `machine list --json`. */
function fakeHerdrOnPath(json: string): string {
	const dir = mkdtempSync(join(tmpdir(), "drive-herdr-"));
	const script = join(dir, "herdr");
	writeFileSync(script, `#!/bin/sh\ncat <<'JSON'\n${json}\nJSON\n`, "utf-8");
	chmodSync(script, 0o755);
	process.env.PATH = `${dir}:${process.env.PATH ?? ""}`;
	return dir;
}

/** A PATH with no herdr at all. */
function pathWithoutHerdr(): string {
	const dir = mkdtempSync(join(tmpdir(), "drive-nopath-"));
	process.env.PATH = dir;
	return dir;
}

const saved = { path: process.env.PATH, config: process.env.HYPER_DRIVE_CONFIG };

afterEach(() => {
	if (saved.path === undefined) delete process.env.PATH;
	else process.env.PATH = saved.path;
	if (saved.config === undefined) delete process.env.HYPER_DRIVE_CONFIG;
	else process.env.HYPER_DRIVE_CONFIG = saved.config;
});

describe("listMachines", () => {
	it("merges Herdr's machines with drive.toml", () => {
		fakeHerdrOnPath(
			JSON.stringify([
				{ label: "netcup", host: "netcup.example.com" },
				{ label: "workbox", host: "workbox.example.com" },
			]),
		);
		withTempConfig(FIXTURE);

		const machines = listMachines();

		expect(machines.map((m) => m.name)).toEqual(["netcup", "spare", "workbox"]);

		const netcup = machines.find((m) => m.name === "netcup");
		expect(netcup).toMatchObject({
			host: "netcup.example.com",
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
			host: "workbox.example.com",
			home: undefined,
			features: [],
			agentUser: "agent",
			source: "herdr",
			herdr: true,
		});
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
});

describe("resolveMachine", () => {
	it("returns a Herdr-only machine without a home dir", () => {
		fakeHerdrOnPath(JSON.stringify([{ label: "workbox", host: "workbox.example.com" }]));
		withTempConfig(FIXTURE);

		expect(resolveMachine("workbox")).toMatchObject({
			name: "workbox",
			host: "workbox.example.com",
			home: undefined,
			source: "herdr",
		});
	});

	it("tells the user how to add a config-only machine to Herdr", () => {
		fakeHerdrOnPath(JSON.stringify([{ label: "netcup", host: "netcup.example.com" }]));
		withTempConfig(FIXTURE);

		expect(() => resolveMachine("spare")).toThrow(MachineError);
		expect(() => resolveMachine("spare")).toThrow(/herdr machine add spare/);
	});

	it("says so when Herdr isn't installed at all", () => {
		pathWithoutHerdr();
		withTempConfig(FIXTURE);

		try {
			resolveMachine("netcup");
			expect.unreachable("resolveMachine should have thrown");
		} catch (err) {
			expect(err).toBeInstanceOf(MachineError);
			expect((err as Error).message).toMatch(/herdr machine add netcup/);
			expect((err as Error).message).toMatch(/doesn't seem to be installed/);
		}
	});

	it("lists the known machines for an unknown name", () => {
		fakeHerdrOnPath(JSON.stringify([{ label: "netcup", host: "netcup.example.com" }]));
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
		fakeHerdrOnPath(JSON.stringify([{ label: "netcup", host: "netcup.example.com" }]));
		withTempConfig(FIXTURE);

		const runner = runnerFor("netcup");
		expect(runner).toBeInstanceOf(RemoteMachine);
		expect((runner as RemoteMachine).host).toBe("netcup.example.com");
	});
});
