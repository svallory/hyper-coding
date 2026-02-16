/**
 * Show detailed information about a kit
 */

import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "#/base-command.js";
// TODO: These modules don't exist in kit yet - they may belong in cli or gen
// import { discoverCookbooksInKit, discoverRecipesInCookbook } from "#/config/cookbook-parser";
// import { c } from "#/lib/colors";
// import { s } from "#/lib/styles";

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
		// This command needs:
		// - Kit discovery functionality (from @hypercli/gen or @hypercli/cli)
		// - Color utilities and styles (from @hypercli/gen or shared lib)
		// - Cookbook parser (from @hypercli/core)
		this.error(`The 'kit info' command is not yet implemented. Kit: ${args.kit}`);
	}
}
