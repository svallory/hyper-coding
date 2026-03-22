/**
 * Base command class for @hypercli/hq commands
 *
 * Extends oclif Command directly. When @hypercli/kit is available,
 * this can be updated to extend KitBaseCommand instead.
 */

import { Command, Flags, type Interfaces } from "@oclif/core";

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

	protected declare flags: BaseFlags<T>;
	protected declare args: BaseArgs<T>;
}
