/**
 * Recipe Tool Implementation for Recipe Step System
 *
 * This tool handles recipe composition by loading and executing sub-recipes as
 * orchestrated components. It replaces complex inheritance systems with simple
 * execution-based composition, making recipe systems intuitive and powerful.
 *
 * Key Features:
 * - Recipe discovery from multiple sources (local, npm, GitHub, URLs)
 * - Variable inheritance and override patterns
 * - Sub-recipe execution with proper context isolation
 * - Result aggregation and error handling
 * - Circular dependency detection
 * - Recipe caching for performance
 * - Variable mapping and transformation
 */

import path from "node:path";
import fs from "fs-extra";
import yaml from "js-yaml";
import createDebug from "debug";
import { Tool, type ToolValidationResult, type ToolResource } from "#/base.js";
import {
	HypergenError,
	ErrorCode,
	ErrorHandler,
	withErrorHandling,
} from "#/errors/hypergen-errors";
import { StepExecutor } from "#/recipe-engine/step-executor";
import {
	type RecipeStep,
	type RecipeStepUnion,
	type StepContext,
	type StepResult,
	type StepExecutionOptions,
	type RecipeExecutionResult,
	type RecipeConfig,
	type RecipeDependencyError,
	type CircularDependencyError,
	isRecipeStep,
} from "#/recipe-engine/types";
import { TemplateParser } from "#/config/template-parser";
import { TemplateURLManager } from "#/config/url-resolution/index";

const debug = createDebug("hypergen:v8:recipe:tool:recipe");

/**
 * Recipe resolution result
 */
interface RecipeResolution {
	/** Recipe identifier */
	id: string;

	/** Resolved recipe file path or URL */
	source: string;

	/** Recipe configuration */
	config: RecipeConfig;

	/** Recipe metadata */
	metadata: {
		exists: boolean;
		cached: boolean;
		lastModified?: Date;
		size?: number;
		source: "local" | "npm" | "github" | "url" | "inline";
	};

	/** Working directory for recipe execution */
	workingDir: string;
}

/**
 * Recipe execution context for sub-recipes
 */
interface SubRecipeContext extends StepContext {
	/** Parent recipe context */
	parent: {
		recipeId: string;
		stepName: string;
		variables: Record<string, any>;
		projectRoot: string;
	};

	/** Variable inheritance configuration */
	inheritance: {
		inherit: boolean;
		overrides: Record<string, any>;
		mapping: Record<string, string>;
	};

	/** Isolation settings */
	isolation: {
		workingDir?: string;
		environment?: Record<string, string>;
		timeout?: number;
	};
}

/**
 * Recipe dependency node for circular dependency detection
 */
interface RecipeDependencyNode {
	id: string;
	dependencies: Set<string>;
	path: string[];
}

/**
 * Recipe Tool for processing recipe composition in the Recipe Step System
 *
 * This tool implements the core insight that composition is simpler than inheritance.
 * Instead of complex configuration merging and template inheritance, recipes are
 * executed as orchestrated steps that can call other recipes with clear variable
 * passing patterns.
 *
 * Features:
 * - Multiple recipe source discovery (local files, URLs, npm packages)
 * - Variable inheritance with clear override patterns
 * - Sub-recipe execution with proper context management
 * - Result aggregation from child recipes
 * - Error handling and rollback for failed sub-recipes
 * - Circular dependency detection with clear error messages
 * - Recipe caching for performance optimization
 * - Variable mapping and transformation support
 */
export class RecipeTool extends Tool<RecipeStep> {
	private recipeCache = new Map<string, RecipeResolution>();
	private executionStack: string[] = [];
	private urlManager: TemplateURLManager;

	constructor(name: string = "recipe-tool", options: Record<string, any> = {}) {
		super("recipe", name, options);

		this.urlManager = new TemplateURLManager({
			cache: {
				cacheDir: options.cacheDirectory || ".hypergen/cache",
				ttl: 24 * 60 * 60 * 1000, // 24 hours
				maxSize: options.maxCacheSize || 100 * 1024 * 1024, // 100MB
				integrityCheck: true,
			},
			security: {
				allowedDomains: options.allowedDomains || ["github.com", "raw.githubusercontent.com"],
				requireHttps: options.requireHttps !== false,
				maxFileSize: options.maxFileSize || 10 * 1024 * 1024, // 10MB
			},
			timeout: options.timeout || 30000,
		});
	}

	/**
	 * Initialize the recipe tool
	 */
	protected async onInitialize(): Promise<void> {
		this.debug("Initializing recipe tool");

		try {
			// URL manager doesn't need initialization in the current implementation

			// Register cache resource for cleanup
			this.registerResource({
				id: "recipe-cache",
				type: "cache",
				cleanup: () => {
					this.recipeCache.clear();
				},
				metadata: { cacheSize: 0 },
			});

			// Register URL manager resource
			this.registerResource({
				id: "url-manager",
				type: "network",
				cleanup: async () => {
					// URL manager cleanup if needed
				},
			});

			this.debug("Recipe tool initialized successfully");
		} catch (error) {
			throw ErrorHandler.createError(
				ErrorCode.INTERNAL_ERROR,
				`Failed to initialize recipe tool: ${error instanceof Error ? error.message : String(error)}`,
				{ phase: "initialize", cause: error },
			);
		}
	}

	/**
	 * Validate recipe step configuration
	 */
	protected async onValidate(
		step: RecipeStep,
		context: StepContext,
	): Promise<ToolValidationResult> {
		const errors: string[] = [];
		const warnings: string[] = [];
		const suggestions: string[] = [];

		// Validate step is a recipe step
		if (!isRecipeStep(step)) {
			errors.push("Step is not a valid RecipeStep");
			return { isValid: false, errors, warnings, suggestions };
		}

		// Validate required fields
		if (!step.recipe) {
			errors.push("Recipe identifier is required");
		}

		// Validate recipe exists and is accessible
		if (step.recipe) {
			try {
				const resolution = await this.resolveRecipe(step.recipe, context);
				if (!resolution.metadata.exists) {
					errors.push(`Recipe not found: ${step.recipe}`);
				} else {
					// Validate recipe configuration
					const configValidation = this.validateRecipeConfig(resolution.config);
					errors.push(...configValidation.errors);
					warnings.push(...configValidation.warnings);
				}
			} catch (error) {
				errors.push(
					`Recipe resolution failed: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}

		// Check for circular dependencies
		try {
			await this.detectCircularDependencies(step.recipe, context, []);
		} catch (error) {
			if (error instanceof Error && error.name === "CircularDependencyError") {
				errors.push(error.message);
			}
		}

		// Validate version constraint
		if (step.version && !/^[\d\w.-]+$/.test(step.version)) {
			warnings.push("Version constraint should follow semantic versioning format");
		}

		// Validate variable overrides
		if (step.variableOverrides) {
			if (typeof step.variableOverrides !== "object") {
				errors.push("Variable overrides must be an object");
			}
		}

		// Validate recipe configuration options
		const recipeConfig = step.recipeConfig;
		if (recipeConfig) {
			if (recipeConfig.execution?.timeout && recipeConfig.execution.timeout <= 0) {
				errors.push("Recipe execution timeout must be positive");
			}

			if (
				recipeConfig.execution?.workingDir &&
				path.isAbsolute(recipeConfig.execution.workingDir)
			) {
				warnings.push("Working directory should be relative to project root");
			}

			if (recipeConfig.variableMapping) {
				for (const [from, to] of Object.entries(recipeConfig.variableMapping)) {
					if (typeof to !== "string") {
						errors.push(`Variable mapping '${from}' must map to a string`);
					}
				}
			}
		}

		// Performance considerations
		if (step.inheritVariables === false && !step.variableOverrides) {
			suggestions.push("Consider providing variable overrides when disabling variable inheritance");
		}

		// Estimate execution time
		let estimatedTime = 500; // Base time for recipe resolution
		try {
			if (step.recipe) {
				const resolution = await this.resolveRecipe(step.recipe, context);
				estimatedTime += (resolution.config.steps?.length || 0) * 200; // Estimate per step
			}
		} catch {
			estimatedTime = 1000; // Conservative estimate if resolution fails
		}

		const resourceRequirements = {
			memory: 50 * 1024 * 1024, // 50MB base memory for recipe execution
			disk: 10 * 1024 * 1024, // 10MB estimated disk usage
			network: this.isRemoteRecipe(step.recipe),
			processes: 1,
		};

		return {
			isValid: errors.length === 0,
			errors,
			warnings,
			suggestions,
			estimatedExecutionTime: estimatedTime,
			resourceRequirements,
		};
	}

	/**
	 * Execute the recipe tool
	 */
	protected async onExecute(
		step: RecipeStep,
		context: StepContext,
		options?: StepExecutionOptions,
	): Promise<StepResult> {
		this.debug("Executing recipe step: %s -> %s", step.name, step.recipe);

		const startTime = new Date();
		const filesCreated: string[] = [];
		const filesModified: string[] = [];
		const filesDeleted: string[] = [];

		try {
			// Check for circular dependencies before execution
			await this.detectCircularDependencies(step.recipe, context, this.executionStack);

			// Add current recipe to execution stack
			this.executionStack.push(step.recipe);

			// Resolve recipe
			const recipeResolution = await this.resolveRecipe(step.recipe, context);
			this.debug("Recipe resolved: %s -> %s", step.recipe, recipeResolution.source);

			// Build sub-recipe context
			const subContext = this.buildSubRecipeContext(step, context, recipeResolution);

			// Execute sub-recipe steps
			const recipe = recipeResolution.config;

			this.debug("Executing %d steps in sub-recipe: %s", recipe.steps.length, recipe.name);

			// Execute sub-recipe steps using StepExecutor
			const executor = new StepExecutor(undefined, {
				continueOnError: options?.continueOnError,
			});

			const stepResults = await executor.executeSteps(recipe.steps, subContext, {
				...options,
				timeout: subContext.isolation.timeout || options?.timeout,
			});

			// Update files lists from results
			for (const result of stepResults) {
				if (result.filesCreated) filesCreated.push(...result.filesCreated);
				if (result.filesModified) filesModified.push(...result.filesModified);
				if (result.filesDeleted) filesDeleted.push(...result.filesDeleted);
			}

			// Update cache metadata
			const cacheResource = this.resources.get("recipe-cache");
			if (cacheResource) {
				cacheResource.metadata!.cacheSize = this.recipeCache.size;
			}

			const endTime = new Date();
			const duration = endTime.getTime() - startTime.getTime();

			// Create tool-specific result
			const recipeResult: RecipeExecutionResult = {
				recipeName: recipe.name,
				recipePath: recipeResolution.source,
				subSteps: stepResults,
				totalDuration: duration,
				inheritedVariables: subContext.inheritance.inherit ? context.variables : {},
			};

			// Check for failures
			const failedStep = stepResults.find(
				(r) => r.status === "failed" && !options?.continueOnError,
			);
			if (failedStep) {
				throw ErrorHandler.createError(
					ErrorCode.TEMPLATE_EXECUTION_ERROR,
					`Sub-recipe execution failed: ${failedStep.error?.message || "Unknown error"}`,
					{
						template: step.recipe,
						cause: failedStep.error?.cause,
					},
				);
			}

			return {
				status: "completed",
				stepName: step.name,
				toolType: "recipe",
				startTime,
				endTime,
				duration,
				retryCount: 0,
				dependenciesSatisfied: true,
				toolResult: recipeResult,
				filesCreated,
				filesModified,
				filesDeleted,
				output: {
					subRecipe: recipe.name,
					totalSteps: recipe.steps.length,
					completedSteps: stepResults.filter((r) => r.status === "completed").length,
					failedSteps: stepResults.filter((r) => r.status === "failed").length,
					skippedSteps: stepResults.filter((r) => r.status === "skipped").length,
					inheritedVariables: Object.keys(subContext.inheritance.inherit ? context.variables : {}),
					variableOverrides: Object.keys(step.variableOverrides || {}),
				},
				metadata: {
					recipeResolution: {
						originalRecipe: step.recipe,
						resolvedSource: recipeResolution.source,
						cached: recipeResolution.metadata.cached,
					},
					execution: {
						workingDir: subContext.isolation.workingDir || context.projectRoot,
						variableInheritance: step.inheritVariables !== false,
						totalSubSteps: stepResults.length,
					},
					performance: {
						resolutionTime: 0, // Could be tracked separately
						executionTime: duration,
					},
				},
			};
		} catch (error) {
			const endTime = new Date();
			const duration = endTime.getTime() - startTime.getTime();

			return {
				status: "failed",
				stepName: step.name,
				toolType: "recipe",
				startTime,
				endTime,
				duration,
				retryCount: 0,
				dependenciesSatisfied: true,
				filesCreated,
				filesModified,
				filesDeleted,
				error: {
					message: error instanceof Error ? error.message : String(error),
					code: error instanceof HypergenError ? error.code : "RECIPE_EXECUTION_ERROR",
					stack: error instanceof Error ? error.stack : undefined,
					cause: error,
				},
			};
		} finally {
			// Remove from execution stack
			this.executionStack.pop();
		}
	}

	/**
	 * Tool-specific cleanup logic
	 */
	protected async onCleanup(): Promise<void> {
		this.debug("Cleaning up recipe tool resources");
		this.recipeCache.clear();
		this.executionStack.length = 0;
	}

	/**
	 * Resolve recipe identifier to configuration
	 */
	private async resolveRecipe(recipeId: string, context: StepContext): Promise<RecipeResolution> {
		// Check cache first
		const cacheKey = `${recipeId}:${context.projectRoot}`;
		const cached = this.recipeCache.get(cacheKey);
		if (cached && cached.metadata.exists) {
			cached.metadata.cached = true;
			return cached;
		}

		let source: string;
		let config: RecipeConfig;
		let metadata: RecipeResolution["metadata"];
		let workingDir: string = context.projectRoot;

		try {
			// Try different resolution strategies
			if (this.isLocalPath(recipeId)) {
				({ source, config, metadata, workingDir } = await this.resolveLocalRecipe(
					recipeId,
					context,
				));
			} else if (this.isURL(recipeId)) {
				({ source, config, metadata, workingDir } = await this.resolveURLRecipe(recipeId, context));
			} else if (this.isNpmPackage(recipeId)) {
				({ source, config, metadata, workingDir } = await this.resolveNpmRecipe(recipeId, context));
			} else if (this.isGitHubRepo(recipeId)) {
				({ source, config, metadata, workingDir } = await this.resolveGitHubRecipe(
					recipeId,
					context,
				));
			} else {
				// Default: try local first, then treat as npm package
				try {
					({ source, config, metadata, workingDir } = await this.resolveLocalRecipe(
						recipeId,
						context,
					));
				} catch {
					({ source, config, metadata, workingDir } = await this.resolveNpmRecipe(
						recipeId,
						context,
					));
				}
			}

			const resolution: RecipeResolution = {
				id: recipeId,
				source,
				config,
				metadata: { ...metadata, cached: false },
				workingDir,
			};

			// Cache the resolution
			this.recipeCache.set(cacheKey, resolution);

			return resolution;
		} catch (error) {
			throw ErrorHandler.createError(
				ErrorCode.TEMPLATE_NOT_FOUND,
				`Failed to resolve recipe '${recipeId}': ${error instanceof Error ? error.message : String(error)}`,
				{ template: recipeId, cause: error },
			);
		}
	}

	/**
	 * Resolve local recipe file
	 */
	private async resolveLocalRecipe(recipeId: string, context: StepContext) {
		const possiblePaths = [
			path.resolve(context.projectRoot, recipeId),
			path.resolve(context.projectRoot, `${recipeId}.yml`),
			path.resolve(context.projectRoot, `${recipeId}/recipe.yml`),
			path.resolve(context.projectRoot, `recipes/${recipeId}/recipe.yml`),
			path.resolve(context.projectRoot, `recipes/${recipeId}.yml`),
			path.resolve(context.projectRoot, `recipes/${recipeId}/recipe.yml`),
		];

		// If templatePath is available (from parent recipe), try resolving relative to it
		if (context.templatePath) {
			possiblePaths.unshift(
				path.resolve(context.templatePath, recipeId),
				path.resolve(context.templatePath, `${recipeId}.yml`),
			);
		}

		for (const filePath of possiblePaths) {
			if (await fs.pathExists(filePath)) {
				const stats = await fs.stat(filePath);
				const content = await fs.readFile(filePath, "utf8");
				const rawConfig = yaml.load(content) as any;
				const config: RecipeConfig = {
					...rawConfig,
					steps: this.normalizeSteps(rawConfig.steps || []),
				};

				return {
					source: filePath,
					config,
					metadata: {
						exists: true,
						cached: false,
						lastModified: stats.mtime,
						size: stats.size,
						source: "local" as const,
					},
					workingDir: path.dirname(filePath),
				};
			}
		}

		throw new Error(`Local recipe not found: ${recipeId}`);
	}

	/**
	 * Resolve recipe from URL
	 */
	private async resolveURLRecipe(recipeId: string, context: StepContext) {
		const resolved = await this.urlManager.resolveURL(recipeId);
		const rawConfig = yaml.load(resolved.content) as any;
		const config: RecipeConfig = {
			...rawConfig,
			steps: this.normalizeSteps(rawConfig.steps || []),
		};

		return {
			source: recipeId,
			config,
			metadata: {
				exists: true,
				cached: false,
				lastModified: resolved.metadata.lastFetched,
				size: resolved.content.length,
				source: "url" as const,
			},
			workingDir: context.projectRoot,
		};
	}

	/**
	 * Resolve recipe from npm package
	 */
	private async resolveNpmRecipe(recipeId: string, context: StepContext) {
		const packagePath = path.resolve(context.projectRoot, "node_modules", recipeId);
		const recipeFile = path.join(packagePath, "recipe.yml");

		if (!(await fs.pathExists(recipeFile))) {
			throw new Error(`npm recipe not found: ${recipeId}`);
		}

		const stats = await fs.stat(recipeFile);
		const content = await fs.readFile(recipeFile, "utf8");
		const rawConfig = yaml.load(content) as any;
		const config: RecipeConfig = {
			...rawConfig,
			steps: this.normalizeSteps(rawConfig.steps || []),
		};

		return {
			source: recipeFile,
			config,
			metadata: {
				exists: true,
				cached: false,
				lastModified: stats.mtime,
				size: stats.size,
				source: "npm" as const,
			},
			workingDir: packagePath,
		};
	}

	/**
	 * Resolve recipe from GitHub repository
	 */
	private async resolveGitHubRecipe(recipeId: string, context: StepContext) {
		// Convert github:user/repo format to URL
		const url = recipeId.startsWith("github:")
			? `https://raw.githubusercontent.com/${recipeId.slice(7)}/main/recipe.yml`
			: recipeId;

		return this.resolveURLRecipe(url, context);
	}

	/**
	 * Build sub-recipe context with variable inheritance
	 */
	private buildSubRecipeContext(
		step: RecipeStep,
		parentContext: StepContext,
		resolution: RecipeResolution,
	): SubRecipeContext {
		// Determine variable inheritance
		const inheritVariables = step.inheritVariables !== false;
		const variableOverrides = step.variableOverrides || {};
		const variableMapping = step.recipeConfig?.variableMapping || {};

		// Apply variable mapping
		const mappedVariables: Record<string, any> = {};
		if (inheritVariables) {
			for (const [parentKey, parentValue] of Object.entries(parentContext.variables)) {
				const mappedKey = variableMapping[parentKey] || parentKey;
				mappedVariables[mappedKey] = parentValue;
			}
		}

		// Merge variables with overrides taking precedence
		const variables = {
			...mappedVariables,
			...variableOverrides,
		};

		// Determine working directory
		const workingDir = step.recipeConfig?.execution?.workingDir
			? path.resolve(parentContext.projectRoot, step.recipeConfig.execution.workingDir)
			: resolution.workingDir;

		return {
			...parentContext,
			variables,
			projectRoot: workingDir,
			stepResults: new Map(), // Fresh step results for sub-recipe
			parent: {
				recipeId: parentContext.recipe.id,
				stepName: step.name,
				variables: parentContext.variables,
				projectRoot: parentContext.projectRoot,
			},
			inheritance: {
				inherit: inheritVariables,
				overrides: variableOverrides,
				mapping: variableMapping,
			},
			isolation: {
				workingDir,
				environment: step.environment,
				timeout: step.recipeConfig?.execution?.timeout || step.timeout,
			},
		};
	}

	/**
	 * Create step context for sub-recipe step execution
	 */
	private createStepContext(
		subStep: any,
		subContext: SubRecipeContext,
		previousResults: StepResult[],
	): StepContext {
		// Build step results map
		const stepResults = new Map<string, StepResult>();
		for (const result of previousResults) {
			stepResults.set(result.stepName, result);
		}

		return {
			...subContext,
			step: subStep,
			stepResults,
			variables: {
				...subContext.variables,
				...subStep.variables,
			},
		};
	}

	/**
	 * Execute a sub-recipe step using the appropriate tool
	 * This is a simplified version - in a complete implementation,
	 * this would delegate to the actual tool registry
	 */
	private async executeSubStep(
		subStep: any,
		stepContext: StepContext,
		options?: StepExecutionOptions,
	): Promise<StepResult> {
		// This is a placeholder implementation
		// In the real system, this would:
		// 1. Get the appropriate tool from a tool registry
		// 2. Execute the tool with the step and context
		// 3. Return the step result

		this.debug("Executing sub-step: %s (%s)", subStep.name, subStep.tool);

		// For now, return a mock successful result
		const startTime = new Date();
		await new Promise((resolve) => setTimeout(resolve, 50)); // Simulate work
		const endTime = new Date();

		return {
			status: "completed",
			stepName: subStep.name,
			toolType: subStep.tool,
			startTime,
			endTime,
			duration: endTime.getTime() - startTime.getTime(),
			retryCount: 0,
			dependenciesSatisfied: true,
			filesCreated: [],
			filesModified: [],
			filesDeleted: [],
		};
	}

	/**
	 * Detect circular dependencies in recipe chain
	 */
	private async detectCircularDependencies(
		recipeId: string,
		context: StepContext,
		currentPath: string[],
	): Promise<void> {
		if (currentPath.includes(recipeId)) {
			const cycle = [...currentPath, recipeId];
			const error = new Error(
				`Circular dependency detected: ${cycle.join(" -> ")}`,
			) as CircularDependencyError;
			error.name = "CircularDependencyError";
			(error as any).cycle = cycle;
			throw error;
		}

		// In a complete implementation, this would:
		// 1. Resolve the recipe
		// 2. Check all recipe steps that use the 'recipe' tool
		// 3. Recursively check their dependencies
		// For now, we just check the current path
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
					delete step.sequence;
				} else if (step.parallel) {
					// Inference for parallel shorthand
					step.tool = "parallel";
					step.steps = step.parallel;
					delete step.parallel;
				} else if (step.steps) {
					// Default to sequence for generic steps property
					step.tool = "sequence";
				} else if (step.template) {
					step.tool = "template";
				} else if (step.action) {
					step.tool = "action";
				} else if (step.codemod) {
					step.tool = "codemod";
				}
			}
			return step as RecipeStepUnion;
		});
	}

	/**
	 * Tool-specific cleanup logicipe configuration
	 */
	private validateRecipeConfig(config: RecipeConfig): {
		errors: string[];
		warnings: string[];
	} {
		const errors: string[] = [];
		const warnings: string[] = [];

		if (!config.name) {
			errors.push("Recipe must have a name");
		}

		if (!config.steps || config.steps.length === 0) {
			errors.push("Recipe must have at least one step");
		}

		if (config.steps) {
			for (let i = 0; i < config.steps.length; i++) {
				const step = config.steps[i];
				if (!step.name) {
					errors.push(`Step ${i + 1} must have a name`);
				}
				if (!step.tool) {
					errors.push(`Step '${step.name}' must specify a tool`);
				}
			}
		}

		return { errors, warnings };
	}

	/**
	 * Check if recipe identifier is a local path
	 */
	private isLocalPath(recipeId: string): boolean {
		return (
			recipeId.startsWith("./") ||
			recipeId.startsWith("../") ||
			path.isAbsolute(recipeId) ||
			!recipeId.includes(":")
		);
	}

	/**
	 * Check if recipe identifier is a URL
	 */
	private isURL(recipeId: string): boolean {
		return recipeId.startsWith("http://") || recipeId.startsWith("https://");
	}

	/**
	 * Check if recipe identifier is an npm package
	 */
	private isNpmPackage(recipeId: string): boolean {
		return (
			/^[@]?[a-z0-9-~][a-z0-9-._~]*\/[a-z0-9-~][a-z0-9-._~]*$/.test(recipeId) ||
			/^[a-z0-9-~][a-z0-9-._~]*$/.test(recipeId)
		);
	}

	/**
	 * Check if recipe identifier is a GitHub repository
	 */
	private isGitHubRepo(recipeId: string): boolean {
		return recipeId.startsWith("github:") || /^[a-zA-Z0-9-_.]+\/[a-zA-Z0-9-_.]+$/.test(recipeId);
	}

	/**
	 * Check if recipe requires network access
	 */
	private isRemoteRecipe(recipeId: string): boolean {
		return this.isURL(recipeId) || this.isGitHubRepo(recipeId);
	}
}

/**
 * Recipe Tool Factory
 */
export class RecipeToolFactory {
	create(name: string = "recipe-tool", options: Record<string, any> = {}): RecipeTool {
		return new RecipeTool(name, options);
	}

	getToolType(): "recipe" {
		return "recipe";
	}

	validateConfig(config: Record<string, any>): ToolValidationResult {
		const errors: string[] = [];
		const warnings: string[] = [];
		const suggestions: string[] = [];

		// Validate cache settings
		if (config.cacheEnabled !== undefined && typeof config.cacheEnabled !== "boolean") {
			warnings.push("cacheEnabled should be a boolean");
		}

		// Validate timeout
		if (config.timeout !== undefined) {
			if (typeof config.timeout !== "number" || config.timeout <= 0) {
				errors.push("timeout must be a positive number");
			}
		}

		// Validate cache directory
		if (config.cacheDirectory !== undefined && typeof config.cacheDirectory !== "string") {
			warnings.push("cacheDirectory should be a string");
		}

		return {
			isValid: errors.length === 0,
			errors,
			warnings,
			suggestions,
		};
	}
}

// Export default instance
export const recipeToolFactory = new RecipeToolFactory();
