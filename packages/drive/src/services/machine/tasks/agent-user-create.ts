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
 * TWO RULES SHAPE THE SCRIPT, and both came out of a security review:
 *
 * 1. **The agent user name is never trusted.** It comes from a config file on
 *    one machine and becomes the argument to `useradd`, a path in an `rm -f`, and
 *    a user to become — all as root. So it is validated three times: when the
 *    config is read, again here before anything else happens, and again at the
 *    top of the generated script itself (`rootScriptGuards`), because the config
 *    may have been edited since the script was written. Every interpolation is
 *    quoted as well, so the validation failing is a second line of defence
 *    rather than the only one.
 *
 * 2. **Root never touches a path inside the agent's home.** The agent controls
 *    everything there and can plant symlinks; root following one is root
 *    writing wherever it points. So the config dir, the symlinks and the
 *    .bashrc lines and all metadata/ACLs are done by `runuser -u <agent>`.
 *    Root has no business touching any path under that home.
 *
 * Every step is guarded, so running the script twice changes nothing (C-15) —
 * and hyper never runs it (C-6).
 */

import {
	DOCKER_GROUP,
	GPASSWD,
	PRIVILEGED_GROUP,
	rootScriptGuards,
	SUDOERS_DIR,
} from "#services/machine/root-script";
import { shellQuote } from "#services/remote";
import { COLLAB_GROUP, managerCollabRestartLines, SHARED_ENTRIES } from "./agent-acl.js";
import {
	agentHomeOf,
	agentUserOf,
	assertAgentUserIsSafe,
	homeOf,
	primaryUserOf,
} from "./agent-context.js";
import { runScript, shellCommand } from "./shell.js";
import type { Task, TaskContext } from "./types.js";
// TaskError is a class, so it is imported as a value; the rest are types.
import { TaskError } from "./types.js";

/**
 * Read-only answers, one `key=value` line each.
 *
 * Labelled rather than positional: the group lists are variable-length, and a
 * positional reader that is one line out reads a wrong answer as a right one.
 *
 * This probe covers ONLY what this task owns. Whether the primary user can read
 * the agent's config dir is a consequence of the ACLs set here, but the two
 * facts that actually have to hold are that the dir exists and that it belongs
 * to the agent — the primary gets no write there at all.
 */
function probe(agentUser: string, primaryUser: string, agentHome: string): string {
	const q = shellQuote;
	return [
		`printf 'agent_uid=%s\\n' "$(id -u ${q(agentUser)} 2>/dev/null || true)"`,
		`printf 'collab_group=%s\\n' "$(getent group ${COLLAB_GROUP} >/dev/null 2>&1 && echo yes || echo no)"`,
		`printf 'agent_groups=%s\\n' "$(id -nG ${q(agentUser)} 2>/dev/null | tr ' ' ',' || true)"`,
		`printf 'primary_groups=%s\\n' "$(id -nG ${q(primaryUser)} 2>/dev/null | tr ' ' ',' || true)"`,
		`printf 'dropin_entry=%s\\n' "$(test -e ${SUDOERS_DIR}/${q(agentUser)} && echo yes || echo no)"`,
		`printf 'agent_config_dir=%s\\n' "$(test -d ${q(agentHome)}/.claude && echo yes || echo no)"`,
		`printf 'agent_config_owner=%s\\n' "$(stat -c %U ${q(agentHome)}/.claude 2>/dev/null || echo missing)"`,
		// Each shared entry, as the symlink it should be pointing where it should.
		...SHARED_ENTRIES.map(
			(name) =>
				`printf 'link_${name}=%s\\n' "$(readlink ${q(`${agentHome}/.claude/${name}`)} 2>/dev/null || echo missing)"`,
		),
		`printf 'agent_bashrc_umask=%s\\n' "$(grep -c '^umask 002$' ${q(agentHome)}/.bashrc 2>/dev/null || echo 0)"`,
		`printf 'agent_bashrc_physical=%s\\n' "$(grep -c '^set -o physical$' ${q(agentHome)}/.bashrc 2>/dev/null || echo 0)"`,
		// The packages the unprivileged tasks need: a machine missing them is
		// "not yet", not mysteriously failing.
		`printf 'acl_tool=%s\\n' "$(command -v setfacl >/dev/null 2>&1 && echo yes || echo no)"`,
		`printf 'inotify_tool=%s\\n' "$(command -v inotifywait >/dev/null 2>&1 && echo yes || echo no)"`,
		`printf 'linger=%s\\n' "$(loginctl show-user ${q(agentUser)} --property=Linger --value 2>/dev/null || true)"`,
		// The primary user's LOGIN group: with the shared umask, that group
		// receives everything the primary creates.
		`printf 'primary_login_group=%s\\n' "$(id -gn ${q(primaryUser)} 2>/dev/null || echo unknown)"`,
	].join("; ");
}

/** The parsed answers to {@link probe}. Anything missing or unparsable reads as absent. */
interface Probe {
	agentExists: boolean;
	collabGroup: boolean;
	agentGroups: string[];
	primaryGroups: string[];
	dropInEntry: boolean;
	agentConfigDir: boolean;
	agentConfigOwner: string;
	links: Map<string, string>;
	agentBashrcUmask: boolean;
	agentBashrcPhysical: boolean;
	hasSetfacl: boolean;
	hasInotify: boolean;
	linger: boolean;
	primaryLoginGroup: string;
}

function parseProbe(stdout: string): Probe {
	const answers = new Map<string, string>();
	for (const line of stdout.split("\n")) {
		// Values may contain `=` (a readlink target could), so the FIRST one
		// separates key from value.
		const at = line.indexOf("=");
		if (at > 0) answers.set(line.slice(0, at).trim(), line.slice(at + 1).trim());
	}
	const yes = (key: string): boolean => answers.get(key) === "yes";
	const count = (key: string): boolean => Number.parseInt(answers.get(key) ?? "0", 10) > 0;
	const groups = (key: string): string[] =>
		(answers.get(key) ?? "")
			.split(",")
			.map((group) => group.trim())
			.filter((group) => group !== "");
	const links = new Map<string, string>();
	for (const name of SHARED_ENTRIES) {
		links.set(name, answers.get(`link_${name}`) ?? "missing");
	}
	return {
		agentExists: /^\d+$/.test(answers.get("agent_uid") ?? ""),
		collabGroup: yes("collab_group"),
		agentGroups: groups("agent_groups"),
		primaryGroups: groups("primary_groups"),
		dropInEntry: yes("dropin_entry"),
		agentConfigDir: yes("agent_config_dir"),
		agentConfigOwner: answers.get("agent_config_owner") ?? "missing",
		links,
		agentBashrcUmask: count("agent_bashrc_umask"),
		agentBashrcPhysical: count("agent_bashrc_physical"),
		hasSetfacl: yes("acl_tool"),
		hasInotify: yes("inotify_tool"),
		linger: yes("linger"),
		primaryLoginGroup: answers.get("primary_login_group") ?? "unknown",
	};
}

/**
 * Refuse when the primary user's login group is the shared group.
 *
 * `umask 002` — which both users get — means every file the primary creates is
 * group-accessible by the primary's effective group. If that group is `collab`,
 * the agent gets read and write on everything the primary makes, including the
 * things the rest of this task exists to keep private. The fix is a login group
 * of the primary's own, not giving up the shared umask.
 */
export function refusesCollabLoginGroup(group: string): boolean {
	return group === COLLAB_GROUP;
}

export const agentUserCreate: Task = {
	id: "agent-user.create",
	feature: "agent-user",
	needsRoot: true,
	title: "the user agents run as, and the group it shares with you",

	async check(ctx: TaskContext): Promise<boolean> {
		const no = (why: string): false => {
			ctx.log(`agent-user.create: not settled — ${why}. Run the root script, then re-run setup.`);
			return false;
		};
		const agentUser = await agentUserOf(ctx);
		// Refuse before probing anything, so a hostile name is a message rather
		// than a probe full of interpolated values.
		await assertAgentUserIsSafe(ctx, agentUser);
		const primaryUser = await primaryUserOf(ctx);
		const agentHome = await agentHomeOf(ctx, agentUser);
		const result = await runScript(ctx, probe(agentUser, primaryUser, agentHome));
		if (result.code !== 0) return no(`the probe failed: ${result.stderr.trim() || result.code}`);
		const parsed = parseProbe(result.stdout);
		// The same resolution `agent-user.dirs` uses, so the two agree on what the
		// symlinks are supposed to point at.
		const primaryHome = await homeOf(ctx);

		// Refuse before any repairable missing fact can send the runner to apply.
		if (refusesCollabLoginGroup(parsed.primaryLoginGroup)) {
			throw new TaskError(
				"agent-user.create",
				`Your login group on ${ctx.machine?.name ?? "this machine"} is \`${COLLAB_GROUP}\`. With the shared umask (002) that would hand the agent user read and write on every file you create, including the ones this setup keeps private. Give yourself a login group of your own (\`usermod -g <you> <you>\`) and re-run — I've changed nothing.`,
			);
		}
		if (!parsed.hasSetfacl || !parsed.hasInotify) return no("acl or inotify-tools is missing");
		if (!parsed.agentExists || !parsed.collabGroup)
			return no("the agent user or collab group is missing");
		if (!parsed.agentGroups.includes(COLLAB_GROUP)) return no("the agent is not in collab");
		if (!parsed.primaryGroups.includes(COLLAB_GROUP))
			return no("the primary user is not in collab");
		if (parsed.dropInEntry) return no("the agent has a privilege drop-in");
		if (parsed.agentGroups.includes(PRIVILEGED_GROUP))
			return no("the agent is in the privileged group");
		if (parsed.agentGroups.includes(DOCKER_GROUP)) return no("the agent is in the docker group");
		if (!parsed.agentConfigDir || parsed.agentConfigOwner !== agentUser)
			return no("the agent config directory is missing or has the wrong owner");
		for (const [name, target] of parsed.links) {
			if (target !== `${primaryHome}/.claude/${name}`)
				return no(`the agent's ${name} link points at ${target}`);
		}
		if (!parsed.agentBashrcUmask || !parsed.agentBashrcPhysical)
			return no("the agent's .bashrc lacks umask or physical-cd settings");
		if (!parsed.linger) return no("linger is disabled for the agent");
		return true;
	},

	rootScript(ctx: TaskContext): string {
		const agentUser =
			ctx.machine?.agentUser ?? ctx.config.machines[ctx.config.self.name]?.agent_user ?? "agent";
		return `# The unattended agent user.
#
# Adds a second Linux user for agents to run as, in a group you both belong to.
# The agent shares your work dir and your Claude transcripts through that group,
# and holds none of your credentials: no privileged group, no docker group, no
# privilege drop-in.
#
# Everything INSIDE the agent's own home is done by the agent itself, through
# runuser: that account can plant symlinks there, and root following one is root
# writing wherever it points. All metadata and ACLs there are the agent's work.
#
# Every step is guarded, so running this twice changes nothing.

${rootScriptGuards(agentUser)}
# Refuse rather than proceed if your login group is the shared group: the shared
# umask would then hand the agent read and write on everything you create.
primary_login_group="$(id -gn "$primary_user" || echo unknown)"
if [ "$primary_login_group" = "${COLLAB_GROUP}" ]; then
  echo "hyper: your login group is ${COLLAB_GROUP}, and with umask 002 that would give" >&2
  echo "       the agent user read and write on every file you create. Give yourself" >&2
  echo "       a login group of your own (usermod -g <you> <you>) and re-run. Stopping." >&2
  exit 1
fi

# Packages the unprivileged tasks need: ACLs for the shared dirs, inotifywait
# for the watcher. Guarded, and here because this script is the user's to run —
# hyper itself never installs anything (C-6).
if ! command -v setfacl >/dev/null 2>&1; then
  apt-get install -y acl
fi
if ! command -v inotifywait >/dev/null 2>&1; then
  apt-get install -y inotify-tools
fi

# The shared group.
getent group ${COLLAB_GROUP} >/dev/null 2>&1 || groupadd ${COLLAB_GROUP}

# The agent user itself. -m gives it a home; bash because everything an agent
# runs is a shell pipeline.
id -u "$agent_user" >/dev/null 2>&1 || useradd -m -s /bin/bash -G ${COLLAB_GROUP} "$agent_user"

# You, in the same group, so the shared dirs are reachable from both sides.
usermod -aG ${COLLAB_GROUP} "$primary_user"

${managerCollabRestartLines()}

# The agent's group membership too — UNCONDITIONALLY. useradd below only runs
# for a user that does not exist yet, so on a machine that already had this
# account without the group, nothing would ever add it and the task could not
# settle.
usermod -aG ${COLLAB_GROUP} "$agent_user"

# The absences, in order of how much they matter. The -d form removes a
# supplementary membership and fails harmlessly when there is none, so each is
# guarded on the membership existing first.
id -nG "$agent_user" 2>/dev/null | tr ' ' '\\n' | grep -qx ${PRIVILEGED_GROUP} && \\
  ${GPASSWD} -d "$agent_user" ${PRIVILEGED_GROUP} || true
id -nG "$agent_user" 2>/dev/null | tr ' ' '\\n' | grep -qx ${DOCKER_GROUP} && \\
  ${GPASSWD} -d "$agent_user" ${DOCKER_GROUP} || true
rm -f ${SUDOERS_DIR}/"$agent_user"

agent_home="$(getent passwd "$agent_user" | cut -d: -f6)"
if [ -z "$agent_home" ]; then
  echo "hyper: I can't find the home directory of '$agent_user'." >&2
  exit 1
fi

# Everything inside the agent's home — the config dir, its mode, the shared
# symlinks, the .bashrc lines, and the ACLs that let you read the config dir for
# the checks — is done by the AGENT, in the runuser block below. There is
# deliberately NO root command here that names a path under that home: a not-a-symlink
# test is not a guard, because the agent's lingering processes can swap the
# directory between the test and the use, and a root chown/chmod/setfacl on a path
# the agent controls is root writing wherever the agent points it.

${agentOwnedBlock()}

# Two kernel settings, written only if they are not already in effect.
#
# protected_hardlinks: stops the agent hard-linking to a file the primary owns
# but cannot read (and the reverse), which is otherwise a way around a mode.
# legacy_tiocsti=0: stops TIOCSTI injection into the primary's terminal.
#
# A CONFINED sysctl, not a mount option: /proc is deliberately NOT remounted.
sysctl_file=/etc/sysctl.d/60-hyper-agent-user.conf
want_hardlinks=0
[ "$(cat /proc/sys/fs/protected_hardlinks 2>/dev/null || echo 0)" = "1" ] && want_hardlinks=1
want_tiocsti=0
[ "$(cat /proc/sys/dev/tty/legacy_tiocsti 2>/dev/null || echo 1)" = "0" ] && want_tiocsti=1
if [ "$want_hardlinks" != "1" ] || [ "$want_tiocsti" != "1" ]; then
  {
    echo "# Written by 'hyper machine setup --features agent-user'. Remove to undo."
    [ "$want_hardlinks" != "1" ] && echo "fs.protected_hardlinks = 1"
    [ "$want_tiocsti" != "1" ] && echo "dev.tty.legacy_tiocsti = 0"
  } > "$sysctl_file"
  sysctl --system >/dev/null 2>&1 || sysctl -q -p "$sysctl_file" || true
fi

# Linger, so the agent's own systemd --user units (the transcript watcher) keep
# running with no session of its own.
loginctl enable-linger "$agent_user"
`;
	},
};

/**
 * The part of the script the AGENT runs: the shared symlinks and the .bashrc
 * lines, both inside the agent's own home.
 *
 * One `runuser` with a single `sh -c`, because the point is that root is not the
 * one doing this. Every path here belongs to the agent, so a symlink there can
 * only ever be followed by the agent — which is exactly the privilege root must
 * not lend it. The names arrive as positional parameters so the block never
 * depends on root's variables being right.
 *
 * The symlinks are created even when their targets do not exist yet: a dangling
 * symlink is fine, and the primary side is set up by the unprivileged task in
 * the same run. `ln -sfn` is guarded on the existing entry being a symlink, so a
 * real directory the agent may have made is never replaced.
 */
function agentOwnedBlock(): string {
	const links = SHARED_ENTRIES.map(
		(name) =>
			`    link="$home/.claude/${name}"\n` +
			`    target="$primary_claude/${name}"\n` +
			`    if [ -L "$link" ]; then\n` +
			`      [ "$(readlink "$link")" = "$target" ] || ln -sfn "$target" "$link"\n` +
			`    elif [ ! -e "$link" ]; then\n` +
			`      ln -sfn "$target" "$link"\n` +
			`    fi`,
	).join("\n");
	const body = `set -eu
home="$(getent passwd "$1" | cut -d: -f6)"
primary_home="$(getent passwd "$2" | cut -d: -f6)"
primary_claude="$primary_home/.claude"
# Refuse every symlink we would create through or change, before any mutation.
# This refusal runs as the AGENT; root still touches no agent-controlled path.
for path in "$home" "$home/.claude" "$home/.bashrc"; do
  if [ -L "$path" ]; then
    echo "hyper: $path is a symlink; refusing agent home setup" >&2
    exit 1
  fi
done
mkdir -p "$home/.claude"
chmod 0750 "$home/.claude"

# The ACLs that let the PRIMARY user read this config dir for its checks, and
# nothing more. Set by the AGENT on its own files: root setting metadata inside
# this home is exactly what this design refuses to do.
# The names come in as POSITIONAL parameters ($1 agent, $2 primary) rather than
# as inherited shell variables: the parent never exports them, and the block runs
# under strict mode, which would abort on the first reference.
setfacl -m "u:$2:x" "$home"
setfacl -m "u:$2:r-x" "$home/.claude"

# The shared entries. A symlink is only a pointer, so this needs no access to
# the target at all — only to the directory being linked from.
${links}

# A collaborative umask and real-path cd in the agent shell, so what it writes
# is group-accessible from birth rather than by the watcher having to widen it.
touch "$home/.bashrc"
grep -q "umask 002" "$home/.bashrc" || printf "\\n# hyper: files here are shared with the primary user\\numask 002\\n" >> "$home/.bashrc"
grep -q "^set -o physical$" "$home/.bashrc" || printf "set -o physical\\n" >> "$home/.bashrc"
`;
	return `runuser -u "$agent_user" -- ${shellCommand(body)} "$agent_user" "$primary_user"`;
}
