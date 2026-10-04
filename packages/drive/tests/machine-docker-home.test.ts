/**
 * T-17: rootless Docker for the agent user, and the macOS-shaped home.
 *
 * The four ways these could be quietly wrong, and what pins each:
 *
 * 1. **The checks are read-only**, like every other task here (C-15). The home
 *    probe and the packages probe are matched against the mutating verbs.
 * 2. **The root scripts are guarded and reversible.** The home script moves a
 *    directory; the packages script installs packages. Both have to be free to
 *    run twice, and the home one has to roll back rather than leave a home
 *    between two paths.
 * 3. **The agent key is a PUBLIC key.** A path that is not `.pub`, or content
 *    that is not one ssh key line, is refused — because this string lands in a
 *    root script.
 * 4. **The work happens as the agent, over ssh.** The install task must never
 *    run as the primary user, and a LOCAL machine must refuse rather than
 *    pretend (C-6).
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "#config/index";
import type { MachineInfo } from "#services/machine";
import { agentRunnerFor, MachineError } from "#services/machine";
import {
	AgentKeyError,
	normalizePublicKey,
	readPublicKeyFile,
	resolveAgentKey,
} from "#services/machine/tasks/agent-key";
import {
	dockerHostLine,
	dockerRootlessInstall,
} from "#services/machine/tasks/docker-rootless-install";
import {
	dockerRootlessPackages,
	ROOTLESS_PACKAGES,
} from "#services/machine/tasks/docker-rootless-packages";
import {
	homePathPhysical,
	homePathSymlink,
	layoutProblem,
	PHYSICAL_LINE,
} from "#services/machine/tasks/home-path";
import { allTasks } from "#services/machine/tasks/index";
import { ensureBashrcLine } from "#services/machine/tasks/shell";
import type { TaskContext } from "#services/machine/tasks/types";
import {
	LocalMachine,
	RemoteMachine,
	type RunResult,
	type SpawnRequest,
	type SshOptions,
	targetWithUser,
} from "#services/remote";

const saved = process.env.HYPER_DRIVE_CONFIG;
afterEach(() => {
	if (saved === undefined) delete process.env.HYPER_DRIVE_CONFIG;
	else process.env.HYPER_DRIVE_CONFIG = saved;
});

const KEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHyperdriveTestKeyForUnitOnly agent@hyper";

const MACHINE: MachineInfo = {
	name: "t17",
	host: "t17box",
	home: "/Users/svallory",
	features: [],
	agentUser: "agent",
	agentKey: "",
	source: "both",
	herdr: true,
};

/** A runner that records every command and answers from `rules` in order. */
function recordingRunner(rules: { match: string | RegExp; result: Partial<RunResult> }[] = []) {
	const snippets: string[] = [];
	const targets: string[] = [];
	const runner = {
		snippets,
		targets,
		get joined(): string {
			return snippets.join("\n");
		},
		async ssh(cmd: string[]): Promise<RunResult> {
			snippets.push(cmd[cmd.length - 1] ?? "");
			for (const rule of rules) {
				const hit =
					typeof rule.match === "string"
						? (cmd[cmd.length - 1] ?? "").includes(rule.match)
						: rule.match.test(cmd[cmd.length - 1] ?? "");
				if (hit)
					return {
						code: rule.result.code ?? 0,
						stdout: rule.result.stdout ?? "",
						stderr: rule.result.stderr ?? "",
					};
			}
			return { code: 0, stdout: "", stderr: "" };
		},
		async asUser(_user: string, cmd: string[]): Promise<RunResult> {
			targets.push(`asUser:${cmd.join(" ")}`);
			return { code: 0, stdout: "1001\n", stderr: "" };
		},
		async scp(): Promise<RunResult> {
			return { code: 0, stdout: "", stderr: "" };
		},
		async rsync(): Promise<RunResult> {
			return { code: 0, stdout: "", stderr: "" };
		},
	};
	return runner;
}

type Fake = ReturnType<typeof recordingRunner>;

function ctxFor(runner: Fake, over: Partial<TaskContext> = {}): TaskContext {
	return {
		machine: MACHINE,
		runner: runner as unknown as TaskContext["runner"],
		config: loadConfig(),
		log: () => {},
		...over,
	};
}

/** Commands that change the machine. A `check` containing one is a bug. */
const MUTATING = [
	"chmod",
	"chown",
	"setfacl",
	"mkdir",
	"rm ",
	"ln -s",
	"apt-get",
	"install ",
	"usermod",
	"loginctl enable",
	"touch",
	">>",
	"systemctl --user start",
	"systemctl --user stop",
];

function keyFile(contents: string, name = "id.pub"): string {
	const dir = mkdtempSync(join(tmpdir(), "t17-key-"));
	const path = join(dir, name);
	writeFileSync(path, contents);
	return path;
}

describe("the agent key is a public key, or it is nothing", () => {
	it("accepts one ssh public key line and drops an awkward comment", () => {
		expect(normalizePublicKey(`${KEY}\n`, "x")).toBe(KEY);
		expect(normalizePublicKey(`# a comment\n${KEY}\n`, "x")).toBe(KEY);
		// Free text after the key is a comment, and only a boring one survives: the
		// first word is kept, the rest is dropped rather than quoted.
		expect(normalizePublicKey(`${KEY} my laptop's key`, "x")).toBe(
			`ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHyperdriveTestKeyForUnitOnly agent@hyper`,
		);
	});

	it("refuses a private key, a second key, and a non-key file", () => {
		expect(() =>
			normalizePublicKey("-----BEGIN OPENSSH PRIVATE KEY-----\nAAAA\n", "id_ed25519"),
		).toThrow(/never reads, copies or installs a private key/);
		expect(() => normalizePublicKey(`${KEY}\n${KEY}\n`, "x")).toThrow(/1 key line|2 key lines/);
		expect(() => normalizePublicKey("hunter2\n", "x")).toThrow(/does not hold an ssh public key/);
		const path = keyFile(KEY, "id_ed25519");
		try {
			expect(() => readPublicKeyFile(path)).toThrow(/never reads a private key/);
		} finally {
			rmSync(join(path, ".."), { recursive: true, force: true });
		}
	});

	it("takes the flag, then the machine config, then this machine's default key", () => {
		const flagged = keyFile(KEY);
		try {
			expect(resolveAgentKey(ctxFor(recordingRunner(), { agentKeyFile: flagged }))).toEqual({
				key: KEY,
				source: flagged,
			});
			const configured = keyFile(KEY, "other.pub");
			expect(
				resolveAgentKey(
					ctxFor(recordingRunner(), { machine: { ...MACHINE, agentKey: configured } }),
				).source,
			).toBe(configured);
		} finally {
			for (const path of [flagged, join(flagged, "..")]) {
				rmSync(path, { recursive: true, force: true });
			}
		}
	});

	it("says which file to use when there is no key anywhere", () => {
		const runner = recordingRunner();
		const ctx = ctxFor(runner, { machine: { ...MACHINE, agentKey: "/nonexistent/nope.pub" } });
		expect(() => resolveAgentKey(ctx)).toThrow(AgentKeyError);
		expect(() => resolveAgentKey(ctx)).toThrow(/--agent-key/);
	});
});

describe("docker-rootless.packages", () => {
	it("is a root task in the docker-rootless feature", () => {
		expect(dockerRootlessPackages.id).toBe("docker-rootless.packages");
		expect(dockerRootlessPackages.feature).toBe("docker-rootless");
		expect(dockerRootlessPackages.needsRoot).toBe(true);
		expect(allTasks().map((task) => task.id)).toContain("docker-rootless.packages");
		expect(ROOTLESS_PACKAGES).toContain("docker-ce");
		expect(ROOTLESS_PACKAGES).toContain("docker-ce-rootless-extras");
	});

	it("probes read-only", async () => {
		const runner = recordingRunner([{ match: "dpkg-query", result: { stdout: "" } }]);
		await dockerRootlessPackages.check(ctxFor(runner, { agentKeyFile: keyFile(KEY) }));
		expect(runner.joined).not.toBe("");
		for (const verb of MUTATING) {
			expect(runner.joined, verb).not.toContain(verb);
		}
	});

	it("refuses a bad agent name before it probes anything", async () => {
		const runner = recordingRunner();
		const hostile = ctxFor(runner, {
			machine: { ...MACHINE, agentUser: "root" },
			agentKeyFile: keyFile(KEY),
		});
		await expect(dockerRootlessPackages.check(hostile)).rejects.toThrow(/uid 0|unattended agent/);
	});

	it("writes a guarded, idempotent root script", () => {
		const runner = recordingRunner();
		const script = dockerRootlessPackages.rootScript?.(
			ctxFor(runner, { agentKeyFile: keyFile(KEY) }),
		);
		expect(script).toBeDefined();
		const text = script ?? "";
		// The repository is added only when a package is missing, and only once.
		expect(text).toContain("have_package()");
		expect(text).toContain("if ! have_package docker-ce-rootless-extras; then");
		expect(text).toContain(
			"https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc",
		);
		expect(text).toContain("signed-by=/etc/apt/keyrings/docker.asc");
		expect(text).toContain("docs.docker.com documents it for");
		// Packages: installed only when missing.
		expect(text).toContain(
			'have_package "$package" || missing_packages="$missing_packages $package"',
		);
		// subid ranges: each added only when absent, each file on its own.
		expect(text).toContain('if ! grep -q "^$agent_user:" /etc/subuid 2>/dev/null; then');
		expect(text).toContain('usermod --add-subuids 100000-165535 "$agent_user"');
		expect(text).toContain('if ! grep -q "^$agent_user:" /etc/subgid 2>/dev/null; then');
		expect(text).toContain('usermod --add-subgids 100000-165535 "$agent_user"');
		expect(text).not.toMatch(/--add-subuids[^\n]*--add-subgids/);
		// The system-wide daemon docker-ce brings is stopped only when this script
		// brought docker-ce in.
		expect(text).toContain('if [ "$had_docker_ce" = 0 ] && have_package docker-ce; then');
		expect(text).toContain("systemctl disable --now docker.service docker.socket");
		// Linger and the key.
		expect(text).toContain('loginctl enable-linger "$agent_user"');
		expect(text).toContain('runuser -u "$agent_user" --');
		expect(text).toContain('grep -qxF "$key"');
		// The agent's own home: refused on a symlink, written by the agent.
		expect(text).toContain("refusing agent ssh key setup");
		// Never a privilege command: this task only ever hands the user a script.
		// (SUDO_USER appears, in the guards every generated root script carries.)
		expect(text).not.toMatch(/^\s*sudo /m);
	});

	it("is satisfied only when every package, both ranges, linger and the key are there", async () => {
		const good = [
			...ROOTLESS_PACKAGES.map((name) => `pkg_${name}=1`),
			"subuid=1",
			"subgid=1",
			"linger=yes",
			"agent_key=1",
		].join("\n");
		const runner = recordingRunner([{ match: "dpkg-query", result: { stdout: good } }]);
		expect(await dockerRootlessPackages.check(ctxFor(runner, { agentKeyFile: keyFile(KEY) }))).toBe(
			true,
		);
		const missing = good.replace("subgid=1", "subgid=0");
		const lines: string[] = [];
		const second = recordingRunner([{ match: "dpkg-query", result: { stdout: missing } }]);
		expect(
			await dockerRootlessPackages.check(
				ctxFor(second, { agentKeyFile: keyFile(KEY), log: (line) => lines.push(line) }),
			),
		).toBe(false);
		expect(lines.join("\n")).toContain("subuid or subgid range");
	});
});

describe("docker-rootless.install", () => {
	it("is not a root task and names the agent's own unit", () => {
		expect(dockerRootlessInstall.needsRoot).toBe(false);
		expect(dockerRootlessInstall.feature).toBe("docker-rootless");
		expect(dockerHostLine("1001")).toBe('export DOCKER_HOST="unix:///run/user/1001/docker.sock"');
		expect(allTasks().map((task) => task.id)).toContain("docker-rootless.install");
	});

	it("opens the agent's session through machine.ts, not by hand", async () => {
		const seen: SpawnRequest[] = [];
		const spawner = async (request: SpawnRequest): Promise<RunResult> => {
			seen.push(request);
			// ssh gets ONE command string, so the uid probe is matched as text.
			if (request.args.join(" ").endsWith("id -u"))
				return { code: 0, stdout: "1001\n", stderr: "" };
			return {
				code: 0,
				stdout: "unit=yes\nenabled=disabled\nactive=inactive\nbashrc=1\n",
				stderr: "",
			};
		};
		expect(await dockerRootlessInstall.check(ctxFor(recordingRunner(), { spawner }))).toBe(true);
		// Every command went to the AGENT's ssh target, never the primary's.
		expect(seen.length).toBeGreaterThan(0);
		for (const request of seen) expect(request.args[0]).toBe("agent@t17box");
	});

	it("says the key is missing when it cannot even open a session as the agent", async () => {
		const spawner = async (): Promise<RunResult> => ({
			code: 255,
			stdout: "",
			stderr: "Permission denied (publickey).",
		});
		const lines: string[] = [];
		expect(
			await dockerRootlessInstall.check(
				ctxFor(recordingRunner(), { spawner, log: (line) => lines.push(line) }),
			),
		).toBe(false);
		expect(lines.join("\n")).toContain("authorized_keys");
	});

	it("is settled by the disabled unit and the DOCKER_HOST line, never by the daemon running", async () => {
		// The install task builds its OWN runner (the agent's), so these answers
		// come from the spawner, not from the recording runner in ctx.
		const answering =
			(active: string, bashrc: string, enabled = "disabled") =>
			async (request: SpawnRequest): Promise<RunResult> =>
				request.args.join(" ").endsWith("id -u")
					? { code: 0, stdout: "1001\n", stderr: "" }
					: {
							code: 0,
							stdout: `unit=yes\nenabled=${enabled}\nactive=${active}\nbashrc=${bashrc}\n`,
							stderr: "",
						};
		expect(
			await dockerRootlessInstall.check(
				ctxFor(recordingRunner(), { spawner: answering("inactive", "1") }),
			),
		).toBe(true);
		// Running is not settled: the line and the disabled unit are still required.
		expect(
			await dockerRootlessInstall.check(
				ctxFor(recordingRunner(), { spawner: answering("active", "0") }),
			),
		).toBe(false);
		expect(
			await dockerRootlessInstall.check(
				ctxFor(recordingRunner(), { spawner: answering("active", "1", "enabled") }),
			),
		).toBe(false);
		expect(
			await dockerRootlessInstall.check(
				ctxFor(recordingRunner(), { spawner: answering("active", "1") }),
			),
		).toBe(true);
		const noLine: string[] = [];
		expect(
			await dockerRootlessInstall.check(
				ctxFor(recordingRunner(), {
					spawner: answering("inactive", "0"),
					log: (line) => noLine.push(line),
				}),
			),
		).toBe(false);
		expect(noLine.join("\n")).toContain("docker.sock");
		const enabled: string[] = [];
		expect(
			await dockerRootlessInstall.check(
				ctxFor(recordingRunner(), {
					spawner: answering("inactive", "1", "enabled"),
					log: (line) => enabled.push(line),
				}),
			),
		).toBe(false);
		expect(enabled.join("\n")).toContain("not disabled");
	});

	it("refuses a local machine by name rather than pretending", () => {
		expect(() => agentRunnerFor(null, "agent")).toThrow(MachineError);
		expect(() => agentRunnerFor(null, "agent")).toThrow(/never runs as root/);
	});
});

describe("home-path", () => {
	const target = "/Users/svallory";

	it("only treats the finished layout as settled", () => {
		expect(
			layoutProblem({ passwdHome: target, legacy: "symlink", target: "dir" }, target, "svallory"),
		).toBe(null);
		expect(
			layoutProblem({ passwdHome: target, legacy: "absent", target: "dir" }, target, "svallory"),
		).toBe("missing-symlink");
		expect(
			layoutProblem(
				{ passwdHome: "/home/svallory", legacy: "dir", target: "absent" },
				target,
				"svallory",
			),
		).toBe("move");
		// Interrupted after the passwd step (or that step done by hand): finish it.
		expect(
			layoutProblem({ passwdHome: target, legacy: "dir", target: "absent" }, target, "svallory"),
		).toBe("move");
		expect(
			layoutProblem({ passwdHome: target, legacy: "dir", target: "dir" }, target, "svallory"),
		).toMatch(/real directory/);
		// The refusals: both are states a careless script would "fix".
		expect(
			layoutProblem(
				{ passwdHome: "/home/svallory", legacy: "dir", target: "dir" },
				target,
				"svallory",
			),
		).toMatch(/already exists as a real directory/);
		expect(
			layoutProblem(
				{ passwdHome: "/home/svallory", legacy: "symlink", target: "absent" },
				target,
				"svallory",
			),
		).toMatch(/is a symlink/);
		expect(
			layoutProblem({ passwdHome: "/root", legacy: "dir", target: "absent" }, target, "svallory"),
		).toMatch(/neither/);
	});

	it("refuses a machine whose config does not ask for a /Users home", async () => {
		const runner = recordingRunner([{ match: /^id -un$/, result: { stdout: "svallory\n" } }]);
		await expect(
			homePathSymlink.check(ctxFor(runner, { machine: { ...MACHINE, home: "/home/svallory" } })),
		).rejects.toThrow(/home = `\/Users\/svallory`|doesn't say so/);
	});

	it("reads the layout without changing anything", async () => {
		const runner = recordingRunner([
			{ match: /^id -un$/, result: { stdout: "svallory\n" } },
			{
				match: "passwd_home=",
				result: {
					stdout: "passwd_home=/Users/svallory\nlegacy=symlink\ntarget=dir\nphysical=1\n",
				},
			},
		]);
		expect(await homePathSymlink.check(ctxFor(runner))).toBe(true);
		for (const verb of MUTATING) expect(runner.joined, verb).not.toContain(verb);
	});

	it("writes a root script that checks before it moves and rolls back after", () => {
		// The text half. `machine-home-path-script.test.ts` RUNS this script in
		// a sandbox; this pins the order a reader of the file sees.
		const text = homePathSymlink.rootScript?.(ctxFor(recordingRunner())) ?? "";
		expect(text).toContain("nothing has been changed");
		const checks = [
			'"$legacy_home is not a real directory',
			'home_path_refuse "$target_home already exists',
			"different filesystems",
			'pgrep -u "$name"',
			'usermod -d "$target_home" "$name"',
			'mv "$legacy_home" "$target_home"',
		].map((needle) => text.indexOf(needle));
		expect(checks.every((at) => at > 0)).toBe(true);
		expect(checks).toEqual([...checks].sort((a, b) => a - b));
		// Rollback for each step after the usermod.
		expect(text).toContain('usermod -d "$legacy_home" "$name"');
		expect(text).toContain('mv "$target_home" "$legacy_home"');
		// One function, returned from: never an exit 0 that ends the assembled script.
		expect(text).not.toMatch(/exit 0/);
		expect(text).not.toContain("sudo");
	});

	it("writes the physical-cd line once, sharing the helper with agent-user.dirs", async () => {
		const script = ensureBashrcLine("/home/svallory/.bashrc", PHYSICAL_LINE);
		expect(script).toContain("grep -qxF 'set -o physical'");
		expect(script).toContain(">> /home/svallory/.bashrc");
		const runner = recordingRunner([{ match: "set -o physical", result: { stdout: "1\n" } }]);
		expect(
			await homePathPhysical.check(
				ctxFor(runner, { machine: { ...MACHINE, home: "/home/svallory" } }),
			),
		).toBe(true);
		await homePathPhysical.apply(
			ctxFor(recordingRunner(), { machine: { ...MACHINE, home: "/home/svallory" } }),
		);
	});

	it("never creates the home just to write the line into it", async () => {
		// `touch` is the first thing ensureBashrcLine does, and on a machine whose
		// home is still /home/svallory that would CREATE /Users/svallory and make
		// the move refuse its own target.
		const runner = recordingRunner([{ match: "test -d", result: { stdout: "no\n" } }]);
		const lines: string[] = [];
		await homePathPhysical.apply(
			ctxFor(runner, {
				machine: { ...MACHINE, home: "/Users/svallory" },
				log: (line) => lines.push(line),
			}),
		);
		expect(runner.joined).not.toContain(".bashrc");
		expect(lines.join("\n")).toContain("run the home-path root script first");
		const present = recordingRunner([{ match: "test -d", result: { stdout: "yes\n" } }]);
		await homePathPhysical.apply(
			ctxFor(present, { machine: { ...MACHINE, home: "/Users/svallory" } }),
		);
		expect(present.joined).toContain("/Users/svallory/.bashrc");
	});
});

describe("the as-agent runner", () => {
	it("replaces the user in the ssh target, not appends to it", () => {
		expect(targetWithUser("svallory@box", "agent")).toBe("agent@box");
		expect(targetWithUser("box", "agent")).toBe("agent@box");
		expect(targetWithUser("t17box", "agent")).toBe("agent@t17box");
		expect(() => targetWithUser("box", "agent; rm -rf /")).toThrow(/isn't a user/);
	});

	it("spawns ssh with the substituted target and never with a privilege word", async () => {
		const seen: SpawnRequest[] = [];
		const machine = new RemoteMachine("svallory@box", async (request) => {
			seen.push(request);
			return { code: 0, stdout: "1001\n", stderr: "" };
		});
		await machine.asUser("agent", ["id", "-u"]);
		expect(seen[0].file).toBe("ssh");
		expect(seen[0].args[0]).toBe("agent@box");
		expect(seen[0].args).not.toContain("sudo");
	});

	it("refuses locally, because becoming another user needs root", async () => {
		await expect(new LocalMachine().asUser("agent", ["id"])).rejects.toThrow(/never runs as root/);
	});

	it("is reachable from a task context as another user", async () => {
		const seen: SpawnRequest[] = [];
		const machine = new RemoteMachine("svallory@box", async (request) => {
			seen.push(request);
			return { code: 0, stdout: "", stderr: "" };
		});
		await machine.ssh(["sh", "-c", "id -u"], {} as SshOptions);
		await machine.asUser("agent", ["id", "-u"]);
		expect(seen[0].args[0]).toBe("svallory@box");
		expect(seen[1].args[0]).toBe("agent@box");
		// machine.ts builds the same target from a Herdr alias.
		expect(agentRunnerFor(MACHINE, "agent").host).toBe("agent@t17box");
	});
});
