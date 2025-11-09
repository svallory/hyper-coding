/**
 * Content loaders for different recipe sources
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
	ErrorCode,
	ErrorHandler,
	HypergenError,
} from '../../errors/hypergen-errors.js';
import type { RecipeSource } from '../types.js';
import { recipeSourceToString } from '../utils/source-utils.js';

/**
 * Security configuration for loading recipes
 */
export interface SecurityConfig {
	allowExternalSources: boolean;
	trustedSources: string[];
	validateSignatures?: boolean;
}

/**
 * Configuration for content loaders
 */
export interface ContentLoaderConfig {
	workingDir: string;
	security: SecurityConfig;
	defaultTimeout?: number;
}

/**
 * Load content from a file
 */
export async function loadFileContent(
	filePath: string,
	config: ContentLoaderConfig,
): Promise<string> {
	try {
		const fullPath = path.resolve(config.workingDir, filePath);

		if (!fs.existsSync(fullPath)) {
			throw ErrorHandler.createError(
				ErrorCode.ACTION_NOT_FOUND,
				`Recipe file not found: ${fullPath}`,
			);
		}

		return fs.readFileSync(fullPath, 'utf8');
	} catch (error) {
		if (error instanceof HypergenError) {
			throw error;
		}

		throw ErrorHandler.createError(
			ErrorCode.INTERNAL_ERROR,
			`Failed to load recipe file: ${
				error instanceof Error ? error.message : String(error)
			}`,
			{ filePath },
		);
	}
}

/**
 * Load content from a URL
 */
export async function loadUrlContent(
	url: string,
	config: ContentLoaderConfig,
): Promise<string> {
	if (!config.security.allowExternalSources) {
		throw ErrorHandler.createError(
			ErrorCode.ACTION_EXECUTION_FAILED,
			'External recipe sources are not allowed by security policy',
			{ url },
		);
	}

	// Check if URL is trusted
	const isTrusted =
		config.security.trustedSources.length === 0 ||
		config.security.trustedSources.some((trusted) => url.startsWith(trusted));

	if (!isTrusted) {
		throw ErrorHandler.createError(
			ErrorCode.ACTION_EXECUTION_FAILED,
			`Untrusted recipe source: ${url}`,
		);
	}

	try {
		// Use dynamic import for fetch to support Node.js environments
		const fetch = await import('node-fetch')
			.then((m) => m.default)
			.catch(() => {
				throw new Error('node-fetch is required for URL sources');
			});

		const response = await fetch(url, {
			timeout: config.defaultTimeout || 120000,
			headers: {
				'User-Agent': 'Hypergen-V8-RecipeEngine/8.0.0',
			},
		});

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`);
		}

		return await response.text();
	} catch (error) {
		throw ErrorHandler.createError(
			ErrorCode.INTERNAL_ERROR,
			`Failed to load recipe from URL: ${
				error instanceof Error ? error.message : String(error)
			}`,
			{ url },
		);
	}
}

/**
 * Load content from a package
 */
export async function loadPackageContent(
	packageName: string,
	version: string | undefined,
	config: ContentLoaderConfig,
): Promise<string> {
	// For now, treat packages as npm packages with recipe.yml in root
	// In a full implementation, this would use npm/yarn APIs
	const packagePath = version
		? `node_modules/${packageName}@${version}/recipe.yml`
		: `node_modules/${packageName}/recipe.yml`;

	return loadFileContent(packagePath, config);
}

/**
 * Load recipe content from a source
 */
export async function loadRecipeContent(
	source: RecipeSource,
	config: ContentLoaderConfig,
): Promise<string> {
	switch (source.type) {
		case 'file':
			return loadFileContent(source.path, config);

		case 'url':
			return loadUrlContent(source.url, config);

		case 'package':
			return loadPackageContent(source.name, source.version, config);

		case 'content':
			return source.content;

		default:
			throw ErrorHandler.createError(
				ErrorCode.VALIDATION_ERROR,
				`Unsupported source type: ${(source as any).type}`,
			);
	}
}
