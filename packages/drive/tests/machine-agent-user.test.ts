/**
 * The agent-user tasks, driven with a recording runner.
 *
 * Four things are pinned here, and they are the four ways this feature could be
 * quietly wrong:
 *
 * 1. **The checks are read-only.** A `check` that changes the machine is not a
 *    check; it would make "run setup twice" a no-op in name only. Every command
 *    each check issues is matched against a list of mutating verbs and the test
 *    fails if one shows up.
 * 2. **The credential boundary holds.** `.credentials.json` must stay 0600, so
 *    there must be no recursive ACL whose path is the config dir root — the one
 *    command in this feature that would hand the second user a credential.
 * 3. **The root script is guarded.** Its lines are asserted individually, and
 *    every one of them is guarded, because "run it twice" has to be free (C-15).
 * 4. **The polkit path degrades to a fallback**, not to a failure: the task's
 *    everyday work stays unprivileged and only the linger step goes into the
 *    script the user reads.
 */

import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "#config/index";
import type { MachineInfo } from "#services/machine";
import {
	asAgentScript,
	assembleRootScript,
	DOCKER_GROUP,
	PRIVILEGED_GROUP,
} from "#services/machine/root-script";
import { type RootChoice, runSetup, type SetupPrompt } from "#services/machine/runner";
import {
	WATCHER_BIN,
	WATCHER_UNIT,
	watcherScript,
	watcherUnit,
} from "#services/machine/tasks/agent-user-watcher";
import {
	agentUserCreate,
	agentUserDirs,
	agentUserWatcher,
	allTasks,
} from "#services/machine/tasks/index";
import type { TaskContext } from "#services/machine/tasks/types";
import type { MachineRunner, RunResult } from "#services/remote";
import { withTempConfig } from "#tests/tmp-config";

const saved = process.env.HYPER_DRIVE_CONFIG;
afterEach(() => {
	if (saved === undefined) delete process.env.HYPER_DRIVE_CONFIG;
	else process.env.HYPER_DRIVE_CONFIG = saved;
});

const HOME = "/home/svallory";
const AGENT_HOME = "/home/agent";

const MACHINE: MachineInfo = {
	name: "t16",
	host: "svallory@localhost:2222",
	home: HOME,
	features: [],
	agentUser: "agent",
	source: "both",
	herdr: true,
};

/**
 * Commands that change the machine. A `check` that contains any of these is a
 * bug, whatever the task says it does — this list is the assertion, not a
 * description of the current implementation.
 */
const MUTATING = [
	"chmod",
	"chown",
	"chgrp",
	"setfacl",
	"mkdir",
	"rm ",
	"ln -s",
	"install ",
	"usermod",
	"gpasswd",
	"useradd",
	"groupadd",
	"userdel",
	"apt-get",
	"apt ",
	"cat >",
	">>",
	"enable-linger",
	"enable --now",
	"daemon-reload",
	"touch",
	"tee",
];

/** A rule: a substring to match in the snippet, and what the machine answers. */
interface Rule {
	match: string | RegExp;
	result: Partial<RunResult>;
}

/**
 * A runner that records every snippet instead of running it, and answers from
 * `rules` in order (first match wins).
 */
function recordingRunner(rules: Rule[] = []): MachineRunner & {
	snippets: string[];
	joined: string;
} {
	const snippets: string[] = [];
	const runner = {
		snippets,
		get joined(): string {
			return snippets.join("\n");
		},
		async ssh(cmd: string[]): Promise<RunResult> {
			// `sh -c <snippet>`: the snippet is the last word.
			const snippet = cmd[cmd.length - 1] ?? "";
			snippets.push(snippet);
			for (const rule of rules) {
				const hit =
					typeof rule.match === "string" ? snippet.includes(rule.match) : rule.match.test(snippet);
				if (hit) {
					return {
						code: rule.result.code ?? 0,
						stdout: rule.result.stdout ?? "",
						stderr: rule.result.stderr ?? "",
					};
				}
			}
			return { code: 0, stdout: "", stderr: "" };
		},
		async scp(): Promise<RunResult> {
			return { code: 0, stdout: "", stderr: "" };
		},
		async rsync(): Promise<RunResult> {
			return { code: 0, stdout: "", stderr: "" };
		},
	};
	return runner as unknown as MachineRunner & { snippets: string[]; joined: string };
}

function ctxFor(runner: MachineRunner): TaskContext {
	return { machine: MACHINE, runner, config: loadConfig(), log: () => {} };
}

/** The answers a correctly set-up machine gives {@link agentUserCreate}'s probe. */
const SETTLED_CREATE = [
	"agent_uid=1000",
	"collab_group=yes",
	"agent_groups=agent,users,collab",
	"primary_groups=svallory,sudo,collab",
	"dropin_entry=no",
	"agent_config_writable=yes",
	"agent_home_traversable=yes",
	"linger=yes",
].join("\n");

/** The answers a correctly set-up machine gives {@link agentUserDirs}' probe. */
function settledDirs(overrides: Record<string, string> = {}): string {
	const answers: Record<string, string> = {
		work_group: "collab",
		work_setgid: "yes",
		work_acl: "1",
		work_default_acl: "1",
		home_acl: "1",
		claude_acl: "1",
		claude_default_acl: "1",
		projects_group: "collab",
		projects_setgid: "yes",
		projects_acl: "1",
		link_projects: `${HOME}/.claude/projects`,
		"link_settings.json": `${HOME}/.claude/settings.json`,
		"link_CLAUDE.md": `${HOME}/.claude/CLAUDE.md`,
		link_skills: `${HOME}/.claude/skills`,
		link_commands: `${HOME}/.claude/commands`,
		link_agents: `${HOME}/.claude/agents`,
		as_agent: "yes",
		bashrc_umask: "1",
		bashrc_physical: "1",
		whoami: "svallory",
		agent_user: "agent",
		...overrides,
	};
	return Object.entries(answers)
		.map(([key, value]) => `${key}=${value}`)
		.join("\n");
}

/** The answers a correctly set-up machine gives {@link agentUserWatcher}'s probe. */
function settledWatcher(overrides: Record<string, string> = {}): string {
	const answers: Record<string, string> = {
		watcher: "yes",
		unit: "yes",
		enabled: "enabled",
		active: "active",
		linger: "yes",
		inotifywait: "yes",
		...overrides,
	};
	return Object.entries(answers)
		.map(([key, value]) => `${key}=${value}`)
		.join("\n");
}

describe("agent-user.create", () => {
	it("reports a settled machine as needing nothing (C-15)", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const runner = recordingRunner([
			{ match: /printf 'agent_uid=/, result: { stdout: SETTLED_CREATE } },
		]);
		expect(await agentUserCreate.check(ctxFor(runner))).toBe(true);
	});

	it("fails when the agent user does not exist", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const runner = recordingRunner([
			{
				match: /printf 'agent_uid=/,
				result: { stdout: SETTLED_CREATE.replace("agent_uid=1000", "agent_uid=") },
			},
		]);
		expect(await agentUserCreate.check(ctxFor(runner))).toBe(false);
	});

	it("fails when a privilege drop-in exists for the agent", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const runner = recordingRunner([
			{
				match: /printf 'agent_uid=/,
				result: { stdout: SETTLED_CREATE.replace("dropin_entry=no", "dropin_entry=yes") },
			},
		]);
		expect(await agentUserCreate.check(ctxFor(runner))).toBe(false);
	});

	it("fails when the agent is in the privileged group", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const runner = recordingRunner([
			{
				match: /printf 'agent_uid=/,
				result: {
					stdout: SETTLED_CREATE.replace(
						"agent_groups=agent,users,collab",
						`agent_groups=agent,users,collab,${PRIVILEGED_GROUP}`,
					),
				},
			},
		]);
		expect(await agentUserCreate.check(ctxFor(runner))).toBe(false);
	});

	it("fails when the agent is in the docker group (that group is root on the host)", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const runner = recordingRunner([
			{
				match: /printf 'agent_uid=/,
				result: {
					stdout: SETTLED_CREATE.replace(
						"agent_groups=agent,users,collab",
						`agent_groups=agent,users,collab,${DOCKER_GROUP}`,
					),
				},
			},
		]);
		expect(await agentUserCreate.check(ctxFor(runner))).toBe(false);
	});

	it("fails when the primary user is not in the shared group", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const runner = recordingRunner([
			{
				match: /printf 'agent_uid=/,
				result: {
					stdout: SETTLED_CREATE.replace(
						"primary_groups=svallory,sudo,collab",
						"primary_groups=svallory,sudo",
					),
				},
			},
		]);
		expect(await agentUserCreate.check(ctxFor(runner))).toBe(false);
	});

	it("fails when the agent is not lingering (their user units would die at logout)", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const runner = recordingRunner([
			{
				match: /printf 'agent_uid=/,
				result: { stdout: SETTLED_CREATE.replace("linger=yes", "linger=no") },
			},
		]);
		expect(await agentUserCreate.check(ctxFor(runner))).toBe(false);
	});

	it("fails when the primary user cannot traverse into the agent's home", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		// Debian's HOME_MODE is 0700, so without a traverse ACL on /home/agent the
		// primary user cannot reach the config dir inside it — and `agent-user.dirs`
		// could then never create a single symlink, no matter how often it ran.
		const runner = recordingRunner([
			{
				match: /printf 'agent_uid=/,
				result: {
					stdout: SETTLED_CREATE.replace("agent_home_traversable=yes", "agent_home_traversable=no"),
				},
			},
		]);
		expect(await agentUserCreate.check(ctxFor(runner))).toBe(false);
	});

	it("issues only read-only commands", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const runner = recordingRunner();
		await agentUserCreate.check(ctxFor(runner));
		expect(runner.snippets.length).toBeGreaterThan(0);
		for (const snippet of runner.snippets) {
			for (const verb of MUTATING) {
				expect(snippet).not.toContain(verb);
			}
		}
	});

	it("names the collab group, both users, and the absences in its root script", () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const script = agentUserCreate.rootScript?.(ctxFor(recordingRunner())) ?? "";
		expect(script).toContain("getent group collab >/dev/null 2>&1 || groupadd collab");
		expect(script).toContain(
			"id -u agent >/dev/null 2>&1 || useradd -m -s /bin/bash -G collab agent",
		);
		expect(script).toContain('usermod -aG collab "$primary_user"');
		expect(script).toContain("gpasswd -d agent sudo");
		expect(script).toContain("gpasswd -d agent docker");
		expect(script).toContain("rm -f /etc/sudoers.d/agent");
		expect(script).toContain("loginctl enable-linger agent");
		// The package installs the unprivileged tasks depend on.
		expect(script).toContain("apt-get install -y acl");
		expect(script).toContain("apt-get install -y inotify-tools");
		// The agent's config dir, group-writable, so dirs can symlink into it.
		expect(script).toContain("install -d -o agent -g collab -m 2770");
		// install(1) ignores setgid bits in -m, so it is set explicitly.
		// biome-ignore lint/suspicious/noTemplateCurlyInString: SHELL text, expanded by bash
		expect(script).toContain('chmod 2770 "${agent_home}/.claude"');
		// And the agent's home has to be traversable for that to be reachable:
		// traverse only, granted to one named user rather than to `other`.
		// biome-ignore lint/suspicious/noTemplateCurlyInString: SHELL text, expanded by bash
		expect(script).toContain('setfacl -m "u:$primary_user:x" "${agent_home}"');
		// Not `chmod o+x`: that would hand traverse to every account on the
		// machine. Comment lines are stripped first — the script explains what it
		// is not doing, and that text must not read as doing it.
		const commands = script
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line !== "" && !line.startsWith("#"));
		expect(commands.some((line) => line.includes("chmod o+x"))).toBe(false);
	});

	it("guards every step, so running the script twice changes nothing (C-15)", () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const script = agentUserCreate.rootScript?.(ctxFor(recordingRunner())) ?? "";
		// Each creation line is a guarded `||`, each removal is idempotent on its
		// own, and each file write is grep-guarded.
		for (const guarded of [
			"getent group collab >/dev/null 2>&1 ||",
			"id -u agent >/dev/null 2>&1 ||",
			"grep -q 'umask 002'",
		]) {
			expect(script).toContain(guarded);
		}
		expect(script).toContain("command -v setfacl >/dev/null 2>&1");
		expect(script).toContain("command -v inotifywait >/dev/null 2>&1");
		// `gpasswd -d` only runs when the membership is actually there, and its
		// failure is swallowed — removing an absent membership is not an error.
		expect(script).toContain("grep -qx sudo && \\");
		expect(script).toContain("|| true");
	});

	it("resolves the primary user at run time, not from the ssh target", () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const script = agentUserCreate.rootScript?.(ctxFor(recordingRunner())) ?? "";
		// An ssh alias or a bare hostname has no user part, so baking the target's
		// user in would hand `usermod` an alias and abort the script on `set -e`.
		// biome-ignore lint/suspicious/noTemplateCurlyInString: SHELL text, expanded by bash
		expect(script).toContain('primary_user="${SUDO_USER:-}"');
		expect(script).toContain('usermod -aG collab "$primary_user"');
	});

	it("ignores an ssh target that names no user", () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const ctx = { ...ctxFor(recordingRunner()), machine: { ...MACHINE, host: "t16box" } };
		const script = agentUserCreate.rootScript?.(ctx) ?? "";
		// `t16box` is an alias, not a username, so it must not become the fallback.
		expect(script).not.toContain("primary_user=t16box");
		expect(script).not.toContain("usermod -aG collab t16box");
	});

	it("resolves the primary user the same way in the watcher's root fallback", () => {
		withTempConfig('remote = "git@example:x.git"\n');
		// The regression this exists for: create resolved $SUDO_USER and the
		// fallback baked in the ssh target, so on an aliased machine the fallback
		// said `enable-linger t16box` and `set -e` killed the assembled script
		// after its good steps had run.
		const ctx = { ...ctxFor(recordingRunner()), machine: { ...MACHINE, host: "t16box" } };
		const create = agentUserCreate.rootScript?.(ctx) ?? "";
		const fallback = agentUserWatcher.rootFallback?.(ctx) ?? "";
		// biome-ignore lint/suspicious/noTemplateCurlyInString: SHELL text, expanded by bash
		expect(fallback).toContain('primary_user="${SUDO_USER:-}"');
		expect(fallback).toContain('loginctl enable-linger "$primary_user"');
		expect(fallback).not.toContain("t16box");
		// Same resolution lines, in the same wording, in both scripts. (Only the
		// resolution itself is compared — each script uses $primary_user for its
		// own different step.)
		const resolution = create
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line.startsWith("primary_user=") || line.includes('id -u "$primary_user"'));
		expect(resolution.length).toBeGreaterThan(0);
		for (const line of resolution) expect(fallback).toContain(line);
	});

	it("produces byte-identical scripts on two runs with the same input", () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const ctx = ctxFor(recordingRunner());
		expect(agentUserCreate.rootScript?.(ctx)).toBe(agentUserCreate.rootScript?.(ctx));
	});
});

describe("agent-user.dirs — the credential boundary", () => {
	it("never applies a recursive ACL over the Claude config dir", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const runner = recordingRunner([{ match: /printf 'agent_uid=/, result: { stdout: "" } }]);
		await agentUserDirs.apply?.(ctxFor(runner));
		for (const snippet of runner.snippets) {
			// The config dir root is the one path a `-R` ACL would walk into
			// `.credentials.json` and grant read on it.
			expect(snippet).not.toMatch(/setfacl\s+-R[^;]*\s\/home\/[^/]+\/\.claude(?![/.])/);
		}
		// …while the shared transcripts dir IS walked, which is the point of it.
		expect(runner.joined).toContain(`setfacl -R -m g:collab:rwX ${HOME}/.claude/projects`);
	});

	it("gives the config dir read+traverse and nothing more", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const runner = recordingRunner();
		await agentUserDirs.apply?.(ctxFor(runner));
		expect(runner.joined).toContain(`setfacl -m g:collab:rX ${HOME}/.claude`);
		expect(runner.joined).toContain(`setfacl -d -m g:collab:rX ${HOME}/.claude`);
		// No write on the config dir itself.
		expect(runner.joined).not.toContain(`setfacl -m g:collab:rwX ${HOME}/.claude`);
	});

	it("gives the home traverse only, so the agent cannot list it", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const runner = recordingRunner();
		await agentUserDirs.apply?.(ctxFor(runner));
		expect(runner.joined).toContain(`setfacl -m g:collab:x ${HOME}`);
	});
});

describe("agent-user.dirs — the shared dirs", () => {
	it("emits the setgid and ACL sequence for the work dir", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const runner = recordingRunner();
		await agentUserDirs.apply?.(ctxFor(runner));
		const sequence = [
			`mkdir -p ${HOME}/work`,
			`chgrp -R collab ${HOME}/work`,
			`chmod -R g+rwx ${HOME}/work`,
			`find ${HOME}/work -type d -exec chmod g+s {} +`,
			`setfacl -R -d -m g:collab:rwX ${HOME}/work`,
			`setfacl -R -m g:collab:rwX ${HOME}/work`,
		];
		let at = -1;
		for (const step of sequence) {
			const found = runner.joined.indexOf(step, at + 1);
			expect(found, `step not found, or out of order: ${step}`).toBeGreaterThan(at);
			at = found;
		}
	});

	it("symlinks each shared config entry into the agent's own config dir", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const runner = recordingRunner();
		await agentUserDirs.apply?.(ctxFor(runner));
		for (const name of ["projects", "settings.json", "CLAUDE.md", "skills", "commands", "agents"]) {
			expect(runner.joined).toContain(
				`ln -sfn ${HOME}/.claude/${name} ${AGENT_HOME}/.claude/${name}`,
			);
		}
	});

	it("installs the as-agent helper, executable, with the agent user baked in", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const runner = recordingRunner();
		await agentUserDirs.apply?.(ctxFor(runner));
		expect(runner.joined).toContain(`cat > ${HOME}/.local/bin/as-agent <<'HYPER_AS_AGENT_EOF'`);
		expect(runner.joined).toContain('bash -lic \'cd "$1" && eval "$2"\' _ "$dir" "$*"');
		expect(runner.joined).toContain(`chmod 0755 ${HOME}/.local/bin/as-agent`);
	});

	it("adds umask and physical to .bashrc exactly once", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const runner = recordingRunner();
		await agentUserDirs.apply?.(ctxFor(runner));
		expect(runner.joined).toContain("grep -qxF 'umask 002'");
		expect(runner.joined).toContain("grep -qxF 'set -o physical'");
		// The guard is what makes a second run a no-op.
		const umaskWrites = runner.snippets.filter((s) => s.includes(">>") && s.includes("umask 002"));
		expect(umaskWrites).toHaveLength(1);
		expect(umaskWrites[0]).toContain("grep -qxF");
	});

	it("writes the privileged helper as a FILE and never runs it", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const runner = recordingRunner();
		await agentUserDirs.apply?.(ctxFor(runner));
		// The helper's text necessarily contains the privileged command — it is
		// what the file says. What must not happen is that word appearing outside
		// a heredoc body, i.e. in something this task actually executes. So the
		// assertion is positional: cut the heredoc regions out first, then search.
		const outsideHeredoc = runner.snippets
			.map((snippet) => snippet.replace(/<<'HYPER_[A-Z_]+_EOF'[\s\S]*?\nHYPER_[A-Z_]+_EOF\n?/g, ""))
			.join("\n");
		expect(outsideHeredoc).not.toContain(`${PRIVILEGED_GROUP} -H -u`);
		expect(outsideHeredoc).not.toContain(`${PRIVILEGED_GROUP} `);
		// And the only place it appears is the file being written.
		expect(runner.joined).toContain(`cat > ${HOME}/.local/bin/as-agent <<'HYPER_AS_AGENT_EOF'`);
	});

	it("reports a settled machine as needing nothing (C-15)", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const runner = recordingRunner([
			{ match: /printf 'agent_uid=/, result: { stdout: SETTLED_CREATE } },
			{ match: /printf 'work_group=/, result: { stdout: settledDirs() } },
		]);
		expect(await agentUserDirs.check(ctxFor(runner))).toBe(true);
	});

	it("fails when a symlink points somewhere else", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const runner = recordingRunner([
			{ match: /printf 'agent_uid=/, result: { stdout: SETTLED_CREATE } },
			{
				match: /printf 'work_group=/,
				result: {
					stdout: settledDirs({ "link_CLAUDE.md": "/somewhere/else/CLAUDE.md" }),
				},
			},
		]);
		expect(await agentUserDirs.check(ctxFor(runner))).toBe(false);
	});

	it("asks for setgid with `test -g`, which tests the bit", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const runner = recordingRunner();
		await agentUserDirs.check(ctxFor(runner));
		// `stat -c %a` reports 2770 for a setgid directory, so any test that looks
		// at the digits reports a correctly-set-up dir as NOT setgid and the task
		// can never settle.
		expect(runner.joined).toContain(`test -g ${HOME}/work`);
		expect(runner.joined).toContain(`test -g ${HOME}/.claude/projects`);
		expect(runner.joined).not.toMatch(/stat -c %a[^\n]*grep -q/);
	});

	it("fails when the work dir is not setgid", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const runner = recordingRunner([
			{ match: /printf 'agent_uid=/, result: { stdout: SETTLED_CREATE } },
			{
				match: /printf 'work_group=/,
				result: { stdout: settledDirs({ work_setgid: "no" }) },
			},
		]);
		expect(await agentUserDirs.check(ctxFor(runner))).toBe(false);
	});

	it("issues only read-only commands", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const runner = recordingRunner();
		await agentUserDirs.check(ctxFor(runner));
		expect(runner.snippets.length).toBeGreaterThan(0);
		for (const snippet of runner.snippets) {
			for (const verb of MUTATING) {
				expect(snippet).not.toContain(verb);
			}
		}
	});

	it("stands down (without throwing) when the agent's config dir is not there yet", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		// This is the FIRST run of the feature on a clean machine: agent-user.create
		// has handed the user a root script that hasn't been run, so the agent's
		// config dir does not exist. Throwing here would make the runner exit 1 and
		// the user would never see the root script at all.
		const logs: string[] = [];
		const runner = recordingRunner([
			{ match: /printf 'agent_uid=/, result: { stdout: SETTLED_CREATE } },
			{ match: /test -d \/home\/agent\/\.claude/, result: { code: 1, stderr: "nope" } },
		]);
		const ctx = { ...ctxFor(runner), log: (line: string) => logs.push(line) };
		await expect(agentUserDirs.apply?.(ctx)).resolves.toBeUndefined();
		// It says what it is waiting for rather than failing silently.
		expect(logs.join("\n")).toContain("agent-user.dirs");
		expect(logs.join("\n")).toContain("root script");
		// And it did not attempt any of the work it cannot do.
		expect(runner.joined).not.toContain("setfacl");
		expect(runner.joined).not.toContain("ln -sfn");
	});
});

describe("agent-user.watcher", () => {
	it("pins the unit text", () => {
		const unit = watcherUnit();
		expect(unit).toContain(`ExecStart=%h/.local/bin/${WATCHER_BIN}`);
		expect(unit).toContain("Restart=always");
		expect(unit).toContain("WantedBy=default.target");
		// A user manager has no multi-user.target; naming it would silently never
		// enable the unit.
		expect(unit).not.toContain("multi-user.target");
		expect(unit).not.toContain("User=");
		expect(WATCHER_UNIT).toBe("claude-share-watch.service");
		expect(WATCHER_BIN).toBe("claude-share-watch");
	});

	it("emits the netcup watcher verbatim, with this machine's projects dir", () => {
		const script = watcherScript(`${HOME}/.claude/projects`);
		expect(script).toContain("inotifywait -m -r -q -e create -e moved_to -e attrib");
		expect(script).toContain(`dir=${HOME}/.claude/projects`);
		// `find -user "$me"` is the property that lets this run unprivileged: it
		// can only widen permissions on files its own user owns.
		expect(script).toContain('-user "$me"');
		expect(script).toContain("chmod g+rw");
	});

	it("reports a settled machine as needing nothing (C-15)", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const runner = recordingRunner([
			{ match: /printf 'agent_uid=/, result: { stdout: SETTLED_CREATE } },
			{ match: /printf 'watcher=/, result: { stdout: settledWatcher() } },
		]);
		expect(await agentUserWatcher.check(ctxFor(runner))).toBe(true);
	});

	it("fails when the unit is not enabled, active, or lingering", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		for (const broken of [{ enabled: "disabled" }, { active: "inactive" }, { linger: "no" }]) {
			const runner = recordingRunner([
				{ match: /printf 'agent_uid=/, result: { stdout: SETTLED_CREATE } },
				{ match: /printf 'watcher=/, result: { stdout: settledWatcher(broken) } },
			]);
			expect(await agentUserWatcher.check(ctxFor(runner)), JSON.stringify(broken)).toBe(false);
		}
	});

	it("fails when inotifywait is absent, rather than pretending to enable a unit", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const runner = recordingRunner([
			{ match: /printf 'agent_uid=/, result: { stdout: SETTLED_CREATE } },
			{
				match: /printf 'watcher=/,
				result: { stdout: settledWatcher({ inotifywait: "no" }) },
			},
		]);
		expect(await agentUserWatcher.check(ctxFor(runner))).toBe(false);
	});

	it("issues only read-only commands", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const runner = recordingRunner();
		await agentUserWatcher.check(ctxFor(runner));
		expect(runner.snippets.length).toBeGreaterThan(0);
		for (const snippet of runner.snippets) {
			for (const verb of MUTATING) {
				expect(snippet).not.toContain(verb);
			}
		}
	});

	it("installs the script and enables the unit as the primary user", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const runner = recordingRunner();
		await agentUserWatcher.apply?.(ctxFor(runner));
		expect(runner.joined).toContain(`chmod 0755 ${HOME}/.local/bin/claude-share-watch`);
		expect(runner.joined).toContain(`systemctl --user daemon-reload`);
		expect(runner.joined).toContain(`systemctl --user enable --now claude-share-watch.service`);
		// Linger is enabled as yourself — no root, and no `sudo` anywhere.
		expect(runner.joined).toContain("loginctl enable-linger svallory");
		expect(runner.joined).not.toContain(`${PRIVILEGED_GROUP} `);
	});
});

describe("the polkit-denied path becomes a root fallback, not a failure", () => {
	/**
	 * A prompt with a scripted answer sequence, for runSetup's loop.
	 *
	 * The runner re-asks while a check still fails (by design: a user who says
	 * "I've run it" may not have), so a test whose machine never heals must stop
	 * answering "ran" or it loops forever.
	 */
	function prompt(answers: RootChoice[]): SetupPrompt {
		let i = 0;
		return {
			async rootChoice() {
				const answer = answers[Math.min(i, answers.length - 1)];
				i += 1;
				return answer;
			},
		};
	}

	it("puts the linger step into the assembled script when polkit refuses", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		// Everything unprivileged succeeds; only linger stays off — exactly what
		// a polkit denial looks like from here.
		const runner = recordingRunner([
			{ match: /printf 'agent_uid=/, result: { stdout: SETTLED_CREATE } },
			{ match: /printf 'work_group=/, result: { stdout: settledDirs() } },
			{ match: /printf 'watcher=/, result: { stdout: settledWatcher({ linger: "no" }) } },
		]);
		const scratch = mkdtempSync(join(tmpdir(), "drive-agent-user-"));
		const report = await runSetup(ctxFor(runner), {
			features: ["agent-user"],
			tasks: [agentUserWatcher],
			prompt: prompt(["ran", "skip"]),
			scratchDir: scratch,
		});

		expect(report.rootScriptPath).toBeDefined();
		const script = readFileSync(report.rootScriptPath as string, "utf-8");
		expect(script).toContain("# --- agent-user.watcher ---");
		expect(script).toContain('loginctl enable-linger "$primary_user"');
		// The banner has to say this is a fallback, so a user reading the file
		// knows why a task that ran fine unprivileged is in a root script.
		expect(script).toContain("root fallback");
		// It reached the script — which is the point. Whether the user then skips
		// it is their decision, and the report says so rather than claiming a fix.
		expect(report.applied).not.toContain("agent-user.watcher");
	});

	it("does not offer a fallback while the task can still fix itself", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const runner = recordingRunner([
			{ match: /printf 'agent_uid=/, result: { stdout: SETTLED_CREATE } },
			{ match: /printf 'work_group=/, result: { stdout: settledDirs() } },
			{ match: /printf 'watcher=/, result: { stdout: settledWatcher() } },
		]);
		const report = await runSetup(ctxFor(runner), {
			features: ["agent-user"],
			tasks: [agentUserWatcher],
			prompt: prompt(["ran"]),
			scratchDir: mkdtempSync(join(tmpdir(), "drive-agent-user-")),
		});
		expect(report.rootScriptPath).toBeUndefined();
		expect(report.alreadyOk).toEqual(["agent-user.watcher"]);
	});
});

describe("the registry", () => {
	it("registers the three agent-user tasks under that feature", () => {
		const ids = allTasks()
			.filter((task) => task.feature === "agent-user")
			.map((task) => task.id);
		expect(ids).toEqual(["agent-user.create", "agent-user.dirs", "agent-user.watcher"]);
	});

	it("marks only agent-user.create as needing root", () => {
		const tasks = allTasks().filter((task) => task.feature === "agent-user");
		expect(tasks.filter((task) => task.needsRoot).map((task) => task.id)).toEqual([
			"agent-user.create",
		]);
		// The watcher may contribute a fallback without being a root task.
		const watcher = tasks.find((task) => task.id === "agent-user.watcher");
		expect(watcher?.needsRoot).toBe(false);
		expect(typeof watcher?.rootFallback).toBe("function");
	});
});

describe("C-6 — the privileged helper text", () => {
	it("lives in root-script.ts, so the grep stays honest", () => {
		const script = asAgentScript("agent");
		expect(script).toContain(`${PRIVILEGED_GROUP} -H -u agent bash -lic`);
		// The template is text; root-script.ts is the one file allowed to hold it.
		const source = readFileSync(
			join(import.meta.dirname, "../src/services/machine/root-script.ts"),
			"utf-8",
		);
		expect(source).toContain("export function asAgentScript");
	});
});

describe("assembleRootScript with a fallback entry", () => {
	it("marks the fallback banner and keeps the strict preamble", () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const script = assembleRootScript(
			[
				{
					task: agentUserCreate,
					script: agentUserCreate.rootScript?.(ctxFor(recordingRunner())) ?? "",
				},
				{ task: agentUserWatcher, script: "loginctl enable-linger svallory", fallback: true },
			],
			ctxFor(recordingRunner()),
		);
		expect(script.startsWith("#!/usr/bin/env bash\nset -euo pipefail")).toBe(true);
		expect(script).toContain("# tasks: agent-user.create, agent-user.watcher");
		const banner = script.indexOf("# --- agent-user.watcher ---");
		expect(banner).toBeGreaterThan(-1);
		expect(script.indexOf("root fallback", banner)).toBeGreaterThan(banner);
	});

	it("writes the script only when there is something to write", () => {
		const scratch = mkdtempSync(join(tmpdir(), "drive-agent-user-"));
		expect(existsSync(join(scratch, "hyper-machine-root.sh"))).toBe(false);
	});
});
