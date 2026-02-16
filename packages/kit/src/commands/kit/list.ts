/**
 * List installed kits
 */

import { Flags } from "@oclif/core";
import { BaseCommand } from "#base-command";
// Colors and styles are available from @hypercli/ui when needed:
// import { c, s } from "@hypercli/ui";

export default class KitList extends BaseCommand<typeof KitList> {
	static override description = "List installed kits";

	static override examples = [
		"<%= config.bin %> kit list",
		"<%= config.bin %> kit list --json",
		"<%= config.bin %> kit list --verbose",
	];

	static override flags = {
		...BaseCommand.baseFlags,
		json: Flags.boolean({
			description: "Output as JSON",
			default: false,
		}),
		verbose: Flags.boolean({
			char: "v",
			description: "Show detailed information",
			default: false,
		}),
	};

	async run(): Promise<void> {
		await this.parse(KitList);

		// TODO: Implement kit list command
		// Colors and styles are now available via @hypercli/ui
		this.error("The 'kit list' command is not yet implemented");
	}
}
