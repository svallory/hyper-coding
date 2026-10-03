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
import { LocalMachine, type MachineRunner, RemoteMachine } from "#services/remote";

/** Where a machine's data came from. */
export type MachineSource = "herdr" | "config" | "both";

export interface MachineInfo {
	/** Name used on the command line, matching `drive.toml` and the Herdr label. */
	name: string;
	/** SSH host from Herdr. Undefined until Herdr knows the machine. */
	host?: string;
	/** Home dir from `drive.toml`. Undefined for a Herdr-only machine. */
	home?: string;
	/** Feature names from `drive.toml` (e.g. "docker", "mutagen"). */
	features: string[];
	/** User agents run as on that machine. Defaults to "agent". */
	agentUser: string;
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
		const host = pickString(entry, [
			"host",
			"sshHost",
			"ssh_host",
			"target",
			"sshTarget",
			"address",
		]);
		if (!host) continue;
		const name = pickString(entry, ["label", "name", "profileId", "profile_id", "id"]) ?? host;
		machines.push({ name, host });
	}
	return machines;
}

interface HerdrListing {
	available: boolean;
	machines: HerdrMachine[];
}

/**
 * Ask Herdr for its saved machines. A missing binary, a failing command or
 * unparsable output all mean "no machines", never an exception: hyperdrive must
 * still work with only a `drive.toml`.
 */
export function listHerdrMachines(): HerdrListing {
	const result = spawnSync("herdr", ["machine", "list", "--json"], { encoding: "utf-8" });
	if (result.error || result.status !== 0) return { available: false, machines: [] };
	const machines = parseHerdrJson(result.stdout ?? "");
	return { available: true, machines };
}

function merged(
	name: string,
	herdr: HerdrMachine | undefined,
	config: { home: string; features: string[]; agent_user: string } | undefined,
): MachineInfo {
	const inConfig = config !== undefined;
	const inHerdr = herdr !== undefined;
	return {
		name,
		host: herdr?.host,
		home: inConfig ? config.home || undefined : undefined,
		features: config?.features ?? [],
		agentUser: config?.agent_user || DEFAULT_AGENT_USER,
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
	for (const name of [...names].sort()) {
		const herdr = listing.machines.find((m) => m.name === name);
		machines.push(merged(name, herdr, config.machines[name]));
	}
	return machines;
}

function knownNames(): string {
	const names = listMachines().map((m) => m.name);
	return names.length > 0 ? names.join(", ") : "none yet";
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
	const listing = listHerdrMachines();
	const herdr = listing.machines.find((m) => m.name === name);

	if (!configEntry && !herdr) {
		throw new MachineError(
			`There's no machine called "${name}" in your hyperdrive config. Known machines: ${knownNames()}.`,
		);
	}

	if (configEntry && !herdr) {
		const herdrMissing = listing.available
			? ""
			: "\nHerdr doesn't seem to be installed — I couldn't find `herdr` on your PATH.";
		throw new MachineError(
			`The "${name}" machine is in your hyperdrive config, but Herdr doesn't know it yet, so there's nothing to connect to. Run \`herdr machine add ${name}\` first.${herdrMissing}`,
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
 * The runner for a command: local when there's no target or the target is this
 * machine, remote otherwise.
 */
export function runnerFor(name?: string): MachineRunner {
	if (name === undefined) return new LocalMachine();
	if (name === self().name) return new LocalMachine();
	const machine = resolveMachine(name);
	if (!machine.host) {
		throw new MachineError(
			`I don't know how to reach the "${machine.name}" machine — Herdr has no host for it yet. Run \`herdr machine add ${machine.name}\`.`,
		);
	}
	return new RemoteMachine(machine.host);
}
