/**
 * `hyper machine add <name>` — register a machine in `drive.toml`.
 *
 * The one thing this must get right is the order: Herdr first, then the config.
 * A machine Herdr can't reach is a machine nothing works, and writing the
 * config entry anyway would leave `machine setup <name>` failing later with a
 * message about Herdr that the user has already forgotten. So the name is
 * checked against Herdr's saved machines and the table is written only once
 * there's a host to connect to.
 *
 * The write itself goes through `config/index.ts` (C-14) — this file never
 * touches TOML — and nothing here spawns ssh, scp or rsync (C-16): adding a
 * machine is a local config write, not a conversation with it.
 */

import { Args, Flags } from "@oclif/core";
import { ConfigError, type DeepPartial, loadConfig, writeConfig } from "#config/index";
import type { MachineConfig } from "#config/schema";
import { BaseCommand } from "#lib/base-command";
import { addHint, listHerdrMachines, MachineError } from "#services/machine";
import { FEATURES, isFeature } from "#services/machine/tasks/types";

/**
 * `--features a,b` into a list, rejecting names that aren't features.
 *
 * Validated here rather than trusted: a typo would otherwise be written to the
 * config as a feature no task belongs to, and nothing would ever complain —
 * `machine setup --yes` would just quietly not pick it.
 */
function parseFeatures(raw: string | undefined): string[] {
	const wanted = (raw ?? "")
		.split(",")
		.map((part) => part.trim())
		.filter((part) => part !== "");
	const unknown = wanted.filter((part) => !isFeature(part));
	if (unknown.length > 0) {
		throw new MachineError(
			`Unknown feature${unknown.length > 1 ? "s" : ""}: ${unknown.join(", ")}. The features are: ${FEATURES.join(", ")}.`,
		);
	}
	return wanted;
}

export default class MachineAdd extends BaseCommand<typeof MachineAdd> {
	static override description = "Add a machine to your hyperdrive config";

	static override examples = [
		"<%= config.bin %> machine add netcup",
		"<%= config.bin %> machine add netcup --home /home/svallory --features docker-rootless",
	];

	static override args = {
		name: Args.string({
			description: "Name to save the machine under (the Herdr label)",
			required: true,
		}),
	};

	static override flags = {
		...BaseCommand.baseFlags,
		home: Flags.string({
			description: "Home directory on that machine, e.g. /home/svallory",
		}),
		features: Flags.string({
			description: 'Comma-separated features this machine has, e.g. "tools,docker-rootless"',
		}),
		"agent-user": Flags.string({
			description: "User agents run as on that machine (default: agent)",
		}),
	};

	async run(): Promise<void> {
		const { argv, flags } = await this.parse(MachineAdd);
		// InferredArgs degrades to unknown[] here; there is exactly one arg.
		const name = typeof argv[0] === "string" ? argv[0] : "";

		// Herdr first: it owns the connection, and a config entry without a host
		// is a promise the machine list can't keep.
		const listing = listHerdrMachines();
		const herdr = listing.machines.find((machine) => machine.name === name);
		if (herdr === undefined) {
			const note = listing.problem ? `\n${listing.problem}` : "";
			this.error(
				`Herdr doesn't know a machine called "${name}" yet, so there's nothing to connect to. Run \`${addHint(name)}\` first.${note}`,
				{ exit: 2 },
			);
		}

		// Only the flags actually given. Writing `home: ""` for an `--agent-user`
		// re-run would erase a home the user set earlier — and the hints below
		// tell people to re-run exactly that way to fix one field at a time.
		const update: DeepPartial<MachineConfig> = {};
		try {
			if (flags.home !== undefined) update.home = flags.home;
			if (flags.features !== undefined) update.features = parseFeatures(flags.features);
			if (flags["agent-user"] !== undefined) update.agent_user = flags["agent-user"];

			// No `defaults` override: writeConfig's base is the file as it stands,
			// so keys this version doesn't know about survive the write.
			const written = writeConfig({ machines: { [name]: update } });

			// The post-write truth, not what was passed: a field left out of the
			// update may already have a value, and then there is nothing to hint at.
			const saved = loadConfig().machines[name];
			this.log(`Added "${name}" (host ${herdr.host}) to ${written}.`);
			if (saved !== undefined && saved.home === "") {
				this.log(
					`No home recorded — add one with \`${this.config.bin} machine add ${name} --home /home/<user>\`, or commands that need it will say so.`,
				);
			}
			if (saved !== undefined && saved.features.length === 0) {
				this.log(
					`No features recorded, so \`${this.config.bin} machine setup ${name} --yes\` would have nothing to pick. Add them with \`--features tools\`.`,
				);
			}
		} catch (err) {
			// A bad feature name is the user's typo and a config problem is theirs to
			// fix: both exit 2, the same as an unknown machine above. Both throws
			// have to happen inside this try for that to be true — a rejected flag
			// that escapes here is an unhandled error and exits 1 with a stack.
			if (err instanceof MachineError || err instanceof ConfigError) {
				this.error(err.message, { exit: 2 });
			}
			throw err;
		}
	}
}
