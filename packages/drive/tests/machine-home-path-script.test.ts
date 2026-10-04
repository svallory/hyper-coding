/**
 * T-17: the home-path root script, EXECUTED.
 *
 * `machine-docker-home.test.ts` pins the script's text. Text cannot catch the
 * bug that stopped the container e2e for six runs: under the assembled script's
 * `set -euo pipefail`, `busy_pids="$(pgrep … | tr … | sed …)"` exits the whole
 * script, silently, in exactly the state that should succeed (the user has no
 * processes, so pgrep exits 1). So this file runs the real rendered script in
 * bash, inside a temp directory:
 *
 * - every `/home/` and `/Users/` in the script is rewritten under the temp dir,
 *   and the test refuses to run a script that still names either real prefix;
 * - the commands that would touch the real system (`getent`, `usermod`,
 *   `pgrep`, `stat`, `id`) are bash functions over a fake passwd file;
 * - `mv`, `ln` and `install` are the real ones, on the temp tree, so the move
 *   and its undo are what is asserted — not a mock of them.
 */

import { spawnSync } from "node:child_process";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readlinkSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "#config/index";
import type { MachineInfo } from "#services/machine";
import { assembleRootScript } from "#services/machine/root-script";
import { homePathSymlink } from "#services/machine/tasks/home-path";
import type { Task, TaskContext } from "#services/machine/tasks/types";

const NAME = "svallory";

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

const ctx: TaskContext = {
	machine: MACHINE,
	runner: {} as TaskContext["runner"],
	config: loadConfig(),
	log: () => {},
};

/** A section that has to run AFTER home-path's, in the same assembled script. */
const after: Task = {
	id: "zz.after",
	feature: "zz",
	needsRoot: true,
	title: "a later section",
	async check() {
		return true;
	},
	rootScript: () => 'echo "later section ran"',
};

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

interface Sandbox {
	root: string;
	legacy: string;
	target: string;
	passwd: string;
	run(env?: Record<string, string>): { code: number; stdout: string; stderr: string };
}

function sandbox(passwdHome: "legacy" | "target" = "legacy"): Sandbox {
	const root = mkdtempSync(join(tmpdir(), "t17-home-path-"));
	dirs.push(root);
	const legacy = join(root, "home", NAME);
	const target = join(root, "Users", NAME);
	mkdirSync(join(root, "home"), { recursive: true });
	const passwd = join(root, "passwd");
	writeFileSync(
		passwd,
		`${NAME}:x:1000:1000::${passwdHome === "legacy" ? legacy : target}:/bin/bash\n`,
	);

	const rendered = assembleRootScript(
		[
			{ task: homePathSymlink, script: homePathSymlink.rootScript?.(ctx) ?? "" },
			{ task: after, script: 'echo "later section ran"' },
		],
		ctx,
	);
	const rewritten = rendered
		.replaceAll("/home/", `${root}/home/`)
		.replaceAll("/Users/", `${root}/Users/`);
	// Never run a script that could still reach the real prefixes.
	const outside = rewritten.replaceAll(`${root}/home/`, "").replaceAll(`${root}/Users/`, "");
	expect(outside).not.toMatch(/\/home\/|\/Users\//);

	const stubs = `
getent() { grep "^$2:" ${JSON.stringify(passwd)}; }
id() { [ "$1" = -u ] || return 1; [ "$2" = ${NAME} ] && { echo 1000; return 0; }; return 1; }
stat() { echo 42; }
pgrep() {
  [ -n "\${BUSY:-}" ] || return 1
  printf '%s\\n' \${BUSY}
}
usermod() {
  [ "$1" = -d ] || return 2
  [ -z "\${BUSY:-}" ] || { echo "usermod: user $3 is currently used by process 1" >&2; return 8; }
  printf '%s:x:1000:1000::%s:/bin/bash\\n' "$3" "$2" > ${JSON.stringify(passwd)}
}
ln() { [ -z "\${LN_FAIL:-}" ] || return 1; command ln "$@"; }
mv() { [ -z "\${MV_FAIL:-}" ] || return 1; command mv "$@"; }
`;
	// The stubs go right after the strict-mode preamble, so the script still runs
	// under the exact `set -euo pipefail` the user gets.
	const script = rewritten.replace("set -euo pipefail\n", `set -euo pipefail\n${stubs}\n`);
	const file = join(root, "root.sh");
	writeFileSync(file, script);

	return {
		root,
		legacy,
		target,
		passwd,
		run(env = {}) {
			const result = spawnSync("bash", [file], {
				encoding: "utf8",
				env: { PATH: process.env.PATH ?? "/usr/bin:/bin", SUDO_USER: NAME, ...env },
			});
			return { code: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
		},
	};
}

function passwdHomeOf(box: Sandbox): string {
	return readFileSync(box.passwd, "utf8").split(":")[5] ?? "";
}

function homeWithFile(box: Sandbox): void {
	mkdirSync(box.legacy, { recursive: true });
	writeFileSync(join(box.legacy, ".bashrc"), "# mine\n");
}

describe("the home-path root script, run", () => {
	it("moves the home when the user has no processes, and the rest of the script still runs", () => {
		const box = sandbox();
		homeWithFile(box);
		const result = box.run();
		expect(result.stderr).toBe("");
		expect(result.code).toBe(0);
		expect(passwdHomeOf(box)).toBe(box.target);
		expect(lstatSync(box.target).isDirectory()).toBe(true);
		expect(readFileSync(join(box.target, ".bashrc"), "utf8")).toBe("# mine\n");
		expect(lstatSync(box.legacy).isSymbolicLink()).toBe(true);
		expect(readlinkSync(box.legacy)).toBe(box.target);
		expect(result.stdout).toContain("later section ran");
	});

	it("does nothing on a second run, and never ends the assembled script early", () => {
		const box = sandbox();
		homeWithFile(box);
		expect(box.run().code).toBe(0);
		const again = box.run();
		expect(again.code).toBe(0);
		expect(again.stdout).toContain("nothing to do");
		expect(again.stdout).toContain("later section ran");
		expect(readlinkSync(box.legacy)).toBe(box.target);
	});

	it("refuses while the user has processes, and changes nothing", () => {
		const box = sandbox();
		homeWithFile(box);
		const result = box.run({ BUSY: "101 202" });
		expect(result.code).not.toBe(0);
		expect(result.stderr).toContain("still has processes running (pids: 101 202)");
		expect(passwdHomeOf(box)).toBe(box.legacy);
		expect(lstatSync(box.legacy).isDirectory()).toBe(true);
		expect(existsSync(join(box.root, "Users"))).toBe(false);
	});

	it("finishes the move after the usermod was done by hand, as the refusal tells the user to", () => {
		// passwd already says /Users/<name>, the directory is still at /home/<name>,
		// and the user is still logged in (the refusal's advice): the mv needs no
		// usermod, so it must not refuse on the processes either.
		const box = sandbox("target");
		homeWithFile(box);
		const result = box.run({ BUSY: "101" });
		expect(result.stderr).toBe("");
		expect(result.code).toBe(0);
		expect(lstatSync(box.target).isDirectory()).toBe(true);
		expect(readlinkSync(box.legacy)).toBe(box.target);
		expect(passwdHomeOf(box)).toBe(box.target);
	});

	it("creates only the symlink when the move was done and the link was not", () => {
		const box = sandbox("target");
		mkdirSync(box.target, { recursive: true });
		const result = box.run();
		expect(result.code).toBe(0);
		expect(readlinkSync(box.legacy)).toBe(box.target);
	});

	it("undoes the move and the usermod when the symlink cannot be created", () => {
		const box = sandbox();
		homeWithFile(box);
		const result = box.run({ LN_FAIL: "1" });
		expect(result.code).not.toBe(0);
		expect(result.stderr).toContain("undone");
		expect(passwdHomeOf(box)).toBe(box.legacy);
		expect(lstatSync(box.legacy).isDirectory()).toBe(true);
		expect(readFileSync(join(box.legacy, ".bashrc"), "utf8")).toBe("# mine\n");
		expect(existsSync(box.target)).toBe(false);
	});

	it("puts the passwd entry back when the move itself fails", () => {
		const box = sandbox();
		homeWithFile(box);
		const result = box.run({ MV_FAIL: "1" });
		expect(result.code).not.toBe(0);
		expect(passwdHomeOf(box)).toBe(box.legacy);
		expect(lstatSync(box.legacy).isDirectory()).toBe(true);
		expect(existsSync(box.target)).toBe(false);
	});

	it("refuses every other shape without changing it", () => {
		// /Users/<name> already a real directory, home still at /home/<name>.
		const both = sandbox();
		homeWithFile(both);
		mkdirSync(both.target, { recursive: true });
		expect(both.run().code).not.toBe(0);
		expect(passwdHomeOf(both)).toBe(both.legacy);
		expect(lstatSync(both.legacy).isDirectory()).toBe(true);

		// /home/<name> is a symlink to somewhere else entirely.
		const linked = sandbox();
		mkdirSync(join(linked.root, "elsewhere"));
		symlinkTo(join(linked.root, "elsewhere"), linked.legacy);
		const refused = linked.run();
		expect(refused.code).not.toBe(0);
		expect(refused.stderr).toContain("nothing has been changed");
		expect(passwdHomeOf(linked)).toBe(linked.legacy);
		expect(existsSync(linked.target)).toBe(false);

		// /Users/<name> is a symlink: never write a home through it.
		const target = sandbox();
		homeWithFile(target);
		mkdirSync(join(target.root, "Users"));
		symlinkTo(join(target.root, "elsewhere"), target.target);
		expect(target.run().code).not.toBe(0);
		expect(passwdHomeOf(target)).toBe(target.legacy);
	});
});

function symlinkTo(destination: string, path: string): void {
	spawnSync("ln", ["-s", destination, path]);
}
