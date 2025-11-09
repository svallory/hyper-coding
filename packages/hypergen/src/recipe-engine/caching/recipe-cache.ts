/**
 * Recipe cache implementation using closures for state management
 */

import createDebug from 'debug';
import type { RecipeConfig } from '../types.js';

const debug = createDebug('hypergen:v8:recipe:cache');

/**
 * Recipe cache entry
 */
export interface RecipeCacheEntry {
	recipe: RecipeConfig;
	timestamp: number;
}

/**
 * Recipe cache configuration
 */
export interface RecipeCacheConfig {
	enabled: boolean;
	ttl: number;
	directory?: string;
	cleanupIntervalMs?: number;
}

/**
 * Recipe cache interface
 */
export interface RecipeCache {
	get(key: string): RecipeCacheEntry | undefined;
	set(key: string, recipe: RecipeConfig): void;
	delete(key: string): void;
	clear(): void;
	size(): number;
	cleanup(): void;
	destroy(): void;
}

/**
 * Create a recipe cache instance with closure-based state management
 */
export function createRecipeCache(config: RecipeCacheConfig): RecipeCache {
	const cache = new Map<string, RecipeCacheEntry>();
	let cleanupTimer: NodeJS.Timeout | undefined;

	// Start cleanup timer if enabled and interval specified
	if (config.enabled && config.cleanupIntervalMs) {
		cleanupTimer = setInterval(() => {
			const now = Date.now();
			const keysToDelete: string[] = [];

			for (const [key, entry] of cache) {
				if (now - entry.timestamp > config.ttl) {
					keysToDelete.push(key);
				}
			}

			for (const key of keysToDelete) {
				cache.delete(key);
			}

			if (keysToDelete.length > 0) {
				debug('Cleaned up %d expired cache entries', keysToDelete.length);
			}
		}, config.cleanupIntervalMs);

		// Prevent timer from keeping process alive
		cleanupTimer.unref();
	}

	return {
		get(key: string): RecipeCacheEntry | undefined {
			if (!config.enabled) return undefined;

			const entry = cache.get(key);
			if (!entry) return undefined;

			// Check TTL
			if (Date.now() - entry.timestamp > config.ttl) {
				cache.delete(key);
				return undefined;
			}

			return entry;
		},

		set(key: string, recipe: RecipeConfig): void {
			if (!config.enabled) return;

			cache.set(key, {
				recipe,
				timestamp: Date.now(),
			});
		},

		delete(key: string): void {
			cache.delete(key);
		},

		clear(): void {
			cache.clear();
		},

		size(): number {
			return cache.size;
		},

		cleanup(): void {
			const now = Date.now();
			const keysToDelete: string[] = [];

			for (const [key, entry] of cache) {
				if (now - entry.timestamp > config.ttl) {
					keysToDelete.push(key);
				}
			}

			for (const key of keysToDelete) {
				cache.delete(key);
			}

			if (keysToDelete.length > 0) {
				debug(
					'Manually cleaned up %d expired cache entries',
					keysToDelete.length,
				);
			}
		},

		destroy(): void {
			if (cleanupTimer) {
				clearInterval(cleanupTimer);
				cleanupTimer = undefined;
			}
			cache.clear();
			debug('Recipe cache destroyed');
		},
	};
}
