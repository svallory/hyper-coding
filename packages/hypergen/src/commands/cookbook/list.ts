/**
 * List cookbooks in a kit or all installed cookbooks
 */

import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "#/lib/base-command";
import { discoverCookbooksInKit } from "#/config/cookbook-parser";
import { c } from "#/lib/colors";
import { s } from "#/lib/styles";

interface CookbookInfo {
	name: string;
	kit: string;
	description?: string;
	version?: string;
	recipes?: string[];
	path: string;
}

export default class CookbookList extends BaseCommand<typeof CookbookList> {
	static override description = "List cookbooks in a kit or all installed cookbooks";

	static override examples = [
		"<%= config.bin %> cookbook list",
		"<%= config.bin %> cookbook list @kit/starlight",
		"<%= config.bin %> cookbook list --json",
	];

	static override flags = {
		...BaseCommand.baseFlags,
		json: Flags.boolean({
			description: "Output as JSON",
			default: false,
		}),
		kit: Flags.string({
			char: "k",
			description: "Filter by kit name",
		}),
	};

	static override args = {
		kit: Args.string({
			description: "Kit to list cookbooks from (optional, lists all if omitted)",
			required: false,
		}),
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(CookbookList);

		try {
			// Discover all kits
			const kits = await this.discovery.discoverAll();

			// Filter by kit if specified (via arg or flag)
			const kitFilter = args.kit || flags.kit;
			const targetKits = kitFilter
				? kits.filter(
						(k) =>
							k.name === kitFilter ||
							k.name.endsWith(`/${kitFilter}`) ||
							k.name === `@kit/${kitFilter}`,
					)
				: kits;

			if (targetKits.length === 0 && kitFilter) {
				this.error(`Kit not found: ${kitFilter}`);
			}

			// Collect cookbooks from all target kits
			const cookbooks: CookbookInfo[] = [];

			for (const kit of targetKits) {
				if (!kit.cookbooks || kit.cookbooks.length === 0) {
					continue;
				}

				const kitPath = kit.path;
				const cookbookGlobs = ["./cookbooks/*/cookbook.yml"]; // Default pattern

				try {
					const discoveredCookbooks = await discoverCookbooksInKit(kitPath, cookbookGlobs);

					for (const [cookbookName, cookbook] of discoveredCookbooks) {
						// Get recipe names from the cookbook
						const recipeNames: string[] = [];
						if (cookbook.config.recipes) {
							// Extract recipe names from glob patterns or use defaults
							recipeNames.push(
								...cookbook.config.recipes.map((r) => {
									// Extract name from pattern like './*/recipe.yml' -> '*'
									const match = r.match(/\*\/|\*$/);
									return match ? "(varies)" : r;
								}),
							);
						}

						cookbooks.push({
							name: cookbookName,
							kit: kit.name,
							description: cookbook.config.description,
							version: cookbook.config.version,
							recipes: recipeNames.length > 0 ? recipeNames : undefined,
							path: cookbook.dirPath,
						});
					}
				} catch (error) {
					// Skip kits that fail to parse
					this.warn(`Failed to discover cookbooks in kit ${kit.name}: ${error}`);
				}
			}

			this.displayCookbooks(cookbooks, flags);
		} catch (error) {
			this.error(
				`Failed to list cookbooks: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	private displayCookbooks(cookbooks: CookbookInfo[], flags: { json?: boolean }): void {
		if (flags.json) {
			this.log(JSON.stringify(cookbooks, null, 2));
			return;
		}

		if (cookbooks.length === 0) {
			this.log(c.warning("No cookbooks found."));
			this.log(s.hint("\nInstall a kit with: hypergen kit install <kit>"));
			return;
		}

		// Group by kit for display
		const byKit = new Map<string, CookbookInfo[]>();
		for (const cookbook of cookbooks) {
			const kitCookbooks = byKit.get(cookbook.kit) || [];
			kitCookbooks.push(cookbook);
			byKit.set(cookbook.kit, kitCookbooks);
		}

		this.log(s.header("Cookbooks", cookbooks.length));
		this.log("");

		for (const [kitName, kitCookbooks] of byKit) {
			this.log(c.kit(`${kitName}:`));

			for (const cookbook of kitCookbooks) {
				const versionStr = cookbook.version ? s.version(cookbook.version) : "";
				this.log(s.listItem(c.cookbook(cookbook.name) + versionStr));

				if (cookbook.description) {
					this.log(s.description(cookbook.description));
				}

				if (cookbook.recipes && cookbook.recipes.length > 0) {
					this.log(s.description(`Recipes: ${cookbook.recipes.join(", ")}`));
				}
			}
			this.log("");
		}
	}
}
