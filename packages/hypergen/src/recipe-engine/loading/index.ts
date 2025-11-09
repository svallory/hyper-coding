/**
 * Loading module for recipe engine
 *
 * Handles loading recipes from various sources (files, URLs, packages)
 * with caching and validation support.
 */

import createDebug from 'debug';
import type { RecipeCache } from '../caching/recipe-cache.js';
import type { RecipeConfig, RecipeSource } from '../types.js';
import { getCacheKey, normalizeSource } from '../utils/source-utils.js';
import {
	type ContentLoaderConfig,
	type SecurityConfig,
	loadRecipeContent,
} from './content-loaders.js';
import { loadDependencies } from './dependency-loader.js';
import { parseRecipeContent } from './recipe-parser.js';

const debug = createDebug('hypergen:v8:recipe:loading');

/**
 * Recipe loading configuration
 */
export interface RecipeLoadConfig {
	workingDir: string;
	security: SecurityConfig;
	cache: RecipeCache;
	defaultTimeout?: number;
}

/**
 * Recipe validation result (forward declaration to avoid circular dependency)
 */
export interface RecipeValidationResult {
	isValid: boolean;
	errors: any[];
	warnings?: any[];
	recipe: RecipeConfig;
	context?: any;
}

/**
 * Recipe load result
 */
export interface RecipeLoadResult {
	recipe: RecipeConfig;
	source: RecipeSource;
	validation: RecipeValidationResult;
	dependencies: RecipeConfig[];
}

/**
 * Validation function type (to avoid circular dependency with validation module)
 */
export type ValidateRecipeFunction = (
	recipe: RecipeConfig,
) => Promise<RecipeValidationResult>;

/**
 * Load a recipe from a source
 */
export async function loadRecipe(
	source: RecipeSource | string,
	config: RecipeLoadConfig,
	validateRecipe: ValidateRecipeFunction,
): Promise<RecipeLoadResult> {
	const normalizedSource = normalizeSource(source);
	const cacheKey = getCacheKey(normalizedSource);

	// Check cache first
	const cached = config.cache.get(cacheKey);
	if (cached) {
		debug('Recipe loaded from cache: %s', cacheKey);

		// Still need to validate for dependencies
		const validation = await validateRecipe(cached.recipe);
		return {
			recipe: cached.recipe,
			source: normalizedSource,
			validation,
			dependencies: [],
		};
	}

	debug('Loading recipe from source: %o', normalizedSource);

	// Load recipe content
	const contentLoaderConfig: ContentLoaderConfig = {
		workingDir: config.workingDir,
		security: config.security,
		defaultTimeout: config.defaultTimeout,
	};

	const content = await loadRecipeContent(
		normalizedSource,
		contentLoaderConfig,
	);

	// Parse recipe
	const recipe = await parseRecipeContent(content, normalizedSource);

	// Validate recipe
	const validation = await validateRecipe(recipe);

	// Load dependencies (passing loadRecipe to avoid circular dependency)
	const dependencies = await loadDependencies(recipe, (depSource) =>
		loadRecipe(depSource, config, validateRecipe),
	);

	// Cache result if valid
	if (validation.isValid) {
		config.cache.set(cacheKey, recipe);
	}

	debug('Recipe loaded successfully: %s', recipe.name);

	return {
		recipe,
		source: normalizedSource,
		validation,
		dependencies,
	};
}

// Re-export types and functions
export type { ContentLoaderConfig, SecurityConfig } from './content-loaders.js';
export {
	loadFileContent,
	loadUrlContent,
	loadPackageContent,
	loadRecipeContent,
} from './content-loaders.js';
export { parseRecipeContent } from './recipe-parser.js';
export { loadDependencies } from './dependency-loader.js';
