/**
 * Primary-user sharing: no root, no writes in the agent's home, and no recursive
 * ACL over the home or the Claude config root. Default DENY on those two roots;
 * explicit grants only on the shared entries. See agent-acl.ts for the policy.
 */
import { asAgentScript } from "#services/machine/root-script";
import { shellQuote } from "#services/remote";
import {
	accessPolicyShell,
	accessRepairShell,
	COLLAB_GROUP,
	directEntriesShell,
	foreignEntriesShell,
	READABLE_DIRS,
	READABLE_FILES,
	SHARED_ENTRIES,
	unownedEntriesShell,
	unprotectedEntriesShell,
} from "./agent-acl.js";
import {
	type AgentPaths,
	agentHomeOf,
	agentPaths,
	agentUserOf,
	homeOf,
	passwdHomeOf,
	primaryUserOf,
} from "./agent-context.js";
import {
	agentWrongGroup,
	repairSharedTree,
	unreadableSharedTree,
	unsettledSharedTree,
} from "./agent-shared-tree.js";
import { ensureBashrcLine, runOrFail, runScript, succeeds } from "./shell.js";
import type { Task, TaskContext } from "./types.js";

const UNSUPPORTED_FS = /^(nfs|cifs|smb|fuse)/;
const BASHRC_LINES = ["umask 002", "set -o physical"] as const;

/** The read-only probe; tests capture and execute the real check's commands. */
function dirsProbe(paths: AgentPaths, agentUser: string): string {
	const q = shellQuote;
	const aclCount = (path: string, entry: string) =>
		`$(getfacl -c -p ${q(path)} 2>/dev/null | grep -cxF ${q(entry)} || true)`;
	return [
		accessPolicyShell(paths, agentUser),
		...(
			[
				["work", paths.work],
				["projects", paths.projects],
			] as const
		).flatMap(([name, dir]) => [
			`printf '${name}_unsettled=%s\\n' "$(${unsettledSharedTree(dir, agentUser)})"`,
			`printf '${name}_agent_wrong_group=%s\\n' "$(${agentWrongGroup(dir, agentUser)})"`,
			`printf '${name}_unreadable=%s\\n' "$(${unreadableSharedTree(dir)})"`,
		]),
		`printf 'work_group=%s\\n' "$(stat -c %G ${q(paths.work)} 2>/dev/null || echo missing)"`,
		`printf 'work_setgid=%s\\n' "$(test -g ${q(paths.work)} && echo yes || echo no)"`,
		`printf 'work_acl=%s\\n' "${aclCount(paths.work, "group:collab:rwx")}"`,
		`printf 'work_default_acl=%s\\n' "${aclCount(paths.work, "default:group:collab:rwx")}"`,
		`printf 'home_acl=%s\\n' "${aclCount(paths.home, `user:${agentUser}:--x`)}"`,
		`printf 'home_default_deny=%s\\n' "${aclCount(paths.home, `default:user:${agentUser}:---`)}"`,
		`printf 'home_default_other=%s\\n' "${aclCount(paths.home, "default:other::---")}"`,
		`printf 'home_fs=%s\\n' "$(stat -f -c %T ${q(paths.home)} 2>/dev/null || echo unknown)"`,
		`printf 'hardlinks=%s\\n' "$(cat /proc/sys/fs/protected_hardlinks 2>/dev/null || echo 0)"`,
		`printf 'tiocsti=%s\\n' "$(cat /proc/sys/dev/tty/legacy_tiocsti 2>/dev/null || echo 1)"`,
		`printf 'primary_user=%s\\n' "$(id -un)"`,
		`printf 'collab_members=%s\\n' "$( { getent group collab | cut -d: -f4 | tr ',' '\\n'; gid=$(getent group collab | cut -d: -f3); getent passwd | awk -F: -v gid="$gid" 'gid != "" && $4 == gid {print $1}'; } | sort -u | tr '\\n' ',')"`,
		`printf 'unowned_top=%s\\n' "$(${unownedEntriesShell(paths.home)})"`,
		`printf 'unowned_claude=%s\\n' "$(${unownedEntriesShell(paths.claude)})"`,
		`printf 'home_legacy_group=%s\\n' "$(getfacl -c -p ${q(paths.home)} 2>/dev/null | grep -Ec '^(default:)?group:collab:' || true)"`,
		`printf 'claude_legacy_group=%s\\n' "$(getfacl -c -p ${q(paths.claude)} 2>/dev/null | grep -Ec '^(default:)?group:collab:' || true)"`,
		`printf 'unprotected_top=%s\\n' "$(${unprotectedEntriesShell(paths.home)})"`,
		`printf 'unprotected_claude=%s\\n' "$(${unprotectedEntriesShell(paths.claude)})"`,
		`printf 'claude_acl=%s\\n' "${aclCount(paths.claude, `user:${agentUser}:--x`)}"`,
		`printf 'claude_default_deny=%s\\n' "${aclCount(paths.claude, `default:user:${agentUser}:---`)}"`,
		`printf 'claude_default_other=%s\\n' "${aclCount(paths.claude, "default:other::---")}"`,
		...[...READABLE_FILES, ...READABLE_DIRS].map((name) => {
			const path = q(`${paths.claude}/${name}`);
			// A missing optional file is fine. Existing shared entries must carry
			// effective grants, not merely an ACL line masked to nothing.
			const optional = READABLE_FILES.some((file) => file === name) ? `[ ! -e ${path} ] || ` : "";
			return `printf 'read_${name}=%s\\n' "$(if ${optional}shared_ok ${path}; then echo 1; else echo 0; fi)"`;
		}),
		...READABLE_DIRS.map(
			(name) =>
				`printf 'foreign_${name}=%s\\n' "$(${foreignEntriesShell(`${paths.claude}/${name}`)})"`,
		),
		`printf 'projects_group=%s\\n' "$(stat -c %G ${q(paths.projects)} 2>/dev/null || echo missing)"`,
		`printf 'projects_setgid=%s\\n' "$(test -g ${q(paths.projects)} && echo yes || echo no)"`,
		`printf 'projects_acl=%s\\n' "${aclCount(paths.projects, "group:collab:rwx")}"`,
		...SHARED_ENTRIES.map(
			(name) =>
				`printf 'link_${name}=%s\\n' "$(readlink ${q(`${paths.agentClaude}/${name}`)} 2>/dev/null || echo missing)"`,
		),
		`printf 'as_agent=%s\\n' "$(test -x ${q(`${paths.bin}/as-agent`)} && echo yes || echo no)"`,
		`printf 'bashrc_umask=%s\\n' "$(grep -c '^umask 002$' ${q(`${paths.home}/.bashrc`)} 2>/dev/null || true)"`,
		`printf 'bashrc_physical=%s\\n' "$(grep -c '^set -o physical$' ${q(`${paths.home}/.bashrc`)} 2>/dev/null || true)"`,
		`printf 'agent_user=%s\\n' ${q(agentUser)}`,
	].join("\n");
}

function answers(stdout: string): Map<string, string> {
	const map = new Map<string, string>();
	for (const line of stdout.split("\n")) {
		const at = line.indexOf("=");
		if (at > 0) map.set(line.slice(0, at).trim(), line.slice(at + 1).trim());
	}
	return map;
}

export const agentUserDirs: Task = {
	id: "agent-user.dirs",
	feature: "agent-user",
	needsRoot: false,
	title: "the shared work dir, the transcripts, and the as-agent helper",

	async check(ctx: TaskContext): Promise<boolean> {
		const agentUser = await agentUserOf(ctx);
		const paths = await resolvePaths(ctx, agentUser);
		const no = (why: string): false => {
			ctx.log(`agent-user.dirs: not settled — ${why}`);
			return false;
		};
		const result = await runScript(ctx, dirsProbe(paths, agentUser));
		if (result.code !== 0)
			return no(`the probe itself failed: ${result.stderr.trim() || result.code}`);
		const answer = answers(result.stdout);
		const present = (key: string) => Number.parseInt(answer.get(key) ?? "0", 10) > 0;
		if (answer.get("agent_user") !== agentUser)
			return no("the probe answered for a different agent user");
		const fs = answer.get("home_fs") ?? "unknown";
		if (fs === "unknown" || UNSUPPORTED_FS.test(fs)) {
			throw new Error(
				`Your home is on a ${fs} filesystem, which does not apply POSIX ACLs the way this setup needs. I've changed nothing. Use a local filesystem that supports POSIX ACLs.`,
			);
		}
		const primary = answer.get("primary_user") || "the primary user";
		for (const key of ["unowned_top", "unowned_claude"]) {
			const paths = (answer.get(key) ?? "").split(",").filter(Boolean);
			if (paths.length)
				ctx.log(
					`agent-user.dirs: warning — cannot protect, not owned by ${primary}: ${paths.length} entries; ${paths.slice(0, 3).join(", ")}`,
				);
		}
		// Entries in the shared config dirs that belong to somebody else. The
		// traversal skips them (setfacl on them is EPERM however readable they
		// are), so this is a limit, not a fault: warn, and never fail on it.
		for (const name of READABLE_DIRS) {
			const foreign = (answer.get(`foreign_${name}`) ?? "").split(",").filter(Boolean);
			if (foreign.length > 0)
				ctx.log(
					`agent-user.dirs: warning — ${foreign.length} entries under ${name}/ are not owned by ${primary} and are skipped; the agent cannot be granted read access to them, and no unprivileged run can fix that: ${foreign.slice(0, 3).join(", ")}`,
				);
		}
		const others = (answer.get("collab_members") ?? "")
			.split(",")
			.filter((name) => name && name !== primary && name !== agentUser);
		if (others.length)
			ctx.log(
				`agent-user.dirs: warning — other members of collab are outside this layout's protection: ${others.join(", ")}`,
			);
		for (const key of ["home_legacy_group", "claude_legacy_group"]) {
			if (answer.get(key) !== "0")
				return no(
					`legacy collab ACL on ${key.startsWith("home") ? "the home" : "the config root"}; re-run setup to migrate it`,
				);
		}
		// Privacy drift is the first actionable fact, even when a shared tree also
		// needs repair. Always name the exposed entries before any early return.
		for (const key of ["unprotected_top", "unprotected_claude"]) {
			const entries = answer.get(key);
			if (entries === undefined) return no(`the probe did not answer ${key}`);
			if (entries !== "")
				return no(
					`these entries are unprotected from ${agentUser}: ${entries.replace(/,$/, "")}. Running setup again denies them.`,
				);
		}
		for (const name of ["work", "projects"]) {
			const wrong = (answer.get(`${name}_agent_wrong_group`) ?? "").split(",").filter(Boolean);
			if (wrong.length > 0)
				ctx.log(
					`agent-user.dirs: warning — ${wrong.length} agent-owned ${name} entries have the wrong group; the primary cannot repair them: ${wrong.slice(0, 3).join(", ")}`,
				);
			// An agent-owned 0700 directory is a state the primary cannot read or
			// repair, so it is skipped rather than failed on: failing here would
			// let the agent suppress every later setup run, including the one that
			// restores the home protection.
			const unreadable = (answer.get(`${name}_unreadable`) ?? "").split(",").filter(Boolean);
			if (unreadable.length > 0)
				ctx.log(
					`agent-user.dirs: warning — ${unreadable.length} unreadable ${name} entries not owned by ${primary} are skipped; the primary cannot inspect or repair inside them: ${unreadable.slice(0, 3).join(", ")}`,
				);
			const unsettled = answer.get(`${name}_unsettled`);
			if (unsettled === undefined) return no(`the probe did not answer ${name}_unsettled`);
			if (unsettled !== "")
				return no(`primary-owned ${name} entries need group/access repair: ${unsettled}`);
		}
		for (const [key, expected, reason] of [
			["work_group", COLLAB_GROUP, "the work dir is not owned by the collab group"],
			["work_setgid", "yes", "the work dir is not setgid"],
			["hardlinks", "1", "fs.protected_hardlinks is not in effect"],
			["tiocsti", "0", "dev.tty.legacy_tiocsti is not in effect"],
			["projects_group", COLLAB_GROUP, "projects/ is not owned by the collab group"],
			["projects_setgid", "yes", "projects/ is not setgid"],
			["as_agent", "yes", "the as-agent helper is missing or not executable"],
		])
			if (answer.get(key) !== expected) return no(reason);
		for (const key of [
			"work_acl",
			"work_default_acl",
			"home_acl",
			"home_default_deny",
			"home_default_other",
			"claude_acl",
			"claude_default_deny",
			"claude_default_other",
			"projects_acl",
			"bashrc_umask",
			"bashrc_physical",
		]) {
			if (!present(key)) return no(`missing or ineffective ${key}; re-run setup to repair it`);
		}
		for (const name of [...READABLE_FILES, ...READABLE_DIRS]) {
			if (!present(`read_${name}`))
				return no(`${name} has no effective ${agentUser} read/default grant`);
		}
		for (const name of SHARED_ENTRIES) {
			if (answer.get(`link_${name}`) !== `${paths.claude}/${name}`)
				return no(`~${agentUser}/.claude/${name} is not a symlink to the shared entry`);
		}
		return true;
	},

	async apply(ctx: TaskContext): Promise<void> {
		const agentUser = await agentUserOf(ctx);
		const paths = await resolvePaths(ctx, agentUser);
		const q = shellQuote;
		const ready = await runScript(
			ctx,
			`test -d ${q(paths.agentClaude)} && test -r ${q(paths.agentClaude)}`,
		);
		if (ready.code !== 0) {
			ctx.log(
				`agent-user.dirs: ${paths.agentClaude} isn't there yet — run the agent-user.create root script, then re-run setup.`,
			);
			return;
		}
		const policy = `${accessPolicyShell(paths, agentUser)}\n${accessRepairShell()}`;
		// Privacy first. A shared tree can be wedged by anything the agent can
		// create there, and setup is the documented fallback that restores the
		// home protection when the watcher is down. Repairing the shared trees
		// last means no failure in them can stop the home and config protection
		// from being applied first.
		await runOrFail(ctx, "create the primary config dir", `mkdir -p ${q(paths.claude)}`);
		for (const dir of [paths.home, paths.claude]) {
			await runOrFail(
				ctx,
				`protect ${dir}`,
				[
					policy,
					`mode=$(mode3 ${q(dir)})`,
					`setfacl -k ${q(dir)}`,
					`setfacl -m ${q(`u:${agentUser}:--x`)} ${q(dir)}`,
					`setfacl -x g:collab ${q(dir)}`,
					`setfacl -d -m "u::rwx,u:$agent_user:---,g::$(perms_of "$(group_digit "$mode")"),o::---" ${q(dir)}`,
					directEntriesShell(
						dir,
						'  if [ "$(entry_kind "$entry")" = deny ]; then protect "$entry"; fi',
					),
				].join("\n"),
			);
		}
		await runOrFail(
			ctx,
			"grant read access to the shared config entries",
			[
				policy,
				...READABLE_DIRS.map((name) => `mkdir -p ${q(`${paths.claude}/${name}`)}`),
				directEntriesShell(
					paths.claude,
					'  case "$(entry_kind "$entry")" in read_file|read_dir) grant_shared "$entry" ;; esac',
				),
			].join("\n"),
		);
		await runOrFail(ctx, "create the shared work dir", `mkdir -p ${q(paths.work)}`);
		await runOrFail(ctx, "create the transcripts dir", `mkdir -p ${q(paths.projects)}`);
		await runOrFail(
			ctx,
			"install the as-agent helper",
			[
				`mkdir -p ${q(paths.bin)}`,
				`cat > ${q(`${paths.bin}/as-agent`)} <<'HYPER_AS_AGENT_EOF'`,
				asAgentScript(agentUser).trimEnd(),
				"HYPER_AS_AGENT_EOF",
				`chmod 0755 ${q(`${paths.bin}/as-agent`)}`,
			].join("\n"),
		);
		for (const line of BASHRC_LINES) {
			// The same helper `home-path.physical` uses: one `grep -qxF` guard, so
			// selecting both features writes this line once rather than twice.
			await runOrFail(
				ctx,
				`add "${line}" to your .bashrc`,
				ensureBashrcLine(`${paths.home}/.bashrc`, line),
			);
		}
		// Both shared trees last, and only after the protection above has run.
		await shareTree(ctx, paths.work, agentUser);
		await shareTree(ctx, paths.projects, agentUser);
	},
};

async function shareTree(ctx: TaskContext, dir: string, agentUser: string): Promise<void> {
	await runOrFail(ctx, `share ${dir} with the collab group`, repairSharedTree(dir, agentUser));
}

async function resolvePaths(ctx: TaskContext, agentUser: string): Promise<AgentPaths> {
	const configured = await homeOf(ctx);
	// A configured home that ISN'T THERE YET must not fail this task. That is
	// exactly the state of a machine whose `home-path` root script has not run:
	// `drive.toml` says /Users/<name>, the account's home is still /home/<name>,
	// and the move needs root — which the runner only offers AFTER the
	// non-root tasks have applied. Reading the configured path here made the
	// probe report an unknown filesystem and this task THROW, which took the
	// whole run down before the user was ever shown the root script. So the
	// layout follows the account's real home (what the password database names)
	// until the two agree, and says so.
	const there = await runScript(ctx, `test -d ${shellQuote(configured)} && echo yes || echo no`);
	// Only an explicit "no" switches. A runner that cannot answer (an empty
	// probe) keeps the configured home, rather than silently re-aiming the layout.
	if (there.stdout.trim() === "no") {
		const real = await passwdHomeOf(ctx, await primaryUserOf(ctx));
		ctx.log(
			`agent-user.dirs: ${configured} isn't there yet, so I'm working on ${real} — the home-path root script moves it later in this same run.`,
		);
		return agentPaths(real, await agentHomeOf(ctx, agentUser));
	}
	return agentPaths(configured, await agentHomeOf(ctx, agentUser));
}

export async function missingTools(ctx: TaskContext): Promise<string[]> {
	const result = await runScript(
		ctx,
		"for t in setfacl getfacl; do command -v $t >/dev/null 2>&1 || echo $t; done",
	);
	return result.stdout.split("\n").filter((line) => line.trim() !== "");
}

export async function hasTools(ctx: TaskContext): Promise<boolean> {
	return succeeds(
		ctx,
		"for t in setfacl getfacl stat; do command -v $t >/dev/null 2>&1 || exit 1; done",
	);
}
