/**
 * Show detailed information about a kit
 */

import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "#base-command";
// Colors and styles are available from @hypercli/ui when needed:
// import { c, s } from "@hypercli/ui";

export default class KitInfo extends BaseCommand<typeof KitInfo> {
	static override description = "Show detailed information about a kit";

	static override examples = [
		"<%= config.bin %> kit info @kit/starlight",
		"<%= config.bin %> kit info starlight --json",
	];

	static override flags = {
		...BaseCommand.baseFlags,
		json: Flags.boolean({
			description: "Output as JSON",
			default: false,
		}),
	};

	static override args = {
		kit: Args.string({
			description: "Kit name or path",
			required: true,
		}),
	};

	async run(): Promise<void> {
		const { args } = await this.parse(KitInfo);

		// TODO: Implement kit info command
		// Colors and styles are now available via @hypercli/ui
		this.error(`The 'kit info' command is not yet implemented. Kit: ${args.kit}`);
	}
}
