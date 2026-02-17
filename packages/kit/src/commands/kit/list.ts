/**
 * List installed kits
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import {
	type ParsedKit,
	discoverCookbooksInKit,
	discoverRecipesInCookbook,
	parseKitFile,
} from "@hypercli/core";
import { c, indent, msg, s, table } from "@hypercli/ui";
import { Flags } from "@oclif/core";
import { BaseCommand } from "#base-command";
import { type KitManifestEntry, listInstalledKits } from "#manifest";

interface CookbookInfo {
	name: string;
	recipes: string[];
}

interface KitInfo {
	manifest: KitManifestEntry;
	parsed?: ParsedKit;
	cookbooks: CookbookInfo[];
}

export default class KitList extends BaseCommand<typeof KitList> {
	static override description = "List installed kits";

	static override examples = ["<%= config.bin %> kit list", "<%= config.bin %> kit list --json"];

	static override flags = {
		...BaseCommand.baseFlags,
		json: Flags.boolean({
			description: "Output as JSON",
			default: false,
		}),
		verbose: Flags.boolean({
			description: "Show detailed information for each kit",
			default: false,
		}),
	};

	async run(): Promise<void> {
		const { flags } = await this.parse(KitList);
		await this.resolveEffectiveCwd(flags);

		const projectRoot = flags.cwd;
		const entries = listInstalledKits(projectRoot);

		if (entries.length === 0) {
			this.log(msg.info("No kits installed."));
			this.log(`\n  Run ${c.command("hyper kit install <source>")} to add one.\n`);
			return;
		}

		// Load kit.yml for each kit and discover cookbooks with their recipes
		const kitsDir = join(projectRoot, ".hyper", "kits");
		const kits: KitInfo[] = await Promise.all(
			entries.map(async (entry) => {
				const kitDir = join(kitsDir, entry.name);
				const kitYml = join(kitDir, "kit.yml");
				let parsed: ParsedKit | undefined;
				const cookbooks: CookbookInfo[] = [];

				if (existsSync(kitYml)) {
					parsed = await parseKitFile(kitYml);
					if (parsed.isValid) {
						const config = parsed.config;

						if (config.cookbooks?.length) {
							const discovered = await discoverCookbooksInKit(kitDir, config.cookbooks);

							for (const [name, cb] of discovered) {
								const recipeGlobs = cb.config.recipes ?? ["./*/recipe.yml"];
								const recipes = await discoverRecipesInCookbook(cb.dirPath, recipeGlobs);
								cookbooks.push({ name, recipes: [...recipes.keys()] });
							}
						}
					}
				}

				return { manifest: entry, parsed, cookbooks };
			}),
		);

		if (flags.json) {
			this.log(
				JSON.stringify(
					kits.map((k) => ({
						...k.manifest,
						...k.parsed?.config,
						cookbooks: k.cookbooks,
					})),
					null,
					2,
				),
			);
			return;
		}

		this.log("");
		this.log(s.header("Installed Kits", kits.length));
		this.log("");

		for (const kit of kits) {
			const { manifest, parsed, cookbooks } = kit;
			const config = parsed?.config;
			const version = config?.version ?? manifest.version;
			const name = c.kit(manifest.name);
			const ver = version ? ` ${c.version(version)}` : "";

			this.log(s.listItem(`${name}${ver}`));

			const description = config?.description?.trim() ?? "";
			if (description) {
				this.log("");
				this.log(indent(c.muted(description), 2));
			}

			if (cookbooks.length > 0) {
				this.log("");
				const tbl = table({
					columns: [
						{ key: "cookbook", header: "Cookbook" },
						{ key: "recipes", header: "Recipes" },
					],
					data: cookbooks.map((cb) => ({
						cookbook: c.cookbook(cb.name),
						recipes: cb.recipes.map((r) => c.recipe(r)).join(c.muted(", ")),
					})),
					variant: "borderless",
				});
				this.log(indent(tbl, 2));
			}

			this.log("");
		}
	}
}
