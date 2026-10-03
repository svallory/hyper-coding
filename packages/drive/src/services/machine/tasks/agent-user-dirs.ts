/**
 * `agent-user.dirs` — what the two users share.
 *
 * Runs as the primary user, with no root anywhere in it. Everything it needs was
 * made possible by `agent-user.create`: the `collab` group both users are in, and
 * an agent config dir that is group-writable.
 *
 * THE RULE THIS TASK EXISTS TO KEEP: ACLs over the Claude config dir are never
 * applied recursively. `.credentials.json` is 0600 and must stay unreadable to
 * the second user — a named-group ACL on it would *grant* read, which is the
 * opposite of what a "shared config" task should do. So the config dir itself
 * gets one non-recursive entry (`g:collab:rX`: traverse it, read its listing)
 * and only `projects/` — which holds transcripts and nothing else — is walked.
 *
 * A second, quieter rule: default ACLs on a directory are inherited by
 * everything created inside it later, so the default entry on the config dir is
 * `rX` and the one on `projects/` is `rwX`. Getting those two backwards would
 * either break the agent's writes or hand out more than intended.
 *
 * Claude Code writes session files 0600 and rewrites `settings.json` on every
 * change, which masks whatever ACL a file happens to carry. That is what
 * `agent-user.watcher` is for; this task sets up the directories, and the
 * default ACLs are the first line of defence for anything created afterwards.
 */

import { asAgentScript } from "#services/machine/root-script";
import { shellQuote } from "#services/remote";
import { type AgentPaths, agentHomeOf, agentPaths, agentUserOf, homeOf } from "./agent-context.js";
import { runOrFail, runScript, succeeds } from "./shell.js";
import type { Task, TaskContext } from "./types.js";

/** The group both users share (must match `agent-user.create`). */
const COLLAB_GROUP = "collab";

/**
 * The entries in the agent's config dir that are symlinks into the primary
 * user's, and whether they are writable.
 *
 * `projects` is the writable one — it is the shared transcripts dir, and it is a
 * real directory on the primary side, not a file. Everything else is read-only
 * BY DESIGN: sharing the config dir wholesale was rejected because
 * `.claude.json` holds MCP server commands (writable by both = an escalation
 * path) and because hooks, plugins and skills are the primary user's to change.
 */
const SYMLINKS: readonly { name: string; mode: "link" }[] = [
	{ name: "projects", mode: "link" },
	{ name: "settings.json", mode: "link" },
	{ name: "CLAUDE.md", mode: "link" },
	{ name: "skills", mode: "link" },
	{ name: "commands", mode: "link" },
	{ name: "agents", mode: "link" },
];

/** The two lines every user's shell gets, so shared files are group-accessible from birth. */
const BASHRC_LINES = ["umask 002", "set -o physical"] as const;

/** Everything the check asks the machine, as labelled `key=value` lines. */
function probe(paths: AgentPaths, agentUser: string): string {
	const q = shellQuote;
	return [
		// The shared work dir: group, setgid, and the group entry.
		`printf 'work_group=%s\\n' "$(stat -c %G ${q(paths.work)} 2>/dev/null || echo missing)"`,
		`printf 'work_setgid=%s\\n' "$(stat -c %a ${q(paths.work)} 2>/dev/null | grep -q '[2367]$' && echo yes || echo no)"`,
		`printf 'work_acl=%s\\n' "$(getfacl -c -p ${q(paths.work)} 2>/dev/null | grep -c '^group:collab:rwx' || echo 0)"`,
		`printf 'work_default_acl=%s\\n' "$(getfacl -c -p ${q(paths.work)} 2>/dev/null | grep -c '^default:group:collab:rwx' || echo 0)"`,
		// The home: traversable by the group, so the agent can reach work/.
		`printf 'home_acl=%s\\n' "$(getfacl -c -p ${q(paths.home)} 2>/dev/null | grep -c '^group:collab:--x' || echo 0)"`,
		// The config dir: read+traverse, no write. Exactly one entry, non-recursive.
		`printf 'claude_acl=%s\\n' "$(getfacl -c -p ${q(paths.claude)} 2>/dev/null | grep -c '^group:collab:r-x' || echo 0)"`,
		`printf 'claude_default_acl=%s\\n' "$(getfacl -c -p ${q(paths.claude)} 2>/dev/null | grep -c '^default:group:collab:r-x' || echo 0)"`,
		// projects/: group-writable and setgid.
		`printf 'projects_group=%s\\n' "$(stat -c %G ${q(paths.projects)} 2>/dev/null || echo missing)"`,
		`printf 'projects_setgid=%s\\n' "$(stat -c %a ${q(paths.projects)} 2>/dev/null | grep -q '[2367]$' && echo yes || echo no)"`,
		`printf 'projects_acl=%s\\n' "$(getfacl -c -p ${q(paths.projects)} 2>/dev/null | grep -c '^group:collab:rwx' || echo 0)"`,
		// The agent's config dir, and each symlink's target.
		...SYMLINKS.map(
			(entry) =>
				`printf 'link_${entry.name}=%s\\n' "$(readlink ${q(`${paths.agentClaude}/${entry.name}`)} 2>/dev/null || echo missing)"`,
		),
		`printf 'as_agent=%s\\n' "$(test -x ${q(`${paths.bin}/as-agent`)} && echo yes || echo no)"`,
		`printf 'bashrc_umask=%s\\n' "$(grep -c '^umask 002$' ${q(`${paths.home}/.bashrc`)} 2>/dev/null || echo 0)"`,
		`printf 'bashrc_physical=%s\\n' "$(grep -c '^set -o physical$' ${q(`${paths.home}/.bashrc`)} 2>/dev/null || echo 0)"`,
		// Which user this all ran as, so a mistaken target is visible.
		`printf 'whoami=%s\\n' "$(id -un)"`,
		`printf 'agent_user=%s\\n' ${q(agentUser)}`,
	].join("; ");
}

function answers(stdout: string): Map<string, string> {
	const map = new Map<string, string>();
	for (const line of stdout.split("\n")) {
		const at = line.indexOf("=");
		// Values may contain `=` (paths don't, but a readlink target could), so the
		// FIRST one separates key from value.
		if (at > 0) map.set(line.slice(0, at).trim(), line.slice(at + 1).trim());
	}
	return map;
}

/** `yes` for a yes-flag, `N` for a count that must be at least one. */
function flag(answer: Map<string, string>, key: string): boolean {
	return answer.get(key) === "yes";
}

function present(answer: Map<string, string>, key: string): boolean {
	return Number.parseInt(answer.get(key) ?? "0", 10) > 0;
}

export const agentUserDirs: Task = {
	id: "agent-user.dirs",
	feature: "agent-user",
	needsRoot: false,
	title: "the shared work dir, the transcripts, and the as-agent helper",

	async check(ctx: TaskContext): Promise<boolean> {
		const agentUser = await agentUserOf(ctx);
		const paths = await resolvePaths(ctx, agentUser);
		const result = await runScript(ctx, probe(paths, agentUser));
		if (result.code !== 0) return false;
		const answer = answers(result.stdout);
		// Sanity: if we probed the wrong user, nothing below means anything.
		if (answer.get("agent_user") !== agentUser) return false;

		if (answer.get("work_group") !== COLLAB_GROUP) return false;
		if (!flag(answer, "work_setgid")) return false;
		if (!present(answer, "work_acl") || !present(answer, "work_default_acl")) return false;
		if (!present(answer, "home_acl")) return false;
		if (!present(answer, "claude_acl") || !present(answer, "claude_default_acl")) return false;
		if (answer.get("projects_group") !== COLLAB_GROUP) return false;
		if (!flag(answer, "projects_setgid")) return false;
		if (!present(answer, "projects_acl")) return false;
		for (const entry of SYMLINKS) {
			const target = answer.get(`link_${entry.name}`);
			if (target === undefined || target === "missing" || target === "") return false;
			if (target !== expectedTarget(paths, entry.name)) return false;
		}
		if (!flag(answer, "as_agent")) return false;
		return present(answer, "bashrc_umask") && present(answer, "bashrc_physical");
	},

	async apply(ctx: TaskContext): Promise<void> {
		const agentUser = await agentUserOf(ctx);
		const paths = await resolvePaths(ctx, agentUser);

		// The shared work dir. chgrp/chmod first so the recursive ACL has a group
		// to name, and the setgid pass after so the mode change above can't strip
		// it back off.
		await runOrFail(ctx, "create the shared work dir", `mkdir -p ${shellQuote(paths.work)}`);
		await runOrFail(
			ctx,
			"share the work dir with the collab group",
			[
				`chgrp -R ${COLLAB_GROUP} ${shellQuote(paths.work)}`,
				`chmod -R g+rwx ${shellQuote(paths.work)}`,
				// Every DIRECTORY gets setgid, not just the top: a new subdirectory
				// made by either user then keeps the group, which is what stops the
				// sharing decaying one level down at a time.
				`find ${shellQuote(paths.work)} -type d -exec chmod g+s {} +`,
				`setfacl -R -d -m g:${COLLAB_GROUP}:rwX ${shellQuote(paths.work)}`,
				`setfacl -R -m g:${COLLAB_GROUP}:rwX ${shellQuote(paths.work)}`,
			].join("; "),
		);

		// Traverse on the home. `--x` and not `r-x`: the agent must be able to
		// path through the home to reach work/, and must not be able to list it.
		await runOrFail(
			ctx,
			"let the agent traverse the home",
			`setfacl -m g:${COLLAB_GROUP}:x ${shellQuote(paths.home)}`,
		);

		// The config dir: traverse and read its listing, nothing more. NOT
		// recursive — see the file header. `.credentials.json` stays 0600.
		await runOrFail(
			ctx,
			"grant the agent read access to the shared config entries",
			[
				`setfacl -m g:${COLLAB_GROUP}:rX ${shellQuote(paths.claude)}`,
				`setfacl -d -m g:${COLLAB_GROUP}:rX ${shellQuote(paths.claude)}`,
			].join("; "),
		);

		// projects/ is the shared transcripts dir: the only tree that is walked.
		await runOrFail(
			ctx,
			"share the transcripts dir",
			[
				`mkdir -p ${shellQuote(paths.projects)}`,
				`chgrp -R ${COLLAB_GROUP} ${shellQuote(paths.projects)}`,
				`chmod -R g+rwx ${shellQuote(paths.projects)}`,
				`find ${shellQuote(paths.projects)} -type d -exec chmod g+s {} +`,
				`setfacl -R -d -m g:${COLLAB_GROUP}:rwX ${shellQuote(paths.projects)}`,
				`setfacl -R -m g:${COLLAB_GROUP}:rwX ${shellQuote(paths.projects)}`,
			].join("; "),
		);

		// The symlinks into the agent's config dir. Group-writable on the
		// directory (from agent-user.create), so these are created as you.
		for (const entry of SYMLINKS) {
			const link = `${paths.agentClaude}/${entry.name}`;
			const target = expectedTarget(paths, entry.name);
			await runOrFail(
				ctx,
				`point ${entry.name} at your own copy`,
				[
					`mkdir -p ${shellQuote(paths.agentClaude)}`,
					// Replace whatever is there when it isn't already this symlink.
					// `test -L` first so a real directory is never `rm -rf`'d: if
					// the agent has real projects there, that is their state.
					`if [ -L ${shellQuote(link)} ]; then [ "$(readlink ${shellQuote(link)})" = ${shellQuote(target)} ] || ln -sfn ${shellQuote(target)} ${shellQuote(link)}; fi`,
					`test -L ${shellQuote(link)} || ln -sfn ${shellQuote(target)} ${shellQuote(link)}`,
				].join("; "),
			);
		}

		// The as-agent helper: the one place the user types a privileged command
		// themselves. hyper writes the file; it never runs it (C-6).
		await runOrFail(
			ctx,
			"install the as-agent helper",
			[
				`mkdir -p ${shellQuote(paths.bin)}`,
				`cat > ${shellQuote(`${paths.bin}/as-agent`)} <<'HYPER_AS_AGENT_EOF'`,
				asAgentScript(agentUser).trimEnd(),
				"HYPER_AS_AGENT_EOF",
				`chmod 0755 ${shellQuote(`${paths.bin}/as-agent`)}`,
			].join("\n"),
		);

		// The shell lines, appended once each. Grep-guarded so a second run adds
		// nothing (C-15) and so a line the user already added is not duplicated.
		for (const line of BASHRC_LINES) {
			await runOrFail(
				ctx,
				`add "${line}" to your .bashrc`,
				[
					`touch ${shellQuote(`${paths.home}/.bashrc`)}`,
					`grep -qxF ${shellQuote(line)} ${shellQuote(`${paths.home}/.bashrc`)} || printf '%s\\n' ${shellQuote(line)} >> ${shellQuote(`${paths.home}/.bashrc`)}`,
				].join("; "),
			);
		}
	},
};

/** Where an entry in the agent's config dir must point. */
function expectedTarget(paths: AgentPaths, name: string): string {
	return `${paths.claude}/${name}`;
}

/** Resolve every path the task needs, in one place so apply and check agree. */
async function resolvePaths(ctx: TaskContext, agentUser: string): Promise<AgentPaths> {
	const home = await homeOf(ctx);
	const agentHome = await agentHomeOf(ctx, agentUser);
	return agentPaths(home, agentHome);
}

/**
 * Whether this machine has the packages this task needs.
 *
 * Exported for the e2e harness, which asserts the failure message rather than
 * the exit code: a machine without `acl` fails every check here, and the useful
 * thing to say is which package to install, not "check returned false".
 */
export async function missingTools(ctx: TaskContext): Promise<string[]> {
	const result = await runScript(
		ctx,
		"for t in setfacl getfacl; do command -v $t >/dev/null 2>&1 || echo $t; done",
	);
	return result.stdout.split("\n").filter((line) => line.trim() !== "");
}

/** True when every tool this task shells out to is present. */
export async function hasTools(ctx: TaskContext): Promise<boolean> {
	return succeeds(
		ctx,
		"for t in setfacl getfacl stat; do command -v $t >/dev/null 2>&1 || exit 1; done",
	);
}
