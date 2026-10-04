import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	listMachines,
	MachineError,
	type MachineInfo,
	resolveMachine,
	targetFor,
} from "#services/machine";
import { rootSteps } from "#services/machine/root-script";
import {
	isIpv6Literal,
	isSafeRemotePath,
	RemoteError,
	RemoteMachine,
	RemotePathError,
	type RunResult,
	type Spawner,
	type SpawnRequest,
	SshTargetError,
	shellJoin,
	shellQuote,
	splitSshTarget,
	sshUrl,
} from "#services/remote";

/**
 * A machine on a non-default ssh port.
 *
 * `host:port` is scp's and rsync's remote-spec grammar, NOT ssh's: handing
 * `box:2222` to `ssh` makes it try to resolve a host literally named
 * `box:2222` and fail with a DNS error that points nowhere near the real
 * problem. Herdr lets a machine be saved on any port, so the split has to
 * happen before the three binaries each want their own spelling:
 *
 *   ssh    → `-p 2222`
 *   rsync  → `-e 'ssh -p 2222'`  (rsync runs its OWN ssh)
 *   git    → `ssh://box:2222/path` (git runs its OWN ssh too)
 *
 * This file is new on purpose: `tests/remote-exec.test.ts` (the C-16 boundary
 * check) stays byte-identical to main.
 */

/** A spawner that records what would be run and answers success. */
function recording(answers: RunResult = { code: 0, stdout: "", stderr: "" }) {
	const calls: SpawnRequest[] = [];
	const spawner: Spawner = async (request) => {
		calls.push(request);
		return answers;
	};
	return { calls, spawner };
}

describe("splitSshTarget", () => {
	it("leaves a plain host alone", () => {
		expect(splitSshTarget("netcup")).toEqual({ host: "netcup" });
	});

	it("keeps the user, which is part of the host ssh takes", () => {
		expect(splitSshTarget("me@box")).toEqual({ host: "me@box" });
	});

	it("splits a host:port pair", () => {
		expect(splitSshTarget("me@box:2222")).toEqual({ host: "me@box", port: 2222 });
	});

	it("splits a bracketed IPv6 host with a port", () => {
		expect(splitSshTarget("[::1]:2222")).toEqual({ host: "[::1]", port: 2222 });
	});

	it("leaves a bracketed IPv6 host without a port alone", () => {
		expect(splitSshTarget("[::1]")).toEqual({ host: "[::1]" });
	});

	it("does not mistake a bare IPv6 address for a host:port pair", () => {
		// Two or more colons and no brackets is an address, never a port.
		expect(splitSshTarget("fe80::1")).toEqual({ host: "fe80::1" });
		expect(splitSshTarget("::1")).toEqual({ host: "::1" });
	});

	it("refuses a non-numeric port rather than passing it to ssh", () => {
		// `box:notaport` reaching ssh would become "could not resolve hostname
		// box:notaport" — a DNS error about a typo, not about the typo itself.
		expect(() => splitSshTarget("box:notaport")).toThrow(SshTargetError);
		expect(() => splitSshTarget("box:notaport")).toThrow(/not a port number/);
	});

	it("refuses a port outside 1-65535", () => {
		expect(() => splitSshTarget("box:0")).toThrow(/between 1 and 65535/);
		expect(() => splitSshTarget("box:70000")).toThrow(/between 1 and 65535/);
	});

	it("refuses an empty target and a missing host", () => {
		expect(() => splitSshTarget("   ")).toThrow(SshTargetError);
		expect(() => splitSshTarget(":2222")).toThrow(/no host before/);
	});

	it("refuses an unclosed bracket", () => {
		expect(() => splitSshTarget("[::1")).toThrow(/matching/);
	});
});

describe("IPv6 targets with a user", () => {
	it("splits user@[v6]:port, keeping the user on the host", () => {
		expect(splitSshTarget("me@[::1]:2222")).toEqual({ host: "me@[::1]", port: 2222 });
		expect(splitSshTarget("me@[fe80::1]")).toEqual({ host: "me@[fe80::1]" });
	});

	it("still refuses junk after the closing bracket", () => {
		expect(() => splitSshTarget("me@[::1]x")).toThrow(/must end at its/);
	});

	it("recognises every IPv6 literal spelling, and nothing else", () => {
		for (const host of ["::1", "fe80::1", "me@::1", "[::1]", "me@[::1]"]) {
			expect(isIpv6Literal(host), host).toBe(true);
		}
		for (const host of ["box", "me@box", "10.0.0.1", "me@box.example"]) {
			expect(isIpv6Literal(host), host).toBe(false);
		}
	});

	it("brackets a bare IPv6 host in an ssh:// URL", () => {
		expect(sshUrl({ host: "fe80::1" }, "/sp.git")).toBe("ssh://[fe80::1]/sp.git");
		expect(sshUrl({ host: "me@::1", port: 22 }, "/sp.git")).toBe("ssh://me@[::1]:22/sp.git");
	});
});

describe("isSafeRemotePath", () => {
	it("is the rule the copy itself enforces", () => {
		expect(isSafeRemotePath("/Users/me/work/proj")).toBe(true);
		expect(isSafeRemotePath("/Users/me/.claude/projects/-Users-me-work")).toBe(true);
		for (const bad of ["/a b", "/it's", "/a@b", "/$(id)", "/a\nb"]) {
			expect(isSafeRemotePath(bad), bad).toBe(false);
		}
	});
});

describe("sshUrl", () => {
	it("builds an ssh:// URL with no port when the machine named none", () => {
		expect(sshUrl({ host: "me@box" }, "/home/me/sp.git")).toBe("ssh://me@box/home/me/sp.git");
	});

	it("builds an ssh:// URL carrying the port, for git's own ssh", () => {
		expect(sshUrl({ host: "me@box", port: 2222 }, "/home/me/sp.git")).toBe(
			"ssh://me@box:2222/home/me/sp.git",
		);
	});

	it("keeps a bracketed IPv6 host bracketed, as a URL authority requires", () => {
		expect(sshUrl({ host: "[::1]", port: 2222 }, "/sp.git")).toBe("ssh://[::1]:2222/sp.git");
	});

	it("refuses a relative path, which is a local path here and a lie remotely", () => {
		expect(() => sshUrl({ host: "box" }, "sp.git")).toThrow(RemotePathError);
	});

	it("refuses a path outside the safe charset, the same way the copy does", () => {
		expect(() => sshUrl({ host: "box" }, "/home/me/$(id)")).toThrow(RemotePathError);
	});
});

describe("RemoteMachine with a port AND as another user (T-17's options)", () => {
	it("keeps both: the isolation options, then -p, then the host", async () => {
		const { calls, spawner } = recording();
		const machine = new RemoteMachine("agent@box:2222", spawner, { otherUser: true });
		await machine.ssh(["true"]);
		const args = calls[0]?.args ?? [];
		expect(args.slice(-5)).toEqual(["-p", "2222", "agent@box", "--", "true"]);
		expect(args).toContain("ControlMaster=no");
		await machine.rsync("/a", "/home/agent/x");
		const rsync = calls.find((call) => call.file === "rsync")?.args ?? [];
		const shell = rsync[rsync.indexOf("-e") + 1] ?? "";
		expect(shell.startsWith("ssh ")).toBe(true);
		expect(shell).toContain("ControlMaster=no");
		expect(shell.endsWith("-p 2222")).toBe(true);
	});

	it("asUser keeps the port of the machine it was built for", async () => {
		const { calls, spawner } = recording();
		await new RemoteMachine("me@box", spawner, { port: 2222 }).asUser("agent", ["true"]);
		expect(calls[0]?.args.slice(-5)).toEqual(["-p", "2222", "agent@box", "--", "true"]);
	});
});

describe("RemoteMachine with a port", () => {
	it("passes -p BEFORE the host, where ssh is still reading options", async () => {
		const { calls, spawner } = recording();
		const machine = new RemoteMachine("me@box", spawner, { port: 2222 });
		await machine.ssh(["true"]);
		expect(calls[0]?.file).toBe("ssh");
		expect(calls[0]?.args).toEqual(["-p", "2222", "me@box", "--", "true"]);
		// After the host, ssh reads `-p` as part of the destination.
		expect(calls[0]?.args.indexOf("-p")).toBeLessThan(calls[0]?.args.indexOf("me@box") ?? 0);
	});

	it("splits a host:port target itself, so a caller that forgets still connects", async () => {
		// This is the bug the split exists to remove: without it ssh is handed
		// `me@box:2222` as one hostname and fails to resolve it.
		const { calls, spawner } = recording();
		const machine = new RemoteMachine("me@box:2222", spawner);
		await machine.ssh(["true"]);
		expect(calls[0]?.args).toEqual(["-p", "2222", "me@box", "--", "true"]);
	});

	it("passes no -p at all when the machine named no port", async () => {
		const { calls, spawner } = recording();
		await new RemoteMachine("me@box", spawner).ssh(["true"]);
		expect(calls[0]?.args).toEqual(["me@box", "--", "true"]);
		expect(calls[0]?.args).not.toContain("-p");
	});

	it("keeps -t and -p both, in that order, for an interactive remote command", async () => {
		const { calls, spawner } = recording();
		await new RemoteMachine("box", spawner, { port: 2222 }).ssh(["tmux", "attach"], { tty: true });
		expect(calls[0]?.args.slice(0, 3)).toEqual(["-t", "-p", "2222"]);
	});

	it("tells the ssh that RSYNC runs about the port, through -e", async () => {
		// `-p 2222` here would be an rsync option, and rsync has none. This is
		// the spelling that actually reaches the ssh on the other end.
		const { calls, spawner } = recording();
		await new RemoteMachine("box", spawner, { port: 2222 }).rsync("/a", "/home/agent/x");
		// The first spawn is the mkdir over ssh that creates the destination's
		// parent; the transfer itself is the one whose binary is rsync.
		const transfer = calls.find((call) => call.file === "rsync");
		const args = transfer?.args ?? [];
		const e = args[args.indexOf("-e") + 1];
		expect(e).toBe("ssh -p 2222");
		expect(args[args.length - 1]).toBe("box:/home/agent/x");
	});

	it("keeps the plain -e ssh for a machine with no port", async () => {
		const { calls, spawner } = recording();
		await new RemoteMachine("box", spawner).rsync("/a", "/home/agent/x");
		const args = calls.find((call) => call.file === "rsync")?.args ?? [];
		expect(args[args.indexOf("-e") + 1]).toBe("ssh");
	});

	it("still refuses a host that ssh would read as an option", () => {
		expect(() => new RemoteMachine("-oProxyCommand=id", recording().spawner)).toThrow(RemoteError);
	});
});

/**
 * The FULL argv for the three programs, primary and as-agent, with and without
 * a port. Pinned rather than probed: `runRootScript` copies the root script
 * with scp and then runs it over ssh, and on a host where port 22 is another
 * sshd an scp without `-P` lands the script on the wrong machine (found by the
 * PR #42 confirm review). scp's port spelling is `-P` — its `-p` preserves
 * modes — and it goes where scp is still reading options: before `-r`, before
 * `--`.
 */
describe("the exact argv of ssh, rsync and scp, primary and as-agent, with and without a port", () => {
	const isolation = [
		"-a",
		"-x",
		"-o",
		"ForwardAgent=no",
		"-o",
		"ClearAllForwardings=yes",
		"-o",
		"ControlMaster=no",
		"-o",
		"ControlPath=none",
	];
	/** scp has no `-a` or `-x`; spell the latter as `-o ForwardX11=no`. */
	const scpIsolation = [...isolation.slice(2), "-o", "ForwardX11=no"];

	function callsOf(calls: SpawnRequest[], file: string): string[] {
		const call = calls.find((request) => request.file === file);
		expect(call, `no ${file} spawn recorded`).toBeDefined();
		return call?.args ?? [];
	}

	it("pins ssh, rsync and scp for a PRIMARY session with a port", async () => {
		const { calls, spawner } = recording();
		const machine = new RemoteMachine("me@box", spawner, { port: 2222 });
		await machine.ssh(["id", "-u"]);
		expect(callsOf(calls, "ssh")).toEqual(["-p", "2222", "me@box", "--", "id -u"]);
		await machine.rsync("/a", "/home/me/x");
		expect(callsOf(calls, "rsync")).toEqual([
			"-a",
			"--stats",
			"-e",
			"ssh -p 2222",
			"--",
			"/a",
			"me@box:/home/me/x",
		]);
		await machine.scp("/a", "/home/me/x");
		expect(callsOf(calls, "scp")).toEqual(["-P", "2222", "-r", "--", "/a", "me@box:/home/me/x"]);
	});

	it("pins ssh, rsync and scp for a PRIMARY session without a port", async () => {
		const { calls, spawner } = recording();
		const machine = new RemoteMachine("me@box", spawner);
		await machine.ssh(["id", "-u"]);
		expect(callsOf(calls, "ssh")).toEqual(["me@box", "--", "id -u"]);
		await machine.rsync("/a", "/home/me/x");
		expect(callsOf(calls, "rsync")).toEqual([
			"-a",
			"--stats",
			"-e",
			"ssh",
			"--",
			"/a",
			"me@box:/home/me/x",
		]);
		await machine.scp("/a", "/home/me/x");
		expect(callsOf(calls, "scp")).toEqual(["-r", "--", "/a", "me@box:/home/me/x"]);
	});

	it("pins ssh, rsync and scp for an AS-AGENT session with a port", async () => {
		const { calls, spawner } = recording();
		const machine = new RemoteMachine("agent@box", spawner, { otherUser: true, port: 2222 });
		await machine.ssh(["id", "-u"]);
		expect(callsOf(calls, "ssh")).toEqual([...isolation, "-p", "2222", "agent@box", "--", "id -u"]);
		await machine.rsync("/a", "/home/agent/x");
		expect(callsOf(calls, "rsync")).toEqual([
			"-a",
			"--stats",
			"-e",
			["ssh", ...isolation, "-p", "2222"].join(" "),
			"--",
			"/a",
			"agent@box:/home/agent/x",
		]);
		await machine.scp("/a", "/home/agent/x");
		expect(callsOf(calls, "scp")).toEqual([
			...scpIsolation,
			"-P",
			"2222",
			"-r",
			"--",
			"/a",
			"agent@box:/home/agent/x",
		]);
	});

	it("pins ssh, rsync and scp for an AS-AGENT session without a port", async () => {
		const { calls, spawner } = recording();
		const machine = new RemoteMachine("agent@box", spawner, { otherUser: true });
		await machine.ssh(["id", "-u"]);
		expect(callsOf(calls, "ssh")).toEqual([...isolation, "agent@box", "--", "id -u"]);
		await machine.rsync("/a", "/home/agent/x");
		expect(callsOf(calls, "rsync")).toEqual([
			"-a",
			"--stats",
			"-e",
			["ssh", ...isolation].join(" "),
			"--",
			"/a",
			"agent@box:/home/agent/x",
		]);
		await machine.scp("/a", "/home/agent/x");
		expect(callsOf(calls, "scp")).toEqual([
			...scpIsolation,
			"-r",
			"--",
			"/a",
			"agent@box:/home/agent/x",
		]);
	});
});

describe("the printed manual root-script recipe", () => {
	const machine: MachineInfo = {
		name: "box",
		host: "me@box",
		home: "/home/me",
		features: [],
		agentUser: "agent",
		agentKey: "",
		source: "both",
		herdr: true,
	};

	it("carries a non-default port for both the scp copy and ssh run", () => {
		expect(rootSteps({ ...machine, port: 2222 }, "/tmp/root.sh")).toEqual([
			"ssh -p 2222 me@box 'mkdir -p ~/.hyper'",
			"scp -P 2222 /tmp/root.sh me@box:~/.hyper/hyper-machine-root.sh",
			"ssh -t -p 2222 me@box 'sudo bash ~/.hyper/hyper-machine-root.sh'",
		]);
	});

	it("leaves the operator's ssh-config port alone when the machine names none", () => {
		expect(rootSteps(machine, "/tmp/root.sh")).toEqual([
			"ssh me@box 'mkdir -p ~/.hyper'",
			"scp /tmp/root.sh me@box:~/.hyper/hyper-machine-root.sh",
			"ssh -t me@box 'sudo bash ~/.hyper/hyper-machine-root.sh'",
		]);
	});
});

describe("the port reaches a URL a caller can push to (C-9)", () => {
	it("gives warp an ssh:// URL, never a remote name", () => {
		// The push target is built from the machine entry; there is no code path
		// from a machine to a bare `origin`.
		const url = sshUrl({ host: "me@box", port: 2222 }, "/home/me/spaces/research/.git");
		expect(url).toBe("ssh://me@box:2222/home/me/spaces/research/.git");
		expect(url).not.toContain("origin");
		expect(url.startsWith("ssh://")).toBe(true);
	});
});

describe("shellQuote still guards everything that reaches a remote shell", () => {
	it("round-trips a path with a space and an apostrophe through a real shell", () => {
		const word = shellQuote("/home/me/it's here");
		expect(word).toBe(`'/home/me/it'\\''s here'`);
		// shellJoin is what RemoteMachine actually builds the command line with.
		expect(shellJoin(["test", "-d", "--", "/home/me/it's here"])).toBe(
			"test -d -- '/home/me/it'\\''s here'",
		);
	});

	it("leaves an already-safe word unquoted, so logs stay readable", () => {
		expect(shellQuote("/home/me/x")).toBe("/home/me/x");
	});
});

describe("targetFor reads the port out of the Herdr machine entry", () => {
	// The registry's parsing of Herdr's JSON is covered in machine.test.ts; what
	// belongs HERE is the seam every warp caller uses, driven end to end through
	// a fake `herdr` on PATH — the same pattern machine.test.ts installs.
	const originalPath = process.env.PATH;
	const originalConfig = process.env.HYPER_DRIVE_CONFIG;
	const tmpDirs: string[] = [];

	afterEach(() => {
		if (originalPath === undefined) delete process.env.PATH;
		else process.env.PATH = originalPath;
		if (originalConfig === undefined) delete process.env.HYPER_DRIVE_CONFIG;
		else process.env.HYPER_DRIVE_CONFIG = originalConfig;
		while (tmpDirs.length > 0) {
			const dir = tmpDirs.pop();
			if (dir) rmSync(dir, { recursive: true, force: true });
		}
	});

	/** A `herdr` that prints this machine list, plus a drive.toml naming its home. */
	function fakeHerdr(target: string, machine = "box"): string {
		const dir = mkdtempSync(join(tmpdir(), "drive-port-"));
		tmpDirs.push(dir);
		const bin = join(dir, "herdr");
		writeFileSync(
			bin,
			`#!/bin/sh\ncat <<'JSON'\n[{"label": ${JSON.stringify(machine)}, "target": ${JSON.stringify(target)}, "enabled": true}]\nJSON\n`,
			"utf-8",
		);
		chmodSync(bin, 0o755);
		process.env.PATH = `${dir}:${originalPath ?? ""}`;

		const config = join(dir, "drive.toml");
		writeFileSync(
			config,
			`[self]\nname = "mac"\nhome = "/Users/me"\n\n[machines.${machine}]\nhome = "/home/me"\n`,
			"utf-8",
		);
		process.env.HYPER_DRIVE_CONFIG = config;
		return machine;
	}

	it("hands warp the host and port separately", () => {
		const name = fakeHerdr("me@box:2222");
		expect(targetFor(name)).toEqual({ host: "me@box", port: 2222 });
	});

	it("reports no port for a machine saved without one", () => {
		const name = fakeHerdr("me@box");
		expect(targetFor(name)).toEqual({ host: "me@box" });
	});

	it("still lists the machine when Herdr knows it, with host and port split", () => {
		const name = fakeHerdr("me@box:2222");
		const machine = resolveMachine(name);
		expect(machine.host).toBe("me@box");
		expect(machine.port).toBe(2222);
		// `machine list` shows the machine, not an error: an unusable target is
		// reported by the command that tries to use it.
		expect(listMachines().map((entry) => entry.name)).toContain(name);
	});

	it("refuses an unusable target with a message that names the fix", () => {
		const name = fakeHerdr("box:notaport");
		expect(() => targetFor(name)).toThrow(MachineError);
		expect(() => targetFor(name)).toThrow(/herdr machine add/);
		// …and the machine is still LISTED, because listing is not using it.
		expect(resolveMachine(name).host).toBe("box:notaport");
	});
});
