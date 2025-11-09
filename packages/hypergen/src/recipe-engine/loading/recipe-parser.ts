/**
 * Recipe parser for converting YAML content to RecipeConfig
 */

import * as yaml from 'js-yaml';
import { ErrorCode, ErrorHandler } from '../../errors/hypergen-errors.js';
import type { RecipeConfig, RecipeSource } from '../types.js';
import { recipeSourceToString } from '../utils/source-utils.js';

/**
 * Parse recipe content from YAML string to RecipeConfig
 */
export async function parseRecipeContent(
	content: string,
	source: RecipeSource,
): Promise<RecipeConfig> {
	try {
		const parsed = yaml.load(content) as any;

		if (!parsed || typeof parsed !== 'object') {
			throw new Error('Invalid YAML format or empty content');
		}

		// Convert from template.yml format if needed
		const recipe: RecipeConfig = {
			name: parsed.name || '', // Don't provide default to trigger validation
			description: parsed.description,
			version: parsed.version || '1.0.0',
			author: parsed.author,
			category: parsed.category || 'general',
			tags: parsed.tags || [],
			variables: parsed.variables || {},
			steps: parsed.steps || [],
			examples: parsed.examples || [],
			dependencies: parsed.dependencies || [],
			outputs: parsed.outputs || [],
			engines: parsed.engines,
			hooks: parsed.hooks,
			settings: parsed.settings,
			composition: parsed.composition,
		};

		return recipe;
	} catch (error) {
		throw ErrorHandler.createError(
			ErrorCode.VALIDATION_ERROR,
			`Failed to parse recipe content: ${
				error instanceof Error ? error.message : String(error)
			}`,
			{ source: recipeSourceToString(source) },
		);
	}
}
