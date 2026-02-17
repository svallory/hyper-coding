/**
 * List cookbooks in a kit or all installed cookbooks
 */

import { discoverCookbooksInKit, discoverRecipesInCookbook } from "@hypercli/core";
import { c, s } from "@hypercli/ui/shortcuts";
import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "#lib/base-command";

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
						// Discover actual recipe names from the cookbook directory
						const recipeGlobs = cookbook.config.recipes ?? ["./*/recipe.yml"];
						let recipeNames: string[] | undefined;
						try {
							const discoveredRecipes = await discoverRecipesInCookbook(
								cookbook.dirPath,
								recipeGlobs,
							);
							if (discoveredRecipes.size > 0) {
								recipeNames = Array.from(discoveredRecipes.keys()).sort();
							}
						} catch {
							// If recipe discovery fails, omit the recipes list
						}

						cookbooks.push({
							name: cookbookName,
							kit: kit.name,
							description: cookbook.config.description,
							version: cookbook.config.version,
							recipes: recipeNames,
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

		this.exit(0);
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
				const versionStr = cookbook.version ? ` ${s.version(cookbook.version)}` : "";
				this.log(s.listItem(c.cookbook(cookbook.name) + versionStr));

				const bodyLines: string[] = [];

				if (cookbook.description) {
					bodyLines.push(s.description(cookbook.description.trim()));
				}

				if (cookbook.recipes && cookbook.recipes.length > 0) {
					const recipeList = cookbook.recipes.map((r) => c.recipe(r)).join(c.muted(", "));
					if (bodyLines.length > 0) bodyLines.push("");
					bodyLines.push(s.description("Recipes: ") + recipeList);
				}

				if (bodyLines.length > 0) {
					this.log(s.listItemBody(...bodyLines));
				}
			}
		}
	}
}
