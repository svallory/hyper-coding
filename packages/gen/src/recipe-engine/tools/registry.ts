/**
 * Tool Registry System
 *
 * Centralized registry for managing tool instances and factories.
 * Provides tool discovery, registration, and resolution capabilities.
 */

import { ErrorCode, ErrorHandler, HypergenError } from "@hypercli/core";
import { Logger } from "@hypercli/core";
import createDebug from "debug";
import type { RecipeStepUnion, ToolType } from "#/recipe-engine/types";
import type { Tool } from "./base.js";
import type { ToolFactory, ToolValidationResult } from "./base.js";

const debug = createDebug("hypergen:v8:recipe:registry");

/**
 * Tool registration metadata
 */
export interface ToolRegistration {
	/** Tool type */
	toolType: ToolType;

	/** Tool name/identifier */
	name: string;

	/** Tool factory for creating instances */
	factory: ToolFactory;

	/** Tool version */
	version?: string;

	/** Tool description */
	description?: string;

	/** Tool category for organization */
	category?: string;

	/** Tool tags for searchability */
	tags?: string[];

	/** Whether this tool is enabled */
	enabled: boolean;

	/** Registration timestamp */
	registeredAt: Date;

	/** Tool metadata */
	metadata?: Record<string, any>;
}

/**
 * Tool instance cache entry
 */
interface ToolCacheEntry {
	/** Tool instance */
	instance: Tool;

	/** Creation timestamp */
	createdAt: Date;

	/** Last access timestamp */
	lastAccessedAt: Date;

	/** Access count */
	accessCount: number;

	/** Whether the instance is currently in use */
	inUse: boolean;
}

/**
 * Tool registry statistics
 */
export interface ToolRegistryStats {
	/** Total number of registered tool types */
	totalRegistrations: number;

	/** Number of cached tool instances */
	cachedInstances: number;

	/** Number of active (in-use) tool instances */
	activeInstances: number;

	/** Registry statistics by tool type */
	byType: Record<
		ToolType,
		{
			registrations: number;
			cachedInstances: number;
			activeInstances: number;
		}
	>;

	/** Memory usage statistics */
	memory: {
		/** Estimated registry memory usage in bytes */
		registrySize: number;

		/** Estimated cache memory usage in bytes */
		cacheSize: number;
	};
}

/**
 * Tool search criteria
 */
export interface ToolSearchCriteria {
	/** Tool type filter */
	type?: ToolType;

	/** Name pattern (regex support) */
	namePattern?: string;

	/** Category filter */
	category?: string;

	/** Tag filters (all must match) */
	tags?: string[];

	/** Whether to include only enabled tools */
	enabledOnly?: boolean;

	/** Text search in description */
	description?: string;
}

/**
 * Tool resolution options
 */
export interface ToolResolutionOptions {
	/** Whether to create a new instance (default: use cached) */
	forceNew?: boolean;

	/** Tool instance options */
	instanceOptions?: Record<string, any>;

	/** Whether to validate the tool after creation */
	validate?: boolean;

	/** Cache the created instance */
	cache?: boolean;
}

/**
 * Centralized registry for managing tool instances and factories
 *
 * The ToolRegistry provides a singleton pattern for managing tool lifecycle,
 * including registration, discovery, caching, and cleanup.
 */
export class ToolRegistry {
	private static instance: ToolRegistry | null = null;

	private readonly registrations = new Map<string, ToolRegistration>();
	private readonly instanceCache = new Map<string, ToolCacheEntry>();
	private readonly logger: Logger;
	private readonly debug: ReturnType<typeof createDebug>;

	// Configuration
	private readonly maxCacheSize: number;
	private readonly cacheTimeoutMs: number;
	private readonly enableInstanceReuse: boolean;

	// Timer for cache cleanup
	private cleanupIntervalId: NodeJS.Timeout | null = null;

	private constructor(
		options: {
			maxCacheSize?: number;
			cacheTimeoutMs?: number;
			enableInstanceReuse?: boolean;
		} = {},
	) {
		this.logger = new Logger(console.log);
		this.debug = createDebug("hypergen:v8:recipe:registry");

		this.maxCacheSize = options.maxCacheSize || 100;
		this.cacheTimeoutMs = options.cacheTimeoutMs || 30 * 60 * 1000; // 30 minutes
		this.enableInstanceReuse = options.enableInstanceReuse ?? true;

		this.debug("Tool registry initialized with options: %o", {
			maxCacheSize: this.maxCacheSize,
			cacheTimeoutMs: this.cacheTimeoutMs,
			enableInstanceReuse: this.enableInstanceReuse,
		});

		// Start cache cleanup timer
		this.startCacheCleanup();
	}

	/**
	 * Get the singleton registry instance
	 */
	static getInstance(options?: {
		maxCacheSize?: number;
		cacheTimeoutMs?: number;
		enableInstanceReuse?: boolean;
	}): ToolRegistry {
		if (!ToolRegistry.instance) {
			ToolRegistry.instance = new ToolRegistry(options);
		}
		return ToolRegistry.instance;
	}

	/**
	 * Reset the singleton instance (primarily for testing)
	 */
	static reset(): void {
		if (ToolRegistry.instance) {
			ToolRegistry.instance.clearCache();
		}
		ToolRegistry.instance = null;
	}

	/**
	 * Register a tool factory
	 */
	register(
		toolType: ToolType,
		name: string,
		factory: ToolFactory,
		metadata?: Partial<ToolRegistration>,
	): void {
		const registrationKey = this.getRegistrationKey(toolType, name);

		if (this.registrations.has(registrationKey)) {
			this.debug("Overwriting existing tool registration: %s", registrationKey);
		}

		const registration: ToolRegistration = {
			toolType,
			name,
			factory,
			version: metadata?.version,
			description: metadata?.description,
			category: metadata?.category || "general",
			tags: metadata?.tags || [],
			enabled: metadata?.enabled ?? true,
			registeredAt: new Date(),
			metadata: metadata?.metadata,
		};

		// Validate factory configuration
		try {
			const validation = factory.validateConfig(metadata?.metadata || {});
			if (!validation.isValid) {
				throw ErrorHandler.createError(
					ErrorCode.VALIDATION_ERROR,
					`Tool factory validation failed: ${validation.errors.join(", ")}`,
					{ toolType, toolName: name, errors: validation.errors },
				);
			}
		} catch (error) {
			this.debug(
				"Factory validation failed for %s: %s",
				registrationKey,
				error instanceof Error ? error.message : String(error),
			);
			throw error;
		}

		this.registrations.set(registrationKey, registration);
		this.debug(
			"Tool registered: %s (%s) - %s",
			name,
			toolType,
			registration.description || "no description",
		);
	}

	/**
	 * Unregister a tool
	 */
	unregister(toolType: ToolType, name: string): boolean {
		const registrationKey = this.getRegistrationKey(toolType, name);
		const removed = this.registrations.delete(registrationKey);

		if (removed) {
			// Clean up any cached instances
			this.removeCachedInstances(toolType, name);
			this.debug("Tool unregistered: %s", registrationKey);
		}

		return removed;
	}

	/**
	 * Check if a tool is registered
	 */
	isRegistered(toolType: ToolType, name: string): boolean {
		const registrationKey = this.getRegistrationKey(toolType, name);
		return this.registrations.has(registrationKey);
	}

	/**
	 * Get tool registration information
	 */
	getRegistration(toolType: ToolType, name: string): ToolRegistration | null {
		const registrationKey = this.getRegistrationKey(toolType, name);
		return this.registrations.get(registrationKey) || null;
	}

	/**
	 * Resolve a tool instance by type and name
	 */
	async resolve(toolType: ToolType, name: string, options?: ToolResolutionOptions): Promise<Tool> {
		const registrationKey = this.getRegistrationKey(toolType, name);
		const registration = this.registrations.get(registrationKey);

		if (!registration) {
			throw ErrorHandler.createError(
				ErrorCode.ACTION_NOT_FOUND,
				`Tool not found: ${name} (${toolType})`,
				{ toolType, toolName: name },
			);
		}

		if (!registration.enabled) {
			throw ErrorHandler.createError(
				ErrorCode.ACTION_EXECUTION_FAILED,
				`Tool is disabled: ${name} (${toolType})`,
				{ toolType, toolName: name },
			);
		}

		// Check cache first (unless forced to create new)
		if (this.enableInstanceReuse && !options?.forceNew) {
			const cached = this.getCachedInstance(registrationKey);
			if (cached && !cached.inUse) {
				cached.lastAccessedAt = new Date();
				cached.accessCount++;
				cached.inUse = true;

				this.debug(
					"Resolved cached tool instance: %s (access count: %d)",
					registrationKey,
					cached.accessCount,
				);
				return cached.instance;
			}
		}

		// Create new instance
		this.debug("Creating new tool instance: %s", registrationKey);

		try {
			const instance = registration.factory.create(name, options?.instanceOptions);

			// Validate instance if requested
			if (options?.validate) {
				// Note: validation requires a step and context, which we don't have here
				// This would need to be handled at execution time
				this.debug("Tool validation skipped - requires execution context");
			}

			// Cache the instance if requested and caching is enabled
			if (this.enableInstanceReuse && (options?.cache ?? true)) {
				this.cacheInstance(registrationKey, instance);
			}

			this.debug("Tool instance created: %s", registrationKey);
			return instance;
		} catch (error) {
			this.debug(
				"Failed to create tool instance: %s - %s",
				registrationKey,
				error instanceof Error ? error.message : String(error),
			);

			if (error instanceof HypergenError) {
				throw error;
			}

			throw ErrorHandler.createError(
				ErrorCode.INTERNAL_ERROR,
				`Failed to create tool instance: ${error instanceof Error ? error.message : String(error)}`,
				{ toolType, toolName: name },
			);
		}
	}

	/**
	 * Release a tool instance (mark as not in use)
	 */
	release(toolType: ToolType, name: string, instance: Tool): void {
		const registrationKey = this.getRegistrationKey(toolType, name);
		const cached = this.instanceCache.get(registrationKey);

		if (cached && cached.instance === instance) {
			cached.inUse = false;
			cached.lastAccessedAt = new Date();
			this.debug("Tool instance released: %s", registrationKey);
		}
	}

	/**
	 * Search for tools based on criteria
	 */
	search(criteria: ToolSearchCriteria = {}): ToolRegistration[] {
		const results: ToolRegistration[] = [];

		for (const registration of this.registrations.values()) {
			if (this.matchesCriteria(registration, criteria)) {
				results.push(registration);
			}
		}

		// Sort by name for consistent results
		results.sort((a, b) => a.name.localeCompare(b.name));

		this.debug("Tool search returned %d results for criteria: %o", results.length, criteria);
		return results;
	}

	/**
	 * Get all registered tools of a specific type
	 */
	getByType(toolType: ToolType): ToolRegistration[] {
		return this.search({ type: toolType, enabledOnly: false });
	}

	/**
	 * Get all tool types with registrations
	 */
	getRegisteredTypes(): ToolType[] {
		const types = new Set<ToolType>();

		for (const registration of this.registrations.values()) {
			types.add(registration.toolType);
		}

		return Array.from(types).sort();
	}

	/**
	 * Get all categories
	 */
	getCategories(): string[] {
		const categories = new Set<string>();

		for (const registration of this.registrations.values()) {
			if (registration.category) {
				categories.add(registration.category);
			}
		}

		return Array.from(categories).sort();
	}

	/**
	 * Get registry statistics
	 */
	getStats(): ToolRegistryStats {
		const stats: ToolRegistryStats = {
			totalRegistrations: this.registrations.size,
			cachedInstances: this.instanceCache.size,
			activeInstances: 0,
			byType: {} as any,
			memory: {
				registrySize: 0,
				cacheSize: 0,
			},
		};

		// Calculate statistics by type
		for (const registration of this.registrations.values()) {
			const type = registration.toolType;
			if (!stats.byType[type]) {
				stats.byType[type] = {
					registrations: 0,
					cachedInstances: 0,
					activeInstances: 0,
				};
			}
			stats.byType[type].registrations++;
		}

		// Count cached and active instances
		for (const [key, cached] of this.instanceCache) {
			const [toolType] = key.split(":") as [ToolType, string];

			if (stats.byType[toolType]) {
				stats.byType[toolType].cachedInstances++;
				if (cached.inUse) {
					stats.byType[toolType].activeInstances++;
					stats.activeInstances++;
				}
			}
		}

		// Estimate memory usage (rough approximation)
		stats.memory.registrySize = this.registrations.size * 512; // ~512 bytes per registration
		stats.memory.cacheSize = this.instanceCache.size * 2048; // ~2KB per cached instance

		return stats;
	}

	/**
	 * Clear the instance cache
	 */
	clearCache(): void {
		this.debug("Clearing tool instance cache (%d instances)", this.instanceCache.size);

		// Clean up all cached instances
		for (const [key, cached] of this.instanceCache) {
			if (cached.instance.isInitialized() && !cached.instance.isCleanedUp()) {
				cached.instance.cleanup().catch((error) => {
					this.debug(
						"Error cleaning up cached instance %s: %s",
						key,
						error instanceof Error ? error.message : String(error),
					);
				});
			}
		}

		this.instanceCache.clear();
	}

	/**
	 * Cleanup expired cached instances
	 */
	cleanupExpiredInstances(): number {
		const now = Date.now();
		let removed = 0;

		for (const [key, cached] of this.instanceCache) {
			const age = now - cached.lastAccessedAt.getTime();

			if (!cached.inUse && age > this.cacheTimeoutMs) {
				this.debug("Cleaning up expired instance: %s (age: %dms)", key, age);

				// Clean up the tool instance
				if (cached.instance.isInitialized() && !cached.instance.isCleanedUp()) {
					cached.instance.cleanup().catch((error) => {
						this.debug(
							"Error cleaning up expired instance %s: %s",
							key,
							error instanceof Error ? error.message : String(error),
						);
					});
				}

				this.instanceCache.delete(key);
				removed++;
			}
		}

		if (removed > 0) {
			this.debug("Cleaned up %d expired tool instances", removed);
		}

		return removed;
	}

	// Private helper methods

	private getRegistrationKey(toolType: ToolType, name: string): string {
		return `${toolType}:${name}`;
	}

	private getCachedInstance(registrationKey: string): ToolCacheEntry | null {
		return this.instanceCache.get(registrationKey) || null;
	}

	private cacheInstance(registrationKey: string, instance: Tool): void {
		// Check cache size limit
		if (this.instanceCache.size >= this.maxCacheSize) {
			this.evictOldestCachedInstance();
		}

		const entry: ToolCacheEntry = {
			instance,
			createdAt: new Date(),
			lastAccessedAt: new Date(),
			accessCount: 1,
			inUse: true,
		};

		this.instanceCache.set(registrationKey, entry);
		this.debug("Tool instance cached: %s", registrationKey);
	}

	private evictOldestCachedInstance(): void {
		let oldestKey: string | null = null;
		let oldestTime = Date.now();

		// Find the oldest non-active instance
		for (const [key, cached] of this.instanceCache) {
			if (!cached.inUse && cached.lastAccessedAt.getTime() < oldestTime) {
				oldestKey = key;
				oldestTime = cached.lastAccessedAt.getTime();
			}
		}

		if (oldestKey) {
			const cached = this.instanceCache.get(oldestKey)!;

			// Clean up the evicted instance
			if (cached.instance.isInitialized() && !cached.instance.isCleanedUp()) {
				cached.instance.cleanup().catch((error) => {
					this.debug(
						"Error cleaning up evicted instance %s: %s",
						oldestKey,
						error instanceof Error ? error.message : String(error),
					);
				});
			}

			this.instanceCache.delete(oldestKey);
			this.debug("Evicted cached instance to make room: %s", oldestKey);
		}
	}

	private removeCachedInstances(toolType: ToolType, name: string): void {
		const registrationKey = this.getRegistrationKey(toolType, name);
		const cached = this.instanceCache.get(registrationKey);

		if (cached) {
			// Clean up the instance
			if (cached.instance.isInitialized() && !cached.instance.isCleanedUp()) {
				cached.instance.cleanup().catch((error) => {
					this.debug(
						"Error cleaning up removed instance %s: %s",
						registrationKey,
						error instanceof Error ? error.message : String(error),
					);
				});
			}

			this.instanceCache.delete(registrationKey);
			this.debug("Removed cached instance: %s", registrationKey);
		}
	}

	private matchesCriteria(registration: ToolRegistration, criteria: ToolSearchCriteria): boolean {
		// Type filter
		if (criteria.type && registration.toolType !== criteria.type) {
			return false;
		}

		// Enabled filter
		if (criteria.enabledOnly && !registration.enabled) {
			return false;
		}

		// Name pattern filter
		if (criteria.namePattern) {
			const regex = new RegExp(criteria.namePattern, "i");
			if (!regex.test(registration.name)) {
				return false;
			}
		}

		// Category filter
		if (criteria.category && registration.category !== criteria.category) {
			return false;
		}

		// Tags filter (all must match)
		if (criteria.tags && criteria.tags.length > 0) {
			const registrationTags = registration.tags || [];
			if (!criteria.tags.every((tag) => registrationTags.includes(tag))) {
				return false;
			}
		}

		// Description search
		if (criteria.description && registration.description) {
			const regex = new RegExp(criteria.description, "i");
			if (!regex.test(registration.description)) {
				return false;
			}
		}

		return true;
	}

	private startCacheCleanup(): void {
		// Run cleanup every 10 minutes
		this.cleanupIntervalId = setInterval(
			() => {
				this.cleanupExpiredInstances();
			},
			10 * 60 * 1000,
		);
	}

	/**
	 * Stop the cache cleanup timer
	 */
	public stopCacheCleanup(): void {
		if (this.cleanupIntervalId) {
			clearInterval(this.cleanupIntervalId);
			this.cleanupIntervalId = null;
			this.debug("Cache cleanup timer stopped");
		}
	}

	/**
	 * Clean up the registry and all its resources
	 */
	public cleanup(): void {
		this.stopCacheCleanup();

		// Clear all cached instances
		for (const [key, entry] of this.instanceCache.entries()) {
			if (entry.instance?.cleanup) {
				try {
					entry.instance.cleanup();
				} catch (error) {
					this.debug("Error cleaning up tool instance %s: %o", key, error);
				}
			}
		}

		this.instanceCache.clear();
		this.registrations.clear();

		this.debug("Tool registry cleaned up");
	}
}

/**
 * Get the global tool registry instance
 */
export function getToolRegistry(): ToolRegistry {
	return ToolRegistry.getInstance();
}

/**
 * Register a tool factory with the global registry
 */
export function registerTool(
	toolType: ToolType,
	name: string,
	factory: ToolFactory,
	metadata?: Partial<ToolRegistration>,
): void {
	const registry = getToolRegistry();
	registry.register(toolType, name, factory, metadata);
}

/**
 * Resolve a tool instance from the global registry
 */
export async function resolveTool(
	toolType: ToolType,
	name: string,
	options?: ToolResolutionOptions,
): Promise<Tool> {
	const registry = getToolRegistry();
	return await registry.resolve(toolType, name, options);
}
