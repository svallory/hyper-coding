/**
 * Show detailed information about a kit
 */

import { c, indent, markdown, msg, s, table } from "@hypercli/ui";
import { Args } from "@oclif/core";
import { BaseCommand } from "#base-command";
import type { KitTree } from "#base-command";
import { infoFlags } from "#lib/flags";
import { getKitFromManifest } from "#manifest";

export default class KitInfo extends BaseCommand<typeof KitInfo> {
	static override description = "Show detailed information about a kit";

	static override examples = [
		"<%= config.bin %> kit info starlight",
		"<%= config.bin %> kit info starlight --variables",
		"<%= config.bin %> kit info starlight --json",
	];

	static override flags = {
		...BaseCommand.baseFlags,
		...infoFlags,
	};

	static override args = {
		kit: Args.string({
			description: "Kit name",
			required: true,
		}),
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(KitInfo);
		await this.resolveEffectiveCwd(flags);

		const projectRoot = flags.cwd;
		const kitName = args.kit;

		// Verify kit exists
		const entry = getKitFromManifest(projectRoot, kitName);
		if (!entry) {
			this.log(msg.error(`Kit not found: ${kitName}`));
			this.log(`\n  Run ${c.command("hyper kit list")} to see installed kits.\n`);
			this.exit(1);
		}

		// Discover full kit tree
		const kits = await this.discoverKitTree(projectRoot);
		const kit = kits.find((k) => k.manifest.name === kitName);

		if (!kit) {
			this.log(msg.error(`Kit not found: ${kitName}`));
			this.exit(1);
			return;
		}

		if (flags.json) {
			this.log(
				JSON.stringify(
					{
						name: kit.manifest.name,
						version: kit.config?.version ?? kit.manifest.version,
						description: kit.config?.description,
						source: kit.manifest.source,
						type: kit.manifest.type,
						installedAt: kit.manifest.installedAt,
						cookbooks: kit.cookbooks.map((cb) => ({
							name: cb.name,
							description: cb.config?.description,
							recipes: cb.recipes.map((r) => r.name),
						})),
					},
					null,
					2,
				),
			);
			return;
		}

		this.displayKitInfo(kit, flags);
	}

	private displayKitInfo(kit: KitTree, flags: Record<string, any>): void {
		const config = kit.config;
		const version = config?.version ?? kit.manifest.version;

		this.log("");
		this.log(markdown(`# Kit: ${kit.manifest.name}`));

		// Key-value metadata
		if (version) this.log(s.keyValue("version", c.version(version), 2));
		if (config?.author) this.log(s.keyValue("author", config.author, 2));
		if (config?.description) {
			this.log("");
			this.log(indent(c.muted(config.description), 2));
		}

		// Source info (additive flag)
		if (flags.source) {
			this.log("");
			this.log(s.header("Source"));
			this.log(s.keyValue("  Type", kit.manifest.type));
			this.log(s.keyValue("  Source", kit.manifest.source));
			this.log(s.keyValue("  Path", s.path(kit.path)));
			this.log(s.keyValue("  Installed", kit.manifest.installedAt));
			if (kit.manifest.commit) this.log(s.keyValue("  Commit", kit.manifest.commit));
			if (kit.manifest.branch) this.log(s.keyValue("  Branch", kit.manifest.branch));
			if (kit.manifest.tag) this.log(s.keyValue("  Tag", kit.manifest.tag));
		}

		// Variables (additive flag)
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

		// Cookbooks table (same format as kit list)
		if (kit.cookbooks.length > 0) {
			this.log("");
			this.log(s.header("Cookbooks", kit.cookbooks.length));
			this.log("");

			const tbl = table({
				columns: [
					{ key: "cookbook", header: "Cookbook" },
					{ key: "recipes", header: "Recipes" },
				],
				data: kit.cookbooks.map((cb) => ({
					cookbook: c.cookbook(cb.name),
					recipes: cb.recipes.map((r) => c.recipe(r.name)).join(c.muted(", ")),
				})),
				variant: "borderless",
			});
			this.log(indent(tbl, 2));
		} else {
			this.log("");
			this.log(c.muted("  No cookbooks found."));
		}

		this.log("");
	}
}
