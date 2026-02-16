/**
 * Show detailed information about a cookbook
 */

import path from "node:path";
import { Args, Flags } from "@oclif/core";
import { BaseCommand } from "#/lib/base-command";
import { c } from "#/lib/colors";
import { s } from "#/lib/styles";

export default class CookbookInfo extends BaseCommand<typeof CookbookInfo> {
	static override description = "Show detailed information about a cookbook";

	static override examples = [
		"<%= config.bin %> cookbook info starlight",
		"<%= config.bin %> cookbook info @kit/starlight/docs --json",
	];

	static override flags = {
		...BaseCommand.baseFlags,
		json: Flags.boolean({
			description: "Output as JSON",
			default: false,
		}),
	};

	static override args = {
		cookbook: Args.string({
			description: "Cookbook name or path",
			required: true,
		}),
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(CookbookInfo);

		try {
			this.log(s.hint(`Searching for cookbook: ${args.cookbook}...`));

			// 1. Discover all kits
			const generators = await this.discovery.discoverAll();

			// 2. Find the cookbook in the discovered kits
			let foundCookbook:
				| {
						kitName: string;
						kitPath: string;
						cookbookName: string;
						cookbookPath: string;
						config: any; // CookbookConfig
				  }
				| undefined;

			// Helper to match cookbook name
			const targetCookbook = args.cookbook;

			for (const generator of generators) {
				// We only care about kits (generators with cookbooks)
				if (!generator.cookbooks || generator.cookbooks.length === 0) continue;

				// Check if this kit contains the requested cookbook
				if (generator.cookbooks.includes(targetCookbook)) {
					// Found it! Now we need the path.
					// We need to re-parse the kit to get the cookbook globs and find the path
					// (GeneratorDiscovery only gives us names)

					// Import from @hypercli/core
					const { parseKitFile, discoverCookbooksInKit } = await import("@hypercli/core");

					const kitYmlPath = path.join(generator.path, "kit.yml");
					const parsedKit = await parseKitFile(kitYmlPath);

					if (parsedKit.isValid && parsedKit.config.cookbooks) {
						const cookbooks = await discoverCookbooksInKit(
							generator.path,
							parsedKit.config.cookbooks,
						);
						const cookbook = cookbooks.get(targetCookbook);

						if (cookbook) {
							foundCookbook = {
								kitName: generator.name,
								kitPath: generator.path,
								cookbookName: cookbook.config.name,
								cookbookPath: cookbook.dirPath,
								config: cookbook.config,
							};
							break; // Stop searching once found
						}
					}
				}
			}

			if (!foundCookbook) {
				this.log(s.error(`Cookbook not found: ${args.cookbook}`));
				await this.suggestAvailableCookbooks(generators);
				this.exit(1);
			}

			// 3. Discover recipes in the cookbook
			const { discoverRecipesInCookbook } = await import("@hypercli/core");
			// Default recipe globs if not specified in cookbook config
			const recipeGlobs = foundCookbook.config.recipes || ["./*/recipe.yml"];
			const recipeMap = await discoverRecipesInCookbook(foundCookbook.cookbookPath, recipeGlobs);

			const recipePaths = Array.from(recipeMap.values());

			// 4. Load recipe details
			const recipesWithDetails = [];
			for (const recipePath of recipePaths) {
				try {
					const { recipe } = await this.recipeEngine.loadRecipe(recipePath);
					recipesWithDetails.push(recipe);
				} catch (e) {
					// Log warning but continue
					this.warn(
						`Failed to load recipe at ${recipePath}: ${e instanceof Error ? e.message : String(e)}`,
					);
				}
			}

			// Sort recipes by name
			recipesWithDetails.sort((a, b) => a.name.localeCompare(b.name));

			if (flags.json) {
				const output = {
					name: foundCookbook.cookbookName,
					kit: foundCookbook.kitName,
					location: foundCookbook.cookbookPath,
					description: foundCookbook.config.description,
					recipes: recipesWithDetails,
				};
				this.log(JSON.stringify(output, null, 2));
				return;
			}

			// 5. Display Information
			this.log("");
			this.log(s.title("Cookbook", foundCookbook.cookbookName));
			this.log(s.hr());

			this.log(s.keyValue("Location", s.path(foundCookbook.cookbookPath), 10));
			this.log(s.keyValue("Kit", c.kit(foundCookbook.kitName), 10));

			if (foundCookbook.config.description) {
				this.log(s.keyValue("Description", foundCookbook.config.description, 10));
			}

			this.log("");
			this.log(s.header("Recipes", recipesWithDetails.length));

			if (recipesWithDetails.length === 0) {
				this.log(s.description("(No recipes found)", 2));
			} else {
				for (const recipe of recipesWithDetails) {
					this.log("");
					this.log(s.listItem(c.recipe(recipe.name)));

					if (recipe.description) {
						this.log(s.description(recipe.description));
					}

					if (recipe.variables && Object.keys(recipe.variables).length > 0) {
						this.log(s.indent(c.helper("Variables:"), 4));

						for (const [key, variable] of Object.entries(recipe.variables)) {
							const varAny = variable as any;
							let varLine = c.property(`    ${key}`);

							if (varAny.type) {
								varLine += c.subtle(` (${varAny.type})`);
							}

							if (varAny.required) {
								varLine += c.required(" *required*");
							}

							if (varAny.default !== undefined) {
								varLine += c.default(varAny.default);
							}

							this.log(s.indent(varLine, 4));

							if (varAny.description) {
								this.log(s.indent(c.text(varAny.description), 6));
							}

							// Helper to check for enum properties safely
							if (varAny.options && Array.isArray(varAny.options)) {
								this.log(
									s.indent(
										c.enum(
											`Enum: ${varAny.options.map((o: any) => (typeof o === "object" ? o.value : o)).join(", ")}`,
										),
										6,
									),
								);
							}

							if (varAny.suggestion) {
								this.log(s.indent(c.subtle(`Suggestion: ${varAny.suggestion}`), 6));
							}
						}
					}
				}
			}
			this.log("");
		} catch (error) {
			this.error(
				`Failed to get cookbook info: ${error instanceof Error ? error.message : String(error)}`,
			);
		}
	}

	/**
	 * Display available cookbooks grouped by kit when a cookbook is not found
	 */
	private async suggestAvailableCookbooks(generators: any[]): Promise<void> {
		// Collect all cookbooks grouped by kit
		const cookbooksByKit = new Map<string, Array<{ name: string; description?: string }>>();

		for (const generator of generators) {
			if (!generator.cookbooks || generator.cookbooks.length === 0) continue;

			const kitCookbooks: Array<{ name: string; description?: string }> = [];

			// Try to get cookbook details
			try {
				const { parseKitFile, discoverCookbooksInKit } = await import("@hypercli/core");

				const kitYmlPath = path.join(generator.path, "kit.yml");
				const parsedKit = await parseKitFile(kitYmlPath);

				if (parsedKit.isValid && parsedKit.config.cookbooks) {
					const cookbooks = await discoverCookbooksInKit(
						generator.path,
						parsedKit.config.cookbooks,
					);

					for (const [name, cookbook] of cookbooks) {
						kitCookbooks.push({
							name,
							description: cookbook.config.description,
						});
					}
				}
			} catch {
				// Fallback to just names if we can't load details
				for (const cookbookName of generator.cookbooks) {
					kitCookbooks.push({ name: cookbookName });
				}
			}

			if (kitCookbooks.length > 0) {
				cookbooksByKit.set(generator.name, kitCookbooks);
			}
		}

		if (cookbooksByKit.size === 0) {
			this.log(c.warning("No cookbooks found in any installed kits."));
			this.log(s.hint("\nInstall a kit with: hypergen kit install <kit>"));
			return;
		}

		this.log(c.title("Available cookbooks:"));
		this.log(s.hr());
		this.log("");

		for (const [kitName, cookbooks] of cookbooksByKit) {
			this.log(c.heading(`${kitName}:`));

			for (const cookbook of cookbooks) {
				const name = c.cookbook(`  ${cookbook.name}`);
				if (cookbook.description) {
					this.log(`${name} ${c.subtle(`— ${cookbook.description}`)}`);
				} else {
					this.log(name);
				}
			}
			this.log("");
		}

		this.log(s.hint("Run `hypergen cookbook info <cookbook>` for more details."));
	}
}
