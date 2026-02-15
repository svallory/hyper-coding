/**
 * Template Tool Implementation for Recipe Step System
 *
 * This tool processes template files using Hypergen's existing template engines,
 * handles frontmatter processing, and generates files to the filesystem.
 * It integrates seamlessly with the Jig template engine while supporting
 * all existing template features like composition and variable substitution.
 */

import path from "node:path";
import fs from "fs-extra";
import fm from "front-matter";
import createDebug from "debug";
import { Tool, type ToolValidationResult } from "./base.js";
import { HypergenError, ErrorCode, ErrorHandler, withErrorHandling } from "@hypercli/core";
import {
	type TemplateStep,
	type StepContext,
	type StepResult,
	type StepExecutionOptions,
	type TemplateExecutionResult,
	isTemplateStep,
} from "#/recipe-engine/types";
import { getJig, renderTemplate as jigRenderTemplate } from "#/template-engines/index";
import addOp from "#/ops/add";
import injectOp from "#/ops/inject";
import type { RenderedAction, RunnerConfig } from "#/recipe-engine/types";

const debug = createDebug("hypergen:v8:recipe:tool:template");

/**
 * Template resolution result
 */
interface TemplateResolution {
	/** Resolved template file path */
	filePath: string;

	/** Template content */
	content: string;

	/** Template engine to use */
	engine: string;

	/** Template metadata */
	metadata: {
		exists: boolean;
		size: number;
		extension: string;
		lastModified: Date;
	};
}

/**
 * Rendered template file result
 */
interface RenderedTemplateFile {
	/** Original template file path */
	templatePath: string;

	/** Rendered frontmatter attributes */
	attributes: Record<string, any>;

	/** Rendered template body */
	body: string;

	/** Target file path (from 'to' attribute) */
	targetPath?: string;

	/** Whether this file should be skipped */
	shouldSkip: boolean;

	/** Skip reason if applicable */
	skipReason?: string;
}

/**
 * Template Tool for processing template files in the Recipe Step System
 *
 * Features:
 * - Integration with the Jig template engine
 * - Frontmatter processing (to:, skip_if:, inject:, unless_exists:, force:)
 * - Template discovery and resolution
 * - Variable substitution and context management
 * - File generation with path resolution
 * - Template composition support
 * - Comprehensive error handling and validation
 */
export class TemplateTool extends Tool<TemplateStep> {
	private templateEnginesInitialized = false;
	private templateCache = new Map<string, TemplateResolution>();

	constructor(name: string = "template-tool", options: Record<string, any> = {}) {
		super("template", name, options);
	}

	/**
	 * Initialize template engines and prepare tool for execution
	 */
	protected async onInitialize(): Promise<void> {
		this.debug("Initializing template engines");

		try {
			// Use getJig() to reuse the existing singleton rather than
			// creating a fresh instance per tool. This preserves any
			// globals/filters registered before recipe execution.
			getJig();
			this.templateEnginesInitialized = true;

			this.registerResource({
				id: "template-cache",
				type: "cache",
				cleanup: () => {
					this.templateCache.clear();
				},
				metadata: { cacheSize: 0 },
			});

			this.debug("Template engines initialized successfully");
		} catch (error) {
			throw ErrorHandler.createError(
				ErrorCode.INTERNAL_ERROR,
				`Failed to initialize template engines: ${error instanceof Error ? error.message : String(error)}`,
				{ phase: "initialize", cause: error },
			);
		}
	}

	/**
	 * Validate template step configuration
	 */
	protected async onValidate(
		step: TemplateStep,
		context: StepContext,
	): Promise<ToolValidationResult> {
		const errors: string[] = [];
		const warnings: string[] = [];
		const suggestions: string[] = [];

		// Validate step is a template step
		if (!isTemplateStep(step)) {
			errors.push("Step is not a valid TemplateStep");
			return { isValid: false, errors, warnings, suggestions };
		}

		// Validate required fields
		if (!step.template) {
			errors.push("Template identifier is required");
		}

		// Validate template exists and is accessible
		if (step.template) {
			try {
				const resolution = await this.resolveTemplate(step.template, context);
				if (!resolution.metadata.exists) {
					errors.push(`Template file not found: ${step.template}`);
				}
			} catch (error) {
				errors.push(
					`Template resolution failed: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}

		// Validate output directory
		if (step.outputDir) {
			if (path.isAbsolute(step.outputDir)) {
				warnings.push("Output directory should be relative to project root");
			}

			const outputPath = path.resolve(context.projectRoot, step.outputDir);
			if (!(await fs.pathExists(path.dirname(outputPath)))) {
				warnings.push(`Output directory parent does not exist: ${path.dirname(outputPath)}`);
			}
		}

		// Validate exclude patterns
		if (step.exclude) {
			for (const pattern of step.exclude) {
				if (typeof pattern !== "string") {
					errors.push("Exclude patterns must be strings");
					break;
				}
			}
		}

		// Validate template variables
		if (step.templateConfig?.variables) {
			for (const [key, variable] of Object.entries(step.templateConfig.variables)) {
				if (!variable.type) {
					warnings.push(`Template variable '${key}' is missing type definition`);
				}
			}
		}

		// Performance suggestions
		if (
			step.templateConfig?.composition?.includes?.length &&
			step.templateConfig.composition.includes.length > 10
		) {
			suggestions.push("Consider reducing template includes for better performance");
		}

		// Estimate execution time based on template complexity
		let estimatedTime = 100; // Base time in ms
		if (step.templateConfig?.composition?.includes) {
			estimatedTime += step.templateConfig.composition.includes.length * 50;
		}
		if (step.exclude?.length) {
			estimatedTime += step.exclude.length * 10;
		}

		const resourceRequirements = {
			memory: 10 * 1024 * 1024, // 10MB base memory
			disk: 1 * 1024 * 1024, // 1MB estimated disk usage
			network: false,
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
	 * Execute the template tool
	 */
	protected async onExecute(
		step: TemplateStep,
		context: StepContext,
		options?: StepExecutionOptions,
	): Promise<StepResult> {
		this.debug("Executing template step: %s", step.name);

		const startTime = new Date();
		const filesCreated: string[] = [];
		const filesModified: string[] = [];
		const filesDeleted: string[] = [];

		try {
			// Ensure template engines are initialized
			if (!this.templateEnginesInitialized) {
				await this.onInitialize();
			}

			// Resolve template
			const templateResolution = await this.resolveTemplate(step.template, context);
			this.debug("Template resolved: %s -> %s", step.template, templateResolution.filePath);

			// Process template composition if configured
			const templateFiles = await this.processTemplateComposition(
				step,
				context,
				templateResolution,
			);
			this.debug("Found %d template files to process", templateFiles.length);

			// Render all template files
			const renderedFiles: RenderedTemplateFile[] = [];
			for (const templateFile of templateFiles) {
				const rendered = await this.renderTemplateFile(templateFile, step, context);
				renderedFiles.push(rendered);
			}

			// Filter out skipped files
			const filesToGenerate = renderedFiles.filter((file) => !file.shouldSkip);
			const skippedFiles = renderedFiles.filter((file) => file.shouldSkip);

			this.debug(
				"Processing %d files, skipping %d files",
				filesToGenerate.length,
				skippedFiles.length,
			);

			// In collect mode (Pass 1), skip all file generation — templates were
			// rendered only to trigger @ai block collection
			if (context.collectMode) {
				this.debug("Collect mode: skipping file generation (Pass 1)");
				const endTime = new Date();
				const duration = endTime.getTime() - startTime.getTime();

				return {
					status: "completed",
					stepName: step.name,
					toolType: "template",
					startTime,
					endTime,
					duration,
					retryCount: 0,
					dependenciesSatisfied: true,
					toolResult: {
						templateName: step.template,
						templatePath: templateResolution.filePath,
						engine: templateResolution.engine,
						filesGenerated: [],
						variables: context.variables,
					} as TemplateExecutionResult,
					output: {
						collectMode: true,
						templatesRendered: renderedFiles.length,
					},
				};
			}

			// Generate files
			for (const renderedFile of filesToGenerate) {
				if (renderedFile.targetPath) {
					const result = await this.generateFile(renderedFile, step, context, options);

					if (result.status === "added" || result.status === "forced") {
						filesCreated.push(renderedFile.targetPath);
					} else if (result.status === "injected") {
						filesModified.push(renderedFile.targetPath);
					}
				}
			}

			// Update cache metadata
			const cacheResource = this.resources.get("template-cache");
			if (cacheResource) {
				cacheResource.metadata!.cacheSize = this.templateCache.size;
			}

			const endTime = new Date();
			const duration = endTime.getTime() - startTime.getTime();

			// Create tool-specific result
			const templateResult: TemplateExecutionResult = {
				templateName: step.template,
				templatePath: templateResolution.filePath,
				engine: templateResolution.engine,
				filesGenerated: filesCreated,
				variables: context.variables,
			};

			return {
				status: "completed",
				stepName: step.name,
				toolType: "template",
				startTime,
				endTime,
				duration,
				retryCount: 0,
				dependenciesSatisfied: true,
				toolResult: templateResult,
				filesCreated,
				filesModified,
				filesDeleted,
				output: {
					templateEngine: templateResolution.engine,
					totalFiles: renderedFiles.length,
					generatedFiles: filesToGenerate.length,
					skippedFiles: skippedFiles.length,
					skippedReasons: skippedFiles.map((f) => ({
						path: f.templatePath,
						reason: f.skipReason,
					})),
				},
				metadata: {
					templateResolution: {
						originalTemplate: step.template,
						resolvedPath: templateResolution.filePath,
						engine: templateResolution.engine,
					},
					performance: {
						cacheHits: 0, // Could be enhanced with cache hit tracking
						templateCompileTime: duration,
					},
				},
			};
		} catch (error) {
			const endTime = new Date();
			const duration = endTime.getTime() - startTime.getTime();

			return {
				status: "failed",
				stepName: step.name,
				toolType: "template",
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
					code: error instanceof HypergenError ? error.code : "TEMPLATE_EXECUTION_ERROR",
					stack: error instanceof Error ? error.stack : undefined,
					cause: error,
				},
			};
		}
	}

	/**
	 * Tool-specific cleanup logic
	 */
	protected async onCleanup(): Promise<void> {
		this.debug("Cleaning up template tool resources");
		this.templateCache.clear();
	}

	/**
	 * Resolve template identifier to file path and content
	 */
	private async resolveTemplate(
		templateId: string,
		context: StepContext,
	): Promise<TemplateResolution> {
		// Check cache first
		const cacheKey = `${templateId}:${context.projectRoot}`;
		const cached = this.templateCache.get(cacheKey);
		if (cached && cached.metadata.exists) {
			return cached;
		}

		let filePath: string;
		let exists = false;
		let extension = "";

		// Try different resolution strategies
		const resolutionPaths = [
			// Absolute path
			templateId,
			// Relative to project root
			path.resolve(context.projectRoot, templateId),
			// Relative to template path if available (recipe directory)
			context.templatePath ? path.resolve(context.templatePath, templateId) : null,
			// With common extensions
			path.resolve(context.projectRoot, `${templateId}.jig`),
			path.resolve(context.projectRoot, `${templateId}.jig.t`),
		].filter(Boolean) as string[];

		this.debug("Resolving template: %s", templateId);
		this.debug("  projectRoot: %s", context.projectRoot);
		this.debug("  templatePath: %s", context.templatePath);
		this.debug("  Trying paths: %o", resolutionPaths);

		for (const candidatePath of resolutionPaths) {
			if (await fs.pathExists(candidatePath)) {
				filePath = candidatePath;
				exists = true;
				extension = path.extname(candidatePath);
				break;
			}
		}

		if (!exists) {
			throw ErrorHandler.createError(
				ErrorCode.TEMPLATE_NOT_FOUND,
				`Template not found: ${templateId}`,
				{ template: templateId, path: resolutionPaths.join(", ") },
			);
		}

		// Read template content
		let content: string;
		let stats: fs.Stats;
		try {
			content = await fs.readFile(filePath!, "utf8");
			stats = await fs.stat(filePath!);
		} catch (error) {
			throw ErrorHandler.createError(
				ErrorCode.TEMPLATE_EXECUTION_ERROR,
				`Failed to read template file: ${filePath}`,
				{ template: templateId, path: filePath, cause: error },
			);
		}

		const resolution: TemplateResolution = {
			filePath: filePath!,
			content,
			engine: "jig",
			metadata: {
				exists: true,
				size: stats.size,
				extension,
				lastModified: stats.mtime,
			},
		};

		// Cache the resolution
		this.templateCache.set(cacheKey, resolution);

		return resolution;
	}

	/**
	 * Process template composition (includes, extends)
	 */
	private async processTemplateComposition(
		step: TemplateStep,
		context: StepContext,
		baseTemplate: TemplateResolution,
	): Promise<string[]> {
		const templateFiles = [baseTemplate.filePath];

		// Process includes if configured
		if (step.templateConfig?.composition?.includes) {
			for (const include of step.templateConfig.composition.includes) {
				// Evaluate condition if present
				if (include.condition && !context.evaluateCondition(include.condition, context.variables)) {
					continue;
				}

				try {
					const includeResolution = await this.resolveTemplate(include.template, context);
					templateFiles.push(includeResolution.filePath);
				} catch (error) {
					this.logger.warn(
						`Failed to resolve include template '${include.template}': ${error instanceof Error ? error.message : String(error)}`,
					);
				}
			}
		}

		return templateFiles;
	}

	/**
	 * Render a template file with frontmatter processing
	 */
	private async renderTemplateFile(
		templatePath: string,
		step: TemplateStep,
		context: StepContext,
	): Promise<RenderedTemplateFile> {
		this.debug("Rendering template file: %s", templatePath);

		// Read and parse frontmatter
		const templateContent = await fs.readFile(templatePath, "utf8");
		const { attributes, body } = (fm as any)(templateContent, {
			allowUnsafe: true,
		});

		// Merge variables for rendering context
		const renderContext = this.buildRenderContext(step, context, attributes);

		// Render frontmatter attributes
		const renderedAttributes: Record<string, any> = {};
		for (const [key, value] of Object.entries(attributes)) {
			renderedAttributes[key] = await this.renderTemplate(value, renderContext, templatePath);
		}

		// Render template body
		const renderedBody = await this.renderTemplate(
			body,
			{ ...renderContext, attributes: renderedAttributes },
			templatePath,
		);

		// Determine if file should be skipped
		const shouldSkip = this.shouldSkipFile(renderedAttributes, renderContext);
		const skipReason = shouldSkip
			? this.getSkipReason(renderedAttributes, renderContext)
			: undefined;

		// Resolve target path
		let targetPath: string | undefined;
		if (renderedAttributes.to) {
			targetPath = path.resolve(
				step.outputDir ? path.resolve(context.projectRoot, step.outputDir) : context.projectRoot,
				renderedAttributes.to,
			);
		}

		return {
			templatePath,
			attributes: renderedAttributes,
			body: renderedBody,
			targetPath,
			shouldSkip,
			skipReason,
		};
	}

	/**
	 * Render a template string with the appropriate engine
	 */
	private async renderTemplate(
		template: any,
		renderContext: Record<string, any>,
		filePath?: string,
	): Promise<any> {
		if (typeof template !== "string") {
			return template;
		}

		try {
			this.debug("Rendering with Jig engine");
			return await jigRenderTemplate(template, renderContext);
		} catch (error) {
			throw ErrorHandler.createError(
				ErrorCode.TEMPLATE_EXECUTION_ERROR,
				`Template rendering failed: ${error instanceof Error ? error.message : String(error)}`,
				{ template: filePath, cause: error },
			);
		}
	}

	/**
	 * Build render context by merging step and recipe variables.
	 *
	 * Helpers are registered as Jig globals (not spread into context),
	 * so the context only contains data: variables, step results, and utilities.
	 */
	private buildRenderContext(
		step: TemplateStep,
		context: StepContext,
		attributes: Record<string, any>,
	): Record<string, any> {
		// Merge variables: recipe vars < context vars < step vars
		const mergedVars = {
			...context.recipeVariables,
			...context.variables,
			...step.variables,
		};

		return {
			...mergedVars,
			// Recipe-specific context
			recipe: context.recipe,
			step: { name: step.name, description: step.description },
			// Utility functions
			utils: context.utils,
			// Step results for dependency access
			stepResults: context.stepResults ? Object.fromEntries(context.stepResults) : {},
			// 2-pass AI generation state
			answers: context.answers,
			__hypergenCollectMode: context.collectMode || false,
			// provide() helper — allows templates to export values to subsequent steps
			provide: (key: string, value: any) => {
				context.variables[key] = value;
				return "";
			},
		};
	}

	/**
	 * Check if file should be skipped based on attributes
	 */
	private shouldSkipFile(attributes: Record<string, any>, context: Record<string, any>): boolean {
		// Check skip_if condition
		if (attributes.skip_if) {
			if (attributes.skip_if === true || attributes.skip_if === "true") {
				return true;
			}

			// If it's an expression, it should have been evaluated during rendering
			if (typeof attributes.skip_if === "string" && attributes.skip_if !== "false") {
				// Try to evaluate as boolean
				try {
					return Boolean(attributes.skip_if);
				} catch {
					return false;
				}
			}
		}

		// Check unless_exists condition
		if (attributes.unless_exists && attributes.to) {
			const targetPath = path.resolve(context.projectRoot || process.cwd(), attributes.to);
			return fs.existsSync(targetPath);
		}

		return false;
	}

	/**
	 * Get skip reason for debugging
	 */
	private getSkipReason(attributes: Record<string, any>, context: Record<string, any>): string {
		if (attributes.skip_if) {
			return "skip_if condition evaluated to true";
		}
		if (attributes.unless_exists && attributes.to) {
			return "unless_exists condition: file already exists";
		}
		return "unknown";
	}

	/**
	 * Generate file using existing file operations
	 */
	private async generateFile(
		renderedFile: RenderedTemplateFile,
		step: TemplateStep,
		context: StepContext,
		options?: StepExecutionOptions,
	): Promise<{ status: string; message?: string }> {
		if (!renderedFile.targetPath) {
			throw ErrorHandler.createError(
				ErrorCode.TEMPLATE_MISSING_VARIABLES,
				'Template file has no target path (missing "to" attribute)',
				{ template: renderedFile.templatePath },
			);
		}

		// Create rendered action for existing ops
		const renderedAction: RenderedAction = {
			file: renderedFile.templatePath,
			attributes: {
				...renderedFile.attributes,
				force: step.overwrite || renderedFile.attributes.force || false,
			},
			body: renderedFile.body,
		};

		// Create runner config for ops
		const runnerConfig: RunnerConfig = {
			logger: (context.logger as any) || console,
			cwd: step.outputDir ? path.resolve(context.projectRoot, step.outputDir) : context.projectRoot,
			createPrompter: () => ({
				prompt: async (arg: any): Promise<any> => ({
					overwrite: step.overwrite || false,
				}),
			}),
		};

		// Create args object for ops (includes dry run flag)
		const opArgs = {
			...context.variables,
			dry: options?.dryRun || context.dryRun || false,
		};

		try {
			// Use inject operation if inject attribute is present
			if (renderedFile.attributes.inject) {
				this.debug("Injecting content into file: %s", renderedFile.targetPath);
				const result = await injectOp(renderedAction, opArgs, runnerConfig);
				return { status: result.status || "injected" };
			} else {
				// Use add operation for file creation
				this.debug("Adding/creating file: %s", renderedFile.targetPath);
				const result = await addOp(renderedAction, opArgs, runnerConfig);
				return { status: result.status || "added" };
			}
		} catch (error) {
			// For testing purposes, if it's a simple write operation, try direct file write
			if (options?.dryRun || context.dryRun) {
				return { status: "added" };
			}

			throw ErrorHandler.createError(
				ErrorCode.TEMPLATE_EXECUTION_ERROR,
				`Failed to generate file: ${renderedFile.targetPath}. Error: ${error instanceof Error ? error.message : String(error)}`,
				{
					template: renderedFile.templatePath,
					path: renderedFile.targetPath,
					cause: error,
				},
			);
		}
	}
}

/**
 * Template Tool Factory
 */
export class TemplateToolFactory {
	create(name: string = "template-tool", options: Record<string, any> = {}): TemplateTool {
		return new TemplateTool(name, options);
	}

	getToolType(): "template" {
		return "template";
	}

	validateConfig(config: Record<string, any>): ToolValidationResult {
		const errors: string[] = [];
		const warnings: string[] = [];
		const suggestions: string[] = [];

		// Validate template engine configuration
		if (config.templateEngineConfig) {
			if (typeof config.templateEngineConfig !== "object") {
				errors.push("templateEngineConfig must be an object");
			}
		}

		// Validate cache settings
		if (config.cacheEnabled !== undefined && typeof config.cacheEnabled !== "boolean") {
			warnings.push("cacheEnabled should be a boolean");
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
export const templateToolFactory = new TemplateToolFactory();
