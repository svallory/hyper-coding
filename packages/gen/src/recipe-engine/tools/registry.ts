/**
 * Tool Registry System
 *
 * Centralized registry for managing tool factories and creating tool instances.
 * Tools are created fresh for each use — no instance caching, since this is a
 * short-lived CLI process where cache overhead exceeds any reuse benefit.
 */

import { ErrorCode, ErrorHandler, HypergenError } from "@hypercli/core";
import createDebug from "debug";
import type { ToolType } from "#recipe-engine/types";
import type { Tool } from "./base.js";
import type { ToolFactory } from "./base.js";

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
 * Tool registry statistics
 */
export interface ToolRegistryStats {
	/** Total number of registered tool types */
	totalRegistrations: number;

	/** Registry statistics by tool type */
	byType: Record<
		ToolType,
		{
			registrations: number;
		}
	>;
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
	/** Tool instance options */
	instanceOptions?: Record<string, any>;

	/** Whether to validate the tool after creation */
	validate?: boolean;
}

/**
 * Centralized registry for managing tool factories
 *
 * The ToolRegistry provides a singleton pattern for tool registration,
 * discovery, and instance creation.
 */
export class ToolRegistry {
	private static instance: ToolRegistry | null = null;

	private readonly registrations = new Map<string, ToolRegistration>();
	private readonly debug: ReturnType<typeof createDebug>;

	private constructor() {
		this.debug = createDebug("hyper:recipe:registry");
		this.debug("Tool registry initialized");
	}

	/**
	 * Get the singleton registry instance
	 */
	static getInstance(): ToolRegistry {
		if (!ToolRegistry.instance) {
			ToolRegistry.instance = new ToolRegistry();
		}
		return ToolRegistry.instance;
	}

	/**
	 * Reset the singleton instance (primarily for testing)
	 */
	static reset(): void {
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
	 * Create a tool instance by type and name
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

		this.debug("Creating tool instance: %s", registrationKey);

		try {
			const instance = registration.factory.create(name, options?.instanceOptions);

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
	 * Release a tool instance (no-op — instances are not cached)
	 */
	release(_toolType: ToolType, _name: string, _instance: Tool): void {
		// No-op: tools are created fresh each time, no cache to return to.
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
			byType: {} as any,
		};

		for (const registration of this.registrations.values()) {
			const type = registration.toolType;
			if (!stats.byType[type]) {
				stats.byType[type] = { registrations: 0 };
			}
			stats.byType[type].registrations++;
		}

		return stats;
	}

	// Private helper methods

	private getRegistrationKey(toolType: ToolType, name: string): string {
		return `${toolType}:${name}`;
	}

	private matchesCriteria(registration: ToolRegistration, criteria: ToolSearchCriteria): boolean {
		if (criteria.type && registration.toolType !== criteria.type) {
			return false;
		}

		if (criteria.enabledOnly && !registration.enabled) {
			return false;
		}

		if (criteria.namePattern) {
			const regex = new RegExp(criteria.namePattern, "i");
			if (!regex.test(registration.name)) {
				return false;
			}
		}

		if (criteria.category && registration.category !== criteria.category) {
			return false;
		}

		if (criteria.tags && criteria.tags.length > 0) {
			const registrationTags = registration.tags || [];
			if (!criteria.tags.every((tag) => registrationTags.includes(tag))) {
				return false;
			}
		}

		if (criteria.description && registration.description) {
			const regex = new RegExp(criteria.description, "i");
			if (!regex.test(registration.description)) {
				return false;
			}
		}

		return true;
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
