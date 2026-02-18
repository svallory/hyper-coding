/**
 * List cookbooks from installed kits
 */

import { truncateDescription } from "@hypercli/core";
import { c, msg, s } from "@hypercli/ui";
import { Args } from "@oclif/core";
import { BaseCommand } from "#base-command";
import { outputFlags } from "#lib/flags";

export default class CookbookList extends BaseCommand<typeof CookbookList> {
	static override description = "List cookbooks from installed kits";

	static override examples = [
		"<%= config.bin %> cookbook list",
		"<%= config.bin %> cookbook list starlight",
		"<%= config.bin %> cookbook list --json",
	];

	static override flags = {
		...BaseCommand.baseFlags,
		...outputFlags,
	};

	static override args = {
		kit: Args.string({
			description: "Filter by kit name",
			required: false,
		}),
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(CookbookList);
		await this.resolveEffectiveCwd(flags);

		const kits = await this.discoverKitTree(flags.cwd);

		// Filter by kit if specified
		const targetKits = args.kit ? kits.filter((k) => k.manifest.name === args.kit) : kits;

		if (targetKits.length === 0 && args.kit) {
			this.log(msg.error(`Kit not found: ${args.kit}`));
			this.log(`\n  Run ${c.command("hyper kit list")} to see installed kits.\n`);
			this.exit(1);
		}

		// Collect all cookbooks
		const cookbooks = targetKits.flatMap((kit) =>
			kit.cookbooks.map((cb) => ({
				name: cb.name,
				kit: kit.manifest.name,
				description: cb.config?.description,
				recipeCount: cb.recipes.length,
				path: cb.path,
			})),
		);

		if (flags.json) {
			this.log(JSON.stringify(cookbooks, null, 2));
			return;
		}

		if (cookbooks.length === 0) {
			this.log(msg.info("No cookbooks found."));
			this.log(`\n  Run ${c.command("hyper kit install <source>")} to add a kit.\n`);
			return;
		}

		this.log("");
		this.log(s.header("Cookbooks", cookbooks.length));
		this.log("");

		// Group by kit
		const byKit = new Map<string, typeof cookbooks>();
		for (const cb of cookbooks) {
			const group = byKit.get(cb.kit) ?? [];
			group.push(cb);
			byKit.set(cb.kit, group);
		}

		for (const [kitName, kitCookbooks] of byKit) {
			this.log(`  ${c.kit(kitName)}:`);

			for (const cb of kitCookbooks) {
				this.log(s.listItem(c.cookbook(cb.name)));

				const lines: string[] = [];
				if (cb.description) {
					lines.push(truncateDescription(cb.description));
				}
				lines.push(`${cb.recipeCount} recipe${cb.recipeCount !== 1 ? "s" : ""}`);

				if (lines.length > 0) {
					this.log(s.listItemBody(s.description(lines.join(" — "), 4)));
				}
			}

			this.log("");
		}
	}
}
