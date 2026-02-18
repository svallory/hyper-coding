/**
 * List recipes from installed kits
 */

import { readFileSync } from "node:fs";
import { truncateDescription } from "@hypercli/core";
import { c, msg, s } from "@hypercli/ui";
import { Args } from "@oclif/core";
import yaml from "js-yaml";
import { BaseCommand } from "#base-command";
import { outputFlags } from "#lib/flags";

interface RecipeInfo {
	name: string;
	kit: string;
	cookbook: string;
	description?: string;
	path: string;
}

export default class RecipeList extends BaseCommand<typeof RecipeList> {
	static override description = "List recipes from installed kits";

	static override examples = [
		"<%= config.bin %> recipe list",
		"<%= config.bin %> recipe list starlight",
		"<%= config.bin %> recipe list --json",
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
		const { args, flags } = await this.parse(RecipeList);
		await this.resolveEffectiveCwd(flags);

		const kits = await this.discoverKitTree(flags.cwd);

		const targetKits = args.kit ? kits.filter((k) => k.manifest.name === args.kit) : kits;

		if (targetKits.length === 0 && args.kit) {
			this.log(msg.error(`Kit not found: ${args.kit}`));
			this.log(`\n  Run ${c.command("hyper kit list")} to see installed kits.\n`);
			this.exit(1);
		}

		// Collect all recipes
		const recipes: RecipeInfo[] = [];
		for (const kit of targetKits) {
			for (const cb of kit.cookbooks) {
				for (const recipe of cb.recipes) {
					let description: string | undefined;
					try {
						const content = readFileSync(recipe.path, "utf-8");
						const parsed = yaml.load(content) as any;
						description = parsed?.description;
					} catch {
						// ignore
					}

					recipes.push({
						name: recipe.name,
						kit: kit.manifest.name,
						cookbook: cb.name,
						description,
						path: recipe.path,
					});
				}
			}
		}

		if (flags.json) {
			this.log(JSON.stringify(recipes, null, 2));
			return;
		}

		if (recipes.length === 0) {
			this.log(msg.info("No recipes found."));
			this.log(`\n  Run ${c.command("hyper kit install <source>")} to add a kit.\n`);
			return;
		}

		this.log("");
		this.log(s.header("Recipes", recipes.length));
		this.log("");

		// Group by kit, then cookbook
		const byKit = new Map<string, Map<string, RecipeInfo[]>>();
		for (const r of recipes) {
			if (!byKit.has(r.kit)) byKit.set(r.kit, new Map());
			const byCookbook = byKit.get(r.kit)!;
			if (!byCookbook.has(r.cookbook)) byCookbook.set(r.cookbook, []);
			byCookbook.get(r.cookbook)!.push(r);
		}

		for (const [kitName, byCookbook] of byKit) {
			this.log(`  ${c.kit(kitName)}:`);

			for (const [cbName, cbRecipes] of byCookbook) {
				for (const recipe of cbRecipes) {
					this.log(`    ${c.cookbook(cbName)}/${c.recipe(recipe.name)}`);
					if (recipe.description) {
						this.log(s.description(truncateDescription(recipe.description), 6));
					}
				}
			}

			this.log("");
		}
	}
}
