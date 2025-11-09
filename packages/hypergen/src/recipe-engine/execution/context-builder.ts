/**
 * Execution context builder
 */

import type { ActionLogger } from '../../actions/types.js';
import context from '../../context.js';
import type { RecipeConfig } from '../types.js';
import { createConditionEvaluator } from '../utils/condition-evaluator.js';
import { createLoggerAdapter } from '../utils/logger-adapter.js';
import type { RecipeStepUnion, StepContext } from './step-executor-types.js';

/**
 * Options for recipe execution
 */
export interface RecipeExecutionOptions {
	variables?: Record<string, any>;
	environment?: Record<string, string>;
	workingDir?: string;
	dryRun?: boolean;
	force?: boolean;
	continueOnError?: boolean;
	stepOptions?: any;
	skipPrompts?: boolean;
	logger?: ActionLogger;
	onProgress?: (progress: any) => void;
	onStepComplete?: (result: any) => void;
}

/**
 * Create execution context for a recipe
 */
export async function createExecutionContext(
	recipe: RecipeConfig,
	variables: Record<string, any>,
	options: RecipeExecutionOptions,
	executionId: string,
	workingDir: string,
	logger: ActionLogger,
): Promise<StepContext> {
	// Create base context using existing context function
	const baseContext = context(variables, {
		localsDefaults: {},
		helpers: undefined,
	});

	return {
		step: {} as RecipeStepUnion, // Will be set by step executor
		variables: baseContext,
		projectRoot: options.workingDir || workingDir,
		recipeVariables: variables,
		stepResults: new Map(),
		recipe: {
			id: executionId,
			name: recipe.name,
			version: recipe.version,
			startTime: new Date(),
		},
		stepData: {},
		evaluateCondition: createConditionEvaluator(baseContext),
		dryRun: options.dryRun,
		force: options.force,
		logger: options.logger
			? createLoggerAdapter(options.logger)
			: createLoggerAdapter(logger),
	};
}
