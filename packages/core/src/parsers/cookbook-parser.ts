/**
 * Cookbook Parser
 *
 * Parses and validates cookbook.yml files and discovers cookbooks within a kit.
 * A cookbook groups related recipes (e.g., "crud" groups create/read/update/delete).
 */

import fs from "node:fs";
import path from "node:path";
import createDebug from "debug";
import { glob } from "glob";
import yaml from "js-yaml";
import { loadHelpers } from "#/config/load-helpers";
import type { CookbookConfig } from "#/types/kit";

const debug = createDebug("hypergen:config:cookbook-parser");

export interface ParsedCookbook {
	config: CookbookConfig;
	filePath: string;
	dirPath: string;
	isValid: boolean;
	errors: string[];
	warnings: string[];
	loadedHelpers?: Record<string, Function>;
}

/**
 * Parse a cookbook.yml file and return validated configuration
 */
export async function parseCookbookFile(filePath: string): Promise<ParsedCookbook> {
	const result: ParsedCookbook = {
		config: { name: "" },
		filePath,
		dirPath: path.dirname(filePath),
		isValid: false,
		errors: [],
		warnings: [],
	};

	try {
		if (!fs.existsSync(filePath)) {
			result.errors.push(`Cookbook file not found: ${filePath}`);
			return result;
		}

		const content = fs.readFileSync(filePath, "utf-8");
		const parsed = yaml.load(content) as any;

		if (!parsed || typeof parsed !== "object") {
			result.errors.push("Invalid YAML format or empty file");
			return result;
		}

		result.config = validateCookbookConfig(parsed, result.errors, result.warnings);
		result.isValid = result.errors.length === 0;

		// Load helpers if configured (returned in result, not registered)
		if (result.isValid && result.config.helpers) {
			try {
				result.loadedHelpers = await loadHelpers(result.config.helpers, result.dirPath);
			} catch (error) {
				result.warnings.push(
					`Failed to load helpers: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}

		return result;
	} catch (error: any) {
		result.errors.push(`Failed to parse cookbook file: ${error.message}`);
		return result;
	}
}

/**
 * Discover all cookbooks within a kit directory using its cookbook glob patterns.
 */
export async function discoverCookbooksInKit(
	kitPath: string,
	cookbookGlobs: string[],
): Promise<Map<string, ParsedCookbook>> {
	const cookbooks = new Map<string, ParsedCookbook>();

	for (const pattern of cookbookGlobs) {
		const matches = await glob(pattern, { cwd: kitPath, absolute: true });

		for (const match of matches) {
			const stat = fs.statSync(match);
			let cookbookYml: string;

			if (stat.isFile() && path.basename(match) === "cookbook.yml") {
				cookbookYml = match;
			} else if (stat.isDirectory()) {
				cookbookYml = path.join(match, "cookbook.yml");
				if (!fs.existsSync(cookbookYml)) {
					debug("Directory has no cookbook.yml, skipping: %s", match);
					continue;
				}
			} else {
				continue;
			}

			const parsed = await parseCookbookFile(cookbookYml);
			if (parsed.isValid) {
				cookbooks.set(parsed.config.name, parsed);
				debug("Discovered cookbook: %s -> %s", parsed.config.name, cookbookYml);
			} else {
				debug("Cookbook validation failed: %s (%s)", cookbookYml, parsed.errors.join(", "));
			}
		}
	}

	return cookbooks;
}

/**
 * Discover recipes within a cookbook directory using its recipe glob patterns.
 * Returns a map of recipe name -> recipe.yml path.
 */
export async function discoverRecipesInCookbook(
	cookbookPath: string,
	recipeGlobs: string[],
): Promise<Map<string, string>> {
	const recipes = new Map<string, string>();

	for (const pattern of recipeGlobs) {
		const matches = await glob(pattern, { cwd: cookbookPath, absolute: true });

		for (const match of matches) {
			const stat = fs.statSync(match);
			let recipeYml: string;
			let recipeName: string;

			if (stat.isFile() && path.basename(match) === "recipe.yml") {
				recipeYml = match;
				recipeName = path.basename(path.dirname(match));
			} else if (stat.isDirectory()) {
				recipeYml = path.join(match, "recipe.yml");
				if (!fs.existsSync(recipeYml)) {
					continue;
				}
				recipeName = path.basename(match);
			} else {
				continue;
			}

			recipes.set(recipeName, recipeYml);
			debug("Discovered recipe: %s -> %s", recipeName, recipeYml);
		}
	}

	return recipes;
}

// -- Validation helpers --

function validateCookbookConfig(
	parsed: any,
	errors: string[],
	_warnings: string[],
): CookbookConfig {
	const config: CookbookConfig = { name: "" };

	if (!parsed.name || typeof parsed.name !== "string") {
		errors.push("Cookbook name is required and must be a string");
	} else {
		config.name = parsed.name;
	}

	if (parsed.description && typeof parsed.description === "string") {
		config.description = parsed.description;
	}

	if (parsed.version && typeof parsed.version === "string") {
		config.version = parsed.version;
	}

	if (parsed.defaults && typeof parsed.defaults === "object") {
		config.defaults = {};
		if (typeof parsed.defaults.recipe === "string") {
			config.defaults.recipe = parsed.defaults.recipe;
		}
	}

	if (parsed.recipes && Array.isArray(parsed.recipes)) {
		config.recipes = parsed.recipes.filter((r: any) => typeof r === "string");
	} else {
		// Default pattern: immediate subdirectories with recipe.yml
		config.recipes = ["./*/recipe.yml"];
	}

	if (parsed.helpers && typeof parsed.helpers === "string") {
		config.helpers = parsed.helpers;
	}

	return config;
}
