/**
 * Dependency loader for loading recipe dependencies
 */

import createDebug from 'debug';
import type { RecipeConfig } from '../types.js';
import { RecipeDependencyError } from '../types.js';
import { dependencyToSource } from '../utils/source-utils.js';

const debug = createDebug('hypergen:v8:recipe:dependency-loader');

/**
 * Result from loading a recipe (forward declaration to avoid circular dependency)
 */
export interface RecipeLoadResult {
	recipe: RecipeConfig;
	validation: {
		isValid: boolean;
		errors: any[];
	};
}

/**
 * Function type for loading recipes (to avoid circular dependency)
 */
export type LoadRecipeFunction = (
	source: any,
	config: any,
) => Promise<RecipeLoadResult>;

/**
 * Load recipe dependencies
 */
export async function loadDependencies(
	recipe: RecipeConfig,
	loadRecipe: LoadRecipeFunction,
): Promise<RecipeConfig[]> {
	const dependencies: RecipeConfig[] = [];

	if (!recipe.dependencies) {
		return dependencies;
	}

	for (const dep of recipe.dependencies) {
		try {
			const depSource = dependencyToSource(dep);
			const depResult = await loadRecipe(depSource, {});

			if (!depResult.validation.isValid && !dep.optional) {
				throw new RecipeDependencyError(
					`Required dependency validation failed: ${dep.name}`,
					dep.name,
					dep.version,
				);
			}

			if (depResult.validation.isValid) {
				dependencies.push(depResult.recipe);
			}
		} catch (error) {
			if (dep.optional) {
				debug(
					'Optional dependency failed to load: %s - %s',
					dep.name,
					error instanceof Error ? error.message : String(error),
				);
			} else {
				throw error;
			}
		}
	}

	return dependencies;
}
