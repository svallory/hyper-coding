import { ErrorCode, ErrorHandler } from '../../errors/hypergen-errors.js';
import type { RecipeStepUnion, StepContext } from './step-executor-types.js';

export function validateSteps(steps: RecipeStepUnion[]): void {
	if (!Array.isArray(steps)) {
		throw ErrorHandler.createError(
			ErrorCode.VALIDATION_ERROR,
			'Steps must be an array',
		);
	}

	if (steps.length === 0) {
		throw ErrorHandler.createError(
			ErrorCode.VALIDATION_ERROR,
			'At least one step is required',
		);
	}

	// Validate step names are unique
	const stepNames = new Set<string>();
	for (const step of steps) {
		if (!step.name) {
			throw ErrorHandler.createError(
				ErrorCode.VALIDATION_ERROR,
				'Step name is required',
			);
		}

		if (stepNames.has(step.name)) {
			throw ErrorHandler.createError(
				ErrorCode.VALIDATION_ERROR,
				`Duplicate step name: ${step.name}`,
			);
		}
		stepNames.add(step.name);

		if (!step.tool) {
			throw ErrorHandler.createError(
				ErrorCode.VALIDATION_ERROR,
				`Step ${step.name} must specify a tool`,
			);
		}
	}

	// Validate dependencies reference existing steps
	for (const step of steps) {
		if (step.dependsOn) {
			for (const depName of step.dependsOn) {
				if (!stepNames.has(depName)) {
					throw ErrorHandler.createError(
						ErrorCode.VALIDATION_ERROR,
						`Step ${step.name} depends on unknown step: ${depName}`,
					);
				}
			}
		}
	}
}

export function validateContext(context: StepContext): void {
	if (!context) {
		throw ErrorHandler.createError(
			ErrorCode.VALIDATION_ERROR,
			'Step context is required',
		);
	}

	if (!context.evaluateCondition) {
		throw ErrorHandler.createError(
			ErrorCode.VALIDATION_ERROR,
			'Context must provide evaluateCondition function',
		);
	}

	if (!context.recipe) {
		throw ErrorHandler.createError(
			ErrorCode.VALIDATION_ERROR,
			'Context must include recipe information',
		);
	}
}
