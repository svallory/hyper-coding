/**
 * Result aggregation for recipe execution
 */

import type { RecipeConfig } from '../types.js';
import type { StepContext, StepResult } from './step-executor-types.js';

/**
 * Recipe execution result
 */
export interface RecipeExecutionResult {
	executionId: string;
	recipe: RecipeConfig;
	success: boolean;
	stepResults: StepResult[];
	duration: number;
	filesCreated: string[];
	filesModified: string[];
	filesDeleted: string[];
	errors: string[];
	warnings: string[];
	variables: Record<string, any>;
	metadata: {
		startTime: Date;
		endTime: Date;
		workingDir: string;
		totalSteps: number;
		completedSteps: number;
		failedSteps: number;
		skippedSteps: number;
	};
}

/**
 * Aggregate step results into a recipe execution result
 */
export function aggregateResults(
	executionId: string,
	recipe: RecipeConfig,
	stepResults: StepResult[],
	variables: Record<string, any>,
	startTime: number,
	context: StepContext,
): RecipeExecutionResult {
	const duration = Date.now() - startTime;
	const completedSteps = stepResults.filter((r) => r.status === 'completed');
	const failedSteps = stepResults.filter((r) => r.status === 'failed');
	const skippedSteps = stepResults.filter((r) => r.status === 'skipped');

	// Aggregate file changes
	const filesCreated = new Set<string>();
	const filesModified = new Set<string>();
	const filesDeleted = new Set<string>();
	const errors: string[] = [];
	const warnings: string[] = [];

	for (const result of stepResults) {
		if (result.filesCreated) {
			for (const file of result.filesCreated) {
				filesCreated.add(file);
			}
		}
		if (result.filesModified) {
			for (const file of result.filesModified) {
				filesModified.add(file);
			}
		}
		if (result.filesDeleted) {
			for (const file of result.filesDeleted) {
				filesDeleted.add(file);
			}
		}
		if (result.error) {
			errors.push(`${result.stepName}: ${result.error.message}`);
		}
	}

	return {
		executionId,
		recipe,
		success: failedSteps.length === 0,
		stepResults,
		duration,
		filesCreated: [...filesCreated],
		filesModified: [...filesModified],
		filesDeleted: [...filesDeleted],
		errors,
		warnings,
		variables,
		metadata: {
			startTime: new Date(startTime),
			endTime: new Date(),
			workingDir: context.projectRoot,
			totalSteps: stepResults.length,
			completedSteps: completedSteps.length,
			failedSteps: failedSteps.length,
			skippedSteps: skippedSteps.length,
		},
	};
}
