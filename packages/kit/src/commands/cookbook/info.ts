/**
 * Show detailed information about a cookbook
 */

import { readFileSync } from "node:fs";
import { truncateDescription } from "@hypercli/core";
import { c, msg, s } from "@hypercli/ui";
import { Args } from "@oclif/core";
import yaml from "js-yaml";
import { BaseCommand } from "#base-command";
import type { CookbookTree, KitTree } from "#base-command";
import { infoFlags } from "#lib/flags";

interface FoundCookbook {
	kit: KitTree;
	cookbook: CookbookTree;
}

export default class CookbookInfo extends BaseCommand<typeof CookbookInfo> {
	static override description = "Show detailed information about a cookbook";

	static override examples = [
		"<%= config.bin %> cookbook info docs",
		"<%= config.bin %> cookbook info starlight docs",
		"<%= config.bin %> cookbook info docs --variables",
		"<%= config.bin %> cookbook info docs --json",
	];

	static override flags = {
		...BaseCommand.baseFlags,
		...infoFlags,
	};

	// Allow variable positional args for multi-match: [kit] <cookbook>
	static override strict = false;

	static override args = {
		name: Args.string({
			description: "Cookbook name (optionally preceded by kit name)",
			required: true,
		}),
	};

	async run(): Promise<void> {
		const { argv, flags } = await this.parse(CookbookInfo);
		await this.resolveEffectiveCwd(flags);

		const positionalArgs = argv as string[];
		let kitFilter: string | undefined;
		let cookbookName: string;

		if (positionalArgs.length >= 2) {
			kitFilter = positionalArgs[0];
			cookbookName = positionalArgs[1];
		} else {
			cookbookName = positionalArgs[0];
		}

		const kits = await this.discoverKitTree(flags.cwd);

		// Find matching cookbooks
		const matches: FoundCookbook[] = [];
		for (const kit of kits) {
			if (kitFilter && kit.manifest.name !== kitFilter) continue;
			for (const cb of kit.cookbooks) {
				if (cb.name === cookbookName) {
					matches.push({ kit, cookbook: cb });
				}
			}
		}

		if (matches.length === 0) {
			this.log(msg.error(`Cookbook not found: ${cookbookName}`));
			// Suggest available cookbooks
			const allCookbooks = kits.flatMap((k) =>
				k.cookbooks.map((cb) => `${k.manifest.name}/${cb.name}`),
			);
			if (allCookbooks.length > 0) {
				this.log("\n  Available cookbooks:");
				for (const name of allCookbooks) {
					this.log(`    ${c.cookbook(name)}`);
				}
			}
			this.log(`\n  Run ${c.command("hyper cookbook list")} for details.\n`);
			this.exit(1);
		}

		if (flags.json) {
			const output = matches.map((m) => ({
				name: m.cookbook.name,
				kit: m.kit.manifest.name,
				description: m.cookbook.config?.description,
				path: m.cookbook.path,
				recipes: m.cookbook.recipes.map((r) => r.name),
			}));
			this.log(JSON.stringify(output.length === 1 ? output[0] : output, null, 2));
			return;
		}

		// Display each match
		for (const match of matches) {
			this.displayCookbookInfo(match, flags);
		}
	}

	private displayCookbookInfo(match: FoundCookbook, flags: Record<string, any>): void {
		const { kit, cookbook } = match;
		const config = cookbook.config;

		this.log("");
		this.log(s.title("Cookbook", cookbook.name));
		this.log(s.hr());

		this.log(s.keyValue("Kit", c.kit(kit.manifest.name), 2));
		if (config?.description) this.log(s.keyValue("Description", config.description, 2));

		// Source (additive)
		if (flags.source) {
			this.log(s.keyValue("Path", s.path(cookbook.path), 2));
		}

		// Variables (additive)
		if (flags.variables && config?.variables) {
			this.log("");
			this.log(s.header("Variables"));
			for (const [key, variable] of Object.entries(config.variables)) {
				const v = variable as any;
				let line = `  ${c.property(key)}`;
				if (v.type) line += c.muted(` (${v.type})`);
				if (v.required) line += c.required(" *required*");
				if (v.default !== undefined) line += c.default(v.default);
				this.log(line);
				if (v.description) this.log(s.description(v.description, 4));
			}
		}

		// Recipes
		this.log("");
		this.log(s.header("Recipes", cookbook.recipes.length));

		if (cookbook.recipes.length === 0) {
			this.log(s.description("(No recipes found)", 2));
		} else {
			for (const recipe of cookbook.recipes) {
				this.log(s.listItem(c.recipe(recipe.name)));

				if (flags.recipes) {
					// Load recipe description
					try {
						const content = readFileSync(recipe.path, "utf-8");
						const parsed = yaml.load(content) as any;
						if (parsed?.description) {
							this.log(s.listItemBody(s.description(truncateDescription(parsed.description), 4)));
						}
					} catch {
						// ignore
					}
				}
			}
		}

		this.log("");
	}
}
