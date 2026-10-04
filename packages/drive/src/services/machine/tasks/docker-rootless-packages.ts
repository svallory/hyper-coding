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

import { agentRunnerFor } from "#services/machine";
import { rootScriptGuards } from "#services/machine/root-script";
import { shellQuote } from "#services/remote";
import { agentUserOf, assertAgentUserIsSafe } from "./agent-context.js";
import { type ResolvedAgentKey, resolveAgentKey } from "./agent-key.js";
import { runScript, shellCommand } from "./shell.js";
import { SUBID_COUNT, SUBID_FUNCTIONS } from "./subid.js";
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

/** Engines docker-ce conflicts with, or that already provide a `docker` of their own. */
export const FOREIGN_ENGINE_PACKAGES = ["docker.io", "moby-engine", "podman-docker"] as const;

/** The Docker apt repository, exactly as docs.docker.com documents it for Debian. */
export const DOCKER_REPO_LIST = "/etc/apt/sources.list.d/docker.list";
export const DOCKER_KEYRING = "/etc/apt/keyrings/docker.asc";

/**
 * Docker engines that are not docker-ce, found BEFORE apt is touched (security
 * review, finding 3).
 *
 * docker-ce `Conflicts: docker.io`, so `apt-get install docker-ce` on a machine
 * running Debian's own Docker REMOVES it, daemon and containers with it. Any
 * other engine is therefore a refusal that changes nothing; only the operator
 * can choose between the two. Shared by the root script and the read-only
 * check. With docker-ce itself installed, its dockerd and docker.service are
 * the ones it ships, and only the conflicting packages are looked for.
 *
 * `docker_foreign_engines` prints one line per finding, nothing when clean.
 */
export const DOCKER_ENGINE_FUNCTIONS = `have_package() {
  dpkg-query -W -f='${"${Status}"}' "$1" 2>/dev/null | grep -q 'ok installed'
}
docker_foreign_engines() {
  for engine_package in ${FOREIGN_ENGINE_PACKAGES.join(" ")}; do
    if have_package "$engine_package"; then echo "the $engine_package package"; fi
  done
  # A snap-installed Docker: the root script's PATH may have no /snap/bin and
  # its unit is not docker.service, so the checks below miss it — but it is an
  # engine all the same, and docker-ce's daemon would fight it for the socket.
  # Foreign whether or not docker-ce is installed, like the packages above.
  if [ -x /snap/bin/docker ] || [ -x /snap/bin/dockerd ]; then
    echo "a snap-installed Docker"
  fi
  if command -v snap >/dev/null 2>&1 && snap list docker >/dev/null 2>&1; then
    echo "the docker snap package"
  fi
  if [ "$(systemctl show -p LoadState --value snap.docker.dockerd.service 2>/dev/null || true)" = loaded ]; then
    echo "a snap.docker.dockerd.service unit"
  fi
  if ! have_package docker-ce; then
    engine_dockerd="$(command -v dockerd 2>/dev/null || true)"
    if [ -n "$engine_dockerd" ]; then echo "$engine_dockerd (a dockerd that does not come from docker-ce)"; fi
    if [ "$(systemctl show -p LoadState --value docker.service 2>/dev/null || true)" = loaded ]; then
      echo "a docker.service unit that does not come from docker-ce"
    fi
  fi
  return 0
}`;

function probe(agentUser: string): string {
	const q = shellQuote;
	return [
		...ROOTLESS_PACKAGES.map(
			(name) =>
				`printf 'pkg_${name}=%s\\n' "$(dpkg-query -W -f='${"${Status}"}' ${q(name)} 2>/dev/null | grep -c 'ok installed' || true)"`,
		),
		DOCKER_ENGINE_FUNCTIONS,
		`docker_foreign_engines | sed 's/^/foreign_engine=/'`,
		SUBID_FUNCTIONS,
		`agent_uid="$(id -u ${q(agentUser)} 2>/dev/null || echo none)"`,
		`printf 'subuid=%s\\n' "$(subid_has /etc/subuid ${q(agentUser)} "$agent_uid" && echo 1 || echo 0)"`,
		`printf 'subgid=%s\\n' "$(subid_has /etc/subgid ${q(agentUser)} "$agent_uid" && echo 1 || echo 0)"`,
		`printf 'subuid_conflict=%s\\n' "$(subid_conflict /etc/subuid ${q(agentUser)} "$agent_uid")"`,
		`printf 'subgid_conflict=%s\\n' "$(subid_conflict /etc/subgid ${q(agentUser)} "$agent_uid")"`,
		`printf 'linger=%s\\n' "$(loginctl show-user ${q(agentUser)} --property=Linger --value 2>/dev/null || true)"`,
	].join("\n");
}

interface Probe {
	packages: Set<string>;
	subuid: boolean;
	subgid: boolean;
	/** Docker engines that are not docker-ce: a refusal, never "needs root". */
	foreignEngines: string[];
	/** "<agent line> overlaps <other line>", per file, or "". */
	subidConflict: string;
	linger: boolean;
}

function parseProbe(stdout: string): Probe {
	const answers = new Map<string, string>();
	for (const line of stdout.split("\n")) {
		const at = line.indexOf("=");
		if (at > 0) answers.set(line.slice(0, at).trim(), line.slice(at + 1).trim());
	}
	const foreignEngines = stdout
		.split("\n")
		.filter((line) => line.startsWith("foreign_engine="))
		.map((line) => line.slice("foreign_engine=".length).trim());
	const count = (key: string): boolean => Number.parseInt(answers.get(key) ?? "0", 10) > 0;
	return {
		packages: new Set(ROOTLESS_PACKAGES.filter((name) => count(`pkg_${name}`))),
		subuid: count("subuid"),
		subgid: count("subgid"),
		foreignEngines,
		subidConflict: [answers.get("subuid_conflict"), answers.get("subgid_conflict")]
			.filter((line): line is string => line !== undefined && line !== "")
			.join("; "),
		linger: answers.get("linger") === "yes",
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
		const result = await runScript(ctx, probe(agentUser));
		if (result.code !== 0) return no(`the probe failed: ${result.stderr.trim() || result.code}`);
		const parsed = parseProbe(result.stdout);
		if (parsed.foreignEngines.length > 0)
			throw new Error(
				`${ctx.machine?.name ?? "this machine"} already has a Docker engine that is not docker-ce: ${parsed.foreignEngines.join("; ")}. Rootless Docker for the agent needs docker-ce, which conflicts with it — installing it would make apt REMOVE that engine, with its daemon and its containers. That is your choice to make: remove the existing engine yourself and re-run, or drop docker-rootless from this machine's features. Nothing has been changed.`,
			);
		const missing = ROOTLESS_PACKAGES.filter((name) => !parsed.packages.has(name));
		if (missing.length > 0) return no(`missing ${missing.join(", ")}`);
		// An overlapping range is not "needs root": the root script would refuse
		// it too, and only the operator can decide whose range moves.
		if (parsed.subidConflict !== "")
			throw new Error(
				`the agent user's subordinate id range overlaps another user's (${parsed.subidConflict}). Two users sharing host ids can signal each other's container processes and own each other's files. Give one of them a different range in /etc/subuid and /etc/subgid yourself, then re-run setup. Nothing has been changed.`,
			);
		if (!parsed.subuid || !parsed.subgid)
			return no("the agent user is missing a subuid or subgid range");
		if (!parsed.linger) return no("linger is disabled for the agent");
		// The key is asked of the AGENT, over its own ssh session: the agent's
		// ~/.ssh is 0700 and the primary user cannot read it (the container e2e
		// showed this probe, run as the primary, failing forever). Opening the
		// session at all is half the proof; the exact line is the other half.
		const agent = agentRunnerFor(ctx.machine, agentUser, ctx.spawner);
		const held = await agent.ssh([
			"sh",
			"-c",
			`grep -cxF ${shellQuote(key)} "$HOME/.ssh/authorized_keys" 2>/dev/null || true`,
		]);
		if (held.code !== 0 || Number.parseInt(held.stdout.trim() || "0", 10) === 0)
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
${DOCKER_ENGINE_FUNCTIONS}
${SUBID_FUNCTIONS}

# Before anything changes: another Docker engine. docker-ce conflicts with
# Debian's docker.io (and the others below), so installing it would make apt
# REMOVE that engine with its daemon and containers. Refused, with nothing
# changed: no apt repository, no key, no packages. A docker-ce that is already
# here is reused as it is, its system daemon included.
docker_foreign="$(docker_foreign_engines)"
if [ -n "$docker_foreign" ]; then
  echo "hyper: this machine already has a Docker engine that is not docker-ce:" >&2
  printf '%s\n' "$docker_foreign" | sed 's/^/hyper:   - /' >&2
  echo "hyper: rootless Docker for the agent needs docker-ce, which conflicts with it:" >&2
  echo "hyper: installing it would make apt REMOVE that engine, with its daemon and containers." >&2
  echo "hyper: that is your choice to make: remove it yourself and re-run, or drop" >&2
  echo "hyper: docker-rootless from this machine's features." >&2
  echo "hyper: nothing has been changed (no apt repository, no key, no packages)." >&2
  exit 1
fi

# Before anything changes: an agent subid range that overlaps another user's is
# refused, naming both lines. Two users sharing host ids can signal each other's
# container processes and own each other's files; only you can decide whose
# range moves.
agent_uid="$(id -u "$agent_user" 2>/dev/null || echo none)"
for subid_file in /etc/subuid /etc/subgid; do
  subid_overlap="$(subid_conflict "$subid_file" "$agent_user" "$agent_uid")"
  if [ -n "$subid_overlap" ]; then
    echo "hyper: in $subid_file, the agent's range $subid_overlap." >&2
    echo "hyper: give one of them a different range yourself, then re-run." >&2
    echo "hyper: nothing has been changed." >&2
    exit 1
  fi
done

# Before ANY package or repository change, verify that a missing subordinate
# range can fit in the 32-bit id space. Otherwise a late refusal would falsely
# claim "nothing has been changed" after apt may already have run. If only the
# gid range is missing, the uid start can be reused when it is free in subgid,
# even if there is no room for another range above the highest one.
if ! subid_has /etc/subuid "$agent_user" "$agent_uid"; then
  if ! subid_next_free >/dev/null; then
    echo "hyper: there is no room for a new ${SUBID_COUNT}-id subordinate uid range:" >&2
    echo "hyper: the ranges in /etc/subuid and /etc/subgid reach the end of the 32-bit" >&2
    echo "hyper: id space. Give the agent a range yourself, then re-run." >&2
    echo "hyper: nothing has been changed." >&2
    exit 1
  fi
elif ! subid_has /etc/subgid "$agent_user" "$agent_uid"; then
  existing_start="$(subid_start_of /etc/subuid "$agent_user" "$agent_uid")"
  if [ -z "$existing_start" ] || ! subid_free_at /etc/subgid "$existing_start" ${SUBID_COUNT}; then
    if ! subid_next_free >/dev/null; then
      echo "hyper: there is no room for a new ${SUBID_COUNT}-id subordinate gid range:" >&2
      echo "hyper: the ranges in /etc/subuid and /etc/subgid reach the end of the 32-bit" >&2
      echo "hyper: id space. Give the agent a range yourself, then re-run." >&2
      echo "hyper: nothing has been changed." >&2
      exit 1
    fi
  fi
fi

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
# refuses to run anything. A range the agent already has (checked above for
# overlap) is left exactly as it is. A missing one is ${SUBID_COUNT} ids starting at
# the highest start+count in either file, so it never overlaps anyone's — and
# the same start in both files when both are missing.
subid_start=""
if ! subid_has /etc/subuid "$agent_user" "$agent_uid"; then
  if ! subid_start="$(subid_next_free)"; then
    echo "hyper: there is no room for a new ${SUBID_COUNT}-id subordinate uid range:" >&2
    echo "hyper: the ranges in /etc/subuid and /etc/subgid reach the end of the 32-bit" >&2
    echo "hyper: id space. Give the agent a range yourself, then re-run." >&2
    echo "hyper: no uid range was added; package work above may already have run." >&2
    exit 1
  fi
  usermod --add-subuids "$subid_start-$((subid_start + ${SUBID_COUNT} - 1))" "$agent_user"
fi
if ! subid_has /etc/subgid "$agent_user" "$agent_uid"; then
  if [ -z "$subid_start" ]; then
    # Only the gid range is missing: reuse the uid range's start if it is free.
    subid_start="$(subid_start_of /etc/subuid "$agent_user" "$agent_uid")"
    if [ -z "$subid_start" ] || ! subid_free_at /etc/subgid "$subid_start" ${SUBID_COUNT}; then
      if ! subid_start="$(subid_next_free)"; then
        echo "hyper: there is no room for a new ${SUBID_COUNT}-id subordinate gid range:" >&2
        echo "hyper: the ranges in /etc/subuid and /etc/subgid reach the end of the 32-bit" >&2
        echo "hyper: id space. Give the agent a range yourself, then re-run." >&2
        echo "hyper: no gid range was added; package work above may already have run." >&2
        exit 1
      fi
    fi
  fi
  usermod --add-subgids "$subid_start-$((subid_start + ${SUBID_COUNT} - 1))" "$agent_user"
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
