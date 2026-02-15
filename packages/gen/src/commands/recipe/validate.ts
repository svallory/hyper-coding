/**
 * Recipe Validate command - Validate a recipe file
 */

import { Args } from "@oclif/core";
import { BaseCommand } from "#/lib/base-command";
import { outputFlags, validationFlags } from "#/lib/flags";
import { loadRecipe } from "#/recipe-engine/recipe-engine";

export default class RecipeValidate extends BaseCommand<typeof RecipeValidate> {
	static description = "Validate a recipe file";

	static examples = [
		"<%= config.bin %> <%= command.id %> my-recipe.yml",
		"<%= config.bin %> <%= command.id %> .hyper/kits/component.yml --strict",
	];

	static flags = {
		...outputFlags,
		...validationFlags,
	};

	static args = {
		recipe: Args.string({
			description: "Path to recipe file (.yml or .yaml)",
			required: true,
		}),
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(RecipeValidate);
		const recipePath = args.recipe;

		try {
			const result = await loadRecipe(recipePath);
			const recipe = result.recipe;

			if (flags.json) {
				this.log(
					JSON.stringify(
						{
							valid: true,
							name: recipe.name,
							version: recipe.version,
							steps: recipe.steps?.length || 0,
							variables: Object.keys(recipe.variables || {}).length,
						},
						null,
						2,
					),
				);
				return;
			}

			this.log(`Recipe validation successful: ${recipe.name}`);
			this.log(`Version: ${recipe.version || "unversioned"}`);

			if (recipe.description) {
				this.log(`Description: ${recipe.description}`);
			}

			this.log(`Steps: ${recipe.steps?.length || 0}`);
			this.log(`Variables: ${Object.keys(recipe.variables || {}).length}`);

			if (recipe.steps?.length) {
				this.log("");
				this.log("Steps:");
				for (let i = 0; i < recipe.steps.length; i++) {
					const step = recipe.steps[i];
					this.log(`  ${i + 1}. ${step.name || step.tool} (${step.tool})`);
				}
			}
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);

			if (flags.json) {
				this.log(JSON.stringify({ valid: false, error: message }, null, 2));
				this.exit(1);
			}

			this.error(`Recipe validation failed: ${message}`);
		}
	}
}
