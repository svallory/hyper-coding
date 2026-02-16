/**
 * Recipe Engine - Main Orchestrator for Recipe Step System
 *
 * The RecipeEngine is the primary entry point for executing recipes in Hypergen V8.
 * It provides recipe discovery, loading, validation, variable resolution, and execution
 * coordination through the complete Recipe Step System.
 */

import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { TemplateParser, type TemplateVariable } from "@hypercli/core";
import { ErrorCode, ErrorHandler, HypergenError } from "@hypercli/core";
import { Logger } from "@hypercli/core";
import createDebug from "debug";
import yaml from "js-yaml";
import { AiCollector } from "#/ai/ai-collector";
import type { AiServiceConfig } from "#/ai/ai-config";
import { AiVariableResolver, type UnresolvedVariable } from "#/ai/ai-variable-resolver";
import { resolveTransport } from "#/ai/transports/resolve-transport";
import { performInteractivePrompting } from "#/prompts/interactive-prompts";
import { renderTemplate as jigRenderTemplate } from "#/template-engines/jig-engine";
import { StepExecutor, type StepExecutorConfig } from "./step-executor.js";
import { type ToolRegistry, getToolRegistry } from "./tools/registry.js";
import type {
	RecipeConfig,
	RecipeExecution,
	RecipeProvides,
	RecipeStepUnion,
	RecipeValidationResult,
	StepContext,
	StepExecutionOptions,
	StepResult,
} from "./types.js";
import { RecipeDependencyError, RecipeValidationError } from "./types.js";

const debug = createDebug("hypergen:v8:recipe:engine");

/**
 * Recipe source types for loading
 */
export type RecipeSource =
	| {
			type: "content";
			content: string;
			name: string;
	  }
	| {
			type: "file";
			path: string;
	  };

/**
 * Recipe execution options
 */
export interface RecipeExecutionOptions {
	/** Variables to pass to the recipe */
	variables?: Record<string, any>;

	/** Environment variables */
	environment?: Record<string, string>;

	/** Working directory for execution */
	workingDir?: string;

	/** Whether to run in dry-run mode */
	dryRun?: boolean;

	/** Whether to force overwrite existing files */
	force?: boolean;

	/** Whether to continue on step failures */
	continueOnError?: boolean;

	/** Custom step execution options */
	stepOptions?: Partial<StepExecutionOptions>;

	/** Whether to skip user prompts (use defaults/existing values) */
	skipPrompts?: boolean;

	/** Who resolves missing variables: 'me' (interactive), 'ai', 'nobody' (error) */
	askMode?: "me" | "ai" | "nobody";

	/** Don't auto-apply default values — treat all vars as unresolved */
	noDefaults?: boolean;

	/** AI config for --ask=ai mode (from hypergen.config.js) */
	aiConfig?: AiServiceConfig;

	/** Custom logger for output */
	logger?: Logger;

	/** Progress callback */
	onProgress?: (progress: {
		step: string;
		phase: string;
		percentage: number;
	}) => void;

	/** Step completion callback */
	onStepComplete?: (result: StepResult) => void;

	/** AI answers for 2-pass generation (Pass 2) */
	answers?: Record<string, any>;
}

/**
 * Recipe engine configuration
 */
export interface RecipeEngineConfig {
	/** Step executor configuration */
	stepExecutor?: Partial<StepExecutorConfig>;

	/** Tool registry configuration */
	toolRegistry?: {
		maxCacheSize?: number;
		cacheTimeoutMs?: number;
		enableInstanceReuse?: boolean;
	};

	/** Working directory for all operations */
	workingDir?: string;

	/** Default timeout for all operations */
	defaultTimeout?: number;

	/** Whether to enable debug logging */
	enableDebugLogging?: boolean;
}

/**
 * Recipe execution result
 */
export interface RecipeExecutionResult {
	/** Execution ID */
	executionId: string;

	/** Recipe that was executed */
	recipe: RecipeConfig;

	/** Overall execution status */
	success: boolean;

	/** Step execution results */
	stepResults: StepResult[];

	/** Total execution time in milliseconds */
	duration: number;

	/** Files created during execution */
	filesCreated: string[];

	/** Files modified during execution */
	filesModified: string[];

	/** Files deleted during execution */
	filesDeleted: string[];

	/** Execution errors */
	errors: string[];

	/** Execution warnings */
	warnings: string[];

	/** Final resolved variables */
	variables: Record<string, any>;

	/** Execution metadata */
	metadata: {
		startTime: Date;
		endTime: Date;
		workingDir: string;
		totalSteps: number;
		completedSteps: number;
		failedSteps: number;
		skippedSteps: number;
		/** Values collected from recipe.provides declarations */
		providedValues?: Record<string, any>;
	};
}

/**
 * Recipe loading result
 */
export interface RecipeLoadResult {
	recipe: RecipeConfig;
	source: RecipeSource;
	validation: RecipeValidationResult;
	dependencies: RecipeConfig[];
}

/**
 * Default recipe engine configuration
 */
const DEFAULT_CONFIG: Required<RecipeEngineConfig> = {
	stepExecutor: {
		maxConcurrency: 10,
		defaultTimeout: 30000,
		defaultRetries: 3,
		continueOnError: false,
		enableParallelExecution: true,
		collectMetrics: true,
		enableProgressTracking: true,
		memoryWarningThreshold: 1024,
		timeoutSafetyFactor: 1.2,
	},
	toolRegistry: {
		maxCacheSize: 100,
		cacheTimeoutMs: 30 * 60 * 1000,
		enableInstanceReuse: true,
	},
	workingDir: process.cwd(),
	defaultTimeout: 60000,
	enableDebugLogging: false,
};

/**
 * Main Recipe Engine for Hypergen V8
 *
 * The RecipeEngine provides the primary API for executing recipes. It handles:
 * - Recipe discovery and loading from various sources
 * - Recipe validation and preprocessing
 * - Variable resolution with user prompts
 * - Step orchestration through StepExecutor
 * - Result aggregation and reporting
 * - Error handling and recovery
 */
export class RecipeEngine extends EventEmitter {
	private readonly config: Required<RecipeEngineConfig>;
	private readonly logger: Logger;
	private readonly debug: ReturnType<typeof createDebug>;
	private readonly stepExecutor: StepExecutor;
	private readonly toolRegistry: ToolRegistry;

	// Execution state
	private readonly activeExecutions = new Map<string, RecipeExecution>();
	private executionCounter = 0;

	// Caching (simple in-memory, no TTL)
	private readonly recipeCache = new Map<string, RecipeConfig>();

	constructor(config: RecipeEngineConfig = {}) {
		super();

		this.config = { ...DEFAULT_CONFIG, ...config };
		this.logger = new Logger(console.log);
		this.debug = createDebug("hypergen:v8:recipe:engine");

		// Initialize tool registry
		this.toolRegistry = getToolRegistry();

		// Initialize step executor
		this.stepExecutor = new StepExecutor(this.toolRegistry, this.config.stepExecutor);

		this.debug("Recipe engine initialized with config: %o", {
			workingDir: this.config.workingDir,
		});

		// Set up debug logging if enabled
		if (this.config.enableDebugLogging) {
			const existing = process.env.DEBUG || "";
			const recipeDebug = "hypergen:v8:recipe:*";
			process.env.DEBUG = existing ? `${existing},${recipeDebug}` : recipeDebug;
		}

		// Forward step executor events
		this.stepExecutor.on("execution:started", (data) => this.emit("execution:started", data));
		this.stepExecutor.on("execution:completed", (data) => this.emit("execution:completed", data));
		this.stepExecutor.on("execution:failed", (data) => this.emit("execution:failed", data));
		this.stepExecutor.on("step:started", (data) => this.emit("step:started", data));
		this.stepExecutor.on("step:completed", (data) => this.emit("step:completed", data));
		this.stepExecutor.on("step:failed", (data) => this.emit("step:failed", data));
		this.stepExecutor.on("phase:started", (data) => this.emit("phase:started", data));
		this.stepExecutor.on("phase:completed", (data) => this.emit("phase:completed", data));
	}

	/**
	 * Execute a recipe from various sources
	 *
	 * @param source Recipe source (file path, URL, package name, or content)
	 * @param options Execution options including variables and behavior settings
	 * @returns Promise resolving to execution result
	 */
	async executeRecipe(
		source: string | RecipeSource,
		options: RecipeExecutionOptions = {},
	): Promise<RecipeExecutionResult> {
		const executionId = this.generateExecutionId();
		const startTime = Date.now();

		this.debug("Starting recipe execution [%s] from source: %o", executionId, source);
		this.emit("recipe:started", { executionId, source });

		try {
			// Normalize source
			const normalizedSource = this.normalizeSource(source);

			// Load and validate recipe
			const loadResult = await this.loadRecipe(normalizedSource);
			const { recipe, validation } = loadResult;

			if (!validation.isValid) {
				throw ErrorHandler.createError(
					ErrorCode.VALIDATION_ERROR,
					`Recipe validation failed: ${validation.errors.map((e) => e.message).join(", ")}`,
					{ executionId, errors: validation.errors.map((e) => e.message) },
				);
			}

			this.debug("Recipe loaded and validated: %s", recipe.name);

			// Determine effective ask mode (skipPrompts is legacy compat for --ask=nobody)
			const effectiveAskMode = options.askMode ?? (options.skipPrompts ? "nobody" : undefined);

			// Resolve variables with user input if needed
			const resolvedVariables = await this.resolveVariables(recipe, options.variables || {}, {
				askMode: effectiveAskMode,
				noDefaults: options.noDefaults || false,
				aiConfig: options.aiConfig,
				logger: options.logger,
			});

			this.debug("Variables resolved: %o", Object.keys(resolvedVariables));

			// Create execution context
			const context = await this.createExecutionContext(
				recipe,
				resolvedVariables,
				options,
				executionId,
				normalizedSource,
			);

			// Create step execution options
			const stepOptions: StepExecutionOptions = {
				timeout: options.stepOptions?.timeout || this.config.defaultTimeout,
				continueOnError: options.continueOnError || this.config.stepExecutor.continueOnError,
				dryRun: options.dryRun || false,
				...options.stepOptions,
			};

			// Execute steps through StepExecutor
			this.debug("Starting step execution with %d steps", recipe.steps.length);
			const stepResults = await this.stepExecutor.executeSteps(recipe.steps, context, stepOptions);

			// Aggregate results
			const result = this.aggregateResults(
				executionId,
				recipe,
				stepResults,
				resolvedVariables,
				startTime,
				context,
			);

			// Render and print onSuccess/onError messages
			await this.renderLifecycleMessage(recipe, result, resolvedVariables, options);

			this.debug("Recipe execution completed [%s] in %dms", executionId, result.duration);
			this.emit("recipe:completed", { executionId, result });

			return result;
		} catch (error) {
			const duration = Date.now() - startTime;
			const normalizedSource = this.normalizeSource(source);

			this.debug(
				"Recipe execution failed [%s]: %s",
				executionId,
				error instanceof Error ? error.message : String(error),
			);

			this.emit("recipe:failed", {
				executionId,
				error,
				duration,
				source: normalizedSource,
			});

			// Create error result
			const errorResult: RecipeExecutionResult = {
				executionId,
				recipe: {} as RecipeConfig,
				success: false,
				stepResults: [],
				duration,
				filesCreated: [],
				filesModified: [],
				filesDeleted: [],
				errors: [error instanceof Error ? error.message : String(error)],
				warnings: [],
				variables: options.variables || {},
				metadata: {
					startTime: new Date(startTime),
					endTime: new Date(),
					workingDir: options.workingDir || this.config.workingDir,
					totalSteps: 0,
					completedSteps: 0,
					failedSteps: 0,
					skippedSteps: 0,
				},
			};

			if (error instanceof HypergenError) {
				throw error;
			}

			throw ErrorHandler.createError(
				ErrorCode.INTERNAL_ERROR,
				`Recipe execution failed: ${error instanceof Error ? error.message : String(error)}`,
			);
		} finally {
			this.activeExecutions.delete(executionId);
		}
	}

	/**
	 * Load a recipe from a source without executing it
	 */
	async loadRecipe(source: string | RecipeSource): Promise<RecipeLoadResult> {
		const normalizedSource = this.normalizeSource(source);
		const cacheKey = this.getCacheKey(normalizedSource);

		// Check cache first
		const cached = this.recipeCache.get(cacheKey);
		if (cached) {
			this.debug("Recipe loaded from cache: %s", cacheKey);

			// Still need to validate for dependencies
			const validation = await this.validateRecipe(cached);
			return {
				recipe: cached,
				source: normalizedSource,
				validation,
				dependencies: [],
			};
		}

		this.debug("Loading recipe from source: %o", normalizedSource);

		// Load recipe content
		const content = await this.loadRecipeContent(normalizedSource);

		// Parse recipe
		const recipe = await this.parseRecipeContent(content, normalizedSource);

		// Validate recipe
		const validation = await this.validateRecipe(recipe);

		// Load dependencies
		const dependencies = await this.loadDependencies(recipe);

		// Cache result
		if (validation.isValid) {
			this.recipeCache.set(cacheKey, recipe);
		}

		this.debug("Recipe loaded successfully: %s", recipe.name);

		return {
			recipe,
			source: normalizedSource,
			validation,
			dependencies,
		};
	}

	/**
	 * Validate a recipe configuration
	 */
	async validateRecipe(recipe: RecipeConfig): Promise<RecipeValidationResult> {
		const errors: RecipeValidationError[] = [];
		const warnings: string[] = [];

		this.debug("Validating recipe: %s", recipe.name);

		// Basic validation
		if (!recipe.name || typeof recipe.name !== "string") {
			errors.push(
				new RecipeValidationError("Recipe name is required and must be a string", "MISSING_NAME"),
			);
		}

		if (!recipe.variables || typeof recipe.variables !== "object") {
			errors.push(
				new RecipeValidationError("Recipe variables section is required", "MISSING_VARIABLES"),
			);
		} else if (typeof recipe.variables === "object" && Object.keys(recipe.variables).length === 0) {
			// Allow empty variables object, don't treat as error
		}

		if (!Array.isArray(recipe.steps) || recipe.steps.length === 0) {
			errors.push(new RecipeValidationError("Recipe must have at least one step", "MISSING_STEPS"));
		}

		// Validate variables
		if (recipe.variables) {
			for (const [varName, varConfig] of Object.entries(recipe.variables)) {
				const validation = this.validateVariable(varName, varConfig);
				if (validation.error) {
					errors.push(
						new RecipeValidationError(validation.error, "INVALID_VARIABLE", {
							field: `variables.${varName}`,
						}),
					);
				}
			}
		}

		// Validate steps
		if (recipe.steps) {
			const stepNames = new Set<string>();

			for (const [index, step] of recipe.steps.entries()) {
				const stepErrors = this.validateStep(step, index, stepNames);
				errors.push(...stepErrors);
			}

			// Validate dependencies
			this.validateStepDependencies(recipe.steps, errors);
		}

		// Validate dependencies
		if (recipe.dependencies) {
			for (const dep of recipe.dependencies) {
				const depValidation = await this.validateDependency(dep);
				if (!depValidation.isValid) {
					errors.push(
						new RecipeValidationError(
							`Dependency validation failed: ${dep.name}`,
							"INVALID_DEPENDENCY",
						),
					);
				}
			}
		}

		const result: RecipeValidationResult = {
			isValid: errors.length === 0,
			errors,
			warnings: warnings.map((w) => ({
				code: "WARNING",
				message: w,
				severity: "warning" as const,
				suggestion: undefined,
			})),
			recipe,
			context: {
				timestamp: new Date(),
				validatorVersion: "8.0.0",
				scope: "full",
			},
		};

		this.debug(
			"Recipe validation completed: %s (errors: %d, warnings: %d)",
			recipe.name,
			errors.length,
			warnings.length,
		);

		return result;
	}

	/**
	 * Get current execution status
	 */
	getExecutions(): RecipeExecution[] {
		return Array.from(this.activeExecutions.values());
	}

	/**
	 * Cancel a recipe execution
	 */
	async cancelExecution(executionId: string): Promise<void> {
		this.debug("Cancelling execution: %s", executionId);

		const execution = this.activeExecutions.get(executionId);
		if (!execution) {
			throw ErrorHandler.createError(
				ErrorCode.ACTION_NOT_FOUND,
				`Execution not found: ${executionId}`,
			);
		}

		// Cancel through step executor
		await this.stepExecutor.cancelExecution(executionId);

		// Update execution status
		execution.status = "cancelled";
		execution.endTime = new Date();

		this.emit("recipe:cancelled", { executionId });
	}

	/**
	 * Cancel all active executions
	 */
	async cancelAllExecutions(): Promise<void> {
		this.debug("Cancelling all executions");

		const promises = Array.from(this.activeExecutions.keys()).map((id) => this.cancelExecution(id));

		await Promise.allSettled(promises);
	}

	/**
	 * Clean up resources
	 */
	async cleanup(): Promise<void> {
		this.debug("Cleaning up recipe engine");

		// Cancel all executions
		await this.cancelAllExecutions();

		// Clear caches
		this.recipeCache.clear();

		// Clean up step executor
		await this.stepExecutor.cancelAllExecutions();

		this.emit("cleanup:completed");
	}

	// Private implementation methods

	private normalizeSource(source: string | RecipeSource): RecipeSource {
		if (typeof source === "string") {
			// Auto-detect source type - only file paths supported
			return { type: "file", path: source };
		}
		return source;
	}

	private getCacheKey(source: RecipeSource): string {
		switch (source.type) {
			case "file":
				return `file:${source.path}`;
			case "content":
				return `content:${source.name}`;
			default:
				return "unknown";
		}
	}

	private async loadRecipeContent(source: RecipeSource): Promise<string> {
		switch (source.type) {
			case "file":
				return this.loadFileContent(source.path);

			case "content":
				return source.content;

			default:
				throw ErrorHandler.createError(
					ErrorCode.VALIDATION_ERROR,
					`Unsupported source type: ${(source as any).type}`,
				);
		}
	}

	private async loadFileContent(filePath: string): Promise<string> {
		try {
			const fullPath = path.resolve(this.config.workingDir, filePath);

			if (!fs.existsSync(fullPath)) {
				throw ErrorHandler.createError(
					ErrorCode.ACTION_NOT_FOUND,
					`Recipe file not found: ${fullPath}`,
				);
			}

			return fs.readFileSync(fullPath, "utf-8");
		} catch (error) {
			if (error instanceof HypergenError) {
				throw error;
			}

			throw ErrorHandler.createError(
				ErrorCode.INTERNAL_ERROR,
				`Failed to load recipe file: ${error instanceof Error ? error.message : String(error)}`,
				{ filePath },
			);
		}
	}

	private async parseRecipeContent(content: string, source: RecipeSource): Promise<RecipeConfig> {
		try {
			const parsed = yaml.load(content) as any;

			if (!parsed || typeof parsed !== "object") {
				throw new Error("Invalid YAML format or empty content");
			}

			// Convert from template.yml format if needed
			const recipe: RecipeConfig = {
				name: parsed.name || "", // Don't provide default to trigger validation
				description: parsed.description,
				version: parsed.version || "1.0.0",
				author: parsed.author,
				category: parsed.category || "general",
				tags: parsed.tags || [],
				variables: parsed.variables || {},
				steps: this.normalizeSteps(parsed.steps || []),
				provides: this.parseProvides(parsed.provides),
				examples: parsed.examples || [],
				dependencies: parsed.dependencies || [],
				onSuccess: parsed.onSuccess,
				onError: parsed.onError,
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
				`Failed to parse recipe content: ${error instanceof Error ? error.message : String(error)}`,
				{ source },
			);
		}
	}

	/**
	 * Parse the `provides` field from recipe YAML
	 */
	private parseProvides(raw: any): RecipeProvides[] | undefined {
		if (!raw || !Array.isArray(raw)) return undefined;

		const provides: RecipeProvides[] = [];
		for (const item of raw) {
			if (typeof item === "string") {
				provides.push({ name: item });
			} else if (typeof item === "object" && item !== null && typeof item.name === "string") {
				const entry: RecipeProvides = { name: item.name };
				if (item.type && typeof item.type === "string") entry.type = item.type;
				if (item.description && typeof item.description === "string")
					entry.description = item.description;
				provides.push(entry);
			}
		}
		return provides.length > 0 ? provides : undefined;
	}

	/**
	 * Normalize steps to infer tool types from shorthands
	 */
	private normalizeSteps(steps: any[]): RecipeStepUnion[] {
		return steps.map((step) => {
			if (!step.tool) {
				if (step.command) {
					step.tool = "shell";
				} else if (step.recipe) {
					step.tool = "recipe";
				} else if (step.promptType) {
					// Inference for prompt
					step.tool = "prompt";
				} else if (step.sequence) {
					// Inference for sequence shorthand
					step.tool = "sequence";
					step.steps = step.sequence;
					step.sequence = undefined;
				} else if (step.parallel) {
					// Inference for parallel shorthand
					step.tool = "parallel";
					step.steps = step.parallel;
					step.parallel = undefined;
				} else if (step.steps) {
					// Default to sequence for generic steps property
					step.tool = "sequence";
				} else if (step.template) {
					step.tool = "template";
				} else if (step.action) {
					step.tool = "action";
				} else if (step.codemod) {
					step.tool = "codemod";
				} else if (step.packages) {
					step.tool = "install";
				}
			}

			// Map args shorthand to variableOverrides for recipe steps
			if (step.args && !step.variableOverrides) {
				step.variableOverrides = step.args;
				step.args = undefined;
			}

			// Recursively normalize nested steps in sequence/parallel
			if (step.steps && Array.isArray(step.steps)) {
				step.steps = this.normalizeSteps(step.steps);
			}

			return step as RecipeStepUnion;
		});
	}

	private async resolveVariables(
		recipe: RecipeConfig,
		providedVariables: Record<string, any>,
		opts: {
			askMode?: "me" | "ai" | "nobody";
			noDefaults?: boolean;
			aiConfig?: AiServiceConfig;
			logger?: Logger;
		},
	): Promise<Record<string, any>> {
		const { noDefaults = false, aiConfig, logger } = opts;
		// Default: interactive in TTY, error in non-TTY (matches plan)
		const askMode = opts.askMode ?? (process.stdout.isTTY ? "me" : "nobody");

		const resolved: Record<string, any> = {};
		const missingRequired: string[] = [];
		const toAsk: Array<{
			varName: string;
			varConfig: TemplateVariable;
			hint?: any;
		}> = [];

		this.debug(
			"Resolving variables for recipe: %s (askMode=%s, noDefaults=%s)",
			recipe.name,
			askMode,
			noDefaults,
		);

		// Phase 1: Apply provided values and defaults
		for (const [varName, varConfig] of Object.entries(recipe.variables)) {
			// Step 1: Check provided value
			let value = providedVariables[varName];

			// Step 2: Apply default (unless --no-defaults)
			if (value === undefined && !noDefaults) {
				value = varConfig.default;
			}

			// Step 3: If still unresolved, determine if we need to ask
			if (value === undefined || value === null || value === "") {
				const hint = varConfig.suggestion ?? (noDefaults ? varConfig.default : undefined);
				const shouldAsk = varConfig.required || noDefaults;

				if (shouldAsk) {
					toAsk.push({ varName, varConfig, hint });
					continue;
				}
				// Optional, not asked about — value stays undefined
			}

			// Step 4: If we have a value, validate it
			if (value !== undefined) {
				const validation = TemplateParser.validateVariableValue(varName, value, varConfig);
				if (!validation.isValid) {
					throw ErrorHandler.createError(
						ErrorCode.VALIDATION_ERROR,
						validation.error || `Invalid value for variable: ${varName}`,
						{ variable: varName, value, config: varConfig },
					);
				}
			}

			resolved[varName] =
				value !== undefined ? value : TemplateParser.getResolvedValue(value, varConfig);
		}

		// Phase 2: Resolve unresolved variables based on ask mode
		if (toAsk.length > 0) {
			switch (askMode) {
				case "me": {
					for (const { varName, varConfig, hint } of toAsk) {
						const configWithHint = hint !== undefined ? { ...varConfig, default: hint } : varConfig;
						const value = await this.promptForVariable(varName, configWithHint, logger);

						const validation = TemplateParser.validateVariableValue(varName, value, varConfig);
						if (!validation.isValid) {
							throw ErrorHandler.createError(
								ErrorCode.VALIDATION_ERROR,
								validation.error || `Invalid value for variable: ${varName}`,
								{ variable: varName, value },
							);
						}
						resolved[varName] = value;
					}
					break;
				}

				case "ai": {
					// Check transport compatibility
					const transport = aiConfig ? resolveTransport(aiConfig) : null;
					const transportName = transport?.name;

					if (!transport || transportName === "stdout") {
						this.debug("AI mode requires api or command transport, falling back to interactive");
						console.warn(
							"Warning: --ask=ai requires an API key or command transport configured. " +
								"Falling back to interactive prompts.",
						);
						// Fall through to interactive
						for (const { varName, varConfig, hint } of toAsk) {
							const configWithHint =
								hint !== undefined ? { ...varConfig, default: hint } : varConfig;
							const value = await this.promptForVariable(varName, configWithHint, logger);
							resolved[varName] = value;
						}
						break;
					}

					// Batch-resolve via AI
					const unresolvedVars: UnresolvedVariable[] = toAsk.map(
						({ varName, varConfig, hint }) => ({
							name: varName,
							config: varConfig,
							defaultValue: noDefaults ? varConfig.default : undefined,
						}),
					);

					const resolver = new AiVariableResolver(aiConfig!);
					const aiAnswers = await resolver.resolveBatch(unresolvedVars, resolved, {
						name: recipe.name,
						description: recipe.description,
					});

					// Apply AI answers and validate
					for (const { varName, varConfig } of toAsk) {
						const value = aiAnswers[varName];
						if (value !== undefined) {
							const validation = TemplateParser.validateVariableValue(varName, value, varConfig);
							if (!validation.isValid) {
								this.debug("AI value for %s failed validation: %s", varName, validation.error);
								if (varConfig.required) {
									missingRequired.push(varName);
								}
							} else {
								resolved[varName] = value;
							}
						} else if (varConfig.required) {
							missingRequired.push(varName);
						}
					}
					break;
				}

				case "nobody": {
					for (const { varName, varConfig } of toAsk) {
						if (varConfig.required) {
							missingRequired.push(varName);
						}
					}
					break;
				}
			}
		}

		if (missingRequired.length > 0) {
			throw ErrorHandler.createError(
				ErrorCode.VALIDATION_ERROR,
				`Missing required variables: ${missingRequired.join(", ")}`,
				{ missingVariables: missingRequired },
			);
		}

		// Add any additional provided variables not defined in recipe
		for (const [varName, value] of Object.entries(providedVariables)) {
			if (!recipe.variables[varName]) {
				resolved[varName] = value;
			}
		}

		this.debug("Variables resolved successfully: %o", Object.keys(resolved));

		return resolved;
	}

	private async promptForVariable(
		varName: string,
		varConfig: TemplateVariable,
		logger?: Logger,
	): Promise<any> {
		const prompts = [
			{
				type: this.getPromptType(varConfig),
				name: varName,
				message: varConfig.description || `Enter value for ${varName}:`,
				default: varConfig.default,
				choices: varConfig.type === "enum" ? varConfig.values : undefined,
				validate: (input: any) => {
					const validation = TemplateParser.validateVariableValue(varName, input, varConfig);
					return validation.isValid ? true : validation.error || false;
				},
			},
		];

		try {
			const answers = await performInteractivePrompting(prompts, logger || this.logger);

			return answers[varName];
		} catch (error) {
			throw ErrorHandler.createError(
				ErrorCode.INTERNAL_ERROR,
				`Failed to prompt for variable ${varName}: ${error instanceof Error ? error.message : String(error)}`,
				{ variable: varName },
			);
		}
	}

	private getPromptType(varConfig: TemplateVariable): string {
		switch (varConfig.type) {
			case "boolean":
				return "confirm";
			case "enum":
				return "list";
			case "number":
				return "number";
			case "file":
				return "input"; // Could be enhanced with file picker
			case "directory":
				return "input"; // Could be enhanced with directory picker
			default:
				return "input";
		}
	}

	private async createExecutionContext(
		recipe: RecipeConfig,
		variables: Record<string, any>,
		options: RecipeExecutionOptions,
		executionId: string,
		source?: string | RecipeSource,
	): Promise<StepContext> {
		// Determine collect mode: if no answers provided and AiCollector is in collect mode
		const collectMode = !options.answers && AiCollector.getInstance().collectMode;

		return {
			step: {} as RecipeStepUnion, // Will be set by step executor
			variables: { ...variables },
			projectRoot: options.workingDir || this.config.workingDir,
			recipeVariables: variables,
			stepResults: new Map(),
			recipe: {
				id: executionId,
				name: recipe.name,
				version: recipe.version,
				startTime: new Date(),
			},
			stepData: {},
			evaluateCondition: this.createConditionEvaluator(variables),
			answers: options.answers,
			collectMode,
			dryRun: options.dryRun,
			force: options.force,
			logger: options.logger || this.logger,
			templatePath:
				source && typeof source === "object" && source.type === "file"
					? path.dirname(source.path)
					: undefined,
		};
	}

	private createConditionEvaluator(
		variables: Record<string, any>,
	): (expression: string, ctx: Record<string, any>) => boolean {
		return (expression: string, ctx: Record<string, any>) => {
			try {
				// Built-in helper functions available in condition expressions
				const projectRoot = ctx.projectRoot || this.config.workingDir || process.cwd();
				const builtinFunctions: Record<string, (...args: any[]) => any> = {
					fileExists: (filePath: string) => {
						const resolved = path.isAbsolute(filePath)
							? filePath
							: path.resolve(projectRoot, filePath);
						return fs.existsSync(resolved);
					},
					dirExists: (dirPath: string) => {
						const resolved = path.isAbsolute(dirPath)
							? dirPath
							: path.resolve(projectRoot, dirPath);
						try {
							return fs.statSync(resolved).isDirectory();
						} catch {
							return false;
						}
					},
				};

				// Flatten variables into scope for easier access in condition expressions
				// ctx is the current context.variables dict (flat key-value), which includes
				// both initial variables AND any exports from earlier steps.
				const variableScope = {
					...variables,
					...ctx,
					variables: { ...variables, ...ctx },
				};
				const mergedContext = { ...builtinFunctions, ...variableScope };

				// Use a set to ensure unique argument names for Function constructor
				// Filter out reserved keywords to prevent SyntaxError
				const reservedKeywords = new Set([
					"break",
					"case",
					"catch",
					"class",
					"const",
					"continue",
					"debugger",
					"default",
					"delete",
					"do",
					"else",
					"export",
					"extends",
					"finally",
					"for",
					"function",
					"if",
					"import",
					"in",
					"instanceof",
					"new",
					"return",
					"super",
					"switch",
					"this",
					"throw",
					"try",
					"typeof",
					"var",
					"void",
					"while",
					"with",
					"yield",
					"let",
					"static",
					"enum",
					"await",
					"implements",
					"interface",
					"package",
					"private",
					"protected",
					"public",
				]);

				const argNames = Array.from(new Set(Object.keys(mergedContext))).filter(
					(name) => !reservedKeywords.has(name) && /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name),
				);

				const argValues = argNames.map((name) => (mergedContext as any)[name]);

				const func = new Function(...argNames, `return ${expression}`);
				return Boolean(func(...argValues));
			} catch (error) {
				this.debug(
					"Condition evaluation failed: %s - %s",
					expression,
					error instanceof Error ? error.message : String(error),
				);
				return false;
			}
		};
	}

	/**
	 * Recursively count steps including those nested in sequence/parallel tools
	 */
	private countNestedSteps(
		results: StepResult[],
		status?: "completed" | "failed" | "skipped",
		depth = 0,
	): number {
		let count = 0;

		for (const result of results) {
			// For sequence/parallel tools, count only their nested steps (not the container itself)
			// For all other tools, count the step if status matches or no filter
			const isContainer = result.toolType === "sequence" || result.toolType === "parallel";

			if (!isContainer && (!status || result.status === status)) {
				count++;
			}

			// Recursively count nested steps in sequence/parallel tools
			// Note: The toolResult is wrapped - it's result.toolResult.toolResult.steps, not result.toolResult.steps
			// This is because the tool returns a StepResult with toolResult field, creating double nesting
			if (isContainer && result.toolResult) {
				const wrapped = result.toolResult as any;
				const executionResult = wrapped.toolResult as { steps?: StepResult[] } | undefined;
				if (
					executionResult?.steps &&
					Array.isArray(executionResult.steps) &&
					executionResult.steps.length > 0
				) {
					const nestedCount = this.countNestedSteps(executionResult.steps, status, depth + 1);
					count += nestedCount;
				}
			}
		}

		return count;
	}

	private aggregateResults(
		executionId: string,
		recipe: RecipeConfig,
		stepResults: StepResult[],
		variables: Record<string, any>,
		startTime: number,
		context: StepContext,
	): RecipeExecutionResult {
		const duration = Date.now() - startTime;

		// Count steps recursively including nested ones in sequences/parallel
		const totalSteps = this.countNestedSteps(stepResults);
		const completedSteps = this.countNestedSteps(stepResults, "completed");
		const failedSteps = this.countNestedSteps(stepResults, "failed");
		const skippedSteps = this.countNestedSteps(stepResults, "skipped");

		// Aggregate file changes
		const filesCreated = new Set<string>();
		const filesModified = new Set<string>();
		const filesDeleted = new Set<string>();
		const errors: string[] = [];
		const warnings: string[] = [];

		for (const result of stepResults) {
			if (result.filesCreated) {
				result.filesCreated.forEach((file) => filesCreated.add(file));
			}
			if (result.filesModified) {
				result.filesModified.forEach((file) => filesModified.add(file));
			}
			if (result.filesDeleted) {
				result.filesDeleted.forEach((file) => filesDeleted.add(file));
			}
			if (result.error) {
				errors.push(`${result.stepName}: ${result.error.message}`);
			}
		}

		// Collect providedValues from recipe.provides declarations
		let providedValues: Record<string, any> | undefined;
		if (recipe.provides && recipe.provides.length > 0) {
			providedValues = {};
			for (const p of recipe.provides) {
				if (p.name in context.variables) {
					providedValues[p.name] = context.variables[p.name];
				}
			}
			if (Object.keys(providedValues).length === 0) {
				providedValues = undefined;
			}
		}

		return {
			executionId,
			recipe,
			success: failedSteps === 0,
			stepResults,
			duration,
			filesCreated: Array.from(filesCreated),
			filesModified: Array.from(filesModified),
			filesDeleted: Array.from(filesDeleted),
			errors,
			warnings,
			variables,
			metadata: {
				startTime: new Date(startTime),
				endTime: new Date(),
				workingDir: context.projectRoot,
				totalSteps,
				completedSteps,
				failedSteps,
				skippedSteps,
				providedValues,
			},
		};
	}

	/**
	 * Render and print onSuccess or onError message after recipe execution
	 */
	private async renderLifecycleMessage(
		recipe: RecipeConfig,
		result: RecipeExecutionResult,
		variables: Record<string, any>,
		options: RecipeExecutionOptions,
	): Promise<void> {
		const template = result.success ? recipe.onSuccess : recipe.onError;
		if (!template) return;

		try {
			const renderContext = {
				...variables,
				recipe: {
					name: recipe.name,
					description: recipe.description,
					version: recipe.version,
				},
				result: {
					success: result.success,
					filesCreated: result.filesCreated,
					filesModified: result.filesModified,
					errors: result.errors,
					duration: result.duration,
				},
			};

			const rendered = await jigRenderTemplate(template, renderContext);
			const trimmed = rendered.trim();

			if (trimmed) {
				const logger = options.logger || this.logger;
				console.log(); // blank line before message
				if (result.success) {
					logger.ok(trimmed);
				} else {
					logger.err(trimmed);
				}
			}
		} catch (error) {
			this.debug(
				"Failed to render %s message: %s",
				result.success ? "onSuccess" : "onError",
				error instanceof Error ? error.message : String(error),
			);
		}
	}

	private async loadDependencies(recipe: RecipeConfig): Promise<RecipeConfig[]> {
		const dependencies: RecipeConfig[] = [];

		if (!recipe.dependencies) {
			return dependencies;
		}

		for (const dep of recipe.dependencies) {
			try {
				const depSource = this.dependencyToSource(dep);
				const depResult = await this.loadRecipe(depSource);

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
					this.debug(
						"Optional dependency failed to load: %s - %s",
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

	private dependencyToSource(dependency: any): RecipeSource {
		const name = typeof dependency === "string" ? dependency : dependency.name;
		const type = typeof dependency === "object" ? dependency.type : "local";

		// Only local file dependencies supported
		return { type: "file", path: name };
	}

	private validateVariable(varName: string, varConfig: TemplateVariable): { error?: string } {
		if (!varConfig || typeof varConfig !== "object") {
			return { error: `Variable '${varName}' must be an object` };
		}

		if (!varConfig.type) {
			return { error: `Variable '${varName}' must have a type` };
		}

		const validTypes = [
			"string",
			"number",
			"boolean",
			"enum",
			"array",
			"object",
			"file",
			"directory",
		];
		if (!validTypes.includes(varConfig.type)) {
			return {
				error: `Variable '${varName}' has invalid type: ${varConfig.type}`,
			};
		}

		return {};
	}

	private validateStep(
		step: RecipeStepUnion,
		index: number,
		stepNames: Set<string>,
	): RecipeValidationError[] {
		const errors: RecipeValidationError[] = [];
		const stepAny = step as any; // Type assertion for validation context

		if (!stepAny.name) {
			errors.push(
				new RecipeValidationError(`Step ${index + 1} must have a name`, "MISSING_STEP_NAME", {
					field: `steps[${index}].name`,
				}),
			);
		} else {
			if (stepNames.has(stepAny.name)) {
				errors.push(
					new RecipeValidationError(`Duplicate step name: ${stepAny.name}`, "DUPLICATE_STEP_NAME", {
						field: `steps[${index}].name`,
					}),
				);
			}
			stepNames.add(stepAny.name);
		}

		if (!stepAny.tool) {
			errors.push(
				new RecipeValidationError(
					`Step ${stepAny.name || index + 1} must specify a tool`,
					"MISSING_TOOL",
					{ field: `steps[${index}].tool` },
				),
			);
		}

		const validTools = [
			"template",
			"action",
			"codemod",
			"recipe",
			"shell",
			"prompt",
			"sequence",
			"parallel",
			"ai",
			"install",
			"query",
			"patch",
			"ensure-dirs",
		];
		if (step.tool && !validTools.includes(step.tool)) {
			errors.push(
				new RecipeValidationError(
					`Step ${step.name || index + 1} has invalid tool: ${step.tool}`,
					"INVALID_TOOL",
					{ field: `steps[${index}].tool` },
				),
			);
		}

		return errors;
	}

	private validateStepDependencies(
		steps: RecipeStepUnion[],
		errors: RecipeValidationError[],
	): void {
		const stepNames = new Set(steps.map((s) => s.name));

		for (const step of steps) {
			if (step.dependsOn) {
				for (const depName of step.dependsOn) {
					if (!stepNames.has(depName)) {
						errors.push(
							new RecipeValidationError(
								`Step ${step.name} depends on unknown step: ${depName}`,
								"UNKNOWN_DEPENDENCY",
								{ step: step.name, field: "dependsOn" },
							),
						);
					}
				}
			}
		}
	}

	private async validateDependency(dependency: any): Promise<{ isValid: boolean; error?: string }> {
		const name = typeof dependency === "string" ? dependency : dependency.name;

		if (!name) {
			return { isValid: false, error: "Dependency must have a name" };
		}

		// Basic validation - in production you'd check if package/URL exists
		return { isValid: true };
	}

	private generateExecutionId(): string {
		return `recipe_${Date.now()}_${++this.executionCounter}`;
	}
}

/**
 * Create a new recipe engine instance
 */
export function createRecipeEngine(config?: RecipeEngineConfig): RecipeEngine {
	return new RecipeEngine(config);
}

/**
 * Execute a recipe with default configuration
 */
export async function executeRecipe(
	source: string | RecipeSource,
	options?: RecipeExecutionOptions,
): Promise<RecipeExecutionResult> {
	const engine = createRecipeEngine();
	return await engine.executeRecipe(source, options);
}

/**
 * Load and validate a recipe without executing
 */
export async function loadRecipe(
	source: string | RecipeSource,
	config?: RecipeEngineConfig,
): Promise<RecipeLoadResult> {
	const engine = createRecipeEngine(config);
	return await engine.loadRecipe(source);
}

/**
 * Validate a recipe configuration
 */
export async function validateRecipe(
	recipe: RecipeConfig,
	config?: RecipeEngineConfig,
): Promise<RecipeValidationResult> {
	const engine = createRecipeEngine(config);
	return await engine.validateRecipe(recipe);
}
