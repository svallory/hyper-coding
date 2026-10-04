/**
 * `docker-rootless.install` — the agent user's own Docker daemon.
 *
 * Every command here runs **as the agent, over ssh**, inside a real login
 * session of that user. Not as root: rootless Docker is defined by running the
 * daemon as the unprivileged user it belongs to, and the setuptool refuses to
 * install a rootful daemon. Not as the primary user: the daemon, its socket and
 * its data all belong to the agent, which is what makes the layout safe — the
 * agent is not in the `docker` group and cannot reach `/var/run/docker.sock`, so
 * nothing it does can reach a root-owned daemon on this host.
 *
 * A real login session is the part that is easy to get wrong. ssh with a command
 * still opens a session (pam_systemd sets `XDG_RUNTIME_DIR`, logind creates the
 * user manager), which is what `systemctl --user` needs; running `su` or
 * `dockerd-rootless.sh` directly does not give the same thing. So this task
 * opens one session as the agent and does all four steps inside it.
 *
 * Four steps, in this order, and each is guarded so a second run is free (C-15):
 *
 * 1. `dockerd-rootless-setuptool.sh install` — only when the unit is missing.
 *    It writes `~/.config/systemd/user/docker.service`, adds the `docker` CLI
 *    context, and enables AND starts the unit.
 * 2. `systemctl --user disable docker` — the daemon must not come up with every
 *    session: it is started on demand, and a rootless daemon that auto-starts
 *    holds a user namespace and a network namespace open for nothing.
 * 3. One `DOCKER_HOST` line in the agent's `.bashrc`, above any non-interactive
 *    guard (the same placement rule as the PATH line in `tools-path`), so a
 *    plain `docker` in the agent's shell talks to its own daemon.
 * 4. Verify by actually running a container: start the unit, `docker run --rm
 *    hello-world`, stop it again. A daemon that starts and cannot run anything
 *    is not a working Docker, and this is the only step here that proves it.
 */

import { agentRunnerFor } from "#services/machine";
import { InstallError } from "#services/machine/tools";
import { agentUserOf } from "./agent-context.js";
import type { Task, TaskContext } from "./types.js";

/** Where the setuptool puts the unit. */
export const DOCKER_UNIT_PATH = ".config/systemd/user/docker.service";

/**
 * The line that points the agent's shell at its own daemon.
 *
 * The uid is IN the line, not a `$UID` expansion: `~/.bashrc` is read by login
 * and interactive shells, both of which have `UID` set, but the check has to
 * be able to grep for the exact text the machine was given, and a literal is the
 * only thing that can be.
 */
export function dockerHostLine(uid: string): string {
	return `export DOCKER_HOST="unix:///run/user/${uid}/docker.sock"`;
}

/** Read-only answers about the agent's rootless install. */
function probe(uid: string): string {
	return [
		`printf 'unit=%s\\n' "$(test -f "$HOME/${DOCKER_UNIT_PATH}" && echo yes || echo no)"`,
		`printf 'enabled=%s\\n' "$(systemctl --user is-enabled docker 2>/dev/null || true)"`,
		`printf 'active=%s\\n' "$(systemctl --user is-active docker 2>/dev/null || true)"`,
		`printf 'bashrc=%s\\n' "$(grep -cxF ${JSON.stringify(dockerHostLine(uid))} "$HOME/.bashrc" 2>/dev/null || true)"`,
	].join("; ");
}

/** The whole apply, as one program for one login session of the agent. */
function applyScript(uid: string): string {
	return `set -eu
unit="$HOME/${DOCKER_UNIT_PATH}"
if [ ! -f "$unit" ]; then
  echo "hyper: installing the rootless Docker daemon"
  dockerd-rootless-setuptool.sh install
fi
# Never with every session: it is started on demand.
systemctl --user disable docker
# The DOCKER_HOST line, ONCE, at the very top of .bashrc — above any
# non-interactive guard, which is the same rule the PATH line follows.
line=${JSON.stringify(dockerHostLine(uid))}
if ! grep -qxF "$line" "$HOME/.bashrc" 2>/dev/null; then
  tmp="$(mktemp "$HOME/.bashrc.hyper.XXXXXX")"
  printf '%s\\n' "$line" > "$tmp"
  [ -f "$HOME/.bashrc" ] && cat "$HOME/.bashrc" >> "$tmp"
  mv -f "$tmp" "$HOME/.bashrc"
fi
# Verify by running a container: a daemon that starts and cannot run anything is
# not a working Docker.
systemctl --user start docker
trap 'systemctl --user stop docker >/dev/null 2>&1 || true' EXIT
for _ in $(seq 1 30); do
  docker version >/dev/null 2>&1 && break
  sleep 1
done
docker run --rm hello-world`;
}

export const dockerRootlessInstall: Task = {
	id: "docker-rootless.install",
	feature: "docker-rootless",
	needsRoot: false,
	title: "the agent user's own Docker daemon, installed as the agent",
	unmetReason:
		"the rootless daemon did not come up for the agent user; check `journalctl --user -u docker` on the machine",

	async check(ctx: TaskContext): Promise<boolean> {
		const no = (why: string): false => {
			ctx.log(`docker-rootless.install: not settled — ${why}`);
			return false;
		};
		const agentUser = await agentUserOf(ctx);
		// Reaching the agent is what the previous task's ssh key was for; a
		// refusal here is that key's absence, not a Docker problem.
		const agent = agentRunnerFor(ctx.machine, agentUser, ctx.spawner);
		const whoami = await agent.ssh(["id", "-u"]);
		const uid = whoami.stdout.trim();
		if (whoami.code !== 0 || !/^\d+$/.test(uid)) {
			return no(
				`I couldn't open a session as ${agentUser} (${whoami.stderr.trim() || "no uid"}). Run the docker-rootless root script first — it copies your public key into the agent's authorized_keys — then re-run setup.`,
			);
		}
		const result = await agent.ssh(["sh", "-c", probe(uid)], { timeoutMs: 20_000 });
		if (result.code !== 0) return no(`the probe failed: ${result.stderr.trim() || result.code}`);
		const answers = new Map<string, string>();
		for (const line of result.stdout.split("\n")) {
			const at = line.indexOf("=");
			if (at > 0) answers.set(line.slice(0, at).trim(), line.slice(at + 1).trim());
		}
		if (answers.get("unit") !== "yes") return no(`~${agentUser}/${DOCKER_UNIT_PATH} is missing`);
		// A daemon that is already running is the finished state, whatever the
		// enablement says: it was started on demand, and the next run only has to
		// leave it alone.
		if (answers.get("active") === "active") return true;
		if (answers.get("enabled") !== "disabled") return no("the unit is not disabled");
		if (Number.parseInt(answers.get("bashrc") ?? "0", 10) === 0)
			return no(`the agent's .bashrc has no ${dockerHostLine(uid)} line`);
		return true;
	},

	async apply(ctx: TaskContext): Promise<void> {
		const agentUser = await agentUserOf(ctx);
		const agent = agentRunnerFor(ctx.machine, agentUser, ctx.spawner);
		const whoami = await agent.ssh(["id", "-u"]);
		const uid = whoami.stdout.trim();
		if (whoami.code !== 0 || !/^\d+$/.test(uid)) {
			throw new InstallError(
				`I couldn't open a session as ${agentUser}, so I can't install its Docker. Run the docker-rootless root script first (it copies your public key into the agent's authorized_keys), then re-run setup.`,
			);
		}
		ctx.log(`docker-rootless.install: doing it now, as ${agentUser}, over ssh.`);
		// Bounded: pulling an image and starting a namespace are not instant, and a
		// hung daemon must not hang setup forever.
		const result = await agent.ssh(["bash", "-c", applyScript(uid)], { timeoutMs: 300_000 });
		if (result.code !== 0) {
			throw new InstallError(
				`the rootless install failed as ${agentUser}: ${result.stderr.trim() || `exit ${result.code}`}. The daemon's own log is \`journalctl --user -u docker\` on that machine.`,
			);
		}
	},
};
