/**
 * Parallel Tool Implementation for Recipe Step System
 *
 * This tool executes a list of recipe steps concurrently.
 * It leverages the StepExecutor's parallel execution capabilities.
 */

import { ErrorCode, ErrorHandler } from "@hypercli/core";
import createDebug from "debug";
import { StepExecutor } from "#/recipe-engine/step-executor";
import type {
	ParallelExecutionResult,
	ParallelStep,
	StepContext,
	StepExecutionOptions,
	StepResult,
} from "#/recipe-engine/types";
import { Tool, type ToolValidationResult } from "./base.js";

const debug = createDebug("hypergen:v8:recipe:tool:parallel");

export class ParallelTool extends Tool<ParallelStep> {
	constructor(name = "parallel-tool", options: Record<string, any> = {}) {
		super("parallel", name, options);
	}

	protected async onValidate(
		step: ParallelStep,
		context: StepContext,
	): Promise<ToolValidationResult> {
		const errors: string[] = [];

		if (!step.steps || !Array.isArray(step.steps) || step.steps.length === 0) {
			errors.push("Parallel steps must be a non-empty array");
		}

		if (step.limit && (typeof step.limit !== "number" || step.limit <= 0)) {
			errors.push("Parallel limit must be a positive number");
		}

		return {
			isValid: errors.length === 0,
			errors,
			warnings: [],
			suggestions: [],
			estimatedExecutionTime: 0, // Hard to estimate for parallel
			resourceRequirements: {
				memory: 0, // Dynamically determined by steps
				disk: 0,
				network: false,
				processes: 0,
			},
		};
	}

	protected async onExecute(
		step: ParallelStep,
		context: StepContext,
		options?: StepExecutionOptions,
	): Promise<StepResult> {
		const startTime = new Date();
		this.debug("Executing parallel step: %s with %d steps", step.name, step.steps.length);

		try {
			const executor = new StepExecutor(undefined, {
				collectMetrics: false,
				enableProgressTracking: false,
				maxConcurrency: step.limit,
				enableParallelExecution: true,
			});

			// If continueOnError is explicitly set to false (failedFast behavior), passing it to StepExecutor
			// might need to be verified. StepExecutor's continueOnError typically means "continue execution of valid steps".
			// For parallel execution, we want "if one fails, abort others" or "wait for all".
			// The `StepExecutor` likely handles dependencies, but if we pass a flat list without deps, it can run them efficiently.

			const executionOptions: StepExecutionOptions = {
				...options,
				continueOnError: step.continueOnError ?? options?.continueOnError,
			};

			const results = await executor.executeSteps(step.steps, context, executionOptions);

			const failed = results.filter((r) => r.status === "failed");

			if (failed.length > 0 && !executionOptions.continueOnError) {
				throw ErrorHandler.createError(
					ErrorCode.TEMPLATE_EXECUTION_ERROR,
					`Parallel execution failed: ${failed.map((f) => f.stepName).join(", ")}`,
					{ template: step.name, cause: failed[0].error },
				);
			}

			this.debug("Parallel execution completed");

			return this.createResult(step, results, startTime, "completed");
		} catch (error: any) {
			const endTime = new Date();
			return {
				status: "failed",
				stepName: step.name,
				toolType: "parallel",
				startTime,
				endTime,
				duration: endTime.getTime() - startTime.getTime(),
				retryCount: 0,
				dependenciesSatisfied: true,
				error: {
					message: error.message,
					code: error.code || "PARALLEL_EXECUTION_ERROR",
					cause: error,
				},
			};
		}
	}

	private createResult(
		step: ParallelStep,
		results: StepResult[],
		startTime: Date,
		status: "completed" | "skipped",
	): StepResult {
		const endTime = new Date();

		const filesCreated: string[] = [];
		const filesModified: string[] = [];
		const filesDeleted: string[] = [];

		results.forEach((r) => {
			if (r.filesCreated) filesCreated.push(...r.filesCreated);
			if (r.filesModified) filesModified.push(...r.filesModified);
			if (r.filesDeleted) filesDeleted.push(...r.filesDeleted);
		});

		return {
			status,
			stepName: step.name,
			toolType: "parallel",
			startTime,
			endTime,
			duration: endTime.getTime() - startTime.getTime(),
			retryCount: 0,
			dependenciesSatisfied: true,
			filesCreated,
			filesModified,
			filesDeleted,
			toolResult: {
				steps: results,
			} as ParallelExecutionResult,
			output: {
				totalSteps: results.length,
				completed: results.filter((r) => r.status === "completed").length,
				failed: results.filter((r) => r.status === "failed").length,
			},
		};
	}
}

export class ParallelToolFactory {
	create(name = "parallel-tool", options: Record<string, any> = {}): ParallelTool {
		return new ParallelTool(name, options);
	}

	getToolType(): "parallel" {
		return "parallel";
	}

	validateConfig(config: Record<string, any>): ToolValidationResult {
		return {
			isValid: true,
			errors: [],
			warnings: [],
			suggestions: [],
		};
	}
}

export const parallelToolFactory = new ParallelToolFactory();
