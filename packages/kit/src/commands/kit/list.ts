/**
 * List installed kits
 */

import { Flags } from "@oclif/core";
import { BaseCommand } from "#base-command";
// TODO: colors and styles modules don't exist in kit yet - they may belong in cli
// import { c } from "#lib/colors";
// import { s } from "#lib/styles";

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
		// This command needs:
		// - Kit discovery functionality (from @hypercli/gen or @hypercli/cli)
		// - Color utilities and styles (from @hypercli/gen or shared lib)
		this.error("The 'kit list' command is not yet implemented");
	}
}
