/**
 * T-17: docker-rootless.packages' root script and check, EXECUTED.
 *
 * The same sandbox idea as `machine-home-path-script.test.ts`: the real
 * rendered script runs in bash inside a temp directory.
 *
 * - `/etc/subuid` and `/etc/subgid` are rewritten to temp files, and the test
 *   refuses to run a script that still names either real file;
 * - everything that would touch the system (`apt-get`, `curl`, `install`,
 *   `chmod`, `dpkg`, `systemctl`, `loginctl`, `runuser`, `usermod`, `id`,
 *   `dpkg-query`, `command -v dockerd`) is a bash function that records its call
 *   and answers from the test's fixture. `usermod --add-sub[ug]ids` really
 *   appends to the temp files, so the ranges asserted are the ones the script
 *   computed, not a mock's.
 *
 * The check's probe runs the same way (`sh -c`, same rewrite), so check and
 * script are tested on the same files.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "#config/index";
import type { MachineInfo } from "#services/machine";
import { assembleRootScript } from "#services/machine/root-script";
import {
	dockerRootlessPackages,
	ROOTLESS_PACKAGES,
} from "#services/machine/tasks/docker-rootless-packages";
import type { TaskContext } from "#services/machine/tasks/types";
import type { RunResult, SpawnRequest } from "#services/remote";

const KEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHyperdriveTestKeyForUnitOnly agent@hyper";

const MACHINE: MachineInfo = {
	name: "t17",
	host: "svallory@t17box",
	home: "/Users/svallory",
	features: [],
	agentUser: "agent",
	agentKey: "",
	source: "both",
	herdr: true,
};

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

interface Fixture {
	subuid: string;
	subgid: string;
	/** Packages dpkg-query reports as installed. */
	installed?: readonly string[];
	/** What `command -v dockerd` prints (empty: not found). */
	dockerd?: string;
	/** `systemctl show -p LoadState --value docker.service`. */
	dockerUnit?: "loaded" | "not-found";
	/** An executable at /snap/bin/docker (created inside the sandbox). */
	snapBin?: boolean;
	/** `snap list docker` exits 0. */
	snapList?: boolean;
	/** `systemctl show -p LoadState --value snap.docker.dockerd.service`. */
	snapUnit?: "loaded" | "not-found";
}

interface Sandbox {
	root: string;
	calls(): string[];
	subuid(): string;
	subgid(): string;
	runScript(): { code: number; stdout: string; stderr: string };
	ctx(): TaskContext;
}

const ALL_PACKAGES = [...ROOTLESS_PACKAGES, "ca-certificates"];

function sandbox(fixture: Fixture): Sandbox {
	const root = mkdtempSync(join(tmpdir(), "t17-packages-"));
	dirs.push(root);
	// Every /etc path in the script lands under the sandbox: the subid files, the
	// apt source list and keyring, os-release.
	mkdirSync(join(root, "etc", "apt", "sources.list.d"), { recursive: true });
	writeFileSync(join(root, "etc", "os-release"), "VERSION_CODENAME=trixie\n");
	const subuid = join(root, "etc", "subuid");
	const subgid = join(root, "etc", "subgid");
	const calls = join(root, "calls");
	writeFileSync(subuid, fixture.subuid);
	writeFileSync(subgid, fixture.subgid);
	writeFileSync(calls, "");
	if (fixture.snapBin === true) {
		mkdirSync(join(root, "snap", "bin"), { recursive: true });
		writeFileSync(join(root, "snap", "bin", "docker"), "#!/bin/sh\n", { mode: 0o755 });
	}
	const keyFile = join(root, "id.pub");
	writeFileSync(keyFile, `${KEY}\n`);

	const installed = (fixture.installed ?? ALL_PACKAGES).join(" ");
	const stubs = `
record() { printf '%s\\n' "$*" >> ${JSON.stringify(calls)}; }
dpkg-query() {
  local package
  for package; do :; done
  case " ${installed} " in
    *" $package "*) printf 'install ok installed' ;;
    *) return 1 ;;
  esac
}
id() {
  case "$2" in
    agent) echo 1001 ;;
    svallory) echo 1000 ;;
    *) return 1 ;;
  esac
}
usermod() {
  record usermod "$@"
  local file
  case "$1" in
    --add-subuids) file=${JSON.stringify(subuid)} ;;
    --add-subgids) file=${JSON.stringify(subgid)} ;;
    *) return 2 ;;
  esac
  local first="\${2%-*}" last="\${2#*-}"
  printf '%s:%s:%s\\n' "$3" "$first" "$((last - first + 1))" >> "$file"
}
command() {
  if [ "$1" = -v ] && [ "$2" = dockerd ]; then
    [ -n "${fixture.dockerd ?? ""}" ] || return 1
    echo ${JSON.stringify(fixture.dockerd ?? "")}
    return 0
  fi
  if [ "$1" = -v ] && [ "$2" = curl ]; then echo /usr/bin/curl; return 0; fi
  builtin command "$@"
}
systemctl() {
  record systemctl "$@"
  if [ "$1" = show ]; then
    case " $* " in
      *" snap.docker.dockerd.service "*) echo ${JSON.stringify(fixture.snapUnit ?? "not-found")} ;;
      *) echo ${JSON.stringify(fixture.dockerUnit ?? "not-found")} ;;
    esac
  fi
  return 0
}
snap() {
  if [ "$1" = list ] && [ "$2" = docker ]; then
    ${fixture.snapList === true ? "return 0" : "return 1"}
  fi
  return 1
}
apt-get() { record apt-get "$@"; }
curl() { record curl "$@"; }
install() { record install "$@"; }
chmod() { record chmod "$@"; }
dpkg() { record dpkg "$@"; echo arm64; }
loginctl() { record loginctl "$@"; [ "$1" = show-user ] && echo yes; return 0; }
runuser() { record runuser "$1" "$2"; }
`;

	const ctx = (): TaskContext => ({
		machine: MACHINE,
		config: loadConfig(),
		log: () => {},
		agentKeyFile: keyFile,
		runner: {
			// The check's probe, run for real on the same rewritten files.
			async ssh(cmd: string[]): Promise<RunResult> {
				const script = rewrite(cmd[cmd.length - 1] ?? "");
				const result = spawnSync("bash", ["-c", `${stubs}\n${script}`], { encoding: "utf8" });
				return { code: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
			},
		} as unknown as TaskContext["runner"],
		// The agent holds the key: that half is not what this file tests.
		spawner: async (_request: SpawnRequest) => ({ code: 0, stdout: "1\n", stderr: "" }),
	});

	function rewrite(text: string): string {
		const rewritten = text
			.replaceAll("/etc/", `${root}/etc/`)
			.replaceAll("/snap/", `${root}/snap/`);
		// Never run a script that could still reach the real /etc.
		expect(rewritten.replaceAll(`${root}/etc/`, "")).not.toContain("/etc/");
		return rewritten;
	}

	return {
		root,
		calls: () => readFileSync(calls, "utf8").split("\n").filter(Boolean),
		subuid: () => readFileSync(subuid, "utf8"),
		subgid: () => readFileSync(subgid, "utf8"),
		ctx,
		runScript() {
			const text = dockerRootlessPackages.rootScript?.(ctx()) ?? "";
			const assembled = assembleRootScript([{ task: dockerRootlessPackages, script: text }], ctx());
			const script = rewrite(assembled).replace(
				"set -euo pipefail\n",
				`set -euo pipefail\n${stubs}\n`,
			);
			const file = join(root, "root.sh");
			writeFileSync(file, script);
			const result = spawnSync("bash", [file], {
				encoding: "utf8",
				env: { PATH: process.env.PATH ?? "/usr/bin:/bin", SUDO_USER: "svallory" },
			});
			return { code: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
		},
	};
}

const PRIMARY_ONLY = "svallory:100000:65536\n";

describe("the agent's subid range is allocated, never fixed", () => {
	it("gives an agent with no range the next free one, the same in both files (the review's case)", async () => {
		const box = sandbox({ subuid: PRIMARY_ONLY, subgid: PRIMARY_ONLY });
		const result = box.runScript();
		expect(result.stderr).toBe("");
		expect(result.code).toBe(0);
		expect(box.subuid()).toBe(`${PRIMARY_ONLY}agent:165536:65536\n`);
		expect(box.subgid()).toBe(`${PRIMARY_ONLY}agent:165536:65536\n`);
		// …and the check, on the same files, is now satisfied about the ranges.
		await expect(dockerRootlessPackages.check(box.ctx())).resolves.toBe(true);
	});

	it("treats an absent subgid file as empty during the bounded preflight", () => {
		const box = sandbox({ subuid: PRIMARY_ONLY, subgid: "" });
		rmSync(join(box.root, "etc", "subgid"));
		expect(box.runScript().code).toBe(0);
		expect(box.subuid()).toBe(`${PRIMARY_ONLY}agent:165536:65536\n`);
		expect(box.subgid()).toBe("agent:165536:65536\n");
	});

	it("starts above the highest range in EITHER file, never below 100000", () => {
		const box = sandbox({
			subuid: "svallory:100000:65536\nother:300000:65536\n",
			subgid: "svallory:100000:65536\nthird:500000:1000\n",
		});
		expect(box.runScript().code).toBe(0);
		expect(box.subuid()).toContain("agent:501000:65536");
		expect(box.subgid()).toContain("agent:501000:65536");
		const empty = sandbox({ subuid: "", subgid: "" });
		expect(empty.runScript().code).toBe(0);
		expect(empty.subuid()).toBe("agent:100000:65536\n");
	});

	it("refuses an agent range that overlaps another user's, naming both lines, and changes nothing", async () => {
		const overlapping = `${PRIMARY_ONLY}agent:100000:65536\n`;
		const box = sandbox({
			subuid: overlapping,
			subgid: "svallory:100000:65536\nagent:165536:65536\n",
		});
		const result = box.runScript();
		expect(result.code).not.toBe(0);
		expect(result.stderr).toContain("agent:100000:65536 overlaps svallory:100000:65536");
		expect(result.stderr).toContain("nothing has been changed");
		expect(box.subuid()).toBe(overlapping);
		// The snap unit probe is read-only; no write happened before refusal.
		expect(box.calls().filter((call) => !call.startsWith("systemctl show"))).toEqual([]);
		// The check calls it a refusal, not "needs root".
		await expect(dockerRootlessPackages.check(box.ctx())).rejects.toThrow(
			/overlaps another user's \(agent:100000:65536 overlaps svallory:100000:65536\)/,
		);
	});

	it("matches the agent by uid as well as by name", () => {
		const box = sandbox({ subuid: `${PRIMARY_ONLY}1001:120000:10\n`, subgid: PRIMARY_ONLY });
		const result = box.runScript();
		expect(result.code).not.toBe(0);
		expect(result.stderr).toContain("1001:120000:10 overlaps svallory:100000:65536");
	});

	it("leaves a non-overlapping range alone, and fills only the missing file", () => {
		const box = sandbox({
			subuid: `${PRIMARY_ONLY}agent:200000:65536\n`,
			subgid: PRIMARY_ONLY,
		});
		expect(box.runScript().code).toBe(0);
		expect(box.subuid()).toBe(`${PRIMARY_ONLY}agent:200000:65536\n`);
		// The uid range's start was free in subgid, so the two stay the same.
		expect(box.subgid()).toBe(`${PRIMARY_ONLY}agent:200000:65536\n`);
		expect(box.calls().filter((call) => call.startsWith("usermod"))).toEqual([
			"usermod --add-subgids 200000-265535 agent",
		]);

		// When that start is taken in subgid, the next free one instead.
		const taken = sandbox({
			subuid: `${PRIMARY_ONLY}agent:200000:65536\n`,
			subgid: `${PRIMARY_ONLY}someone:200000:65536\n`,
		});
		expect(taken.runScript().code).toBe(0);
		expect(taken.subgid()).toContain("agent:265536:65536");
	});

	it("adds nothing on a second run", () => {
		const box = sandbox({ subuid: PRIMARY_ONLY, subgid: PRIMARY_ONLY });
		expect(box.runScript().code).toBe(0);
		const before = [box.subuid(), box.subgid()];
		expect(box.runScript().code).toBe(0);
		expect([box.subuid(), box.subgid()]).toEqual(before);
	});

	it("refuses a start near 2^32 with a clear message instead of usermod's, changing nothing", () => {
		// The highest range ends at 4294967296: no room for 65536 more ids
		// before the end of the 32-bit id space. Measured on the review's
		// container: usermod exits 3 with "invalid subordinate uid range".
		// With packages missing, a late check would have added an apt repository
		// before saying "nothing has been changed". The preflight must run first.
		const box = sandbox({
			subuid: "svallory:4294901760:65536\n",
			subgid: PRIMARY_ONLY,
			installed: ["uidmap"],
		});
		const result = box.runScript();
		expect(result.code).not.toBe(0);
		expect(result.stderr).toContain("no room for a new 65536-id subordinate uid range");
		expect(result.stderr).toContain("nothing has been changed");
		expect(result.stderr).not.toContain("invalid subordinate");
		expect(box.subuid()).toBe("svallory:4294901760:65536\n");
		expect(box.subgid()).toBe(PRIMARY_ONLY);
		expect(
			box
				.calls()
				.filter((call) =>
					/^(apt-get|curl|install|chmod|dpkg|usermod|loginctl|runuser)\b/.test(call),
				),
		).toEqual([]);
		expect(existsSync(join(box.root, "etc", "apt", "sources.list.d", "docker.list"))).toBe(false);
	});

	it("refuses the gid-only-missing case the same way", () => {
		const box = sandbox({
			subuid: `${PRIMARY_ONLY}agent:200000:65536\n`,
			// The uid start is taken, and the next free start has no room.
			subgid: `${PRIMARY_ONLY}someone:200000:65536\nother:4294901760:65536\n`,
		});
		const result = box.runScript();
		expect(result.code).not.toBe(0);
		expect(result.stderr).toContain("no room for a new 65536-id subordinate gid range");
		expect(result.stderr).toContain("nothing has been changed");
		expect(box.subgid()).toContain("someone:200000:65536");
	});

	it("accepts the last valid start exactly (start + 65535 = 2^32 - 1)", () => {
		// The highest range ends at 4294901760, so the next free start IS the
		// last one a 65536-id range may have.
		const box = sandbox({
			subuid: "svallory:4294836224:65536\n",
			subgid: "svallory:4294836224:65536\n",
		});
		expect(box.runScript().code).toBe(0);
		expect(box.subuid()).toContain("agent:4294901760:65536");
		expect(box.subgid()).toContain("agent:4294901760:65536");
	});
});

describe("an existing Docker engine is detected before apt is touched", () => {
	const touches = (calls: string[]) =>
		calls.filter((call) =>
			/^(apt-get|curl|install|chmod|dpkg|usermod|loginctl|runuser)\b/.test(call),
		);

	it("refuses over Debian's docker.io and changes nothing (no repo, no key, no packages)", async () => {
		const box = sandbox({
			subuid: PRIMARY_ONLY,
			subgid: PRIMARY_ONLY,
			installed: ["docker.io", "uidmap"],
			dockerd: "/usr/sbin/dockerd",
			dockerUnit: "loaded",
		});
		const result = box.runScript();
		expect(result.code).not.toBe(0);
		expect(result.stderr).toContain("hyper:   - the docker.io package");
		expect(result.stderr).toContain(
			"/usr/sbin/dockerd (a dockerd that does not come from docker-ce)",
		);
		expect(result.stderr).toContain("apt REMOVE that engine");
		expect(result.stderr).toContain(
			"nothing has been changed (no apt repository, no key, no packages)",
		);
		expect(touches(box.calls())).toEqual([]);
		expect(
			box
				.calls()
				.filter((call) => call.startsWith("systemctl") && !call.startsWith("systemctl show")),
		).toEqual([]);
		expect(box.subuid()).toBe(PRIMARY_ONLY);
		// The check: a refusal naming what it found, never "needs root".
		await expect(dockerRootlessPackages.check(box.ctx())).rejects.toThrow(
			/already has a Docker engine that is not docker-ce: the docker\.io package.*Nothing has been changed/,
		);
	});

	it("refuses moby-engine, podman-docker, a bare dockerd and a foreign docker.service too", () => {
		for (const fixture of [
			{ installed: ["moby-engine"], expected: "the moby-engine package" },
			{ installed: ["podman-docker"], expected: "the podman-docker package" },
			{ installed: [], dockerd: "/usr/local/bin/dockerd", expected: "/usr/local/bin/dockerd" },
			{
				installed: [],
				dockerUnit: "loaded" as const,
				expected: "a docker.service unit that does not come from docker-ce",
			},
		]) {
			const box = sandbox({ subuid: PRIMARY_ONLY, subgid: PRIMARY_ONLY, ...fixture });
			const result = box.runScript();
			expect(result.code, fixture.expected).not.toBe(0);
			expect(result.stderr).toContain(fixture.expected);
			expect(touches(box.calls())).toEqual([]);
		}
	});

	it("refuses a snap-installed Docker too, changing nothing (sudo's PATH has no /snap/bin)", async () => {
		for (const fixture of [
			{ snapBin: true, expected: "a snap-installed Docker" },
			{ snapList: true, expected: "the docker snap package" },
			{ snapUnit: "loaded" as const, expected: "a snap.docker.dockerd.service unit" },
		]) {
			const box = sandbox({ subuid: PRIMARY_ONLY, subgid: PRIMARY_ONLY, ...fixture });
			const result = box.runScript();
			expect(result.code, fixture.expected).not.toBe(0);
			expect(result.stderr).toContain(fixture.expected);
			expect(result.stderr).toContain("nothing has been changed");
			expect(touches(box.calls())).toEqual([]);
		}
		// The check calls it a refusal, never "needs root".
		const box = sandbox({ subuid: PRIMARY_ONLY, subgid: PRIMARY_ONLY, snapList: true });
		await expect(dockerRootlessPackages.check(box.ctx())).rejects.toThrow(
			/already has a Docker engine that is not docker-ce: the docker snap package.*Nothing has been changed/,
		);
	});

	it("reuses an installed docker-ce and leaves its system daemon exactly as it is", () => {
		const box = sandbox({
			subuid: PRIMARY_ONLY,
			subgid: PRIMARY_ONLY,
			installed: ["docker-ce", "uidmap", "dbus-user-session", "slirp4netns", "ca-certificates"],
			dockerd: "/usr/bin/dockerd",
			dockerUnit: "loaded",
		});
		const result = box.runScript();
		expect(result.stderr).toBe("");
		expect(result.code).toBe(0);
		// Only what was missing is installed…
		expect(box.calls()).toContain("apt-get install -y docker-ce-rootless-extras");
		// The repository was added inside the sandbox, and nowhere else.
		expect(existsSync(join(box.root, "etc", "apt", "sources.list.d", "docker.list"))).toBe(true);
		// …and its daemon is never stopped or disabled.
		expect(box.calls().some((call) => call.startsWith("systemctl disable"))).toBe(false);
	});
});
