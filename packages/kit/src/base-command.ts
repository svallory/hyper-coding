/**
 * Base command class for @hypercli/kit commands
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { findHyperConfigDir } from "@hypercli/core";
import { findProjectRoot } from "@hypercli/core";
import { Command, Flags, type Interfaces } from "@oclif/core";
import type { KitManifestEntry } from "#manifest";

export type BaseFlags<T extends typeof Command> = Interfaces.InferredFlags<
	(typeof BaseCommand)["baseFlags"] & T["flags"]
>;
export type BaseArgs<T extends typeof Command> = Interfaces.InferredArgs<T["args"]>;

export interface RecipeEntry {
	name: string;
	path: string;
}

export interface CookbookTree {
	name: string;
	path: string;
	config: any;
	recipes: RecipeEntry[];
}

export interface KitTree {
	manifest: KitManifestEntry;
	config: any;
	path: string;
	cookbooks: CookbookTree[];
}

/**
 * Abstract base command that all kit management commands extend
 */
export abstract class BaseCommand<T extends typeof Command> extends Command {
	static override baseFlags = {
		cwd: Flags.directory({
			description: "Working directory",
			default: process.cwd(),
		}),
		debug: Flags.boolean({
			char: "d",
			description: "Enable debug output",
			default: false,
			env: "DEBUG",
		}),
	};

	protected flags!: BaseFlags<T>;
	protected args!: BaseArgs<T>;

	/**
	 * Resolve effective CWD for the parsed flags.
	 *
	 * Priority:
	 * 1. Explicit --cwd flag (user passed it) — use as-is
	 * 2. Nearest hyper.config.* walking up from process.cwd()
	 * 3. Monorepo/workspace root
	 * 4. process.cwd() (unchanged default)
	 *
	 * Call this after this.parse() to update flags.cwd.
	 */
	protected async resolveEffectiveCwd(flags: { cwd: string }): Promise<void> {
		// If the user explicitly passed --cwd, respect it
		if (flags.cwd !== process.cwd()) return;

		// 1. Try to find a hyper config file walking upward
		const configDir = await findHyperConfigDir(process.cwd());
		if (configDir) {
			flags.cwd = configDir;
			return;
		}

		// 2. Fall back to monorepo root detection
		const projectInfo = findProjectRoot(process.cwd());
		flags.cwd = projectInfo.workspaceRoot;
	}

	/**
	 * Detect the package manager being used in the project
	 */
	protected detectPackageManager(): "bun" | "pnpm" | "yarn" | "npm" {
		const cwd = (this.flags as any).cwd || process.cwd();

		// Check for lockfiles (in order of preference)
		if (existsSync(join(cwd, "bun.lockb"))) {
			return "bun";
		}
		if (existsSync(join(cwd, "pnpm-lock.yaml"))) {
			return "pnpm";
		}
		if (existsSync(join(cwd, "yarn.lock"))) {
			return "yarn";
		}

		// Check package.json for packageManager field
		const packageJsonPath = join(cwd, "package.json");
		if (existsSync(packageJsonPath)) {
			try {
				const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
				if (packageJson.packageManager) {
					const pm = packageJson.packageManager.split("@")[0];
					if (pm === "bun" || pm === "pnpm" || pm === "yarn" || pm === "npm") {
						return pm;
					}
				}
			} catch {
				// Ignore parse errors
			}
		}

		// Default to npm
		return "npm";
	}

	/**
	 * Discover all installed kits with their cookbook and recipe trees.
	 * Uses core parsers directly — no GeneratorDiscovery dependency.
	 */
	protected async discoverKitTree(projectRoot: string): Promise<KitTree[]> {
		const { existsSync } = await import("node:fs");
		const { join } = await import("node:path");
		const { parseKitFile, discoverCookbooksInKit, discoverRecipesInCookbook } = await import(
			"@hypercli/core"
		);
		const { listInstalledKits } = await import("#manifest");

		const entries = listInstalledKits(projectRoot);
		const kitsDir = join(projectRoot, ".hyper", "kits");
		const result: KitTree[] = [];

		for (const entry of entries) {
			const kitDir = join(kitsDir, entry.name);
			const kitYml = join(kitDir, "kit.yml");
			let config: any = undefined;
			const cookbooks: CookbookTree[] = [];

			if (existsSync(kitYml)) {
				const parsed = await parseKitFile(kitYml);
				if (parsed.isValid) {
					config = parsed.config;
					if (config.cookbooks?.length) {
						const discovered = await discoverCookbooksInKit(kitDir, config.cookbooks);
						for (const [cbName, cb] of discovered) {
							const recipeGlobs = cb.config.recipes ?? ["./*/recipe.yml"];
							const recipes = await discoverRecipesInCookbook(cb.dirPath, recipeGlobs);
							const recipeList: RecipeEntry[] = [];
							for (const [rName, rPath] of recipes) {
								recipeList.push({ name: rName, path: rPath });
							}
							cookbooks.push({
								name: cbName,
								path: cb.dirPath,
								config: cb.config,
								recipes: recipeList,
							});
						}
					}
				}
			}

			result.push({ manifest: entry, config, path: kitDir, cookbooks });
		}

		return result;
	}
}
