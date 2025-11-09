/**
 * Source utility functions for recipe source normalization and caching
 */

import type { RecipeSource } from '../types.js';

/**
 * Normalize a recipe source (string or object) to a RecipeSource object
 */
export function normalizeSource(source: RecipeSource | string): RecipeSource {
	if (typeof source === 'string') {
		// Auto-detect source type
		if (source.startsWith('http://') || source.startsWith('https://')) {
			return { type: 'url', url: source };
		}
		if (
			source.includes('/') ||
			source.includes('\\') ||
			source.endsWith('.yml') ||
			source.endsWith('.yaml')
		) {
			return { type: 'file', path: source };
		}
		return { type: 'package', name: source };
	}
	return source;
}

/**
 * Generate a cache key for a recipe source
 */
export function getCacheKey(source: RecipeSource): string {
	switch (source.type) {
		case 'file':
			return `file:${source.path}`;
		case 'url':
			return `url:${source.url}${source.version ? `@${source.version}` : ''}`;
		case 'package':
			return `package:${source.name}${
				source.version ? `@${source.version}` : ''
			}`;
		case 'content':
			return `content:${source.name}`;
	}
}

/**
 * Convert a recipe source to a string representation
 */
export function recipeSourceToString(source: RecipeSource): string {
	switch (source.type) {
		case 'file':
			return source.path;
		case 'url':
			return source.url;
		case 'package':
			return source.name;
		case 'content':
			return source.name;
	}
}

/**
 * Convert a dependency to a recipe source
 */
export function dependencyToSource(dependency: any): RecipeSource {
	const name = typeof dependency === 'string' ? dependency : dependency.name;
	const version =
		typeof dependency === 'object' ? dependency.version : undefined;
	const type = typeof dependency === 'object' ? dependency.type : 'npm';
	const url = typeof dependency === 'object' ? dependency.url : undefined;

	switch (type) {
		case 'github':
			return {
				type: 'url',
				url: url || `https://raw.githubusercontent.com/${name}/main/recipe.yml`,
				version,
			};

		case 'http':
			if (!url) {
				throw new Error(`HTTP dependency requires URL: ${name}`);
			}
			return { type: 'url', url, version };

		case 'local':
			return { type: 'file', path: name };

		default:
			return { type: 'package', name, version };
	}
}
