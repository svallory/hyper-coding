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

import { AGENT_USER_PATTERN, agentUserProblem, isValidAgentUser } from "#config/schema";
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
 * Refuse to go any further with an agent user name that is not usable.
 *
 * Called before a root script is rendered, so a bad name is a message rather
 * than a script. Three things are refused, and the third can only be answered by
 * asking the machine:
 *
 * - a name that is not shaped like a user name at all (shell syntax in it would
 *   be executed as root by the script it is interpolated into);
 * - `root`, which is uid 0 on every machine;
 * - a name that is the PRIMARY user — `agent_user` pointing at the operator's
 *   own account would remove the operator's own group memberships and delete the
 *   operator's own privilege drop-in;
 * - any name that already exists as uid 0 on the machine, whatever it is called
 *   (a machine with a second uid-0 alias would otherwise be set up so that
 *   "the unprivileged agent" is root).
 */
export async function assertAgentUserIsSafe(ctx: TaskContext, agentUser: string): Promise<void> {
	const refuse = (why: string): never => {
		throw new Error(
			`I won't set up the unattended agent user as ${JSON.stringify(agentUser)} on ${ctx.machine?.name ?? "this machine"}: ${why}. Fix \`agent_user\` in your hyperdrive config (\`hyper machine add ${ctx.machine?.name ?? "<machine>"} --agent-user <name>\` sets it).`,
		);
	};
	if (!isValidAgentUser(agentUser)) refuse(agentUserProblem(agentUser));

	const primaryUser = await primaryUserOf(ctx);
	if (agentUser === primaryUser) {
		refuse(
			`that is the primary user on this machine — the whole point of a second user is that it has none of your privileges, and this one would have yours`,
		);
	}
	const uid = await runScript(ctx, `id -u ${shellQuote(agentUser)} 2>/dev/null || true`);
	const resolved = uid.stdout.trim();
	if (resolved === "0") {
		refuse(`${agentUser} is uid 0 (root) on this machine`);
	}
}

/**
 * The primary user's login name on the target.
 *
 * `machine.host` is an ssh target, so `user@host` names the login — but a host
 * with no user part (`netcup`) or a Herdr-only machine has none, and `id -un` on
 * the target is the one thing that can't be wrong. The ssh target is only a
 * fallback for a runner that can't answer a probe.
 *
 * The probe is accepted only if it matches the SAME pattern as the agent user
 * (and strictly, without the `i` flag this used to carry). The name becomes a
 * `usermod` argument and a `setfacl` ACL entry in a root script, so a runner
 * answering with anything else must not have its answer interpolated.
 */
export async function primaryUserOf(ctx: TaskContext): Promise<string> {
	const probed = await runScript(ctx, "id -un");
	const name = probed.stdout.trim();
	if (probed.code === 0 && AGENT_USER_PATTERN.test(name) && name !== "") return name;
	const fromHost = ctx.machine?.host?.split("@")[0]?.trim() ?? "";
	return fromHost !== "" ? fromHost : ctx.config.self.name;
}

/**
 * The primary user's home on the target.
 *
 * `drive.toml`'s `home` wins when it is absolute — so a machine whose home is
 * `/Users/svallory` is set up at that path rather than at whatever `getent`
 * says — and that is what a task should follow on every run after the move.
 *
 * EXCEPT while the move has not happened yet, which is the FIRST run of the
 * `home-path` feature: the config says `/Users/<name>`, the account's home is
 * still `/home/<name>`, and non-root tasks apply BEFORE any root script is
 * assembled, so "configured but absent" is a normal state and not an error. A
 * path that is not a directory is not a home, so the password database's answer
 * is used instead, and the run says so. Probed, not assumed: only an explicit
 * `no` switches.
 */
export async function homeOf(ctx: TaskContext): Promise<string> {
	const configured = ctx.machine?.home?.startsWith("/")
		? ctx.machine.home
		: ctx.config.self.home.startsWith("/")
			? ctx.config.self.home
			: "";
	if (configured !== "") {
		const wanted = configured.replace(/\/+$/, "");
		const there = await runScript(ctx, `test -d ${shellQuote(wanted)} && echo yes || echo no`);
		if (there.stdout.trim() !== "no") return wanted;
		const real = await passwdHomeOf(ctx, await primaryUserOf(ctx));
		ctx.log(
			`${wanted} isn't a directory on this machine, so I'm using ${real} — the home the password database names. If ${wanted} is where your home should be, run the home-path root script; until then this is the path that exists.`,
		);
		return real;
	}
	const probed = await runScript(ctx, "echo $HOME");
	const home = probed.stdout.trim();
	if (probed.code === 0 && home.startsWith("/")) return home.replace(/\/+$/, "");
	throw new Error(
		"I couldn't work out the primary user's home directory on this machine (I asked, and got nothing usable). Set `home` for this machine in your hyperdrive config.",
	);
}

/** The account's real home, from the password database — not the configured one. */
export async function passwdHomeOf(ctx: TaskContext, primaryUser: string): Promise<string> {
	const probed = await runScript(ctx, `getent passwd ${shellQuote(primaryUser)} | cut -d: -f6`);
	const home = probed.stdout.trim();
	if (probed.code === 0 && home.startsWith("/")) return home.replace(/\/+$/, "");
	return `/home/${primaryUser}`;
}

/** The agent user's home, from the password database — not assumed to be /home/<name>. */
export async function agentHomeOf(ctx: TaskContext, agentUser: string): Promise<string> {
	const probed = await runScript(ctx, `getent passwd ${shellQuote(agentUser)} | cut -d: -f6`);
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
