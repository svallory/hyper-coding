/**
 * `docker-rootless.packages` — the root work rootless Docker needs.
 *
 * The unattended agent user runs Docker as ITSELF, with no privilege at all and
 * no membership of the `docker` group (that group is root on this host: the socket
 * it owns is root's). Rootless Docker replaces that seat with three things this
 * task installs as root, because none of them can be installed by a user:
 *
 * - **the packages**: `docker-ce` (the daemon itself AND the CLI — the
 *   `-rootless-extras` package alone ships neither, and a machine with only it
 *   has a setuptool and no daemon), `docker-ce-rootless-extras`, and the three
 *   unprivileged-namespace helpers `uidmap`, `dbus-user-session` and
 *   `slirp4netns`;
 * - **a subuid/subgid range** for the agent, which is what the user namespace
 *   maps the container's uids onto. Without a range the daemon starts and then
 *   refuses to run anything;
 * - **linger**, so the agent's `systemd --user` units keep running with no
 *   session of its own — which is what makes the daemon survive the setup run.
 *
 * Plus one thing that is not a package at all: the agent's `authorized_keys` has
 * to hold the PUBLIC key this setup connects with, because the next task opens
 * a session as the agent (`docker-rootless.install`). That key cannot be
 * discovered from the machine, so it is asked for — see `agent-key.ts` — and
 * only its public half is ever read.
 *
 * TWO RULES, both learned the hard way in `agent-user.create`:
 *
 * 1. **Nothing inside the agent's home is touched by root.** `.ssh` and
 *    `authorized_keys` are created and written by `runuser -u <agent>`, which
 *    refuses on a symlink — the agent owns that directory and can plant links
 *    that would otherwise make root write wherever they point.
 * 2. **Every step is guarded**, so running the script twice changes nothing
 *    (C-15), and hyper never runs it (C-6). apt inside this script is allowed
 *    precisely because it is the user's script to run: Docker's packages are not
 *    in Debian's archive.
 */

import { rootScriptGuards } from "#services/machine/root-script";
import { shellQuote } from "#services/remote";
import { agentHomeOf, agentUserOf, assertAgentUserIsSafe } from "./agent-context.js";
import { type ResolvedAgentKey, resolveAgentKey } from "./agent-key.js";
import { runScript, shellCommand } from "./shell.js";
import type { Task, TaskContext } from "./types.js";

/**
 * What the root script installs.
 *
 * `docker-ce` is here because of what the extras package does NOT contain: it
 * ships `dockerd-rootless.sh`, `dockerd-rootless-setuptool.sh`, `rootlesskit`
 * and the CLI context, but no `dockerd` and no `docker` binary. Proved in a
 * throwaway Debian 13 container: with only `docker-ce-rootless-extras` the
 * setuptool created the unit and `systemctl --user start docker` failed, and
 * `docker: command not found`.
 */
export const ROOTLESS_PACKAGES = [
	"uidmap",
	"dbus-user-session",
	"slirp4netns",
	"docker-ce",
	"docker-ce-rootless-extras",
] as const;

/** The subid range the root script adds when the agent has none. */
export const SUBID_RANGE = "100000-165535";

/** The Docker apt repository, exactly as docs.docker.com documents it for Debian. */
export const DOCKER_REPO_LIST = "/etc/apt/sources.list.d/docker.list";
export const DOCKER_KEYRING = "/etc/apt/keyrings/docker.asc";

function probe(agentUser: string, agentHome: string, key: string): string {
	const q = shellQuote;
	return [
		...ROOTLESS_PACKAGES.map(
			(name) =>
				`printf 'pkg_${name}=%s\\n' "$(dpkg-query -W -f='${"${Status}"}' ${q(name)} 2>/dev/null | grep -c 'ok installed' || true)"`,
		),
		`printf 'subuid=%s\\n' "$(grep -c '^${q(agentUser)}:' /etc/subuid 2>/dev/null || true)"`,
		`printf 'subgid=%s\\n' "$(grep -c '^${q(agentUser)}:' /etc/subgid 2>/dev/null || true)"`,
		`printf 'linger=%s\\n' "$(loginctl show-user ${q(agentUser)} --property=Linger --value 2>/dev/null || true)"`,
		`printf 'agent_key=%s\\n' "$(grep -cxF ${q(key)} ${q(`${agentHome}/.ssh/authorized_keys`)} 2>/dev/null || true)"`,
	].join("; ");
}

interface Probe {
	packages: Set<string>;
	subuid: boolean;
	subgid: boolean;
	linger: boolean;
	key: boolean;
}

function parseProbe(stdout: string): Probe {
	const answers = new Map<string, string>();
	for (const line of stdout.split("\n")) {
		const at = line.indexOf("=");
		if (at > 0) answers.set(line.slice(0, at).trim(), line.slice(at + 1).trim());
	}
	const count = (key: string): boolean => Number.parseInt(answers.get(key) ?? "0", 10) > 0;
	return {
		packages: new Set(ROOTLESS_PACKAGES.filter((name) => count(`pkg_${name}`))),
		subuid: count("subuid"),
		subgid: count("subgid"),
		linger: answers.get("linger") === "yes",
		key: count("agent_key"),
	};
}

/** The key plus where it came from, for the header of the generated script. */
function keyFor(ctx: TaskContext): ResolvedAgentKey {
	const resolved = resolveAgentKey(ctx);
	ctx.log(`docker-rootless.packages: giving ${resolved.source} to the agent user.`);
	return resolved;
}

export const dockerRootlessPackages: Task = {
	id: "docker-rootless.packages",
	feature: "docker-rootless",
	needsRoot: true,
	title: "rootless Docker for the agent user: packages, subid range, linger, and its ssh key",

	async check(ctx: TaskContext): Promise<boolean> {
		const no = (why: string): false => {
			ctx.log(
				`docker-rootless.packages: not settled — ${why}. Run the root script, then re-run setup.`,
			);
			return false;
		};
		const agentUser = await agentUserOf(ctx);
		await assertAgentUserIsSafe(ctx, agentUser);
		const { key } = keyFor(ctx);
		const agentHome = await agentHomeOf(ctx, agentUser);
		const result = await runScript(ctx, probe(agentUser, agentHome, key));
		if (result.code !== 0) return no(`the probe failed: ${result.stderr.trim() || result.code}`);
		const parsed = parseProbe(result.stdout);
		const missing = ROOTLESS_PACKAGES.filter((name) => !parsed.packages.has(name));
		if (missing.length > 0) return no(`missing ${missing.join(", ")}`);
		if (!parsed.subuid || !parsed.subgid)
			return no("the agent user is missing a subuid or subgid range");
		if (!parsed.linger) return no("linger is disabled for the agent");
		if (!parsed.key)
			return no(
				"the agent's authorized_keys does not hold the public key this setup connects with",
			);
		return true;
	},

	rootScript(ctx: TaskContext): string {
		const agentUser =
			ctx.machine?.agentUser ?? ctx.config.machines[ctx.config.self.name]?.agent_user ?? "agent";
		const { key, source } = keyFor(ctx);
		return `# Rootless Docker for the unattended agent user.
#
# The agent user runs Docker as itself: no privilege, no membership of the docker
# group. What makes that possible is installed here — the packages, a subuid and
# subgid range for its user namespace, and linger so its systemd --user units
# survive this run — plus ONE key: the ssh public key from
#
#     ${source}
#
# copied into the agent's own authorized_keys, so the next step can open a
# session as the agent and run dockerd-rootless-setuptool.sh install. Only the
# public half was read; hyper never reads or copies a private key.
#
# apt IS allowed in here: Docker's own packages are not in Debian's archive, and
# this script is yours to run after reading it — hyper never runs anything as root
# (C-6). The repository is added exactly as docs.docker.com documents it for
# Debian: the signing key fetched over https into /etc/apt/keyrings, and a
# sources.list.d entry that names it through signed-by.
#
# Everything INSIDE the agent's home is done by the agent, through runuser: the
# agent owns that directory and can plant symlinks in it, and root following one
# is root writing wherever it points. Every step is guarded, so running this
# twice changes nothing.

${rootScriptGuards(agentUser)}
have_package() {
  dpkg-query -W -f='\${Status}' "$1" 2>/dev/null | grep -q 'ok installed'
}

# Docker's apt repository, added only when one of its packages is missing and
# the repository is not configured yet. Debian 12+ ships /etc/apt/keyrings.
if ! have_package docker-ce-rootless-extras; then
  if [ ! -f ${DOCKER_REPO_LIST} ]; then
    # The documented prerequisites for fetching the key: a minimal Debian has
    # neither.
    if ! command -v curl >/dev/null 2>&1 || ! have_package ca-certificates; then
      apt-get update -qq
      DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl
    fi
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/debian/gpg -o ${DOCKER_KEYRING}
    chmod a+r ${DOCKER_KEYRING}
    deb_arch="$(dpkg --print-architecture)"
    deb_codename="$(. /etc/os-release && echo "$VERSION_CODENAME")"
    printf 'deb [arch=%s signed-by=${DOCKER_KEYRING}] https://download.docker.com/linux/debian %s stable\\n' \\
      "$deb_arch" "$deb_codename" > ${DOCKER_REPO_LIST}
    apt-get update -qq
  fi
fi

# The packages. docker-ce brings the daemon AND the CLI; the -rootless-extras
# package brings the setuptool, rootlesskit and the CLI context, and nothing
# that runs a daemon. uidmap gives newuidmap/newgidmap, dbus-user-session the
# user bus, slirp4netns the network namespace.
export DEBIAN_FRONTEND=noninteractive
had_docker_ce=0
have_package docker-ce && had_docker_ce=1
missing_packages=""
for package in ${ROOTLESS_PACKAGES.join(" ")}; do
  have_package "$package" || missing_packages="$missing_packages $package"
done
[ -z "$missing_packages" ] || apt-get install -y $missing_packages

# docker-ce is here for its binaries, not for the system-wide daemon its
# package enables and starts. When THIS script brought docker-ce in, that root
# daemon is stopped and disabled again, as docs.docker.com's rootless page
# recommends — this machine did not have one before. A docker-ce that was
# already installed is someone's own rootful Docker and is left alone.
if [ "$had_docker_ce" = 0 ] && have_package docker-ce; then
  systemctl disable --now docker.service docker.socket >/dev/null 2>&1 || true
  echo "hyper: stopped and disabled the system-wide Docker daemon docker-ce installs; the agent runs its own."
fi

# A subuid/subgid range for the agent: the user namespace maps the container's
# uids onto a range of host uids, and without one the daemon starts and then
# refuses to run anything. Guarded on the entry existing, so a range that is
# already there is left exactly as it is.
# Each file on its own: a user with a subuid range and no subgid range gets only
# the missing one, never a second copy of the one it has.
if ! grep -q "^$agent_user:" /etc/subuid 2>/dev/null; then
  usermod --add-subuids ${SUBID_RANGE} "$agent_user"
fi
if ! grep -q "^$agent_user:" /etc/subgid 2>/dev/null; then
  usermod --add-subgids ${SUBID_RANGE} "$agent_user"
fi

# Linger, so the agent's systemd --user units — including the rootless Docker
# daemon — keep running with no session of its own. Idempotent.
loginctl enable-linger "$agent_user"

# The ssh key, written by the AGENT inside its own home. This is the only way
# the next step can open a session as the agent, and it is why the key had to be
# asked for: the setup connection's key is not knowable from the machine.
${agentKeyBlock(key)}
`;
	},
};

/**
 * The `runuser` block that installs the key inside the agent's own home.
 *
 * As in `agent-user.create`: root names no path under that home. The agent
 * resolves its own home from the password database, refuses every symlink it
 * would write through or change, and appends the key only if it is not already
 * there — so a second run is a no-op rather than a duplicate key.
 */
function agentKeyBlock(key: string): string {
	const body = `set -eu
home="$(getent passwd "$1" | cut -d: -f6)"
key="$2"
for path in "$home" "$home/.ssh" "$home/.ssh/authorized_keys"; do
  if [ -L "$path" ]; then
    echo "hyper: $path is a symlink; refusing agent ssh key setup" >&2
    exit 1
  fi
done
mkdir -p "$home/.ssh"
chmod 0700 "$home/.ssh"
touch "$home/.ssh/authorized_keys"
chmod 0600 "$home/.ssh/authorized_keys"
grep -qxF "$key" "$home/.ssh/authorized_keys" || printf '%s\\n' "$key" >> "$home/.ssh/authorized_keys"`;
	return `runuser -u "$agent_user" -- ${shellCommand(body)} "$agent_user" ${shellQuote(key)}`;
}
