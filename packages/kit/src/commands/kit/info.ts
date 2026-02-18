/**
 * Show detailed information about a kit
 */

import { readFileSync } from "node:fs";
import { truncateDescription } from "@hypercli/core";
import { c, msg, tree as renderTree, s } from "@hypercli/ui";
import type { TreeNode } from "@hypercli/ui";
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
		this.log(s.title("Kit", kit.manifest.name));
		this.log(s.hr());

		// Key-value metadata
		if (version) this.log(s.keyValue("Version", c.version(version), 2));
		if (config?.description) this.log(s.keyValue("Description", config.description, 2));
		if (config?.author) this.log(s.keyValue("Author", config.author, 2));

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

		// Tree of cookbooks → recipes
		if (kit.cookbooks.length > 0) {
			this.log("");
			this.log(s.header("Cookbooks", kit.cookbooks.length));

			const treeRoot: TreeNode = {
				label: c.kit(kit.manifest.name),
				children: kit.cookbooks.map((cb) => ({
					label: c.cookbook(cb.name),
					children: flags.recipes
						? cb.recipes.map((r) => {
								let label = c.recipe(r.name);
								// Load recipe description if --recipes flag
								try {
									const content = readFileSync(r.path, "utf-8");
									const match = content.match(/^description:\s*["']?(.+?)["']?\s*$/m);
									if (match?.[1]) {
										label += c.muted(` — ${truncateDescription(match[1])}`);
									}
								} catch {
									// ignore
								}
								return { label };
							})
						: cb.recipes.map((r) => ({ label: c.recipe(r.name) })),
				})),
			};

			this.log(renderTree(treeRoot, { showCounts: true }));
		} else {
			this.log("");
			this.log(c.muted("  No cookbooks found."));
		}

		this.log("");
	}
}
