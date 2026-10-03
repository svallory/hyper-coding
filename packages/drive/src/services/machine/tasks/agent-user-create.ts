/**
 * `agent-user.create` — the account unsupervised agent runs as.
 *
 * The whole of the unattended-agent design in one task: a second Linux user
 * that shares your work and your transcripts through a group, and holds no
 * credentials of yours. What makes it safe is three absences, all checked here
 * and all enforced by the script: no privilege drop-in, no membership of the
 * privileged group, no membership of the docker group.
 *
 * The absences are the point, so they are asserted individually rather than as
 * one "user looks right". A user in the docker group is root on that host (the
 * socket is owned by `docker`), and a user with a privilege drop-in is root
 * outright; a check that only asked "does the user exist and is it in collab"
 * would call that machine finished.
 *
 * Every step in `rootScript` is guarded, so running it twice changes nothing
 * (C-15) — and hyper never runs it (C-6).
 */

import { DOCKER_GROUP, PRIVILEGED_GROUP, SUDOERS_DIR } from "#services/machine/root-script";
import { shellQuote } from "#services/remote";
import { agentHomeOf, agentUserOf, primaryUserLines, primaryUserOf } from "./agent-context.js";
import { runScript } from "./shell.js";
import type { Task, TaskContext } from "./types.js";

/** The group both users share. Not `users`: nothing else on the machine should be in it. */
const COLLAB_GROUP = "collab";

/**
 * Read-only answers, one `key=value` line each.
 *
 * Labelled rather than positional: the group lists are variable-length, and a
 * positional reader that is one line out reads a wrong answer as a right one —
 * which for this task means calling a machine with a privilege drop-in "done".
 */
function probe(agentUser: string, primaryUser: string, agentHome: string): string {
	const q = shellQuote;
	return [
		// The agent user exists (its uid, blank when there is no such user).
		`printf 'agent_uid=%s\\n' "$(id -u ${q(agentUser)} 2>/dev/null || true)"`,
		`printf 'collab_group=%s\\n' "$(getent group ${COLLAB_GROUP} >/dev/null 2>&1 && echo yes || echo no)"`,
		// Both users' supplementary groups, comma-joined on one line each.
		`printf 'agent_groups=%s\\n' "$(id -nG ${q(agentUser)} 2>/dev/null | tr ' ' ',' || true)"`,
		`printf 'primary_groups=%s\\n' "$(id -nG ${q(primaryUser)} 2>/dev/null | tr ' ' ',' || true)"`,
		// A privilege drop-in named after the agent.
		`printf 'dropin_entry=%s\\n' "$(test -e ${SUDOERS_DIR}/${q(agentUser)} && echo yes || echo no)"`,
		// The agent's config dir exists and the primary user may write in it.
		`printf 'agent_config_writable=%s\\n' "$(test -d ${q(agentHome)}/.claude && test -w ${q(agentHome)}/.claude && echo yes || echo no)"`,
		// Asked as the primary user, not read off the mode: Debian's HOME_MODE is
		// 0700, so the agent's home needs a traverse ACL of its own or this is
		// false however permissive the config dir inside it is.
		`printf 'agent_home_traversable=%s\\n' "$(test -x ${q(agentHome)} && echo yes || echo no)"`,
		// Linger: the agent's own systemd --user units outlive a logout.
		`printf 'linger=%s\\n' "$(loginctl show-user ${q(agentUser)} --property=Linger --value 2>/dev/null || true)"`,
	].join("; ");
}

/** The parsed answers to {@link probe}. Anything missing or unparsable reads as absent. */
interface Probe {
	agentExists: boolean;
	collabGroup: boolean;
	agentGroups: string[];
	primaryGroups: string[];
	dropInEntry: boolean;
	agentConfigWritable: boolean;
	agentHomeTraversable: boolean;
	linger: boolean;
}

function parseProbe(stdout: string): Probe {
	const answers = new Map<string, string>();
	for (const line of stdout.split("\n")) {
		const at = line.indexOf("=");
		if (at <= 0) continue;
		answers.set(line.slice(0, at).trim(), line.slice(at + 1).trim());
	}
	const yes = (key: string): boolean => answers.get(key) === "yes";
	const groups = (key: string): string[] =>
		(answers.get(key) ?? "")
			.split(",")
			.map((group) => group.trim())
			.filter((group) => group !== "");
	return {
		agentExists: /^\d+$/.test(answers.get("agent_uid") ?? ""),
		collabGroup: yes("collab_group"),
		agentGroups: groups("agent_groups"),
		primaryGroups: groups("primary_groups"),
		dropInEntry: yes("dropin_entry"),
		agentConfigWritable: yes("agent_config_writable"),
		agentHomeTraversable: yes("agent_home_traversable"),
		linger: yes("linger"),
	};
}

export const agentUserCreate: Task = {
	id: "agent-user.create",
	feature: "agent-user",
	needsRoot: true,
	title: "the user agents run as, and the group it shares with you",

	async check(ctx: TaskContext): Promise<boolean> {
		const agentUser = await agentUserOf(ctx);
		const primaryUser = await primaryUserOf(ctx);
		const agentHome = await agentHomeOf(ctx, agentUser);
		const result = await runScript(ctx, probe(agentUser, primaryUser, agentHome));
		if (result.code !== 0) return false;
		const parsed = parseProbe(result.stdout);

		// Both users must be in the group, or nothing downstream can be shared.
		if (!parsed.agentExists || !parsed.collabGroup) return false;
		if (!parsed.agentGroups.includes(COLLAB_GROUP)) return false;
		if (!parsed.primaryGroups.includes(COLLAB_GROUP)) return false;
		// The three absences.
		if (parsed.dropInEntry) return false;
		if (parsed.agentGroups.includes(PRIVILEGED_GROUP)) return false;
		if (parsed.agentGroups.includes(DOCKER_GROUP)) return false;
		// The agent's config dir must be creatable and writable by the primary
		// user, or `agent-user.dirs` cannot install its symlinks and would have
		// to keep asking for root.
		if (!parsed.agentConfigWritable) return false;
		// …which needs the agent's home itself to be traversable.
		if (!parsed.agentHomeTraversable) return false;
		// Linger is what lets the agent's own `systemd --user` unit keep running
		// with no session of its own — the watcher depends on it.
		return parsed.linger;
	},

	rootScript(ctx: TaskContext): string {
		const agentUser =
			ctx.machine?.agentUser ?? ctx.config.machines[ctx.config.self.name]?.agent_user ?? "agent";
		const primaryUser = primaryUserLines(ctx);
		const agentUserQ = shellQuote(agentUser);
		return `# The unattended agent user.
#
# Adds a second Linux user for agents to run as, in a group you both belong to.
# The agent shares your work dir and your Claude transcripts through that group,
# and holds none of your credentials: no privileged group, no docker group, no
# privilege drop-in. Each step below is guarded, so running this twice changes
# nothing.

# Packages the unprivileged tasks need: ACLs for the shared dirs, inotifywait
# for the watcher. Guarded, because they are usually already there and because
# hyper itself never installs anything (C-6) — this script is yours.
if ! command -v setfacl >/dev/null 2>&1; then
  apt-get install -y acl
fi
if ! command -v inotifywait >/dev/null 2>&1; then
  apt-get install -y inotify-tools
fi

# Who you are: the user who ran this with their password, which is the login
# that invoked the script. Resolved HERE rather than baked in, because the ssh
# target's user part is only a username when the target is written as one — an
# ssh alias or a bare hostname has none, and \`usermod\` handed an alias would
# abort the whole script.
${primaryUser}

# The shared group.
getent group ${COLLAB_GROUP} >/dev/null 2>&1 || groupadd ${COLLAB_GROUP}

# The agent user itself. -m gives it a home (its own config dir lives there);
# bash because everything an agent runs is a shell pipeline.
id -u ${agentUserQ} >/dev/null 2>&1 || useradd -m -s /bin/bash -G ${COLLAB_GROUP} ${agentUserQ}

# You, in the same group, so the shared dirs are reachable from both sides.
usermod -aG ${COLLAB_GROUP} "$primary_user"

# The absences, in order of how much they matter. gpasswd -d removes a
# supplementary membership; it fails harmlessly when there is none, so each is
# guarded on the membership existing first.
id -nG ${agentUser} 2>/dev/null | tr ' ' '\\n' | grep -qx ${PRIVILEGED_GROUP} && \\
  gpasswd -d ${agentUser} ${PRIVILEGED_GROUP} || true
id -nG ${agentUser} 2>/dev/null | tr ' ' '\\n' | grep -qx ${DOCKER_GROUP} && \\
  gpasswd -d ${agentUser} ${DOCKER_GROUP} || true
rm -f ${SUDOERS_DIR}/${agentUser}

# The agent's home. Debian's HOME_MODE is 0700, so this is a private directory
# until we say otherwise below.
agent_home="$(getent passwd ${agentUser} | cut -d: -f6)"

# The agent's own config dir, group-writable so the entries \`agent-user.dirs\`
# symlinks into it can be created by you without root. This is the ONLY thing
# that task needs from root; without it every symlink it wants would be a root
# step. install(1) ignores setgid bits in -m, so it is set explicitly.
install -d -o ${agentUser} -g ${COLLAB_GROUP} -m 2770 "\${agent_home}/.claude"
chmod 2770 "\${agent_home}/.claude"

# Let you path INTO the agent's home, so you can write those symlinks — and
# nothing else: \`x\` alone is traverse, not list. A named-user ACL rather than
# \`chmod o+x\`, so no other account on this machine gains anything from it.
setfacl -m "u:$primary_user:x" "\${agent_home}"

# Keep a collaborative default umask and real-path cd in the agent's shell, so
# files it writes are group-accessible by creation rather than by the watcher.
touch "\${agent_home}/.bashrc"
grep -q 'umask 002' "\${agent_home}/.bashrc" || \\
  printf '\\n# hyper: files here are shared with the primary user\\numask 002\\n' >> "\${agent_home}/.bashrc"

# Linger, so the agent's own systemd --user units (the transcript watcher) keep
# running with no session of its own.
loginctl enable-linger ${agentUser}
`;
	},
};

/**
 * The primary user's name for the script.
 *
 * The primary user, as a FALLBACK for the script to use when it can't work the
 * name out itself.
 *
 * `rootScript` is synchronous and the real answer is a question only the machine
 * can answer, which is why the generated script prefers `$SUDO_USER` at run
 * time and uses this only if that is unset. Baking the guess in unconditionally
 * is wrong more often than it is right: an ssh target's `user@` part is only a
 * user when the target is written as one, and an ssh alias (`Host t16` →
 * `t16box`) or a bare hostname has no user part at all — so `usermod` would be
 * handed an alias as a username and the script would stop on `set -e`.
 */
