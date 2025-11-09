/**
 * Base Tool Framework
 *
 * Abstract base class and interfaces for all Recipe Step System tools.
 * Provides common lifecycle management, error handling, and resource management.
 */

import createDebug from 'debug';
import {
	ErrorCode,
	ErrorHandler,
	HypergenError,
	withErrorHandling,
} from '../../errors/hypergen-errors.js';
import Logger from '../../logger.js';
import type {
	RecipeStepUnion,
	StepContext,
	StepExecutionOptions,
	StepResult,
	ToolType,
} from '../types.js';

const debug = createDebug('hypergen:v8:recipe:tool');

/**
 * Tool execution phase for lifecycle management
 */
export type ToolPhase = 'validate' | 'execute' | 'cleanup';

/**
 * Tool resource management interface
 */
export interface ToolResource {
	/** Resource identifier */
	id: string;

	/** Resource type */
	type: 'file' | 'process' | 'network' | 'memory' | 'cache';

	/** Resource cleanup function */
	cleanup: () => Promise<void> | void;

	/** Resource metadata */
	metadata?: Record<string, any>;
}

/**
 * Tool lifecycle metrics
 */
export interface ToolLifecycleMetrics {
	/** Tool execution start time */
	startTime: Date;

	/** Tool execution end time */
	endTime?: Date;

	/** Total execution duration in milliseconds */
	duration?: number;

	/** Validation duration in milliseconds */
	validationDuration?: number;

	/** Execution duration in milliseconds */
	executionDuration?: number;

	/** Cleanup duration in milliseconds */
	cleanupDuration?: number;

	/** Peak memory usage during execution */
	peakMemoryUsage?: number;

	/** Number of retry attempts */
	retryAttempts: number;

	/** Whether cleanup was completed successfully */
	cleanupCompleted: boolean;

	/** Lifecycle events log */
	events: Array<{
		phase: ToolPhase;
		timestamp: Date;
		success: boolean;
		error?: string;
		metadata?: Record<string, any>;
	}>;
}

/**
 * Tool validation result
 */
export interface ToolValidationResult {
	/** Whether the tool configuration is valid */
	isValid: boolean;

	/** Validation errors */
	errors: string[];

	/** Validation warnings */
	warnings: string[];

	/** Validation suggestions */
	suggestions: string[];

	/** Estimated execution time in milliseconds */
	estimatedExecutionTime?: number;

	/** Resource requirements */
	resourceRequirements?: {
		memory?: number;
		disk?: number;
		network?: boolean;
		processes?: number;
	};
}

/**
 * Abstract base class for all Recipe Step System tools
 *
 * This class provides common functionality for Template, Action, CodeMod, and Recipe tools.
 * Each tool type extends this class to implement specific execution logic.
 */
export abstract class Tool<TStep extends RecipeStepUnion = RecipeStepUnion> {
	protected readonly logger: Logger;
	protected readonly debug: ReturnType<typeof createDebug>;
	protected readonly resources: Map<string, ToolResource> = new Map();
	protected readonly metrics: ToolLifecycleMetrics;
	protected _isInitialized = false;
	protected _isExecuting = false;
	protected _isCleanedUp = false;

	constructor(
		public readonly toolType: ToolType,
		public readonly name: string,
		protected readonly options: Record<string, any> = {},
	) {
		this.logger = new Logger(console.log);
		this.debug = createDebug(`hypergen:v8:recipe:tool:${toolType}:${name}`);

		this.metrics = {
			startTime: new Date(),
			retryAttempts: 0,
			cleanupCompleted: false,
			events: [],
		};

		this.debug('Tool instance created: %s (%s)', name, toolType);
	}

	/**
	 * Get tool type
	 */
	getToolType(): ToolType {
		return this.toolType;
	}

	/**
	 * Get tool name
	 */
	getName(): string {
		return this.name;
	}

	/**
	 * Check if tool is initialized
	 */
	isInitialized(): boolean {
		return this._isInitialized;
	}

	/**
	 * Check if tool is currently executing
	 */
	isExecuting(): boolean {
		return this._isExecuting;
	}

	/**
	 * Check if tool has been cleaned up
	 */
	isCleanedUp(): boolean {
		return this._isCleanedUp;
	}

	/**
	 * Get tool lifecycle metrics
	 */
	getMetrics(): Readonly<ToolLifecycleMetrics> {
		return { ...this.metrics };
	}

	/**
	 * Initialize the tool with configuration
	 * Called once before any execution
	 */
	async initialize(): Promise<void> {
		if (this._isInitialized) {
			this.debug('Tool already initialized, skipping');
			return;
		}

		this.debug('Initializing tool');

		try {
			await withErrorHandling(
				async () => {
					await this.onInitialize();
					this._isInitialized = true;
					this.addLifecycleEvent('validate', true, { phase: 'initialize' });
					this.debug('Tool initialization completed');
				},
				{ function: 'initialize', action: this.name },
			);
		} catch (error) {
			this.addLifecycleEvent('validate', false, {
				phase: 'initialize',
				error: error instanceof Error ? error.message : String(error),
			});
			throw this.wrapError(error, 'Tool initialization failed');
		}
	}

	/**
	 * Validate the step configuration and context
	 */
	async validate(
		step: TStep,
		context: StepContext,
	): Promise<ToolValidationResult> {
		this.debug('Validating step configuration');
		const startTime = Date.now();

		try {
			const result = await withErrorHandling(
				async () => {
					return await this.onValidate(step, context);
				},
				{ function: 'validate', action: this.name },
			);

			const duration = Date.now() - startTime;
			this.metrics.validationDuration = duration;
			this.addLifecycleEvent('validate', result.isValid, {
				duration,
				errorsCount: result.errors.length,
				warningsCount: result.warnings.length,
			});

			this.debug(
				'Validation completed: %s (errors: %d, warnings: %d)',
				result.isValid ? 'valid' : 'invalid',
				result.errors.length,
				result.warnings.length,
			);

			return result;
		} catch (error) {
			const duration = Date.now() - startTime;
			this.metrics.validationDuration = duration;
			this.addLifecycleEvent('validate', false, {
				duration,
				error: error instanceof Error ? error.message : String(error),
			});
			throw this.wrapError(error, 'Tool validation failed');
		}
	}

	/**
	 * Execute the tool with the given step configuration and context
	 */
	async execute(
		step: TStep,
		context: StepContext,
		options?: StepExecutionOptions,
	): Promise<StepResult> {
		if (!this._isInitialized) {
			await this.initialize();
		}

		if (this._isExecuting) {
			throw ErrorHandler.createError(
				ErrorCode.INTERNAL_ERROR,
				'Tool is already executing',
				{ action: this.name, phase: 'execute' },
			);
		}

		this._isExecuting = true;
		const startTime = Date.now();
		this.debug('Starting tool execution');

		try {
			// Update metrics
			this.metrics.startTime = new Date();

			// Apply retry logic if specified
			const maxRetries = options?.retries || step.retries || 0;
			let lastError: any = null;

			for (let attempt = 0; attempt <= maxRetries; attempt++) {
				if (attempt > 0) {
					this.debug('Retry attempt %d/%d', attempt, maxRetries);
					this.metrics.retryAttempts = attempt;

					// Add exponential backoff delay
					const delay = Math.min(1000 * 2 ** (attempt - 1), 30000);
					await new Promise((resolve) => setTimeout(resolve, delay));
				}

				try {
					const result = await withErrorHandling(
						async () => {
							return await this.onExecute(step, context, options);
						},
						{ function: 'execute', action: this.name, phase: 'execute' },
					);

					const executionTime = Date.now() - startTime;
					this.metrics.executionDuration = executionTime;
					this.metrics.endTime = new Date();
					this.metrics.duration = executionTime;

					this.addLifecycleEvent('execute', result.status === 'completed', {
						duration: executionTime,
						attempt,
						filesCreated: result.filesCreated?.length || 0,
						filesModified: result.filesModified?.length || 0,
						filesDeleted: result.filesDeleted?.length || 0,
					});

					this.debug(
						'Tool execution completed successfully: %s (duration: %dms, attempt: %d)',
						result.status,
						executionTime,
						attempt + 1,
					);

					this._isExecuting = false;
					return result;
				} catch (error) {
					lastError = error;
					this.debug(
						'Tool execution failed on attempt %d: %s',
						attempt + 1,
						error instanceof Error ? error.message : String(error),
					);

					// If it's the last attempt, don't continue the retry loop
					if (attempt === maxRetries) {
						break;
					}

					// For certain errors, don't retry
					if (error instanceof HypergenError && !this.shouldRetry(error)) {
						break;
					}
				}
			}

			// If we reach here, all attempts failed
			const executionTime = Date.now() - startTime;
			this.metrics.executionDuration = executionTime;
			this.metrics.endTime = new Date();
			this.metrics.duration = executionTime;

			this.addLifecycleEvent('execute', false, {
				duration: executionTime,
				retryAttempts: this.metrics.retryAttempts,
				error:
					lastError instanceof Error ? lastError.message : String(lastError),
			});

			throw this.wrapError(
				lastError,
				`Tool execution failed after ${maxRetries + 1} attempts`,
			);
		} finally {
			this._isExecuting = false;
		}
	}

	/**
	 * Clean up resources used by the tool
	 */
	async cleanup(): Promise<void> {
		if (this._isCleanedUp) {
			this.debug('Tool already cleaned up, skipping');
			return;
		}

		this.debug('Starting tool cleanup');
		const startTime = Date.now();
		const errors: string[] = [];

		try {
			// Clean up registered resources
			for (const [id, resource] of this.resources) {
				try {
					this.debug('Cleaning up resource: %s (%s)', id, resource.type);
					await resource.cleanup();
				} catch (error) {
					const errorMessage =
						error instanceof Error ? error.message : String(error);
					errors.push(`Failed to cleanup resource '${id}': ${errorMessage}`);
					this.debug('Resource cleanup failed: %s - %s', id, errorMessage);
				}
			}

			// Call tool-specific cleanup
			try {
				await this.onCleanup();
			} catch (error) {
				const errorMessage =
					error instanceof Error ? error.message : String(error);
				errors.push(`Tool cleanup failed: ${errorMessage}`);
				this.debug('Tool cleanup failed: %s', errorMessage);
			}

			const duration = Date.now() - startTime;
			this.metrics.cleanupDuration = duration;
			this.metrics.cleanupCompleted = errors.length === 0;
			this._isCleanedUp = true;

			this.addLifecycleEvent('cleanup', errors.length === 0, {
				duration,
				resourcesCleanedUp: this.resources.size,
				errorsCount: errors.length,
			});

			if (errors.length > 0) {
				this.logger.warn(`Tool cleanup completed with ${errors.length} errors`);
				for (const error of errors) {
					this.logger.warn(`  ${error}`);
				}
			} else {
				this.debug('Tool cleanup completed successfully');
			}

			// Clear resources map
			this.resources.clear();
		} catch (error) {
			const duration = Date.now() - startTime;
			this.metrics.cleanupDuration = duration;
			this.addLifecycleEvent('cleanup', false, {
				duration,
				error: error instanceof Error ? error.message : String(error),
			});
			throw this.wrapError(error, 'Tool cleanup failed');
		}
	}

	/**
	 * Register a resource for cleanup
	 */
	protected registerResource(resource: ToolResource): void {
		if (this.resources.has(resource.id)) {
			this.debug('Resource already registered, replacing: %s', resource.id);
		}

		this.resources.set(resource.id, resource);
		this.debug('Resource registered: %s (%s)', resource.id, resource.type);
	}

	/**
	 * Unregister a resource (useful for early cleanup)
	 */
	protected unregisterResource(resourceId: string): void {
		const resource = this.resources.get(resourceId);
		if (resource) {
			this.resources.delete(resourceId);
			this.debug('Resource unregistered: %s', resourceId);
		}
	}

	/**
	 * Get memory usage statistics
	 */
	protected getMemoryUsage(): { used: number; total: number } {
		const usage = process.memoryUsage();
		return {
			used: usage.heapUsed,
			total: usage.heapTotal,
		};
	}

	/**
	 * Add a lifecycle event to metrics
	 */
	private addLifecycleEvent(
		phase: ToolPhase,
		success: boolean,
		metadata?: Record<string, any>,
	): void {
		this.metrics.events.push({
			phase,
			timestamp: new Date(),
			success,
			error: metadata?.error,
			metadata,
		});

		// Track peak memory usage
		const memUsage = this.getMemoryUsage();
		if (
			!this.metrics.peakMemoryUsage ||
			memUsage.used > this.metrics.peakMemoryUsage
		) {
			this.metrics.peakMemoryUsage = memUsage.used;
		}
	}

	/**
	 * Determine if an error should trigger a retry
	 */
	private shouldRetry(error: HypergenError): boolean {
		// Don't retry configuration or validation errors
		const nonRetryableCodes = [
			ErrorCode.CONFIG_INVALID_FORMAT,
			ErrorCode.CONFIG_MISSING_REQUIRED,
			ErrorCode.TEMPLATE_INVALID_SYNTAX,
			ErrorCode.TEMPLATE_INVALID_FRONTMATTER,
			ErrorCode.ACTION_INVALID_PARAMETERS,
			ErrorCode.ACTION_INVALID_PARAM_TYPE,
			ErrorCode.ACTION_INVALID_PARAM_VALUE,
			ErrorCode.VALIDATION_ERROR,
		];

		return !nonRetryableCodes.includes(error.code);
	}

	/**
	 * Wrap an error with tool context
	 */
	private wrapError(error: any, message: string): HypergenError {
		if (error instanceof HypergenError) {
			// Add tool context to existing error
			error.context = {
				...error.context,
				toolType: this.toolType,
				toolName: this.name,
				phase: 'execute',
			};
			return error;
		}

		return ErrorHandler.createError(
			ErrorCode.INTERNAL_ERROR,
			`${message}: ${error instanceof Error ? error.message : String(error)}`,
			{
				toolType: this.toolType,
				toolName: this.name,
				phase: 'execute',
				cause: error,
			},
		);
	}

	// Abstract methods that must be implemented by concrete tool classes

	/**
	 * Tool-specific initialization logic
	 * Override this method to perform any setup required before execution
	 */
	protected async onInitialize(): Promise<void> {
		// Default implementation does nothing
	}

	/**
	 * Tool-specific validation logic
	 * Must be implemented by concrete tool classes
	 */
	protected abstract onValidate(
		step: TStep,
		context: StepContext,
	): Promise<ToolValidationResult>;

	/**
	 * Tool-specific execution logic
	 * Must be implemented by concrete tool classes
	 */
	protected abstract onExecute(
		step: TStep,
		context: StepContext,
		options?: StepExecutionOptions,
	): Promise<StepResult>;

	/**
	 * Tool-specific cleanup logic
	 * Override this method to perform any cleanup required after execution
	 */
	protected async onCleanup(): Promise<void> {
		// Default implementation does nothing
	}
}

/**
 * Tool factory interface for creating tool instances
 */
export interface ToolFactory<TStep extends RecipeStepUnion = RecipeStepUnion> {
	/**
	 * Create a new tool instance
	 */
	create(name: string, options?: Record<string, any>): Tool<TStep>;

	/**
	 * Get the tool type this factory creates
	 */
	getToolType(): ToolType;

	/**
	 * Validate tool configuration before creation
	 */
	validateConfig(config: Record<string, any>): ToolValidationResult;
}

/**
 * Abstract base class for tool factories
 */
export abstract class BaseToolFactory<
	TStep extends RecipeStepUnion = RecipeStepUnion,
> implements ToolFactory<TStep>
{
	constructor(protected readonly toolType: ToolType) {}

	getToolType(): ToolType {
		return this.toolType;
	}

	abstract create(name: string, options?: Record<string, any>): Tool<TStep>;

	validateConfig(config: Record<string, any>): ToolValidationResult {
		// Default validation - can be overridden by concrete factories
		return {
			isValid: true,
			errors: [],
			warnings: [],
			suggestions: [],
		};
	}
}
