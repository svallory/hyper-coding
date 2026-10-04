/**
 * Base command class for @hypercli/drive commands
 *
 * Extends oclif Command directly. Plugins must NOT import the CLI host
 * package: dependencies flow cli → gen → kit → core, so a plugin
 * depending on the CLI host would be circular.
 */

import { Command, Flags, type Interfaces } from "@oclif/core";
import { keepAbsolutePathEntries } from "#lib/safe-path";

export type BaseFlags<T extends typeof Command> = Interfaces.InferredFlags<
	(typeof BaseCommand)["baseFlags"] & T["flags"]
>;
export type BaseArgs<T extends typeof Command> = Interfaces.InferredArgs<T["args"]>;

export abstract class BaseCommand<T extends typeof Command> extends Command {
	static override baseFlags = {
		debug: Flags.boolean({
			char: "d",
			description: "Enable debug output",
			default: false,
		}),
	};

	declare protected flags: BaseFlags<T>;
	declare protected args: BaseArgs<T>;

	/**
	 * Before anything else a drive command does: no relative PATH entry may
	 * pick a `bash` or `git` out of the working directory (lib/safe-path.ts).
	 */
	public override async init(): Promise<void> {
		keepAbsolutePathEntries();
		await super.init();
	}
}
