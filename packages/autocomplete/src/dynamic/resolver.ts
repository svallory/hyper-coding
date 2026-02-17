/**
 * Completion Resolver
 *
 * Parses the words typed so far, determines the completion context
 * (kit / cookbook / recipe / variable), and returns matching completions
 * from the dynamic cache.
 */

import createDebug from "debug";
import { DynamicCacheManager } from "./cache.js";
import type { CompletionContext, CompletionEntry, DynamicCache } from "./types.js";

const debug = createDebug("hypercli:autocomplete:resolver");

export class CompletionResolver {
	private readonly cacheManager: DynamicCacheManager;
	private cachedData: DynamicCache | null = null;

	constructor(cacheDir: string, projectRoot: string) {
		this.cacheManager = new DynamicCacheManager(cacheDir, projectRoot);
	}

	/**
	 * Get the dynamic cache, loading from disk or rebuilding if stale/missing.
	 */
	async getCache(): Promise<DynamicCache> {
		if (this.cachedData) return this.cachedData;

		const loaded = this.cacheManager.load();
		if (loaded) {
			this.cachedData = loaded;
			return loaded;
		}

		debug("Cache miss — rebuilding");
		const fresh = await this.cacheManager.rebuild();
		this.cachedData = fresh;
		return fresh;
	}

	/**
	 * Parse the typed words into a CompletionContext that describes what level
	 * the user is completing at.
	 *
	 * Words should already have CLI routing prefixes stripped (e.g. "gen", "kit info").
	 * Only content-level tokens should remain: kit, cookbook, recipe, variable.
	 *
	 * @param words - Content-level tokens the user has typed so far
	 */
	parseContext(words: string[]): CompletionContext | null {
		const segments = [...words];

		if (segments.length === 0) {
			return { level: "kit", prefix: "" };
		}

		// The last word is the incomplete prefix being typed
		const prefix = segments.pop()!;

		switch (segments.length) {
			case 0:
				// Only one word typed — completing kit names
				return { level: "kit", prefix };
			case 1:
				// kitName <prefix> — completing cookbook names
				return { level: "cookbook", kit: segments[0], prefix };
			case 2:
				// kitName cookbookName <prefix> — completing recipe names
				return { level: "recipe", kit: segments[0], cookbook: segments[1], prefix };
			default:
				// kitName cookbookName recipeName <prefix> — completing variables
				return {
					level: "variable",
					kit: segments[0],
					cookbook: segments[1],
					recipe: segments[2],
					prefix,
				};
		}
	}

	/**
	 * Return matching completions for the given context.
	 */
	async complete(context: CompletionContext): Promise<string[]> {
		const cache = await this.getCache();

		switch (context.level) {
			case "kit":
				return formatEntries(filterByPrefix(cache.kits, context.prefix));

			case "cookbook": {
				const cookbooks = cache.cookbooks[context.kit];
				if (!cookbooks) return [];
				return formatEntries(filterByPrefix(cookbooks, context.prefix));
			}

			case "recipe": {
				const key = `${context.kit}:${context.cookbook}`;
				const recipes = cache.recipes[key];
				if (!recipes) return [];
				return formatEntries(filterByPrefix(recipes, context.prefix));
			}

			case "variable": {
				const key = `${context.kit}:${context.cookbook}:${context.recipe}`;
				const variables = cache.variables[key];
				if (!variables) return [];

				// Only complete flag-style variables (--name)
				if (context.prefix.startsWith("--")) {
					const flagPrefix = context.prefix.slice(2);
					return variables
						.filter((v) => v.name.toLowerCase().startsWith(flagPrefix.toLowerCase()))
						.map((v) => (v.description ? `--${v.name}\t${v.description}` : `--${v.name}`));
				}

				// If no -- prefix, return positional variable descriptions as hints
				// (most shells won't use this, but it's available)
				return [];
			}
		}
	}

	/**
	 * Return the allowed enum values for a specific flag on a recipe.
	 */
	async getEnumValues(
		kit: string,
		cookbook: string,
		recipe: string,
		flagName: string,
	): Promise<string[]> {
		const cache = await this.getCache();
		const key = `${kit}:${cookbook}:${recipe}`;
		const variables = cache.variables[key];
		if (!variables) return [];

		const variable = variables.find((v) => v.name === flagName);
		if (!variable?.values) return [];
		return variable.values;
	}

	/**
	 * Force a cache rebuild, discarding any in-memory cache.
	 */
	async rebuildCache(): Promise<void> {
		this.cachedData = null;
		await this.cacheManager.rebuild();
	}
}

/**
 * Filter entries by name prefix (case-insensitive).
 */
function filterByPrefix(items: CompletionEntry[], prefix: string): CompletionEntry[] {
	if (!prefix) return items;
	const lower = prefix.toLowerCase();
	return items.filter((item) => item.name.toLowerCase().startsWith(lower));
}

/**
 * Format entries as "name\tdescription" lines for shell consumption.
 * The tab separator is recognized by zsh _describe and bash completion.
 * Descriptions are truncated to the first sentence for readability.
 */
function formatEntries(entries: CompletionEntry[]): string[] {
	return entries.map((e) => {
		if (!e.description) return e.name;
		const firstSentence = e.description.split(/\.(?:\s|$)|\n/)[0].trim();
		return firstSentence ? `${e.name}\t${firstSentence}` : e.name;
	});
}
