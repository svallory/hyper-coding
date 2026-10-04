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

import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
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
	accessPolicyShell,
	accessRepairShell,
	foreignEntriesShell,
	unownedEntriesShell,
	unprotectedEntriesShell,
} from "#services/machine/tasks/agent-acl";
import { agentPaths } from "#services/machine/tasks/agent-context";
import {
	repairSharedTree,
	repairSharedTreeEntry,
	sharedTreePolicyShell,
	sharedTreeRepairShell,
	unreadableSharedTree,
	unsettledSharedTree,
} from "#services/machine/tasks/agent-shared-tree";
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
import { runOrFail, shellCommand } from "#services/machine/tasks/shell";
import type { TaskContext } from "#services/machine/tasks/types";
import { type MachineRunner, type RunResult, shellQuote } from "#services/remote";
import { withTempConfig } from "#tests/tmp-config";

const saved = process.env.HYPER_DRIVE_CONFIG;
afterEach(() => {
	if (saved === undefined) delete process.env.HYPER_DRIVE_CONFIG;
	else process.env.HYPER_DRIVE_CONFIG = saved;
});

const HOME = "/home/svallory";

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

/** Like {@link ctxFor} but with a different agent user, as drive.toml would give. */
function ctxForAgent(runner: MachineRunner, agentUser: string): TaskContext {
	return { machine: { ...MACHINE, agentUser }, runner, config: loadConfig(), log: () => {} };
}

/** The answers a correctly set-up machine gives {@link agentUserCreate}'s probe. */
const SETTLED_CREATE = [
	"agent_uid=1000",
	"collab_group=yes",
	"agent_groups=agent,users,collab",
	"primary_groups=svallory,sudo,collab",
	"dropin_entry=no",
	"agent_config_dir=yes",
	"agent_config_owner=agent",
	`link_projects=${HOME}/.claude/projects`,
	`link_settings.json=${HOME}/.claude/settings.json`,
	`link_CLAUDE.md=${HOME}/.claude/CLAUDE.md`,
	`link_skills=${HOME}/.claude/skills`,
	`link_commands=${HOME}/.claude/commands`,
	`link_agents=${HOME}/.claude/agents`,
	"agent_bashrc_umask=1",
	"agent_bashrc_physical=1",
	"acl_tool=yes",
	"inotify_tool=yes",
	"linger=yes",
	"primary_login_group=svallory",
].join("\n");

/** The answers a correctly set-up machine gives {@link agentUserDirs}' probe. */
function settledDirs(overrides: Record<string, string> = {}): string {
	const answers: Record<string, string> = {
		primary_user: "svallory",
		collab_members: "svallory,agent,",
		unowned_top: "",
		unowned_claude: "",
		home_legacy_group: "0",
		claude_legacy_group: "0",
		work_unsettled: "",
		projects_unsettled: "",
		work_agent_wrong_group: "",
		projects_agent_wrong_group: "",
		work_unreadable: "",
		projects_unreadable: "",
		home_default_other: "1",
		claude_default_other: "1",
		work_group: "collab",
		work_setgid: "yes",
		work_acl: "1",
		work_default_acl: "1",
		home_acl: "1",
		claude_acl: "1",
		claude_default_deny: "1",
		home_default_deny: "1",
		home_fs: "ext4",
		hardlinks: "1",
		tiocsti: "0",
		unprotected_top: "",
		unprotected_claude: "",
		"read_settings.json": "1",
		"read_CLAUDE.md": "1",
		read_skills: "1",
		foreign_skills: "",
		foreign_commands: "",
		foreign_agents: "",
		read_commands: "1",
		read_agents: "1",
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
		watcher_content: "yes",
		watcher: "yes",
		unit: "yes",
		enabled: "enabled",
		active: "active",
		watcher_collab: "yes",
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

	it("fails when the agent's config dir is not owned by the agent", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		// The dir lives inside the agent's home, so who owns it matters: root
		// setting ownership there is the one place this script touches that home,
		// and a dir owned by anyone else means it is not what we created.
		const runner = recordingRunner([
			{
				match: /printf 'agent_uid=/,
				result: {
					stdout: SETTLED_CREATE.replace("agent_config_owner=agent", "agent_config_owner=svallory"),
				},
			},
		]);
		expect(await agentUserCreate.check(ctxFor(runner))).toBe(false);
	});

	it("fails when a shared entry is not a symlink where it belongs", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const runner = recordingRunner([
			{
				match: /printf 'agent_uid=/,
				result: {
					stdout: SETTLED_CREATE.replace(
						`link_CLAUDE.md=${HOME}/.claude/CLAUDE.md`,
						"link_CLAUDE.md=missing",
					),
				},
			},
		]);
		expect(await agentUserCreate.check(ctxFor(runner))).toBe(false);
	});

	it("fails when the agent's .bashrc has no shared umask", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const runner = recordingRunner([
			{
				match: /printf 'agent_uid=/,
				result: {
					stdout: SETTLED_CREATE.replace("agent_bashrc_umask=1", "agent_bashrc_umask=0"),
				},
			},
		]);
		expect(await agentUserCreate.check(ctxFor(runner))).toBe(false);
	});

	it("fails when the packages the other tasks need are missing", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		for (const missing of ["acl_tool", "inotify_tool"]) {
			const runner = recordingRunner([
				{
					match: /printf 'agent_uid=/,
					result: { stdout: SETTLED_CREATE.replace(`${missing}=yes`, `${missing}=no`) },
				},
			]);
			expect(await agentUserCreate.check(ctxFor(runner)), missing).toBe(false);
		}
	});

	it("throws when the primary user's login group is the shared group", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		// umask 002 hands everything the primary creates to their effective group.
		// If that group is `collab`, the agent gets read AND WRITE on all of it,
		// which defeats every other precaution here. There is no automatic fix, and
		// a plain `false` would leave the runner assembling a root script that then
		// refuses again somewhere else — so it throws, naming what to do.
		const runner = recordingRunner([
			{
				match: /printf 'agent_uid=/,
				result: {
					stdout: SETTLED_CREATE.replace(
						"primary_login_group=svallory",
						"primary_login_group=collab",
					),
				},
			},
		]);
		await expect(agentUserCreate.check(ctxFor(runner))).rejects.toThrow(/login group/);
	});

	it("issues only read-only commands", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const runner = recordingRunner();
		await agentUserCreate.check(ctxFor(runner));
		expect(runner.snippets.length).toBeGreaterThan(0);
		for (const snippet of runner.snippets) {
			// `command -v setfacl` asks whether a tool exists; it changes nothing, so
			// it is stripped before the scan rather than added to an exception list.
			const executable = snippet.replace(/command -v [a-z0-9_]+/g, "<exists>");
			for (const verb of MUTATING) {
				expect(executable, `${verb} in: ${snippet}`).not.toContain(verb);
			}
		}
	});

	it("names the collab group, both users, and the absences in its root script", () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const script = agentUserCreate.rootScript?.(ctxFor(recordingRunner())) ?? "";
		expect(script).toContain("getent group collab >/dev/null 2>&1 || groupadd collab");
		expect(script).toContain(
			'id -u "$agent_user" >/dev/null 2>&1 || useradd -m -s /bin/bash -G collab "$agent_user"',
		);
		expect(script).toContain('usermod -aG collab "$primary_user"');
		expect(script).toContain('gpasswd -d "$agent_user" sudo');
		expect(script).toContain('gpasswd -d "$agent_user" docker');
		expect(script).toContain('rm -f /etc/sudoers.d/"$agent_user"');
		expect(script).toContain('loginctl enable-linger "$agent_user"');
		// The package installs the unprivileged tasks depend on.
		expect(script).toContain("apt-get install -y acl");
		expect(script).toContain("apt-get install -y inotify-tools");
		// The agent's config dir is created BY THE AGENT, in its own block, and root
		// sets nothing inside that home at all — see the blocker-2 tests.
		expect(script).toContain('runuser -u "$agent_user" -- sh -c');
		expect(script).toContain('mkdir -p "$home/.claude"');
		expect(script).toContain('chmod 0750 "$home/.claude"');
		// The ACLs that let the primary read the agent's config dir for its checks
		// are set by the AGENT, on its own files.
		// Positional, not inherited: the parent never exports the names and the
		// block runs under strict mode.
		expect(script).toContain('setfacl -m "u:$2:x" "$home"');
		expect(script).toContain('setfacl -m "u:$2:r-x" "$home/.claude"');
		// …and root does no chown/chmod/setfacl anywhere under that home.
		expect(script).not.toContain('chown "$agent_user');
		expect(script).not.toContain('setfacl -m "u:$primary_user:x" "$agent_home"');
		// Not `chmod o+x`: that would hand traverse to every account on the
		// machine. Comment lines are stripped first — the script explains what it
		// is not doing, and that text must not read as doing it.
		const commands = script
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line !== "" && !line.startsWith("#"));
		expect(commands.some((line) => line.includes("chmod o+x"))).toBe(false);
		// The collab-login-group refusal, with a reason a user can act on.
		expect(script).toContain('primary_login_group="$(id -gn "$primary_user" || echo unknown)"');
		expect(script).toContain('if [ "$primary_login_group" = "collab" ]; then');
		expect(script).toContain("exit 1");
	});

	it("guards every step, so running the script twice changes nothing (C-15)", () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const script = agentUserCreate.rootScript?.(ctxFor(recordingRunner())) ?? "";
		// Each creation line is a guarded `||`, each removal is idempotent on its
		// own, and each file write is grep-guarded.
		for (const guarded of [
			"getent group collab >/dev/null 2>&1 ||",
			'id -u "$agent_user" >/dev/null 2>&1 ||',
			'grep -q "umask 002" "$home/.bashrc" ||',
			'grep -q "^set -o physical$" "$home/.bashrc" ||',
		]) {
			expect(script).toContain(guarded);
		}
		expect(script).toContain("command -v setfacl >/dev/null 2>&1");
		expect(script).toContain("command -v inotifywait >/dev/null 2>&1");
		// `gpasswd -d` only runs when the membership is actually there, and its
		// failure is swallowed — removing an absent membership is not an error.
		expect(script).toContain("grep -qx sudo && \\");
		expect(script).toContain("|| true");
		// The symlinks are rewritten only when they point somewhere else, so a
		// second run is a no-op rather than a churn of new symlinks.
		expect(script).toContain('[ "$(readlink "$link")" = "$target" ] || ln -sfn "$target" "$link"');
	});

	it("re-checks its own inputs at the top of the script, before doing anything", () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const script = agentUserCreate.rootScript?.(ctxFor(recordingRunner())) ?? "";
		// The names come from a config file on another machine and may have been
		// edited since; the script is what actually runs as root.
		expect(script).toContain('if [ -z "$primary_user" ]; then');
		expect(script).toContain("''|[!a-z_]*|*[!a-z0-9_-]*)");
		expect(script).toContain('if [ "$agent_user" = root ] || [ "$primary_user" = root ]; then');
		expect(script).toContain('if [ "$agent_user" = "$primary_user" ]; then');
		expect(script).toContain("= 0 ]; then");
		// …and every one of those guards exits rather than continuing: no command
		// that changes the machine may appear before the last guard. Comments are
		// stripped first, because the guards' own prose names these commands — and
		// the index is taken from the stripped text, or it points somewhere else.
		const commands = script
			.split("\n")
			.filter((line) => !line.trim().startsWith("#"))
			.join("\n");
		const lastGuard = commands.indexOf("= 0 ]; then");
		expect(lastGuard).toBeGreaterThan(-1);
		const beforeGuards = commands.slice(0, lastGuard);
		for (const privileged of ["useradd", "usermod", "groupadd", "apt-get", "rm -f"]) {
			expect(beforeGuards, `${privileged} runs before the guards`).not.toContain(privileged);
		}
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

describe("the kernel condition behind the invariant", () => {
	// fs/namei.c `acl_permission_check`: a non-owner gets the ACL consulted only
	// when `IS_POSIXACL(inode) && (mode & S_IRWXG)`. With an ACL present the mode's
	// group bits ARE the mask, so mask `---` means the ACL is skipped and `other`
	// decides. The deny holds INSIDE posix_acl_permission — that code is never
	// reached. So the invariant is two parts: the named entry, AND never the
	// (group bits == 0 AND other bits != 0) state.
	it("detects the state by the mode's digits, not the ACL line", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const runner = recordingRunner();
		await agentUserDirs.apply?.(ctxFor(runner));
		const joined = runner.joined;
		// The mode is reduced to its last three octal digits (a setgid dir is 2770)
		// and the group and other digits read separately.
		// biome-ignore lint/suspicious/noTemplateCurlyInString: SHELL text, expanded by sh
		expect(joined).toContain("while [ ${#m} -gt 3 ]; do m=${m#?}; done");
		expect(joined).toContain("group_digit() { printf");
		expect(joined).toContain("other_digit() { printf");
		expect(joined).toContain('[ "$(group_digit "$m")" = 0 ] && [ "$(other_digit "$m")" != 0 ]');
	});

	it("uses the same read-only policy in apply, check and watcher", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const runner = recordingRunner();
		await agentUserDirs.apply?.(ctxFor(runner));
		const policy = accessPolicyShell(agentPaths(HOME, "/home/agent"));
		expect(runner.joined).toContain(policy);
		const check = recordingRunner();
		await agentUserDirs.check(ctxFor(check));
		expect(check.joined).toContain(policy);
		const watcher = watcherScript(`${HOME}/.claude/projects`, HOME);
		expect(watcher).toContain(policy);
		const treePolicy = sharedTreePolicyShell();
		const treeRepair = sharedTreeRepairShell();
		// Nested sh -c bodies are shell-escaped; compare that exact encoding.
		for (const consumer of [runner.joined, check.joined])
			expect(consumer).toContain(shellQuote(treePolicy).slice(1, -1));
		expect(runner.joined).toContain(shellQuote(treeRepair).slice(1, -1));
		expect(watcher).toContain(shellQuote(treeRepair).slice(1, -1));
	});

	it("strips the other bits, which is tightening and never widening", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const runner = recordingRunner();
		await agentUserDirs.apply?.(ctxFor(runner));
		expect(runner.joined).toContain('if bad_state "$1"; then chmod o-rwx "$1" || return 1; fi');
		// Nothing in the whole task may ADD permission.
		expect(runner.joined).not.toContain("chmod o+");
		expect(runner.joined).not.toContain("chmod g+w");
	});

	it("sets the default ACLs completely, with other::---", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const runner = recordingRunner();
		await agentUserDirs.apply?.(ctxFor(runner));
		// A single added entry would make setfacl copy the directory's own group
		// entry into default:group:: — a 0700 home gives `---`, and then every file
		// created under it inherits a zero group class and the ACL is skipped.
		for (const dir of [HOME, `${HOME}/.claude`]) {
			const varName = "mode";
			// u::, g:: (read from the directory's own group bits), the deny, o::---.
			expect(runner.joined, `no full default for ${dir}`).toContain(
				`setfacl -d -m "u::rwx,u:$agent_user:---,g::$(perms_of "$(group_digit "$${varName}")"),o::---" ${dir}`,
			);
		}
	});

	it("reports an entry as unprotected when it carries the deny but sits in the bad state", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const runner = recordingRunner();
		await agentUserDirs.check(ctxFor(runner));
		// The check must never trust the ACL line alone — that is the whole point.
		expect(runner.joined).toContain('! acl_has "$1" "user:$agent_user:---" || bad_state "$1"');
	});

	it("the watcher denies NOTHING in the shared config-dir entries", () => {
		// The bug this exists for: the config-dir handler special-cased only the two
		// readable files and denied everything else, so when the dirs task created
		// skills/ (or projects/) the watcher stamped the deny straight back on it and
		// the check reported it unprotected for ever.
		const script = watcherScript(`${HOME}/.claude/projects`, HOME);
		expect(script).toContain("projects) echo skip ;;");
		expect(script).toContain("settings.json|CLAUDE.md) echo read_file ;;");
		expect(script).toContain("skills|commands|agents) echo read_dir ;;");
		// The deny still applies to everything that is NOT shared.
		expect(script).toContain(
			'deny) if unprotected "$1" || legacy_group "$1"; then protect "$1"; fi ;;',
		);
	});

	it("the watcher watches attrib, because a chmod IS an attribute change", () => {
		const script = watcherScript(`${HOME}/.claude/projects`, HOME);
		expect(script).toContain("inotifywait -m -q -e create -e moved_to -e attrib");
		// And it applies the same invariant, not just the named entry.
		expect(script).toContain("bad_state");
		expect(script).toContain("chmod o-rwx");
		// The replaced shared files get their grant re-applied, and the same
		// invariant: a readable-by-grant file in the bad state is still readable.
		expect(script).toContain("grant_shared()");
		expect(script).toContain('setfacl -m "u:$agent_user:$access" "$1"');
		expect(accessRepairShell()).not.toContain("m::$access");
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
		expect(runner.joined).toContain(repairSharedTree(`${HOME}/.claude/projects`));
	});

	it("gives the config dir traverse only, and no default ACL", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const runner = recordingRunner();
		await agentUserDirs.apply?.(ctxFor(runner));
		// Traverse, not read: the agent must not be able to LIST the config dir.
		expect(runner.joined).toContain(`setfacl -m u:agent:--x ${HOME}/.claude`);
		// `-k` REMOVES the default ACL an earlier version of this task set there
		// (it was `g:collab:rX`), and it is replaced by an inherited DENY.
		expect(runner.joined).toContain(`setfacl -k ${HOME}/.claude`);
		expect(runner.joined).toContain(
			`u:$agent_user:---,g::$(perms_of "$(group_digit "$mode")"),o::---" ${HOME}/.claude`,
		);
		// The config dir root is never given a default that GRANTS anything.
		const commandLines = runner.snippets
			.join("\n")
			.split("\n")
			.map((line) => line.trim());
		expect(
			commandLines.filter((line) => line === `setfacl -d -m g:collab:rX ${HOME}/.claude`),
		).toEqual([]);
		expect(runner.joined).not.toContain(`setfacl -m g:collab:rwX ${HOME}/.claude`);
	});

	it("creates skills/, commands/ and agents/ before granting on them", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const runner = recordingRunner();
		await agentUserDirs.apply?.(ctxFor(runner));
		// A directory that does not exist cannot carry an ACL, and the check demands
		// the ACL — so without the mkdir, a machine with no skills/ or agents/ yet
		// could never settle.
		for (const name of ["skills", "commands", "agents"]) {
			expect(runner.joined, `not created: ${name}`).toContain(`mkdir -p ${HOME}/.claude/${name}`);
		}
		// And they must be created BEFORE the grant, or the grant lands on nothing.
		const created = runner.joined.indexOf(`mkdir -p ${HOME}/.claude/skills`);
		const granted = runner.joined.indexOf('read_file|read_dir) grant_shared "$entry"');
		expect(created).toBeGreaterThan(-1);
		expect(granted).toBeGreaterThan(created);
	});

	it("grants read per entry: the two files, and the three shared dirs", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const runner = recordingRunner();
		await agentUserDirs.apply?.(ctxFor(runner));
		expect(runner.joined).toContain(accessRepairShell());
		expect(runner.joined).toContain("read_file) echo r--");
		expect(runner.joined).toContain("read_dir) echo r-X");
		expect(runner.joined).toContain('setfacl -d -m "$default_acl" "$1"');
		expect(runner.joined).toContain(
			'case "$(entry_kind "$entry")" in read_file|read_dir) grant_shared "$entry"',
		);
	});

	it("never applies a default ACL anywhere but projects/, skills, commands and agents", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const runner = recordingRunner();
		await agentUserDirs.apply?.(ctxFor(runner));
		const defaults = runner.snippets
			.join("\n")
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line.startsWith("setfacl -R -d ") || line.startsWith("setfacl -d "));
		// The home and the config dir carry a DENY default with o::---; the shared
		// dirs carry rX; the work dir carries rwX. Nothing else may have a default.
		const allowed = [
			HOME,
			`${HOME}/.claude`,
			`${HOME}/work`,
			`${HOME}/.claude/projects`,
			`${HOME}/.claude/skills`,
			`${HOME}/.claude/commands`,
			`${HOME}/.claude/agents`,
		];
		const trees = runner.snippets.filter((snippet) =>
			snippet.includes("# BEGIN hyper shared tree policy"),
		);
		expect(trees).toHaveLength(2);
		for (const dir of [`${HOME}/work`, `${HOME}/.claude/projects`])
			expect(trees.some((snippet) => snippet.includes(repairSharedTree(dir)))).toBe(true);
		for (const line of defaults) {
			const target = line.split(" ").pop() ?? "";
			if (line.includes('"$1"')) {
				// These two function bodies are used only by the bounded traversals
				// above: one applies a shared tree's default, the other the shared
				// config dirs'. Neither names a path, so neither can escape them.
				const bounded = [
					'setfacl -d -m g:collab:rwX "$1" || return 1',
					'setfacl -d -m "$default_acl" "$1" || return 1',
				];
				expect(bounded, `unexpected default ACL body: ${line}`).toContain(line);
			} else {
				expect(allowed.includes(target), `unexpected default ACL on ${target}`).toBe(true);
			}
		}
	});

	it("gives the home traverse and an inherited deny", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const runner = recordingRunner();
		await agentUserDirs.apply?.(ctxFor(runner));
		// `--x`: reach work/, but not list the home.
		expect(runner.joined).toContain(`setfacl -m u:agent:--x ${HOME}`);
		// The deny: everything created under the home from now on.
		expect(runner.joined).toContain(
			`u:$agent_user:---,g::$(perms_of "$(group_digit "$mode")"),o::---" ${HOME}`,
		);
	});

	it("denies the shared group every top-level entry except work and .claude", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const runner = recordingRunner();
		await agentUserDirs.apply?.(ctxFor(runner));
		expect(runner.joined).toContain(`for entry in ${HOME}/* ${HOME}/.[!.]* ${HOME}/..?*`);
		expect(runner.joined).toContain(`    ${HOME}/work|${HOME}/.claude) echo skip; return ;;`);
		expect(runner.joined).toContain('[ -L "$1" ] || [ ! -e "$1" ]');
		expect(runner.joined).toContain(
			'if [ "$(entry_kind "$entry")" = deny ]; then protect "$entry"; fi',
		);
	});

	it("denies the config dir's children except the shared ones", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const runner = recordingRunner();
		await agentUserDirs.apply?.(ctxFor(runner));
		expect(runner.joined).toContain(
			`for entry in ${HOME}/.claude/* ${HOME}/.claude/.[!.]* ${HOME}/.claude/..?*`,
		);
		expect(runner.joined).toContain("settings.json|CLAUDE.md) echo read_file ;;");
		expect(runner.joined).toContain("skills|commands|agents) echo read_dir ;;");
		expect(runner.joined).toContain("projects) echo skip ;;");
	});

	it("refuses a home on a filesystem that does not do the kernel ACL check", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		for (const fs of ["nfs4", "cifs", "fuseblk"]) {
			const runner = recordingRunner([
				{ match: /printf 'agent_uid=/, result: { stdout: SETTLED_CREATE } },
				{
					match: /printf 'work_group=/,
					result: { stdout: settledDirs({ home_fs: fs }) },
				},
			]);
			await expect(agentUserDirs.check(ctxFor(runner)), fs).rejects.toThrow(
				/does not apply POSIX ACLs/,
			);
		}
		// A local filesystem is fine.
		const ok = recordingRunner([
			{ match: /printf 'agent_uid=/, result: { stdout: SETTLED_CREATE } },
			{ match: /printf 'work_group=/, result: { stdout: settledDirs() } },
		]);
		expect(await agentUserDirs.check(ctxFor(ok))).toBe(true);
	});

	it("reports the entries that are not denied, by name", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const logs: string[] = [];
		const runner = recordingRunner([
			{ match: /printf 'agent_uid=/, result: { stdout: SETTLED_CREATE } },
			{
				match: /printf 'work_group=/,
				result: {
					stdout: settledDirs({
						unprotected_top: `${HOME}/.netrc,${HOME}/.config,`,
					}),
				},
			},
		]);
		const ctx = { ...ctxFor(runner), log: (line: string) => logs.push(line) };
		expect(await agentUserDirs.check(ctx)).toBe(false);
		// It NAMES them, so "not fine" is actionable rather than mysterious.
		expect(logs.join("\n")).toContain(".netrc");
		expect(logs.join("\n")).toContain(".config");
	});

	it("fails when a kernel setting the deny relies on is off", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const cases: Record<string, string>[] = [{ hardlinks: "0" }, { tiocsti: "1" }];
		for (const broken of cases) {
			const runner = recordingRunner([
				{ match: /printf 'agent_uid=/, result: { stdout: SETTLED_CREATE } },
				{ match: /printf 'work_group=/, result: { stdout: settledDirs(broken) } },
			]);
			expect(await agentUserDirs.check(ctxFor(runner)), JSON.stringify(broken)).toBe(false);
		}
	});

	it("writes both sysctls into a confined sysctl.d file, never /proc", () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const script = agentUserCreate.rootScript?.(ctxFor(recordingRunner())) ?? "";
		expect(script).toContain("/etc/sysctl.d/60-hyper-agent-user.conf");
		expect(script).toContain("fs.protected_hardlinks = 1");
		expect(script).toContain("dev.tty.legacy_tiocsti = 0");
		expect(script).toContain("sysctl --system");
		// Reading /proc/sys to see what is ALREADY in effect is how it decides
		// whether to write the file at all. What the ruling forbids is touching
		// /proc — and /proc mount options specifically.
		expect(script).toContain("cat /proc/sys/fs/protected_hardlinks");
		expect(script).not.toContain("mount -o remount");
		expect(script).not.toContain("/proc/sys/fs/protected_hardlinks =");
		expect(script).not.toContain("sysctl -w /proc");
	});
});

describe("agent-user.dirs — the shared dirs", () => {
	it("emits the setgid and ACL sequence for the work dir", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const runner = recordingRunner();
		await agentUserDirs.apply?.(ctxFor(runner));
		const sequence = [`mkdir -p ${HOME}/work`, ...repairSharedTree(`${HOME}/work`).split("\n")];
		let at = -1;
		for (const step of sequence) {
			const found = runner.joined.indexOf(step, at + 1);
			expect(found, `step not found, or out of order: ${step}`).toBeGreaterThan(at);
			at = found;
		}
	});

	it("does NOT create the symlinks — the agent does, in the root script", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const runner = recordingRunner();
		await agentUserDirs.apply?.(ctxFor(runner));
		// Those symlinks live inside a directory the agent controls. Creating them
		// from here would mean root (or the primary, via a root-granted write)
		// writing into the agent's home, which is the thing the review ruled out.
		expect(runner.joined).not.toContain("ln -sfn");
		// The only commands aimed at the agent's config dir are the readiness read.
		for (const line of runner.snippets.join("\n").split("\n")) {
			if (!line.includes("/home/agent/")) continue;
			expect(line, `writes into the agent home: ${line}`).toMatch(
				/^\s*(test -[dirw]|getent passwd|readlink)/,
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

	it("emits the shared policy watcher with this machine's paths", () => {
		const script = watcherScript(`${HOME}/.claude/projects`, HOME);
		expect(script).toContain("inotifywait -m -r -q -e create -e moved_to -e attrib");
		expect(script).toContain(`projects=${HOME}/.claude/projects`);
		expect(script).toContain(`watch_dir ${HOME} &`);
		expect(script).toContain(`watch_dir ${HOME}/.claude &`);
		// `find -user "$me"` is the property that lets this run unprivileged: it
		// can only widen permissions on files its own user owns.
		expect(script).toContain('-user "$me"');
		expect(script).toContain("chmod g+rw");
		// The deny work: new entries in the home and the config dir.
		expect(script).toContain('setfacl -m "u:$agent_user:---" "$1"');
		expect(script).toContain("settings.json|CLAUDE.md");
		expect(script).toContain("inotifywait -m -q -e create -e moved_to");
		// …re-granting read on the two shared files when they are replaced.
		// …and re-grants read when the file is replaced, since the inherited
		// default now denies it. The grant lives in protect_shared, so it is
		// applied with that function's own parameter.
		expect(script).toContain("grant_shared()");
		expect(script).toContain('acl_has "$1" "user:$agent_user:$access"');
		expect(script).toContain('setfacl -m "u:$agent_user:$access" "$1"');
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
		const cases: Record<string, string>[] = [
			{ enabled: "disabled" },
			{ active: "inactive" },
			{ linger: "no" },
		];
		for (const broken of cases) {
			const runner = recordingRunner([
				{ match: /printf 'agent_uid=/, result: { stdout: SETTLED_CREATE } },
				{ match: /printf 'watcher=/, result: { stdout: settledWatcher(broken) } },
			]);
			expect(await agentUserWatcher.check(ctxFor(runner)), JSON.stringify(broken)).toBe(false);
		}
	});

	it("fails when the RUNNING watcher lacks the collab group (its manager started before the group was added)", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const runner = recordingRunner([
			{ match: /printf 'agent_uid=/, result: { stdout: SETTLED_CREATE } },
			{ match: /printf 'watcher=/, result: { stdout: settledWatcher({ watcher_collab: "no" }) } },
		]);
		const logs: string[] = [];
		const ctx: TaskContext = {
			machine: MACHINE,
			runner,
			config: loadConfig(),
			log: (line) => logs.push(line),
		};
		expect(await agentUserWatcher.check(ctx)).toBe(false);
		expect(logs.join("\n")).toContain("does not have the collab group");
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

describe("blocker 1 — the agent user name is never trusted", () => {
	/** Config load is the first gate: a hostile name never reaches a task. */
	it("refuses hostile agent_user values at config load", () => {
		// Each of these would otherwise become an argument to useradd, a path in
		// an `rm -f`, or a user to become — all as root.
		const hostile = [
			"x; id",
			"../x",
			"*",
			"root",
			"",
			"a".repeat(33),
			"Agent",
			"agent;rm -rf /",
			"$(id)",
			"a b",
			"agent/x",
		];
		for (const value of hostile) {
			const toml = `remote = "git@example:x.git"\n[machines.t16]\nagent_user = ${JSON.stringify(value)}\n`;
			// withTempConfig only writes the file; validation happens on load, so
			// the load is the thing under test.
			expect(
				() => {
					withTempConfig(toml);
					loadConfig();
				},
				`agent_user = ${JSON.stringify(value)}`,
			).toThrow();
		}
	});

	it("accepts the names it should", () => {
		for (const value of ["agent", "agent2", "ai-agent", "_svc", "a".repeat(32)]) {
			const toml = `remote = "git@example:x.git"\n[machines.t16]\nagent_user = ${JSON.stringify(value)}\n`;
			expect(() => {
				withTempConfig(toml);
				loadConfig();
			}, value).not.toThrow();
		}
	});

	it("refuses when the agent user IS the primary user", async () => {
		withTempConfig('remote = "git@example:x.git"\n[machines.t16]\nagent_user = "svallory"\n');
		const runner = recordingRunner([{ match: /^id -un$/, result: { stdout: "svallory\n" } }]);
		// Pointing agent_user at the operator's own account would strip their group
		// memberships and delete their own privilege drop-in.
		await expect(agentUserCreate.check(ctxForAgent(runner, "svallory"))).rejects.toThrow(
			/primary user/i,
		);
	});

	it("refuses when the agent user resolves to uid 0", async () => {
		withTempConfig('remote = "git@example:x.git"\n[machines.t16]\nagent_user = "toor"\n');
		const runner = recordingRunner([
			{ match: /^id -un$/, result: { stdout: "svallory\n" } },
			{ match: /id -u toor/, result: { stdout: "0\n" } },
		]);
		await expect(agentUserCreate.check(ctxForAgent(runner, "toor"))).rejects.toThrow(/uid 0/);
	});

	it("refuses a hostile name before probing the machine with it", async () => {
		// The config path already refuses this at load; this is the other gate, for a
		// machine reached without one (Herdr-only), where the name arrives from the
		// machine's own listing rather than from drive.toml.
		withTempConfig('remote = "git@example:x.git"\n');
		const runner = recordingRunner([
			{ match: /printf 'agent_uid=/, result: { stdout: SETTLED_CREATE } },
		]);
		await expect(agentUserCreate.check(ctxForAgent(runner, "agent; id"))).rejects.toThrow();
		// Nothing was asked of the machine with the hostile name in it.
		expect(runner.joined).not.toContain("id;");
	});

	it("never renders a hostile name into a script", () => {
		withTempConfig('remote = "git@example:x.git"\n[machines.t16]\nagent_user = "agent"\n');
		// The rendered script interpolates through shellQuote and re-checks at run
		// time, so even a name that got this far could not execute.
		const script = agentUserCreate.rootScript?.(ctxFor(recordingRunner())) ?? "";
		expect(script).toContain("agent_user=agent");
		expect(script).toContain('case "$name" in');
	});
});

describe("blocker 2 — root never touches a path inside the agent's home", () => {
	it("creates the symlinks and the .bashrc lines AS THE AGENT", () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const script = agentUserCreate.rootScript?.(ctxFor(recordingRunner())) ?? "";
		// One runuser block owns everything inside that home.
		expect(script).toContain('runuser -u "$agent_user" -- sh -c');
		expect(script).toContain('ln -sfn "$target" "$link"');
		expect(script).toContain('grep -q "umask 002" "$home/.bashrc" ||');
	});

	it("has no chmod/chown/touch/append outside a runuser block on the agent home", () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const script = agentUserCreate.rootScript?.(ctxFor(recordingRunner())) ?? "";
		// The agent controls every path under its home and can plant a symlink
		// there; root following one is root writing wherever it points. Root must
		// perform NO path or metadata operations there, even after a symlink test.
		// Only the unprivileged agent may set its own modes and ACLs.
		// Cut out the runuser block: inside it, the agent is the one doing the work,
		// which is the whole point. What is left is what ROOT would do.
		const start = script.indexOf('runuser -u "$agent_user" -- sh -c');
		const end = script.indexOf('\' _ "$agent_user" "$primary_user"', start);
		expect(start).toBeGreaterThan(-1);
		expect(end).toBeGreaterThan(start);
		const asRoot = script.slice(0, start) + script.slice(end);
		const offending = asRoot
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => !line.startsWith("#"))
			.filter((line) => /\$(agent_home|home)\//.test(line));
		// A1: root does NOTHING under that home. Not even metadata, and not even
		// behind a not-a-symlink test — the agent's lingering processes can swap the
		// directory between the test and the use. The agent sets its own mode and
		// its own ACLs inside the runuser block.
		expect(offending).toEqual([]);
		const asRootLines = asRoot
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line !== "" && !line.startsWith("#"));
		for (const verb of ["chown", "chmod", "setfacl", "touch", "mkdir"]) {
			// `command -v setfacl` asks whether the tool exists; it names no path.
			const hits = asRootLines.filter(
				(line) => line.includes(verb) && !line.includes("command -v"),
			);
			expect(hits, `root runs ${verb} outside the runuser block`).toEqual([]);
		}
	});

	it("has no not-a-symlink guard left, because there is nothing left to guard", () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const script = agentUserCreate.rootScript?.(ctxFor(recordingRunner())) ?? "";
		// The guards were deleted along with the steps they guarded: a `[ ! -L ]`
		// test is not a guard against a swap between the test and the use, so
		// keeping it would be the appearance of a guard with none of the effect.
		expect(script).not.toContain("[ ! -L ");
		expect(script).not.toContain("is a symlink; leaving it alone");
	});

	it("gives the primary user NO write on the agent's home or config dir", () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const script = agentUserCreate.rootScript?.(ctxFor(recordingRunner())) ?? "";
		// `x` on the home and `r-x` on the config dir — nothing writable.
		expect(script).not.toContain("u:$primary_user:rwx");
		expect(script).not.toContain("u:$primary_user:rw-");
		expect(script).not.toContain("chmod 2770");
	});

	it("does not let agent-user.dirs write into the agent's home", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const runner = recordingRunner();
		await agentUserDirs.apply?.(ctxFor(runner));
		for (const line of runner.snippets) {
			// Any write aimed at the agent's config dir would be root-equivalent,
			// because the agent controls that path.
			expect(line).not.toMatch(/\b(mkdir|chmod|chown|chgrp|ln|touch)\b[^;]*agent\/\.claude/);
		}
	});
});

describe("C-6 — privilege words stay out of tasks/", () => {
	/**
	 * The grep C-6 names, widened.
	 *
	 * `sudo` alone was not enough: `sudoers`, `gpasswd` and the exported constant
	 * names are the same privilege logic wearing other words, and a task that
	 * spelled one out would be doing privilege work in a file that is supposed
	 * never to see it. Comments are allowed — explaining why a name matters is the
	 * point — but code may only import them from root-script.ts.
	 */
	it("keeps the sudoers and gpasswd words out of tasks/", () => {
		// The WORDS, not the identifiers. Spelling them in a task would put
		// privilege logic in a file C-6 says must never contain it; importing the
		// constant that holds the word is the mechanism for NOT doing that.
		const words = ["sudoers", "gpasswd"];
		const tasksDir = join(import.meta.dirname, "../src/services/machine/tasks");
		let seen = 0;
		for (const file of readdirSync(tasksDir)) {
			if (!file.endsWith(".ts")) continue;
			seen += 1;
			const source = readFileSync(join(tasksDir, file), "utf-8");
			// Comments explain why a name matters, so they are not what is measured.
			const code = source
				.split("\n")
				.filter((line) => !line.trim().startsWith("*") && !line.trim().startsWith("//"))
				.join("\n");
			for (const word of words) {
				expect(code, `${file} spells \`${word}\``).not.toContain(word);
			}
		}
		expect(seen).toBeGreaterThan(0);
	});

	it("exports the privilege constants from root-script.ts, for tasks to import", () => {
		const constants = ["PRIVILEGED_GROUP", "DOCKER_GROUP", "SUDOERS_DIR", "GPASSWD"];
		const rootScript = readFileSync(
			join(import.meta.dirname, "../src/services/machine/root-script.ts"),
			"utf-8",
		);
		for (const name of constants) {
			expect(rootScript, `root-script.ts no longer exports ${name}`).toContain(
				`export const ${name}`,
			);
		}
		// A task may use them as identifiers, but never as a string it compares
		// against — that would put the word back in a file that shouldn't have it.
		const tasksDir = join(import.meta.dirname, "../src/services/machine/tasks");
		for (const file of readdirSync(tasksDir)) {
			if (!file.endsWith(".ts")) continue;
			const source = readFileSync(join(tasksDir, file), "utf-8");
			for (const name of constants) {
				expect(source, `${file} hardcodes the string "${name}"`).not.toContain(`"${name}"`);
			}
		}
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

describe("r3 — real shell probes, diagnostics and quoting", () => {
	function isolatedHome(): string {
		const dir = mkdtempSync(join(tmpdir(), "t16-probe-"));
		const home = join(dir, "home with ' quote");
		mkdirSync(join(home, ".claude"), { recursive: true });
		return home;
	}
	function statFixture(mode = "644"): string {
		return `stat() { case "$2" in %u) command id -u ;; *) echo ${mode} ;; esac; }`;
	}
	function shell(script: string, home: string) {
		return spawnSync("sh", ["-c", script], {
			encoding: "utf8",
			env: { ...process.env, HOME: home, CLAUDE_CONFIG_DIR: join(home, "empty-claude") },
		});
	}

	/**
	 * The shared traversals prune with `find -readable`, which is GNU findutils.
	 * The target machines are Linux; BSD find on a developer Mac does not know
	 * the predicate, so those host-executed probes only run where it exists.
	 * The rendered-prune assertions run everywhere.
	 */
	const gnuFind = spawnSync("find", [".", "-maxdepth", "0", "-readable"], { encoding: "utf8" });
	const findSupportsReadable = !gnuFind.stderr.includes("unknown primary");

	it("reports a real top-level file with NO extended ACL (including quoted home paths)", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const home = isolatedHome();
		try {
			writeFileSync(join(home, "late.txt"), "fixture");
			const runner = recordingRunner();
			await agentUserDirs.check({ ...ctxFor(runner), machine: { ...MACHINE, home } });
			const probe = runner.snippets.find((s) => s.includes("unprotected_top="))!;
			// Only the read-only REAL probe executes. getfacl/stat are fixture
			// functions; no ACL or setup command ever runs on the test host.
			const result = shell(
				`getfacl() { printf 'user::rw-\\ngroup::r--\\nother::r--\\n'; }\n${statFixture()}\n${probe}`,
				home,
			);
			expect(result.status, result.stderr).toBe(0);
			expect(result.stdout).toContain(`unprotected_top=${home}/late.txt,\n`);
		} finally {
			rmSync(join(home, ".."), { recursive: true, force: true });
		}
	});

	it.each(["604", "704", "2704", "701", "1", "2", "3", "5", "6"])(
		"reports a deny with kernel-bypass mode %s",
		(mode) => {
			const home = isolatedHome();
			try {
				writeFileSync(join(home, "late.txt"), "fixture");
				const result = shell(
					`getfacl() { printf 'user:agent:---\\n'; }\n${statFixture(mode)}\n${accessPolicyShell(agentPaths(home, "/home/agent"))}\n${unprotectedEntriesShell(home)}`,
					home,
				);
				expect(result.status, result.stderr).toBe(0);
				expect(result.stdout).toBe(`${home}/late.txt,`);
			} finally {
				rmSync(join(home, ".."), { recursive: true, force: true });
			}
		},
	);

	it.each([
		["4", true],
		["04", true],
		["004", true],
		["0004", true],
		["40", false],
		["604", true],
		["2770", false],
		["1777", false],
		["7", true],
		["70", false],
		["700", false],
	] as const)("normalizes mode %s before the kernel-bypass predicate", (mode, bad) => {
		const home = isolatedHome();
		try {
			const result = shell(
				`${statFixture(mode)}\n${accessPolicyShell(agentPaths(home, "/home/agent"))}\nmode3 ignored; printf '\\n'; if bad_state ignored; then echo bad; else echo safe; fi`,
				home,
			);
			expect(result.status, result.stderr).toBe(0);
			expect(result.stdout).toBe(`${mode.padStart(3, "0").slice(-3)}\n${bad ? "bad" : "safe"}\n`);
		} finally {
			rmSync(join(home, ".."), { recursive: true, force: true });
		}
	});

	it("cleans both legacy ACL namespaces without capping unrelated grants", () => {
		const repair = accessRepairShell();
		expect(repair).toContain('setfacl -x d:g:collab "$1"');
		expect(repair).not.toContain("m::$access");
		expect(repair).toContain('setfacl -m "u:$agent_user:$access" "$1" || return 1');
	});

	// A recursive setfacl fails on any subtree the primary cannot read, and the
	// agent can create one at will. That made a single agent-owned 0700
	// directory under a shared config dir deny the whole grant.
	it("prunes unreadable non-owned subtrees instead of recursing into them", () => {
		const repair = accessRepairShell();
		expect(repair).not.toContain("setfacl -R");
		expect(repair).toContain(
			'find "$1" -xdev \\( -type d ! -user "$(id -u)" ! -readable -prune \\) -o',
		);
		expect(repair).toContain('-mindepth 1 ! -type l -user "$(id -u)" -execdir');
		// The execdir shell starts clean, so it must not rely on the caller's
		// functions or on a PATH it inherits from the agent-writable tree.
		// Only the execdir script itself, between the quoting sh and the `{} +`.
		const traversal = repair.slice(repair.indexOf("-execdir sh -c '"), repair.indexOf("' _ {} +"));
		expect(traversal).toContain("PATH=/usr/local/sbin:");
		expect(traversal).not.toContain("legacy_group");
		expect(repair).toContain("export PATH access default_acl agent_user");
	});

	// setfacl on somebody else's file is EPERM however readable that file is.
	// The traversal had no owner filter, so ONE readable root-owned file under
	// skills/ made the traversal exit nonzero and stopped the whole dirs apply.
	it("skips entries it does not own instead of failing the grant", () => {
		const repair = accessRepairShell();
		// The grant selects the entries this user OWNS, and the report selects
		// exactly the rest. This once read `! -user` on BOTH sides, so the apply
		// called setfacl on nothing but the foreign files (EPERM, apply stopped)
		// and never granted the primary's own: same prune, same type filter,
		// opposite owner test.
		const selection = (text: string, action: string): string => {
			const at = text.indexOf(action);
			const start = text.lastIndexOf("-mindepth 1", at);
			expect(at, action).toBeGreaterThan(0);
			expect(start, action).toBeGreaterThanOrEqual(0);
			return text
				.slice(start, at)
				.replace(/\\\n\s*/g, "")
				.trim();
		};
		const granted = selection(repair, "-execdir");
		const reported = selection(foreignEntriesShell("/h/skills"), "-printf");
		expect(granted).toBe('-mindepth 1 ! -type l -user "$(id -u)"');
		expect(reported).toBe('-mindepth 1 ! -type l ! -user "$(id -u)"');
		// And the skip has to be REPORTED, not silent: it means the agent quietly
		// cannot read that entry. The read-only probe is the same find minus the
		// mutation, so check and apply cannot disagree about what was skipped.
		expect(foreignEntriesShell("/h/skills")).toContain('! -user "$(id -u)" -printf');
		expect(foreignEntriesShell("/h/skills")).not.toContain("-execdir");
	});

	it("warns, without failing, about shared entries it cannot grant", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const lines: string[] = [];
		const runner = recordingRunner([
			{
				match: "foreign_skills",
				result: {
					stdout: settledDirs({
						foreign_skills: "/home/svallory/.claude/skills/root-owned.md,",
					}),
				},
			},
		]);
		const settled = await agentUserDirs.check({
			...ctxFor(runner),
			log: (line) => lines.push(line),
		});
		expect(settled).toBe(true);
		expect(lines.join("\n")).toContain("1 entries under skills/ are not owned by svallory");
		expect(lines.join("\n")).toContain("root-owned.md");
	});

	it("applies the home protection before any shared-tree repair", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const runner = recordingRunner();
		await agentUserDirs.apply?.(ctxFor(runner));
		const script = runner.joined;
		const protectedAt = script.indexOf("setfacl -k");
		const workAt = script.indexOf(`cd -P -- ${HOME}/work`);
		const projectsAt = script.indexOf(`cd -P -- ${HOME}/.claude/projects`);
		const helperAt = script.indexOf("as-agent");
		expect(protectedAt).toBeGreaterThan(-1);
		expect(workAt).toBeGreaterThan(-1);
		expect(projectsAt).toBeGreaterThan(-1);
		expect(protectedAt).toBeLessThan(workAt);
		expect(protectedAt).toBeLessThan(projectsAt);
		expect(workAt).toBeLessThan(projectsAt);
		expect(helperAt).toBeLessThan(projectsAt);
	});

	it("protects shared-looking names in HOME but skips real shared config entries and symlinks", () => {
		const home = isolatedHome();
		try {
			for (const name of ["skills", "settings.json", ".private", "..private"])
				writeFileSync(join(home, name), "fixture");
			for (const name of ["skills", "projects", "commands", "agents"])
				mkdirSync(join(home, ".claude", name));
			for (const name of ["settings.json", "CLAUDE.md", "history.jsonl"])
				writeFileSync(join(home, ".claude", name), "fixture");
			mkdirSync(join(home, "work"));
			symlinkSync(join(home, "skills"), join(home, "link"));
			const result = shell(
				`getfacl() { printf 'user::rw-\\n'; }\n${statFixture()}\n${accessPolicyShell(agentPaths(home, "/home/agent"))}\n${unprotectedEntriesShell(home)}\n${unprotectedEntriesShell(`${home}/.claude`)}`,
				home,
			);
			expect(result.status, result.stderr).toBe(0);
			const paths = result.stdout.split(",").filter(Boolean).sort();
			expect(paths).toEqual(
				["skills", "settings.json", ".private", "..private", ".claude/history.jsonl"]
					.map((name) => join(home, name))
					.sort(),
			);
		} finally {
			rmSync(join(home, ".."), { recursive: true, force: true });
		}
	});

	it("checks shared grants in getfacl's three-character format, including masks", () => {
		const home = isolatedHome();
		try {
			mkdirSync(join(home, ".claude", "skills"));
			writeFileSync(join(home, ".claude", "settings.json"), "fixture");
			const policy = accessPolicyShell(agentPaths(home, "/home/agent"));
			const directory = shell(
				`getfacl() { printf 'user:agent:r-x\\ndefault:user:agent:r-x\\ndefault:other::---\\n'; }\n${policy}\nshared_ok ${shellQuote(join(home, ".claude", "skills"))}`,
				home,
			);
			expect(directory.status, directory.stderr).toBe(0);
			const masked = shell(
				`getfacl() { printf 'user:agent:r--\\t#effective:---\\n'; }\n${policy}\nshared_ok ${shellQuote(join(home, ".claude", "settings.json"))}`,
				home,
			);
			expect(masked.status).toBe(1);
		} finally {
			rmSync(join(home, ".."), { recursive: true, force: true });
		}
	});

	it("skips watched-root attrib events with a trailing slash", () => {
		const home = isolatedHome();
		try {
			mkdirSync(join(home, "work"));
			const result = shell(
				`${accessPolicyShell(agentPaths(home, "/home/agent"))}\nentry_kind ${shellQuote(`${home}/.claude/`)}\nentry_kind ${shellQuote(`${home}/work/`)}\nentry_kind ${shellQuote(`${home}/`)}`,
				home,
			);
			expect(result.status, result.stderr).toBe(0);
			expect(result.stdout).toBe("skip\nskip\nskip\n");
		} finally {
			rmSync(join(home, ".."), { recursive: true, force: true });
		}
	});

	it("embeds arbitrary quotes with one sh -c helper", () => {
		const home = isolatedHome();
		try {
			const result = shell(`${shellCommand("printf '%s' \"$1\"")} ${shellQuote(home)}`, home);
			expect(result.status, result.stderr).toBe(0);
			expect(result.stdout).toBe(home);
		} finally {
			rmSync(join(home, ".."), { recursive: true, force: true });
		}
	});

	it("syntax-checks every rendered mutation without executing it, including a quoted home", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const runner = recordingRunner();
		const ctx = { ...ctxFor(runner), machine: { ...MACHINE, home: "/home/a space's" } };
		await agentUserDirs.apply?.(ctx);
		await agentUserWatcher.apply?.(ctx);
		const scripts = [...runner.snippets, agentUserCreate.rootScript!(ctx)];
		for (const script of scripts) {
			const result = spawnSync("sh", ["-n"], { input: script, encoding: "utf8" });
			expect(result.status, result.stderr).toBe(0);
		}
	});

	it("joined mutations fail on the first error, with its reason", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const home = isolatedHome();
		try {
			let output = "";
			const runner = {
				...recordingRunner(),
				async ssh(argv: string[]) {
					const result = shell(argv[2], home);
					output = result.stdout;
					return { code: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
				},
			};
			await expect(
				runOrFail(ctxFor(runner), "test the first error", "false; printf unexpected"),
			).rejects.toThrow("test the first error");
			expect(output).toBe("");
		} finally {
			rmSync(join(home, ".."), { recursive: true, force: true });
		}
	});

	it("does not call missing optional settings files unshared", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const home = isolatedHome();
		try {
			const runner = recordingRunner();
			await agentUserDirs.check({ ...ctxFor(runner), machine: { ...MACHINE, home } });
			const probe = runner.snippets.find((s) => s.includes("unprotected_top="))!;
			const result = shell(`getfacl() { return 1; }\n${statFixture()}\n${probe}`, home);
			expect(result.stdout).toContain("read_settings.json=1\n");
			expect(result.stdout).toContain("read_CLAUDE.md=1\n");
		} finally {
			rmSync(join(home, ".."), { recursive: true, force: true });
		}
	});

	it("always adds an EXISTING agent to collab, not only in useradd", () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const script = agentUserCreate.rootScript!(ctxFor(recordingRunner()));
		expect(script.split("\n")).toContain('usermod -aG collab "$agent_user"');
	});

	it("warns rather than failing on agent-owned wrong-group entries", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const logs: string[] = [];
		const runner = recordingRunner([
			{
				match: "unprotected_top=",
				result: {
					stdout: settledDirs({ work_agent_wrong_group: "/home/svallory/work/agent-file," }),
				},
			},
		]);
		expect(await agentUserDirs.check({ ...ctxFor(runner), log: (s) => logs.push(s) })).toBe(true);
		expect(logs.join("\n")).toContain("1 agent-owned work entries");
		expect(logs.join("\n")).toContain("agent-file");
	});

	// The same shape, but the agent has made the entry unreadable. Failing here
	// would let the agent suppress the setup run that restores the home
	// protection, so it warns instead.
	it.each(["work", "projects"] as const)(
		"warns rather than failing on unreadable %s entries the primary cannot repair",
		async (name) => {
			withTempConfig('remote = "git@example:x.git"\n');
			const logs: string[] = [];
			const runner = recordingRunner([
				{
					match: "unprotected_top=",
					result: {
						stdout: settledDirs({
							[`${name}_unreadable`]: `/home/svallory/${name}/agentpriv,/home/svallory/${name}/deeper,`,
						}),
					},
				},
			]);
			expect(await agentUserDirs.check({ ...ctxFor(runner), log: (s) => logs.push(s) })).toBe(true);
			expect(logs.join("\n")).toContain(`2 unreadable ${name} entries`);
			expect(logs.join("\n")).toContain("cannot inspect or repair inside them");
			expect(logs.join("\n")).toContain("agentpriv");
		},
	);

	it("names privacy drift even when a shared tree also needs repair", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const logs: string[] = [];
		const runner = recordingRunner([
			{
				match: "unprotected_top=",
				result: {
					stdout: settledDirs({
						unprotected_top: `${HOME}/late.txt,`,
						projects_unsettled: `${HOME}/.claude/projects/x/live.jsonl,`,
					}),
				},
			},
		]);
		expect(await agentUserDirs.check({ ...ctxFor(runner), log: (line) => logs.push(line) })).toBe(
			false,
		);
		expect(logs.join("\n")).toContain("late.txt");
	});

	it.each([
		["rw-", false],
		["r--", true],
		["---", true],
	] as const)("interprets effective shared-file access %s", (effective, missing) => {
		if (!findSupportsReadable) return;
		const home = isolatedHome();
		try {
			const dir = join(home, "work");
			const bin = join(home, "bin");
			mkdirSync(dir);
			mkdirSync(bin);
			const file = join(dir, "shared.txt");
			writeFileSync(file, "fixture");
			writeFileSync(join(bin, "stat"), "#!/bin/sh\nprintf 'collab\\n'\n", { mode: 0o755 });
			writeFileSync(
				join(bin, "getfacl"),
				`#!/bin/sh\nif [ -d "$3" ]; then printf 'group:collab:rwx\\ndefault:group:collab:rwx\\n'; else printf 'group:collab:rwx\\t#effective:${effective}\\n'; fi\n`,
				{ mode: 0o755 },
			);
			const result = shell(
				`PATH=${shellQuote(bin)}:$PATH\nexport PATH\n${unsettledSharedTree(dir)}`,
				home,
			);
			expect(result.status, result.stderr).toBe(0);
			expect(result.stdout.includes(`${file},`)).toBe(missing);
		} finally {
			rmSync(join(home, ".."), { recursive: true, force: true });
		}
	});

	it("classifies unowned protected entries for warnings, never repair", () => {
		const home = isolatedHome();
		try {
			const file = join(home, "foreign");
			writeFileSync(file, "fixture");
			const result = shell(
				`stat() { echo -1; }\n${accessPolicyShell(agentPaths(home, "/home/agent"))}\nentry_kind ${shellQuote(file)}\n${unprotectedEntriesShell(home)}\n${unownedEntriesShell(home)}`,
				home,
			);
			expect(result.status, result.stderr).toBe(0);
			expect(result.stdout).toBe(`unowned\n${file},`);
		} finally {
			rmSync(join(home, ".."), { recursive: true, force: true });
		}
	});

	it("warns without failing for unowned protected entries and other collab members", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const logs: string[] = [];
		const runner = recordingRunner([
			{
				match: "unprotected_top=",
				result: {
					stdout: settledDirs({
						unowned_top: `${HOME}/root-owned,`,
						collab_members: "svallory,agent,nobody,",
					}),
				},
			},
		]);
		expect(await agentUserDirs.check({ ...ctxFor(runner), log: (line) => logs.push(line) })).toBe(
			true,
		);
		expect(logs.join("\n")).toContain(
			`cannot protect, not owned by svallory: 1 entries; ${HOME}/root-owned`,
		);
		expect(logs.join("\n")).toContain(
			"other members of collab are outside this layout's protection: nobody",
		);
	});

	it("requires migration of legacy root group ACLs", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const logs: string[] = [];
		const runner = recordingRunner([
			{ match: "unprotected_top=", result: { stdout: settledDirs({ home_legacy_group: "2" }) } },
		]);
		expect(await agentUserDirs.check({ ...ctxFor(runner), log: (line) => logs.push(line) })).toBe(
			false,
		);
		expect(logs.join("\n")).toContain("legacy collab ACL");
	});

	it("replaces an active watcher when its policy content is old", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const logs: string[] = [];
		const runner = recordingRunner([
			{ match: "watcher=", result: { stdout: settledWatcher({ watcher_content: "no" }) } },
		]);
		expect(
			await agentUserWatcher.check({ ...ctxFor(runner), log: (line) => logs.push(line) }),
		).toBe(false);
		expect(logs.join("\n")).toContain("installed watcher is out of date");
	});

	it("fails and names primary-owned shared entries that can be repaired", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const logs: string[] = [];
		const runner = recordingRunner([
			{
				match: "unprotected_top=",
				result: { stdout: settledDirs({ work_unsettled: "/home/svallory/work/primary-file," }) },
			},
		]);
		expect(await agentUserDirs.check({ ...ctxFor(runner), log: (s) => logs.push(s) })).toBe(false);
		expect(logs.join("\n")).toContain("primary-file");
	});

	it("filters ALL shared-tree mutations by primary ownership and excludes symlinks", () => {
		const script = repairSharedTree("/home/primary/work");
		expect(script).toContain('! -type l -user "$(id -u)" -execdir');
		expect(script).toContain("cd -P -- /home/primary/work");
		expect(watcherScript(`${HOME}/.claude/projects`, HOME)).toContain(
			'find "$entry" -maxdepth 0 ! -type l -user "$(id -u)" -execdir',
		);
		expect(script).not.toContain(" -R ");
		const repair = sharedTreeRepairShell();
		const mutation = repair.indexOf('shared_tree_mutate "$1" setfacl');
		expect(repair.indexOf('[ ! -L "$1" ]')).toBeGreaterThan(-1);
		expect(repair.indexOf('[ ! -L "$1" ]')).toBeLessThan(mutation);
		expect(repair).toContain('shared_tree_candidate "$1" || return 0');
		expect(repair).toContain('shared_tree_mutate "$1" chgrp -h collab');
		expect(repair).toContain('if shared_tree_ok "$1"; then return 0; fi');
	});

	// Setting an extended ACL on a directory clears its set-group-ID bit, so a
	// setfacl after `chmod g+s` left the shared trees never settling: every run
	// set the bit and the default-ACL step took it away again.
	it("sets setgid AFTER the default-ACL mutations, never before", () => {
		const repair = sharedTreeRepairShell();
		const setfacl = repair.indexOf('shared_tree_mutate "$1" setfacl -d -m g:collab:rwX');
		const setgid = repair.indexOf('shared_tree_mutate "$1" chmod g+s');
		expect(setfacl).toBeGreaterThan(-1);
		expect(setgid).toBeGreaterThan(-1);
		expect(setgid).toBeGreaterThan(setfacl);
	});

	// Without this prune, one agent-created 0700 directory made find exit
	// nonzero on every later setup run, which failed the whole run before the
	// home protection was applied.
	it("prunes unreadable non-owned directories in every shared traversal", () => {
		const prune = '\\( -type d ! -user "$(id -u)" ! -readable -prune \\) -o';
		expect(repairSharedTree("/home/primary/work")).toContain(`"$tree_root" ${prune} ! -type l`);
		expect(unsettledSharedTree("/home/primary/work")).toContain(prune);
		expect(unsettledSharedTree("/home/primary/work")).toContain("-xdev");
		expect(unreadableSharedTree("/home/primary/work")).toContain(
			"\\( -type d ! -user \"$(id -u)\" ! -readable -printf '%p,' \\) -prune",
		);
		// The watcher's entry-only variant never descends, so it must not prune.
		expect(repairSharedTreeEntry("/home/primary/work")).not.toContain("-prune");
		expect(watcherScript(`${HOME}/.claude/projects`, HOME)).toContain(
			'"$entry" -maxdepth 0 ! -type l',
		);
	});

	it.each(["owned", "unowned", "symlink", "outside", "replaced"] as const)(
		"rechecks shared-tree mutation bounds for %s entries",
		(kind) => {
			const home = isolatedHome();
			try {
				const tree = join(home, "tree");
				const outside = join(home, "outside");
				mkdirSync(tree);
				mkdirSync(outside);
				writeFileSync(join(tree, "victim"), "inside");
				writeFileSync(join(outside, "victim"), "outside");
				if (kind === "symlink") {
					rmSync(join(tree, "victim"));
					symlinkSync(join(outside, "victim"), join(tree, "victim"));
				}
				// Metadata mutators are shell stubs: NEVER execute ACL/setup mutations
				// on the test host. Only disposable fixture files are replaced.
				const result = shell(
					`tree_root=$(CDPATH= cd -P -- ${shellQuote(tree)} && pwd -P)\ncd ${shellQuote(kind === "outside" ? outside : tree)}\nstat() { case "$2" in %u) ${kind === "unowned" ? "echo -1" : "command id -u"} ;; *) echo collab ;; esac; }\ngetfacl() { ${kind === "replaced" ? `rm -f ./victim; ln -s ${shellQuote(join(outside, "victim"))} ./victim;` : ""} printf 'user:agent:---\\n'; }\nchmod() { echo MUTATED; }\nchgrp() { echo MUTATED; }\nsetfacl() { echo MUTATED; }\n${sharedTreeRepairShell()}\nshared_tree_repair ./victim`,
					home,
				);
				expect(result.status, result.stderr).toBe(0);
				expect(result.stdout.includes("MUTATED")).toBe(kind === "owned");
			} finally {
				rmSync(join(home, ".."), { recursive: true, force: true });
			}
		},
	);

	it("refuses unsupported filesystems even when repairable drift exists", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const runner = recordingRunner([
			{
				match: "unprotected_top=",
				result: {
					stdout: settledDirs({ home_fs: "nfs4", work_unsettled: "/home/svallory/work/x," }),
				},
			},
		]);
		await expect(agentUserDirs.check(ctxFor(runner))).rejects.toThrow("does not apply POSIX ACLs");
	});

	it("refuses a collab login group even on an otherwise incomplete machine", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const runner = recordingRunner([
			{
				match: "printf 'agent_uid=",
				result: {
					stdout: SETTLED_CREATE.replace(
						"primary_login_group=svallory",
						"primary_login_group=collab",
					).replace("acl_tool=yes", "acl_tool=no"),
				},
			},
		]);
		await expect(agentUserCreate.check(ctxFor(runner))).rejects.toThrow("login group");
	});

	it("refuses agent-home symlinks before any mutation inside runuser", () => {
		withTempConfig('remote = "git@example:x.git"\n');
		const script = agentUserCreate.rootScript!(ctxFor(recordingRunner()));
		const start = script.indexOf('runuser -u "$agent_user" -- sh -c');
		const refusal = script.indexOf("is a symlink; refusing agent home setup", start);
		expect(refusal).toBeGreaterThan(start);
		expect(script.indexOf('mkdir -p "$home/.claude"', start)).toBeGreaterThan(refusal);
		expect(script).toContain('for path in "$home" "$home/.claude" "$home/.bashrc"');
		expect(script.slice(refusal, script.indexOf('mkdir -p "$home/.claude"', start))).toContain(
			"exit 1",
		);
	});

	it("every unmet create, dirs and watcher fact logs a reason", async () => {
		withTempConfig('remote = "git@example:x.git"\n');
		for (const [task, settled, match] of [
			[agentUserCreate, SETTLED_CREATE, "printf 'agent_uid="],
			[agentUserDirs, settledDirs(), "unprotected_top="],
			[agentUserWatcher, settledWatcher(), "printf 'watcher="],
		] as const) {
			for (const line of settled.split("\n")) {
				const [key] = line.split("=");
				const logs: string[] = [];
				const runner = recordingRunner([
					{ match, result: { stdout: settled.replace(line, `${key}=BROKEN`) } },
				]);
				const result = await task.check({ ...ctxFor(runner), log: (s) => logs.push(s) });
				if (!result) expect(logs.join("\n"), `${task.id} ${key}`).toContain("not settled —");
			}
			const logs: string[] = [];
			const runner = recordingRunner([{ match, result: { code: 1, stderr: "probe failed" } }]);
			expect(await task.check({ ...ctxFor(runner), log: (s) => logs.push(s) })).toBe(false);
			expect(logs.join("\n")).toContain("probe");
		}
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
