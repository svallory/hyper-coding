/**
 * Facts the agent-user tasks need about the machine, resolved once.
 *
 * Three of them have no single source, and getting them wrong is the kind of
 * thing that silently writes ACLs onto the wrong directory:
 *
 * - the agent user name comes from `drive.toml`'s `agent_user`, defaulting to
 *   `agent` (a machine set up for a differently-named unattended user must not
 *   get an `agent` account created alongside it);
 * - the primary user is whoever is running the setup — the ssh login, not the
 *   machine's name, and never hardcoded;
 * - the paths below are derived from the primary user's home, because a
 *   `/Users/<name>` home (the `home-path` feature) is still that user's home.
 *
 * Every one of them falls back to ASKING the machine, over the same runner the
 * task uses, so a task never assumes it is looking at a machine whose config
 * says what the machine says.
 */

import { shellQuote } from "#services/remote";
import { runScript } from "./shell.js";
import type { TaskContext } from "./types.js";

/**
 * The lines a generated root script uses to work out the primary user.
 *
 * Shared by `agent-user.create` and the watcher's root fallback so the two
 * cannot drift — and they did drift once, which is how this was found: the
 * create script resolved `$SUDO_USER` and the fallback baked in the ssh target,
 * so on a machine reached through an ssh alias the fallback said
 * `enable-linger t16box` and `set -e` aborted the whole assembled script after
 * its good steps had already run.
 *
 * `$SUDO_USER` is whoever typed the password, which is the primary user in both
 * the local and the remote case. The baked value is a fallback for a
 * passwordless run with no environment, and it is deliberately EMPTY when the
 * ssh target names no user (an alias or a bare hostname), so the failure mode of
 * guessing wrong is a clear "no such user" rather than quietly changing the wrong
 * user's ACLs.
 */
export function primaryUserLines(ctx: TaskContext): string {
	const host = ctx.machine?.host ?? "";
	const at = host.indexOf("@");
	const named = at > 0 ? host.slice(0, at).trim() : "";
	return [
		`primary_user="\${SUDO_USER:-}"`,
		`if [ -z "$primary_user" ] || ! id -u "$primary_user" >/dev/null 2>&1; then`,
		`  primary_user=${named === "" ? "" : shellQuote(named)}`,
		`fi`,
	].join("\n");
}

/** The user agents run as on this machine. */
export async function agentUserOf(ctx: TaskContext): Promise<string> {
	if (ctx.machine !== null && ctx.machine.agentUser !== "") return ctx.machine.agentUser;
	const entry = ctx.config.machines[ctx.machine?.name ?? ctx.config.self.name];
	return entry?.agent_user !== undefined && entry.agent_user !== "" ? entry.agent_user : "agent";
}

/**
 * The primary user's login name on the target.
 *
 * `machine.host` is an ssh target, so `user@host` names the login — but a host
 * with no user part (`netcup`) or a Herdr-only machine has none, and `id -un` on
 * the target is the one thing that can't be wrong. The ssh target is only a
 * fallback for a runner that can't answer a probe.
 */
export async function primaryUserOf(ctx: TaskContext): Promise<string> {
	const probed = await runScript(ctx, "id -un");
	const name = probed.stdout.trim();
	if (probed.code === 0 && /^[a-z_][a-z0-9_-]*$/i.test(name)) return name;
	const fromHost = ctx.machine?.host?.split("@")[0]?.trim() ?? "";
	return fromHost !== "" ? fromHost : ctx.config.self.name;
}

/**
 * The primary user's home on the target.
 *
 * `drive.toml`'s `home` wins when it is absolute, so a machine whose home is
 * `/Users/svallory` is set up at that path rather than at whatever `getent`
 * says. The probe is the fallback: a Herdr-only machine has no config entry.
 */
export async function homeOf(ctx: TaskContext): Promise<string> {
	if (ctx.machine?.home?.startsWith("/")) return ctx.machine.home.replace(/\/+$/, "");
	if (ctx.config.self.home.startsWith("/")) return ctx.config.self.home.replace(/\/+$/, "");
	const probed = await runScript(ctx, "echo $HOME");
	const home = probed.stdout.trim();
	if (probed.code === 0 && home.startsWith("/")) return home.replace(/\/+$/, "");
	throw new Error(
		"I couldn't work out the primary user's home directory on this machine (I asked, and got nothing usable). Set `home` for this machine in your hyperdrive config.",
	);
}

/** The agent user's home, from the password database — not assumed to be /home/<name>. */
export async function agentHomeOf(ctx: TaskContext, agentUser: string): Promise<string> {
	const probed = await runScript(ctx, `getent passwd ${agentUser} | cut -d: -f6`);
	const home = probed.stdout.trim();
	if (probed.code === 0 && home.startsWith("/")) return home.replace(/\/+$/, "");
	return `/home/${agentUser}`;
}

/** The paths the three agent-user tasks work on, all derived from one home. */
export interface AgentPaths {
	/** The primary user's home. */
	home: string;
	/** The shared work dir. */
	work: string;
	/** The primary user's Claude config dir. */
	claude: string;
	/** The shared transcripts dir (group-writable, setgid). */
	projects: string;
	/** The agent user's own Claude config dir. */
	agentClaude: string;
	/** The primary user's private bin dir. */
	bin: string;
}

export function agentPaths(home: string, agentHome: string): AgentPaths {
	const base = home.replace(/\/+$/, "");
	return {
		home: base,
		work: `${base}/work`,
		claude: `${base}/.claude`,
		projects: `${base}/.claude/projects`,
		agentClaude: `${agentHome}/.claude`,
		bin: `${base}/.local/bin`,
	};
}
