import { EventEmitter } from 'node:events';
import createDebug from 'debug';
import { ErrorCode, ErrorHandler } from '../../errors/hypergen-errors.js';
import type Logger from '../../logger.js';
import type { Tool } from '../tools/base.js';
import { type ToolRegistry, getToolRegistry } from '../tools/registry.js';
import {
	type ActionStep,
	type CodeModStep,
	type RecipeStepUnion,
	type StepContext,
	StepExecutionError,
	type StepExecutionOptions,
	type StepExecutorConfig,
	type StepResult,
	type TemplateStep,
	type ToolType,
	isActionStep,
	isCodeModStep,
	isRecipeStep,
	isTemplateStep,
} from './step-executor-types.js';

const debug = createDebug('hypergen:v8:recipe:step-runner');

export class StepRunner extends EventEmitter {
	private readonly toolRegistry: ToolRegistry;
	private readonly logger: Logger;
	private readonly debug: ReturnType<typeof createDebug>;
	private readonly config: StepExecutorConfig;

	constructor(
		toolRegistry: ToolRegistry,
		logger: Logger,
		config: StepExecutorConfig,
	) {
		super();
		this.toolRegistry = toolRegistry;
		this.logger = logger;
		this.debug = debug;
		this.config = config;
	}

	async executeStep(
		step: RecipeStepUnion,
		context: StepContext,
		options: StepExecutionOptions = {},
	): Promise<StepResult> {
		const stepStartTime = Date.now();
		const stepResult: StepResult = {
			status: 'pending',
			stepName: step.name,
			toolType: step.tool,
			startTime: new Date(),
			retryCount: 0,
			dependenciesSatisfied: true, // Single step execution assumes deps are satisfied
			conditionResult: true,
		};

		this.debug('Executing single step: %s (%s)', step.name, step.tool);
		this.emit('step:started', { step: step.name, toolType: step.tool });

		try {
			stepResult.status = 'running';

			// Evaluate condition if present
			if (step.when) {
				stepResult.conditionResult = context.evaluateCondition(
					step.when,
					context.variables,
				);

				if (!stepResult.conditionResult) {
					this.debug('Step condition not met, skipping: %s', step.name);
					stepResult.status = 'skipped';
					stepResult.endTime = new Date();
					stepResult.duration = Date.now() - stepStartTime;

					this.emit('step:skipped', {
						step: step.name,
						condition: step.when,
					});
					return stepResult;
				}
			}

			// Execute step with retries
			const maxRetries =
				options.retries ?? step.retries ?? this.config.defaultRetries;
			let lastError: Error | undefined;

			for (let attempt = 0; attempt <= maxRetries; attempt++) {
				try {
					stepResult.retryCount = attempt;

					if (attempt > 0) {
						this.debug(
							'Retrying step: %s (attempt %d/%d)',
							step.name,
							attempt + 1,
							maxRetries + 1,
						);
						await this.delay(this.calculateRetryDelay(attempt));
					}

					// Route to appropriate tool and execute
					const toolResult = await this.routeAndExecuteStep(
						step,
						context,
						options,
					);

					stepResult.toolResult = toolResult;
					stepResult.status = 'completed';
					stepResult.endTime = new Date();
					stepResult.duration = Date.now() - stepStartTime;

					// Extract file changes from tool result
					this.extractFileChanges(stepResult, toolResult);

					this.debug(
						'Step completed successfully: %s in %dms',
						step.name,
						stepResult.duration,
					);
					this.emit('step:completed', {
						step: step.name,
						toolType: step.tool,
						duration: stepResult.duration,
						retries: attempt,
					});

					return stepResult;
				} catch (error) {
					lastError = error instanceof Error ? error : new Error(String(error));

					if (attempt < maxRetries) {
						this.debug(
							'Step failed, will retry: %s - %s',
							step.name,
							lastError.message,
						);
						this.emit('step:retry', {
							step: step.name,
							attempt: attempt + 1,
							error: lastError,
						});
					}
				}
			}

			// All retries exhausted
			stepResult.status = 'failed';
			stepResult.endTime = new Date();
			stepResult.duration = Date.now() - stepStartTime;
			stepResult.error = {
				message: lastError?.message || 'Step execution failed',
				stack: lastError?.stack,
				cause: lastError,
			};

			this.debug(
				'Step failed permanently: %s after %d retries',
				step.name,
				maxRetries,
			);
			this.emit('step:failed', {
				step: step.name,
				toolType: step.tool,
				error: lastError,
				retries: maxRetries,
			});

			throw new StepExecutionError(
				`Step '${step.name}' failed after ${maxRetries} retries: ${lastError?.message}`,
				step.name,
				step.tool,
				lastError,
			);
		} catch (error) {
			if (stepResult.status !== 'failed') {
				stepResult.status = 'failed';
				stepResult.endTime = new Date();
				stepResult.duration = Date.now() - stepStartTime;
				stepResult.error = {
					message: error instanceof Error ? error.message : String(error),
					stack: error instanceof Error ? error.stack : undefined,
					cause: error,
				};
			}

			throw error;
		}
	}

	private async routeAndExecuteStep(
		step: RecipeStepUnion,
		context: StepContext,
		options: StepExecutionOptions,
	): Promise<any> {
		const toolName = this.getToolName(step);
		const tool = await this.toolRegistry.resolve(step.tool, toolName);

		this.debug(
			'Routing step to tool: %s -> %s:%s',
			step.name,
			step.tool,
			toolName,
		);

		try {
			// Initialize tool if needed
			if (!tool.isInitialized()) {
				await tool.initialize();
			}

			// Validate step configuration
			const validation = await tool.validate(step, context);
			if (!validation.isValid) {
				throw ErrorHandler.createError(
					ErrorCode.VALIDATION_ERROR,
					`Step validation failed: ${validation.errors.join(', ')}`,
					{ step: step.name, tool: step.tool, errors: validation.errors },
				);
			}

			// Execute step through tool
			const result = await tool.execute(step, context);

			this.debug('Tool execution completed: %s', step.name);
			return result;
		} finally {
			// Release tool back to registry
			this.toolRegistry.release(step.tool, toolName, tool);
		}
	}

	private getToolName(step: RecipeStepUnion): string {
		// Route to appropriate tool based on step type
		if (isTemplateStep(step)) {
			return step.template;
		}
		if (isActionStep(step)) {
			return step.action;
		}
		if (isCodeModStep(step)) {
			return step.codemod;
		}
		if (isRecipeStep(step)) {
			return step.recipe;
		}
		throw ErrorHandler.createError(
			ErrorCode.VALIDATION_ERROR,
			`Unknown step type: ${(step as any).tool}`,
			{ step: (step as any).name },
		);
	}

	private extractFileChanges(result: StepResult, toolResult: any): void {
		// Extract file changes from tool result based on result type
		if (toolResult && typeof toolResult === 'object') {
			if (toolResult.filesGenerated) {
				result.filesCreated = toolResult.filesGenerated;
			}
			if (toolResult.filesProcessed) {
				result.filesModified = toolResult.filesProcessed;
			}
			if (toolResult.filesCreated) {
				result.filesCreated = toolResult.filesCreated;
			}
			if (toolResult.filesModified) {
				result.filesModified = toolResult.filesModified;
			}
			if (toolResult.filesDeleted) {
				result.filesDeleted = toolResult.filesDeleted;
			}
		}
	}

	private calculateRetryDelay(attempt: number): number {
		// Exponential backoff with jitter
		const baseDelay = 1000; // 1 second
		const maxDelay = 30000; // 30 seconds

		let delay = Math.min(baseDelay * 2 ** attempt, maxDelay);

		// Add jitter (±25%)
		const jitter = delay * 0.25 * (Math.random() - 0.5);
		delay += jitter;

		return Math.max(delay, 100); // Minimum 100ms delay
	}

	private delay(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}
}
