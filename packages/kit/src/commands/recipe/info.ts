/**
 * Show detailed information about a recipe
 */

import { readFileSync } from "node:fs";
import { formatVariable } from "@hypercli/core";
import { c, indent, markdown, msg, s } from "@hypercli/ui";
import { Args } from "@oclif/core";
import yaml from "js-yaml";
import { BaseCommand } from "#base-command";
import type { CookbookTree, KitTree, RecipeEntry } from "#base-command";
import { infoFlags } from "#lib/flags";

interface FoundRecipe {
	kit: KitTree;
	cookbook: CookbookTree;
	recipe: RecipeEntry;
	parsed: any;
}

export default class RecipeInfo extends BaseCommand<typeof RecipeInfo> {
	static override description = "Show detailed information about a recipe";

	static override examples = [
		"<%= config.bin %> recipe info crud",
		"<%= config.bin %> recipe info starlight crud",
		"<%= config.bin %> recipe info starlight docs crud",
		"<%= config.bin %> recipe info crud --steps",
		"<%= config.bin %> recipe info crud --json",
	];

	static override flags = {
		...BaseCommand.baseFlags,
		...infoFlags,
	};

	// Allow variable positional args: [kit] [cookbook] <recipe>
	static override strict = false;

	static override args = {
		name: Args.string({
			description: "Recipe name (optionally preceded by kit and/or cookbook names)",
			required: true,
		}),
	};

	async run(): Promise<void> {
		const { argv, flags } = await this.parse(RecipeInfo);
		await this.resolveEffectiveCwd(flags);

		const positionalArgs = argv as string[];
		let kitFilter: string | undefined;
		let cookbookFilter: string | undefined;
		let recipeName: string;

		if (positionalArgs.length >= 3) {
			kitFilter = positionalArgs[0];
			cookbookFilter = positionalArgs[1];
			recipeName = positionalArgs[2];
		} else if (positionalArgs.length === 2) {
			kitFilter = positionalArgs[0];
			recipeName = positionalArgs[1];
		} else {
			recipeName = positionalArgs[0];
		}

		const kits = await this.discoverKitTree(flags.cwd);

		// Find matching recipes
		const matches: FoundRecipe[] = [];
		for (const kit of kits) {
			if (kitFilter && kit.manifest.name !== kitFilter) continue;
			for (const cb of kit.cookbooks) {
				if (cookbookFilter && cb.name !== cookbookFilter) continue;
				for (const recipe of cb.recipes) {
					if (recipe.name === recipeName) {
						let parsed: any = {};
						try {
							const content = readFileSync(recipe.path, "utf-8");
							parsed = yaml.load(content) ?? {};
						} catch {
							// ignore
						}
						matches.push({ kit, cookbook: cb, recipe, parsed });
					}
				}
			}
		}

		if (matches.length === 0) {
			this.log(msg.error(`Recipe not found: ${recipeName}`));
			this.log(`\n  Run ${c.command("hyper recipe list")} to see available recipes.\n`);
			this.exit(1);
		}

		if (flags.json) {
			const output = matches.map((m) => ({
				name: m.recipe.name,
				kit: m.kit.manifest.name,
				cookbook: m.cookbook.name,
				path: m.recipe.path,
				...m.parsed,
			}));
			this.log(JSON.stringify(output.length === 1 ? output[0] : output, null, 2));
			return;
		}

		for (const match of matches) {
			this.displayRecipeInfo(match, flags);
		}
	}

	private displayRecipeInfo(match: FoundRecipe, flags: Record<string, any>): void {
		const { kit, cookbook, recipe, parsed } = match;

		this.log("");
		this.log(markdown(`# Recipe: ${recipe.name}`));

		this.log(s.keyValue("kit", c.kit(kit.manifest.name), 2));
		this.log(s.keyValue("cookbook", c.cookbook(cookbook.name), 2));
		if (parsed.version) this.log(s.keyValue("version", c.version(parsed.version), 2));
		if (parsed.description) {
			this.log("");
			this.log(indent(c.muted(parsed.description), 2));
		}

		// Source (additive)
		if (flags.source) {
			this.log("");
			this.log(s.header("Source"));
			this.log(s.keyValue("  path", s.path(recipe.path)));
		}

		// Variables — shown by default with full details
		const variables = parsed.variables ? Object.entries(parsed.variables) : [];
		if (variables.length > 0) {
			this.log("");
			this.log(s.header("Variables", variables.length));

			for (const [key, variable] of variables) {
				const v = formatVariable(key, variable as Record<string, unknown>);
				let line = `  ${c.property(v.name)}`;
				if (v.type) line += c.muted(` (${v.type})`);
				if (v.required) line += c.required(" *required*");
				if (v.defaultValue !== undefined) line += c.default(v.defaultValue);
				this.log(line);

				if (v.description) this.log(s.description(v.description, 4));
				if (v.enumValues) {
					this.log(s.description(`options: ${v.enumValues.join(", ")}`, 4));
				}
			}
		}

		// Steps — shown by default
		if (Array.isArray(parsed.steps) && parsed.steps.length > 0) {
			this.log("");
			this.log(s.header("Steps", parsed.steps.length));

			for (let i = 0; i < parsed.steps.length; i++) {
				const step = parsed.steps[i];
				const name = step.name || `Step ${i + 1}`;
				const tool = step.tool ? c.muted(` [${step.tool}]`) : "";
				this.log(`  ${c.muted(`${i + 1}.`)} ${name}${tool}`);
			}
		}

		this.log("");
	}
}
