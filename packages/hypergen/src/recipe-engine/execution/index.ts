/**
 * Execution module for recipe engine
 *
 * Central export point for step execution and orchestration
 */

// Re-export step executor (main orchestrator for steps)
export { StepExecutor } from './step-executor.js';

// Re-export types
export type {
	RecipeStepUnion,
	StepContext,
	StepExecutionOptions,
	StepResult,
	StepExecutorConfig,
	RecipeExecutionPlan,
	StepExecutionMetrics,
	StepExecutionProgress,
	ActionStep,
	TemplateStep,
	CodeModStep,
	RecipeStep,
} from './step-executor-types.js';

// Export execution utilities
export {
	createExecutionContext,
	type RecipeExecutionOptions,
} from './context-builder.js';
export {
	aggregateResults,
	type RecipeExecutionResult,
} from './result-aggregator.js';
export {
	createExecutionTracker,
	type ExecutionTracker,
	type RecipeExecution,
} from './execution-tracker.js';

// Export other execution-related components
export { CancellationManager } from './cancellation.js';
export { DependencyResolver } from './dependency-resolver.js';
export { MetricsTracker } from './metrics-tracker.js';
export { StepRunner } from './step-runner.js';
