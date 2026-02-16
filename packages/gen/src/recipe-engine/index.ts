/**
 * Recipe Engine - Complete Recipe Step System
 *
 * Central export point for the entire Recipe Step System including:
 * - Recipe Engine (main orchestrator and entry point)
 * - Step Executor (orchestration engine)
 * - Tool Framework (template, action, codemod, recipe tools)
 * - Type System (comprehensive TypeScript definitions)
 * - Registry System (tool management and caching)
 */

// Main Recipe Engine
export {
	RecipeEngine,
	createRecipeEngine,
	executeRecipe,
	loadRecipe,
	validateRecipe,
	type RecipeSource,
	type RecipeExecutionOptions,
	type RecipeExecutionResult,
	type RecipeLoadResult,
} from "./recipe-engine.js";

// Step Execution Engine
export {
	StepExecutor,
	type StepExecutorConfig,
	type StepExecutionMetrics,
	type StepExecutionProgress,
} from "./step-executor.js";

// Complete Tool Framework
export * from "./tools/index.js";

// Complete Type System
export * from "./types.js";

// Export type guards from types
export {
	isTemplateStep,
	isActionStep,
	isCodeModStep,
	isRecipeStep,
	isAIStep,
	isInstallStep,
	isQueryStep,
	isPatchStep,
	isEnsureDirsStep,
	StepExecutionError,
	RecipeDependencyError,
	CircularDependencyError,
} from "./types.js";

// Recipe Engine Constants and Utilities
export const RECIPE_ENGINE_VERSION = "8.0.0";

/**
 * Supported recipe features in this version
 */
export const RECIPE_ENGINE_FEATURES = [
	"step-orchestration",
	"dependency-management",
	"parallel-execution",
	"conditional-logic",
	"error-handling",
	"progress-tracking",
	"metrics-collection",
	"tool-registry",
	"template-composition",
	"action-pipelines",
	"codemod-transformations",
	"sub-recipe-execution",
] as const;

export type RecipeEngineFeature = (typeof RECIPE_ENGINE_FEATURES)[number];

/**
 * Recipe Engine initialization configuration
 */
export interface RecipeEngineConfig {
	/** Step executor configuration */
	stepExecutor?: Partial<import("./step-executor.js").StepExecutorConfig>;

	/** Tool registry configuration */
	toolRegistry?: Parameters<typeof import("./tools/registry.js").ToolRegistry.getInstance>[0];

	/** Enable debug logging */
	enableDebugLogging?: boolean;

	/** Features to enable (all enabled by default) */
	enabledFeatures?: RecipeEngineFeature[];
}

/**
 * Initialize the Recipe Engine with all components
 *
 * This is the main entry point for setting up the complete Recipe Step System.
 * Call this once during application startup to configure all components.
 */
export function initializeRecipeEngine(config: RecipeEngineConfig = {}): {
	stepExecutor: import("./step-executor.js").StepExecutor;
	toolRegistry: import("./tools/registry.js").ToolRegistry;
	version: string;
	features: readonly RecipeEngineFeature[];
} {
	// Initialize tools framework first
	const { initializeToolsFramework } = require("./tools/index.js");
	const toolRegistry = initializeToolsFramework({
		registryConfig: config.toolRegistry,
		enableDebugLogging: config.enableDebugLogging,
	});

	// Initialize step executor
	const { StepExecutor } = require("./step-executor.js");
	const stepExecutor = new StepExecutor(toolRegistry, config.stepExecutor);

	// Enable additional debug logging if requested
	if (config.enableDebugLogging) {
		const existing = process.env.DEBUG || "";
		const recipeDebug = "hypergen:v8:recipe:*";
		process.env.DEBUG = existing ? `${existing},${recipeDebug}` : recipeDebug;
	}

	const enabledFeatures = config.enabledFeatures || [...RECIPE_ENGINE_FEATURES];

	return {
		stepExecutor,
		toolRegistry,
		version: RECIPE_ENGINE_VERSION,
		features: enabledFeatures,
	};
}

/**
 * Quick setup for common Recipe Engine use cases
 */
export const RecipeEnginePresets = {
	/**
	 * Development preset - optimized for fast feedback
	 */
	development: (): RecipeEngineConfig => ({
		stepExecutor: {
			maxConcurrency: 5,
			defaultTimeout: 15000,
			collectMetrics: true,
			enableProgressTracking: true,
			continueOnError: true,
		},
		toolRegistry: {
			maxCacheSize: 50,
			cacheTimeoutMs: 10 * 60 * 1000, // 10 minutes
			enableInstanceReuse: true,
		},
		enableDebugLogging: true,
	}),

	/**
	 * Production preset - optimized for reliability and performance
	 */
	production: (): RecipeEngineConfig => ({
		stepExecutor: {
			maxConcurrency: 20,
			defaultTimeout: 60000,
			collectMetrics: false,
			enableProgressTracking: false,
			continueOnError: false,
		},
		toolRegistry: {
			maxCacheSize: 200,
			cacheTimeoutMs: 60 * 60 * 1000, // 1 hour
			enableInstanceReuse: true,
		},
		enableDebugLogging: false,
	}),

	/**
	 * Testing preset - optimized for test isolation and debugging
	 */
	testing: (): RecipeEngineConfig => ({
		stepExecutor: {
			maxConcurrency: 1, // Sequential execution for predictable tests
			defaultTimeout: 5000,
			collectMetrics: true,
			enableProgressTracking: true,
			continueOnError: true,
		},
		toolRegistry: {
			maxCacheSize: 10,
			cacheTimeoutMs: 1 * 60 * 1000, // 1 minute
			enableInstanceReuse: false, // Fresh instances for each test
		},
		enableDebugLogging: true,
	}),

	/**
	 * High performance preset - optimized for speed
	 */
	performance: (): RecipeEngineConfig => ({
		stepExecutor: {
			maxConcurrency: 50,
			defaultTimeout: 30000,
			collectMetrics: false,
			enableProgressTracking: false,
			continueOnError: false,
		},
		toolRegistry: {
			maxCacheSize: 500,
			cacheTimeoutMs: 2 * 60 * 60 * 1000, // 2 hours
			enableInstanceReuse: true,
		},
		enableDebugLogging: false,
	}),
} as const;

/**
 * Recipe Engine health check utility
 */
export function checkRecipeEngineHealth(): {
	healthy: boolean;
	version: string;
	issues: string[];
	components: {
		stepExecutor: boolean;
		toolRegistry: boolean;
	};
	toolRegistryHealth: ReturnType<typeof import("./tools/index.js").checkRegistryHealth>;
} {
	const issues: string[] = [];
	let stepExecutorHealthy = true;
	let toolRegistryHealthy = true;

	try {
		// Check if StepExecutor can be imported
		const { StepExecutor } = require("./step-executor.js");
		if (!StepExecutor) {
			stepExecutorHealthy = false;
			issues.push("StepExecutor not available");
		}
	} catch (error) {
		stepExecutorHealthy = false;
		issues.push(
			`StepExecutor import failed: ${error instanceof Error ? error.message : String(error)}`,
		);
	}

	try {
		// Check tool registry health
		const { checkRegistryHealth } = require("./tools/index.js");
		const registryHealth = checkRegistryHealth();

		if (!registryHealth.healthy) {
			toolRegistryHealthy = false;
			issues.push(...registryHealth.issues.map((issue: string) => `Tool Registry: ${issue}`));
		}

		return {
			healthy: issues.length === 0,
			version: RECIPE_ENGINE_VERSION,
			issues,
			components: {
				stepExecutor: stepExecutorHealthy,
				toolRegistry: toolRegistryHealthy,
			},
			toolRegistryHealth: registryHealth,
		};
	} catch (error) {
		toolRegistryHealthy = false;
		issues.push(
			`Tool registry health check failed: ${error instanceof Error ? error.message : String(error)}`,
		);

		return {
			healthy: false,
			version: RECIPE_ENGINE_VERSION,
			issues,
			components: {
				stepExecutor: stepExecutorHealthy,
				toolRegistry: false,
			},
			toolRegistryHealth: {
				healthy: false,
				issues: ["Registry health check unavailable"],
				stats: {} as any,
			},
		};
	}
}

/**
 * Development utilities for Recipe Engine
 */
export const RecipeEngineDevUtils = {
	/**
	 * Create a minimal step executor for testing
	 */
	createTestStepExecutor: (
		config: Partial<import("./step-executor.js").StepExecutorConfig> = {},
	) => {
		const { StepExecutor } = require("./step-executor.js");
		return new StepExecutor(undefined, {
			maxConcurrency: 1,
			collectMetrics: true,
			enableProgressTracking: true,
			continueOnError: true,
			...config,
		});
	},

	/**
	 * Reset all Recipe Engine components for testing
	 */
	resetForTesting: () => {
		const { DevUtils } = require("./tools/index.js");
		DevUtils.resetRegistry();
	},

	/**
	 * Get comprehensive debug information
	 */
	getDebugInfo: () => {
		const health = checkRecipeEngineHealth();
		const { DevUtils } = require("./tools/index.js");
		const registryInfo = DevUtils.getRegistryDebugInfo();

		return {
			engine: {
				version: RECIPE_ENGINE_VERSION,
				features: RECIPE_ENGINE_FEATURES,
				health,
			},
			toolFramework: registryInfo,
		};
	},
} as const;
