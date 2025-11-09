/**
 * Step Executor for Recipe Step System
 *
 * Orchestrates the execution of recipe steps with proper dependency management,
 * conditional logic, and parallel execution capabilities. This is the core
 * coordination layer that brings together all recipe tools.
 */

import { EventEmitter } from 'node:events';
import createDebug from 'debug';
import {
	ErrorCode,
	ErrorHandler,
	HypergenError,
} from '../../errors/hypergen-errors.js';
import Logger from '../../logger.js';
import { DEFAULT_CONFIG } from '../config.js';
import type { Tool } from '../tools/base.js';
import { type ToolRegistry, getToolRegistry } from '../tools/registry.js';
import { CancellationManager } from './cancellation.js';
import { DependencyResolver } from './dependency-resolver.js';
import { MetricsTracker } from './metrics-tracker.js';
import type {
	RecipeStepUnion,
	StepContext,
	StepExecutionMetrics,
	StepExecutionOptions,
	StepExecutionProgress,
	StepExecutorConfig,
	StepResult,
} from './step-executor-types.js';
import { StepRunner } from './step-runner.js';
import { validateContext, validateSteps } from './step-validation.js';

/**
 * Step Executor for orchestrating recipe step execution
 *
 * The StepExecutor is responsible for:
 * - Managing step dependencies and execution order
 * - Coordinating parallel step execution
 * - Evaluating conditional expressions
 * - Routing steps to appropriate tools
 * - Handling errors and retries
 * - Tracking execution progress and metrics
 */
export class StepExecutor extends EventEmitter {
	private readonly toolRegistry: ToolRegistry;

	private readonly logger: Logger;

	private readonly debug: ReturnType<typeof createDebug>;

	private readonly config: StepExecutorConfig;

	private readonly dependencyResolver: DependencyResolver;

	private readonly stepRunner: StepRunner;

	private readonly metricsTracker: MetricsTracker;

	private readonly cancellationManager: CancellationManager;

	// Execution state
	private readonly activeExecutions = new Map<string, Promise<StepResult[]>>();

	private readonly runningSteps = new Map<
		string,
		{ step: RecipeStepUnion; startTime: Date; tool: Tool }
	>();

	private executionCounter = 0;

	// Metrics and progress tracking
	// private metrics?: StepExecutionMetrics; // Removed, now managed by MetricsTracker
	// private progress?: StepExecutionProgress; // Removed, now managed by MetricsTracker

	constructor(
		toolRegistry?: ToolRegistry,
		config: Partial<StepExecutorConfig> = {},
	) {
		super();

		this.toolRegistry = toolRegistry || getToolRegistry();
		this.logger = new Logger(console.log);
		this.debug = createDebug('hypergen:v8:recipe:step-executor');
		this.config = { ...DEFAULT_CONFIG, ...config } as StepExecutorConfig;
		this.metricsTracker = new MetricsTracker(this.config);
		this.dependencyResolver = new DependencyResolver(
			this.config,
			this.metricsTracker.currentMetrics,
		);
		this.stepRunner = new StepRunner(
			this.toolRegistry,
			this.logger,
			this.config,
		);
		this.cancellationManager = new CancellationManager(
			this.activeExecutions,
			this.runningSteps,
			this.toolRegistry,
		); // Instantiate CancellationManager

		this.debug('Step executor initialized with config: %o', this.config);
	}

	/**
	 * Execute a list of recipe steps with dependency management and parallel execution
	 */
	async executeSteps(
		steps: RecipeStepUnion[],
		context: StepContext,
		options: StepExecutionOptions = {},
	): Promise<StepResult[]> {
		const executionId = this.generateExecutionId();
		const startTime = Date.now();

		this.debug(
			'Starting step execution [%s] with %d steps',
			executionId,
			steps.length,
		);
		this.emit('execution:started', { executionId, steps: steps.length });

		try {
			// Initialize metrics and progress tracking
			if (this.config.collectMetrics) {
				this.metricsTracker.initializeMetrics();
			}

			if (this.config.enableProgressTracking) {
				this.metricsTracker.initializeProgress(steps.length);
			}

			// Validate steps and context
			validateSteps(steps);
			validateContext(context);

			// Create execution plan with dependency resolution
			const executionPlan = await this.dependencyResolver.createExecutionPlan(
				steps,
				context,
			);

			this.debug(
				'Execution plan created: %d phases',
				executionPlan.phases.length,
			);
			this.emit('execution:plan-created', {
				executionId,
				plan: executionPlan,
			});

			// Execute phases sequentially, steps within phases potentially in parallel
			const results = await this.executeExecutionPlan(
				executionPlan,
				context,
				options,
				executionId,
			);

			// Finalize metrics
			if (this.config.collectMetrics && this.metricsTracker.currentMetrics) {
				this.metricsTracker.currentMetrics.totalExecutionTime =
					Date.now() - startTime;
				this.metricsTracker.finalizeMetrics();
			}

			this.debug(
				'Step execution completed [%s] in %dms',
				executionId,
				Date.now() - startTime,
			);
			this.emit('execution:completed', {
				executionId,
				results,
				duration: Date.now() - startTime,
				metrics: this.metricsTracker.currentMetrics,
			});

			return results;
		} catch (error) {
			this.debug(
				'Step execution failed [%s]: %s',
				executionId,
				error instanceof Error ? error.message : String(error),
			);

			this.emit('execution:failed', {
				executionId,
				error,
				duration: Date.now() - startTime,
			});

			if (error instanceof HypergenError) {
				throw error;
			}

			throw ErrorHandler.createError(
				ErrorCode.INTERNAL_ERROR,
				`Step execution failed: ${
					error instanceof Error ? error.message : String(error)
				}`,
				{ executionId, steps: steps.length },
			);
		} finally {
			this.activeExecutions.delete(executionId);
		}
	}

	/**
	 * Get current execution metrics
	 */
	getMetrics(): StepExecutionMetrics | undefined {
		return this.metricsTracker.getMetrics();
	}

	/**
	 * Get current execution progress
	 */
	getProgress(): StepExecutionProgress | undefined {
		return this.metricsTracker.getProgress();
	}

	/**
	 * Cancel a specific execution
	 */
	async cancelExecution(executionId: string): Promise<void> {
		return this.cancellationManager.cancelExecution(executionId);
	}

	/**
	 * Cancel all running executions
	 */
	async cancelAllExecutions(): Promise<void> {
		return this.cancellationManager.cancelAllExecutions();
	}

	/**
	 * Generate unique execution ID
	 */
	private generateExecutionId(): string {
		return `exec-${Date.now()}-${this.executionCounter++}`;
	}

	/**
	 * Execute execution plan phases
	 */
	private async executeExecutionPlan(
		executionPlan: any,
		context: StepContext,
		options: StepExecutionOptions,
		executionId: string,
	): Promise<StepResult[]> {
		const allResults: StepResult[] = [];

		// Execute each phase sequentially
		for (const phase of executionPlan.phases) {
			this.debug(
				'Executing phase %d with %d steps',
				phase.phase,
				phase.steps.length,
			);

			// Execute steps in the current phase
			const phaseResults = await Promise.all(
				phase.steps.map(async (step: any) => {
					return this.stepRunner.executeStep(step, context, options);
				}),
			);

			allResults.push(...phaseResults);
		}

		return allResults;
	}
}
