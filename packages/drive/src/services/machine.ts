/**
 * The machine registry: what hyperdrive knows about machines, merging the
 * user's `drive.toml` with the SSH machines Herdr has saved.
 *
 * Herdr owns the connection (host, keys, compression); `drive.toml` owns the
 * hyperdrive details (home, features, agent user). Neither alone is enough, so
 * the two are merged here rather than in each command.
 */

import { spawnSync } from "node:child_process";
import { loadConfig } from "#config/index";
import {
	LocalMachine,
	type MachineRunner,
	RemoteMachine,
	type Spawner,
	type SshTarget,
	splitSshTarget,
	targetWithUser,
} from "#services/remote";

/** Where a machine's data came from. */
export type MachineSource = "herdr" | "config" | "both";

export interface MachineInfo {
	/** Name used on the command line, matching `drive.toml` and the Herdr label. */
	name: string;
	/** SSH target from Herdr. Undefined until Herdr knows the machine. */
	host?: string;
	/**
	 * Port from the Herdr target, when it named one (`box:2222`).
	 *
	 * Kept apart from `host` because the three transports that carry it spell a
	 * non-default port differently, and handing a `host:port` pair straight to
	 * ssh would ask it to resolve a host with that literal name.
	 */
	port?: number;
	/** Home dir from `drive.toml`. Undefined for a Herdr-only machine. */
	home?: string;
	/** Feature names from `drive.toml` (e.g. "docker", "mutagen"). */
	features: string[];
	/** User agents run as on that machine. Defaults to "agent". */
	agentUser: string;
	/**
	 * Path to a ssh public key (.pub) the agent user should accept there. Empty
	 * means "not configured": setup then reads this machine's own default public
	 * key, and says which file it read.
	 */
	agentKey: string;
	source: MachineSource;
	/** False when Herdr isn't installed or doesn't know the machine. */
	herdr: boolean;
}

/** A machine as Herdr reports it, after normalizing the JSON it printed. */
interface HerdrMachine {
	name: string;
	host: string;
}

/** A user error worth a friendly message (as opposed to a bug). */
export class MachineError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "MachineError";
	}
}

const DEFAULT_AGENT_USER = "agent";

/**
 * Herdr's `machine list --json` key names have shifted between releases, so
 * accept the plausible spellings rather than silently dropping machines. A
 * machine whose label we can't read is still listed by host.
 */
function pickString(entry: Record<string, unknown>, keys: readonly string[]): string | undefined {
	for (const key of keys) {
		const value = entry[key];
		if (typeof value === "string" && value.trim() !== "") return value.trim();
	}
	return undefined;
}

/**
 * Herdr's `machine list --json` entry shape.
 *
 * HERDR-INTERNAL (unverified against a saved machine, 0.9.3): the help text for
 * `herdr machine` lists "label, SSH target, explicit Herdr session, enabled
 * state", and the 0.9.3 binary carries those strings, so `label`/`target` are
 * the primary keys here. The older spellings stay as fallbacks so an older or
 * newer Herdr still lists something, and a disabled machine is skipped —
 * hyperdrive can't route to one, and `herdr machine enable <label>` is what
 * brings it back.
 */
function parseHerdrJson(stdout: string): HerdrMachine[] {
	let parsed: unknown;
	try {
		parsed = JSON.parse(stdout);
	} catch {
		return [];
	}
	// Tolerate both a bare array and `{ machines: [...] }`.
	const list = Array.isArray(parsed)
		? parsed
		: typeof parsed === "object" &&
				parsed !== null &&
				Array.isArray((parsed as { machines?: unknown }).machines)
			? (parsed as { machines: unknown[] }).machines
			: [];

	const machines: HerdrMachine[] = [];
	for (const item of list) {
		if (typeof item !== "object" || item === null) continue;
		const entry = item as Record<string, unknown>;
		if (entry.enabled === false) continue;
		const host = pickString(entry, [
			"target",
			"host",
			"sshTarget",
			"sshHost",
			"ssh_host",
			"address",
		]);
		if (!host) continue;
		const name = pickString(entry, ["label", "name", "profileId", "profile_id", "id"]) ?? host;
		// Two saved machines with the same label make `herdr --machine <label>`
		// ambiguous; the registry can't guess, so it refuses and says so.
		if (machines.some((machine) => machine.name === name)) {
			throw new MachineError(
				`Herdr has two machines called "${name}". That's ambiguous — rename one with \`herdr machine rename\`.`,
			);
		}
		machines.push({ name, host });
	}
	return machines;
}

interface HerdrListing {
	/** False only when there is no `herdr` binary on PATH. */
	installed: boolean;
	/** Saved machines Herdr can actually reach (disabled ones are left out). */
	machines: HerdrMachine[];
	/** Plain-language note about why the listing is short, for error messages. */
	problem?: string;
}

/**
 * Ask Herdr for its saved machines. A missing binary, a failing command or
 * unparsable output all mean "no machines", never an exception: hyperdrive must
 * still work with only a `drive.toml`.
 */
export function listHerdrMachines(): HerdrListing {
	const result = spawnSync("herdr", ["machine", "list", "--json"], {
		encoding: "utf-8",
		timeout: 10_000,
	});
	if (result.error) {
		const code = (result.error as NodeJS.ErrnoException).code;
		// Only ENOENT means "Herdr isn't installed". Anything else (a crash, a
		// permissions problem, a timeout) is a different problem and must not be
		// reported as a missing install.
		if (code === "ENOENT") {
			return {
				installed: false,
				machines: [],
				problem: "Herdr doesn't seem to be installed — I couldn't find `herdr` on your PATH.",
			};
		}
		if (code === "ETIMEDOUT") {
			return {
				installed: true,
				machines: [],
				problem:
					"`herdr machine list` didn't answer within 10 seconds — Herdr may be stuck. Try `herdr machine list` yourself.",
			};
		}
		return {
			installed: true,
			machines: [],
			problem: `Herdr couldn't be run: ${friendlyError(result.error)}`,
		};
	}
	if (result.status !== 0) {
		const detail = (result.stderr ?? "").trim();
		return {
			installed: true,
			machines: [],
			problem: `\`herdr machine list --json\` failed${detail ? `: ${detail}` : ` (exit ${result.status})`}.`,
		};
	}
	return { installed: true, machines: parseHerdrJson(result.stdout ?? "") };
}

function friendlyError(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

function merged(
	name: string,
	herdr: HerdrMachine | undefined,
	config: { home: string; features: string[]; agent_user: string; agent_key: string } | undefined,
): MachineInfo {
	const inConfig = config !== undefined;
	const inHerdr = herdr !== undefined;
	// A target that can't be split is not a machine hyperdrive can reach, but
	// neither is it a crash: `machine list` still lists the machine (with its
	// target verbatim) and the friendly error belongs on the command that tries
	// to use it. `targetFor()` is where that error is raised.
	let host: string | undefined;
	let port: number | undefined;
	if (herdr?.host) {
		try {
			const split = splitSshTarget(herdr.host);
			host = split.host;
			port = split.port;
		} catch {
			host = herdr.host;
		}
	}
	return {
		name,
		host,
		...(port === undefined ? {} : { port }),
		home: inConfig ? config.home || undefined : undefined,
		features: config?.features ?? [],
		agentUser: config?.agent_user || DEFAULT_AGENT_USER,
		agentKey: config?.agent_key || "",
		source: inHerdr && inConfig ? "both" : inHerdr ? "herdr" : "config",
		herdr: inHerdr,
	};
}

/** Every known machine: Herdr's saved machines plus `drive.toml`'s `[machines.*]`. */
export function listMachines(): MachineInfo[] {
	const config = loadConfig();
	const listing = listHerdrMachines();

	const names = new Set<string>([
		...listing.machines.map((m) => m.name),
		...Object.keys(config.machines),
	]);
	const machines: MachineInfo[] = [];
	for (const name of [...names].sort((a, b) => (a < b ? -1 : 1))) {
		const herdr = listing.machines.find((m) => m.name === name);
		machines.push(merged(name, herdr, config.machines[name]));
	}
	return machines;
}

/**
 * How to save a machine in Herdr. Real usage is
 * `herdr machine add <ssh-target> [--label <label>]` — the label is optional and
 * defaults to the host, so both parts are spelled out here.
 */
export function addHint(name: string): string {
	return `herdr machine add <user@host> --label ${name}`;
}

/**
 * Look up one machine by name.
 *
 * - Unknown name → error listing the known ones.
 * - Config-only machine → error telling the user to add it to Herdr, since
 *   without a Herdr machine there is no host to ssh to.
 * - Herdr-only machine → returned with `home` undefined. Commands that need a
 *   home dir say so themselves, with the machine's name in the message.
 */
export function resolveMachine(name: string): MachineInfo {
	const config = loadConfig();
	const configEntry = config.machines[name];
	// Herdr is asked exactly once: the listing feeds both the match and the
	// known-names list in the error messages.
	const listing = listHerdrMachines();
	const herdr = listing.machines.find((m) => m.name === name);
	const knownNames = (): string => {
		const names = [
			...new Set([...listing.machines.map((m) => m.name), ...Object.keys(config.machines)]),
		].sort((a, b) => (a < b ? -1 : 1));
		return names.length > 0 ? names.join(", ") : "none yet";
	};

	if (!configEntry && !herdr) {
		throw new MachineError(
			`There's no machine called "${name}" in your hyperdrive config. Known machines: ${knownNames()}.`,
		);
	}

	if (configEntry && !herdr) {
		const note = listing.problem ? `\n${listing.problem}` : "";
		throw new MachineError(
			`The "${name}" machine is in your hyperdrive config, but Herdr doesn't know it yet, so there's nothing to connect to. Run \`${addHint(name)}\` first.${note}`,
		);
	}

	return merged(name, herdr, configEntry);
}

/** This machine, as named in `drive.toml`. */
export function self(): { name: string; home: string } {
	const config = loadConfig();
	if (!config.self.name) {
		throw new MachineError(
			"Your hyperdrive config doesn't say which machine this is. Run `hyper drive init` to set it up.",
		);
	}
	return { name: config.self.name, home: config.self.home };
}

/**
 * The SSH target of a machine, as the two halves the transport binaries each
 * need: `host` for ssh and rsync, `port` (possibly undefined) for the ssh that
 * rsync runs and for git's own.
 *
 * Separate from {@link runnerFor} because a caller that builds a URL — warp's
 * `git push` — needs the same split without holding an instance.
 */
export function targetFor(name: string): SshTarget {
	const machine = resolveMachine(name);
	if (!machine.host) {
		throw new MachineError(
			`I don't know how to reach the "${machine.name}" machine — Herdr has no target for it yet. Run \`${addHint(machine.name)}\`.`,
		);
	}
	// Split Herdr's own target rather than trusting the lenient parse in
	// `merged()`: here an unusable target is the answer, not a warning.
	const herdr = listHerdrMachines().machines.find((entry) => entry.name === name);
	if (!herdr) {
		throw new MachineError(
			`The "${name}" machine has no SSH target in Herdr, so there's nothing to reach. Run \`${addHint(name)}\` first.`,
		);
	}
	try {
		return splitSshTarget(herdr.host);
	} catch (error) {
		const detail = error instanceof Error ? error.message : String(error);
		throw new MachineError(
			`Herdr has "${herdr.host}" as the SSH target for "${name}", which isn't a host hyperdrive can use: ${detail}. Re-save it with \`${addHint(name)}\`.`,
		);
	}
}

/**
 * The runner for a command: local when there's no target or the target is this
 * machine, remote otherwise.
 */
export function runnerFor(name?: string): MachineRunner {
	if (name === undefined) return new LocalMachine();
	// Read self.name straight from the config rather than through self(): an unset
	// self.name is `self()`'s friendly error, but asking for another machine is a
	// perfectly reasonable thing to do before `hyper drive init` has ever run.
	if (name === loadConfig().self.name) return new LocalMachine();
	const target = targetFor(name);
	return new RemoteMachine(
		target.host,
		undefined,
		target.port === undefined ? {} : { port: target.port },
	);
}

/**
 * A runner that reaches the same machine as ANOTHER user.
 *
 * The unattended agent owns its own Docker, its own `systemd --user` units and
 * its own home, so some work simply cannot be done as the primary user. This is
 * how a task gets at it: the same ssh transport, with the user substituted in
 * the target (`svallory@box` becomes `agent@box`), which is the only way to
 * open a real login session of that user — and a real login session is exactly
 * what rootless Docker's setuptool needs.
 *
 * Local setups are refused here, by name: becoming another user on this
 * machine needs root, and hyper never runs as root (C-6).
 */
export function agentRunnerFor(
	machine: MachineInfo | null,
	agentUser: string,
	spawner?: Spawner,
): MachineRunner {
	const name = machine?.name ?? "this machine";
	if (machine === null) {
		throw new MachineError(
			`I can't open a session as \`${agentUser}\` on this machine: becoming another user here needs root, and hyper never runs as root. Set the machine up over ssh instead — \`hyper machine setup <machine> --features docker-rootless\`.`,
		);
	}
	if (!machine.host) {
		throw new MachineError(
			`I don't know how to reach the "${name}" machine as \`${agentUser}\` — Herdr has no target for it yet. Run \`${addHint(name)}\` first.`,
		);
	}
	// The spawner is a test seam: without one this is the real ssh.
	// otherUser: never the operator's agent forwarding or shared connections.
	// The port Herdr's target named travels too: `machine.host` has had it
	// split off, and the agent's ssh goes to the same sshd.
	return new RemoteMachine(targetWithUser(machine.host, agentUser), spawner, {
		otherUser: true,
		...(machine.port === undefined ? {} : { port: machine.port }),
	});
}
