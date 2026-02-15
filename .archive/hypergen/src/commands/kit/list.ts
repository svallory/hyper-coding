/**
 * List installed kits
 */

import { Flags } from "@oclif/core";
import { BaseCommand } from "#/lib/base-command";
import { c } from "#/lib/colors";
import { s } from "#/lib/styles";

export default class KitList extends BaseCommand<typeof KitList> {
	static override description = "List installed kits";

	static override examples = [
		"<%= config.bin %> kit list",
		"<%= config.bin %> kit list --json",
		"<%= config.bin %> kit list --verbose",
	];

	static override flags = {
		...BaseCommand.baseFlags,
		json: Flags.boolean({
			description: "Output as JSON",
			default: false,
		}),
		verbose: Flags.boolean({
			char: "v",
			description: "Show detailed information",
			default: false,
		}),
	};

	async run(): Promise<void> {
		const { flags } = await this.parse(KitList);

		try {
			// Discover installed kits
			const kits = await this.discovery.discoverAll();

			if (flags.json) {
				// Output clean JSON without deprecated fields
				const cleanKits = kits.map((kit) => {
					const { actions, ...rest } = kit;
					return rest;
				});
				this.log(JSON.stringify(cleanKits, null, 2));
				return;
			}

			if (kits.length === 0) {
				this.log(c.warning("No kits installed."));
				this.log(s.hint("\nInstall a kit with: hypergen kit install <kit>"));
				return;
			}

			// Group by source for better organization
			const grouped = this.groupBySource(kits);

			for (const [source, sourceKits] of Object.entries(grouped)) {
				if (sourceKits.length === 0) continue;

				// Print source header
				this.log(`\n${c.heading(this.formatSourceHeader(source))}`);
				this.log(s.hr());

				for (const kit of sourceKits) {
					this.printKit(kit, flags.verbose);
				}
			}

			this.log(""); // Empty line at end
		} catch (error) {
			this.error(`Failed to list kits: ${error instanceof Error ? error.message : String(error)}`);
		}
	}

	private groupBySource(kits: any[]): Record<string, any[]> {
		const grouped: Record<string, any[]> = {
			workspace: [],
			local: [],
			npm: [],
			github: [],
			git: [],
			global: [],
		};

		for (const kit of kits) {
			if (grouped[kit.source]) {
				grouped[kit.source].push(kit);
			}
		}

		return grouped;
	}

	private formatSourceHeader(source: string): string {
		const headers: Record<string, string> = {
			workspace: "📁 Workspace",
			local: "💻 Local (.hyper/kits)",
			npm: "📦 NPM Packages",
			github: "🔗 GitHub",
			git: "🌿 Git",
			global: "🌍 Global",
		};
		return headers[source] || source;
	}

	private printKit(kit: any, verbose: boolean): void {
		// Title with optional version
		const title = kit.metadata?.version
			? `${c.kit(kit.name)} ${s.version(kit.metadata.version)}`
			: c.kit(kit.name);

		this.log(`\n  ${s.keyValue("Title", title, 10)}`);

		// Description
		if (kit.metadata?.description) {
			this.log(`  ${s.keyValue("Description", kit.metadata.description, 10)}`);
		}

		// Source location
		if (verbose) {
			this.log(`  ${s.keyValue("Source location", s.path(kit.path), 10)}`);
		}

		// Cookbooks
		if (kit.cookbooks && kit.cookbooks.length > 0) {
			const cookbookList = verbose
				? kit.cookbooks.join(", ")
				: kit.cookbooks.slice(0, 5).join(", ") +
					(kit.cookbooks.length > 5 ? c.subtle(`, +${kit.cookbooks.length - 5} more`) : "");
			this.log(`  ${s.keyValue("Cookbooks", cookbookList, 10)}`);
		}

		// Recipes (direct recipes)
		if (kit.recipes && kit.recipes.length > 0) {
			const recipeList = verbose
				? kit.recipes.join(", ")
				: kit.recipes.slice(0, 5).join(", ") +
					(kit.recipes.length > 5 ? c.subtle(`, +${kit.recipes.length - 5} more`) : "");
			this.log(`  ${s.keyValue("Recipes", recipeList, 10)}`);
		}

		// Helpers
		if (verbose && kit.helpers && kit.helpers.length > 0) {
			this.log(`  ${s.keyValue("Helpers", kit.helpers.join(", "), 10)}`);
		}

		// Additional metadata in verbose mode
		if (verbose) {
			if (kit.metadata?.author) {
				this.log(`  ${s.keyValue("Author", kit.metadata.author, 10)}`);
			}
			if (kit.metadata?.license) {
				this.log(`  ${s.keyValue("License", kit.metadata.license, 10)}`);
			}
			if (kit.metadata?.keywords && kit.metadata.keywords.length > 0) {
				this.log(`  ${s.keyValue("Keywords", kit.metadata.keywords.join(", "), 10)}`);
			}
			if (kit.metadata?.tags && kit.metadata.tags.length > 0) {
				this.log(`  ${s.keyValue("Tags", kit.metadata.tags.join(", "), 10)}`);
			}
		}
	}
}
