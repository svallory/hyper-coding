/**
 * Dynamic Cache Manager
 *
 * Scans installed kits and builds a JSON cache of all completable
 * kit/cookbook/recipe/variable paths. The cache is invalidated when
 * the kit manifest is newer than the cache file.
 */

import fs from "node:fs";
import path from "node:path";
import {
	discoverCookbooksInKit,
	discoverKits,
	discoverRecipesInCookbook,
	getDefaultKitSearchDirs,
} from "@hypercli/core";
import createDebug from "debug";
import yaml from "js-yaml";
import type { DynamicCache, VariableCompletion } from "./types.js";

const debug = createDebug("hypercli:autocomplete:cache");

const CACHE_FILENAME = "dynamic-cache.json";

export class DynamicCacheManager {
	private readonly cachePath: string;
	private readonly manifestPath: string;

	constructor(
		private readonly cacheDir: string,
		private readonly projectRoot: string,
	) {
		this.cachePath = path.join(cacheDir, CACHE_FILENAME);
		this.manifestPath = path.join(projectRoot, ".hyper", "kits", "manifest.json");
	}

	/**
	 * Load the cache from disk. Returns null if the cache file is missing
	 * or stale (manifest.json has been modified more recently).
	 */
	load(): DynamicCache | null {
		if (!fs.existsSync(this.cachePath)) {
			debug("Cache file not found: %s", this.cachePath);
			return null;
		}

		// Staleness check: if manifest.json exists and is newer than cache, invalidate
		if (fs.existsSync(this.manifestPath)) {
			const manifestMtime = fs.statSync(this.manifestPath).mtimeMs;
			const cacheMtime = fs.statSync(this.cachePath).mtimeMs;
			if (manifestMtime > cacheMtime) {
				debug("Cache is stale (manifest newer than cache)");
				return null;
			}
		}

		try {
			const raw = fs.readFileSync(this.cachePath, "utf-8");
			const cache = JSON.parse(raw) as DynamicCache;
			debug("Loaded cache built at %s with %d kits", cache.builtAt, cache.kits.length);
			return cache;
		} catch (err) {
			debug("Failed to read/parse cache: %s", err);
			return null;
		}
	}

	/**
	 * Rebuild the cache by scanning all installed kits, their cookbooks,
	 * recipes, and recipe variables.
	 */
	async rebuild(): Promise<DynamicCache> {
		debug("Rebuilding dynamic cache for project: %s", this.projectRoot);

		const searchDirs = getDefaultKitSearchDirs(this.projectRoot);
		const kitsMap = await discoverKits(searchDirs);

		const cache: DynamicCache = {
			builtAt: new Date().toISOString(),
			kits: [],
			cookbooks: {},
			recipes: {},
			variables: {},
		};

		for (const [kitName, parsedKit] of kitsMap) {
			cache.kits.push({
				name: kitName,
				description: parsedKit.config.description,
			});
			cache.cookbooks[kitName] = [];

			const cookbookGlobs = parsedKit.config.cookbooks ?? ["./cookbooks/*/cookbook.yml"];
			const cookbooksMap = await discoverCookbooksInKit(parsedKit.dirPath, cookbookGlobs);

			for (const [cookbookName, parsedCookbook] of cookbooksMap) {
				cache.cookbooks[kitName].push({
					name: cookbookName,
					description: parsedCookbook.config.description,
				});

				const recipeKey = `${kitName}:${cookbookName}`;
				cache.recipes[recipeKey] = [];

				const recipeGlobs = parsedCookbook.config.recipes ?? ["./*/recipe.yml"];
				const recipesMap = await discoverRecipesInCookbook(parsedCookbook.dirPath, recipeGlobs);

				for (const [recipeName, recipeYmlPath] of recipesMap) {
					const vars = this.extractVariables(recipeYmlPath);
					const recipeDesc = this.extractRecipeDescription(recipeYmlPath);
					cache.recipes[recipeKey].push({
						name: recipeName,
						description: recipeDesc,
					});

					const varKey = `${kitName}:${cookbookName}:${recipeName}`;
					cache.variables[varKey] = vars;
				}
			}
		}

		// Ensure cache directory exists and write
		fs.mkdirSync(this.cacheDir, { recursive: true });
		fs.writeFileSync(this.cachePath, JSON.stringify(cache, null, 2), "utf-8");
		debug("Cache rebuilt: %d kits, written to %s", cache.kits.length, this.cachePath);

		return cache;
	}

	/**
	 * Extract the description from a recipe.yml file.
	 */
	private extractRecipeDescription(recipeYmlPath: string): string | undefined {
		try {
			const content = fs.readFileSync(recipeYmlPath, "utf-8");
			const parsed = yaml.load(content) as Record<string, unknown> | null;
			if (parsed && typeof parsed === "object" && typeof parsed.description === "string") {
				return parsed.description;
			}
		} catch {
			// Ignore parse errors — some recipe files have Jig templates in YAML
		}
		return undefined;
	}

	/**
	 * Extract variable definitions from a recipe.yml file.
	 * Reads only the `variables` section to avoid loading the full recipe engine.
	 */
	private extractVariables(recipeYmlPath: string): VariableCompletion[] {
		try {
			const content = fs.readFileSync(recipeYmlPath, "utf-8");
			const parsed = yaml.load(content) as Record<string, unknown> | null;

			if (!parsed || typeof parsed !== "object" || !parsed.variables) {
				return [];
			}

			const vars = parsed.variables as Record<string, Record<string, unknown>>;
			const completions: VariableCompletion[] = [];

			for (const [name, def] of Object.entries(vars)) {
				if (!def || typeof def !== "object") continue;

				const completion: VariableCompletion = {
					name,
					type: typeof def.type === "string" ? def.type : "string",
				};

				if (typeof def.description === "string") {
					completion.description = def.description;
				}
				if (!completion.description && typeof def.prompt === "string") {
					completion.description = def.prompt;
				}

				if (Array.isArray(def.values)) {
					completion.values = def.values.map(String);
				}

				if (typeof def.position === "number") {
					completion.position = def.position;
				}

				completions.push(completion);
			}

			return completions;
		} catch (err) {
			debug("Failed to extract variables from %s: %s", recipeYmlPath, err);
			return [];
		}
	}
}
